// Move the pictures stored INSIDE the product documents out to Storage — 2026-10-09.
//
// The free database bills its daily read limit BY SIZE (~4 KB a read unit, measured in
// Cloud Monitoring). The product editor used to keep uploaded gallery pictures in the
// product document as base64; by 2026-10-09 the 87 products weighed ~9 MB, every read
// of the catalogue cost ~2 230 units, and the hourly reload alone spent more than the
// whole day's limit. The editor now uploads to Storage; this moves what it had stored.
//
//   node scripts/migrate-product-pictures.mjs            the plan (one read of the products, nothing written)
//   node scripts/migrate-product-pictures.mjs --apply    upload + replace, product by product, + refresh the shop's copy
//   node scripts/migrate-product-pictures.mjs --rollback <file> [--apply]
//
// Every data:image anywhere in a product (its gallery, an option's picture) is uploaded
// once to public/products/<hash>.<ext> — the same picture on several products is one
// file — and replaced by its download address. Before anything is written all products
// are saved to .backups/; each product is written only if it did not change since it was
// read (lastUpdateTime); a rollback file records every changed field as it was.
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
}, 'product-pictures');
const db = getFirestore(app, config.firestoreDatabaseId);
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(join(ROOT, '.backups'), { recursive: true });
const kb = (n) => `${Math.round(n / 1024)} KB`;
const size = (v) => Buffer.byteLength(JSON.stringify(v ?? null));
const units = (bytes) => Math.max(1, Math.ceil(bytes / 4096));

/** Tell the live server its copy is out of date — the dashboard's own Save does this. */
async function refreshShopCopy() {
  const owner = (await db.collection('users').where('role', '==', 'admin').limit(5).get()).docs
    .find((d) => String(d.get('email') ?? '').toLowerCase() === 'diaabarri@gmail.com');
  if (!owner) return console.log('shop copy: admin account not found — it refreshes by itself within a day');
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
  for (const [id, fields] of Object.entries(plan.products)) {
    const ref = db.collection('products').doc(id);
    const snap = await ref.get();
    console.log(`${id}: puts back ${Object.keys(fields).join(', ')}`);
    if (APPLY) await ref.update(fields, { lastUpdateTime: snap.updateTime });
  }
  if (APPLY) await refreshShopCopy(); else console.log('(plan only — add --apply)');
  process.exit(0);
}

const snap = await db.collection('products').get();
const all = snap.docs.map((d) => ({ id: d.id, data: d.data(), updateTime: d.updateTime }));
const backup = join(ROOT, '.backups', `products-live-${stamp}.json`);
writeFileSync(backup, JSON.stringify(all.map((p) => ({ id: p.id, ...p.data })), null, 1));
const totalBefore = all.reduce((n, p) => n + size(p.data), 0);
const unitsBefore = all.reduce((n, p) => n + units(size(p.data)), 0);
console.log(`products: ${all.length}, ${kb(totalBefore)} — about ${unitsBefore} read units per full read; backed up to ${backup}`);

// Every data:image in every product, with where it sits.
const found = [];
for (const p of all) {
  const walk = (v, path) => {
    if (typeof v === 'string') {
      if (/^data:image\//i.test(v)) found.push({ id: p.id, path, value: v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i]));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, [...path, k]);
  };
  walk(p.data, []);
}
const byProduct = new Map();
for (const f of found) byProduct.set(f.id, [...(byProduct.get(f.id) ?? []), f]);
for (const [id, list] of byProduct) {
  const p = all.find((x) => x.id === id);
  console.log(`  ${id.padEnd(30)} ${String(p.data.name ?? '').slice(0, 34).padEnd(35)} ${list.length} picture(s), ${kb(list.reduce((n, f) => n + f.value.length, 0))} — in ${[...new Set(list.map((f) => f.path[0]))].join(', ')}`);
}
if (found.length === 0) {
  console.log('nothing to move');
  process.exit(0);
}

// One file per distinct picture.
const files = new Map();
for (const f of found) {
  if (files.has(f.value)) continue;
  const m = f.value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.*)$/is);
  if (!m) throw new Error(`not a base64 picture at ${f.id} ${f.path.join('.')}`);
  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 20);
  const ext = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[m[1].toLowerCase()] ?? 'bin';
  files.set(f.value, { path: `public/products/${hash}.${ext}`, contentType: m[1].toLowerCase(), bytes, url: null });
}
console.log(`\n${found.length} picture value(s) in ${byProduct.size} product(s), ${files.size} distinct file(s) to upload (${kb([...files.values()].reduce((n, v) => n + v.bytes.length, 0))}).`);

const replaced = (data, list, urlOf) => {
  const next = JSON.parse(JSON.stringify(data));
  for (const f of list) {
    let o = next;
    for (const k of f.path.slice(0, -1)) o = o[k];
    o[f.path.at(-1)] = urlOf(f.value);
  }
  return next;
};
const PLACEHOLDER = 'https://firebasestorage.googleapis.com/v0/b/x/o/public%2Fproducts%2F00000000000000000000.jpg?alt=media&token=00000000-0000-0000-0000-000000000000';
const after = all.map((p) => (byProduct.has(p.id) ? replaced(p.data, byProduct.get(p.id), () => PLACEHOLDER) : p.data));
const totalAfter = after.reduce((n, d) => n + size(d), 0);
const unitsAfter = after.reduce((n, d) => n + units(size(d)), 0);
console.log(`after: ${kb(totalAfter)} (from ${kb(totalBefore)}) — about ${unitsAfter} read units per full read instead of ${unitsBefore}`);
if (!APPLY) {
  console.log('(plan only — add --apply)');
  process.exit(0);
}

const bucket = getStorage(app).bucket();
const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com';
for (const v of files.values()) {
  const token = randomUUID();
  await bucket.file(v.path).save(v.bytes, {
    contentType: v.contentType,
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } },
  });
  v.url = `${host}/v0/b/${bucket.name}/o/${encodeURIComponent(v.path)}?alt=media&token=${token}`;
  const check = await fetch(v.url, { headers: { Range: 'bytes=0-0' } });
  if (!check.ok) throw new Error(`uploaded ${v.path} but it does not answer (${check.status}) — no product written`);
}
console.log(`uploaded ${files.size} file(s), each answering`);

const rollback = { at: stamp, products: {} };
const rollbackFile = join(ROOT, '.backups', `products-pictures-rollback-${stamp}.json`);
let written = 0;
const refused = [];
for (const [id, list] of byProduct) {
  const p = all.find((x) => x.id === id);
  const next = replaced(p.data, list, (value) => files.get(value).url);
  const keys = [...new Set(list.map((f) => f.path[0]))];
  rollback.products[id] = Object.fromEntries(keys.map((k) => [k, p.data[k]]));
  writeFileSync(rollbackFile, JSON.stringify(rollback, null, 1));
  try {
    await db.collection('products').doc(id).update(Object.fromEntries(keys.map((k) => [k, next[k]])), { lastUpdateTime: p.updateTime });
    written += 1;
  } catch (err) {
    delete rollback.products[id];
    writeFileSync(rollbackFile, JSON.stringify(rollback, null, 1));
    refused.push(`${id} (${err?.code ?? err?.message ?? err})`);
  }
}
console.log(`written: ${written} product(s)${refused.length ? ` · NOT written (changed meanwhile or refused): ${refused.join(', ')}` : ''}`);
console.log('rollback file:', rollbackFile);
await refreshShopCopy();
process.exit(0);
