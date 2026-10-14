#!/usr/bin/env node
// The EasyGifts adapter — src/lib/suppliers/easyGifts.ts.
//
// WHY IT EXISTS
// This feed is 2 792 rows that are 1 331 products, and the whole value of the
// adapter is in what it does with that difference. Get the grouping wrong and
// the shop lists the same umbrella sixteen times; get the translation join wrong
// and the Swedish names — the reason this supplier was picked first — silently
// do not arrive.
//
// The fixtures are cut down from the LIVE files, fetched 2026-09-12: the same
// keys, the same string-typed prices, the same nested category shape.
//
// Usage:  node scripts/test-easygifts.mjs
// Exit:   0 = every rule holds

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-eg-'));
const outFile = join(outDir, 'easyGifts.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'suppliers', 'easyGifts.ts')],
  outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { parseEasyGifts, stripHtml } = await import(pathToFileURL(outFile).href);
const idxFile = join(outDir, 'types.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'suppliers', 'types.ts')],
  outfile: idxFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { toIndexEntry } = await import(pathToFileURL(idxFile).href);
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

/** One product in three colours, plus a second product — the real row shape. */
const row = (codeShort, codeFull, name, colorName, extra = {}) => ({
  baseinfo: { id: '41', code_short: codeShort, code_full: codeFull, name, ean: '4064571000230',
    intro: `<p>${name} intro</p>`, detailed_content: '<p>long</p>' },
  url: `https://easygifts.com.pl/p/${codeFull}`,
  color: { id: '73', name: colorName, code: '07' },
  brand: { name: 'EasyGifts' },
  attributes: { size: '14 x ⌀ 1 cm', weight: '0,021 kg', pack_small: '50', new: '' },
  images: [{ file: `https://www.easygifts.com.pl/img/${codeFull}.jpg` }],
  categories: [
    { id: '2', name: 'Pens', subcategory: { id: '202', name: 'Metal pens' } },
    { id: '2', name: 'Pens', subcategory: { id: '211', name: 'Special pens' } },
  ],
  markings: [{ id: '5', name: 'L1 (laser)', code: 'L1', size: '5 x 0,6 cm', colors_max: '1' }],
  ...extra,
});

const EN = [
  row('0301', '030107', 'Metal 2-in-1 ballpen GETAFE', 'grey'),
  row('0301', '030108', 'Metal 2-in-1 ballpen GETAFE', 'black'),
  row('0301', '030109', 'Metal 2-in-1 ballpen GETAFE', 'blue'),
  row('0466', '046608', 'Notebook LISBOA', 'red'),
];
const SV = [
  row('0301', '030107', 'Metallpenna 2w1 GETAFE', 'grå'),
  row('0301', '030108', 'Metallpenna 2w1 GETAFE', 'svart'),
  row('0301', '030109', 'Metallpenna 2w1 GETAFE', 'blå'),
  row('0466', '046608', 'Anteckningsbok LISBOA', 'röd'),
];
const DA = [row('0301', '030107', 'Metalkuglepen 2w1 GETAFE', 'grå')];

const PRICES = { currency: 'EUR', products: [
  { code_full: '030107', price: '0.93' },
  { code_full: '030108', price: '0.89' },
  { code_full: '030109', price: '1.10' },
  { code_full: '046608', price: '2.09' },
]};
const STOCKS = [
  { code_full: '030107', stock: 37 },
  { code_full: '030108', stock: 0 },
  // 030109 is deliberately absent: stocks.json covers 2 756 of 2 792 rows.
  { code_full: '046608', stock: 12 },
];

const products = parseEasyGifts({ offers: EN, prices: PRICES, stocks: STOCKS, translations: { sv: SV, da: DA } });
const pen = products.find((p) => p.productKey === '0301');
const book = products.find((p) => p.productKey === '0466');

console.log('\nTHE GROUPING — rows are colours, not products');
check('four rows become two products', products.length, 2);
check('the pen keeps its three colours', pen.variants.length, 3);
check('and they are in a stable order', pen.variants.map((v) => v.sku), ['030107', '030108', '030109']);
check('the other product is untouched', book.variants.length, 1);
ok('the product key is code_short, not code_full', pen.productKey === '0301');

console.log('\nTHE TRANSLATIONS — the reason this supplier was picked first');
check('canonical name is the English one', pen.name, 'Metal 2-in-1 ballpen GETAFE');
check('Swedish is filled from the se file', pen.nameI18n.sv, 'Metallpenna 2w1 GETAFE');
check('Danish from the dk file', pen.nameI18n.da, 'Metalkuglepen 2w1 GETAFE');
ok('Norwegian is NOT invented from Swedish', pen.nameI18n.no === undefined,
  JSON.stringify(pen.nameI18n));
check('a product missing from a language file simply has no entry for it', book.nameI18n.da, undefined);
check('but still has the language it does have', book.nameI18n.sv, 'Anteckningsbok LISBOA');
check('colour names are translated too', pen.variants[0].colorI18n, { sv: 'grå', da: 'grå' });
check('the description comes across as TEXT, not HTML', pen.description, 'Metal 2-in-1 ballpen GETAFE intro');
check('and so does the Swedish one', pen.descriptionI18n.sv, 'Metallpenna 2w1 GETAFE intro');

console.log('\nPRICE — the lowest colour, because that is what a listing shows');
check('the pen lists from 0.89, not 0.93', pen.sourcePrice, 0.89);
check('per-colour prices are kept', pen.variants.map((v) => v.sourcePrice), [0.93, 0.89, 1.10]);
check('the currency comes from the price file', pen.sourceCurrency, 'EUR');
const noPrices = parseEasyGifts({ offers: EN, prices: null, stocks: null });
check('no price file → null, never 0', noPrices[0].sourcePrice, null);
// MEASURED, not assumed: 75 live rows carry "price": 0 and no category. They are
// stock the supplier has not priced, not stock he gives away.
const freebie = parseEasyGifts({
  offers: [row('Z', 'Z1', 'Unpriced thing', 'grey')],
  prices: { currency: 'EUR', products: [{ code_full: 'Z1', price: 0 }] },
});
check('a feed price of ZERO means "not priced", not "free"', freebie[0].sourcePrice, null);
check('and the colour carries no price either', freebie[0].variants[0].sourcePrice, null);
check('and the currency falls back to EUR, which is what this feed is', noPrices[0].sourceCurrency, 'EUR');

console.log('\nSTOCK — "not stated" is not "none"');
check('a stated stock is kept', pen.variants[0].stock, 37);
check('a stated ZERO stays zero', pen.variants[1].stock, 0);
ok('an absent one is NULL, not 0 — the feed covers 2 756 of 2 792 rows',
  pen.variants[2].stock === null, String(pen.variants[2].stock));

console.log('\nCATEGORIES');
check('root first, sub second', pen.categoryPath, ['Pens', 'Metal pens']);
check('every path the feed files it under is kept for mapping',
  pen.categoryPaths, [['Pens', 'Metal pens'], ['Pens', 'Special pens']]);

console.log('\nEVERYTHING ELSE THE PRINT TRADE NEEDS');
check('markings carry the area and the colour limit',
  pen.markings, [{ code: 'L1', name: 'L1 (laser)', size: '5 x 0,6 cm', maxColors: 1 }]);
check('empty attributes are dropped rather than stored blank', pen.attributes.new, undefined);
check('real ones are kept', pen.attributes.size, '14 x ⌀ 1 cm');
check('the EAN', pen.ean, '4064571000230');
check('images are collected from every colour', pen.images.length, 3);
ok('and are deduplicated', new Set(pen.images).size === pen.images.length);

console.log('\nTHE LANGUAGES DO NOT COVER THE SAME PRODUCTS');
// Live, 2026-09-12: en has 2 659 rows, se has 2 792, and 133 products are in
// Swedish only. Walking the canonical list alone silently drops them.
const onlySwedish = parseEasyGifts({
  offers: [row('0301', '030107', 'Metal pen', 'grey')],
  translations: { sv: [
    row('0301', '030107', 'Metallpenna', 'grå'),
    row('0999', '099901', 'Bara på svenska', 'blå'),
  ] },
});
check('a product missing from English is still imported', onlySwedish.length, 2);
const swedishOnly = onlySwedish.find((p) => p.productKey === '0999');
check('and its name falls back to the language that has one', swedishOnly.name, 'Bara på svenska');
check('while the English one still wins where it exists',
  onlySwedish.find((p) => p.productKey === '0301').name, 'Metal pen');

console.log('\nROWS THAT CANNOT BE USED');
const junk = parseEasyGifts({ offers: [
  { baseinfo: { code_full: 'x' } },                    // no product key
  { baseinfo: { code_short: 'y' } },                   // no sku
  {},                                                   // nothing at all
  row('0301', '030107', 'Fine', 'grey'),
]});
check('are skipped, never guessed into existence', junk.length, 1);
check('and the good one survives', junk[0].productKey, '0301');
const noHttp = parseEasyGifts({ offers: [row('a', 'b', 'n', 'c', { images: [{ file: 'not-a-url' }, { file: 'https://x/y.jpg' }] })] });
check('an image that is not a URL is dropped', noHttp[0].images, ['https://x/y.jpg']);

console.log('\nstripHtml');
check('paragraphs become line breaks', stripHtml('<p>one</p><p>two</p>'), 'one\ntwo');
check('entities are decoded', stripHtml('a &amp; b &nbsp;c'), 'a & b c');
check('nothing in is nothing out', stripHtml(null), '');

console.log('\nTHE SLIM INDEX — 3.1, because a 13 MB file may not reach a screen');
const entry = toIndexEntry(pen);
check('one image only', entry.image, pen.images[0]);
check('the colour count instead of the colours', entry.variantCount, 3);
check('stock summed across the colours that stated one', entry.stock, 37);
check('the Swedish name, because that is what the owner reads', entry.nameSv, 'Metallpenna 2w1 GETAFE');
ok('and it is small', JSON.stringify(entry).length < 400, `${JSON.stringify(entry).length} bytes`);
const noStock = toIndexEntry({ ...pen, variants: pen.variants.map((v) => ({ ...v, stock: null })) });
ok('with no stock stated anywhere it is null, not 0', noStock.stock === null);

console.log(`\n${failed === 0 ? 'Every EasyGifts rule holds.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
