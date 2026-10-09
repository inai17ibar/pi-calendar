import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../server/config';
import { authorizationUrl, createPkce, exchangeCode, waitForCallback } from '../server/auth/oauth';
import { clientPath, FileTokenStore, loadClient } from '../server/auth/tokens';
import { CalendarStore } from '../server/storage/db';

const usage = `Usage (CALENDAR_STATE_DIR selects the state directory, default .local/dev):
  auth google [--port 42813]        Desktop OAuth (PKCE) via a loopback callback on 127.0.0.1
  calendars list                    Show calendars known to the worker and which are displayed
  calendars select <id> [<id>...]   Display only these calendars
  calendars select --google         Display the calendars checked in Google Calendar (default)
  status                            Auth/worker/sync summary (no event contents)`;

function option(args: string[], name: string, fallback: string) {
 const i = args.indexOf(name);
 return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

async function authGoogle(stateDir: string, args: string[]) {
 const port = Number(option(args, '--port', '42813'));
 if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be 1024-65535.');
 if (!existsSync(clientPath(stateDir))) throw new Error(`Place the Google "Desktop app" OAuth client JSON at ${clientPath(stateDir)} (chmod 600) and run again.`);
 const client = loadClient(stateDir);
 if (existsSync(join(stateDir, 'locks', 'worker.lock'))) console.warn('Note: a sync worker appears to be running. It will pick up the new token automatically.');
 const redirectUri = `http://127.0.0.1:${port}`;
 const pkce = createPkce();
 const waiting = waitForCallback(port, pkce.state);
 // The URL contains no secret beyond the one-time state; print it only to this terminal.
 console.log(`\nOpen this URL in a browser on this Pi, or on a Mac with "ssh -L 127.0.0.1:${port}:127.0.0.1:${port} <pi>" active:\n\n${authorizationUrl(client, redirectUri, pkce)}\n\nWaiting up to 10 minutes for Google to redirect to ${redirectUri} ...`);
 const result = await waiting;
 if ('error' in result) throw new Error(result.error === 'timeout' ? 'Timed out. Existing tokens (if any) were left unchanged.' : 'Authorization was cancelled. Existing tokens (if any) were left unchanged.');
 const tokens = await exchangeCode(client, result.code, pkce.verifier, redirectUri, new Date());
 new FileTokenStore(stateDir).write(tokens);
 const store = CalendarStore.open(stateDir);
 store.setAuthState('ok');
 store.close();
 console.log('Saved a read-only refresh token (mode 0600). Start or keep running the sync worker: npm run worker');
}

async function main() {
 const args = process.argv.slice(2);
 const config = loadConfig({ ...process.env, CALENDAR_MODE: 'google' });
 const [command, sub] = args;
 if (command === 'auth' && sub === 'google') return authGoogle(config.stateDir, args.slice(2));
 const store = CalendarStore.open(config.stateDir);
 try {
  if (command === 'calendars' && sub === 'list') {
   const selected = new Set(store.selectedCalendars().map(c => c.id));
   const rows = store.calendars();
   if (!rows.length) console.log('No calendars yet. Authenticate, then let the worker run once (npm run worker -- --once).');
   for (const c of rows) console.log(`${selected.has(c.id) ? '[x]' : '[ ]'} ${c.name}\t${c.id}${c.primary ? '\t(primary)' : ''}`);
   console.log(store.explicitSelection() ? '\nSelection: explicit (calendars select)' : '\nSelection: follows the calendars checked in Google Calendar');
  } else if (command === 'calendars' && sub === 'select') {
   const ids = args.slice(2);
   if (ids[0] === '--google') store.setSelection(null);
   else {
    const known = new Set(store.calendars().map(c => c.id));
    const unknown = ids.filter(id => !known.has(id));
    if (!ids.length || unknown.length) throw new Error(`Unknown or missing calendar id(s). Run "calendars list" first.`);
    store.setSelection(ids);
   }
   console.log('Saved. The worker refreshes the displayed calendars on its next cycle.');
  } else if (command === 'status') {
   const hb = store.heartbeat();
   console.log(JSON.stringify({ schemaVersion: store.schemaVersion(), auth: store.authState(), tokenPresent: new FileTokenStore(config.stateDir).version() > 0, workerHeartbeat: hb, calendars: store.calendars().length, selected: store.selectedCalendars().length }, null, 1));
  } else { console.log(usage); process.exitCode = command ? 2 : 0; }
 } finally { store.close(); }
}

main().catch(e => { console.error(e instanceof Error ? e.message : 'Failed.'); process.exit(1); });
