#!/usr/bin/env node
// A design with all its sides — src/lib/designDoc.ts — and which sides a line is
// printed on — src/lib/printSides.ts (designer v2).
//
//   node scripts/test-design-doc.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-doc-'));
await build({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(join(ROOT, 'src/lib/designDoc.ts'))};`,
      `export { printSides } from ${JSON.stringify(join(ROOT, 'src/lib/printSides.ts'))};`,
      `export { cleanDesignPreviews, cleanDesignSides, previewOf } from ${JSON.stringify(join(ROOT, 'src/lib/designFileSpecs.ts'))};`,
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  outfile: join(dir, 'd.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const D = await import(pathToFileURL(join(dir, 'd.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

console.log('\n== which sides a line is printed on ==\n');
const opt = (fieldId, id, value) => ({ fieldId, id, value });
const sides = (...options) => D.printSides(options);
check('nothing said: the front, in colour', sides(), { sides: ['front'], sameOnBothSides: false, blocked: null, ink: { front: 'colour', back: 'colour' } });
check('"Double-sided (front and back)" — by id, or by value on a library copy with a new id',
  [sides(opt('printed_sides', 'pc-sides-double', 'double_sided')).sides, sides(opt('printed_sides', 'copy-7', 'double_sided')).sides], [['front', 'back'], ['front', 'back']]);
check('"Back side only": one page, the back', sides(opt('printed_sides', 'pc-sides-back', 'back_only')).sides, ['back']);
check('all-over (a wrap) and unprinted stock: no online design',
  [sides(opt('printed_sides', 'pc-sides-allover', 'all_over')).blocked, sides(opt('printed_sides', 'pc-sides-unprinted', 'unprinted')).blocked, sides(opt('bag_print_sides', 'bp-sides-allover', 'all_over')).blocked],
  ['all-over', 'unprinted', 'all-over']);
check('a flag sewn double, a bag "both sides — different": front and back; a bag "both sides — same": one design, printed twice',
  [sides(opt('flag_printed_sides', 'df-fsides-double-sewn', 'double_sewn')).sides, sides(opt('bag_print_sides', 'bp-sides-both-diff', 'both_different')).sides,
    (({ sides: s, sameOnBothSides }) => [s, sameOnBothSides])(sides(opt('bag_print_sides', 'bp-sides-both-same', 'both_same')))],
  [['front', 'back'], ['front', 'back'], [['front'], true]]);
check('the colour configuration decides only when nothing else did: 4/4 → both sides, 4/0 → front',
  [sides(opt('colour_configuration', 'pc-cfg-4-4', '4_4')).sides, sides(opt('colour_configuration', 'pc-cfg-4-0', '4_0')).sides,
    sides(opt('printed_sides', 'pc-sides-single', 'single_sided'), opt('colour_configuration', 'pc-cfg-4-4', '4_4')).sides],
  [['front', 'back'], ['front'], ['front']]);
check('1/1 is black on both sides; 4/1 a colour front and a black back',
  [sides(opt('colour_configuration', 'pc-cfg-1-1', '1_1')).ink, sides(opt('colour_configuration', 'pc-cfg-4-1', '4_1')).ink],
  [{ front: 'black', back: 'black' }, { front: 'colour', back: 'black' }]);
check('spot (2/x, 5/x), Pantone, white, metallic and neon inks: no online design (an RGB file cannot hold them)',
  [sides(opt('colour_configuration', 'pc-cfg-2-0', '2_0')).blocked, sides(opt('colour_configuration', 'pc-cfg-5-5', '5_5')).blocked,
    sides(opt('print_colour_mode', 'pc-mode-pantone', 'pantone_spot')).blocked, sides(opt('print_colour_mode', 'pc-mode-white', 'white_ink')).blocked,
    sides(opt('print_colour_mode', 'pc-mode-metallic', 'metallic_ink')).blocked, sides(opt('print_colour_mode', 'pc-mode-cmyk', 'full_colour_cmyk')).blocked],
  ['special-ink', 'special-ink', 'special-ink', 'special-ink', 'special-ink', null]);
check('black & white mode: both sides in greys', sides(opt('print_colour_mode', 'pc-mode-bw', 'black_white')).ink, { front: 'greyscale', back: 'greyscale' });
check('an option of the same id in ANOTHER question says nothing', sides(opt('size', 'pc-sides-double', 'double_sided')).sides, ['front']);

console.log('\n== a design, all its sides ==\n');
const v1 = { version: '7.4.0', background: '#fef3c7', objects: [{ type: 'Textbox', text: 'Hej', fontFamily: 'RX Lora' }, { type: 'Image', rxImageId: 'img-a-b' }], rxTemplate: { id: 't1', name: 'Card' } };
const doc = D.parseDesignDoc(JSON.stringify(v1));
check('a round-16 design reads as its FRONT, the template kept, rxTemplate no longer inside the side',
  [doc.sides.map((s) => s.id), doc.template, Object.keys(JSON.parse(doc.sides[0].json)).sort()], [['front'], { id: 't1', name: 'Card' }, ['background', 'objects', 'version']]);
const back = JSON.stringify({ version: '7.4.0', background: '#ffffff', objects: [{ type: 'Group', objects: [{ type: 'Textbox', text: 'x', fontFamily: 'RX Caveat' }] }, { type: 'Image', rxImageId: 'img-c-d', rxOrigId: 'img-e-f' }] });
const two = D.withSide(doc, 'back', back);
check('a back added: two sides, front first, the front SHARED (the same string, not a copy)', [two.sides.map((s) => s.id), two.sides[0].json === doc.sides[0].json], [['front', 'back'], true]);
check('every picture any side uses — the original of a colour-edited picture too', D.designImageIds(two).sort(), ['img-a-b', 'img-c-d', 'img-e-f']);
check('every font any side uses — inside groups too', D.designFontFamilies(two).sort(), ['RX Caveat', 'RX Lora']);
check('objects counted with their group members', [D.countSideObjects(doc.sides[0].json), D.countSideObjects(back)], [2, 3]);
const round = D.parseDesignDoc(D.serializeDesignDoc(two));
check('it survives being stored and read back', D.serializeDesignDoc(round), D.serializeDesignDoc(two));
check('ensureSides adds a blank side and keeps a side the product no longer prints',
  [D.ensureSides(doc, ['front', 'back']).sides.map((s) => s.id), D.ensureSides(two, ['front']).sides.map((s) => s.id)], [['front', 'back'], ['front', 'back']]);
check('refused: a side twice, an unknown side, a side that is not a design, nothing at all',
  [D.parseDesignDoc({ v: 2, sides: [{ id: 'front', json: back }, { id: 'front', json: back }] }), D.parseDesignDoc({ v: 2, sides: [{ id: 'inside', json: back }] }),
    D.parseDesignDoc({ v: 2, sides: [{ id: 'front', json: '{"x":1}' }] }), D.parseDesignDoc('not json'), D.parseDesignDoc(null)],
  [null, null, null, null, null]);
check('a blank design for a double-sided line', D.blankDesignDoc(['front', 'back']).sides.map((s) => [s.id, JSON.parse(s.json).objects.length]), [['front', 0], ['back', 0]]);


console.log('\n== what a designed file brings with it (designFileSpecs) ==\n');
{
  const ours = (u) => typeof u === 'string' && u.startsWith('https://firebasestorage.googleapis.com/v0/b/shop/o/');
  const A = 'https://firebasestorage.googleapis.com/v0/b/shop/o/a.png?alt=media';
  const B = 'https://firebasestorage.googleapis.com/v0/b/shop/o/b.png?alt=media';
  check('previews: only at the shop\'s own storage, one per side, in print order',
    D.cleanDesignPreviews([{ side: 'back', url: B }, { side: 'front', url: A }, { side: 'front', url: B }, { side: 'back', url: 'https://evil.example/x.png' }], ours),
    [{ side: 'front', url: A }, { side: 'back', url: B }]);
  check('…anything else is no previews at all', [D.cleanDesignPreviews('x', ours), D.cleanDesignPreviews([{ side: 'inside', url: A }], ours), D.cleanDesignPreviews([{ side: 'front', url: 'javascript:alert(1)' }], ours)], [null, null, null]);
  check('sides: front/back, each once, in print order — or nothing', [
    D.cleanDesignSides(['back', 'front']), D.cleanDesignSides(['front']), D.cleanDesignSides(['back']), D.cleanDesignSides(['front', 'front']),
    D.cleanDesignSides(['front', 'inside']), D.cleanDesignSides([]), D.cleanDesignSides('front')],
    [['front', 'back'], ['front'], ['back'], null, null, null, null]);
  check('the picture for a line: its front, else its only page, else none', [
    D.previewOf({ previews: [{ side: 'front', url: A }, { side: 'back', url: B }] }), D.previewOf({ previews: [{ side: 'back', url: B }] }), D.previewOf({}), D.previewOf(null),
    D.previewOf({ previews: [{ side: 'front', url: A }, { side: 'back', url: B }] }, 'back')],
    [A, B, null, null, B]);
}

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ every document rule holds\n');
process.exit(failed ? 1 : 0);
