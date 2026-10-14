#!/usr/bin/env node
// The font picker's names, each in its own typeface — ONE small picture.
//
// Showing 35 names in their own fonts would otherwise download every family the
// moment the picker opens (about a megabyte on a phone). Instead the names are drawn
// once, here, in a real browser with the shop's own font files, into a sprite: one
// row per family, in the order of fontLibrary.json. A family's files load only when
// the customer chooses it.
//
// Writes src/components/product/designer/fontSprite.webp (+ fontSprite.json: the
// row height and the order, so a stale sprite is noticed rather than misread).
//
//   node scripts/build-font-sprite.mjs
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const DIR = join(ROOT, 'src/components/product/designer');
const library = JSON.parse(readFileSync(join(DIR, 'fontLibrary.json'), 'utf8'));

/** CSS pixels; drawn at twice that for sharp screens. */
const ROW = 30;
const WIDTH = 230;
const SIZE = 19;
const SCALE = 2;

const faces = library.map((f) => {
  const face = f.faces.find((x) => x.style === 'normal' && String(x.weight).split(' ')[0] === '400') ?? f.faces[0];
  const data = readFileSync(join(DIR, 'fonts', face.file)).toString('base64');
  return { family: f.family, label: f.label, src: `data:font/woff2;base64,${data}`, weight: face.weight };
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
const png = await page.evaluate(
  async ({ faces, ROW, WIDTH, SIZE, SCALE }) => {
    for (const f of faces) {
      const face = new FontFace(f.family, `url(${f.src}) format('woff2')`, { weight: f.weight, style: 'normal' });
      document.fonts.add(await face.load());
    }
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH * SCALE;
    canvas.height = ROW * faces.length * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    // On white, not transparent: an alpha channel doubles the file. The picker draws
    // it with mix-blend-mode: multiply, so the white disappears on a tinted row.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WIDTH, ROW * faces.length);
    ctx.fillStyle = '#111827';
    ctx.textBaseline = 'middle';
    faces.forEach((f, i) => {
      ctx.font = `400 ${SIZE}px "${f.family}"`;
      let size = SIZE;
      // A wide display face is narrowed to fit the row.
      while (ctx.measureText(f.label).width > WIDTH - 4 && size > 10) {
        size -= 1;
        ctx.font = `400 ${size}px "${f.family}"`;
      }
      ctx.fillText(f.label, 2, i * ROW + ROW / 2);
    });
    // WebP: a fraction of the PNG for the same sharp names (every browser the shop serves reads it).
    return canvas.toDataURL('image/webp', 0.85);
  },
  { faces, ROW, WIDTH, SIZE, SCALE },
);
await browser.close();

const bytes = Buffer.from(png.split(',')[1], 'base64');
if (bytes.subarray(8, 12).toString('ascii') !== 'WEBP') throw new Error('the browser did not write a WebP');
writeFileSync(join(DIR, 'fontSprite.webp'), bytes);
writeFileSync(
  join(DIR, 'fontSprite.json'),
  `${JSON.stringify({ row: ROW, width: WIDTH, order: library.map((f) => f.family) }, null, 2)}\n`,
);
console.log(`fontSprite.webp: ${library.length} names, ${(bytes.length / 1024).toFixed(1)} KB`);
