// Take the whole option catalogue off the 16 door-sign holders — 2026-10-10.
//
// Sixteen display products (Manta, Elite, Sonic, Gert and Puro door-sign holders)
// carried EVERY printing field the shop has — 177 fields, 169 of them on, 1 491
// options — so each of their pages showed ~167 groups of irrelevant choices (page
// counts, paper weights, front/back…) and was 24 000 px tall, and the 16 together
// weighed 7.4 MB of the catalogue's 7.6 MB: ~1 850 read units every time the
// products are read. The 67 other display products carry none (printingFields: []);
// this makes the 16 the same. The developer approved it on 2026-10-10.
//
//   node scripts/trim-door-sign-fields.mjs                 the plan (reads the 16, writes nothing)
//   node scripts/trim-door-sign-fields.mjs --apply         back up, write, refresh the shop's copy
//   node scripts/trim-door-sign-fields.mjs --rollback <file> [--apply]
//
// Each product is written only if it did not change since it was read
// (lastUpdateTime), and only if it still carries the full catalogue (≥ 100 fields).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const req = createRequire(join(ROOT, 'package.json'));
const { initializeApp, cert } = req('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore');
const { getAuth } = req('firebase-admin/auth');
const config = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
const app = initializeApp({
  credential: cert(JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'))),
  projectId: config.projectId,
}, 'door-signs');
const db = getFirestore(app, config.firestoreDatabaseId);
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync(join(ROOT, '.backups'), { recursive: true });
const kb = (n) => `${Math.round(n / 1024)} KB`;
const size = (v) => Buffer.byteLength(JSON.stringify(v ?? null));
const units = (bytes) => Math.max(1, Math.ceil(bytes / 4096));

const IDS = [695, 696, 697, 698, 699, 700, 701, 702, 703, 756, 782, 783, 789, 830, 831, 833].map((n) => `prod-pmp-${n}`);

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
    console.log(`${id}: puts back ${fields.printingFields.length} printing fields`);
    if (APPLY) await ref.update(fields, { lastUpdateTime: snap.updateTime });
  }
  if (APPLY) await refreshShopCopy(); else console.log('(plan only — add --apply)');
  process.exit(0);
}

const snaps = await db.getAll(...IDS.map((id) => db.collection('products').doc(id)));
const found = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, data: s.data(), updateTime: s.updateTime }));
const backup = join(ROOT, '.backups', `door-signs-before-${stamp}.json`);
writeFileSync(backup, JSON.stringify(found.map((p) => ({ id: p.id, ...p.data })), null, 1));
console.log(`read ${found.length} of ${IDS.length} products; backed up to ${backup}`);
const todo = [];
for (const p of found) {
  const fields = p.data.printingFields ?? [];
  const full = fields.length >= 100;
  console.log(`  ${p.id.padEnd(14)} ${String(p.data.name ?? '').slice(0, 40).padEnd(41)} ${String(fields.length).padStart(3)} fields, ${kb(size(p.data))}${full ? '' : '  — not the full catalogue, left alone'}`);
  if (full) todo.push(p);
}
const before = found.reduce((n, p) => n + size(p.data), 0);
const after = found.reduce((n, p) => n + size({ ...p.data, printingFields: todo.includes(p) ? [] : p.data.printingFields }), 0);
console.log(`these ${found.length}: ${kb(before)} → ${kb(after)} (about ${found.reduce((n, p) => n + units(size(p.data)), 0)} → ${found.reduce((n, p) => n + units(size({ ...p.data, printingFields: todo.includes(p) ? [] : p.data.printingFields })), 0)} read units)`);
if (!APPLY) {
  console.log('(plan only — add --apply)');
  process.exit(0);
}

const rollback = { at: stamp, products: {} };
const rollbackFile = join(ROOT, '.backups', `door-signs-rollback-${stamp}.json`);
let written = 0;
const refused = [];
for (const p of todo) {
  rollback.products[p.id] = { printingFields: p.data.printingFields };
  writeFileSync(rollbackFile, JSON.stringify(rollback, null, 1));
  try {
    await db.collection('products').doc(p.id).update({ printingFields: [] }, { lastUpdateTime: p.updateTime });
    written += 1;
  } catch (err) {
    delete rollback.products[p.id];
    writeFileSync(rollbackFile, JSON.stringify(rollback, null, 1));
    refused.push(`${p.id} (${err?.code ?? err?.message ?? err})`);
  }
}
console.log(`written: ${written} product(s)${refused.length ? ` · NOT written (changed meanwhile or refused): ${refused.join(', ')}` : ''}`);
console.log('rollback file:', rollbackFile);
await refreshShopCopy();
process.exit(0);
