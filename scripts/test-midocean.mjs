#!/usr/bin/env node
// The midocean adapter — src/lib/suppliers/midocean.ts. Plan task 3.8.
//
// WHY IT EXISTS, and what it is guarding:
//
//   * THE ROWS ARE NOT PRODUCTS. 15 273 variants are 2 519 masters in colours.
//     Importing rows directly puts the same bag in the catalogue sixteen times
//     and makes both the catalogue page and the search useless.
//   * THE PRICES ARE ALREADY IN SEK. Every other feed in this shop is EUR and the
//     importer multiplies by an exchange rate. An 11.5 applied to a price that is
//     already in kronor sells an 89 kr notebook for 1 024 — the 3 020 → 1 490
//     incident, in the other direction.
//   * THE CATEGORY TREE IS ON THE VARIANT, not the master.
//
// Usage:  node scripts/test-midocean.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-mo-'));
const bundle = async (rel, name) => {
  const out = join(outDir, name);
  await build({
    entryPoints: [join(ROOT, ...rel)], outfile: out,
    bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  return import(pathToFileURL(out).href);
};
const MO = await bundle(['src', 'lib', 'suppliers', 'midocean.ts'], 'mo.mjs');
const SHOP = await bundle(['src', 'lib', 'suppliers', 'toShopProduct.ts'], 'shop.mjs');
const SLUG = await bundle(['src', 'lib', 'slug.ts'], 'slug.mjs');
const TYPES = await bundle(['src', 'lib', 'suppliers', 'types.ts'], 'types.mjs');
rmSync(outDir, { recursive: true, force: true });

const { parseMidocean, priceIndex, assetUrls, toMarkings, toPrice, MIDOCEAN_CURRENCY } = MO;
const { supplierProductToShop } = SHOP;
const { slugify, uniqueSlug } = SLUG;
const { toIndexEntry } = TYPES;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond) => check(name, Boolean(cond), true);

// The shape the live probe recorded: a master, colours as variants, the category
// tree on the variant, digital assets as URLs on cdn1.midocean.com.
const PRODUCTS = {
  products: [
    {
      master_code: 'MO9243',
      master_id: 'm-1',
      product_name: 'Shopping bag',
      brand: 'Bullet',
      material: 'Cotton',
      dimensions: '38 x 42 cm',
      country_of_origin: 'IN',
      printable: 'yes',
      long_description: 'A cotton shopping bag.',
      digital_assets: [
        { url: 'https://cdn1.midocean.com/MO9243-main.jpg', type: 'image' },
        { url: 'https://cdn1.midocean.com/MO9243-datasheet.pdf', type: 'document' },
      ],
      printing_positions: [
        {
          position_id: 'front',
          print_position_type: 'Front',
          max_print_size_width: '20 cm',
          max_print_size_height: '25 cm',
          printing_techniques: [{ id: 'scr', name: 'Screen print' }],
        },
      ],
      variants: [
        {
          sku: 'MO9243-03', color_description: 'red', color_code: '05', gtin: '87 12345-678901',
          category_level1: 'Bags & travel', category_level2: 'Shopping bags',
          digital_assets: [{ url: 'https://cdn1.midocean.com/MO9243-03.jpg', type: 'image' }],
        },
        {
          sku: 'MO9243-06', color_description: 'blue', color_code: '06',
          category_level1: 'Bags & travel', category_level2: 'Shopping bags',
          digital_assets: [{ url: 'https://cdn1.midocean.com/MO9243-06.jpg', type: 'image' }],
        },
        // A colour the price list does not carry: the supplier lists it, nobody
        // may sell it at a guessed price.
        { sku: 'MO9243-99', color_description: 'gold', category_level1: 'Bags & travel' },
      ],
    },
    // A master the price list covers for none of its colours.
    {
      master_code: 'MO0001',
      product_name: 'Unpriced thing',
      variants: [{ sku: 'MO0001-01', color_description: 'black', category_level1: 'Office & writing' }],
    },
  ],
};

const PRICES = {
  price: [
    { sku: 'MO9243-03', currency: 'SEK', price: '89.00', valid_until: '2027-01-01' },
    // The same SKU again at a quantity break — a catalogue lists what ONE costs.
    { sku: 'MO9243-03', currency: 'SEK', price: '250.00' },
    { sku: 'MO9243-06', currency: 'SEK', price: '95,50' },
    // A row in another currency. Taking it would price a tenth of the catalogue
    // at a ninth of its cost.
    { sku: 'MO9243-99', currency: 'EUR', price: '8.10' },
  ],
};

console.log('\ntoPrice — the feed sends strings, and Europe writes decimals with a comma');
check('a plain string', toPrice('89.00'), 89);
check('a comma decimal — Number() would have given NaN and dropped the product',
  toPrice('95,50'), 95.5);
check('a number passes through', toPrice(12.5), 12.5);
check('zero is not a price', toPrice('0'), null);
check('and neither is nonsense or nothing', [toPrice('n/a'), toPrice(''), toPrice(null)], [null, null, null]);

console.log('\npriceIndex — SEK only, cheapest quote per SKU');
const idx = priceIndex(PRICES);
check('the single-unit price wins over the quantity break', idx.get('MO9243-03'), 89);
check('the comma decimal is indexed', idx.get('MO9243-06'), 95.5);
check('a EUR row is DROPPED, not converted or trusted', idx.has('MO9243-99'), false);
check('an absent price list is an empty index, not a crash', priceIndex(undefined).size, 0);

console.log('\nassetUrls — pictures only');
check('the PDF data sheet is not a product photograph',
  assetUrls(PRODUCTS.products[0].digital_assets), ['https://cdn1.midocean.com/MO9243-main.jpg']);
check('an absent list is empty', assetUrls(undefined), []);
check('duplicates collapse',
  assetUrls([{ url: 'https://a/1.jpg', type: 'image' }, { url: 'https://a/1.jpg', type: 'image' }]),
  ['https://a/1.jpg']);

console.log('\nthe masters become products, and the SKUs become colours');
const products = parseMidocean({ products: PRODUCTS, prices: PRICES });
check('two masters, not four rows', products.length, 2);
const p = products[0];
check('keyed on the master code, so a re-import UPDATES', p.productKey, 'MO9243');
check('three colours hang off it', p.variants.length, 3);
check('the two priced ones carry their own price',
  p.variants.slice(0, 2).map((v) => [v.sku, v.sourcePrice]),
  [['MO9243-03', 89], ['MO9243-06', 95.5]]);
check('the unpriced colour carries null, never a guess', p.variants[2].sourcePrice, null);
check('the product lists the CHEAPEST sellable colour', p.sourcePrice, 89);
// THE WHOLE POINT OF THIS SUPPLIER.
check('the currency is SEK — no conversion, unlike every other feed here',
  p.sourceCurrency, MIDOCEAN_CURRENCY);
check('stock is null, not 0: the feed does not say and 0 would empty the shop',
  [p.stock, p.variants[0].stock], [null, null]);

console.log('\nthe category tree comes off the VARIANT');
check('two levels, root first', p.categoryPath, ['Bags & travel', 'Shopping bags']);
check('and the empty third level is dropped, not carried as an empty string',
  p.categoryPath.includes(''), false);
check('the distinct paths across the colours are kept, for mapping',
  p.categoryPaths, [['Bags & travel', 'Shopping bags'], ['Bags & travel']]);

console.log('\nwhat else survives the trip');
check('the master photograph first', p.images, ['https://cdn1.midocean.com/MO9243-main.jpg']);
check('the brand', p.brand, 'Bullet');
check('the barcode, stripped — a malformed one is rejected by Google', p.ean, '8712345678901');
check('the material and the dimensions, as attributes',
  [p.attributes.Material, p.attributes.Dimensions], ['Cotton', '38 x 42 cm']);
check('the print position, with the supplier’s own size string',
  toMarkings(PRODUCTS.products[0]), [{ code: 'front', name: 'Front', size: '20 cm x 25 cm', maxColors: null }]);

console.log('\nan entirely unpriced master');
const unpriced = products[1];
check('still comes through, so the picker can show it as unpriced',
  [unpriced.productKey, unpriced.sourcePrice], ['MO0001', null]);
check('and the shared path refuses to make a product of it',
  supplierProductToShop(unpriced, { rate: 1, marginPercent: 150, takenSlugs: [], nowIso: 'x' }, slugify, uniqueSlug),
  null);

console.log('\nthrough to a shop product');
const shop = supplierProductToShop(p, {
  rate: 1, marginPercent: 150, takenSlugs: [], nowIso: '2026-09-13T00:00:00.000Z',
}, slugify, uniqueSlug);
check('the id is deterministic and names the supplier', shop.product.id, 'prod-midocean-MO9243');
// 89 × 1 × 2.5. A rate of 11.5 here would be 2 558 kr for an 89 kr bag.
check('the price is the SEK trade price plus the margin — no exchange rate',
  shop.product.basePrice, 223);
check('the cheapest colour is the advertised one, so nobody is surprised at the till',
  shop.product.printingFields[0].options[0].priceModifier, 0);
check('and the dearer colour carries the difference',
  shop.product.printingFields[0].options[1].priceModifier, 16);
check('only the SELLABLE colours are offered',
  shop.product.printingFields[0].options.length, 2);
check('the trade price is recorded closed, in SEK',
  [shop.costs.sourcePrice, shop.costs.sourceCurrency, shop.costs.sourceRate], [89, 'SEK', 1]);
ok('and never on the product document', shop.product.sourcePrice === undefined);
check('imported hidden', shop.product.isHidden, true);

console.log('\nthe picker index row');
const row = toIndexEntry(p);
check('the cheapest price and the currency', [row.sourcePrice, row.sourceCurrency], [89, 'SEK']);
check('three colours counted', row.variantCount, 3);
check('one thumbnail', row.image, 'https://cdn1.midocean.com/MO9243-main.jpg');

console.log('\nthe feed can arrive as a bare array, or wrapped');
check('wrapped in { products: [...] }', parseMidocean({ products: PRODUCTS, prices: PRICES }).length, 2);
check('or as the array itself', parseMidocean({ products: PRODUCTS.products, prices: PRICES }).length, 2);
check('nothing at all is no products, not a crash', parseMidocean({ products: undefined }), []);
check('a master with no code is skipped rather than keyed on ""',
  parseMidocean({ products: [{ product_name: 'nameless' }] }), []);

console.log(`\n${failed === 0 ? 'midocean parses to the shared shape, in kronor.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
