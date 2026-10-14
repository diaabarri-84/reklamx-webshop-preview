#!/usr/bin/env node
// Put the supplier's name back onto the products that were imported before it
// was written there.
//
// WHY THIS EXISTS
// The importer now writes `supplierName` and `supplierOfferId` onto the product
// — "يجب وضع اسم Supplier" — but the 110 products already in the catalogue were
// imported before that, and the only record of where they came from is
// productCosts/<id>, which no browser may open. Without this, the new column in
// the dashboard would be empty for every product he actually has.
//
// It reads productCosts and writes TWO fields onto the matching product. It does
// not touch the cost fields, it does not create products, and it never writes a
// product that has no cost record — a product the owner built by hand has no
// supplier and must not be given one.
//
// Nothing is written without --apply.
//
//   node scripts/backfill-supplier-name.mjs           # show what would change
//   node scripts/backfill-supplier-name.mjs --apply   # write it

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = join(ROOT, 'service-account.json');
if (!existsSync(KEY)) {
  console.error('service-account.json not found in the project root.');
  process.exit(1);
}
const sa = JSON.parse(readFileSync(KEY, 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore(cfg.firestoreDatabaseId || '(default)');

const APPLY = process.argv.includes('--apply');
const BATCH = 400; // the number used everywhere else in this project

/**
 * The slug stored in productCosts is not what the owner should read. Keep the
 * map next to the adapters it names; anything unknown is title-cased rather than
 * shown as a slug or left blank.
 */
const DISPLAY_NAMES = {
  promediaplus: 'Pro Media Plus',
  easygifts: 'EasyGifts',
  midocean: 'midocean',
  tedgifted: 'TedGifted',
  lshopteam: 'L-SHOP-TEAM',
};
function displayName(slug) {
  const key = String(slug ?? '').trim();
  if (!key) return null;
  return DISPLAY_NAMES[key.toLowerCase()]
    ?? key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const costSnap = await db.collection('productCosts').select('supplier', 'supplierOfferId').get();
if (costSnap.empty) {
  console.log('No productCosts documents — nothing to backfill from.');
  process.exit(0);
}

const wanted = new Map();
for (const doc of costSnap.docs) {
  const name = displayName(doc.data().supplier);
  if (!name) continue;
  wanted.set(doc.id, { supplierName: name, supplierOfferId: String(doc.data().supplierOfferId ?? '') });
}

// Only products that EXIST. A cost record whose product was deleted must not
// resurrect it as a document with two fields and no name.
const prodSnap = await db.collection('products').select('name', 'supplierName', 'supplierOfferId').get();
const changes = [];
let alreadyRight = 0;
let noCostRecord = 0;
for (const doc of prodSnap.docs) {
  const want = wanted.get(doc.id);
  if (!want) { noCostRecord += 1; continue; }
  const cur = doc.data();
  if (cur.supplierName === want.supplierName && String(cur.supplierOfferId ?? '') === want.supplierOfferId) {
    alreadyRight += 1;
    continue;
  }
  changes.push({ ref: doc.ref, id: doc.id, name: String(cur.name ?? doc.id), ...want });
}

const orphanCosts = [...wanted.keys()].filter((id) => !prodSnap.docs.some((d) => d.id === id));

console.log(`products: ${prodSnap.size}   cost records: ${costSnap.size}\n`);
console.log(`  ${changes.length} to update`);
console.log(`  ${alreadyRight} already correct`);
console.log(`  ${noCostRecord} with no cost record — built by hand, left alone`);
if (orphanCosts.length) console.log(`  ${orphanCosts.length} cost record(s) whose product is gone — ignored, not recreated`);

if (changes.length) {
  console.log(`\n${'PRODUCT'.padEnd(24)} ${'SUPPLIER'.padEnd(18)} OFFER`);
  console.log('-'.repeat(60));
  for (const c of changes.slice(0, 12)) {
    console.log(`${c.id.padEnd(24)} ${c.supplierName.padEnd(18)} ${c.supplierOfferId}`);
  }
  if (changes.length > 12) console.log(`… and ${changes.length - 12} more`);
}

if (!APPLY) {
  console.log('\nNothing written. Re-run with --apply.');
  process.exit(0);
}
if (!changes.length) {
  console.log('\nNothing to do.');
  process.exit(0);
}

let written = 0;
for (let i = 0; i < changes.length; i += BATCH) {
  const batch = db.batch();
  for (const c of changes.slice(i, i + BATCH)) {
    // merge, and only these two keys: everything else on the product — the
    // owner's own price, his visibility choice, his printing fields — is his.
    batch.set(c.ref, { supplierName: c.supplierName, supplierOfferId: c.supplierOfferId }, { merge: true });
    written += 1;
  }
  await batch.commit();
}
console.log(`\n✅ ${written} product(s) updated.`);
console.log('The storefront caches the catalogue; the dashboard reads Firestore directly and shows it at once.');
