// The signed-in session in the browser, shared by the firebase/* stand-ins in
// this folder (DATA_BACKEND=mysql — see src/lib/db/localRoutes.ts).
//
// The session token lives in localStorage when "remember me" is on, in
// sessionStorage when it is off — the same two places Firebase's
// browserLocalPersistence and browserSessionPersistence used.

const KEY = 'rx-session';
export type Persistence = 'LOCAL' | 'SESSION';
let persistence: Persistence = 'LOCAL';

const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export function readToken(): string | null {
  return safe(() => localStorage.getItem(KEY), null) ?? safe(() => sessionStorage.getItem(KEY), null);
}
export function writeToken(token: string | null): void {
  safe(() => localStorage.removeItem(KEY), undefined);
  safe(() => sessionStorage.removeItem(KEY), undefined);
  if (!token) return;
  safe(() => (persistence === 'LOCAL' ? localStorage : sessionStorage).setItem(KEY, token), undefined);
}
export function setPersistenceMode(p: Persistence): void {
  persistence = p;
  const t = readToken();
  if (t) writeToken(t);   // moves an existing session to the chosen store
}
export const rememberMe = () => persistence === 'LOCAL';

/** A JSON call to the shop's server, with the session when there is one. */
export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<{ ok: boolean; status: number; data: T }> {
  const token = readToken();
  const res = await fetch(path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
