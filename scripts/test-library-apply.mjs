#!/usr/bin/env node
// The data test for drag-to-reorder and for "Update & apply".
//
// WHY IT EXISTS
// Both of these rewrite a product's `printingFields`, and both used to lose data
// silently: "Update & apply" replaced every product's properties with the
// library's — his order, his per-product prices and his own custom properties
// gone — and a reorder built from what is ON SCREEN would delete everything that
// is not (the switched-off properties are still in the array). None of that is
// visible from a passing build or a page that renders. So the two pure modules
// that decide it are asserted directly:
//
//   src/lib/reorder.ts        what a drag turns into
//   src/lib/libraryApply.ts   what each of the three apply modes writes
//
// Usage:  node scripts/test-library-apply.mjs
// Exit:   0 = every case passes, 1 = something is lost or misplaced

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-libapply-'));
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/reorder.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/libraryApply.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/withoutUndefined.ts'))};`,
].join('\n'));
const outFile = join(outDir, 'bundle.mjs');
await build({ entryPoints: [entry], outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const lib = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

const { reorderById, reorderSubset, quantityAnchorFromOrder, reorderByIndexIds, valueIds, reorderByValueIds, applyLibraryToProduct, withoutUndefined } = lib;

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
const ids = (list) => list.map((f) => f.id);

// ---------------------------------------------------------------------------
console.log('\n== reorderById ==\n');
const abc = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
check('a plain reorder', ids(reorderById(abc, ['c', 'a', 'b'])), ['c', 'a', 'b']);
check('an id the screen did not name is kept, at the end', ids(reorderById(abc, ['b', 'a'])), ['b', 'a', 'c']);
check('an unknown id is ignored', ids(reorderById(abc, ['x', 'c', 'b', 'a'])), ['c', 'b', 'a']);
check('a repeated id is placed once', ids(reorderById(abc, ['a', 'a', 'c', 'b'])), ['a', 'c', 'b']);
check('the input is not mutated', ids(abc), ['a', 'b', 'c']);

// ---------------------------------------------------------------------------
console.log('\n== reorderSubset: the switched-off properties stay put ==\n');
const fields = [
  { id: 'paper', enabled: true },
  { id: 'old', enabled: false },          // off — not on screen, must survive
  { id: 'size', enabled: true },
  { id: 'speed', enabled: true },         // exempt — drawn in a fixed place
  { id: 'finish', enabled: true },
];
const orderable = (f) => f.enabled && f.id !== 'speed';
const after = reorderSubset(fields, orderable, ['finish', 'paper', 'size']);
check('the visible ones take the new order', ids(after.filter(orderable)), ['finish', 'paper', 'size']);
check('nothing is lost', after.length, fields.length);
check('the switched-off one keeps its slot', after[1].id, 'old');
check('the exempt one keeps its slot', after[3].id, 'speed');
check('the whole array', ids(after), ['finish', 'old', 'paper', 'speed', 'size']);

// ---------------------------------------------------------------------------
console.log('\n== quantityAnchorFromOrder ==\n');
const Q = '__quantity__';
const TOP = '__quantity_first__';
check('dragged to the top', quantityAnchorFromOrder([Q, 'a', 'b'], Q, TOP), TOP);
check('dragged to the bottom = the old default (undefined)', quantityAnchorFromOrder(['a', 'b', Q], Q, TOP), undefined);
check('between two fields = the field above it', quantityAnchorFromOrder(['a', Q, 'b'], Q, TOP), 'a');
check('absent = default', quantityAnchorFromOrder(['a', 'b'], Q, TOP), undefined);

// ---------------------------------------------------------------------------
console.log('\n== reorderByIndexIds (photos, feature lines) ==\n');
const photos = ['cover.jpg', 'side.jpg', 'side.jpg', 'back.jpg'];
check('photos dealt in the new order — duplicates by index', reorderByIndexIds(photos, ['img-3', 'img-0', 'img-2', 'img-1'], 'img-'), ['back.jpg', 'cover.jpg', 'side.jpg', 'side.jpg']);
check('a stale or foreign id never drops a photo', reorderByIndexIds(photos, ['img-9', 'feat-0', 'img-1'], 'img-'), ['side.jpg', 'cover.jpg', 'side.jpg', 'back.jpg']);

// ---------------------------------------------------------------------------
console.log('\n== valueIds: ids that move WITH the photo ==\n');
const pics = ['cover.jpg', 'side.jpg', 'side.jpg', 'back.jpg'];
const picIds = valueIds(pics, 'img-');
check('one id per photo, duplicates distinct', new Set(picIds).size, 4);
check('an id follows its photo after a reorder', valueIds(['back.jpg', 'cover.jpg'], 'img-')[1] === picIds[0], true);
check('reorderByValueIds deals the photos in the new order', reorderByValueIds(pics, [picIds[3], picIds[0], picIds[2], picIds[1]], 'img-'), ['back.jpg', 'cover.jpg', 'side.jpg', 'side.jpg']);
check('…and never drops one the screen did not name', reorderByValueIds(pics, [picIds[3]], 'img-'), ['back.jpg', 'cover.jpg', 'side.jpg', 'side.jpg']);

// ---------------------------------------------------------------------------
console.log('\n== applyLibraryToProduct ==\n');
const library = [
  { id: 'paper', enabled: true, name: 'Paper', options: [{ id: 'p1', priceModifier: 5 }] },
  { id: 'size', enabled: true, name: 'Size v2', options: [] },
  { id: 'lam', enabled: true, name: 'Lamination', options: [] },     // new to the product
  { id: 'gone', enabled: false, name: 'Old thing', options: [] },    // off in the library
];
const product = [
  { id: 'size', enabled: true, name: 'Size (my own wording)', options: [] },
  { id: 'custom-123', enabled: true, name: 'My own question', options: [] },
  { id: 'paper', enabled: false, name: 'Paper', options: [{ id: 'p1', priceModifier: 9 }] }, // off HERE, own price
  { id: 'gone', enabled: true, name: 'Old thing (still used here)', options: [] },
];

const addNew = applyLibraryToProduct(product, library, { mode: 'add-new' });
check('add-new: everything the product had, untouched and in its order', addNew.slice(0, 4), product);
check('add-new: only the missing switched-on property is added', ids(addNew.slice(4)), ['lam']);
check('add-new: and it arrives switched on', addNew[4].enabled, true);
check('add-new: a property off in the library is not added', addNew.some((f) => f.id === 'gone' && f !== product[3]), false);
check('add-new twice changes nothing more', JSON.stringify(applyLibraryToProduct(addNew, library, { mode: 'add-new' })), JSON.stringify(addNew));

const upd = applyLibraryToProduct(product, library, { mode: 'update-selected', fieldIds: ['paper', 'lam'] });
check('update-selected: the product keeps its order', ids(upd), ['size', 'custom-123', 'paper', 'gone', 'lam']);
check('update-selected: a chosen property takes the library content', upd[2].options, library[0].options);
check('update-selected: but keeps THIS product\'s on/off', upd[2].enabled, false);
check('update-selected: an unchosen property is untouched', upd[0], product[0]);
check('update-selected: the product\'s own property is untouched', upd[1], product[1]);
check('update-selected: a chosen property the product lacks is added, on', [upd[4].id, upd[4].enabled], ['lam', true]);
const updOff = applyLibraryToProduct(product, library, { mode: 'update-selected', fieldIds: ['gone'] });
check('update-selected: a chosen property switched OFF in the library is not added where missing', ids(applyLibraryToProduct([], library, { mode: 'update-selected', fieldIds: ['gone'] })), []);
check('update-selected: …but where it exists it is updated and keeps its on/off', [updOff[3].name, updOff[3].enabled], ['Old thing', true]);

const hide = applyLibraryToProduct(product, library, { mode: 'update-selected', fieldIds: ['size', 'lam'], switchTo: 'off' });
check('switch OFF: the chosen property is hidden on the product', hide.find((f) => f.id === 'size').enabled, false);
check('switch OFF: a chosen property the product lacks is NOT added', hide.some((f) => f.id === 'lam'), false);
check('switch OFF: nothing else moves', ids(hide), ['size', 'custom-123', 'paper', 'gone']);
const show = applyLibraryToProduct(product, library, { mode: 'update-selected', fieldIds: ['paper', 'gone'], switchTo: 'on' });
check('switch ON: a property off here comes on', show.find((f) => f.id === 'paper').enabled, true);
check('switch ON: added even where the library has it off', ids(applyLibraryToProduct([], library, { mode: 'update-selected', fieldIds: ['gone'], switchTo: 'on' })), ['gone']);
check('junk switchTo = keep his on/off', applyLibraryToProduct(product, library, { mode: 'update-selected', fieldIds: ['paper'], switchTo: 'sideways' }).find((f) => f.id === 'paper').enabled, false);

const rep = applyLibraryToProduct(product, library, { mode: 'replace-all' });
check('replace-all: the library order, then the product-only ones', ids(rep), ['paper', 'size', 'lam', 'gone', 'custom-123']);
check('replace-all: the library wording wins', rep[1].name, 'Size v2');
check('replace-all: the library on/off wins (as it always did)', [rep[0].enabled, rep[3].enabled], [true, false]);
check('replace-all: the product-only property is KEPT by default', rep[4], product[1]);
const repDrop = applyLibraryToProduct(product, library, { mode: 'replace-all', dropProductOnly: true });
check('replace-all + delete: product-only properties go only when asked', ids(repDrop), ['paper', 'size', 'lam', 'gone']);

check('garbage in: no arrays → an empty list, no throw', applyLibraryToProduct(null, undefined, { mode: 'add-new' }), []);
check('library entries without an id are ignored', ids(applyLibraryToProduct([], [{ enabled: true }, { id: 'x', enabled: true }], { mode: 'add-new' })), ['x']);
check('the inputs are never mutated', [product[2].enabled, library[2].enabled, product.length, library.length], [false, true, 4, 4]);

console.log('\n== round 16, item 4: what he hid or showed on ONE product ==\n');
const libShape = { id: 'product_shape', enabled: true, options: [
  { id: 'round', label: 'Round', isDefault: true }, { id: 'star', label: 'Star' }, { id: 'plaque', label: 'Plaque', hidden: true },
  { id: 'roll', label: 'Roll', subFields: [{ id: 'core', options: [{ id: 'core40', label: '40', isDefault: true }, { id: 'core76', label: '76' }] }] },
] };
// Product A: Star hidden ON THE PRODUCT; the 76 mm core hidden on the product.
const productA = [{ id: 'product_shape', enabled: true, options: [
  { id: 'round', isDefault: true }, { id: 'star', hidden: true, hiddenOnProduct: true }, { id: 'plaque', hidden: true },
  { id: 'roll', subFields: [{ id: 'core', options: [{ id: 'core40', isDefault: true }, { id: 'core76', hidden: true, hiddenOnProduct: true }] }] },
] }];
const push = (productFields, lib) => applyLibraryToProduct(productFields, [lib], { mode: 'update-selected', fieldIds: ['product_shape'] })[0];
const updated = push(productA, libShape);
const hiddenOf = (fld) => fld.options.filter((o) => o.hidden === true).map((o) => o.id);
check('update: the library\'s content, HIS hidden Star kept, the library\'s hidden Plaque too', [updated.options.map((o) => o.label), hiddenOf(updated)], [['Round', 'Star', 'Plaque', 'Roll'], ['star', 'plaque']]);
check('…inside nested questions as well', hiddenOf(updated.options[3].subFields[0]), ['core76']);
const unhid = push([{ ...productA[0], options: productA[0].options.map((o) => (o.id === 'plaque' ? { id: 'plaque', hidden: true } : o)) }], { ...libShape, options: libShape.options.map((o) => (o.id === 'plaque' ? { ...o, hidden: undefined } : o)) });
check('Plaque hidden in the LIBRARY, pushed, then shown again there and pushed: it comes back on the product (it used to stay hidden for good)', hiddenOf(unhid), ['star']);
const shownHere = push([{ ...productA[0], options: productA[0].options.map((o) => (o.id === 'plaque' ? { id: 'plaque', hiddenOnProduct: false } : o)) }], libShape);
check('…and an option he deliberately SHOWED on this product stays shown though the library hides it', hiddenOf(shownHere), ['star']);
const defaultHidden = push([{ id: 'product_shape', enabled: true, options: [{ id: 'round', hidden: true, hiddenOnProduct: true }, { id: 'star', isDefault: true }, { id: 'plaque' }, { id: 'roll' }] }], libShape);
check('the library\'s default (Round) is hidden on this product: the default goes to his own (Star), not to whatever is cheapest', defaultHidden.options.filter((o) => o.isDefault).map((o) => o.id), ['star']);
const collide = push([{ id: 'product_shape', enabled: true, options: [
  { id: 'round' }, { id: 'star' }, { id: 'plaque' },
  { id: 'roll', subFields: [{ id: 'core', options: [{ id: 'core40' }, { id: 'round', hidden: true, hiddenOnProduct: true }] }] },
] }], { ...libShape, options: libShape.options.map((o) => (o.id === 'roll' ? { ...o, subFields: [{ id: 'core', options: [{ id: 'core40', isDefault: true }, { id: 'round', label: 'Round core' }] }] } : o)) });
check('matched by path: a hidden "round" inside the roll question does not hide the top-level Round', [hiddenOf(collide), hiddenOf(collide.options[3].subFields[0])], [['plaque'], ['round']]);
check('replace-all still means the library\'s copy exactly', hiddenOf(applyLibraryToProduct(productA, [libShape], { mode: 'replace-all' })[0]), ['plaque']);

console.log('\n== saving: no undefined anywhere ==\n');
const cleaned = withoutUndefined({ a: 1, b: undefined, fields: [{ id: 'f', display: undefined, options: [{ id: 'o', outline: undefined, hidden: true }] }, undefined], n: null });
check('undefined is removed at any depth (Firestore refuses it); null and the rest are kept', cleaned, { a: 1, fields: [{ id: 'f', options: [{ id: 'o', hidden: true }] }], n: null });

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all reorder / library-apply checks passed\n');
process.exit(failed ? 1 : 0);
