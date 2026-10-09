import { DateTime } from 'luxon';
export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };
export type CalendarEvent = { id: string; calendarId: string; title: string; description?: string; color: string; calendarName: string } & (
  { kind: 'allDay'; start: string; end: string } | { kind: 'timed'; start: string; end: string }
);
export type SyncState = 'fresh' | 'syncing' | 'stale' | 'offline' | 'auth_required' | 'partial_error' | 'not_configured';
export interface Snapshot { events: CalendarEvent[]; complete: boolean; fetchedAt: string | null; state: SyncState; synthetic: true }
export interface CalendarProvider { month(month: string, clock: Clock, timezone: string): Snapshot }
export interface SnapshotRepository { read(month: string): Snapshot | undefined; write(month: string, snapshot: Snapshot): void }
export const dateInZone = (clock: Clock, zone: string) => DateTime.fromJSDate(clock.now(), { zone }).toISODate()!;
export function dayBounds(day: string, zone: string) {
 const start = DateTime.fromISO(day, { zone }).startOf('day');
 return { start, end: start.plus({ days: 1 }) };
}
export function overlapsDay(event: CalendarEvent, day: string, zone: string): boolean {
 if (event.kind === 'allDay') return event.start <= day && day < event.end;
 const { start, end } = dayBounds(day, zone);
 return DateTime.fromISO(event.start).toMillis() < end.toMillis() && DateTime.fromISO(event.end).toMillis() > start.toMillis();
}
export function eventsForDay(events: CalendarEvent[], day: string, zone: string): CalendarEvent[] {
 return events.filter(e => overlapsDay(e, day, zone)).sort((a,b) => {
  if (a.kind !== b.kind) return a.kind === 'allDay' ? -1 : 1;
  const val = (e: CalendarEvent, k: 'start' | 'end') => e.kind === 'allDay' ? e[k] : String(DateTime.fromISO(e[k]).toMillis()).padStart(16,'0');
  return val(a,'start').localeCompare(val(b,'start')) || val(a,'end').localeCompare(val(b,'end')) || `${a.calendarId}:${a.id}`.localeCompare(`${b.calendarId}:${b.id}`);
 });
}
export function monthDays(month: string, weekStart: 0 | 1): string[] {
 const first = DateTime.fromISO(`${month}-01`);
 const offset = (first.weekday % 7 - weekStart + 7) % 7;
 const start = first.minus({ days: offset });
 return Array.from({ length: 42 }, (_, i) => start.plus({ days: i }).toISODate()!);
}
export function eventPhase(event: CalendarEvent, clock: Clock): 'ongoing' | 'upcoming' | 'ended' | null {
 if (event.kind === 'allDay') return null;
 const now = clock.now().getTime();
 return now >= DateTime.fromISO(event.end).toMillis() ? 'ended' : now >= DateTime.fromISO(event.start).toMillis() ? 'ongoing' : 'upcoming';
}
