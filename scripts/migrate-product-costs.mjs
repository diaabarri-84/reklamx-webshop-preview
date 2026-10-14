#!/usr/bin/env node
// Move the cost book out of the world-readable catalogue.
//
// WHY THIS EXISTS
// Round 12's supplier importer wrote seven provenance fields onto each product
// document — sourcePrice, sourceCurrency, sourceRate, marginPercent, supplier,
// supplierUrl, supplierOfferId — and `products` is `allow read: if true`, because
// the storefront reads the catalogue straight out of Firestore when the API's
// cache is cold. Pulled from the live database on 2026-09-09 with no account at
// all: {"supplierUrl":"https://b2b.promediaplus.pl/en/product/…",
// "marginPercent":150,"sourcePrice":2.05} — all sixteen products, the same 150%
// margin on every one. Anyone could read the trade price, the exact markup and
// the page to buy the identical item from.
//
// Nothing in the shop reads those fields; they exist so a re-sync can tell a
// price the owner typed from one the importer wrote. So they move, whole, to
// productCosts/<same id>, which is `allow read, write: if false` — Admin SDK
// only (firestore.rules).
//
// ORDER MATTERS, and this script keeps it: every copy is committed before the
// first field is deleted. If it dies in the middle, nothing is lost and running
// it again finishes the job — the copies merge, and a product that has already
// been cleaned has nothing left to move.
//
// Deploy the code that WRITES to productCosts (src/lib/supplierFeed.ts and the
// importer in server.ts) before running this with --apply. See the header of
// scripts/deploy-rules.mjs for releasing firestore.rules itself.
//
// Nothing writes without --apply. Run scripts/backup-firestore.mjs first.
//
//   node scripts/migrate-product-costs.mjs           # print what would move
//   node scripts/migrate-product-costs.mjs --apply   # copy, then strip

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_PATH = join(ROOT, 'service-account.json');
const CONFIG_PATH = join(ROOT, 'firebase-applet-config.json');

if (!existsSync(KEY_PATH)) {
  console.error('service-account.json not found in the project root.');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
const appConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

// The shop's data lives in a NAMED database, not (default). Omitting this is the
// classic way to read an empty database and conclude the data is gone.
const DATABASE_ID = appConfig.firestoreDatabaseId || '(default)';

initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
const db = getFirestore(DATABASE_ID);

const APPLY = process.argv.includes('--apply');

// The seven, and only these seven. `importedAt` deliberately stays on the
// product: a date is not a trade secret and the dashboard reads it.
const COST_FIELDS = [
  'supplier',
  'supplierOfferId',
  'supplierUrl',
  'sourcePrice',
  'sourceCurrency',
  'sourceRate',
  'marginPercent',
];

// Firestore caps a batch at 500 operations; the rest of this project uses 400.
const BATCH = 400;

async function migrate() {
  const snap = await db.collection('products').get();
  if (snap.empty) {
    console.log('No products.');
    return;
  }

  const moves = [];
  for (const doc of snap.docs) {
    const p = doc.data();
    const costs = {};
    for (const f of COST_FIELDS) {
      // Only fields that are actually there. Firestore rejects undefined, and a
      // product the owner built by hand has none of these at all.
      if (p[f] !== undefined) costs[f] = p[f];
    }
    if (Object.keys(costs).length === 0) continue;
    moves.push({ id: doc.id, ref: doc.ref, name: String(p.name ?? doc.id), costs });
  }

  if (moves.length === 0) {
    console.log(`${snap.size} product(s) read, none carrying cost fields. Nothing to move.`);
    console.log('(That is also what a second run looks like — this script is safe to repeat.)');
    return;
  }

  // What is already on the other side, so a resumed run says so rather than
  // looking like it is about to duplicate the work.
  const existing = new Set();
  const costSnap = await db.collection('productCosts').select().get();
  costSnap.docs.forEach((d) => existing.add(d.id));

  console.log(`${moves.length} of ${snap.size} product(s) carry cost fields:\n`);
  console.log(`${'PRODUCT'.padEnd(22)} ${'COST'.padStart(9)} ${'MARGIN'.padStart(7)}  ${'FIELDS'.padStart(6)}  SUPPLIER PAGE`);
  console.log('-'.repeat(100));
  let partial = 0;
  for (const m of moves) {
    const price = m.costs.sourcePrice === undefined
      ? '—'
      : `${m.costs.sourcePrice} ${m.costs.sourceCurrency ?? ''}`.trim();
    const margin = m.costs.marginPercent === undefined ? '—' : `${m.costs.marginPercent}%`;
    const count = Object.keys(m.costs).length;
    if (count < COST_FIELDS.length) partial += 1;
    console.log(
      `${m.id.padEnd(22)} ${price.padStart(9)} ${margin.padStart(7)}  ` +
      `${`${count}/7`.padStart(6)}${existing.has(m.id) ? '*' : ' '} ` +
      `${m.costs.supplierUrl ?? '—'}`,
    );
  }
  if (existing.size) {
    console.log(`\n  * productCosts/<id> already exists for ${existing.size} product(s) — an earlier run got that far.`);
  }
  if (partial) {
    console.log(`  ${partial} product(s) carry only some of the seven. Whatever is there moves; nothing is invented.`);
  }

  console.log(`\n  → copy into productCosts/<id>, then delete the fields from products/<id>.`);
  console.log('  The product keeps basePrice, importedAt and everything a shopper sees.');

  if (!APPLY) {
    console.log('\nNothing written. Re-run with --apply to move them. Take a backup first.');
    return;
  }

  // STEP 1 — every copy first. merge:true so a re-run over a half-finished
  // migration tops the document up instead of trading one truth for another.
  let copied = 0;
  for (let i = 0; i < moves.length; i += BATCH) {
    const batch = db.batch();
    for (const m of moves.slice(i, i + BATCH)) {
      batch.set(
        db.collection('productCosts').doc(m.id),
        { ...m.costs, productId: m.id, migratedAt: new Date().toISOString() },
        { merge: true },
      );
      copied += 1;
    }
    await batch.commit();
  }
  console.log(`\nCopied ${copied} cost record(s) into productCosts.`);

  // STEP 2 — and only now the delete. FieldValue.delete() is what removes a key;
  // a merge write that simply omits it keeps the stored value, which is the most
  // repeated bug in this codebase and would leave the prices published.
  const strip = {};
  COST_FIELDS.forEach((f) => { strip[f] = FieldValue.delete(); });
  let stripped = 0;
  for (let i = 0; i < moves.length; i += BATCH) {
    const batch = db.batch();
    for (const m of moves.slice(i, i + BATCH)) {
      batch.set(m.ref, { ...strip, updatedAt: new Date().toISOString() }, { merge: true });
      stripped += 1;
    }
    await batch.commit();
  }
  console.log(`Stripped the seven fields from ${stripped} product(s).`);
  console.log('\nThe storefront caches the catalogue for ten minutes; restart the server or wait it out.');
}

try {
  await migrate();
  process.exit(0);
} catch (err) {
  console.error('Failed:', err?.message ?? err);
  process.exit(1);
}
