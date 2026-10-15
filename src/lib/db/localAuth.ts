// The shop's own logins — the replacement for Firebase Authentication.
//
// TWO FACES, ONE TABLE SET (auth_accounts, sessions, auth_tokens in
// migration/schema.sql):
//
//   * the Admin-SDK face server.ts already calls — verifyIdToken, getUser,
//     getUserByEmail, createUser, setCustomUserClaims, deleteUser — answering
//     with the same shapes and the same error codes ('auth/user-not-found'), so
//     every caller of getAdminAuth() works unchanged;
//   * the browser face (authRoutes.ts): sign up, sign in, sign out, guest
//     sessions in place of anonymous sign-in, password reset, e-mail check.
//
// A "token" here is a session: 32 random bytes the browser keeps and sends as
// `Authorization: Bearer <token>`, exactly where it sent the Firebase ID token.
// Only its SHA-256 is stored, so a copy of the database holds no usable login.
//
// PASSWORDS. Ours are scrypt (node:crypto). Accounts imported from Firebase keep
// Firebase's own hash until their first sign-in, checked with Firebase's
// modified scrypt when the project's hash parameters are configured
// (FIREBASE_HASH_* — Firebase console → Authentication → ⋮ → Password hash
// parameters), and then re-saved in ours. Accounts copied from the LOCAL
// emulator carry its plain "fakeHash" and are accepted only with
// ALLOW_EMULATOR_HASHES=1, which nothing but local test mode sets.

import crypto from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { autoId } from './docStore';

type Claims = Record<string, unknown>;
interface AccountData {
  displayName?: string | null;
  photoURL?: string | null;
  customClaims?: Claims;
  providerData?: unknown[];
}
interface AccountRow extends RowDataPacket {
  id: string;
  login_email: string | null;
  email_verified: number;
  disabled: number;
  password_hash: string | null;
  firebase_hash: string | null;
  firebase_salt: string | null;
  google_sub: string | null;
  created_at: string | null;
  last_login_at: string | null;
  data: string;
}

/** An error carrying Firebase's code, so callers and the browser read it as before. */
export class AuthError extends Error {
  constructor(readonly code: string, message?: string, readonly status = 400) {
    super(message ?? code);
    this.name = 'AuthError';
  }
}

/** The shape server.ts reads from admin.auth().getUser(). */
export interface UserRecord {
  uid: string;
  email?: string;
  emailVerified: boolean;
  displayName?: string;
  photoURL?: string;
  disabled: boolean;
  customClaims?: Claims;
  providerData: unknown[];
  metadata: { creationTime: string | null; lastSignInTime: string | null };
}

/** The shape server.ts reads from verifyIdToken(). Custom claims are spread on it, like Firebase's. */
export interface DecodedToken {
  uid: string;
  email?: string;
  email_verified: boolean;
  firebase: { sign_in_provider: 'password' | 'anonymous' | 'google.com' };
  [claim: string]: unknown;
}

export interface Session {
  token: string;
  expiresAt: string;
  user: UserRecord & { isAnonymous: boolean };
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Passwords ──

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function checkOurHash(password: string, stored: string): boolean {
  const [kind, N, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
/** Firebase's modified scrypt: scrypt(password, salt+separator) keys AES-256-CTR over the signer key. */
function checkFirebaseHash(password: string, hashB64: string, saltB64: string): boolean {
  const signerKey = process.env.FIREBASE_HASH_SIGNER_KEY;
  const separator = process.env.FIREBASE_HASH_SALT_SEPARATOR;
  const rounds = Number(process.env.FIREBASE_HASH_ROUNDS);
  const memCost = Number(process.env.FIREBASE_HASH_MEM_COST);
  if (!signerKey || !separator || !rounds || !memCost) return false;
  const salt = Buffer.concat([Buffer.from(saltB64, 'base64'), Buffer.from(separator, 'base64')]);
  const derived = crypto.scryptSync(Buffer.from(password, 'utf8'), salt, 64, { N: 2 ** memCost, r: rounds, p: 1, maxmem: 512 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-ctr', derived.subarray(0, 32), Buffer.alloc(16, 0));
  const out = Buffer.concat([cipher.update(Buffer.from(signerKey, 'base64')), cipher.final()]);
  const expected = Buffer.from(hashB64, 'base64');
  return out.length === expected.length && crypto.timingSafeEqual(out, expected);
}
/** The Auth EMULATOR's export: "fakeHash:salt=…:password=…". Local test mode only. */
function checkEmulatorHash(password: string, stored: string): boolean {
  if (process.env.ALLOW_EMULATOR_HASHES !== '1' || !stored.startsWith('fakeHash:')) return false;
  const m = stored.match(/:password=(.*)$/s);
  return !!m && m[1] === password;
}

function checkPasswordStrength(password: unknown): string {
  const p = String(password ?? '');
  if (p.length < 6) throw new AuthError('auth/weak-password', 'Password should be at least 6 characters.');
  if (p.length > 200) throw new AuthError('auth/weak-password', 'That password is too long.');
  return p;
}

// ── Throttling: Firebase's "too many attempts", kept in memory per address+email ──

const attempts = new Map<string, { n: number; until: number }>();
function throttle(key: string): void {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 8) throw new AuthError('auth/too-many-requests', 'Too many attempts. Try again in a few minutes.', 429);
}
function failed(key: string): void {
  const now = Date.now();
  const a = attempts.get(key);
  attempts.set(key, a && a.until > now ? { n: a.n + 1, until: a.until } : { n: 1, until: now + 10 * 60_000 });
  if (attempts.size > 10_000) for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
}

// ── The store ──

const SESSION_DAYS = 30;
const SHORT_SESSION_HOURS = 24;   // "remember me" off: the browser forgets it at close; the server after a day

export class LocalAuth {
  /** verifyIdToken answers from here for a minute: one query per request is the cost otherwise. */
  private cache = new Map<string, { at: number; decoded: DecodedToken }>();

  constructor(private readonly pool: Pool) {}

  // ── rows ⇄ records ──

  private async row(where: 'id' | 'login_email', value: string): Promise<AccountRow | null> {
    const [rows] = await this.pool.query<AccountRow[]>(`SELECT * FROM auth_accounts WHERE ${where} = ? LIMIT 1`, [value]);
    return rows[0] ?? null;
  }
  private static data(row: AccountRow): AccountData {
    try { return JSON.parse(row.data || '{}'); } catch { return {}; }
  }
  private static record(row: AccountRow): UserRecord {
    const d = LocalAuth.data(row);
    return {
      uid: row.id,
      email: row.login_email ?? undefined,
      emailVerified: !!row.email_verified,
      displayName: d.displayName ?? undefined,
      photoURL: d.photoURL ?? undefined,
      disabled: !!row.disabled,
      customClaims: d.customClaims ?? undefined,
      providerData: d.providerData ?? [],
      metadata: { creationTime: row.created_at, lastSignInTime: row.last_login_at },
    };
  }
  private async saveData(uid: string, patch: Partial<AccountData>): Promise<void> {
    const row = await this.row('id', uid);
    if (!row) throw new AuthError('auth/user-not-found', 'There is no user record corresponding to this identifier.', 404);
    const data = { ...LocalAuth.data(row), ...patch };
    await this.pool.query('UPDATE auth_accounts SET data = ? WHERE id = ?', [JSON.stringify(data), uid]);
    this.forget(uid);
  }
  private forget(uid?: string): void {
    if (!uid) { this.cache.clear(); return; }
    for (const [k, v] of this.cache) if (v.decoded.uid === uid) this.cache.delete(k);
  }

  // ── The Admin-SDK face ──

  async verifyIdToken(token: string): Promise<DecodedToken> {
    if (!token || token.length > 200) throw new AuthError('auth/argument-error', 'No token.', 401);
    const key = sha256(token);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.decoded;

    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT s.account_id, s.guest_id, s.expires_at, a.login_email, a.email_verified, a.disabled, a.google_sub, a.data ' +
      'FROM sessions s LEFT JOIN auth_accounts a ON a.id = s.account_id WHERE s.token_hash = ? LIMIT 1', [key]);
    const s = rows[0];
    if (!s || new Date(s.expires_at).getTime() < Date.now()) throw new AuthError('auth/id-token-expired', 'Session expired.', 401);

    let decoded: DecodedToken;
    if (s.account_id) {
      if (s.disabled) throw new AuthError('auth/user-disabled', 'This account has been disabled.', 403);
      let d: AccountData = {};
      try { d = JSON.parse(s.data || '{}'); } catch { /* empty */ }
      decoded = {
        ...(d.customClaims ?? {}),
        uid: s.account_id,
        email: s.login_email ?? undefined,
        email_verified: !!s.email_verified,
        firebase: { sign_in_provider: s.google_sub ? 'google.com' : 'password' },
      };
    } else {
      decoded = { uid: s.guest_id, email_verified: false, firebase: { sign_in_provider: 'anonymous' } };
    }
    this.cache.set(key, { at: Date.now(), decoded });
    if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
    // Last seen, at most once a minute per session — not a write per request.
    void this.pool.query('UPDATE sessions SET last_seen_at = NOW(3) WHERE token_hash = ? AND (last_seen_at IS NULL OR last_seen_at < NOW(3) - INTERVAL 1 MINUTE)', [key]).catch(() => {});
    return decoded;
  }

  async getUser(uid: string): Promise<UserRecord> {
    const row = await this.row('id', String(uid));
    if (!row) throw new AuthError('auth/user-not-found', 'There is no user record corresponding to this identifier.', 404);
    return LocalAuth.record(row);
  }

  async getUserByEmail(email: string): Promise<UserRecord> {
    const row = await this.row('login_email', normEmail(email));
    if (!row) throw new AuthError('auth/user-not-found', 'There is no user record corresponding to this email.', 404);
    return LocalAuth.record(row);
  }

  async createUser(input: { email?: string; password?: string; displayName?: string; emailVerified?: boolean; uid?: string }): Promise<UserRecord> {
    const email = normEmail(input.email);
    if (!EMAIL_RE.test(email)) throw new AuthError('auth/invalid-email', 'The email address is badly formatted.');
    const password = checkPasswordStrength(input.password);
    if (await this.row('login_email', email)) throw new AuthError('auth/email-already-exists', 'The email address is already in use by another account.');
    // 28 characters, like a Firebase uid, so nothing that measures one is surprised.
    const uid = input.uid ?? (autoId() + autoId()).slice(0, 28);
    const now = new Date().toISOString();
    const data: AccountData = { displayName: input.displayName ?? null, photoURL: null, providerData: [{ providerId: 'password', uid: email, email }] };
    try {
      await this.pool.query(
        'INSERT INTO auth_accounts (id, login_email, email_verified, disabled, password_hash, created_at, data) VALUES (?, ?, ?, 0, ?, ?, ?)',
        [uid, email, input.emailVerified ? 1 : 0, hashPassword(password), now, JSON.stringify(data)],
      );
    } catch (err: any) {
      if (err?.errno === 1062) throw new AuthError('auth/email-already-exists', 'The email address is already in use by another account.');
      throw err;
    }
    return this.getUser(uid);
  }

  async setCustomUserClaims(uid: string, claims: Claims | null): Promise<void> {
    await this.saveData(uid, { customClaims: claims ?? {} });
  }

  async updateUser(uid: string, patch: { displayName?: string | null; photoURL?: string | null; password?: string; emailVerified?: boolean; disabled?: boolean }): Promise<UserRecord> {
    if (patch.displayName !== undefined || patch.photoURL !== undefined) {
      await this.saveData(uid, {
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.photoURL !== undefined ? { photoURL: patch.photoURL } : {}),
      });
    }
    if (patch.password !== undefined) {
      await this.pool.query('UPDATE auth_accounts SET password_hash = ?, firebase_hash = NULL, firebase_salt = NULL WHERE id = ?', [hashPassword(checkPasswordStrength(patch.password)), uid]);
    }
    if (patch.emailVerified !== undefined) await this.pool.query('UPDATE auth_accounts SET email_verified = ? WHERE id = ?', [patch.emailVerified ? 1 : 0, uid]);
    if (patch.disabled !== undefined) {
      await this.pool.query('UPDATE auth_accounts SET disabled = ? WHERE id = ?', [patch.disabled ? 1 : 0, uid]);
      if (patch.disabled) await this.pool.query('DELETE FROM sessions WHERE account_id = ?', [uid]);
    }
    this.forget(uid);
    return this.getUser(uid);
  }

  async deleteUser(uid: string): Promise<void> {
    const [res] = await this.pool.query<any>('DELETE FROM auth_accounts WHERE id = ?', [uid]);   // sessions and tokens cascade
    this.forget(uid);
    if (!res.affectedRows) throw new AuthError('auth/user-not-found', 'There is no user record corresponding to this identifier.', 404);
  }

  // ── The browser face ──

  private async openSession(accountId: string | null, guestId: string | null, remember: boolean, userAgent: string): Promise<Session> {
    const token = newToken();
    const ms = remember ? SESSION_DAYS * 86_400_000 : SHORT_SESSION_HOURS * 3_600_000;
    const expires = new Date(Date.now() + ms);
    await this.pool.query(
      'INSERT INTO sessions (token_hash, account_id, guest_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, NOW(3), ?, ?)',
      [sha256(token), accountId, guestId, expires, userAgent.slice(0, 255)],
    );
    // Old sessions go now and then, not on a schedule nobody runs.
    if (Math.random() < 0.02) void this.pool.query('DELETE FROM sessions WHERE expires_at < NOW(3)').catch(() => {});
    const user = accountId
      ? { ...(await this.getUser(accountId)), isAnonymous: false }
      : { uid: guestId!, emailVerified: false, disabled: false, providerData: [], metadata: { creationTime: null, lastSignInTime: null }, isAnonymous: true };
    return { token, expiresAt: expires.toISOString(), user };
  }

  async signUp(input: { email: unknown; password: unknown; displayName?: unknown; remember?: boolean }, userAgent = ''): Promise<Session> {
    const user = await this.createUser({
      email: String(input.email ?? ''),
      password: String(input.password ?? ''),
      displayName: input.displayName ? String(input.displayName).slice(0, 120) : undefined,
    }).catch((err) => {
      // The browser speaks the CLIENT SDK's codes; this is the one that differs.
      if (err instanceof AuthError && err.code === 'auth/email-already-exists') throw new AuthError('auth/email-already-in-use', err.message);
      throw err;
    });
    await this.pool.query('UPDATE auth_accounts SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.uid]);
    return this.openSession(user.uid, null, input.remember !== false, userAgent);
  }

  async signIn(input: { email: unknown; password: unknown; remember?: boolean }, ip: string, userAgent = ''): Promise<Session> {
    const email = normEmail(input.email);
    const password = String(input.password ?? '');
    if (!EMAIL_RE.test(email)) throw new AuthError('auth/invalid-email', 'The email address is badly formatted.');
    const key = `${ip}|${email}`;
    throttle(key);
    const row = await this.row('login_email', email);
    let ok = false;
    if (row?.password_hash) ok = checkOurHash(password, row.password_hash);
    else if (row?.firebase_hash) ok = checkEmulatorHash(password, row.firebase_hash) || checkFirebaseHash(password, row.firebase_hash, row.firebase_salt ?? '');
    if (!row || !ok) {
      failed(key);
      throw new AuthError('auth/invalid-credential', 'The email or password is incorrect.', 401);
    }
    if (row.disabled) throw new AuthError('auth/user-disabled', 'This account has been disabled.', 403);
    // A Firebase-era hash that just worked is replaced by ours, once.
    if (!row.password_hash) await this.pool.query('UPDATE auth_accounts SET password_hash = ?, firebase_hash = NULL, firebase_salt = NULL WHERE id = ?', [hashPassword(password), row.id]);
    await this.pool.query('UPDATE auth_accounts SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), row.id]);
    attempts.delete(key);
    return this.openSession(row.id, null, input.remember !== false, userAgent);
  }

  /** In place of Firebase's anonymous sign-in: an owner for a guest's uploads, never an account. */
  async signInAsGuest(userAgent = ''): Promise<Session> {
    return this.openSession(null, (autoId() + autoId()).slice(0, 28), true, userAgent);
  }

  async signOut(token: string): Promise<void> {
    if (!token) return;
    const key = sha256(token);
    this.cache.delete(key);
    await this.pool.query('DELETE FROM sessions WHERE token_hash = ?', [key]);
  }

  /** The signed-in user behind a token, for the browser's onAuthStateChanged. */
  async me(token: string): Promise<Session['user']> {
    const d = await this.verifyIdToken(token);
    if (d.firebase.sign_in_provider === 'anonymous') {
      return { uid: d.uid, emailVerified: false, disabled: false, providerData: [], metadata: { creationTime: null, lastSignInTime: null }, isAnonymous: true };
    }
    return { ...(await this.getUser(d.uid)), isAnonymous: false };
  }

  async changePassword(token: string, newPassword: unknown): Promise<void> {
    const d = await this.verifyIdToken(token);
    if (d.firebase.sign_in_provider === 'anonymous') throw new AuthError('auth/operation-not-allowed', 'Guests have no password.', 403);
    await this.updateUser(d.uid, { password: String(newPassword ?? '') });
    // Every OTHER session of this account ends: a password change is how a
    // customer throws out someone who knew the old one.
    await this.pool.query('DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?', [d.uid, sha256(token)]);
  }

  /** A one-time link token (password reset, e-mail check), or null when there is no such account. */
  async issueLinkToken(email: string, purpose: 'password_reset' | 'verify_email', hours: number): Promise<{ token: string; uid: string } | null> {
    const row = await this.row('login_email', normEmail(email));
    if (!row || row.disabled) return null;
    const token = newToken();
    await this.pool.query('DELETE FROM auth_tokens WHERE account_id = ? AND purpose = ?', [row.id, purpose]);
    await this.pool.query('INSERT INTO auth_tokens (token_hash, account_id, purpose, expires_at) VALUES (?, ?, ?, ?)',
      [sha256(token), row.id, purpose, new Date(Date.now() + hours * 3_600_000)]);
    return { token, uid: row.id };
  }

  /** Spends a link token; the account it was for, or an error the page can show. */
  async useLinkToken(token: string, purpose: 'password_reset' | 'verify_email'): Promise<string> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT account_id, expires_at, used_at FROM auth_tokens WHERE token_hash = ? AND purpose = ? LIMIT 1', [sha256(String(token ?? '')), purpose]);
    const t = rows[0];
    if (!t || t.used_at || new Date(t.expires_at).getTime() < Date.now()) throw new AuthError('auth/invalid-action-code', 'This link has expired or has already been used.');
    await this.pool.query('UPDATE auth_tokens SET used_at = NOW(3) WHERE token_hash = ?', [sha256(String(token))]);
    return t.account_id;
  }

  async resetPassword(token: string, newPassword: unknown): Promise<void> {
    checkPasswordStrength(newPassword);
    const uid = await this.useLinkToken(token, 'password_reset');
    await this.updateUser(uid, { password: String(newPassword) });
    await this.pool.query('DELETE FROM sessions WHERE account_id = ?', [uid]);   // signed out everywhere
  }

  async verifyEmail(token: string): Promise<void> {
    const uid = await this.useLinkToken(token, 'verify_email');
    await this.updateUser(uid, { emailVerified: true });
  }
}
