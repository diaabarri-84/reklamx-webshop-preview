#!/usr/bin/env node
// Nested categories — src/lib/categoryTree.ts.
//
// WHY IT EXISTS
// `parentId` has been stored since round 13 and nothing has ever rendered it, so
// the live data is real and has never been validated by anything. That is the
// exact shape of data that breaks tree code, and two of the cases below hang the
// browser outright in a naive implementation:
//
//   * a parentId pointing at a category that no longer exists;
//   * a CYCLE — A's parent is B and B's parent is A. Two ordinary saves apart,
//     and a `while (parent)` breadcrumb walk never returns.
//
// Usage:  node scripts/test-category-tree.mjs
// Exit:   0 = every case holds

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-tree-'));
const outFile = join(outDir, 'categoryTree.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'categoryTree.ts')],
  outfile: outFile,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const T = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });
const { buildCategoryTree, descendantIds, breadcrumb, wouldCycle, flattenTree, categoryPickList } = T;

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

// print → banners → rollups, print → cards, and a loose one
const FLAT = [
  { id: 'print', name: 'Print' },
  { id: 'banners', name: 'Banners', parentId: 'print' },
  { id: 'rollups', name: 'Rollups', parentId: 'banners' },
  { id: 'cards', name: 'Cards', parentId: 'print' },
  { id: 'gifts', name: 'Gifts' },
];

console.log('\nbuildCategoryTree');
const tree = buildCategoryTree(FLAT);
check('two roots, sorted by name', tree.map((n) => n.category.id), ['gifts', 'print']);
check('children hang off the right parent', tree[1].children.map((n) => n.category.id), ['banners', 'cards']);
check('and their children too', tree[1].children[0].children.map((n) => n.category.id), ['rollups']);
check('depth counts from the root', flattenTree(tree).map((n) => `${n.category.id}:${n.depth}`),
  ['gifts:0', 'print:0', 'banners:1', 'rollups:2', 'cards:1']);
check('nothing is lost', flattenTree(tree).length, FLAT.length);

console.log('\nbuildCategoryTree — data that has never been validated');
const DANGLING = [{ id: 'a', name: 'A', parentId: 'deleted-long-ago' }, { id: 'b', name: 'B' }];
check('a parent that does not exist makes the category a ROOT, not a ghost',
  buildCategoryTree(DANGLING).map((n) => n.category.id), ['a', 'b']);
check('a category whose parent is itself is a root', buildCategoryTree([{ id: 'a', name: 'A', parentId: 'a' }]).map((n) => n.category.id), ['a']);
check('an empty parentId is a root', buildCategoryTree([{ id: 'a', name: 'A', parentId: '' }]).map((n) => n.category.id), ['a']);
check('whitespace is not a parent', buildCategoryTree([{ id: 'a', name: 'A', parentId: '   ' }]).map((n) => n.category.id), ['a']);
check('a null parentId is a root', buildCategoryTree([{ id: 'a', name: 'A', parentId: null }]).map((n) => n.category.id), ['a']);

// THE ONE THAT HANGS THE TAB.
const CYCLE = [
  { id: 'a', name: 'A', parentId: 'b' },
  { id: 'b', name: 'B', parentId: 'a' },
  { id: 'c', name: 'C' },
];
console.log('\na cycle — A→B→A, two ordinary saves apart');
const cycleTree = buildCategoryTree(CYCLE);
ok('the tree is built at all, rather than hanging', Array.isArray(cycleTree));
check('nothing disappears — a category the owner cannot see is one he cannot fix',
  flattenTree(cycleTree).map((n) => n.category.id).sort(), ['a', 'b', 'c']);

console.log('\ndescendantIds — what "this category\'s products" means (D4)');
check('a parent brings everything beneath it', descendantIds(FLAT, 'print').sort(), ['banners', 'cards', 'print', 'rollups']);
check('a middle node brings its own subtree', descendantIds(FLAT, 'banners').sort(), ['banners', 'rollups']);
check('a leaf is just itself', descendantIds(FLAT, 'rollups'), ['rollups']);
check('an id that names nothing still returns itself, never an empty filter',
  descendantIds(FLAT, 'nonexistent'), ['nonexistent']);
ok('a cycle terminates', descendantIds(CYCLE, 'a').length <= 3, 'it looped');

console.log('\nbreadcrumb');
check('root to leaf', breadcrumb(FLAT, 'rollups').map((c) => c.id), ['print', 'banners', 'rollups']);
check('a root is its own breadcrumb', breadcrumb(FLAT, 'print').map((c) => c.id), ['print']);
check('an unknown id has no breadcrumb', breadcrumb(FLAT, 'nope'), []);
ok('a cycle terminates instead of hanging the tab', breadcrumb(CYCLE, 'a').length <= 3, 'it looped');

console.log('\ncategoryPickList — what every category dropdown in the dashboard shows');
const PICK = categoryPickList(FLAT);
check('tree order, not alphabetical',
  PICK.map((r) => r.category.id), ['gifts', 'print', 'banners', 'rollups', 'cards']);
check('a root carries no indent', PICK.find((r) => r.category.id === 'print').indent, '');
check('a child is indented one level',
  PICK.find((r) => r.category.id === 'banners').indent, '\u00A0\u00A0\u2514 ');
check('a grandchild, two',
  PICK.find((r) => r.category.id === 'rollups').indent, '\u00A0\u00A0\u00A0\u00A0\u2514 ');
ok('the indent is NON-BREAKING space — an ordinary one is collapsed inside <option>',
  PICK.every((r) => !r.indent.includes(' ') || r.indent.includes('\u2514')));
check('nothing is dropped', PICK.length, FLAT.length);
// The data that has never been validated must not lose an entry HERE either:
// this list is how the owner files a product, and a category missing from it is
// a category he can never put anything into.
check('a category with a dangling parent is still offered, as a root',
  categoryPickList(DANGLING).map((r) => `${r.category.id}:${r.indent.length}`), ['a:0', 'b:0']);

console.log('\nwouldCycle — asked before a save, not discovered after one');
ok('its own child as a parent', wouldCycle(FLAT, 'print', 'banners'));
ok('a grandchild as a parent', wouldCycle(FLAT, 'print', 'rollups'));
ok('itself as a parent', wouldCycle(FLAT, 'print', 'print'));
ok('a sibling is fine', !wouldCycle(FLAT, 'cards', 'banners'));
ok('an unrelated root is fine', !wouldCycle(FLAT, 'gifts', 'print'));
ok('moving a child up to a root is fine', !wouldCycle(FLAT, 'rollups', 'print'));
ok('clearing the parent is never a cycle', !wouldCycle(FLAT, 'rollups', ''));

console.log(`\n${failed === 0 ? 'Every category-tree case holds.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
