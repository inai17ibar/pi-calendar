import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const kiosk = join(root, 'ops/kiosk/install-kiosk.sh');
let home: string;
// Hermetic env: temp HOME, no GUI session variables from the developer's desktop.
const env = () => ({ PATH: `${join(home, 'host-bin')}:${process.env.PATH ?? '/usr/bin:/bin'}`, HOME: home }) as unknown as NodeJS.ProcessEnv;
const runKiosk = (...args: string[]) => execFileSync('bash', [kiosk, ...args], { env: env(), encoding: 'utf8' });
beforeEach(() => {
 home = mkdtempSync(join(tmpdir(), 'pi-cal-home-'));
 // Model the GUI user even when the test runner is root in a container.
 const bin = join(home, 'host-bin');
 mkdirSync(bin);
 writeFileSync(join(bin, 'id'), '#!/bin/sh\n[ "$1" = "-u" ] && { echo 1000; exit 0; }; exit 1\n');
 chmodSync(join(bin, 'id'), 0o755);
});
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

// Exercise the real preflight in a disposable Git repository. Command stubs
// allow host-independent checks and fail closed if --apply reaches a mutation.
describe('production installer working tree preflight', () => {
 let source: string;
 let testEnv: NodeJS.ProcessEnv;
 beforeEach(() => {
  source = join(home, 'source');
  const bin = join(home, 'bin');
  mkdirSync(join(source, 'ops/install'), { recursive: true });
  mkdirSync(bin);
  copyFileSync(join(root, 'ops/install/install-production.sh'), join(source, 'ops/install/install-production.sh'));
  mkdirSync(join(source, 'ops/systemd'), { recursive: true });
  for (const name of ['pi-calendar-web', 'pi-calendar-sync'])
   copyFileSync(join(root, `ops/systemd/${name}.service.in`), join(source, `ops/systemd/${name}.service.in`));
  writeFileSync(join(source, '.gitignore'), 'dist/\n');
  writeFileSync(join(source, 'tracked.ts'), 'export const value = 1;\n');
  testEnv = { ...env(), PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...args: string[]) => execFileSync('git', ['-C', source, ...args], { env: testEnv });
  git('init', '-b', 'main');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  for (const name of ['web/server.js', 'worker.mjs', 'cli.mjs']) {
   const path = join(source, 'dist', name);
   mkdirSync(resolve(path, '..'), { recursive: true });
   writeFileSync(path, '');
  }
  const stub = (name: string, script: string) => {
   const path = join(bin, name);
   writeFileSync(path, `#!/bin/sh\n${script}\n`);
   chmodSync(path, 0o755);
  };
  stub('uname', 'echo aarch64');
  stub('id', '[ "$1" = "-u" ] && { echo 0; exit 0; }; exit 1');
  for (const command of ['curl', 'install', 'useradd', 'tar', 'cp', 'chown', 'chmod', 'ln', 'mv', 'systemctl', 'mktemp'])
   stub(command, `echo 'Unexpected mutation: ${command}' >&2; exit 99`);
 });
 const run = (...args: string[]) => spawnSync('bash', [join(source, 'ops/install/install-production.sh'), ...args], { env: testEnv, encoding: 'utf8' });
 const dirty = (kind: string) => {
  if (kind === 'untracked') writeFileSync(join(source, 'new source.ts'), 'export {};\n');
  else {
   writeFileSync(join(source, 'tracked.ts'), 'export const value = 2;\n');
   if (kind === 'staged') execFileSync('git', ['-C', source, 'add', 'tracked.ts'], { env: testEnv });
  }
 };
 it.each(['unstaged', 'staged', 'untracked'])('refuses --apply for %s files before system changes', kind => {
  dirty(kind);
  const result = run('--apply');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('uncommitted or untracked changes');
  expect(result.stderr).not.toContain('Unexpected mutation');
  expect(result.stdout).not.toContain('1. Root-managed');
 });
 it.each(['unstaged', 'staged', 'untracked'])('preserves dry run with a warning for %s files', kind => {
  dirty(kind);
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('WARNING: uncommitted or untracked changes');
  expect(result.stdout).toContain('DRY RUN');
  expect(result.stdout).toContain('9. Verify');
  expect(result.stderr).not.toContain('Unexpected mutation');
 });
 it('refuses to apply when Git status cannot be inspected', () => {
  rmSync(join(source, '.git'), { recursive: true, force: true });
  const result = run('--apply');
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Cannot inspect Git working tree');
  expect(result.stderr).not.toContain('Unexpected mutation');
 });
 it('allows a clean dry run with ignored build outputs', () => {
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('DRY RUN');
  expect(result.stdout).not.toContain('WARNING:');
 });
});
