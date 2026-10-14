#!/usr/bin/env node
// Shapes (src/lib/shapes.ts) — which option is which cut outline, and how each
// outline is drawn.
//
// WHY IT EXISTS
// A cut line is what the cutter follows. Calling the wrong option a shape —
// "square" is a print ORIENTATION elsewhere in the catalogue, "custom" a SIZE,
// "round" a hole punch — draws a cut nobody ordered on the preview and the job
// sheet. And a catalogue shape the table forgot would show as a plain list item
// with no drawing. Both are checked here, against the catalogue itself.
//
// Usage:  node scripts/test-shapes.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-shapes-'));
const entry = join(dir, 'entry.ts');
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/shapes.ts'))};`,
  `export { OPTION_CATALOGUE } from ${JSON.stringify(join(ROOT, 'src/components/Admin/optionCatalogue.ts'))};`,
].join('\n'));
const out = join(dir, 'b.mjs');
await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const S = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

console.log('\n== the catalogue\'s shapes all have an outline ==\n');
const shapeField = S.OPTION_CATALOGUE.find((f) => f.id === 'product_shape');
const missing = (shapeField?.options ?? []).filter((o) => !S.outlineOf(o, shapeField)).map((o) => o.id);
check('every option of "Shape" (product_shape) has one', [shapeField?.options?.length, missing], [16, []]);
check('Round is a circle, Oval an ellipse, the custom contour "custom"',
  ['cs-shape-round', 'cs-shape-oval', 'cs-shape-custom'].map((id) => S.outlineOf(shapeField.options.find((o) => o.id === id), shapeField)),
  ['circle', 'ellipse', 'custom']);
const flags = S.OPTION_CATALOGUE.find((f) => f.id === 'flag_shape');
check('a flag\'s shape is not a cut line', (flags?.options ?? []).map((o) => S.outlineOf(o, flags)).filter(Boolean), []);

console.log('\n== nothing else is mistaken for a shape ==\n');
const cat = (id) => S.OPTION_CATALOGUE.find((f) => f.id === id);
const fieldOf = (optionId) => S.OPTION_CATALOGUE.find((f) => (f.options ?? []).some((o) => o.id === optionId));
const outlinesIn = (field) => (field?.options ?? []).map((o) => S.outlineOf(o, field)).filter(Boolean);
check('"square" print ORIENTATION', S.outlineOf(fieldOf('sz-or-square')?.options.find((o) => o.id === 'sz-or-square'), fieldOf('sz-or-square')), null);
check('the catalogue\'s "custom" SIZE and the contour bounding box have no outline at all', [outlinesIn(fieldOf('sz-lbl-custom')), outlinesIn(cat('contour_bounding_box'))], [[], []]);
const own = (name, value) => ({ id: 'custom-7', name, options: [{ id: 'o1', value }] });
check('a NAME never decides — "Corner shape", "Hole shape", "Hörnens form" with Round: not a cut',
  ['Corner shape', 'Hole shape', 'Hörnens form'].map((n) => S.outlineOf({ id: 'o1', value: 'round' }, own(n, 'round'))), [null, null, null]);
check('…nor renaming the orientation question "Form & orientation"', S.isShapeField({ ...fieldOf('sz-or-square'), name: 'Form & orientation' }), false);
// The legacy "Area design shape" pair lives in the library's defaults
// (PrintingFieldsAdmin.tsx), not in the option catalogue — as stored there:
const legacyShape = { id: 'area_design_shape', name: 'Area design shape', options: [
  { id: 'ads-1', value: 'rectangle' }, { id: 'ads-2', value: 'circle' }, { id: 'ads-3', value: 'oval' }, { id: 'ads-4', value: 'custom_contour' },
] };
const legacyDieLine = { id: 'custom_area_design_shape', name: 'Custom area design shape', options: [{ id: 'cads-1', value: 'vector_path' }] };
check('the legacy default "Standard Rectangle / Square" (ads-1) is a plain rectangle — the lowest rank, below', S.outlineOf(legacyShape.options[0], legacyShape), 'rect');
check('the die-line UPLOAD default (cads-1) is not a cut shape — it would stamp "custom" on every line', S.outlineOf(legacyDieLine.options[0], legacyDieLine), null);

console.log('\n== shape questions he builds himself ==\n');
const form = (cutShape) => ({ id: 'custom-9', name: 'Stansform', cutShape, options: [
  { id: 'custom-1', value: 'round' }, { id: 'custom-2', value: 'straight-oval' }, { id: 'custom-3', value: 'rund' },
] });
check('his own "Stansform" question: nothing until he ticks it as the cut shape', form(undefined).options.map((o) => S.outlineOf(o, form(undefined))), [null, null, null]);
check('…ticked: the value decides ("rund" is not a value we know — no guess)', form(true).options.map((o) => S.outlineOf(o, form(true))), ['circle', 'stadium', null]);
check('what he sets wins inside a shape question — a kind, or "none"', [
  S.outlineOf({ id: 'cs-shape-round', outline: 'heart' }, shapeField),
  S.outlineOf({ id: 'cs-shape-round', outline: 'none' }, shapeField),
], ['heart', null]);
check('outside one, nothing is an outline — even one set explicitly, even the catalogue\'s own once he unticks it', [
  S.outlineOf({ id: 'x', outline: 'star' }, { id: 'anything', options: [{ id: 'x' }] }),
  S.outlineOf(shapeField.options[0], { ...shapeField, cutShape: false }),
], [null, null]);

console.log('\n== which outline a line is cut to ==\n');
check('the legacy rectangle and the customer\'s Star → star', S.primaryOutline([{ outline: 'rect' }, { outline: 'star' }]), 'star');
check('a square — even one he set explicitly on the legacy question — does not beat the customer\'s Star', S.primaryOutline([{ outline: 'square' }, { outline: 'star' }]), 'star');
check('a square before a rectangle; the first real shape among two', [S.primaryOutline([{ outline: 'rect' }, { outline: 'square' }]), S.primaryOutline([{ outline: 'circle' }, { outline: 'star' }])], ['square', 'circle']);
check('nothing chosen has an outline → null', S.primaryOutline([{ outline: null }, {}]), null);

console.log('\n== round sizes, for the preview only ==\n');
check('"30 mm ø" and "3 cm Ø" are 30 mm', [S.diameterMm({ dimensions: '30 mm ø' }), S.diameterMm({ dimensions: '3 cm Ø' })], [30, 30]);
check('a roll CORE ("Ø 25/38/40/76/152 mm"), a drill hole ("Ø 5 mm") and a plain size are not', [
  S.diameterMm({ dimensions: 'Ø 25/38/40/76/152 mm' }), S.diameterMm({ dimensions: 'Ø 5 mm' }), S.diameterMm({ dimensions: '30 × 30 mm' }),
], [null, null, null]);

console.log('\n== every outline draws, at any size ==\n');
const sizes = [[100, 100], [300, 100], [100, 300], [7, 13], [0, -5]];
const bad = [];
for (const kind of S.OUTLINE_KINDS) {
  for (const [w, h] of sizes) {
    const d = S.outlinePath(kind, w, h);
    if (!/^M/.test(d) || !/Z$/.test(d) || /NaN|Infinity|undefined/.test(d)) bad.push(`${kind} ${w}x${h}: ${d.slice(0, 40)}`);
  }
}
check('16 kinds × 5 sizes: a closed path of real numbers every time', bad, []);
check('kinds that need a square box are drawn in one', ['circle', 'star', 'heart', 'seal', 'square', 'hexagon', 'triangle'].every((k) => S.needsSquareBox(k)) && !S.needsSquareBox('ellipse'), true);
check('a circle in an 85 × 55 box is a 55 mm circle, centred', S.outlinePath('circle', 85, 55), 'M15 27.5A27.5 27.5 0 1 0 70 27.5A27.5 27.5 0 1 0 15 27.5Z');

console.log('\n== icons: each shape at its own proportions ==\n');
const iconBox = (k) => { const i = S.iconOutline(k, 40); return [40 - 2 * i.dx, 40 - 2 * i.dy]; };
check('an oval, a capsule and a rectangle are drawn wider than tall (in the square they were a circle, a circle and a square)',
  ['ellipse', 'stadium', 'rect'].map((k) => iconBox(k)[0] > iconBox(k)[1]), [true, true, true]);
check('…so Round, Oval, Rectangle and Square are four different pictures', new Set(['circle', 'ellipse', 'rect', 'square'].map((k) => S.iconOutline(k, 40).d)).size, 4);
check('every icon fits its square', S.OUTLINE_KINDS.filter((k) => { const [w, h] = iconBox(k); return w > 40 || h > 40 || w <= 0 || h <= 0; }), []);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all shape checks passed\n');
process.exit(failed ? 1 : 0);
