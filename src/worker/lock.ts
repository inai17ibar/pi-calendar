import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const BOOT_ID_PATH = '/proc/sys/kernel/random/boot_id';
export function currentBootId(): string { try { return existsSync(BOOT_ID_PATH) ? readFileSync(BOOT_ID_PATH, 'utf8').trim() : ''; } catch { return ''; } }

/**
 * Single-instance lock stored as "pid boot_id". A lock from a previous boot (e.g. after power loss, when the
 * PID may have been reused), from this very process, or from a dead process is replaced.
 */
export function acquireLock(stateDir: string, bootId: string = currentBootId()): () => void {
 const dir = join(stateDir, 'locks');
 mkdirSync(dir, { recursive: true, mode: 0o700 });
 const path = join(dir, 'worker.lock');
 for (let attempt = 0; attempt < 2; attempt++) {
  try {
   const fd = openSync(path, 'wx', 0o600);
   writeSync(fd, `${process.pid} ${bootId}`);
   closeSync(fd);
   return () => { try { unlinkSync(path); } catch { /* already gone */ } };
  } catch (e) {
   if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
   const [pidText, lockBoot = ''] = readFileSync(path, 'utf8').trim().split(/\s+/);
   const pid = Number(pidText);
   let alive = false;
   // A lock without a boot id (older format) is checked by PID only.
   if (pid > 0 && pid !== process.pid && (lockBoot === '' || lockBoot === bootId)) {
    try { process.kill(pid, 0); alive = true; } catch (err) { alive = (err as NodeJS.ErrnoException).code === 'EPERM'; }
   }
   if (alive) throw new Error(`Another sync worker is running (pid ${pid}).`);
   unlinkSync(path);
  }
 }
 throw new Error('Could not acquire the worker lock.');
}
