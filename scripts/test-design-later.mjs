#!/usr/bin/env node
// "Add to basket without the design" — src/lib/designLater.ts (designer v2).
//
//   node scripts/test-design-later.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-later-'));
await build({ entryPoints: [join(ROOT, 'src/lib/designLater.ts')], outfile: join(dir, 'l.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const L = await import(pathToFileURL(join(dir, 'l.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const online = { fieldId: 'artwork_supply_method', optionId: 'af-supply-template', value: 'online_template' };
const later = { fieldId: 'artwork_supply_method', optionId: 'af-supply-later', value: 'artwork_later' };
const double = { fieldId: 'printed_sides', optionId: 'pc-sides-double', value: 'double_sided' };
const card = { fieldId: 'business_card_size', optionId: 'sz-bc-85x55', value: 'eu_85x55' };

console.log('\n== the marker an order line carries ==\n');
check('chosen as "Design online", with a size: the size, the pages, the kind', L.designLaterMarker({ options: [card, double, online], printWidthCm: 8.5, printHeightCm: 5.5, categoryId: 'cat-1' }), {
  trimMm: { wMm: 85, hMm: 55 }, outline: null, sides: ['front', 'back'], ink: { front: 'colour', back: 'colour' }, sameOnBothSides: false, kind: 'card', printSpec: null, categoryId: 'cat-1',
});
check('…with the cut and the owner\'s own print values', L.designLaterMarker({ options: [online, { fieldId: 'product_shape', optionId: 'cs-shape-round', outline: 'circle' }], printWidthCm: 5, printHeightCm: 5, printSpec: { bleedMm: 2, safeMm: 'x' } }), {
  trimMm: { wMm: 50, hMm: 50 }, outline: 'circle', sides: ['front'], ink: { front: 'colour', back: 'colour' }, sameOnBothSides: false, kind: 'print', printSpec: { bleedMm: 2 }, categoryId: null,
});
check('not chosen as "Design online": none', L.designLaterMarker({ options: [card, later], printWidthCm: 8.5, printHeightCm: 5.5 }), null);
check('no size (or over 5 m): none — a design cannot be made at no size', [
  L.designLaterMarker({ options: [online] }), L.designLaterMarker({ options: [online], printWidthCm: 600, printHeightCm: 100 })], [null, null]);
check('his own cut line, Pantone ink, all-over: none — the designer cannot make them', [
  L.designLaterMarker({ options: [online, { fieldId: 'product_shape', optionId: 'cs-shape-custom', outline: 'custom' }], printWidthCm: 5, printHeightCm: 5 }),
  L.designLaterMarker({ options: [online, { fieldId: 'print_colour_mode', optionId: 'pc-mode-pantone' }], printWidthCm: 5, printHeightCm: 5 }),
  L.designLaterMarker({ options: [online, { fieldId: 'printed_sides', optionId: 'pc-sides-allover' }], printWidthCm: 5, printHeightCm: 5 })], [null, null, null]);

console.log('\n== read back from an order or a basket ==\n');
check('a stored marker, made safe', L.cleanDesignLaterMarker({ trimMm: { wMm: 85, hMm: 55 }, outline: 'nonsense', sides: ['back', 'front', 'inside', 'front'], ink: { front: 'black' }, kind: 'nope', printSpec: { bleedMm: 99 }, categoryId: 7 }), {
  trimMm: { wMm: 85, hMm: 55 }, outline: null, sides: ['back', 'front'], ink: { front: 'black', back: 'colour' }, sameOnBothSides: false, kind: 'print', printSpec: {}, categoryId: null,
});
check('…or nothing', [L.cleanDesignLaterMarker(null), L.cleanDesignLaterMarker({ trimMm: { wMm: -1, hMm: 5 } }), L.cleanDesignLaterMarker('x')], [null, null, null]);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ design-later rules hold\n');
process.exit(failed ? 1 : 0);
