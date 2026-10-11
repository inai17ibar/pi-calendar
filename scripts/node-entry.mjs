// Runs the bundled worker or CLI with the same state-directory rules as the web helper.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const [name, ...args] = process.argv.slice(2);
if (!['worker', 'cli'].includes(name)) throw new Error('Use worker or cli.');
const state = resolve(process.env.CALENDAR_STATE_DIR ?? '.local/dev');
if (state === '/var/lib/pi-calendar' || state.startsWith('/var/lib/pi-calendar/')) throw new Error('Development must not use production state.');
mkdirSync(state, { recursive: true, mode: 0o700 });
const entry = resolve(`dist/${name}.mjs`);
if (!existsSync(entry)) throw new Error('Build first with npm run build.');
const child = spawn(process.execPath, [entry, ...args], { stdio: 'inherit', env: { ...process.env, CALENDAR_MODE: name === 'worker' ? 'google' : process.env.CALENDAR_MODE ?? 'google', CALENDAR_STATE_DIR: state } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 1));
