#!/usr/bin/env node
// What a re-sync may change — src/lib/suppliers/resync.ts.
//
// WHY IT EXISTS
// A re-sync runs unattended over hundreds of products the owner has since worked
// on. Two of the cases below are the ones that cost real money:
//
//   * a price that moves 400% is almost never a price change — it is a decimal
//     in a different place, a currency field that changed, or a rate typed with
//     a comma. This shop has already had one underpricing incident of exactly
//     that shape (3 020 kr sold for 1 490);
//   * `isHidden` and `salePrice` are HIS decisions — what he has published and
//     what he has promised. A re-sync that rewrote them would un-publish his shop
//     or publish what he held back, and he would find out from a customer.
//
// Usage:  node scripts/test-resync.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-resync-'));
const out = join(outDir, 'resync.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'suppliers', 'resync.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { planResync, movePercent, forResync, forReimport, RESYNC_WRITABLE_FIELDS } = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

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

console.log('\nmovePercent');
check('a rise', movePercent(100, 110), 10);
check('a fall', movePercent(100, 90), -10);
check('no change', movePercent(100, 100), 0);
check('from nothing is infinite, not a division by zero', movePercent(0, 50), Infinity);

console.log('\nordinary moves go through');
let plan = planResync([
  { productId: 'a', currentPrice: 100, nextPrice: 110 },
  { productId: 'b', currentPrice: 100, nextPrice: 92 },
  { productId: 'c', currentPrice: 100, nextPrice: 100 },
], 25);
check('two updates, one unchanged', [plan.updates.length, plan.outcomes.filter((o) => o.action === 'unchanged').length], [2, 1]);
check('and the new prices', plan.updates.map((u) => u.price), [110, 92]);
check('nothing refused', plan.refused.length, 0);

console.log('\nTHE GUARD — the case that cost 1 530 kr a banner');
plan = planResync([
  { productId: 'ok', currentPrice: 100, nextPrice: 120 },
  { productId: 'decimal-slip', currentPrice: 3020, nextPrice: 302 },   // a decimal moved
  { productId: 'wild-rise', currentPrice: 100, nextPrice: 900 },
], 25);
check('only the sane one is written', plan.updates.map((u) => u.productId), ['ok']);
check('both wild moves are refused', plan.refused.length, 2);
ok('and the reason names the percentage, so a human can judge it',
  /-90\.0%/.test(plan.refused[0].reason), plan.refused[0].reason);
ok('the refused entries carry both prices', plan.refused[0].from === 3020 && plan.refused[0].to === 302);

console.log('\nthe limit itself');
check('exactly at the limit is allowed', planResync([{ productId: 'a', currentPrice: 100, nextPrice: 125 }], 25).updates.length, 1);
check('a hair past it is not', planResync([{ productId: 'a', currentPrice: 100, nextPrice: 125.01 }], 25).updates.length, 0);
// A falsy check would read 0 as "no limit set" and wave everything through.
check('a limit of ZERO means change nothing, not "no limit"',
  planResync([{ productId: 'a', currentPrice: 100, nextPrice: 101 }], 0).updates.length, 0);
check('an unchanged price still passes a zero limit',
  planResync([{ productId: 'a', currentPrice: 100, nextPrice: 100 }], 0).outcomes[0].action, 'unchanged');
check('nonsense falls back to 25, not to infinity',
  planResync([{ productId: 'a', currentPrice: 100, nextPrice: 200 }], NaN).updates.length, 0);

console.log('\nprices the feed cannot supply');
plan = planResync([
  { productId: 'gone', currentPrice: 100, nextPrice: null },
  { productId: 'zero', currentPrice: 100, nextPrice: 0 },
], 25);
check('an unpriced product is left alone, never zeroed', plan.updates.length, 0);
ok('and the reason says the supplier dropped the price',
  /no longer prices/.test(plan.outcomes[0].reason), plan.outcomes[0].reason);
check('a new price for a product that had none is taken',
  planResync([{ productId: 'new', currentPrice: null, nextPrice: 50 }], 25).updates, [{ productId: 'new', price: 50 }]);

console.log('\nWHAT A RE-SYNC MAY NEVER WRITE');
const product = {
  basePrice: 200, nameI18n: { sv: 'x' }, descriptionI18n: { sv: 'y' }, images: ['a'],
  supplierName: 'EasyGifts', supplierOfferId: '1', importedAt: 'now', updatedAt: 'now',
  isHidden: false, salePrice: 99, categoryId: 'moved-by-hand', stock: 5, printingFields: [],
};
const allowed = forResync(product);
for (const k of ['isHidden', 'salePrice', 'categoryId', 'stock', 'printingFields']) {
  ok(`${k.padEnd(15)} is stripped`, !(k in allowed));
}
check('and the price does go through', allowed.basePrice, 200);
check('with the translations, which are the point of re-syncing', allowed.nameI18n, { sv: 'x' });
ok('the writable list is explicit, not a denylist that a new field joins by accident',
  RESYNC_WRITABLE_FIELDS.length === 8, String(RESYNC_WRITABLE_FIELDS.length));
check('an absent field is not written as undefined — Firestore rejects that',
  forResync({ basePrice: 1 }), { basePrice: 1 });

console.log('\nDAT-01 — A RE-IMPORT OF A PRODUCT ALREADY IN THE SHOP');
// What supplierProductToShop hands the import for a product he has worked on.
const fresh = {
  id: 'prod-easygifts-1', name: 'Mug', slug: 'mug-2', categoryId: '', basePrice: 210, salePrice: null,
  nameI18n: { sv: 'Mugg' }, descriptionI18n: null, images: ['https://supplier.example/1.jpg'],
  isHidden: true, options: [], printingFields: [], pricingRules: {}, stock: 0, createdAt: 'then',
  supplierName: 'EasyGifts', supplierOfferId: '1', importedAt: '2026-10-11T10:00:00.000Z', updatedAt: '2026-10-11T10:00:00.000Z',
};
const again = forReimport(fresh, '2026-10-11T10:00:00.000Z');
check('only the price, the translations the feed HAS, the supplier\'s references and updatedAt',
  Object.keys(again).sort(), ['basePrice', 'importedAt', 'nameI18n', 'supplierName', 'supplierOfferId', 'updatedAt']);
for (const k of ['slug', 'isHidden', 'salePrice', 'categoryId', 'options', 'printingFields', 'stock', 'createdAt', 'name']) {
  ok(`${k.padEnd(15)} is left as the shop has it`, !(k in again));
}
ok('his pictures are not swapped back for the supplier\'s', !('images' in again));
ok('a translation the feed lacks (null) does not erase the one he typed', !('descriptionI18n' in again));
check('the new price does go through', again.basePrice, 210);

console.log(`\n${failed === 0 ? 'Every re-sync rule holds.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
