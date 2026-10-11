import { DateTime } from 'luxon';
export interface Clock { now(): Date }
export const systemClock: Clock = { now: () => new Date() };
export type CalendarEvent = { id: string; calendarId: string; title: string; description?: string; color: string; calendarName: string; recurringEventId?: string } & (
  { kind: 'allDay'; start: string; end: string } | { kind: 'timed'; start: string; end: string }
);
export type SyncState = 'fresh' | 'syncing' | 'stale' | 'offline' | 'auth_required' | 'partial_error' | 'not_configured';
export interface CalendarSummary { id: string; name: string; color: string; fetched: boolean }
/** complete: every selected calendar has a stored month. available: at least one has (show cached data, flag partial). */
export interface Snapshot { events: CalendarEvent[]; complete: boolean; available?: boolean; fetchedAt: string | null; state: SyncState; synthetic: boolean; calendars?: CalendarSummary[] }
export interface CalendarProvider { month(month: string, clock: Clock, timezone: string): Snapshot }
export interface SnapshotRepository { read(month: string): Snapshot | undefined; write(month: string, snapshot: Snapshot): void }
export const dateInZone = (clock: Clock, zone: string) => DateTime.fromJSDate(clock.now(), { zone }).toISODate()!;
/** How far from the current month the screen may navigate and the worker may fetch. */
export const NAVIGATION_LIMIT_MONTHS = 12;
export function withinNavigationLimit(month: string, clock: Clock, timezone: string) {
 const now = DateTime.fromJSDate(clock.now(), { zone: timezone }).startOf('month');
 const target = DateTime.fromISO(`${month}-01`, { zone: timezone });
 return target.isValid && Math.abs(Math.round(target.diff(now, 'months').months)) <= NAVIGATION_LIMIT_MONTHS;
}
/** Month range in the display timezone, as offset RFC3339 strings for Google timeMin/timeMax. */
export function monthBounds(month: string, zone: string) {
 const start = DateTime.fromISO(`${month}-01`, { zone }).startOf('day');
 return { start, end: start.plus({ months: 1 }) };
}
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
export function weekDays(day: string, weekStart: 0 | 1): string[] {
 const date = DateTime.fromISO(day);
 const first = date.minus({days:(date.weekday % 7 - weekStart + 7) % 7});
 return Array.from({length:7}, (_,i)=>first.plus({days:i}).toISODate()!);
}
export function timedSegments(events: CalendarEvent[], day: string, zone: string) {
 const {start,end}=dayBounds(day,zone);
 const segments=eventsForDay(events,day,zone).filter(e=>e.kind==='timed').map(event=>{
  const from=DateTime.fromISO(event.start).setZone(zone), to=DateTime.fromISO(event.end).setZone(zone);
  const clippedStart=from < start ? start : from, clippedEnd=to > end ? end : to;
  return {event,start:clippedStart.hour*60+clippedStart.minute,end:clippedEnd.equals(end)?1440:clippedEnd.hour*60+clippedEnd.minute,lane:0,lanes:1,continuesBefore:from<start,continuesAfter:to>end};
 }).sort((a,b)=>a.start-b.start || a.end-b.end);
 // Allocate columns within each connected overlap group; touching ends are exclusive.
 let group:typeof segments=[];
 let groupEnd=-1;
 const finish=()=>{const count=Math.max(1,...group.map(s=>s.lane+1));group.forEach(s=>s.lanes=count);};
 for(const segment of segments){
  if(segment.start>=groupEnd){finish();group=[];groupEnd=-1;}
  let lane=0;while(group.some(s=>s.lane===lane && s.end>segment.start))lane++;
  segment.lane=lane;group.push(segment);groupEnd=Math.max(groupEnd,segment.end);
 }
 finish();return segments;
}

const STATE_SEVERITY: SyncState[] = ['auth_required', 'offline', 'partial_error', 'not_configured', 'stale', 'syncing', 'fresh'];
/** Combine per-month responses (week view can span two months). The worst state and oldest fetch win. */
export function mergeSnapshots(parts: Snapshot[]): Snapshot {
 const unique = new Map(parts.flatMap(s => s.events).map(e => [`${e.calendarId}:${e.id}`, e]));
 const fetched = parts.map(s => s.fetchedAt).filter((v): v is string => Boolean(v)).sort();
 const calendars = parts[0]?.calendars?.map(c => ({ ...c, fetched: parts.every(s => s.calendars?.find(x => x.id === c.id)?.fetched) }));
 return {
  events: [...unique.values()],
  complete: parts.every(s => s.complete),
  available: parts.every(s => s.available ?? s.complete),
  fetchedAt: fetched.length === parts.length ? fetched[0] : null,
  state: STATE_SEVERITY.find(st => parts.some(s => s.state === st)) ?? 'fresh',
  synthetic: parts.some(s => s.synthetic),
  ...(calendars ? { calendars } : {}),
 };
}
