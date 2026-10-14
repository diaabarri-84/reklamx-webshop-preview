// Move the pictures stored INSIDE settings/siteConfig out to Storage — 2026-10-08.
//
// The free database bills its daily read limit BY SIZE (~4 KB a read unit, measured in
// Cloud Monitoring), and the UI Customizer used to store its slide and card pictures in
// the settings document as base64: ~800 KB, ~209 units every time anyone read it. That is
// what ran the shop's daily limit out (see /api/site-settings in server.ts). The
// customizer now uploads to Storage; this moves what it had already stored.
//
//   node scripts/migrate-site-pictures.mjs            the plan (one read, nothing written)
//   node scripts/migrate-site-pictures.mjs --apply    upload + replace + refresh the shop's copy
//   node scripts/migrate-site-pictures.mjs --rollback <file> [--apply]
//
// THE LOGO STAYS: the order e-mails attach it from its data: URL (src/lib/email.ts
// parseLogo). Every other data:image anywhere in the document is uploaded once (the
// same picture twice — the first slide is also heroImageUrl — is one file) to
// public/site/<hash>.<ext> and replaced by its download address. Before anything is
// written the whole document is saved to .backups/, the write is refused if the
// document changed since it was read (lastUpdateTime), and a rollback file records the
// fields as they were.
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(join(ROOT, 'package.json'));
const { initializeApp, cert } = req('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore');
const { getStorage } = req('firebase-admin/storage');
const { getAuth } = req('firebase-admin/auth');
const config = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
const app = initializeApp({
  credential: cert(JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'))),
  projectId: config.projectId,
  storageBucket: config.storageBucket,
}, 'site-pictures');
const db = getFirestore(app, config.firestoreDatabaseId);
const ref = db.collection('settings').doc('siteConfig');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(join(ROOT, '.backups'), { recursive: true });
const kb = (n) => `${Math.round(n / 1024)} KB`;
const size = (v) => Buffer.byteLength(JSON.stringify(v ?? null));

/** Tell the live server its copy is out of date — the dashboard's own Save does this. */
async function refreshShopCopy() {
  const owner = (await db.collection('users').where('role', '==', 'admin').limit(5).get()).docs
    .find((d) => String(d.get('email') ?? '').toLowerCase() === 'diaabarri@gmail.com');
  if (!owner) return console.log('shop copy: admin account not found — it refreshes by itself within the hour');
  const signed = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${config.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: await getAuth(app).createCustomToken(owner.id), returnSecureToken: true }),
  })).json();
  const shop = process.env.SHOP_URL || 'https://shop.reklamx.se';
  const r = await fetch(`${shop}/api/admin/cache/invalidate`, { method: 'POST', headers: { Authorization: `Bearer ${signed.idToken}` } });
  console.log('shop copy refreshed:', r.status);
}

if (args[0] === '--rollback') {
  const plan = JSON.parse(readFileSync(args[1], 'utf8'));
  const snap = await ref.get();
  console.log('rollback: puts back', Object.keys(plan.fields).join(', '));
  if (APPLY) {
    await ref.update(plan.fields, { lastUpdateTime: snap.updateTime });
    await refreshShopCopy();
    console.log('done');
  } else console.log('(plan only — add --apply)');
  process.exit(0);
}

const snap = await ref.get();
if (!snap.exists) throw new Error('settings/siteConfig does not exist');
const data = snap.data();
const backup = join(ROOT, '.backups', `siteConfig-live-${stamp}.json`);
writeFileSync(backup, JSON.stringify(data, null, 1));
console.log(`settings/siteConfig: ${kb(size(data))} — backed up to ${backup}`);

// Every data:image in the document, with where it sits.
const found = [];
const walk = (v, path) => {
  if (typeof v === 'string') {
    if (/^data:image\//i.test(v)) found.push({ path, value: v });
  } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
};
walk(data, []);
for (const f of found) console.log(`  ${f.path.join('.').padEnd(28)} ${kb(f.value.length)}${f.path.join('.') === 'logoUrl' ? '   (the logo — stays: the order e-mails attach it)' : ''}`);
const moving = found.filter((f) => f.path.join('.') !== 'logoUrl');
if (moving.length === 0) {
  console.log('nothing to move');
  process.exit(0);
}

// One file per distinct picture.
const files = new Map();
for (const f of moving) {
  const m = f.value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is);
  if (!m) throw new Error(`not a base64 picture at ${f.path.join('.')}`);
  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 20);
  const ext = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[m[1].toLowerCase()] ?? 'bin';
  if (!files.has(f.value)) files.set(f.value, { path: `public/site/${hash}.${ext}`, contentType: m[1].toLowerCase(), bytes, url: null });
}
console.log(`\n${moving.length} picture value(s), ${files.size} distinct file(s) to upload:`);
for (const v of files.values()) console.log(`  ${v.path}  ${kb(v.bytes.length)}  ${v.contentType}`);

if (!APPLY) {
  // What the document would weigh afterwards (an address is ~250 bytes).
  const after = JSON.parse(JSON.stringify(data));
  for (const f of moving) {
    let o = after;
    for (const k of f.path.slice(0, -1)) o = o[k];
    o[f.path.at(-1)] = 'https://firebasestorage.googleapis.com/v0/b/x/o/public%2Fsite%2F0000000000000000000000.jpg?alt=media&token=00000000-0000-0000-0000-000000000000';
  }
  console.log(`\nafter: ${kb(size(after))} (from ${kb(size(data))}) — about ${Math.ceil(size(after) / 4096)} read units a read instead of ${Math.ceil(size(data) / 4096)}`);
  console.log('(plan only — add --apply)');
  process.exit(0);
}

const bucket = getStorage(app).bucket();
for (const v of files.values()) {
  const token = randomUUID();
  await bucket.file(v.path).save(v.bytes, {
    contentType: v.contentType,
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } },
  });
  // The same address getDownloadURL() gives the dashboard's own uploads (the local
  // emulator's host when the script is tried against it).
  const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com';
  v.url = `${host}/v0/b/${bucket.name}/o/${encodeURIComponent(v.path)}?alt=media&token=${token}`;
  const check = await fetch(v.url, { headers: { Range: 'bytes=0-0' } });
  if (!check.ok) throw new Error(`uploaded ${v.path} but it does not answer (${check.status}) — nothing written to the settings`);
  console.log(`  uploaded ${v.path}`);
}

// The changed top-level fields, whole (update() replaces a field; nested arrays cannot
// be patched element by element).
const topKeys = [...new Set(moving.map((f) => f.path[0]))];
const next = JSON.parse(JSON.stringify(data));
for (const f of moving) {
  let o = next;
  for (const k of f.path.slice(0, -1)) o = o[k];
  o[f.path.at(-1)] = files.get(f.value).url;
}
const update = Object.fromEntries(topKeys.map((k) => [k, next[k]]));
const rollback = join(ROOT, '.backups', `siteConfig-pictures-rollback-${stamp}.json`);
writeFileSync(rollback, JSON.stringify({ at: stamp, fields: Object.fromEntries(topKeys.map((k) => [k, data[k]])) }, null, 1));
await ref.update(update, { lastUpdateTime: snap.updateTime });
console.log(`\nwritten: ${topKeys.join(', ')} — the document is now about ${kb(size(next))}`);
console.log('rollback file:', rollback);
await refreshShopCopy();
process.exit(0);
