#!/usr/bin/env node
// The test for the owner's order — categories, and the products on a category page.
//
// WHY IT EXISTS
// Until 2026-10 the shop listed everything alphabetically. The owner can now drag
// categories (Category.sortOrder) and each category page's products
// (Category.productOrder) into his own order. Three things must hold, and none of
// them shows up in a passing build:
//
//   1. nothing moves until he arranges something — an unarranged shop sorts
//      exactly as before;
//   2. arranging never hides an item: a product added later, or one his list does
//      not name, still appears, after the arranged ones;
//   3. "Show more" on an arranged page continues where it left off, even when
//      the product the cursor named has gone in the meantime.
//
// Usage:  node scripts/test-owner-order.mjs
// Exit:   0 = every case passes, 1 = an order is wrong or an item is lost

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-ownerorder-'));
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/ownerOrder.ts'))};`,
  `export { buildCategoryTree, flattenTree } from ${JSON.stringify(join(ROOT, 'src/lib/categoryTree.ts'))};`,
].join('\n'));
const outFile = join(outDir, 'bundle.mjs');
await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const lib = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

const {
  sortOrderValue, compareOwnerOrder, sortOrdersFor, rankMap, orderByIdList, pageStartAfter,
  buildCategoryTree, flattenTree,
} = lib;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
  }
};
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

// ---------------------------------------------------------------------------
console.log('\n== sortOrder ==\n');
check('a number is a number', sortOrderValue({ sortOrder: 20 }), 20);
check('absent, null, empty, junk = not arranged (+Infinity)',
  [undefined, null, '', 'x'].map((v) => sortOrderValue({ sortOrder: v }) === Number.POSITIVE_INFINITY), [true, true, true, true]);
check('no object at all = not arranged', sortOrderValue(undefined) === Number.POSITIVE_INFINITY, true);
check('zero is a real place, not "unarranged"', sortOrderValue({ sortOrder: 0 }), 0);
const cats = [{ name: 'Rollups' }, { name: 'Banners', sortOrder: 20 }, { name: 'Stickers' }, { name: 'Flags', sortOrder: 10 }];
check('arranged first, in his order; the rest by name', [...cats].sort((a, b) => compareOwnerOrder(a, b, byName)).map((c) => c.name), ['Flags', 'Banners', 'Rollups', 'Stickers']);
check('nothing arranged = exactly the old alphabetical order', [{ name: 'B' }, { name: 'A' }, { name: 'C' }].sort((a, b) => compareOwnerOrder(a, b, byName)).map((c) => c.name), ['A', 'B', 'C']);
check('the numbers written after a drag leave room between', sortOrdersFor(['c', 'a', 'b']), { c: 10, a: 20, b: 30 });

// ---------------------------------------------------------------------------
console.log('\n== The category tree follows it, level by level ==\n');
const tree = buildCategoryTree([
  { id: 'r1', name: 'Zeta', sortOrder: 10 },
  { id: 'r2', name: 'Alpha' },
  { id: 'c1', name: 'Child B', parentId: 'r1' },
  { id: 'c2', name: 'Child A', parentId: 'r1', sortOrder: 30 },
  { id: 'c3', name: 'Child C', parentId: 'r1', sortOrder: 20 },
]);
check('roots: arranged first', tree.map((n) => n.category.id), ['r1', 'r2']);
check('children: arranged first, unarranged after by name', tree[0].children.map((n) => n.category.id), ['c3', 'c2', 'c1']);
check('flattened depth-first in that order', flattenTree(tree).map((n) => n.category.id), ['r1', 'c3', 'c2', 'c1', 'r2']);

// ---------------------------------------------------------------------------
console.log('\n== A category page in his order ==\n');
const page = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }];
check('no arrangement: untouched (same array)', orderByIdList(page, undefined) === page, true);
check('his order first, the rest as they came', orderByIdList(page, ['c', 'a']).map((p) => p.id), ['c', 'a', 'b', 'd']);
check('an id for a product that is gone is ignored', orderByIdList(page, ['zz', 'd']).map((p) => p.id), ['d', 'a', 'b', 'c']);
check('a repeated id keeps its first place', orderByIdList(page, ['b', 'a', 'b']).map((p) => p.id), ['b', 'a', 'c', 'd']);
check('nothing is ever dropped', orderByIdList(page, ['d', 'c', 'b', 'a', 'x']).length, 4);
check('junk instead of a list = no arrangement', orderByIdList(page, 'nonsense').map((p) => p.id), ['a', 'b', 'c', 'd']);
check('rankMap', [...rankMap(['x', 'y', 'x'])], [['x', 0], ['y', 1]]);

// ---------------------------------------------------------------------------
console.log('\n== Show more continues where it left off ==\n');
const arranged = orderByIdList(
  [{ id: 'p1', name: 'Apple' }, { id: 'p2', name: 'Banana' }, { id: 'p3', name: 'Cherry' }, { id: 'p4', name: 'Date' }, { id: 'p5', name: 'Elder' }],
  ['p4', 'p2'],
); // p4, p2, p1, p3, p5
const ranks = rankMap(['p4', 'p2']);
check('the arranged page', arranged.map((p) => p.id), ['p4', 'p2', 'p1', 'p3', 'p5']);
check('no cursor = start', pageStartAfter(arranged, null, ranks), 0);
check('after an item that is still there', pageStartAfter(arranged, { i: 'p2', n: 'Banana', r: 1 }, ranks), 2);
const withoutP2 = arranged.filter((p) => p.id !== 'p2');
check('after an ARRANGED item that vanished → its rank position', pageStartAfter(withoutP2, { i: 'p2', n: 'Banana', r: 1 }, ranks), 1);
const withoutP1 = arranged.filter((p) => p.id !== 'p1');
check('after an UNARRANGED item that vanished → its name position among the unarranged', pageStartAfter(withoutP1, { i: 'p1', n: 'Apple' }, ranks), 2);
check('an unarranged page works by name as before', pageStartAfter([{ id: 'x', name: 'B' }, { id: 'y', name: 'D' }], { i: 'gone', n: 'C' }, null), 1);
check('past the end → the end', pageStartAfter(arranged, { i: 'gone', n: 'Zzz' }, ranks), 5);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all owner-order checks passed\n');
process.exit(failed ? 1 : 0);
