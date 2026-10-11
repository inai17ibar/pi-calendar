import { DateTime } from 'luxon';
import { loadConfig, configuredClock, type AppConfig } from './config';
import { MockCalendarProvider } from './mock';
import { eventsForDay, withinNavigationLimit, type Clock, type Snapshot, type SyncState } from '../domain/calendar';
import { CalendarStore, SCHEMA_VERSION } from './storage/db';
import { FileTokenStore } from './auth/tokens';
const headers = { 'Cache-Control':'no-store' };
const STALE_AFTER_MS = 5 * 60_000, WORKER_DEAD_MS = 2 * 60_000, INTEREST_TTL_MS = 24 * 3600_000;

let cached: { dir: string; store: CalendarStore } | null = null;
function store(config: AppConfig) {
 if (cached?.dir !== config.stateDir) { cached?.store.close(); cached = { dir: config.stateDir, store: CalendarStore.open(config.stateDir) }; }
 return cached.store;
}
const validHost = (request: Request) => /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(request.headers.get('host') ?? new URL(request.url).host);
const validMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m) && DateTime.fromISO(`${m}-01`).isValid;

/** Cached Google data for one month; never contacts Google. */
export function googleMonth(s: CalendarStore, month: string, timezone: string, clock: Clock): Snapshot {
 const auth = s.authState();
 const view = s.monthView(month, timezone);
 const fetched = view.calendars.filter(c => c.fetched).length;
 const complete = view.calendars.length > 0 && fetched === view.calendars.length;
 const heartbeat = s.heartbeat();
 const workerAlive = Boolean(heartbeat && clock.now().getTime() - Date.parse(heartbeat) < WORKER_DEAD_MS);
 const errors = view.statuses.filter(st => st.status === 'error');
 let state: SyncState;
 if (auth === 'auth_required') state = 'auth_required';
 else if (auth === 'not_configured' || view.calendars.length === 0) state = 'not_configured';
 else if (errors.some(e => e.errorCode === 'network')) state = 'offline';
 else if (errors.length) state = 'partial_error';
 else if (!complete) state = workerAlive ? 'syncing' : 'stale';
 else if (!workerAlive || !view.oldestFetchedAt || clock.now().getTime() - Date.parse(view.oldestFetchedAt) > STALE_AFTER_MS) state = 'stale';
 else state = 'fresh';
 return { events: view.events, complete, available: fetched > 0, fetchedAt: view.oldestFetchedAt, state, synthetic: false, calendars: view.calendars };
}

export function apiResponse(request: Request, path: string): Response {
 const url = new URL(request.url);
 if (!validHost(request)) return Response.json({error:'Forbidden host'}, { status:403,headers });
 try {
  const config = loadConfig();
  const clock = configuredClock(config.clock);
  const google = config.mode === 'google';
  if (path === 'health/live') return Response.json({status:'ok'}, { headers });
  if (path === 'health/ready') {
   if (!google) return Response.json({status:'ok',mode:'mock',storage:'memory',googleConfigured:false}, { headers });
   const s = store(config);
   return Response.json({status:'ok',mode:'google',storage:'sqlite',schemaVersion:s.schemaVersion(),googleConfigured:new FileTokenStore(config.stateDir).version() > 0}, { headers });
  }
  if (path === 'version') return Response.json({releaseId:google?'m2-google':'m1-mock',commit:null,builtAt:null,schemaVersion:SCHEMA_VERSION}, { headers });
  if (path === 'status') {
   if (!google) return Response.json({mode:'mock'}, { headers });
   const s = store(config);
   return Response.json({mode:'google',auth:s.authState(),workerHeartbeat:s.heartbeat(),calendars:s.selectedCalendars().length}, { headers });
  }
  if (path === 'events') {
   const day = url.searchParams.get('date');
   const month = url.searchParams.get('month') ?? day?.slice(0,7);
   if (!validMonth(month) || day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !DateTime.fromISO(day).isValid || day.slice(0,7)!==month)) return Response.json({error:'Use a valid month=YYYY-MM or date=YYYY-MM-DD'}, {status:400,headers});
   const snapshot = google ? googleMonth(store(config), month, config.timezone, clock) : new MockCalendarProvider().month(month,clock,config.timezone);
   if (day) snapshot.events = eventsForDay(snapshot.events,day,config.timezone);
   return Response.json(snapshot,{headers});
  }
  return Response.json({error:'Not found'},{status:404,headers});
 } catch { return Response.json({error:'Local configuration is not ready. Check calendar environment settings.'},{status:503,headers}); }
}

/** State-changing requests: Host + Origin allowlist + JSON only. They only queue work for the worker. */
export async function apiPost(request: Request, path: string): Promise<Response> {
 if (!validHost(request)) return Response.json({error:'Forbidden host'}, { status:403,headers });
 let config: AppConfig;
 try { config = loadConfig(); } catch { return Response.json({error:'Local configuration is not ready.'},{status:503,headers}); }
 if (!config.allowedOrigins.includes(request.headers.get('origin') ?? '')) return Response.json({error:'Forbidden origin'}, { status:403,headers });
 if (!/^application\/json(;|$)/.test(request.headers.get('content-type') ?? '')) return Response.json({error:'JSON required'}, { status:415,headers });
 const body = await request.json().catch(() => null) as Record<string, unknown> | null;
 if (config.mode !== 'google') return Response.json({accepted:false,mode:'mock'}, { headers });
 const clock = configuredClock(config.clock);
 try {
  const s = store(config);
  if (path === 'cache/request-month') {
   const month = body?.month;
   if (!validMonth(month) || !withinNavigationLimit(month, clock, config.timezone)) return Response.json({error:'Month outside the allowed range'}, { status:400,headers });
   s.requestMonth(month, new Date(clock.now().getTime() + INTEREST_TTL_MS));
   return Response.json({accepted:true}, { headers });
  }
  if (path === 'sync/request') {
   // Collapse repeated taps within 10 seconds.
   const last = s.getMeta('manual_sync_requested_at');
   if (!last || clock.now().getTime() - Date.parse(last) >= 10_000) s.setMeta('manual_sync_requested_at', clock.now().toISOString());
   return Response.json({accepted:true}, { headers });
  }
  return Response.json({error:'Not found'},{status:404,headers});
 } catch { return Response.json({error:'Local storage is not ready.'},{status:503,headers}); }
}
