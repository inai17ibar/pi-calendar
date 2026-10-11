import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CalendarEvent, CalendarSummary } from '../../domain/calendar';

export const SCHEMA_VERSION = 1;
/** Stored per calendar; display name/color are joined from the calendars table at read time. */
export type StoredEvent = Omit<CalendarEvent, 'calendarName' | 'color'>;
export interface CalendarRow { id: string; name: string; color: string; accessRole: string; googleSelected: boolean; primary: boolean }
export type SyncErrorCode = 'auth' | 'forbidden' | 'not_found' | 'rate_limited' | 'server' | 'network' | 'too_many' | 'invalid_response';
export interface SyncStatusRow { calendarId: string; month: string; status: 'ok' | 'error'; lastSuccess: string | null; lastAttempt: string; errorCode: SyncErrorCode | null; retryAt: string | null; failures: number }
export type AuthState = 'ok' | 'auth_required' | 'not_configured';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS app_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_settings(id INTEGER PRIMARY KEY CHECK(id=1), selected_calendar_ids TEXT, generation INTEGER NOT NULL DEFAULT 0);
INSERT OR IGNORE INTO app_settings(id, selected_calendar_ids, generation) VALUES (1, NULL, 0);
CREATE TABLE IF NOT EXISTS calendars(calendar_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, color TEXT NOT NULL, access_role TEXT NOT NULL, google_selected INTEGER NOT NULL, is_primary INTEGER NOT NULL, refreshed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS month_snapshots(calendar_id TEXT NOT NULL, month_key TEXT NOT NULL, timezone TEXT NOT NULL, events_json TEXT NOT NULL, fetched_at TEXT NOT NULL, generation INTEGER NOT NULL, PRIMARY KEY(calendar_id, month_key, timezone));
CREATE TABLE IF NOT EXISTS sync_status(calendar_id TEXT NOT NULL, month_key TEXT NOT NULL, timezone TEXT NOT NULL, status TEXT NOT NULL, last_success TEXT, last_attempt TEXT NOT NULL, last_error_code TEXT, retry_at TEXT, failures INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(calendar_id, month_key, timezone));
CREATE TABLE IF NOT EXISTS month_interest(month_key TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
`;

export class CalendarStore {
 readonly db: DatabaseSync;
 constructor(path: string) {
  this.db = new DatabaseSync(path);
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
  this.migrate();
 }
 static open(stateDir: string) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const store = new CalendarStore(join(stateDir, 'calendar.sqlite'));
  // Personal event data: owner-only, like the secrets directory. SQLite copies this mode to -wal/-shm.
  chmodSync(join(stateDir, 'calendar.sqlite'), 0o600);
  return store;
 }
 private migrate() {
  const current = this.schemaVersion();
  if (current !== null && current > SCHEMA_VERSION) throw new Error(`Database schema ${current} is newer than this release (${SCHEMA_VERSION}).`);
  this.tx(() => { this.db.exec(MIGRATION); this.setMeta('schema_version', String(SCHEMA_VERSION)); });
 }
 schemaVersion(): number | null {
  const table = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_metadata'").get();
  if (!table) return null;
  const row = this.db.prepare("SELECT value FROM app_metadata WHERE key='schema_version'").get() as { value: string } | undefined;
  return row ? Number(row.value) : null;
 }
 tx<T>(fn: () => T): T {
  this.db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
 }
 close() { this.db.close(); }

 getMeta(key: string): string | null { return (this.db.prepare('SELECT value FROM app_metadata WHERE key=?').get(key) as { value: string } | undefined)?.value ?? null; }
 setMeta(key: string, value: string) { this.db.prepare('INSERT INTO app_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
 authState(): AuthState { return (this.getMeta('auth_state') as AuthState | null) ?? 'not_configured'; }
 setAuthState(state: AuthState) { this.setMeta('auth_state', state); }
 heartbeat(): string | null { return this.getMeta('worker_heartbeat'); }

 generation(): number { return (this.db.prepare('SELECT generation FROM app_settings WHERE id=1').get() as { generation: number }).generation; }
 /** null = follow the calendars checked in Google Calendar itself. */
 explicitSelection(): string[] | null {
  const row = this.db.prepare('SELECT selected_calendar_ids FROM app_settings WHERE id=1').get() as { selected_calendar_ids: string | null };
  return row.selected_calendar_ids ? JSON.parse(row.selected_calendar_ids) as string[] : null;
 }
 setSelection(ids: string[] | null) {
  this.db.prepare('UPDATE app_settings SET selected_calendar_ids=?, generation=generation+1 WHERE id=1').run(ids ? JSON.stringify(ids) : null);
 }
 calendars(): CalendarRow[] {
  return (this.db.prepare('SELECT calendar_id, display_name, color, access_role, google_selected, is_primary FROM calendars ORDER BY is_primary DESC, display_name').all() as Record<string, string | number>[])
   .map(r => ({ id: String(r.calendar_id), name: String(r.display_name), color: String(r.color), accessRole: String(r.access_role), googleSelected: r.google_selected === 1, primary: r.is_primary === 1 }));
 }
 selectedCalendars(): CalendarRow[] {
  const all = this.calendars();
  const explicit = this.explicitSelection();
  return explicit ? all.filter(c => explicit.includes(c.id)) : all.filter(c => c.googleSelected || c.primary);
 }
 /** Replace the calendar list. Calendars removed from Google lose their cached months immediately. */
 replaceCalendars(rows: CalendarRow[], now: Date) {
  const changed = JSON.stringify(this.calendars().map(c => c.id).sort()) !== JSON.stringify(rows.map(c => c.id).sort());
  this.tx(() => {
   this.db.exec('DELETE FROM calendars');
   const insert = this.db.prepare('INSERT INTO calendars(calendar_id, display_name, color, access_role, google_selected, is_primary, refreshed_at) VALUES(?,?,?,?,?,?,?)');
   for (const c of rows) insert.run(c.id, c.name, c.color, c.accessRole, c.googleSelected ? 1 : 0, c.primary ? 1 : 0, now.toISOString());
   this.db.exec('DELETE FROM month_snapshots WHERE calendar_id NOT IN (SELECT calendar_id FROM calendars)');
   this.db.exec('DELETE FROM sync_status WHERE calendar_id NOT IN (SELECT calendar_id FROM calendars)');
   if (changed) this.db.exec('UPDATE app_settings SET generation=generation+1 WHERE id=1');
  });
 }

 /** Atomic swap of one calendar-month. Only call after every page succeeded. */
 replaceMonth(calendarId: string, month: string, timezone: string, events: StoredEvent[], fetchedAt: Date, generation: number): boolean {
  return this.tx(() => {
   if (this.generation() !== generation) return false;
   this.db.prepare('INSERT INTO month_snapshots(calendar_id, month_key, timezone, events_json, fetched_at, generation) VALUES(?,?,?,?,?,?) ON CONFLICT(calendar_id, month_key, timezone) DO UPDATE SET events_json=excluded.events_json, fetched_at=excluded.fetched_at, generation=excluded.generation')
    .run(calendarId, month, timezone, JSON.stringify(events), fetchedAt.toISOString(), generation);
   this.db.prepare("INSERT INTO sync_status(calendar_id, month_key, timezone, status, last_success, last_attempt, last_error_code, retry_at, failures) VALUES(?,?,?,'ok',?,?,NULL,NULL,0) ON CONFLICT(calendar_id, month_key, timezone) DO UPDATE SET status='ok', last_success=excluded.last_success, last_attempt=excluded.last_attempt, last_error_code=NULL, retry_at=NULL, failures=0")
    .run(calendarId, month, timezone, fetchedAt.toISOString(), fetchedAt.toISOString());
   return true;
  });
 }
 /** Record a failure without touching the existing snapshot. */
 recordFailure(calendarId: string, month: string, timezone: string, code: SyncErrorCode, now: Date, retryAt: Date) {
  this.db.prepare("INSERT INTO sync_status(calendar_id, month_key, timezone, status, last_success, last_attempt, last_error_code, retry_at, failures) VALUES(?,?,?,'error',NULL,?,?,?,1) ON CONFLICT(calendar_id, month_key, timezone) DO UPDATE SET status='error', last_attempt=excluded.last_attempt, last_error_code=excluded.last_error_code, retry_at=excluded.retry_at, failures=sync_status.failures+1")
   .run(calendarId, month, timezone, now.toISOString(), code, retryAt.toISOString());
 }
 syncStatus(calendarId: string, month: string, timezone: string): SyncStatusRow | null {
  const r = this.db.prepare('SELECT * FROM sync_status WHERE calendar_id=? AND month_key=? AND timezone=?').get(calendarId, month, timezone) as Record<string, string | number | null> | undefined;
  if (!r) return null;
  return { calendarId, month, status: r.status as 'ok' | 'error', lastSuccess: r.last_success as string | null, lastAttempt: String(r.last_attempt), errorCode: r.last_error_code as SyncErrorCode | null, retryAt: r.retry_at as string | null, failures: Number(r.failures) };
 }
 readMonth(calendarId: string, month: string, timezone: string): { events: StoredEvent[]; fetchedAt: string } | null {
  const r = this.db.prepare('SELECT events_json, fetched_at FROM month_snapshots WHERE calendar_id=? AND month_key=? AND timezone=?').get(calendarId, month, timezone) as { events_json: string; fetched_at: string } | undefined;
  return r ? { events: JSON.parse(r.events_json) as StoredEvent[], fetchedAt: r.fetched_at } : null;
 }
 /** Merge the selected calendars' snapshots for one display month. */
 monthView(month: string, timezone: string) {
  const selected = this.selectedCalendars();
  const events: CalendarEvent[] = [];
  const calendars: CalendarSummary[] = [];
  let oldest: string | null = null;
  const statuses: SyncStatusRow[] = [];
  for (const c of selected) {
   const snap = this.readMonth(c.id, month, timezone);
   const status = this.syncStatus(c.id, month, timezone);
   if (status) statuses.push(status);
   calendars.push({ id: c.id, name: c.name, color: c.color, fetched: Boolean(snap) });
   if (!snap) continue;
   if (!oldest || snap.fetchedAt < oldest) oldest = snap.fetchedAt;
   const seen = new Set<string>();
   for (const e of snap.events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    events.push({ ...e, calendarId: c.id, calendarName: c.name, color: c.color } as CalendarEvent);
   }
  }
  return { events, calendars, oldestFetchedAt: oldest, statuses };
 }

 requestMonth(month: string, expiresAt: Date) {
  this.db.prepare('INSERT INTO month_interest(month_key, expires_at) VALUES(?,?) ON CONFLICT(month_key) DO UPDATE SET expires_at=MAX(expires_at, excluded.expires_at)').run(month, expiresAt.toISOString());
 }
 interestedMonths(now: Date): string[] {
  return (this.db.prepare('SELECT month_key FROM month_interest WHERE expires_at > ? ORDER BY month_key').all(now.toISOString()) as { month_key: string }[]).map(r => r.month_key);
 }
 /** Drop cached months outside the retained range so personal data does not grow without bound. */
 pruneMonths(keep: string[], timezone: string, now: Date) {
  this.db.prepare('DELETE FROM month_interest WHERE expires_at <= ?').run(now.toISOString());
  const placeholders = keep.map(() => '?').join(',') || "''";
  this.db.prepare(`DELETE FROM month_snapshots WHERE timezone <> ? OR month_key NOT IN (${placeholders})`).run(timezone, ...keep);
  this.db.prepare(`DELETE FROM sync_status WHERE timezone <> ? OR month_key NOT IN (${placeholders})`).run(timezone, ...keep);
 }
}
