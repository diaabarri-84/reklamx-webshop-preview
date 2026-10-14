#!/usr/bin/env node
// The supplier-feed parser and the offer → product mapping.
//
// WHY IT EXISTS
// This code turns somebody else's XML into products in a live shop, with prices
// on them. Every decision it makes — the exchange rate, the margin, which
// category, whether area pricing is on — is a decision about money, and a
// mistake repeated 635 times is 635 wrong prices in a shop that takes real
// payments. The parser is also hand-written, because a new npm dependency would
// break the deploy, so it has none of the safety a real XML library would give.
//
// Every case here runs against a FIXTURE built from the real feed's exact
// shape, with no network. Run it against the live feed with:
//   node scripts/test-supplier-feed.mjs --live
//
// Usage:  node scripts/test-supplier-feed.mjs
// Exit:   0 = every case passes, 1 = something would import wrongly

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-feed-'));

const bundle = async (rel, name) => {
  const outFile = join(outDir, name);
  await build({
    entryPoints: [join(ROOT, rel)],
    outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  return import(pathToFileURL(outFile).href);
};

const feed = await bundle('src/lib/supplierFeed.ts', 'supplierFeed.mjs');
const slugLib = await bundle('src/lib/slug.ts', 'slug.mjs');
rmSync(outDir, { recursive: true, force: true });

const {
  parseSupplierFeed, mapOfferToProduct, priceFromSource, htmlToText, extractFeatures,
  parseCategoryPath, decodeEntities, attrValue, specsOf, categoryHistogram,
} = feed;
const { slugify, uniqueSlug } = slugLib;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
};

// A fixture in the feed's exact shape, taken from offer id 47 as it really
// arrives — double-escaped HTML, relative asset links, the navigation node in
// the breadcrumb, and the trailing whitespace the supplier pads names with.
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<offers version="1">
<o id="47" url="https://b2b.promediaplus.pl/en/product/roll-up-compact-85x200.html" price="10.98" stock="18306" set="0" basket="1">
<name>
Roll Up Compact 85x200
</name>
<imgs>
<main url="https://promediaplus.pl/files/fotob/product-47.jpg"/>
<i url="https://promediaplus.pl/files/foto_add_big/foto_add-215.jpg"/>
<i url="https://promediaplus.pl/files/foto_add_big/foto_add-216.jpg"/>
<i url="https://promediaplus.pl/files/foto_add_big/foto_add-217.jpg"/>
<i url="https://promediaplus.pl/files/foto_add_big/foto_add-218.jpg"/>
</imgs>
<desc>
&lt;h2&gt;Compact Model is an amazingly light roll up system.&lt;/h2&gt; &lt;p&gt;&lt;strong&gt;PRODUCT ADVANTAGES: &lt;/strong&gt;&lt;/p&gt; &lt;ul&gt; &lt;li&gt;- price leader among our roll ups&lt;/li&gt; &lt;li&gt;- compact and easy to carry&lt;/li&gt; &lt;/ul&gt; &lt;p&gt;&lt;a href=&quot;/files/file/TS_compact.pdf&quot;&gt;&lt;img src=&quot;/files/image/123.jpg&quot; /&gt;&lt;/a&gt;&lt;/p&gt;
</desc>
<cat>
Roll Ups,List of all products in this category,Compact
</cat>
<delivery>Product ready to be<br/>send out today!</delivery>
<attrs>
<a name="producer">
Pro Media Plus
</a>
<a name="tax">23</a>
<a name="Kod producenta">5907451660010</a>
<a name="EAN">5907451660010</a>
<a name="Product code">590745</a>
<a name="Material">aluminium</a>
<a name="Product weight">2,80 kg</a>
</attrs>
</o>
<o id="48" url="https://b2b.promediaplus.pl/en/product/x.html" price="11.95" stock="0" set="0" basket="1">
<name>Roll Up Compact 85x200</name>
<imgs><main url="https://promediaplus.pl/files/fotob/product-48.jpg"/></imgs>
<desc></desc>
<cat>Roll Ups,Compact</cat>
<attrs><a name="producer">Pro Media Plus</a><a name="EAN">5907451660027</a></attrs>
</o>
<o id="BROKEN" price="not-a-number">
<name>Broken</name>
</o>
<o id="NOPRICE" url="https://b2b.promediaplus.pl/en/product/y.html" stock="4">
<name>No Price At All</name>
<imgs><main url="https://promediaplus.pl/files/fotob/product-99.jpg"/></imgs>
<cat>Roll Ups</cat>
<attrs><a name="producer">Pro Media Plus</a></attrs>
</o>
<o id="ZEROPRICE" url="https://b2b.promediaplus.pl/en/product/z.html" price="0" stock="4">
<name>Zero Price</name>
<imgs><main url="https://promediaplus.pl/files/fotob/product-98.jpg"/></imgs>
<cat>Roll Ups</cat>
<attrs><a name="producer">Pro Media Plus</a></attrs>
</o>
</offers>`;

console.log('\n== parsing ==\n');

const { offers, skipped } = parseSupplierFeed(FIXTURE);
check('two usable offers are parsed', offers.length, 2);
// A MISSING price attribute reads as '' and Number('') is 0 — finite — so an
// offer with no price at all used to pass the guard and import as a product
// costing nothing. Same for an explicit price of 0.
check('malformed, price-less and zero-priced offers are all skipped', skipped, 3);
ok('no imported offer costs nothing', offers.every((o) => o.price > 0), JSON.stringify(offers.map((o) => o.price)));

const [a, b] = offers;
check('the name is trimmed of the feed\'s padding', a.name, 'Roll Up Compact 85x200');
check('price', a.price, 10.98);
check('stock', a.stock, 18306);
check('the main image comes first', a.images[0], 'https://promediaplus.pl/files/fotob/product-47.jpg');
check('every image is collected', a.images.length, 5);

console.log('\n== the description ==\n');

// The single most important thing this parser does. The <desc> is HTML escaped
// INSIDE XML, and it contains links relative to the supplier's own domain.
ok('markup is gone', !/[<>]/.test(a.description), a.description.slice(0, 120));
ok('the words survive', /amazingly light roll up system/.test(a.description), a.description.slice(0, 120));
ok(
  "the supplier's relative asset links are gone, not just escaped",
  !a.description.includes('/files/image/') && !a.description.includes('/files/file/'),
  a.description,
);
check('bullet points become features, with the leading dash stripped', a.features, [
  'price leader among our roll ups',
  'compact and easy to carry',
]);
check('an empty description yields an empty string', b.description, '');

check('double-escaped entities decode once, in the right order', decodeEntities('&amp;lt;b&amp;gt;'), '&lt;b&gt;');
check('a script block is dropped whole', htmlToText('&lt;script&gt;alert(1)&lt;/script&gt;hello'), 'hello');
check('<br> becomes a line break, not a space', htmlToText('one&lt;br/&gt;two'), 'one\ntwo');
check('no features from markup without a list', extractFeatures('&lt;p&gt;plain&lt;/p&gt;'), []);

console.log('\n== categories ==\n');

check('the navigation node is removed from the breadcrumb', a.categoryPath, ['Roll Ups', 'Compact']);
check('the same node in another case is still removed',
  parseCategoryPath('A,LIST OF ALL PRODUCTS IN THIS CATEGORY,B'), ['A', 'B']);
check('a histogram counts by top-level category', categoryHistogram(offers), [{ name: 'Roll Ups', count: 2 }]);

console.log('\n== attributes ==\n');

check('attribute lookup is case-insensitive', attrValue(a, 'ean'), '5907451660010');
check('a missing attribute is an empty string, never undefined', attrValue(a, 'nope'), '');
check('specs exclude the identity fields, which are mapped elsewhere',
  specsOf(a), [{ label: 'Material', value: 'aluminium' }, { label: 'Product weight', value: '2,80 kg' }]);

console.log('\n== the mapping to a product ==\n');

const taken = new Set();
const opts = {
  rate: 11.5, marginPercent: 40, categoryMap: { 'Roll Ups': 'rollups' },
  takenSlugs: taken, nowIso: '2026-09-08T00:00:00.000Z',
};
const { product: p1, costs: c1 } = mapOfferToProduct(a, opts, slugify, uniqueSlug);
const { product: p2, costs: c2 } = mapOfferToProduct(b, opts, slugify, uniqueSlug);

// The formula the importer AND the dashboard's bulk margin change both use. It
// is one function precisely so the second cannot drift from the first.
check('price = trade × rate × (1 + margin)', priceFromSource(10.98, 11.5, 40), 177);
check('a zero margin sells at cost, not at zero', priceFromSource(10, 11.5, 0), 115);
check('rounding is to the krona', priceFromSource(1.01, 10, 0), 10);
check('a 100% margin doubles it', priceFromSource(10, 10, 100), 200);

check('the id is derived from the supplier offer, so a re-import updates', p1.id, 'prod-pmp-47');
// 10.98 × 11.5 × 1.40 = 176.778 → 177
check('price = EUR × rate × (1 + margin), rounded to the krona', p1.basePrice, 177);
check('the source figures are kept, so a re-sync can tell them apart',
  [c1.sourcePrice, c1.sourceCurrency, c1.sourceRate, c1.marginPercent], [10.98, 'EUR', 11.5, 40]);
check('the supplier and its B2B link are kept too', [c1.supplier, c1.supplierOfferId], ['promediaplus', '47']);
// THE COST FIELDS are kept SOMEWHERE ELSE. The product document is read whole by
// every browser and the Firestore rules let anyone read it, so a competitor could
// pull the trade price, the exact markup and the page to buy from — all sixteen
// products, no account needed. None of THESE may ever be on it again.
ok('no cost, margin, rate or supplier LINK is left on the product',
  !['sourcePrice', 'sourceCurrency', 'sourceRate', 'marginPercent', 'supplier', 'supplierUrl']
    .some((k) => k in p1),
  Object.keys(p1).filter((k) => k.startsWith('source') || k === 'supplier' || k === 'supplierUrl' || k === 'marginPercent').join(', '));

// THE NAME AND THE ROW ID are a different thing, and they are deliberately ON the
// product — "يجب وضع اسم Supplier". They answer "where did this come from" in the
// dashboard without opening a closed collection, and they let a re-sync be scoped
// to one supplier. Neither helps anyone price against us, and the name is public
// on these products already: `brand` falls back to it when the feed carries no
// producer, which it did for every one of the 110 imported so far.
check('the supplier NAME is on the product, as a display name not a slug', p1.supplierName, 'Pro Media Plus');
check('and the row id, so a re-sync can be scoped to one supplier', p1.supplierOfferId, '47');
// The distinction this test exists to hold: naming who supplies a product is not
// the same as publishing what it cost us.
ok('but the trade price is still nowhere near it',
  !('sourcePrice' in p1) && !('marginPercent' in p1) && !('supplierUrl' in p1),
  'a cost field came back onto the product');
check('the category is a real document id, never a name', p1.categoryId, 'rollups');

// THE COLLISION. Both fixtures are called "Roll Up Compact 85x200"; without the
// running set they would share one address and one of them would be unreachable.
check('the first product takes the clean slug', p1.slug, 'roll-up-compact-85x200');
ok('the second gets a different one', p2.slug !== p1.slug, `both are ${p2.slug}`);

console.log('\n== the traps this shop has already been bitten by ==\n');

check('area pricing is OFF — this is the phantom surcharge from round 9',
  p1.customUploadRules.areaPriced, false);
check('no setup fee and no volume tiers on resold hardware',
  [p1.pricingRules.baseSetupFee, p1.pricingRules.volumeDiscounts], [0, []]);
check('products arrive hidden, for review', p1.isHidden, true);
check('the barcode is digits only — Google rejects a malformed one', p1.gtin, '5907451660010');
check('no offer price is invented', p1.salePrice, null);
ok('maxQuantity is never below minQuantity, even on a zero-stock product',
  p2.maxQuantity >= p2.minQuantity, `min ${p2.minQuantity}, max ${p2.maxQuantity}, stock ${b.stock}`);
ok('no undefined reaches Firestore, which rejects it',
  !Object.values(p1).some((v) => v === undefined),
  Object.entries(p1).filter(([, v]) => v === undefined).map(([k]) => k).join(', '));
check('images are capped rather than carrying all nineteen', p1.images.length, 4);

// A product whose category the owner did not map must not be filed under a
// wrong one. It gets an empty categoryId, and the import screen shows it.
const { product: unmapped } = mapOfferToProduct(
  { ...a, categoryPath: ['Nowhere'] },
  { ...opts, takenSlugs: new Set() }, slugify, uniqueSlug,
);
check('an unmapped category leaves categoryId empty rather than guessing', unmapped.categoryId, '');

// --- optional: the real feed -----------------------------------------------
if (process.argv.includes('--live')) {
  console.log('\n== against the live feed ==\n');
  const url = 'https://b2b.promediaplus.pl/en/xml/shop_integration.xml';
  const auth = 'Basic ' + Buffer.from('info@reklamx.se:123456789').toString('base64');
  const res = await fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(120000) });
  ok(`the feed answers ${res.status}`, res.ok, `status ${res.status}`);
  const xml = await res.text();
  const live = parseSupplierFeed(xml);
  ok(`${live.offers.length} offers parsed, ${live.skipped} skipped`, live.offers.length > 500);
  ok('every offer has a name and a price',
    live.offers.every((o) => o.name && Number.isFinite(o.price)),
    'some offer is missing one');
  ok('no description carries a relative supplier link',
    live.offers.every((o) => !o.description.includes('/files/')),
    live.offers.find((o) => o.description.includes('/files/'))?.name);
  ok('no description carries markup',
    live.offers.every((o) => !/<[a-z/]/i.test(o.description)),
    live.offers.find((o) => /<[a-z/]/i.test(o.description))?.name);

  // Every product must end up at its own address.
  const set = new Set();
  const liveOpts = { ...opts, takenSlugs: set, categoryMap: {} };
  const slugs = live.offers.map((o) => mapOfferToProduct(o, liveOpts, slugify, uniqueSlug).product.slug);
  ok(`all ${slugs.length} slugs are unique`, new Set(slugs).size === slugs.length,
    `${slugs.length - new Set(slugs).size} collision(s)`);
  const ids = live.offers.map((o) => `prod-pmp-${o.id}`);
  ok('all ids are unique', new Set(ids).size === ids.length);
  console.log(`     top categories: ${categoryHistogram(live.offers).slice(0, 5).map((c) => `${c.name} (${c.count})`).join(', ')}`);
}

console.log(failed === 0 ? '\n  All supplier-feed cases pass\n' : `\n  ${failed} case(s) FAILED\n`);
process.exit(failed ? 1 : 0);
