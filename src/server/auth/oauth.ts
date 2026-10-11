import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { SCOPES, TOKEN_ENDPOINT, type OAuthClient, type StoredTokens } from './tokens';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const base64url = (b: Buffer) => b.toString('base64url');
export function createPkce() {
 const verifier = base64url(randomBytes(32));
 return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()), state: base64url(randomBytes(24)) };
}
export function authorizationUrl(client: OAuthClient, redirectUri: string, pkce: { challenge: string; state: string }) {
 return `${AUTH_ENDPOINT}?${new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), code_challenge: pkce.challenge, code_challenge_method: 'S256', state: pkce.state, access_type: 'offline', prompt: 'consent' })}`;
}
const sameSecret = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export type CallbackResult = { code: string } | { error: 'denied' | 'timeout' };
/**
 * One-shot loopback listener on 127.0.0.1 only. Requests with another path or a wrong state are refused and
 * do not end the wait; the first matching callback (success or denial) closes the server.
 */
export function waitForCallback(port: number, expectedState: string, timeoutMs = 10 * 60_000): Promise<CallbackResult> {
 return new Promise((resolvePromise, reject) => {
  const finish = (result: CallbackResult) => { clearTimeout(timer); server.close(); resolvePromise(result); };
  const page = (title: string) => `<!doctype html><meta charset="utf-8"><title>Pi Calendar</title><p style="font:16px sans-serif">${title}</p>`;
  const server: Server = createServer((req, res) => {
   const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
   const state = url.searchParams.get('state') ?? '';
   if (req.method !== 'GET' || url.pathname !== '/' || !sameSecret(state, expectedState)) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(page('無効なリクエストです。'));
    return;
   }
   const code = url.searchParams.get('code');
   res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'close' })
    .end(page(code ? '認証を受け取りました。このタブを閉じ、Piのターミナルに戻ってください。' : '認証はキャンセルされました。'));
   finish(code ? { code } : { error: 'denied' });
  });
  const timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs);
  server.on('error', e => { clearTimeout(timer); reject((e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use on 127.0.0.1. Choose another --port (and the same port for any SSH forward).`) : e); });
  server.listen(port, '127.0.0.1');
 });
}

export async function exchangeCode(client: OAuthClient, code: string, verifier: string, redirectUri: string, now: Date, fetchImpl: typeof fetch = fetch): Promise<StoredTokens> {
 const res = await fetchImpl(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(30_000),
  body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
 const body = await res.json().catch(() => null) as { refresh_token?: string; scope?: string; error?: string } | null;
 if (!res.ok || !body) throw new Error(`Token exchange failed (HTTP ${res.status}${body?.error ? `, ${body.error}` : ''}).`);
 if (!body.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and retry.');
 const granted = (body.scope ?? '').split(' ');
 if (!granted.includes(SCOPES[0])) throw new Error('Calendar read permission was not granted. Retry and allow both read-only permissions.');
 const extra = granted.filter(s => s && !(SCOPES as readonly string[]).includes(s));
 if (extra.length) throw new Error('Google granted unexpected extra scopes; refusing to store this token.');
 return { refresh_token: body.refresh_token, scope: granted.join(' '), obtained_at: now.toISOString() };
}
