#!/usr/bin/env -S npx tsx
// COPY A FIRESTORE PROJECT INTO THE SHOP'S MYSQL DATABASE — migration/PLAN.md, step 5.
//
//   npx tsx scripts/migrate/firestore-to-mysql.ts [--reset] [--service-account <file>] [--database <id>] [--bucket <name>]
//
// Source: the LOCAL emulators when FIRESTORE_EMULATOR_HOST is set (test mode),
// otherwise the real project through a service-account file. Target: MYSQL_URL.
//
// What it copies, in this order:
//   1. Storage — every object, with its content type and custom metadata, KEEPING
//      its download token; old Firebase URLs are then rewritten to /files/… with
//      the same token, so every link stored anywhere keeps working.
//   2. Firestore — every collection and subcollection. Mapped ones go to their
//      tables (src/lib/db/tableMap.ts, through the same DocStore the shop uses);
//      anything else to legacy_documents, listed in the report. Timestamps become
//      ISO strings, the format the code already writes.
//   3. Auth — every account but anonymous ones, with Firebase's password hash, so
//      customers keep their passwords (src/lib/db/localAuth.ts checks it once).
//
// Re-runnable: rows are replaced, not duplicated. --reset empties the tables first.
// Ends with a report — counts per collection, source against target, and every
// value it had to convert. Switch the shop over only when the report is clean.

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeApp, cert, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint, DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getDocStore } from '../../src/lib/db/index';
import { TABLES, SUBCOLLECTIONS } from '../../src/lib/db/tableMap';
import { FileStore, cleanFilePath, fileUrl } from '../../src/lib/db/fileStore';

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const RESET = args.includes('--reset');
const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const PUBLIC = String(process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');

const report = { converted: [] as string[], legacy: [] as string[], failed: [] as string[], counts: {} as Record<string, [number, number]> };

// ── Source ──
let app: App;
let projectId: string;
if (emulator) {
  projectId = process.env.GCLOUD_PROJECT || 'demo-reklamx';
  app = initializeApp({ projectId, storageBucket: opt('--bucket') ?? `${projectId}.appspot.com` }, 'copy');
} else {
  const file = opt('--service-account') ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!file) throw new Error('Give --service-account <file> (or set FIRESTORE_EMULATOR_HOST for the local emulators).');
  const sa = JSON.parse(readFileSync(file, 'utf8'));
  const appConfig = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
  projectId = sa.project_id;
  app = initializeApp({ credential: cert(sa), projectId, storageBucket: opt('--bucket') ?? appConfig.storageBucket }, 'copy');
}
const appConfig = (() => { try { return JSON.parse(readFileSync('firebase-applet-config.json', 'utf8')); } catch { return {}; } })();
const databaseId = opt('--database') ?? (emulator ? '(default)' : appConfig.firestoreDatabaseId || '(default)');
const fsdb: Firestore = getFirestore(app, databaseId);

// ── Target ──
const store = getDocStore();
if (!store) throw new Error('MYSQL_URL is not set.');
const files = new FileStore(store.pool);

if (RESET) {
  const [tables] = await store.pool.query<any[]>('SHOW TABLES');
  await store.pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of tables) await store.pool.query(`DELETE FROM \`${Object.values(t)[0]}\``);
  await store.pool.query('SET FOREIGN_KEY_CHECKS = 1');
  console.log('▸ emptied every table');
}

// ── 1. Storage ──
const urlMap = new Map<string, string>();   // object path → new URL
try {
  const bucket = getStorage(app).bucket();
  const [objects] = await bucket.getFiles();
  console.log(`▸ storage: ${objects.length} files in ${bucket.name}`);
  for (const o of objects) {
    const clean = cleanFilePath(o.name);
    if (!clean) { report.failed.push(`storage ${o.name}: not under public/ or uploads/ — not copied`); continue; }
    const [data] = await o.download();
    const meta = (o.metadata?.metadata ?? {}) as Record<string, string>;
    const { token } = await files.save(clean, data, { contentType: String(o.metadata?.contentType ?? 'application/octet-stream'), metadata: meta, legacyPath: o.name });
    urlMap.set(o.name, `${PUBLIC}${fileUrl(clean, clean.startsWith('public/') ? null : token)}`);
  }
} catch (err: any) {
  report.failed.push(`storage: ${err?.message ?? err} — no files copied`);
}

/** Firebase download URLs (real or emulator) → the shop's own, matched by object path. */
const FB_URL = /https?:\/\/(?:firebasestorage\.googleapis\.com|127\.0\.0\.1:9199|localhost:9199)\/v0\/b\/[^/]+\/o\/([^?#"'\s]+)(?:\?[^"'\s]*)?/g;
function rewriteUrls(s: string): string {
  return s.replace(FB_URL, (whole, enc) => {
    const objectPath = decodeURIComponent(enc);
    const mapped = urlMap.get(objectPath);
    if (mapped) return mapped;
    report.failed.push(`a link to ${objectPath}, which is not in storage`);
    return whole;
  });
}

/** A Firestore value → plain JSON, every conversion recorded. */
function plain(v: unknown, where: string): unknown {
  if (v instanceof Timestamp) { report.converted.push(`${where}: Timestamp → ISO`); return v.toDate().toISOString(); }
  if (v instanceof GeoPoint) { report.converted.push(`${where}: GeoPoint → {latitude, longitude}`); return { latitude: v.latitude, longitude: v.longitude }; }
  if (v instanceof DocumentReference) { report.converted.push(`${where}: reference → path`); return v.path; }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) { report.converted.push(`${where}: bytes → base64`); return Buffer.from(v as Uint8Array).toString('base64'); }
  if (typeof v === 'number' && !Number.isFinite(v)) { report.converted.push(`${where}: ${v} → null`); return null; }
  if (typeof v === 'string') return v.includes('/v0/b/') ? rewriteUrls(v) : v;
  if (Array.isArray(v)) return v.map((x, i) => plain(x, `${where}[${i}]`));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x, `${where}.${k}`)]));
  return v;
}

// ── 2. Firestore ──
async function copyCollection(col: FirebaseFirestore.CollectionReference, parentKey: string | null, parentId: string | null) {
  const key = parentKey ? `${parentKey}/${col.id}` : col.id;
  const mapped = parentKey ? SUBCOLLECTIONS[key] : TABLES[key];
  const snap = await col.get();
  let written = 0;
  for (const d of snap.docs) {
    const data = plain(d.data(), `${d.ref.path}`) as Record<string, unknown>;
    try {
      if (mapped) {
        const ref = parentKey
          ? store!.collection(parentKey).doc(parentId!).collection(col.id).doc(d.id)
          : store!.collection(key).doc(d.id);
        await ref.set(data);
      } else {
        await store!.pool.query('INSERT INTO legacy_documents (path_hash, path, data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
          [crypto.createHash('sha256').update(d.ref.path).digest('hex'), d.ref.path, JSON.stringify(data)]);
      }
      written++;
    } catch (err: any) {
      report.failed.push(`${d.ref.path}: ${err?.message ?? err}`);
    }
    for (const sub of await d.ref.listCollections()) await copyCollection(sub, key, d.id);
  }
  if (!mapped && snap.size) report.legacy.push(`${key} (${snap.size}) → legacy_documents`);
  const [a, b] = report.counts[key] ?? [0, 0];
  report.counts[key] = [a + snap.size, b + written];
}
const top = await fsdb.listCollections();
console.log(`▸ firestore (${databaseId}): ${top.map((c) => c.id).join(', ')}`);
for (const col of top) await copyCollection(col, null, null);

// ── 3. Auth ──
let accounts = 0, anonymous = 0;
try {
  const auth = getAuth(app);
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      if (!u.email && !u.providerData.length) { anonymous++; continue; }
      const google = u.providerData.find((p) => p.providerId === 'google.com');
      const data = { displayName: u.displayName ?? null, photoURL: u.photoURL ?? null, customClaims: u.customClaims ?? {}, providerData: u.providerData.map((p) => p.toJSON()) };
      await store.pool.query(
        `INSERT INTO auth_accounts (id, login_email, email_verified, disabled, firebase_hash, firebase_salt, google_sub, created_at, last_login_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE login_email=VALUES(login_email), email_verified=VALUES(email_verified), disabled=VALUES(disabled),
           firebase_hash=IF(password_hash IS NULL, VALUES(firebase_hash), firebase_hash), firebase_salt=IF(password_hash IS NULL, VALUES(firebase_salt), firebase_salt),
           google_sub=VALUES(google_sub), data=VALUES(data)`,
        [u.uid, u.email ? u.email.toLowerCase() : null, u.emailVerified ? 1 : 0, u.disabled ? 1 : 0,
         u.passwordHash ?? null, u.passwordSalt ?? null, google?.uid ?? null,
         u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null,
         u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
         JSON.stringify(data)]);
      accounts++;
    }
    pageToken = page.pageToken;
  } while (pageToken);
} catch (err: any) {
  report.failed.push(`auth: ${err?.message ?? err}`);
}

// ── Report ──
console.log('\n═══ REPORT ═══');
console.log('collection'.padEnd(34), 'firestore'.padStart(9), 'mysql'.padStart(7));
for (const [k, [a, b]] of Object.entries(report.counts).sort()) console.log(`${k.padEnd(34)} ${String(a).padStart(9)} ${String(b).padStart(7)}${a !== b ? '   ✗' : ''}`);
console.log(`accounts: ${accounts} copied, ${anonymous} anonymous skipped · files: ${urlMap.size}`);
const convertedKinds = new Map<string, number>();
for (const c of report.converted) { const k = c.replace(/^.*: /, ''); convertedKinds.set(k, (convertedKinds.get(k) ?? 0) + 1); }
for (const [k, n] of convertedKinds) console.log(`converted: ${n} × ${k}`);
for (const l of report.legacy) console.log(`unmapped: ${l}`);
for (const f of report.failed.slice(0, 50)) console.log(`✗ ${f}`);
if (report.failed.length > 50) console.log(`✗ … and ${report.failed.length - 50} more`);
console.log(report.failed.length ? `\n✗ ${report.failed.length} problems — fix before switching over` : '\n✓ clean');
await store.pool.end();
process.exit(report.failed.length ? 1 : 0);
