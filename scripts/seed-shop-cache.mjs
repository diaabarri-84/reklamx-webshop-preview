#!/usr/bin/env node
// Build the server's last-known-good copy from a Firestore backup.
//
// WHY THIS EXISTS
// The server writes `.cache/catalogue.json` and `.cache/categories.json` after
// every successful read, and falls back to them when Firestore refuses one. That
// only helps once it has managed a read. On 2026-09-12 the project's free daily
// read quota ran out, and a deploy at that moment would have restarted the
// process, thrown away the warm in-memory copy the shop was still serving from,
// and found nothing on disk — turning "half the visitors see no categories" into
// "nobody sees anything".
//
// So the cache can be SEEDED from a backup instead, and shipped with the deploy.
// The files it writes are byte-identical in shape to what the server writes, and
// the server overwrites them the moment a real read succeeds.
//
// The projection here must match loadShopCatalogue() and loadShopCategories() in
// server.ts. If those change, change this — a seed with extra fields would leak
// data the field mask exists to keep out, and one with missing fields would show
// a broken card.
//
//   node scripts/seed-shop-cache.mjs .backups/firestore-2026-09-12
//
// Writes ./.cache/. Reads nothing from the network.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/seed-shop-cache.mjs <backup directory>');
  process.exit(1);
}
const DIR = resolve(source);
for (const f of ['products.json', 'categories.json']) {
  if (!existsSync(join(DIR, f))) {
    console.error(`${join(DIR, f)} not found.`);
    process.exit(1);
  }
}

/** A backup file is an object keyed by document id, or an array of documents. */
function docs(file) {
  const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw).map(([id, v]) => ({ id, ...(v ?? {}) }));
}

// Exactly the fields server.ts asks Firestore for. Anything else is either heavy
// (printingFields, every image) or none of the storefront's business.
const PRODUCT_FIELDS = [
  'name', 'nameI18n', 'description', 'descriptionI18n', 'slug', 'categoryId',
  'basePrice', 'salePrice', 'images', 'isHidden', 'isWeb2Print',
  'minQuantity', 'maxQuantity', 'stock', 'customUploadRules', 'pricingRules',
];
const CATEGORY_FIELDS = [
  'name', 'nameI18n', 'description', 'descriptionI18n', 'parentId', 'image', 'isHidden',
];

function project(doc, fields) {
  const out = { id: String(doc.id) };
  for (const f of fields) if (doc[f] !== undefined) out[f] = doc[f];
  return out;
}

const products = docs('products.json')
  .filter((p) => p.isHidden !== true)
  .map((p) => {
    const out = project(p, PRODUCT_FIELDS);
    // ONLY THE FIRST IMAGE, like the server: older products carry base64 inline
    // and a full photo set would be in every visitor's download.
    out.images = Array.isArray(p.images) && p.images.length > 0 ? [p.images[0]] : [];
    return out;
  })
  .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));

const categories = docs('categories.json')
  .filter((c) => c.isHidden !== true)
  .map((c) => project(c, CATEGORY_FIELDS))
  .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));

// A cost field reaching the storefront is the bug scripts/migrate-product-costs
// existed to close, and a backup is taken BEFORE that mask is applied — so check
// rather than trust.
const FORBIDDEN = ['sourcePrice', 'sourceCurrency', 'sourceRate', 'marginPercent', 'supplier', 'supplierUrl', 'supplierOfferId'];
const leaked = [...new Set(products.flatMap((p) => FORBIDDEN.filter((f) => f in p)))];
if (leaked.length) {
  console.error(`Refusing to write: the projection let cost fields through — ${leaked.join(', ')}`);
  process.exit(1);
}

const dir = join(ROOT, '.cache');
mkdirSync(dir, { recursive: true });
// Stamped as of NOW, not as of the backup: the stamp is what the server reports
// as `asOf`, and it means "this is the freshest copy available", which it is.
const at = Date.now();
writeFileSync(join(dir, 'catalogue.json'), JSON.stringify({ at, items: products }));
writeFileSync(join(dir, 'categories.json'), JSON.stringify({ at, items: categories }));

const kb = (o) => `${(JSON.stringify(o).length / 1024).toFixed(1)} KB`;
console.log(`from ${DIR}`);
console.log(`  .cache/catalogue.json   ${products.length} visible products   ${kb(products)}`);
console.log(`  .cache/categories.json  ${categories.length} visible categories  ${kb(categories)}`);
console.log('\nThe server replaces both the moment a real Firestore read succeeds.');
