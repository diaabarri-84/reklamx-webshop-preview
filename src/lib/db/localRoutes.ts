// The browser's doors when the shop runs on its own database (DATA_BACKEND=mysql).
//
// On Firebase the browser talked to Google directly for three things: signing
// in (Firebase Auth), reading and writing documents (Firestore, under
// firestore.rules) and uploading files (Storage, under storage.rules). Here the
// same three go through the shop's server:
//
//   /api/auth/*   — sign up / in / out, guest sessions, password reset, e-mail check
//   /api/data/*   — get, query and commit documents, judged by accessRules.ts
//   /api/files/*  — upload and delete; /files/* serves them
//
// The browser side is src/lib/local/* — small stand-ins for the firebase/*
// modules, swapped in at build time (vite.config.ts), so the shop's screens
// keep calling getDoc(), setDoc() and signInWithEmailAndPassword() unchanged.

import express, { type Express, type Request, type Response } from 'express';
import { getDocStore } from './index';
import { DocumentSnapshot, DocStoreError, FieldValue, type DocStore, type DocumentReference } from './docStore';
import { AuthError, type LocalAuth } from './localAuth';
import { FileStore, cleanFilePath, fileUrl } from './fileStore';
import { canRead, canWrite, type Caller, type Doc, type DocPath } from './accessRules';
import { getAccountMailer as getMailer } from '../email';

const bearer = (req: Request) => {
  const h = req.get('authorization') ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
};
const clientIp = (req: Request) => String(req.ip ?? req.socket.remoteAddress ?? '');

/** Errors in the shapes the browser's stand-ins turn back into Firebase errors. */
function fail(res: Response, err: unknown) {
  if (err instanceof AuthError) return res.status(err.status).json({ code: err.code, error: err.message });
  if (err instanceof DocStoreError) {
    const code = err.code === 5 ? 'not-found' : err.code === 6 ? 'already-exists' : 'invalid-argument';
    return res.status(err.code === 5 ? 404 : err.code === 6 ? 409 : 400).json({ code, error: err.message });
  }
  const e = err as { status?: number; code?: string; message?: string };
  if (e?.status && e.status < 500) return res.status(e.status).json({ code: e.code ?? 'failed-precondition', error: e.message });
  console.error('Local backend error:', err);
  return res.status(500).json({ code: 'internal', error: 'Something went wrong on the server.' });
}
const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { status: 403, code: 'permission-denied' });
const badRequest = (m: string) => Object.assign(new Error(m), { status: 400, code: 'invalid-argument' });

/** Where links in e-mails point. PUBLIC_URL only: a host taken from request headers is a stranger's choice. */
function publicBase(): string {
  const base = String(process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (!base) throw Object.assign(new Error('PUBLIC_URL is not set on this server, so the link cannot be built.'), { status: 503, code: 'unavailable' });
  return base;
}

// ── Paths and values ──

/** 'orders/123' or 'users/<uid>/pointsLedger/<id>' → the data layer's terms. */
function parsePath(raw: unknown): DocPath {
  const parts = String(raw ?? '').split('/').filter(Boolean);
  if (parts.length === 2) return { collection: parts[0], id: parts[1], parentId: null };
  if (parts.length === 4) return { collection: `${parts[0]}/${parts[2]}`, id: parts[3], parentId: parts[1] };
  throw badRequest('A document path has two or four parts.');
}
function parseCollectionPath(raw: unknown): { collection: string; parentId: string | null } {
  const parts = String(raw ?? '').split('/').filter(Boolean);
  if (parts.length === 1) return { collection: parts[0], parentId: null };
  if (parts.length === 3) return { collection: `${parts[0]}/${parts[2]}`, parentId: parts[1] };
  throw badRequest('A collection path has one or three parts.');
}
function refFor(store: DocStore, p: DocPath): DocumentReference {
  if (p.parentId === null) return store.collection(p.collection).doc(p.id);
  const [parent, sub] = p.collection.split('/');
  return store.collection(parent).doc(p.parentId).collection(sub).doc(p.id);
}
function collectionFor(store: DocStore, c: { collection: string; parentId: string | null }) {
  if (c.parentId === null) return store.collection(c.collection);
  const [parent, sub] = c.collection.split('/');
  return store.collection(parent).doc(c.parentId).collection(sub);
}
/** The browser's encoded sentinels → the data layer's. */
function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.__rx === 'delete') return FieldValue.delete();
    if (o.__rx === 'arrayUnion') return FieldValue.arrayUnion(...((o.v as unknown[]) ?? []).map(decode));
    if (o.__rx === 'serverTimestamp') return new Date().toISOString();
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

export function registerLocalBackendRoutes(app: Express, auth: LocalAuth, files: FileStore, siteName: () => Promise<string>): void {
  const store = getDocStore();
  if (!store) throw new Error('DATA_BACKEND=mysql needs MYSQL_URL (or MYSQL_HOST …).');

  async function callerOf(req: Request): Promise<Caller | null> {
    const token = bearer(req);
    if (!token) return null;
    try {
      const d = await auth.verifyIdToken(token);
      const { uid, firebase, email: _e, email_verified: _v, ...claims } = d;
      return { uid, anonymous: firebase.sign_in_provider === 'anonymous', claims };
    } catch { return null; }
  }
  /** The caller's users document, read at most once per request. */
  function profileReader() {
    const memo = new Map<string, Promise<Doc | null>>();
    return (uid: string) => {
      if (!memo.has(uid)) memo.set(uid, store!.collection('users').doc(uid).get().then((s) => (s.exists ? (s.data() as Doc) : null)).catch(() => null));
      return memo.get(uid)!;
    };
  }

  // ───────────────────────────── Auth ─────────────────────────────

  const ua = (req: Request) => String(req.get('user-agent') ?? '');
  const sendSession = (res: Response, s: Awaited<ReturnType<LocalAuth['signIn']>>) => res.json(s);

  app.post('/api/auth/signup', async (req, res) => {
    try { sendSession(res, await auth.signUp(req.body ?? {}, ua(req))); } catch (err) { fail(res, err); }
  });
  app.post('/api/auth/login', async (req, res) => {
    try { sendSession(res, await auth.signIn(req.body ?? {}, clientIp(req), ua(req))); } catch (err) { fail(res, err); }
  });
  app.post('/api/auth/guest', async (req, res) => {
    try { sendSession(res, await auth.signInAsGuest(ua(req))); } catch (err) { fail(res, err); }
  });
  app.post('/api/auth/logout', async (req, res) => {
    try { await auth.signOut(bearer(req)); res.json({ ok: true }); } catch (err) { fail(res, err); }
  });
  app.get('/api/auth/me', async (req, res) => {
    try { res.json({ user: await auth.me(bearer(req)) }); } catch (err) { fail(res, err); }
  });
  app.post('/api/auth/profile', async (req, res) => {
    try {
      const d = await auth.verifyIdToken(bearer(req));
      if (d.firebase.sign_in_provider === 'anonymous') throw new AuthError('auth/operation-not-allowed', 'Guests have no profile.', 403);
      const { displayName, photoURL } = req.body ?? {};
      const user = await auth.updateUser(d.uid, {
        ...(displayName !== undefined ? { displayName: displayName === null ? null : String(displayName).slice(0, 120) } : {}),
        ...(photoURL !== undefined ? { photoURL: photoURL === null ? null : String(photoURL).slice(0, 2000) } : {}),
      });
      res.json({ user: { ...user, isAnonymous: false } });
    } catch (err) { fail(res, err); }
  });
  app.post('/api/auth/password', async (req, res) => {
    try { await auth.changePassword(bearer(req), req.body?.password); res.json({ ok: true }); } catch (err) { fail(res, err); }
  });

  // Password reset: always "sent", whether or not the address has an account —
  // telling a stranger which addresses are registered is the leak App.tsx
  // already refuses to make.
  const resetAsks = new Map<string, number[]>();
  app.post('/api/auth/reset-request', async (req, res) => {
    try {
      const ip = clientIp(req);
      const now = Date.now();
      const recent = (resetAsks.get(ip) ?? []).filter((t) => now - t < 3_600_000);
      if (recent.length >= 5) throw new AuthError('auth/too-many-requests', 'Too many requests. Try again later.', 429);
      resetAsks.set(ip, [...recent, now]);
      const email = String(req.body?.email ?? '').trim();
      const link = await auth.issueLinkToken(email, 'password_reset', 1);
      if (link) {
        const mailer = getMailer();
        const url = `${publicBase()}/reset-password?token=${encodeURIComponent(link.token)}`;
        const shop = await siteName();
        if (mailer) {
          await mailer.transporter.sendMail({
            from: `${shop} <${mailer.config.from}>`, to: email,
            subject: `${shop}: återställ ditt lösenord / reset your password`,
            text: `Hej,\n\nÖppna länken för att välja ett nytt lösenord (gäller i en timme):\n${url}\n\nOpen the link to choose a new password (valid for one hour):\n${url}\n\nOm du inte bad om detta kan du ignorera meddelandet.`,
          });
        } else console.warn(`No mail server configured — password reset link for ${email}: ${url}`);
      }
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });
  app.post('/api/auth/reset', async (req, res) => {
    try { await auth.resetPassword(String(req.body?.token ?? ''), req.body?.password); res.json({ ok: true }); } catch (err) { fail(res, err); }
  });
  app.post('/api/auth/verify-request', async (req, res) => {
    try {
      const me = await auth.me(bearer(req));
      if (me.isAnonymous || !me.email) throw new AuthError('auth/operation-not-allowed', 'No address to check.', 400);
      if (me.emailVerified) return res.json({ ok: true, already: true });
      const link = await auth.issueLinkToken(me.email, 'verify_email', 72);
      const mailer = getMailer();
      if (link) {
        const url = `${publicBase()}/api/auth/verify?token=${encodeURIComponent(link.token)}`;
        const shop = await siteName();
        if (mailer) {
          await mailer.transporter.sendMail({
            from: `${shop} <${mailer.config.from}>`, to: me.email,
            subject: `${shop}: bekräfta din e-postadress / confirm your e-mail`,
            text: `Hej,\n\nBekräfta din e-postadress genom att öppna länken:\n${url}\n\nConfirm your e-mail address by opening the link:\n${url}`,
          });
        } else console.warn(`No mail server configured — e-mail check link for ${me.email}: ${url}`);
      }
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });
  app.get('/api/auth/verify', async (req, res) => {
    try {
      await auth.verifyEmail(String(req.query.token ?? ''));
      res.redirect(302, '/?email-verified=1');
    } catch {
      res.redirect(302, '/?email-verified=0');
    }
  });

  // ───────────────────────────── Data ─────────────────────────────

  app.post('/api/data/get', async (req, res) => {
    try {
      const caller = await callerOf(req);
      const profile = profileReader();
      const p = parsePath(req.body?.path);
      const snap = await refFor(store, p).get();
      const data = snap.exists ? (snap.data() as Doc) : null;
      if (!(await canRead(p, data, caller, profile))) throw denied();
      res.json({ id: p.id, exists: snap.exists, data });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/data/query', async (req, res) => {
    try {
      const caller = await callerOf(req);
      const profile = profileReader();
      const b = req.body ?? {};
      const c = parseCollectionPath(b.collection);
      let q: any = collectionFor(store, c);
      for (const [field, op, value] of Array.isArray(b.where) ? b.where : []) q = q.where(field, op, value);
      for (const [field, dir] of Array.isArray(b.orderBy) ? b.orderBy : []) q = q.orderBy(field, dir === 'desc' ? 'desc' : 'asc');
      if (b.startAfter && typeof b.startAfter.id === 'string') {
        const ref = collectionFor(store, c).doc(b.startAfter.id);
        q = q.startAfter(new DocumentSnapshot(ref, JSON.stringify(b.startAfter.data ?? {})));
      }
      // A cap, like a Firestore read budget: no browser query reads a whole table.
      const limit = Math.min(Math.max(Number(b.limit) || 1000, 1), 2000);
      q = q.limit(limit);
      const snap = await q.get();
      const docs: { id: string; data: Doc }[] = [];
      for (const d of snap.docs) {
        const data = d.data() as Doc;
        // Firestore refuses the WHOLE query when any result is not readable.
        if (!(await canRead({ collection: c.collection, id: d.id, parentId: c.parentId }, data, caller, profile))) throw denied();
        docs.push({ id: d.id, data });
      }
      res.json({ docs });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/data/commit', async (req, res) => {
    try {
      const caller = await callerOf(req);
      const profile = profileReader();
      const writes = Array.isArray(req.body?.writes) ? req.body.writes : [];
      if (!writes.length || writes.length > 500) throw badRequest('Between 1 and 500 writes.');
      await store._withTx(async (conn) => {
        const touched = new Map<string, { path: DocPath; ref: DocumentReference; before: Doc | null }>();
        for (const w of writes) {
          const p = parsePath(w.path);
          const ref = refFor(store, p);
          const key = `${p.collection}\u0000${p.parentId ?? ''}\u0000${p.id}`;
          if (!touched.has(key)) {
            const [snap] = await store._read(conn, [ref], true);
            touched.set(key, { path: p, ref, before: snap.exists ? (snap.data() as Doc) : null });
          }
          const data = w.data === undefined ? undefined : (decode(w.data) as Doc);
          if (w.type === 'set') await store._apply(conn, { kind: 'set', ref, data: data ?? {}, options: Array.isArray(w.mergeFields) ? { mergeFields: w.mergeFields.map(String) } : w.merge ? { merge: true } : undefined } as any);
          else if (w.type === 'update') await store._apply(conn, { kind: 'update', ref, data: data ?? {} } as any);
          else if (w.type === 'delete') await store._apply(conn, { kind: 'delete', ref } as any);
          else throw badRequest(`Unknown write type "${w.type}".`);
        }
        // Each document is judged on how it ends up, as Firestore judges a batch.
        for (const { path, ref, before } of touched.values()) {
          const [snap] = await store._read(conn, [ref], true);
          const after = snap.exists ? (snap.data() as Doc) : null;
          const kind = !after ? 'delete' : before ? 'update' : 'create';
          if (!after && !before) continue;   // deleting what was not there
          if (!(await canWrite(kind, path, before, after, caller, profile))) throw denied();
        }
      });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  // ───────────────────────────── Files ─────────────────────────────

  const MAX_BYTES = 50 * 1024 * 1024;
  const allowedType = (t: string) => t.startsWith('image/') || t === 'application/pdf' || t === 'application/postscript';
  async function mayWriteFile(filePath: string, caller: Caller | null, profile: ReturnType<typeof profileReader>): Promise<boolean> {
    if (!caller) return false;
    const admin = caller.claims.admin === true || (await profile(caller.uid))?.role === 'admin';
    if (filePath.startsWith('public/')) return admin;
    const owner = filePath.split('/')[1];
    return owner === caller.uid || admin;
  }

  app.post('/api/files/upload', express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
    try {
      const caller = await callerOf(req);
      const profile = profileReader();
      const filePath = cleanFilePath(req.query.path);
      if (!filePath) throw badRequest('That is not a storable path.');
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const contentType = String(req.query.contentType || req.get('content-type') || 'application/octet-stream').slice(0, 120);
      if (!(await mayWriteFile(filePath, caller, profile))) throw denied();
      if (body.length >= MAX_BYTES) throw Object.assign(new Error('File too large.'), { status: 413, code: 'resource-exhausted' });
      // storage.rules: the private tree takes print files only; the public tree anything an admin sends.
      if (filePath.startsWith('uploads/') && !allowedType(contentType)) throw denied();
      const { token, size } = await files.save(filePath, body, { contentType, ownerId: filePath.startsWith('uploads/') ? filePath.split('/')[1] : caller!.uid });
      res.json({ path: filePath, url: fileUrl(filePath, token), size, contentType });
    } catch (err) { fail(res, err); }
  });

  app.post('/api/files/delete', async (req, res) => {
    try {
      const caller = await callerOf(req);
      const filePath = cleanFilePath(req.body?.path);
      if (!filePath) throw badRequest('That is not a stored path.');
      if (!(await mayWriteFile(filePath, caller, profileReader()))) throw denied();
      if (!(await files.remove(filePath))) throw Object.assign(new Error('No such file.'), { status: 404, code: 'storage/object-not-found' });
      res.json({ ok: true });
    } catch (err) { fail(res, err); }
  });

  /** getDownloadURL() of a file that was not just uploaded: its URL, to whoever may read it. */
  app.post('/api/files/url', async (req, res) => {
    try {
      const caller = await callerOf(req);
      const filePath = cleanFilePath(req.body?.path);
      if (!filePath) throw badRequest('That is not a stored path.');
      const row = await files.find(filePath);
      if (!row) throw Object.assign(new Error('No such file.'), { status: 404, code: 'storage/object-not-found' });
      if (row.visibility !== 'public' && !(await mayWriteFile(filePath, caller, profileReader()))) throw denied();
      res.json({ url: fileUrl(filePath, FileStore.token(row)) });
    } catch (err) { fail(res, err); }
  });

  app.get('/files/*', async (req, res) => {
    try {
      const filePath = cleanFilePath(decodeURIComponent(String((req.params as Record<string, string>)[0] ?? '')));
      const row = filePath ? await files.find(filePath) : null;
      // A private file needs its token — exactly what a tokenised Firebase URL was.
      if (!row || (row.visibility !== 'public' && String(req.query.token ?? '') !== FileStore.token(row))) return res.status(404).send('Not found');
      const stream = files.open(row);
      if (!stream) return res.status(404).send('Not found');
      res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
      res.setHeader('Content-Length', String(row.size_bytes));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Served from the shop's own origin, so an uploaded SVG or HTML must never
      // run as a page here: no scripts, nothing loaded, a sandboxed document.
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      res.setHeader('Cache-Control', row.visibility === 'public' ? 'public, max-age=31536000, immutable' : 'private, max-age=3600');
      stream.pipe(res);
    } catch (err) { fail(res, err); }
  });
}
