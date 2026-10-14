#!/usr/bin/env node
// "Browse a supplier": the order, and the search — src/lib/suppliers/supplierSearch.ts
// and the narrow role cache that keeps it alive through a read outage
// (src/lib/adminRoleCache.ts). Round 16, item 9: "ترتيب عرض المنتجات — البحث لايعمل".
//
// Usage:  node scripts/test-supplier-search.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-supsearch-'));
writeFileSync(join(dir, 'e.ts'), [
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/suppliers/supplierSearch.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/adminRoleCache.ts'))};`,
].join('\n'));
await build({ entryPoints: [join(dir, 'e.ts')], outfile: join(dir, 'e.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const S = await import(pathToFileURL(join(dir, 'e.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const row = (productKey, name, nameSv, categoryPath = [], sourcePrice = 10, stock = 100) => ({ productKey, name, nameSv, categoryPath, sourcePrice, stock });
const hits = (rows, q) => S.searchAndSort(rows, q, 'name').map((r) => r.productKey);

const rows = [
  row('A5-1', 'Notebook A5 with pen', 'Anteckningsbok A5 med penna', ['Office &amp; writing', 'Notebooks']),
  row('BAG-9', 'Recycled cotton bag', 'Återvunnen bomullspåse', ['Bags']),
  row('LH-ZM04', 'Thermo mug 500 ml', 'Termosmugg 500 ml', ['Eating &amp; drinking']),
  row('PEN-2', 'Ballpoint pen', 'Kulspetspenna', ['Writing instruments &amp; sets']),
  row('SET-1', 'Writing set', 'Skrivset', ['Office &amp; writing']),
  row('PIC-1', 'Picasso poster', 'Picasso-affisch', ['Art']),
  row('NOT-1', 'Nottingham scarf', 'Nottingham-halsduk', ['Textiles']),
  row('CASE-1', 'Phone case', 'Mobilskal', ['Electronics']),
  row('GL-1', 'Glass bottle', 'Glasflaska', ['Eating &amp; drinking']),
  row('LIN-1', 'Lincoln cap', 'Lincoln-keps', ['Textiles']),
  row('MUG-1', 'Coffee mug', 'Kaffemugg', ['Eating &amp; drinking']),
];

console.log('\n== the search finds what the old one missed ==\n');
check('every word, in ANY order ("a5 anteckningsbok" found 1 of 24 before)', [hits(rows, 'a5 anteckningsbok'), hits(rows, 'anteckningsbok a5')], [['A5-1'], ['A5-1']]);
check('accents folded: "atervunnen" finds Återvunnen, "bomullspase" finds bomullspåse', [hits(rows, 'atervunnen'), hits(rows, 'BOMULLSPASE')], [['BAG-9'], ['BAG-9']]);
check('a code with its hyphen or space left out: "lhzm04", "500ml"', [hits(rows, 'lhzm04'), hits(rows, '500ml')], [['LH-ZM04'], ['LH-ZM04']]);
check('English plurals tried as their singular: "notebooks", "bottles", "glasses"', [hits(rows, 'notebooks'), hits(rows, 'bottles'), hits(rows, 'glasses')], [['A5-1'], ['GL-1'], ['GL-1']]);
check('Swedish plurals against the Swedish name: "pennor" (in a compound, Kulspetspenna), "muggar"',
  [hits(rows, 'pennor'), hits(rows, 'muggar')], [['A5-1', 'PEN-2'], ['MUG-1', 'LH-ZM04']]);
check('a category word finds what is filed there ("office" found nothing before)', hits(rows, 'office').sort(), ['A5-1', 'SET-1']);
check('…and "&amp;" in a category is "&"', hits(rows, 'eating & drinking').length, 3);

console.log('\n== …without finding what it should not ==\n');
check('"notes" is not Nottingham, "cases" is not Picasso, "color" is not Lincoln',
  [hits(rows, 'notes'), hits(rows, 'cases'), hits(rows, 'color')], [[], ['CASE-1'], []]);
check('two words must BOTH be there', hits(rows, 'mug bag'), []);
check('a word that is only in the category comes AFTER the name matches ("set": Writing set before a pen filed under "…& sets")',
  S.searchAndSort(rows, 'set', 'name').map((r) => r.productKey), ['SET-1', 'PEN-2']);

const more = [
  row('BES-1', 'Cutlery set', 'Bestick SALZBURG', ['Kitchen']),
  row('COP-1', 'Cotton bag', 'Tygpåse COPENHAGEN', ['Bags']),
  row('STK-1', 'Sticker sheet', 'Klistermärken', ['Office']),
  row('PAR-1', 'Umbrella', 'Paraply DUBLIN', ['Rain']),
  row('BOX-1', 'Lunch box', 'Matlåda', ['Kitchen']),
  row('OP-36', 'Opener', 'Öppnare', ['Kitchen']),
  row('OP-360', 'Opener deluxe', 'Öppnare deluxe', ['Kitchen']),
  row('X-1', 'Mug OP 36 style', 'Mugg', ['Kitchen']),
];
check('an English word is not a Swedish plural: "sticker" is not Bestick, "burger" not SALZBURG, "opener" not COPENHAGEN',
  [hits(more, 'sticker'), hits(more, 'burger'), hits(more, 'opener').filter((k) => k === 'COP-1')], [['STK-1'], [], []]);
check('…while a real "-er" plural still finds its word: "paraplyer" → Paraply; "boxes" → Lunch box', [hits(more, 'paraplyer'), hits(more, 'boxes')], [['PAR-1'], ['BOX-1']]);
check('a literal hit before a plural-stem hit ("pennor": the literal one first)',
  S.searchAndSort([row('S1', 'Pen', 'Kulspetspenna', []), row('S2', 'Pens', 'Pennor i set', [])], 'pennor', 'name').map((r) => r.productKey), ['S2', 'S1']);
check('the product whose NUMBER is the query comes first ("OP 36" → OP-36, not the 360 nor the mug)',
  S.searchAndSort(more, 'OP 36', 'name')[0]?.productKey, 'OP-36');

console.log('\n== the order, his choice, in Swedish ==\n');
const sv = [row('1', 'Örn', 'Örn'), row('2', 'Apple', 'Apple'), row('3', 'Zebra', 'Zebra'), row('4', 'Ägg', 'Ägg'), row('5', 'Åra', 'Åra')];
check('name A–Ö: å, ä, ö AFTER z (they were filed under a and o)', S.searchAndSort(sv, '', 'name').map((r) => r.name), ['Apple', 'Zebra', 'Åra', 'Ägg', 'Örn']);
const priced = [row('a', 'B', 'B', [], 30), row('b', 'A', 'A', [], null), row('c', 'C', 'C', [], 10)];
check('price, low first — no price last; high first — no price last',
  [S.searchAndSort(priced, '', 'price-asc').map((r) => r.productKey), S.searchAndSort(priced, '', 'price-desc').map((r) => r.productKey)],
  [['c', 'a', 'b'], ['a', 'c', 'b']]);
const stocked = [row('a', 'A', 'A', [], 1, 5), row('b', 'B', 'B', [], 1, null), row('c', 'C', 'C', [], 1, 500)];
check('most in stock first', S.searchAndSort(stocked, '', 'stock').map((r) => r.productKey), ['c', 'a', 'b']);
const cats = [row('x', 'X', 'X', []), row('y', 'Y', 'Y', ['Bags']), row('z', 'Z', 'Z', ['Art'])];
check('by category (the default) — with no category LAST, not first', S.searchAndSort(cats, '', 'category').map((r) => r.productKey), ['z', 'y', 'x']);
check('an unknown sort is the default', [S.cleanSort('bogus'), S.cleanSort('price-desc')], ['category', 'price-desc']);
check('the category chips: decoded for the eye, the raw name kept to filter by',
  S.categoryChips([row('1', 'a', 'a', ['Eating &amp; drinking']), row('2', 'b', 'b', ['Eating &amp; drinking', 'Mugs'])]),
  [{ name: 'Eating &amp; drinking', label: 'Eating & drinking', count: 2 }, { name: 'Mugs', label: 'Mugs', count: 1 }]);

console.log('\n== who is an administrator, remembered — narrowly ==\n');
const cache = S.roleCache({ freshMs: 60_000, staleMs: 24 * 3600_000, max: 2 });
const yes = { admin: true, suspended: false, email: 'a@x', at: 1_000 };
cache.remember('u1', yes);
check('an answer of the last minute is used instead of a read; an older one is not', [!!cache.fresh('u1', 30_000), !!cache.fresh('u1', 70_000)], [true, false]);
check('a REFUSED read may go on the last positive answer, up to a day', [!!cache.stale('u1', 3600_000), !!cache.stale('u1', 25 * 3600_000)], [true, false]);
cache.remember('u2', { admin: false, suspended: false, email: null, at: 1_000 });
cache.remember('u3', { admin: true, suspended: true, email: null, at: 1_000 });
check('…never a "no" or a suspended one; and the map stays small (oldest out)', [cache.stale('u2', 2_000), cache.stale('u3', 2_000), cache.fresh('u1', 2_000)], [null, null, null]);
check('a refused read is quota / unavailable / deadline — not "not found" or "permission denied"',
  [S.isReadRefusal({ code: 8 }), S.isReadRefusal({ code: 14 }), S.isReadRefusal({ code: 4 }), S.isReadRefusal({ message: '8 RESOURCE_EXHAUSTED: Quota exceeded.' }),
    S.isReadRefusal({ code: 5 }), S.isReadRefusal({ code: 7 }), S.isReadRefusal(null)],
  [true, true, true, true, false, false, false]);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ the search and the order hold\n');
process.exit(failed ? 1 : 0);
