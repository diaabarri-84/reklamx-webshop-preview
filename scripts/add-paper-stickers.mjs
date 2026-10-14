#!/usr/bin/env node
/**
 * Writes the Paper Stickers product — the one that demonstrates sub-options.
 *
 *   node scripts/add-paper-stickers.mjs --dry      show what would be written
 *   node scripts/add-paper-stickers.mjs --apply    write it
 *   node scripts/add-paper-stickers.mjs --remove   delete it again
 *
 * Idempotent: running --apply twice leaves the same single document. If the
 * product already exists its previous state is backed up to .backups/ first, so
 * an edit the owner made in the dashboard is never lost without a copy.
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { PAPER_STICKERS } from './data/paper-stickers-suboptions.mjs';

const mode = process.argv[2] || '--dry';
const sa = JSON.parse(readFileSync('./service-account.json', 'utf-8'));
if (!getApps().length) initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore('ai-studio-67b3d2fe-143f-469d-b3a4-49dcbdfef939');
const ref = db.collection('products').doc(PAPER_STICKERS.id);

/** Firestore rejects an explicit undefined anywhere in the document. */
const stripUndefined = (v) => {
  if (Array.isArray(v)) return v.map(stripUndefined);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) if (val !== undefined) out[k] = stripUndefined(val);
    return out;
  }
  return v;
};

const countFields = (fields) =>
  (fields ?? []).reduce(
    (n, f) => n + 1 + (f.options ?? []).reduce((m, o) => m + countFields(o.subFields), 0),
    0,
  );

if (mode === '--remove') {
  const snap = await ref.get();
  if (!snap.exists) { console.log('Nothing to remove — the product is not there.'); process.exit(0); }
  if (!existsSync('.backups')) mkdirSync('.backups');
  writeFileSync(`.backups/${PAPER_STICKERS.id}-before-remove.json`, JSON.stringify(snap.data(), null, 2));
  await ref.delete();
  console.log(`Removed ${PAPER_STICKERS.id}. A copy is in .backups/ if it is ever wanted back.`);
  process.exit(0);
}

const doc = stripUndefined({ ...PAPER_STICKERS, createdAt: new Date().toISOString() });

console.log(`\n  ${doc.name} (${doc.id})`);
console.log(`  category ${doc.categoryId} · ${doc.basePrice} SEK per sticker · from ${doc.minQuantity}`);
console.log(`  ${countFields(doc.printingFields)} fields once the nested ones are counted`);
console.log(`  visible in the shop: ${doc.isHidden ? 'no' : 'YES'}`);
console.log(`  area pricing: ${doc.customUploadRules.enabled ? 'ON' : 'off — priced by the size the customer picks'}\n`);

if (mode !== '--apply') {
  console.log('  Dry run. Re-run with --apply to write it.\n');
  process.exit(0);
}

const existing = await ref.get();
if (existing.exists) {
  if (!existsSync('.backups')) mkdirSync('.backups');
  const path = `.backups/${PAPER_STICKERS.id}-before-rewrite.json`;
  writeFileSync(path, JSON.stringify(existing.data(), null, 2));
  console.log(`  The product already existed — previous state saved to ${path}`);
  // createdAt belongs to the first write, not this one.
  doc.createdAt = existing.data().createdAt ?? doc.createdAt;
}

await ref.set(doc);
console.log(`  Written. It is live at /products/${doc.id}\n`);
process.exit(0);
