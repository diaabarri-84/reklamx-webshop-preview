#!/usr/bin/env node
// The product page in the owner's order (src/lib/pageOrder.ts) — the
// properties, the quantity table, the size calculator, the artwork box and the
// delivery time, all in the one list he drags.
//
// WHY IT EXISTS
// The client could not put "width × height" above "material": the blocks below
// the properties were fixed. A product nobody arranged must look exactly as it
// always has; a row he never placed must not vanish or jump to the top; and a
// row he placed and then switched off must come back where he left it.
//
// Usage:  node scripts/test-page-order.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-page-order-'));
const out = join(dir, 'p.mjs');
await build({ entryPoints: [join(ROOT, 'src/lib/pageOrder.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const p = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

const TOP = '__quantity_first__';
const Q = '__quantity__';
const SIZE = '__size__';
const ART = '__artwork__';
const DEL = '__delivery__';
const all = { quantityAtTop: TOP, size: true, artwork: true, delivery: true };

console.log('\n== a product nobody arranged looks as it always did ==\n');
check('properties, size calculator, artwork box, quantity table, delivery time', p.defaultPageRows(['material', 'finish'], all), ['material', 'finish', SIZE, ART, Q, DEL]);
check('the quantity table at the top, or after the property he chose (the old setting)', [
  p.defaultPageRows(['material', 'finish'], { ...all, quantityAnchor: TOP }),
  p.defaultPageRows(['material', 'finish'], { ...all, quantityAnchor: 'material' }),
], [[Q, 'material', 'finish', SIZE, ART, DEL], ['material', Q, 'finish', SIZE, ART, DEL]]);
check('an anchor naming a property that is gone: the old place, not lost', p.defaultPageRows(['finish'], { ...all, quantityAnchor: 'material' }), ['finish', SIZE, ART, Q, DEL]);
check('only the blocks the product shows (no artwork box, not priced per m², no delivery choice)', p.defaultPageRows(['material'], { quantityAtTop: TOP, size: false, artwork: false, delivery: false }), ['material', Q]);
check('never arranged → exactly that', p.arrangePageRows(['material', SIZE, ART, Q], undefined), ['material', SIZE, ART, Q]);

console.log('\n== his order ==\n');
const rows = ['material', 'finish', SIZE, ART, Q, DEL];
check('the client\'s case: width × height above the material, delivery above the quantity', p.arrangePageRows(rows, [SIZE, 'material', 'finish', ART, DEL, Q]), [SIZE, 'material', 'finish', ART, DEL, Q]);
check('a property switched on since he arranged: next to the property it follows among his properties, not at the top or the bottom',
  p.arrangePageRows(['material', 'finish', 'corners', SIZE, ART, Q, DEL], [SIZE, 'finish', 'material', ART, DEL, Q]),
  [SIZE, 'finish', 'corners', 'material', ART, DEL, Q]);
check('the artwork box turned on after he arranged: after the size calculator, where it follows by default',
  p.arrangePageRows(rows, [Q, SIZE, 'material', 'finish', DEL]), [Q, SIZE, ART, 'material', 'finish', DEL]);
check('a row that is gone (a property switched off) is skipped', p.arrangePageRows(['material', SIZE, Q], ['finish', SIZE, 'material', Q]), [SIZE, 'material', Q]);
check('junk in the stored list: ignored, never shown', p.arrangePageRows(['material', Q], [42, null, '', 'material', 'material', '__nope__']), ['material', Q]);

console.log('\n== what is stored after a drag ==\n');
check('the artwork box, switched off while he drags, keeps its place for when it comes back',
  p.rememberPageOrder([Q, 'material', SIZE], [SIZE, ART, 'material', Q]), [Q, 'material', SIZE, ART]);
check('…and comes back there', p.arrangePageRows(['material', SIZE, ART, Q], [Q, 'material', SIZE, ART]), [Q, 'material', SIZE, ART]);
check('first arrangement: just what is on screen', p.rememberPageOrder(['b', 'a', Q], undefined), ['b', 'a', Q]);

console.log('\n== where a row he never placed lands ==\n');
check('the client\'s banner: size calculator dragged to the top, THEN the artwork box ticked on — it lands before the quantity table, not second on the page above every property',
  p.arrangePageRows(['material', 'finish', SIZE, ART, Q, DEL], [SIZE, 'material', 'finish', Q, DEL]), [SIZE, 'material', 'finish', ART, Q, DEL]);
check('a property added at the end of the list lands after his last property, not between two of them',
  p.arrangePageRows(['a', 'b', 'c', SIZE, Q], ['b', 'a', SIZE, Q]), ['b', 'a', 'c', SIZE, Q]);

console.log('\n== the ONE rule for which rows exist (the page and the dashboard list) ==\n');
const f = (id, opts = {}) => ({ id, name: id, enabled: true, options: [{ id: `${id}-1` }, { id: `${id}-2` }], ...opts });
const hiddenAll = (field) => ({ ...field, options: field.options.map((o) => ({ ...o, hidden: true })) });
check('a property whose every option is hidden is not a row; nor is the delivery time with every speed hidden',
  p.pageRowsOf({ printingFields: [f('a'), hiddenAll(f('b')), hiddenAll(f('production_delivery_speed'))], areaPriced: true, artworkShown: true }),
  ['a', SIZE, ART, Q]);
check('the delivery time and the artwork method are blocks, never property rows; a switched-off property is no row',
  p.pageRowsOf({ printingFields: [f('a'), f('production_delivery_speed'), f('artwork_supply_method'), f('c', { enabled: false })], areaPriced: false, artworkShown: false }),
  ['a', Q, DEL]);
check('a size question the customer can type his own size into replaces the size calculator',
  p.pageRowsOf({ printingFields: [f('a', { allowCustomSize: true })], areaPriced: true, artworkShown: false }), ['a', Q]);

console.log('\n== what a drop writes ==\n');
check('the quantity table under the size calculator and above every property is "at the top" — the blocks do not count',
  [p.pageOrderAfterDrop([SIZE, Q, 'a', 'b'], undefined).quantityAnchor, p.pageOrderAfterDrop(['a', SIZE, Q, 'b'], undefined).quantityAnchor, p.pageOrderAfterDrop(['a', 'b', SIZE, Q], undefined).quantityAnchor],
  [TOP, 'a', undefined]);
const off = p.pageOrderAfterDrop(['c', 'a', Q], ['a', 'b', 'c', Q]);
check('b switched off, c dragged above a: b is remembered in ONE place — the rows and the properties\' own order agree',
  [off.pageOrder, off.fieldOrder], [['c', 'a', 'b', Q], ['c', 'a', 'b']]);

console.log('\n== "replace everything with the library" on a page he arranged ==\n');
check('the properties take the library\'s order, each block keeps its row', p.withFieldOrder([SIZE, 'lib3', 'lib2', 'lib1', Q], ['lib1', 'lib2', 'lib3']), [SIZE, 'lib1', 'lib2', 'lib3', Q]);
check('a property the library removed gives up its row; nothing arranged → null', [p.withFieldOrder([SIZE, 'A', 'B', 'C', Q], ['A', 'C']), p.withFieldOrder(undefined, ['A'])], [[SIZE, 'A', 'C', Q], null]);
check('stored: blocks and the properties the product still has, each once', [p.prunePageOrder(['gone', SIZE, 'a', 'a', Q], ['a']), p.prunePageOrder(['gone'], [])], [[SIZE, 'a', Q], null]);

console.log('\n== interleave never loses or repeats ==\n');
check('every id of both, once', p.interleave(['c', 'a', 'c'], ['a', 'b', 'c', 'd']), ['c', 'd', 'a', 'b']);
check('blocks are blocks, properties are not', [p.isPageBlock(Q), p.isPageBlock(SIZE), p.isPageBlock('material'), p.isPageBlock(TOP)], [true, true, false, false]);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all page-order checks passed\n');
process.exit(failed ? 1 : 0);
