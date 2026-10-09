import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const kiosk = join(root, 'ops/kiosk/install-kiosk.sh');
let home: string;
// Hermetic env: temp HOME, no GUI session variables from the developer's desktop.
const env = () => ({ PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home }) as unknown as NodeJS.ProcessEnv;
const runKiosk = (...args: string[]) => execFileSync('bash', [kiosk, ...args], { env: env(), encoding: 'utf8' });
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'pi-cal-home-')); });
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('kiosk installer', () => {
 it('dry run changes nothing', () => {
  const out = runKiosk();
  expect(out).toContain('DRY RUN');
  expect(existsSync(join(home, '.local/bin/pi-calendar-kiosk'))).toBe(false);
  expect(existsSync(join(home, '.config/labwc/autostart'))).toBe(false);
 });
 it('appends once, keeps existing autostart lines with a backup, and uninstalls cleanly', () => {
  mkdirSync(join(home, '.config/labwc'), { recursive: true });
  const autostart = join(home, '.config/labwc/autostart');
  writeFileSync(autostart, 'existing-app &\n');
  runKiosk('--apply');
  runKiosk('--apply');
  const lines = readFileSync(autostart, 'utf8').trim().split('\n');
  expect(lines).toEqual(['existing-app &', '"$HOME/.local/bin/pi-calendar-kiosk" &']);
  expect(statSync(join(home, '.local/bin/pi-calendar-kiosk')).mode & 0o111).toBeTruthy();
  expect(readdirSync(join(home, '.config/labwc')).filter(f => f.startsWith('autostart.bak.')).length).toBeGreaterThan(0);
  runKiosk('--uninstall', '--apply');
  expect(readFileSync(autostart, 'utf8')).toBe('existing-app &\n');
  expect(existsSync(join(home, '.local/bin/pi-calendar-kiosk'))).toBe(false);
 });
 it('supervisor refuses to start outside a graphical session', () => {
  const r = spawnSync('bash', [join(root, 'ops/kiosk/kiosk-supervisor.sh')], { env: env(), encoding: 'utf8' });
  expect(r.status).toBe(1);
  expect(r.stderr).toContain('graphical session');
 });
 it('supervisor keeps Chromium security defaults', () => {
  const s = readFileSync(join(root, 'ops/kiosk/kiosk-supervisor.sh'), 'utf8');
  for (const flag of ['--no-sandbox', '--ignore-certificate-errors', '--disable-web-security']) expect(s).not.toContain(flag);
  expect(s).toContain('--kiosk');
 });
});

describe('systemd units', () => {
 it.each(['pi-calendar-web', 'pi-calendar-sync'])('%s renders to a hardened non-root unit', name => {
  const rendered = readFileSync(join(root, `ops/systemd/${name}.service.in`), 'utf8').replaceAll('@NODE_BIN@', '/opt/pi-calendar/node-v24.21.0/bin/node');
  expect(rendered).not.toContain('@');
  for (const line of ['User=calendar-app', 'ProtectHome=true', 'ProtectSystem=strict', 'NoNewPrivileges=true', 'ReadWritePaths=/var/lib/pi-calendar', 'Restart=on-failure'])
   expect(rendered).toContain(line);
  // Web/worker readiness must not wait for the network (offline boot shows the cache).
  expect(rendered).not.toContain('network-online.target');
 });
 it('web unit pins the loopback bind after the env file', () => {
  const web = readFileSync(join(root, 'ops/systemd/pi-calendar-web.service.in'), 'utf8');
  expect(web.indexOf('Environment=HOSTNAME=127.0.0.1')).toBeGreaterThan(web.indexOf('EnvironmentFile='));
 });
});

describe('production installer', () => {
 it('is a dry run unless --apply, and refuses --apply without root', () => {
  const help = execFileSync('bash', [join(root, 'ops/install/install-production.sh'), '--help'], { encoding: 'utf8' });
  expect(help).toContain('--apply');
  if (process.getuid?.() !== 0) {
   const r = spawnSync('bash', [join(root, 'ops/install/install-production.sh'), '--apply'], { encoding: 'utf8' });
   expect(r.status).not.toBe(0);
  }
 });
});
