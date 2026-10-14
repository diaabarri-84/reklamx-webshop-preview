#!/usr/bin/env node
// The price Google is told — in the feed and on the page — must be ONE number.
//
// WHY IT EXISTS. On 2026-09-13, measured against production: the product page
// for CRYSTAL display stand A4 and its own structured data both said 161.00 SEK,
// while buildProductFeed would have published 201.25 SEK for the same product —
// net versus gross, a 25% gap. Merchant Center fetches the landing page, compares
// it with the feed, and calls that a price mismatch; enough of them suspends the
// account. The Shopping panel's only warning box said the two agreed.
//
// Two functions in the same file computed it two different ways and nothing
// compared them. This does, on every build.
//
//   node scripts/test-seo-price.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-seo-'));
const out = join(outDir, 'seo.mjs');
await build({
  entryPoints: [join(ROOT, 'server-seo.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  external: ['firebase-admin', 'firebase-admin/*'],
});
const { metaForPath, buildProductFeed, setCatalogueSource, getCatalogue } = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond, d = '') => { if (cond) console.log(`  ✅ ${name}${d ? ` — ${d}` : ''}`); else { failed += 1; console.error(`  ❌ ${name}${d ? ` — ${d}` : ''}`); } };

// The real product from the measurement, and one on offer.
const PRODUCTS = [
  { id: 'p1', slug: 'crystal-display-stand-a4', name: 'CRYSTAL display stand A4', basePrice: 161, images: ['/a.png'], description: 'A stand.' },
  { id: 'p2', slug: 'rollup-85', name: 'Rullbanner 85', basePrice: 2000, salePrice: 1490, images: ['/b.png'], description: 'A banner.' },
];
const CTX = {
  origin: 'https://shop.example.se',
  siteName: 'ReklamX',
  products: PRODUCTS,
  defaultImage: 'https://shop.example.se/og-image.png',
  vatRate: 0.25,
  seo: { merchant: { enabled: true } },
};

const priceInJsonLd = (slug) => {
  const meta = metaForPath(`/products/${slug}`, CTX);
  const offer = (meta.jsonLd ?? []).map((b) => b?.offers).find(Boolean);
  return offer ? Number(offer.price) : undefined;
};
const feed = buildProductFeed(PRODUCTS, { origin: CTX.origin, siteName: CTX.siteName, seo: CTX.seo, vatRate: 0.25 });
const priceInFeed = (slug) => {
  const block = feed.split('<item>').find((b) => b.includes(`/products/${slug}`));
  const m = block && block.match(/<g:price>([\d.]+) SEK<\/g:price>/);
  return m ? Number(m[1]) : undefined;
};
const salePriceInFeed = (slug) => {
  const block = feed.split('<item>').find((b) => b.includes(`/products/${slug}`));
  const m = block && block.match(/<g:sale_price>([\d.]+) SEK<\/g:sale_price>/);
  return m ? Number(m[1]) : undefined;
};

console.log('\nthe page and the feed quote the SAME number');
// THE MEASURED CASE: 161 net, 201.25 gross. The page said one, the feed the other.
check('the stand, in the structured data', priceInJsonLd('crystal-display-stand-a4'), 201.25);
check('the stand, in the feed', priceInFeed('crystal-display-stand-a4'), 201.25);
ok('and they are equal', priceInJsonLd('crystal-display-stand-a4') === priceInFeed('crystal-display-stand-a4'));

console.log('\nan offer is quoted at the price actually being charged');
// The structured data must quote what the shopper pays TODAY — the offer, gross.
check('the banner on offer, in the structured data', priceInJsonLd('rollup-85'), 1862.5);
check('and the feed sends the offer as g:sale_price', salePriceInFeed('rollup-85'), 1862.5);
check('with the list price as g:price', priceInFeed('rollup-85'), 2500);
ok('the structured price equals the feed SALE price, which is what is charged',
  priceInJsonLd('rollup-85') === salePriceInFeed('rollup-85'));

console.log('\nevery product in the catalogue agrees, not just the two above');
for (const p of PRODUCTS) {
  const jl = priceInJsonLd(p.slug);
  const fd = salePriceInFeed(p.slug) ?? priceInFeed(p.slug);
  ok(`${p.slug}: page ${jl} = feed ${fd}`, jl === fd);
}

console.log('\na different VAT rate moves BOTH, together');
const ctx12 = { ...CTX, vatRate: 0.12 };
const meta12 = metaForPath('/products/crystal-display-stand-a4', ctx12);
const jl12 = Number(((meta12.jsonLd ?? []).map((b) => b?.offers).find(Boolean) ?? {}).price);
const feed12 = buildProductFeed(PRODUCTS, { origin: CTX.origin, siteName: CTX.siteName, seo: CTX.seo, vatRate: 0.12 });
const fd12 = Number((feed12.split('<item>').find((b) => b.includes('crystal-display-stand-a4')).match(/<g:price>([\d.]+) SEK/) ?? [])[1]);
check('at 12% the structured price', jl12, 180.32);
ok('and the feed follows it', fd12 === jl12, `${fd12}`);

console.log('\nshipping in the feed is the owner\'s, per country (round 16)');
const feedShip = buildProductFeed(PRODUCTS, { origin: CTX.origin, siteName: CTX.siteName, seo: CTX.seo, vatRate: 0.25,
  shippingLines: [{ country: 'SE', price: '123.75' }, { country: 'NO', price: '311.25' }] });
const firstItem = feedShip.split('<item>')[1] ?? '';
check('two shipping lines per item, one per country', (firstItem.match(/<g:shipping>/g) ?? []).length, 2);
ok('Sweden at 123.75 SEK, not "free"', /<g:country>SE<\/g:country>\s*<g:price>123\.75 SEK<\/g:price>/.test(firstItem));
ok('Norway at its own price', /<g:country>NO<\/g:country>\s*<g:price>311\.25 SEK<\/g:price>/.test(firstItem));

console.log('\nthe minimum price: Google is never told less than the page charges (review 2026-10-11)');
// calcConfiguredItemPrice lifts any unit price under the product's minimum to it —
// customUploadRules.minPrice, else the shop's 149, and 0 is none. The feed and the
// structured data quoted the bare base price: 64 kr advertised, 149 charged.
const FLOORED = [
  { id: 'f1', slug: 'sticker-64', name: 'Sticker 64', basePrice: 64 },
  { id: 'f2', slug: 'sticker-own-floor', name: 'Sticker, own floor', basePrice: 64, customUploadRules: { minPrice: 100 } },
  { id: 'f3', slug: 'sticker-no-floor', name: 'Sticker, no floor', basePrice: 64, customUploadRules: { minPrice: 0 } },
  { id: 'f4', slug: 'sticker-null-floor', name: 'Sticker, emptied floor', basePrice: 64, customUploadRules: { minPrice: null } },
  { id: 'f5', slug: 'sticker-text-floor', name: 'Sticker, floor as text', basePrice: 64, customUploadRules: { minPrice: '100' } },
  { id: 'f6', slug: 'banner-offer-under-floor', name: 'Banner, offer under the floor', basePrice: 200, salePrice: 100 },
  { id: 'f7', slug: 'banner-floor-above-list', name: 'Banner, floor above the list price', basePrice: 120, salePrice: 100 },
  { id: 'f8', slug: 'banner-offer-no-floor', name: 'Banner, offer with no floor', basePrice: 100, salePrice: 80, customUploadRules: { minPrice: 0 } },
  { id: 'f9', slug: 'quote-only', name: 'Priced by its options', basePrice: 0 },
];
const fctx = { ...CTX, products: FLOORED };
const jsonLdOf = (ctx, slug) => {
  const offer = ((metaForPath(`/products/${slug}`, ctx).jsonLd ?? []).map((b) => b?.offers).find(Boolean));
  return offer ? Number(offer.price) : undefined;
};
const ffeed = buildProductFeed(FLOORED, { origin: CTX.origin, siteName: CTX.siteName, seo: CTX.seo, vatRate: 0.25 });
const feedItem = (slug) => ffeed.split('<item>').find((b) => b.includes(`/products/${slug}<`));
const feedTag = (slug, tag) => {
  const m = feedItem(slug)?.match(new RegExp(`<g:${tag}>([\\d.]+) SEK</g:${tag}>`));
  return m ? Number(m[1]) : undefined;
};
check('64 kr on the shop\'s 149 floor: the page\'s data says 186.25 (149 + VAT), not 80', jsonLdOf(fctx, 'sticker-64'), 186.25);
check('…and the feed\'s g:price the same', feedTag('sticker-64', 'price'), 186.25);
check('the product\'s own floor (100) is used, not the shop\'s', [jsonLdOf(fctx, 'sticker-own-floor'), feedTag('sticker-own-floor', 'price')], [125, 125]);
check('a floor of 0 is no floor: 64 stays 64 (80 with VAT)', [jsonLdOf(fctx, 'sticker-no-floor'), feedTag('sticker-no-floor', 'price')], [80, 80]);
check('an emptied floor (null) is the shop\'s 149, as the pricing reads it', jsonLdOf(fctx, 'sticker-null-floor'), 186.25);
check('a floor stored as text counts', jsonLdOf(fctx, 'sticker-text-floor'), 125);
check('an offer under the floor is sold AT the floor: 149, still an offer against 200',
  [jsonLdOf(fctx, 'banner-offer-under-floor'), feedTag('banner-offer-under-floor', 'sale_price'), feedTag('banner-offer-under-floor', 'price')],
  [186.25, 186.25, 250]);
check('a floor above the list price lifts both: no offer, 149', [jsonLdOf(fctx, 'banner-floor-above-list'), feedTag('banner-floor-above-list', 'price'),
  feedTag('banner-floor-above-list', 'sale_price')], [186.25, 186.25, undefined]);
check('no floor: an offer under 149 is a real offer (it read "not on offer")',
  [jsonLdOf(fctx, 'banner-offer-no-floor'), feedTag('banner-offer-no-floor', 'sale_price'), feedTag('banner-offer-no-floor', 'price')], [100, 100, 125]);
check('a product with no price is not given the floor as one: no offer on the page, not in the feed',
  [jsonLdOf(fctx, 'quote-only'), feedItem('quote-only') === undefined], [undefined, true]);
for (const p of FLOORED.filter((x) => x.basePrice > 0)) {
  const jl = jsonLdOf(fctx, p.slug);
  const fd = feedTag(p.slug, 'sale_price') ?? feedTag(p.slug, 'price');
  ok(`${p.slug}: page ${jl} = feed ${fd}`, jl === fd);
}
// The shop's own copy of the catalogue reaches these pages through toSeoProduct:
// the floor must survive it, and nothing else of customUploadRules is kept.
setCatalogueSource(async () => [
  { id: 'c1', slug: 'c1', name: 'From the shop copy', basePrice: 64, customUploadRules: { minPrice: 0, enabled: true, allowedFormats: ['pdf'] } },
  { id: 'c2', slug: 'c2', name: 'No rules at all', basePrice: 64 },
]);
const copied = await getCatalogue(null);
check('the shop copy keeps the floor, and only the floor', copied.map((x) => x.customUploadRules ?? null), [{ minPrice: 0 }, null]);
check('…and prices by it', [jsonLdOf({ ...CTX, products: copied }, 'c1'), jsonLdOf({ ...CTX, products: copied }, 'c2')], [80, 186.25]);

console.log(`\n${failed === 0 ? 'Google is told one price, and it is the one a consumer pays.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
