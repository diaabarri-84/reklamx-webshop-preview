#!/usr/bin/env node
// Pro Media Plus on the shared supplier shape — src/lib/suppliers/proMediaPlus.ts.
//
// WHY IT EXISTS — plan task 3.7, and its one hard requirement: "without losing
// the 31 products or their costs". Those products are keyed `prod-pmp-<offer id>`
// and their cost records share the id, so the id this path produces has to be
// byte-identical to the one the old importer produced. If it is not, a re-import
// creates 31 duplicates and orphans the originals from the re-sync that is meant
// to maintain them.
//
// The second requirement is quieter: the old importer wrote a RICHER product than
// EasyGifts' does — stock, bullet points, a spec table, a part number. A refactor
// that silently dropped the spec table would be a worse outcome than two
// importers.
//
// Usage:  node scripts/test-promediaplus.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-pmp-'));

const bundle = async (rel, name) => {
  const out = join(outDir, name);
  await build({
    entryPoints: [join(ROOT, ...rel)], outfile: out,
    bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
};

const PMP = await bundle(['src', 'lib', 'suppliers', 'proMediaPlus.ts'], 'pmp.mjs');
const FEED = await bundle(['src', 'lib', 'supplierFeed.ts'], 'feed.mjs');
const SHOP = await bundle(['src', 'lib', 'suppliers', 'toShopProduct.ts'], 'shop.mjs');
const SLUG = await bundle(['src', 'lib', 'slug.ts'], 'slug.mjs');
const TYPES = await bundle(['src', 'lib', 'suppliers', 'types.ts'], 'types.mjs');
rmSync(outDir, { recursive: true, force: true });

const { offerToSupplierProduct, offersToSupplierProducts } = PMP;
const { parseSupplierFeed, mapOfferToProduct } = FEED;
const { supplierProductToShop, shopProductId } = SHOP;
const { slugify, uniqueSlug } = SLUG;
const { toIndexEntry } = TYPES;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond) => check(name, Boolean(cond), true);

// The feed, in the shape it actually arrives — escaped HTML inside XML, a
// breadcrumb in <cat>, attributes as <a name="…">.
const XML = `<?xml version="1.0" encoding="utf-8"?>
<offers version="1">
  <o id="47" url="https://b2b.promediaplus.pl/p/47" price="10.98" stock="18306" set="0" basket="1" tax="23">
    <name>Roll Up Compact 85x200</name>
    <imgs><main url="https://img.pmp/47-main.jpg"/><i url="https://img.pmp/47-2.jpg"/></imgs>
    <desc>&lt;h2&gt;Roll Up&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Aluminium cassette&lt;/li&gt;&lt;li&gt;Carry bag included&lt;/li&gt;&lt;/ul&gt;</desc>
    <cat>Roll Ups,Compact</cat>
    <attrs><a name="producer">Pro Media Plus</a><a name="EAN">59 01234-567890</a><a name="Kod producenta">RUC-85</a><a name="Product code">PMP-RUC85</a><a name="Width">85 cm</a></attrs>
  </o>
  <o id="48" url="https://b2b.promediaplus.pl/p/48" price="0" stock="0" set="0" basket="1" tax="23">
    <name>Unpriced thing</name>
    <imgs><main url="https://img.pmp/48.jpg"/></imgs>
    <desc>Nothing</desc>
    <cat>Roll Ups</cat>
    <attrs/>
  </o>
</offers>`;

const { offers, skipped } = parseSupplierFeed(XML);
// The parser refuses an offer with no positive price BEFORE the adapter sees it —
// a guard added when a missing price attribute imported a product costing
// nothing. So only one of the two fixture rows arrives here.
check('the unpriced row never reaches the adapter', [offers.length, skipped], [1, 1]);
const products = offersToSupplierProducts(offers);
const p = products[0];
// Built by hand, because the parser will not hand one over: the adapter still
// has to behave if a future feed prices nothing.
const unpriced = offerToSupplierProduct({
  id: '48', name: 'Unpriced thing', price: 0, stock: 0, url: '', images: [],
  description: 'Nothing', features: [], categoryPath: ['Roll Ups'], attrs: [],
});

console.log('\nthe offer becomes a SupplierProduct');
check('one offer is one product — this feed has no colour rows', products.length, 1);
check('and no variants, because the supplier sells no colours', p.variants, []);
check('the supplier slug', p.supplier, 'promediaplus');
// THE KEY THE 31 EXISTING PRODUCTS ARE STORED UNDER.
check('the product key is the offer id', p.productKey, '47');
check('the price is the feed price, in EUR net', [p.sourcePrice, p.sourceCurrency], [10.98, 'EUR']);
check('an unpriced offer carries null, not 0 — 0 would price it at the floor',
  unpriced.sourcePrice, null);
check('the breadcrumb is carried root-first', p.categoryPath, ['Roll Ups', 'Compact']);
check('and as a single path, because <cat> is one breadcrumb', p.categoryPaths, [['Roll Ups', 'Compact']]);
check('images, main first', p.images, ['https://img.pmp/47-main.jpg', 'https://img.pmp/47-2.jpg']);
check('stock from the feed', p.stock, 18306);
check('bullet points harvested from the description', p.features, ['Aluminium cassette', 'Carry bag included']);
ok('a spec table', Array.isArray(p.specs) && p.specs.length > 0);
check('the EAN, stripped of spaces and dashes — a malformed one gets rejected by Google',
  p.ean, '5901234567890');
check('the part number', p.mpn, 'RUC-85');
check('the supplier article code', p.sku, 'PMP-RUC85');
check('the brand', p.brand, 'Pro Media Plus');
check('the supplier’s own page, for the owner only', p.supplierUrl, 'https://b2b.promediaplus.pl/p/47');
// A COPY would look translated and never be corrected.
check('no translations are invented from the English', [p.nameI18n, p.descriptionI18n], [{}, {}]);
ok('every feed attribute is still readable', p.attributes.Width === '85 cm');

console.log('\nTHE ID MUST NOT MOVE — the 31 products and their cost records');
const legacy = mapOfferToProduct(offers[0], {
  rate: 11.5, marginPercent: 150, categoryMap: {}, takenSlugs: new Set(), nowIso: '2026-09-13T00:00:00.000Z',
}, slugify, uniqueSlug);
const modern = supplierProductToShop(p, {
  rate: 11.5, marginPercent: 150, takenSlugs: [], nowIso: '2026-09-13T00:00:00.000Z',
}, slugify, uniqueSlug);
check('the shared path produces the id the old importer produced', modern.product.id, legacy.product.id);
check('which is prod-pmp-<offer id>', modern.product.id, 'prod-pmp-47');
check('and shopProductId says the same on its own', shopProductId('promediaplus', '47'), 'prod-pmp-47');
// A different supplier must NOT pick up the legacy prefix.
check('another supplier is unaffected', shopProductId('easygifts', '47'), 'prod-easygifts-47');

console.log('\nand the price and the money are unchanged');
check('the selling price is the same krona', modern.product.basePrice, legacy.product.basePrice);
check('the trade price is recorded, closed, in the same currency',
  [modern.costs.sourcePrice, modern.costs.sourceCurrency], [10.98, 'EUR']);
check('the cost record names the same supplier the re-sync queries on',
  modern.costs.supplier, 'promediaplus');
check('and the same offer id the old cost records hold',
  modern.costs.supplierOfferId, legacy.costs.supplierOfferId);

console.log('\nnothing the old importer wrote is lost');
check('stock', modern.product.stock, legacy.product.stock);
check('maxQuantity is still clamped off the stock figure',
  modern.product.maxQuantity, legacy.product.maxQuantity);
check('the bullet points', modern.product.features, legacy.product.features);
check('the spec table', modern.product.specs, legacy.product.specs);
check('the part number', modern.product.mpn, legacy.product.mpn);
check('the article code', modern.product.sku, legacy.product.sku);
check('the barcode', modern.product.gtin, legacy.product.gtin);
check('the brand', modern.product.brand, legacy.product.brand);
check('the supplier name, on the product where the dashboard reads it',
  modern.product.supplierName, 'Pro Media Plus');
// THE PHANTOM SURCHARGE. Left to a default, every product gains areaSqm × 350 kr
// on a 50×70 size nobody chose — round 9's bug, which the owner could not switch off.
check('areaPriced is FALSE, explicitly', modern.product.customUploadRules.areaPriced, false);
check('and uploads are off', modern.product.customUploadRules.enabled, false);
check('no print-job setup fee on resold hardware',
  modern.product.pricingRules, { baseSetupFee: 0, volumeDiscounts: [] });
check('imported HIDDEN, as everything is', modern.product.isHidden, true);
// The trade price must never reach the product document: `products` is readable
// by anybody with a browser.
ok('no trade price on the product', modern.product.sourcePrice === undefined
  && modern.product.sourceRate === undefined && modern.product.marginPercent === undefined);
ok('and no supplier URL on it either', modern.product.supplierUrl === undefined);

console.log('\nan unpriced offer cannot become a product');
check('the shared path refuses it rather than pricing it at the floor',
  supplierProductToShop(unpriced, {
    rate: 11.5, marginPercent: 150, takenSlugs: [], nowIso: '2026-09-13T00:00:00.000Z',
  }, slugify, uniqueSlug), null);

console.log('\nthe picker index row');
check('carries the product-level stock, not "not stated"',
  toIndexEntry(p).stock, 18306);
check('one image, because the picker shows a thumbnail', toIndexEntry(p).image, 'https://img.pmp/47-main.jpg');
check('no variants to count', toIndexEntry(p).variantCount, 0);
check('and the trade price, which is why the index is closed to every browser',
  [toIndexEntry(p).sourcePrice, toIndexEntry(p).sourceCurrency], [10.98, 'EUR']);
check('no Swedish name, because the feed ships none', toIndexEntry(p).nameSv, null);

console.log(`\n${failed === 0 ? 'Pro Media Plus is on the model, and the 31 products keep their ids.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
