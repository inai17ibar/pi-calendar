import { DateTime } from 'luxon';
import { z } from 'zod';
import type { CalendarRow, StoredEvent, SyncErrorCode } from '../storage/db';

/** Read-only endpoints only. Nothing in this module may call a Google write API. */
const API = 'https://www.googleapis.com/calendar/v3';
export const MAX_EVENTS_PER_MONTH = 100_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class SyncError extends Error {
 constructor(readonly code: SyncErrorCode, message: string = code) { super(message); this.name = 'SyncError'; }
}
export interface AccessTokenSource { token(): Promise<string>; invalidate(): void }
export interface CalendarApi {
 listCalendars(): Promise<CalendarRow[]>;
 listEvents(calendarId: string, timeMin: string, timeMax: string, timeZone: string): Promise<GoogleEvent[]>;
}

const dateOrTime = z.object({ date: z.string().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() }).loose();
export const googleEvent = z.object({
 id: z.string().min(1), status: z.string().optional(), summary: z.string().optional(), visibility: z.string().optional(),
 start: dateOrTime.optional(), end: dateOrTime.optional(), recurringEventId: z.string().optional(), originalStartTime: dateOrTime.optional(),
}).loose();
export type GoogleEvent = z.infer<typeof googleEvent>;
const eventsPage = z.object({ items: z.array(z.unknown()).default([]), nextPageToken: z.string().optional() }).loose();
const calendarEntry = z.object({ id: z.string().min(1), summary: z.string().optional(), summaryOverride: z.string().optional(), backgroundColor: z.string().optional(), accessRole: z.string().default('reader'), selected: z.boolean().optional(), primary: z.boolean().optional(), hidden: z.boolean().optional(), deleted: z.boolean().optional() }).loose();
const calendarPage = z.object({ items: z.array(calendarEntry).default([]), nextPageToken: z.string().optional() }).loose();

/** Map an HTTP status/body to an internal code. Raw Google messages are never stored or logged. */
export function classifyHttp(status: number, body: unknown): SyncErrorCode {
 const reason = String((body as { error?: { errors?: { reason?: string }[] } })?.error?.errors?.[0]?.reason ?? '');
 if (status === 401) return 'auth';
 if (status === 429 || status === 403 && /rateLimit|userRateLimit|quotaExceeded/i.test(reason)) return 'rate_limited';
 if (status === 403) return 'forbidden';
 if (status === 404 || status === 410) return 'not_found';
 if (status >= 500) return 'server';
 return 'invalid_response';
}

export class GoogleCalendarHttpApi implements CalendarApi {
 constructor(private readonly auth: AccessTokenSource, private readonly fetchImpl: typeof fetch = fetch) {}
 private async get(path: string, params: Record<string, string>): Promise<unknown> {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  for (let attempt = 0; ; attempt++) {
   let accessToken: string;
   try { accessToken = await this.auth.token(); } catch (e) { throw e instanceof SyncError ? e : new SyncError('auth'); }
   let res: Response;
   try {
    res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
   } catch {
    throw new SyncError('network');
   }
   const body = await res.json().catch(() => null);
   if (res.ok) return body;
   const code = classifyHttp(res.status, body);
   // One retry after dropping a possibly expired access token.
   if (code === 'auth' && attempt === 0) { this.auth.invalidate(); continue; }
   throw new SyncError(code);
  }
 }
 async listCalendars(): Promise<CalendarRow[]> {
  const rows: CalendarRow[] = [];
  let pageToken: string | undefined;
  do {
   const page = calendarPage.safeParse(await this.get('/users/me/calendarList', { maxResults: '250', ...(pageToken ? { pageToken } : {}) }));
   if (!page.success) throw new SyncError('invalid_response');
   for (const c of page.data.items) {
    if (c.deleted) continue;
    rows.push({ id: c.id, name: c.summaryOverride || c.summary || '（名称なし）', color: /^#[0-9a-f]{6}$/i.test(c.backgroundColor ?? '') ? c.backgroundColor! : '#547ca7', accessRole: c.accessRole, googleSelected: Boolean(c.selected) && !c.hidden, primary: Boolean(c.primary) });
   }
   pageToken = page.data.nextPageToken;
  } while (pageToken);
  return rows;
 }
 /** Full month listing; resolves only after the last page so callers never store a partial month. */
 async listEvents(calendarId: string, timeMin: string, timeMax: string, timeZone: string): Promise<GoogleEvent[]> {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
   const page = eventsPage.safeParse(await this.get(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime', timeMin, timeMax, timeZone, maxResults: '2500', ...(pageToken ? { pageToken } : {}),
   }));
   if (!page.success) throw new SyncError('invalid_response');
   for (const raw of page.data.items) {
    const parsed = googleEvent.safeParse(raw);
    if (parsed.success) items.push(parsed.data);
   }
   if (items.length > MAX_EVENTS_PER_MONTH) throw new SyncError('too_many');
   pageToken = page.data.nextPageToken;
  } while (pageToken);
  return items;
 }
}

const isDate = (v: string | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v) && DateTime.fromISO(v).isValid);
const isOffsetDateTime = (v: string | undefined): v is string => Boolean(v && /(Z|[+-]\d{2}:\d{2})$/.test(v) && DateTime.fromISO(v, { setZone: true }).isValid);

/** Google item → stored event. Cancelled and malformed items are dropped; only fields the screen needs are kept. */
export function normalizeEvents(items: GoogleEvent[], calendar: Pick<CalendarRow, 'id' | 'accessRole'>): StoredEvent[] {
 const out: StoredEvent[] = [];
 const seen = new Set<string>();
 for (const item of items) {
  if (item.status === 'cancelled' || seen.has(item.id)) continue;
  const summary = item.summary?.trim();
  const title = summary || (calendar.accessRole === 'freeBusyReader' || item.visibility === 'private' || item.visibility === 'confidential' ? '予定あり' : '（件名なし）');
  const base = { id: item.id, calendarId: calendar.id, title, ...(item.recurringEventId ? { recurringEventId: item.recurringEventId } : {}) };
  const s = item.start, e = item.end;
  if (isDate(s?.date)) {
   const end = isDate(e?.date) && e.date > s.date ? e.date : DateTime.fromISO(s.date).plus({ days: 1 }).toISODate()!;
   out.push({ ...base, kind: 'allDay', start: s.date, end });
  } else if (isOffsetDateTime(s?.dateTime)) {
   const end = isOffsetDateTime(e?.dateTime) && DateTime.fromISO(e.dateTime).toMillis() >= DateTime.fromISO(s.dateTime).toMillis() ? e.dateTime : s.dateTime;
   out.push({ ...base, kind: 'timed', start: s.dateTime, end });
  } else continue;
  seen.add(item.id);
 }
 return out;
}
