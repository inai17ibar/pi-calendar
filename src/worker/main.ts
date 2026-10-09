import { systemClock } from '../domain/calendar';
import { loadConfig } from '../server/config';
import { GoogleCalendarHttpApi } from '../server/google/client';
import { FileTokenStore, loadClient, RefreshingAccessToken } from '../server/auth/tokens';
import { CalendarStore } from '../server/storage/db';
import { acquireLock } from './lock';
import { baseMonths, CALENDAR_LIST_INTERVAL_MS, dueJobs, refreshCalendars, RetrySchedule, runJobs, syncMonth } from './sync';

const TICK_MS = 5_000;
// Independent of the sync loop, so a slow network round does not make the web think the worker died.
const HEARTBEAT_MS = 15_000;
const log = (event: string, fields: Record<string, string | number> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));

async function main() {
 const config = loadConfig();
 if (config.mode !== 'google') throw new Error('The sync worker runs only with CALENDAR_MODE=google.');
 const once = process.argv.includes('--once');
 const release = acquireLock(config.stateDir);
 const store = CalendarStore.open(config.stateDir);
 const tokens = new FileTokenStore(config.stateDir);
 let stopping = false;
 const shutdown = () => { stopping = true; };
 process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
 log('worker_start', { pid: process.pid, once: once ? 1 : 0 });

 let api: GoogleCalendarHttpApi | null = null;
 let tokenVersion = -1;
 const calendarRefresh = new RetrySchedule(CALENDAR_LIST_INTERVAL_MS);
 const beat = () => { try { store.setMeta('worker_heartbeat', new Date().toISOString()); } catch { /* DB busy; next beat retries */ } };
 beat();
 const heartbeat = setInterval(beat, HEARTBEAT_MS);
 let lastManual = store.getMeta('manual_sync_requested_at');
 try {
  while (!stopping) {
   // (Re)build the Google client when credentials appear or the CLI re-authenticates.
   if (tokens.version() !== tokenVersion) {
    tokenVersion = tokens.version();
    api = null;
    if (tokenVersion) {
     try { api = new GoogleCalendarHttpApi(new RefreshingAccessToken(loadClient(config.stateDir), tokens)); store.setAuthState('ok'); calendarRefresh.reset(); log('credentials_loaded'); }
     catch { store.setAuthState('not_configured'); log('client_config_invalid'); }
    } else store.setAuthState('not_configured');
   }
   if (api && store.authState() === 'ok') {
    const manual = store.getMeta('manual_sync_requested_at');
    const force = manual !== lastManual;
    lastManual = manual;
    const now = Date.now();
    if (force || calendarRefresh.due(now)) {
     const outcome = await refreshCalendars(api, store, systemClock);
     if (outcome === 'ok') calendarRefresh.success(Date.now()); else calendarRefresh.failure(Date.now());
     log('calendars', { outcome, count: store.calendars().length });
    }
    if (store.authState() === 'ok') {
     const jobs = dueJobs(store, systemClock, config.timezone, force);
     if (jobs.length) {
      const started = Date.now();
      const results = await runJobs(jobs, 2, j => syncMonth(api!, store, j.calendar, j.month, config.timezone, systemClock));
      const summary: Record<string, number> = {};
      for (const r of results) summary[r] = (summary[r] ?? 0) + 1;
      log('sync', { jobs: jobs.length, ms: Date.now() - started, ...summary });
     }
     store.pruneMonths([...new Set([...baseMonths(systemClock, config.timezone), ...store.interestedMonths(systemClock.now())])], config.timezone, systemClock.now());
    }
    if (store.authState() === 'auth_required') log('auth_required');
   }
   if (once) break;
   for (let waited = 0; waited < TICK_MS && !stopping; waited += 500) await new Promise(r => setTimeout(r, 500));
  }
 } finally {
  clearInterval(heartbeat);
  store.close();
  release();
  log('worker_stop');
 }
}

main().catch(e => { console.error(JSON.stringify({ t: new Date().toISOString(), event: 'worker_fatal', message: e instanceof Error ? e.message : 'unknown' })); process.exit(1); });
