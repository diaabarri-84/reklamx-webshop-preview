#!/usr/bin/env node
// A supplier's product becoming one of the shop's — src/lib/suppliers/toShopProduct.ts.
//
// WHY IT EXISTS
// This is where colours stop being rows and become an option, and where a trade
// price becomes a selling price. Every number a customer is charged for an
// imported product comes out of here, and three of the cases below are ways of
// charging the wrong one.
//
// Usage:  node scripts/test-to-shop-product.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-toshop-'));
const out = join(outDir, 'toShopProduct.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'suppliers', 'toShopProduct.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const M = await import(pathToFileURL(out).href);
const slugOut = join(outDir, 'slug.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'slug.ts')],
  outfile: slugOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { slugify, uniqueSlug } = await import(pathToFileURL(slugOut).href);
rmSync(outDir, { recursive: true, force: true });
const { supplierProductToShop, sellPrice, shopProductId, supplierDisplayName } = M;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
};

const NOW = '2026-09-12T18:00:00.000Z';
const base = {
  supplier: 'easygifts', productKey: '0301',
  name: 'Metal ballpen GETAFE', nameI18n: { sv: 'Metallpenna GETAFE', da: 'Metalkuglepen GETAFE' },
  description: 'A pen', descriptionI18n: { sv: 'En penna' },
  categoryPath: ['Pens', 'Metal pens'], categoryPaths: [['Pens', 'Metal pens']],
  images: ['https://x/1.jpg', 'https://x/2.jpg'],
  variants: [
    { sku: '030108', colorName: 'black', colorI18n: { sv: 'svart' }, sourcePrice: 0.89, stock: 10, images: ['https://x/black.jpg'] },
    { sku: '030107', colorName: 'grey', colorI18n: { sv: 'grå' }, sourcePrice: 0.93, stock: 37, images: ['https://x/grey.jpg'] },
  ],
  sourcePrice: 0.89, sourceCurrency: 'EUR',
  markings: [], attributes: {}, ean: '123', brand: 'EG', supplierUrl: 'https://eg/p',
};
const opts = { rate: 11.5, marginPercent: 150, categoryId: 'pens', nowIso: NOW };
const conv = (p = base, o = opts) => supplierProductToShop(p, { ...opts, ...o }, slugify, uniqueSlug);

console.log('\nthe price');
check('0.89 EUR × 11.5 × 2.5 = 26', sellPrice(0.89, 11.5, 150), 26);
const r = conv();
check('the base price is the CHEAPEST colour', r.product.basePrice, 26);
// THE ONE A CUSTOMER WOULD NOTICE: the advertised price must be payable.
check('so the default colour adds nothing', r.product.printingFields[0].options[0].priceModifier, 0);
check('and the dearer colour carries only the difference',
  r.product.printingFields[0].options[1].priceModifier, sellPrice(0.93, 11.5, 150) - 26);

console.log('\nthe colours');
check('one field, two options', [r.product.printingFields.length, r.product.printingFields[0].options.length], [1, 2]);
check('labelled in the shop\'s languages', r.product.printingFields[0].labelI18n.sv, 'Färg');
check('the colour names are translated', r.product.printingFields[0].options[0].labelI18n.sv, 'svart');
check('each carries its own picture', r.product.printingFields[0].options[0].imageUrl, 'https://x/black.jpg');
const single = conv({ ...base, variants: [base.variants[0]] });
check('ONE colour is not a choice, so no field is created', single.product.printingFields, []);

console.log('\nwhat must never reach the product document');
for (const k of ['sourcePrice', 'sourceRate', 'marginPercent', 'supplier', 'supplierUrl']) {
  ok(`${k.padEnd(14)} stays out`, !(k in r.product));
}
check('but the readable supplier NAME is on it', r.product.supplierName, 'EasyGifts');
check('and the costs go to the closed record', [r.costs.sourcePrice, r.costs.marginPercent], [0.89, 150]);
check('with per-colour stock, which the product model has nowhere to put',
  r.costs.variants.map((v) => [v.sku, v.stock]), [['030108', 10], ['030107', 37]]);

console.log('\nrefusals');
ok('no trade price → no product', conv({ ...base, sourcePrice: null }) === null);
ok('a zero trade price → no product', conv({ ...base, sourcePrice: 0 }) === null);
ok('a zero rate → no product, never a price of 0', conv(base, { rate: 0 }) === null);
ok('a negative rate → no product', conv(base, { rate: -1 }) === null);

console.log('\nsafety of the import itself');
ok('hidden by default — a thousand products must not appear because Import was pressed',
  conv().product.isHidden === true);
ok('visible only when asked', conv(base, { hidden: false }).product.isHidden === false);
check('the id is deterministic, so a re-import UPDATES', shopProductId('easygifts', '0301'), 'prod-easygifts-0301');
ok('the same input gives the same id twice', shopProductId('easygifts', '0301') === conv().product.id);
check('an awkward key is made safe for a document id', shopProductId('easygifts', 'a/b c'), 'prod-easygifts-a-b-c');
const taken = conv(base, { takenSlugs: ['metal-ballpen-getafe'] });
ok('a slug already in use gets a different one', taken.product.slug !== 'metal-ballpen-getafe', taken.product.slug);
check('images are capped', conv({ ...base, images: Array(20).fill('https://x/a.jpg') }, { maxImages: 3 }).product.images.length, 3);

console.log('\nthe translations survive the crossing');
check('names', r.product.nameI18n, { sv: 'Metallpenna GETAFE', da: 'Metalkuglepen GETAFE' });
check('descriptions', r.product.descriptionI18n, { sv: 'En penna' });
check('an empty map becomes null, not {} — a merge would keep an empty object',
  conv({ ...base, nameI18n: {}, descriptionI18n: {} }).product.nameI18n, null);

console.log('\nsupplierDisplayName');
check('known', supplierDisplayName('promediaplus'), 'Pro Media Plus');
check('unknown is title-cased, never shown as a slug', supplierDisplayName('new_supplier'), 'New Supplier');

console.log(`\n${failed === 0 ? 'Every conversion rule holds.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
