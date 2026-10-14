#!/usr/bin/env node
// A side moved to another size or bleed — src/lib/designRefit.ts (designer v2).
//
//   node scripts/test-design-refit.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-refit-'));
await build({
  entryPoints: [join(ROOT, 'src/lib/designRefit.ts')],
  outfile: join(dir, 'r.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const R = await import(pathToFileURL(join(dir, 'r.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const side = (objects) => JSON.stringify({ version: '7.4.0', background: '#ffffff', objects });
const card = { trimMm: { wMm: 85, hMm: 55 }, bleedMm: 3 };

console.log('\n== nothing to do ==\n');
{
  const json = side([{ type: 'Textbox', left: 455, top: 305, width: 400, height: 50, scaleX: 1, scaleY: 1, text: 'Hi' }]);
  check('the same size and bleed: the very same string back', R.refitSideJson(json, card, { trimMm: { wMm: 85, hMm: 55 }, bleedMm: 3 }) === json);
  check('not a side: null', R.refitSideJson('{"x":1}', card, card) === null && R.refitSideJson('nope', card, card) === null);
}

console.log('\n== a change of bleed alone moves nothing relative to the trim ==\n');
{
  const json = side([{ type: 'Textbox', originX: 'center', originY: 'center', left: 30 + 425, top: 30 + 275, width: 400, height: 50, scaleX: 1, scaleY: 1, text: 'Mid' }]);
  const out = JSON.parse(R.refitSideJson(json, card, { trimMm: card.trimMm, bleedMm: 5 }));
  const o = out.objects[0];
  check('the centre of the trim stays the centre of the trim (3 → 5 mm bleed: +20 units)', near(o.left, 50 + 425) && near(o.top, 50 + 275), JSON.stringify(o));
  check('…and nothing is scaled', o.scaleX === 1 && o.scaleY === 1);
}

console.log('\n== another size ==\n');
{
  const big = { trimMm: { wMm: 170, hMm: 110 }, bleedMm: 3 };
  const json = side([
    // a text on the trim's left edge, centred vertically
    { type: 'Textbox', originX: 'left', originY: 'top', left: 30, top: 30 + 255, width: 200, height: 40, scaleX: 1, scaleY: 1, angle: 0, text: 'Edge' },
    // a band across the whole board (a rectangle follows each axis)
    { type: 'Rect', originX: 'center', originY: 'center', left: 455, top: 100, width: 910, height: 60, scaleX: 1, scaleY: 1 },
  ]);
  const out = JSON.parse(R.refitSideJson(json, card, big));
  const [t, band] = out.objects;
  check('a text on the left trim edge stays on the left trim edge (from the trim, not the board corner)', near(t.left, 30), JSON.stringify(t));
  check('…its centre keeps its place relative to the trim', near(t.top + 40, 30 + (255 + 20) * 2), JSON.stringify(t));
  check('…and it is scaled by the smaller factor (2)', near(t.scaleX, 2) && near(t.scaleY, 2));
  check('a band follows each axis', near(band.scaleX, 2) && near(band.scaleY, 2) && near(band.left, (455 - 30) * 2 + 30));
}

console.log('\n== other proportions ==\n');
{
  const wide = { trimMm: { wMm: 100, hMm: 55 }, bleedMm: 3 };
  const json = side([
    { type: 'Rect', originX: 'center', originY: 'center', left: 455, top: 305, width: 910, height: 610, scaleX: 1, scaleY: 1 },
    { type: 'Circle', originX: 'center', originY: 'center', left: 455, top: 305, width: 200, height: 200, radius: 100, scaleX: 1, scaleY: 1 },
    { type: 'Image', originX: 'center', originY: 'center', left: 455, top: 305, width: 1000, height: 500, scaleX: 0.95, scaleY: 0.95, rxFill: true, rxImageId: 'img-a-b' },
    { type: 'RxPattern', originX: 'left', originY: 'top', left: 0, top: 0, width: 910, height: 610, scaleX: 1, scaleY: 1, rxPattern: { id: 'dots', colours: ['#ffffff', '#000000'], scaleMm: 10 } },
  ]);
  const out = JSON.parse(R.refitSideJson(json, card, wide));
  const [rect, circle, photo, pattern] = out.objects;
  const sx = 100 / 85;
  check('a rectangle stretches with the width', near(rect.scaleX, sx) && near(rect.scaleY, 1));
  check('a circle stays a circle (the smaller factor on both axes)', near(circle.scaleX, 1) && near(circle.scaleY, 1));
  check('…centred where the trim centre went', near(circle.left, (455 - 30) * sx + 30) && near(circle.top, 305));
  const board = { w: 1060, h: 610 };
  check('a background picture covers the whole new board, bleed included', near(photo.left, board.w / 2) && near(photo.top, board.h / 2) && photo.width * photo.scaleX >= board.w - 1e-6 && photo.height * photo.scaleY >= board.h - 1e-6, JSON.stringify(photo));
  check('the pattern is the whole new board, exactly', pattern.left === 0 && pattern.top === 0 && near(pattern.width, board.w) && near(pattern.height, board.h) && pattern.scaleX === 1);
  check('other keys travel untouched', photo.rxImageId === 'img-a-b' && pattern.rxPattern.id === 'dots');
}

console.log('\n== a turned object keeps its centre ==\n');
{
  const json = side([{ type: 'Rect', originX: 'left', originY: 'top', left: 300, top: 200, width: 100, height: 50, scaleX: 1, scaleY: 1, angle: 90 }]);
  const before = JSON.parse(json).objects[0];
  // centre of a left/top origin rect turned 90°: origin + R(90)·(w/2, h/2) = (300 - 25, 200 + 50)
  const out = JSON.parse(R.refitSideJson(json, card, { trimMm: card.trimMm, bleedMm: 3.5 }));
  const o = out.objects[0];
  check('left/top origin, turned 90°: the centre moves by the bleed change only', near(o.left - before.left, 5) && near(o.top - before.top, 5), JSON.stringify(o));
}

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ refit holds\n');
process.exit(failed ? 1 : 0);
