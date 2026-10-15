// Stand-in for 'firebase/auth' when the shop runs on its own database
// (DATA_BACKEND=mysql; swapped in by vite.config.ts). The same functions, the
// same User shape and the same 'auth/…' error codes, so App.tsx, AuthPage and
// every screen that calls getIdToken() work unchanged — against /api/auth/*
// (src/lib/db/localRoutes.ts) instead of Google.
//
// Not available here: Google sign-in. It needs an OAuth client in a Google
// project the shop owns (migration/PLAN.md, "Logins"); until then the button
// reports auth/operation-not-allowed, which AuthPage already explains.

import { api, readToken, writeToken, setPersistenceMode, rememberMe } from './session';

interface ServerUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
  photoURL?: string;
  isAnonymous: boolean;
  providerData?: unknown[];
  customClaims?: Record<string, unknown>;
  metadata?: { creationTime: string | null; lastSignInTime: string | null };
}

export interface User {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
  providerData: unknown[];
  metadata: { creationTime?: string; lastSignInTime?: string };
  getIdToken(forceRefresh?: boolean): Promise<string>;
  getIdTokenResult(forceRefresh?: boolean): Promise<{ token: string; claims: Record<string, unknown> }>;
  reload(): Promise<void>;
  toJSON(): object;
}
export type UserCredential = { user: User };
export type Auth = { readonly currentUser: User | null; app: unknown; name: string };

export class AuthError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'FirebaseError';
  }
}

let current: User | null = null;
let claims: Record<string, unknown> = {};
let ready = false;
const listeners = new Set<(u: User | null) => void>();

function makeUser(u: ServerUser): User {
  claims = u.customClaims ?? {};
  const user: User = {
    uid: u.uid,
    email: u.email ?? null,
    emailVerified: !!u.emailVerified,
    displayName: u.displayName ?? null,
    photoURL: u.photoURL ?? null,
    isAnonymous: !!u.isAnonymous,
    providerData: u.providerData ?? [],
    metadata: { creationTime: u.metadata?.creationTime ?? undefined, lastSignInTime: u.metadata?.lastSignInTime ?? undefined },
    async getIdToken() {
      const t = readToken();
      if (!t) throw new AuthError('auth/user-token-expired', 'Signed out.');
      return t;
    },
    async getIdTokenResult() { return { token: await user.getIdToken(), claims: { ...claims } }; },
    async reload() {
      const r = await api<{ user: ServerUser }>('/api/auth/me');
      if (r.ok) Object.assign(user, makeUser(r.data.user), { getIdToken: user.getIdToken, getIdTokenResult: user.getIdTokenResult, reload: user.reload, toJSON: user.toJSON });
    },
    toJSON() { return { uid: user.uid, email: user.email, displayName: user.displayName, isAnonymous: user.isAnonymous }; },
  };
  return user;
}

function emit(): void {
  for (const cb of [...listeners]) { try { cb(current); } catch (err) { console.error(err); } }
}
function setUser(u: ServerUser | null): void {
  current = u ? makeUser(u) : null;
  ready = true;
  emit();
}

/** The server's answer as an error the screens recognise. */
function toError(r: { status: number; data: any }): AuthError {
  return new AuthError(String(r.data?.code ?? (r.status >= 500 ? 'auth/internal-error' : 'auth/unknown')), r.data?.error);
}
async function call(path: string, body?: unknown): Promise<any> {
  let r;
  try { r = await api(path, body); } catch { throw new AuthError('auth/network-request-failed', 'Network error.'); }
  if (!r.ok) throw toError(r);
  return r.data;
}

// The session this browser already had: who is signed in, asked once at start.
const restored = (async () => {
  if (!readToken()) return setUser(null);
  try {
    const r = await api<{ user: ServerUser }>('/api/auth/me');
    if (r.ok) return setUser(r.data.user);
    if (r.status === 401 || r.status === 403) writeToken(null);
    setUser(null);
  } catch {
    // The server did not answer. Signed out for now, but the session is kept —
    // a dropped connection is not a sign-out.
    setUser(null);
  }
})();

const AUTH: Auth = {
  get currentUser() { return current; },
  app: null,
  name: '[DEFAULT]',
};

export const getAuth = (_app?: unknown): Auth => AUTH;
export const connectAuthEmulator = (..._args: unknown[]): void => {};

export function onAuthStateChanged(_auth: Auth, next: (u: User | null) => void, _error?: (e: Error) => void): () => void {
  listeners.add(next);
  if (ready) queueMicrotask(() => listeners.has(next) && next(current));
  else void restored;
  return () => { listeners.delete(next); };
}
export const onIdTokenChanged = onAuthStateChanged;

export const browserLocalPersistence = { type: 'LOCAL' as const };
export const browserSessionPersistence = { type: 'SESSION' as const };
export const inMemoryPersistence = { type: 'SESSION' as const };
export async function setPersistence(_auth: Auth, p: { type: 'LOCAL' | 'SESSION' }): Promise<void> {
  setPersistenceMode(p.type);
}

async function startSession(path: string, body: Record<string, unknown>): Promise<UserCredential> {
  const data = await call(path, { ...body, remember: rememberMe() });
  writeToken(data.token);
  setUser(data.user);
  return { user: current! };
}

export const signInWithEmailAndPassword = (_auth: Auth, email: string, password: string) =>
  startSession('/api/auth/login', { email, password });
export const createUserWithEmailAndPassword = (_auth: Auth, email: string, password: string) =>
  startSession('/api/auth/signup', { email, password });
export const signInAnonymously = (_auth: Auth) => startSession('/api/auth/guest', {});

export async function signOut(_auth: Auth): Promise<void> {
  if (readToken()) await api('/api/auth/logout', {}).catch(() => undefined);
  writeToken(null);
  setUser(null);
}

export async function updateProfile(user: User, patch: { displayName?: string | null; photoURL?: string | null }): Promise<void> {
  const data = await call('/api/auth/profile', patch);
  // In place, like Firebase: no auth-state event for a profile edit.
  if (data?.user) {
    user.displayName = data.user.displayName ?? null;
    user.photoURL = data.user.photoURL ?? null;
  }
}
export async function updatePassword(_user: User, password: string): Promise<void> {
  await call('/api/auth/password', { password });
}
export async function sendPasswordResetEmail(_auth: Auth, email: string): Promise<void> {
  await call('/api/auth/reset-request', { email });
}
export async function sendEmailVerification(_user: User): Promise<void> {
  await call('/api/auth/verify-request', {});
}
/** For the /reset-password page (the link in the reset e-mail). */
export async function confirmPasswordReset(_auth: Auth, token: string, password: string): Promise<void> {
  await call('/api/auth/reset', { token, password });
}

export class GoogleAuthProvider {
  setCustomParameters(_p: Record<string, string>) { return this; }
  addScope(_s: string) { return this; }
}
const noGoogle = async (): Promise<UserCredential> => {
  throw new AuthError('auth/operation-not-allowed', 'Google sign-in is not set up on this shop yet.');
};
export const signInWithPopup = (_a: Auth, _p: unknown) => noGoogle();
export const signInWithRedirect = (_a: Auth, _p: unknown) => noGoogle();
export const getRedirectResult = async (_a: Auth): Promise<UserCredential | null> => null;
