import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import page1 from '../../fixtures/google/month-page-1.json';
import page2 from '../../fixtures/google/month-page-2.json';
import empty from '../../fixtures/google/empty-success.json';
import calendarsFixture from '../../fixtures/google/calendars.json';
import cancelled from '../../fixtures/google/cancelled-item.json';
import { CalendarStore, type CalendarRow } from '../../src/server/storage/db';
import { GoogleCalendarHttpApi, normalizeEvents, SyncError, MAX_EVENTS_PER_MONTH, type AccessTokenSource } from '../../src/server/google/client';
import { FileTokenStore, RefreshingAccessToken, secretsDir, tokensPath, SCOPES } from '../../src/server/auth/tokens';
import { authorizationUrl, createPkce, exchangeCode, waitForCallback } from '../../src/server/auth/oauth';
import { dueJobs, refreshCalendars, syncMonth, backoffMs, RetrySchedule } from '../../src/worker/sync';
import { acquireLock } from '../../src/worker/lock';
import { apiPost, apiResponse, googleMonth } from '../../src/server/api';
import { eventsForDay, withinNavigationLimit } from '../../src/domain/calendar';
import { SCHEMA_VERSION } from '../../src/server/storage/db';

const zone = 'Asia/Tokyo';
const clock = { now: () => new Date('2026-10-03T14:20:00+09:00') };
const cal: CalendarRow = { id: 'demo-primary@example.invalid', name: 'デモ・日常', color: '#547ca7', accessRole: 'owner', googleSelected: true, primary: true };
const token: AccessTokenSource = { token: async () => 'test-access', invalidate: vi.fn() };
type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>;
/** Fake fetch that fails the test if anything but GET reaches the Calendar API. */
function fakeFetch(handler: Handler) {
 const calls: URL[] = [];
 const fn = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input));
  expect(init?.method ?? 'GET').toBe('GET');
  expect(url.host).toBe('www.googleapis.com');
  calls.push(url);
  return handler(url, init);
 }) as typeof fetch;
 return { fn, calls };
}
const json = (body: unknown, status = 200) => Response.json(body, { status });
const pages: Handler = url => json(url.searchParams.get('pageToken') === 'fixture-page-2' ? page2 : page1);

let dir: string;
let store: CalendarStore;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pi-cal-')); store = CalendarStore.open(dir); store.replaceCalendars([cal], clock.now()); store.setAuthState('ok'); });
afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe('normalization', () => {
 const events = normalizeEvents([...page1.items, ...page2.items, cancelled, page1.items[0]], cal);
 it('drops cancelled instances and duplicate ids', () => { expect(events.map(e => e.id)).not.toContain('demo-recurring-cancel'); expect(events).toHaveLength(7); });
 it('keeps all-day dates as date strings with exclusive end', () => { const e = events.find(e => e.id === 'demo-allday')!; expect(e).toMatchObject({ kind: 'allDay', start: '2026-10-03', end: '2026-10-04' }); expect(eventsForDay([{ ...e, calendarName: '', color: '' }], '2026-10-04', zone)).toHaveLength(0); });
 it('keeps original offsets and recurring instance ids', () => { expect(events.find(e => e.id === 'demo-foreign')!.start).toBe('2026-10-03T09:00:00-07:00'); expect(events.find(e => e.id === 'demo-recurring-20261003')!.recurringEventId).toBe('demo-series'); });
 it('labels untitled and free/busy events', () => {
  expect(events.find(e => e.id === 'demo-empty')!.title).toBe('（件名なし）');
  expect(normalizeEvents([{ id: 'x', start: { dateTime: '2026-10-03T10:00:00+09:00' }, end: { dateTime: '2026-10-03T11:00:00+09:00' } }], { ...cal, accessRole: 'freeBusyReader' })[0].title).toBe('予定あり');
 });
 it('repairs missing end and skips malformed times', () => {
  const out = normalizeEvents([{ id: 'a', start: { date: '2026-10-05' } }, { id: 'b', start: { dateTime: '2026-10-05T10:00:00' }, end: { dateTime: '2026-10-05T11:00:00' } }], cal);
  expect(out).toEqual([expect.objectContaining({ id: 'a', end: '2026-10-06' })]);
 });
});

describe('month snapshot sync', () => {
 it('fetches every page with singleEvents and no syncToken, then stores the month', async () => {
  const f = fakeFetch(pages);
  expect(await syncMonth(new GoogleCalendarHttpApi(token, f.fn), store, cal, '2026-10', zone, clock)).toBe('ok');
  expect(f.calls).toHaveLength(2);
  const p = f.calls[0].searchParams;
  expect(p.get('singleEvents')).toBe('true');
  expect(p.get('showDeleted')).toBe('false');
  expect(p.get('timeMin')).toBe('2026-10-01T00:00:00.000+09:00');
  expect(p.get('timeMax')).toBe('2026-11-01T00:00:00.000+09:00');
  expect(p.has('syncToken')).toBe(false);
  const snap = googleMonth(store, '2026-10', zone, clock);
  expect(snap.events).toHaveLength(7);
  expect(snap.complete).toBe(true);
  expect(snap.events[0]).toMatchObject({ calendarName: 'デモ・日常', color: '#547ca7' });
 });
 it('keeps the previous snapshot when a later page fails', async () => {
  await syncMonth(new GoogleCalendarHttpApi(token, fakeFetch(pages).fn), store, cal, '2026-10', zone, clock);
  const failing = fakeFetch(url => url.searchParams.get('pageToken') ? json({ error: { code: 503 } }, 503) : json({ ...page1, items: [] , nextPageToken: 'fixture-page-2' }));
  expect(await syncMonth(new GoogleCalendarHttpApi(token, failing.fn), store, cal, '2026-10', zone, clock, () => 0.5)).toBe('server');
  expect(store.readMonth(cal.id, '2026-10', zone)!.events).toHaveLength(7);
  const status = store.syncStatus(cal.id, '2026-10', zone)!;
  expect(status).toMatchObject({ status: 'error', errorCode: 'server', failures: 1 });
  expect(Date.parse(status.retryAt!) - clock.now().getTime()).toBe(30_000);
  expect(googleMonth(store, '2026-10', zone, clock).state).toBe('partial_error');
 });
 it('treats a successful empty month as zero events, unlike a missing month', async () => {
  expect(googleMonth(store, '2026-12', zone, clock)).toMatchObject({ complete: false, available: false });
  await syncMonth(new GoogleCalendarHttpApi(token, fakeFetch(() => json(empty)).fn), store, cal, '2026-12', zone, clock);
  expect(googleMonth(store, '2026-12', zone, clock)).toMatchObject({ complete: true, available: true, events: [] });
 });
 it('deletions disappear on the next complete replacement', async () => {
  await syncMonth(new GoogleCalendarHttpApi(token, fakeFetch(pages).fn), store, cal, '2026-10', zone, clock);
  await syncMonth(new GoogleCalendarHttpApi(token, fakeFetch(() => json(page2)).fn), store, cal, '2026-10', zone, clock);
  expect(store.readMonth(cal.id, '2026-10', zone)!.events.map(e => e.id)).not.toContain('demo-allday');
 });
 it('maps 401 to auth_required after one token refresh, keeping cached data', async () => {
  await syncMonth(new GoogleCalendarHttpApi(token, fakeFetch(pages).fn), store, cal, '2026-10', zone, clock);
  const invalidate = vi.fn();
  const f = fakeFetch(() => json({ error: { code: 401 } }, 401));
  expect(await syncMonth(new GoogleCalendarHttpApi({ token: async () => 't', invalidate }, f.fn), store, cal, '2026-10', zone, clock)).toBe('auth');
  expect(invalidate).toHaveBeenCalledOnce();
  expect(f.calls).toHaveLength(2);
  expect(store.authState()).toBe('auth_required');
  expect(googleMonth(store, '2026-10', zone, clock)).toMatchObject({ state: 'auth_required', available: true });
  expect(googleMonth(store, '2026-10', zone, clock).events).toHaveLength(7);
 });
 it.each([
  [{ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 403, 'rate_limited'],
  [{ error: { errors: [{ reason: 'forbidden' }] } }, 403, 'forbidden'],
  [{}, 429, 'rate_limited'], [{}, 404, 'not_found'], [{}, 500, 'server'],
 ])('classifies %j HTTP %i as %s', async (body, status, code) => {
  expect(await syncMonth(new GoogleCalendarHttpApi(token, fakeFetch(() => json(body, status)).fn), store, cal, '2026-10', zone, clock)).toBe(code);
 });
 it('classifies network failure as offline and never stores raw messages', async () => {
  const f = (async () => { throw new TypeError('fetch failed: secret-host'); }) as typeof fetch;
  expect(await syncMonth(new GoogleCalendarHttpApi(token, f), store, cal, '2026-10', zone, clock)).toBe('network');
  expect(googleMonth(store, '2026-10', zone, clock).state).toBe('offline');
  expect(JSON.stringify(store.syncStatus(cal.id, '2026-10', zone))).not.toContain('secret-host');
 });
 it('refuses to store an oversized month', async () => {
  const many = Array.from({ length: MAX_EVENTS_PER_MONTH / 2 + 1 }, (_, i) => ({ id: `e${i}`, start: { date: '2026-10-01' }, end: { date: '2026-10-02' } }));
  const f = fakeFetch(url => json({ items: many, nextPageToken: url.searchParams.get('pageToken') ? undefined : 'p2' }));
  expect(await syncMonth(new GoogleCalendarHttpApi(token, f.fn), store, cal, '2026-10', zone, clock)).toBe('too_many');
  expect(store.readMonth(cal.id, '2026-10', zone)).toBeNull();
 });
 it('discards a result fetched under an older calendar selection', async () => {
  const f = fakeFetch(url => { store.setSelection([cal.id]); return pages(url); });
  expect(await syncMonth(new GoogleCalendarHttpApi(token, f.fn), store, cal, '2026-10', zone, clock)).toBe('discarded');
  expect(store.readMonth(cal.id, '2026-10', zone)).toBeNull();
 });
 it('calendar list follows Google selection and drops removed calendars', async () => {
  await syncMonth(new GoogleCalendarHttpApi(token, fakeFetch(pages).fn), store, cal, '2026-10', zone, clock);
  const list = fakeFetch(() => json({ items: calendarsFixture.items.slice(1).map(c => ({ ...c, selected: true })) }));
  expect(await refreshCalendars(new GoogleCalendarHttpApi(token, list.fn), store, clock)).toBe('ok');
  expect(store.selectedCalendars().map(c => c.id)).toEqual(['demo-shared@example.invalid']);
  expect(store.readMonth(cal.id, '2026-10', zone)).toBeNull();
 });
});

describe('scheduling', () => {
 it('current month first; respects retry and intervals', async () => {
  const jobs = dueJobs(store, clock, zone);
  expect(jobs.map(j => j.month)).toEqual(['2026-10', '2026-09', '2026-11', '2026-12']);
  await syncMonth(new GoogleCalendarHttpApi(token, fakeFetch(pages).fn), store, cal, '2026-10', zone, clock);
  const later = { now: () => new Date(clock.now().getTime() + 30_000) };
  expect(dueJobs(store, later, zone).map(j => j.month)).not.toContain('2026-10');
  expect(dueJobs(store, { now: () => new Date(clock.now().getTime() + 61_000) }, zone).map(j => j.month)).toContain('2026-10');
  expect(dueJobs(store, later, zone, true).map(j => j.month)).toContain('2026-10');
 });
 it('includes requested months and backs off with a cap', () => {
  store.requestMonth('2027-03', new Date(clock.now().getTime() + 3600_000));
  expect(dueJobs(store, clock, zone).map(j => j.month)).toContain('2027-03');
  expect(backoffMs(1, () => 0.5)).toBe(30_000);
  expect(backoffMs(20, () => 0.5)).toBe(15 * 60_000);
 });
 it('replaces a lock left by a dead process', () => {
  mkdirSync(join(dir, 'locks'), { recursive: true });
  writeFileSync(join(dir, 'locks', 'worker.lock'), '999999999');
  acquireLock(dir)();
 });
});

describe('review fixes', () => {
 it('lock: own PID, another boot, or dead PID is stale; a live PID (legacy or same boot) blocks', () => {
  const lockFile = join(dir, 'locks', 'worker.lock');
  mkdirSync(join(dir, 'locks'), { recursive: true });
  writeFileSync(lockFile, `${process.pid} boot-a`); acquireLock(dir, 'boot-a')();
  writeFileSync(lockFile, `${process.ppid} boot-old`); acquireLock(dir, 'boot-new')();
  writeFileSync(lockFile, `${process.ppid} boot-a`); expect(() => acquireLock(dir, 'boot-a')).toThrow('Another sync worker');
  writeFileSync(lockFile, `${process.ppid}`); expect(() => acquireLock(dir, 'boot-a')).toThrow('Another sync worker');
 });
 it('manual sync bypasses backoff', async () => {
  for (const m of ['2026-09', '2026-10', '2026-11', '2026-12']) store.recordFailure(cal.id, m, zone, 'network', clock.now(), new Date(clock.now().getTime() + 15 * 60_000));
  expect(dueJobs(store, clock, zone)).toHaveLength(0);
  expect(dueJobs(store, clock, zone, true)).toHaveLength(4);
 });
 it('calendar list refresh backs off on failure and waits the interval on success', () => {
  const r = new RetrySchedule(6 * 3600_000, () => 0.5);
  expect(r.due(0)).toBe(true);
  r.failure(0); expect(r.due(29_000)).toBe(false); expect(r.due(30_000)).toBe(true);
  r.failure(30_000); expect(r.due(89_000)).toBe(false); expect(r.due(90_000)).toBe(true);
  r.success(90_000); expect(r.due(90_000 + 3600_000)).toBe(false);
  r.reset(); expect(r.due(0)).toBe(true);
 });
 it('a corrupt tokens.json means re-authentication, not offline', async () => {
  mkdirSync(secretsDir(dir), { recursive: true });
  writeFileSync(tokensPath(dir), '{"refresh_tok');
  const fetchSpy = vi.fn();
  const api = new GoogleCalendarHttpApi(new RefreshingAccessToken({ clientId: 'c', clientSecret: 's' }, new FileTokenStore(dir), fetchSpy as unknown as typeof fetch));
  expect(await syncMonth(api, store, cal, '2026-10', zone, clock)).toBe('auth');
  expect(store.authState()).toBe('auth_required');
  expect(fetchSpy).not.toHaveBeenCalled();
 });
 it('concurrent jobs share one access-token refresh', async () => {
  const ts = new FileTokenStore(dir);
  ts.write({ refresh_token: 'r1', scope: '', obtained_at: 'x' });
  let calls = 0;
  const f = (async () => { calls++; await new Promise(r => setTimeout(r, 10)); return json({ access_token: 'a', expires_in: 3600 }); }) as typeof fetch;
  const src = new RefreshingAccessToken({ clientId: 'c', clientSecret: 's' }, ts, f);
  expect(await Promise.all([src.token(), src.token(), src.token()])).toEqual(['a', 'a', 'a']);
  expect(calls).toBe(1);
 });
 it('navigation limit is ±12 months and shared by UI and API', () => {
  expect(withinNavigationLimit('2027-10', clock, zone)).toBe(true);
  expect(withinNavigationLimit('2027-11', clock, zone)).toBe(false);
  expect(withinNavigationLimit('2025-09', clock, zone)).toBe(false);
 });
 it('expired month interest is ignored, then pruned with its cached month', async () => {
  store.requestMonth('2027-05', new Date(clock.now().getTime() + 1000));
  await syncMonth(new GoogleCalendarHttpApi(token, fakeFetch(() => json(empty)).fn), store, cal, '2027-05', zone, clock);
  const later = new Date(clock.now().getTime() + 2000);
  expect(store.interestedMonths(clock.now())).toEqual(['2027-05']);
  expect(store.interestedMonths(later)).toEqual([]);
  store.pruneMonths(['2026-10'], zone, later);
  expect(store.readMonth(cal.id, '2027-05', zone)).toBeNull();
 });
});

describe('tokens and OAuth', () => {
 const client = { clientId: 'cid', clientSecret: 'csecret' };
 it('writes tokens atomically with 0600 file in 0700 directory', () => {
  const ts = new FileTokenStore(dir);
  ts.write({ refresh_token: 'r1', scope: SCOPES.join(' '), obtained_at: 'x' });
  expect(statSync(tokensPath(dir)).mode & 0o777).toBe(0o600);
  expect(statSync(secretsDir(dir)).mode & 0o777).toBe(0o700);
  expect(statSync(join(dir, 'calendar.sqlite')).mode & 0o777).toBe(0o600);
  expect(ts.read()!.refresh_token).toBe('r1');
 });
 it('keeps the refresh token when Google omits it, replaces it when rotated, and maps invalid_grant to auth', async () => {
  const ts = new FileTokenStore(dir);
  ts.write({ refresh_token: 'r1', scope: '', obtained_at: 'x' });
  let reply: unknown = { access_token: 'a1', expires_in: 3600 }, status = 200;
  const f = (async (_u: unknown, init?: RequestInit) => { expect(String(init?.body)).toContain('grant_type=refresh_token'); return json(reply, status); }) as typeof fetch;
  const src = new RefreshingAccessToken(client, ts, f);
  expect(await src.token()).toBe('a1');
  expect(ts.read()!.refresh_token).toBe('r1');
  src.invalidate(); reply = { access_token: 'a2', refresh_token: 'r2' };
  expect(await src.token()).toBe('a2');
  expect(ts.read()!.refresh_token).toBe('r2');
  src.invalidate(); reply = { error: 'invalid_grant' }; status = 400;
  await expect(src.token()).rejects.toEqual(new SyncError('auth'));
  expect(ts.read()!.refresh_token).toBe('r2');
 });
 it('builds a read-only PKCE S256 authorization URL', () => {
  const pkce = createPkce();
  expect(pkce.challenge).toBe(createHash('sha256').update(pkce.verifier).digest('base64url'));
  const url = new URL(authorizationUrl(client, 'http://127.0.0.1:42813', pkce));
  expect(url.searchParams.get('scope')!.split(' ')).toEqual([...SCOPES]);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('state')).toBe(pkce.state);
  expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:42813');
 });
 it('loopback ignores wrong state/path and accepts the matching callback once', async () => {
  const port = 42000 + Math.floor(Math.random() * 1000);
  const waiting = waitForCallback(port, 'good-state', 5000);
  await new Promise(r => setTimeout(r, 50));
  expect((await fetch(`http://127.0.0.1:${port}/?code=c&state=bad`)).status).toBe(400);
  expect((await fetch(`http://127.0.0.1:${port}/favicon.ico?state=good-state`)).status).toBe(400);
  expect((await fetch(`http://127.0.0.1:${port}/?code=the-code&state=good-state`)).status).toBe(200);
  expect(await waiting).toEqual({ code: 'the-code' });
  const denied = waitForCallback(port, 's2', 5000);
  await new Promise(r => setTimeout(r, 50));
  await fetch(`http://127.0.0.1:${port}/?error=access_denied&state=s2`);
  expect(await denied).toEqual({ error: 'denied' });
 });
 it('fails clearly when the callback port is busy, and times out', async () => {
  const blocker = createServer().listen(0, '127.0.0.1');
  await new Promise(r => blocker.once('listening', r));
  const port = (blocker.address() as { port: number }).port;
  await expect(waitForCallback(port, 's')).rejects.toThrow('already in use');
  blocker.close();
  expect(await waitForCallback(port, 's', 20)).toEqual({ error: 'timeout' });
 });
 it('token exchange sends the verifier and rejects missing refresh tokens or extra scopes', async () => {
  const reply = (body: unknown) => (async (_u: unknown, init?: RequestInit) => { expect(String(init?.body)).toContain('code_verifier=v'); return json(body); }) as typeof fetch;
  const ok = await exchangeCode(client, 'c', 'v', 'http://127.0.0.1:1', clock.now(), reply({ refresh_token: 'r', scope: SCOPES.join(' ') }));
  expect(ok.refresh_token).toBe('r');
  await expect(exchangeCode(client, 'c', 'v', 'r', clock.now(), reply({ scope: SCOPES.join(' ') }))).rejects.toThrow('refresh token');
  await expect(exchangeCode(client, 'c', 'v', 'r', clock.now(), reply({ refresh_token: 'r', scope: `${SCOPES.join(' ')} https://www.googleapis.com/auth/calendar` }))).rejects.toThrow('unexpected extra scopes');
 });
});

describe('google-mode API', () => {
 beforeEach(() => { vi.stubEnv('CALENDAR_MODE', 'google'); vi.stubEnv('CALENDAR_STATE_DIR', dir); vi.stubEnv('CALENDAR_PORT', '3100'); vi.stubEnv('CALENDAR_MOCK_NOW', ''); });
 const post = (path: string, body: unknown, headers: Record<string, string> = { origin: 'http://127.0.0.1:3100', 'content-type': 'application/json' }) =>
  apiPost(new Request(`http://127.0.0.1:3100/api/${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), path);
 it('serves cached events with no-store and reports not_configured before auth', async () => {
  const res = apiResponse(new Request('http://127.0.0.1:3100/api/events?month=2026-10'), 'events');
  expect(res.headers.get('Cache-Control')).toBe('no-store');
  store.setAuthState('not_configured');
  expect(await apiResponse(new Request('http://127.0.0.1:3100/api/events?month=2026-10'), 'events').json()).toMatchObject({ state: 'not_configured', complete: false, synthetic: false });
  expect(await apiResponse(new Request('http://127.0.0.1:3100/api/health/ready'), 'health/ready').json()).toMatchObject({ status: 'ok', mode: 'google', storage: 'sqlite', googleConfigured: false });
 });
 it('POST requires an allowed Origin and JSON, and limits the month range', async () => {
  expect((await post('sync/request', {}, { origin: 'http://evil.example', 'content-type': 'application/json' })).status).toBe(403);
  expect((await post('sync/request', {}, { origin: 'http://127.0.0.1:3100', 'content-type': 'text/plain' })).status).toBe(415);
  expect((await post('cache/request-month', { month: '2099-01' })).status).toBe(400);
  const month = new Date().toISOString().slice(0, 7);
  expect((await post('cache/request-month', { month })).status).toBe(200);
  expect((await post('sync/request', {})).status).toBe(200);
 });
 it('version reports the storage schema constant', async () => {
  expect((await apiResponse(new Request('http://127.0.0.1:3100/api/version'), 'version').json()).schemaVersion).toBe(SCHEMA_VERSION);
 });
});
