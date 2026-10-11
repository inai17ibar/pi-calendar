import { DateTime } from 'luxon';
import { monthBounds, withinNavigationLimit, type Clock } from '../domain/calendar';
import { normalizeEvents, SyncError, type CalendarApi } from '../server/google/client';
import type { CalendarRow, CalendarStore, SyncErrorCode } from '../server/storage/db';

export const FOREGROUND_INTERVAL_MS = 60_000;
export const BACKGROUND_INTERVAL_MS = 5 * 60_000;
export const CALENDAR_LIST_INTERVAL_MS = 6 * 3600_000;
const BACKOFF_START_MS = 30_000, BACKOFF_MAX_MS = 15 * 60_000;

export function backoffMs(failures: number, random: () => number = Math.random) {
 const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** Math.max(0, failures - 1));
 return Math.round(base * (0.8 + 0.4 * random()));
}
export const monthKey = (d: DateTime) => d.toFormat('yyyy-MM');
export function currentMonth(clock: Clock, timezone: string) { return monthKey(DateTime.fromJSDate(clock.now(), { zone: timezone })); }
/** Base range: previous, current, next, and the month after. Current month first. */
export function baseMonths(clock: Clock, timezone: string): string[] {
 const now = DateTime.fromJSDate(clock.now(), { zone: timezone }).startOf('month');
 return [0, -1, 1, 2].map(d => monthKey(now.plus({ months: d })));
}

export type SyncOutcome = 'ok' | 'discarded' | SyncErrorCode;
/** Fetch every page, then swap the month in one transaction. Failure keeps the previous snapshot. */
export async function syncMonth(api: CalendarApi, store: CalendarStore, calendar: CalendarRow, month: string, timezone: string, clock: Clock, random: () => number = Math.random): Promise<SyncOutcome> {
 const generation = store.generation();
 const { start, end } = monthBounds(month, timezone);
 try {
  const items = await api.listEvents(calendar.id, start.toISO()!, end.toISO()!, timezone);
  return store.replaceMonth(calendar.id, month, timezone, normalizeEvents(items, calendar), clock.now(), generation) ? 'ok' : 'discarded';
 } catch (e) {
  const code: SyncErrorCode = e instanceof SyncError ? e.code : 'invalid_response';
  const failures = (store.syncStatus(calendar.id, month, timezone)?.failures ?? 0) + 1;
  store.recordFailure(calendar.id, month, timezone, code, clock.now(), new Date(clock.now().getTime() + backoffMs(failures, random)));
  if (code === 'auth') store.setAuthState('auth_required');
  return code;
 }
}

export async function refreshCalendars(api: CalendarApi, store: CalendarStore, clock: Clock): Promise<SyncOutcome> {
 try {
  store.replaceCalendars(await api.listCalendars(), clock.now());
  store.setMeta('calendars_refreshed_at', clock.now().toISOString());
  return 'ok';
 } catch (e) {
  const code: SyncErrorCode = e instanceof SyncError ? e.code : 'invalid_response';
  if (code === 'auth') store.setAuthState('auth_required');
  return code;
 }
}

interface Job { calendar: CalendarRow; month: string }
/** Success → wait `interval`; failure → jittered backoff. Used for the calendar list refresh. */
export class RetrySchedule {
 private nextAt = 0;
 private failures = 0;
 constructor(private readonly interval: number, private readonly random: () => number = Math.random) {}
 due(now: number) { return now >= this.nextAt; }
 reset() { this.nextAt = 0; this.failures = 0; }
 success(now: number) { this.failures = 0; this.nextAt = now + this.interval; }
 failure(now: number) { this.failures++; this.nextAt = now + backoffMs(this.failures, this.random); }
}

/**
 * Decide which calendar-months are due. Foreground = current month + recently viewed months.
 * force (manual 再取得) ignores both the interval and any backoff.
 */
export function dueJobs(store: CalendarStore, clock: Clock, timezone: string, force = false): Job[] {
 const now = clock.now().getTime();
 const current = currentMonth(clock, timezone);
 const interest = store.interestedMonths(clock.now()).filter(m => withinNavigationLimit(m, clock, timezone));
 const months = [...new Set([...baseMonths(clock, timezone), ...interest])];
 const foreground = new Set([current, ...interest]);
 const selected = store.selectedCalendars();
 const jobs: (Job & { priority: number })[] = [];
 for (const month of months) {
  for (const calendar of selected) {
   const status = store.syncStatus(calendar.id, month, timezone);
   const interval = foreground.has(month) ? FOREGROUND_INTERVAL_MS : BACKGROUND_INTERVAL_MS;
   const retryOk = !status?.retryAt || Date.parse(status.retryAt) <= now;
   // A clock moved backwards makes lastAttempt "future"; treat that as due rather than waiting.
   const last = status ? Date.parse(status.lastAttempt) : -Infinity;
   const due = !status || last > now || now - last >= interval;
   if (force || (due && retryOk)) jobs.push({ calendar, month, priority: month === current ? 0 : foreground.has(month) ? 1 : 2 });
  }
 }
 return jobs.sort((a, b) => a.priority - b.priority).map(({ calendar, month }) => ({ calendar, month }));
}

export async function runJobs(jobs: Job[], concurrency: number, run: (job: Job) => Promise<SyncOutcome>): Promise<SyncOutcome[]> {
 const results: SyncOutcome[] = [];
 let next = 0, stop = false;
 await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  while (!stop && next < jobs.length) {
   const outcome = await run(jobs[next++]);
   results.push(outcome);
   if (outcome === 'auth') stop = true;
  }
 }));
 return results;
}
