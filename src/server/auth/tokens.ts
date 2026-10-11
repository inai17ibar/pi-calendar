import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SyncError, type AccessTokenSource } from '../google/client';

export const SCOPES = ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'] as const;
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const clientFile = z.object({ installed: z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) }).loose() }).loose();
export interface OAuthClient { clientId: string; clientSecret: string }
const tokenFile = z.object({ refresh_token: z.string().min(1), scope: z.string(), obtained_at: z.string() });
export type StoredTokens = z.infer<typeof tokenFile>;

export const secretsDir = (stateDir: string) => join(stateDir, 'secrets');
export const clientPath = (stateDir: string) => join(secretsDir(stateDir), 'oauth-client.json');
export const tokensPath = (stateDir: string) => join(secretsDir(stateDir), 'tokens.json');

/** Error messages name the file but never echo its contents. */
export function loadClient(stateDir: string): OAuthClient {
 const path = clientPath(stateDir);
 if (!existsSync(path)) throw new Error(`OAuth client file not found: ${path}`);
 let parsed: z.infer<typeof clientFile>;
 try { parsed = clientFile.parse(JSON.parse(readFileSync(path, 'utf8'))); } catch { throw new Error(`OAuth client file is not a Google "Desktop app" client JSON: ${path}`); }
 return { clientId: parsed.installed.client_id, clientSecret: parsed.installed.client_secret };
}

export interface TokenStore { read(): StoredTokens | null; write(tokens: StoredTokens): void; version(): number }
export class FileTokenStore implements TokenStore {
 constructor(private readonly stateDir: string) {}
 read(): StoredTokens | null {
  const path = tokensPath(this.stateDir);
  if (!existsSync(path)) return null;
  // A corrupt or truncated file reads as "no token", which surfaces as 再認証が必要.
  try { const parsed = tokenFile.safeParse(JSON.parse(readFileSync(path, 'utf8'))); return parsed.success ? parsed.data : null; } catch { return null; }
 }
 /** Atomic replace: 0600 temp file, fsync, rename inside a 0700 directory. */
 write(tokens: StoredTokens) {
  const dir = secretsDir(this.stateDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = join(dir, `.tokens.${process.pid}.tmp`);
  const fd = openSync(tmp, 'w', 0o600);
  try { writeSync(fd, JSON.stringify(tokens)); fsyncSync(fd); } finally { closeSync(fd); }
  chmodSync(tmp, 0o600);
  renameSync(tmp, tokensPath(this.stateDir));
 }
 /** Changes when the CLI re-authenticates; lets the worker leave auth_required without reading secrets twice. */
 version(): number { const path = tokensPath(this.stateDir); return existsSync(path) ? statSync(path).mtimeMs : 0; }
}

/** Keeps the access token in memory only; the refresh token is re-read from the store on each refresh. */
export class RefreshingAccessToken implements AccessTokenSource {
 private access: { value: string; expiresAt: number } | null = null;
 private pending: Promise<string> | null = null;
 constructor(private readonly client: OAuthClient, private readonly store: TokenStore, private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = Date.now) {}
 invalidate() { this.access = null; }
 token(): Promise<string> {
  if (this.access && this.access.expiresAt - 60_000 > this.now()) return Promise.resolve(this.access.value);
  // Concurrent sync jobs share one refresh request (and one possible token-file write).
  this.pending ??= this.refresh().finally(() => { this.pending = null; });
  return this.pending;
 }
 private async refresh(): Promise<string> {
  const stored = this.store.read();
  if (!stored) throw new SyncError('auth');
  let res: Response;
  try {
   res = await this.fetchImpl(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(30_000),
    body: new URLSearchParams({ client_id: this.client.clientId, client_secret: this.client.clientSecret, refresh_token: stored.refresh_token, grant_type: 'refresh_token' }) });
  } catch { throw new SyncError('network'); }
  const body = await res.json().catch(() => null) as { access_token?: string; expires_in?: number; refresh_token?: string; scope?: string; error?: string } | null;
  if (!res.ok || !body?.access_token) {
   if (body?.error === 'invalid_grant' || body?.error === 'unauthorized_client' || res.status === 400 || res.status === 401) throw new SyncError('auth');
   throw new SyncError(res.status >= 500 ? 'server' : 'invalid_response');
  }
  // Google usually omits refresh_token on refresh; keep the existing one in that case.
  if (body.refresh_token && body.refresh_token !== stored.refresh_token) this.store.write({ refresh_token: body.refresh_token, scope: body.scope ?? stored.scope, obtained_at: new Date(this.now()).toISOString() });
  this.access = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
 }
}
