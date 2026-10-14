#!/usr/bin/env node
// The online designer's arithmetic and rules — round 16, item 5:
//   src/lib/designSize.ts       how big a file it exports (with the 3 mm bleed)
//   src/lib/designTemplates.ts  the ready-made layouts and the safe area
//   src/lib/artworkFit.ts       the upload check, which now takes a bleed
//   src/lib/onlineDesign.ts     where "Design online" is offered, when it opens
//   src/lib/optionAvailability  the artwork step's option open, the design service's not
//
// WHY IT EXISTS
// A file the shop's own upload check refuses, a canvas Safari cannot allocate (an
// EMPTY white PNG uploaded as the artwork), a headline that runs across the cut
// line, or a designer offered on a product it can never open for, is each a print
// job ruined or a customer stuck.
//
// Usage:  node scripts/test-design.mjs

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { crc32 } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-design-'));
const entry = join(dir, 'entry.ts');
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/designSize.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/designTemplates.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/artworkFit.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/onlineDesign.ts'))};`,
  `export { isOptionAvailable, withoutUnavailableOptions } from ${JSON.stringify(join(ROOT, 'src/lib/optionAvailability.ts'))};`,
  `export { minPixelsFor } from ${JSON.stringify(join(ROOT, 'src/lib/artworkLimits.ts'))};`,
  `export { resolveSelectionFromIds, defaultSelection } from ${JSON.stringify(join(ROOT, 'src/lib/optionTree.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/imageDpi.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/designTemplateMatch.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/designTemplateDoc.ts'))};`,
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/templateCopies.ts'))};`,
  `export { fitText } from ${JSON.stringify(join(ROOT, 'src/components/product/designer/fitText.ts'))};`,
].join('\n'));
const out = join(dir, 'd.mjs');
await build({ entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const D = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

console.log('\n== the file the designer exports (trim + 3 mm bleed) ==\n');
const s50 = D.designExportSize({ wMm: 50, hMm: 50 });
check('a 50 × 50 mm sticker: 56 × 56 mm with its bleed, 300 DPI, 662 × 662 px (rounded UP)',
  [s50.kind, s50.wMm, s50.hMm, s50.dpi, s50.widthPx, s50.heightPx, s50.bleedMm], ['ok', 56, 56, 300, 662, 662, 3]);
const a4 = D.designExportSize({ wMm: 210, hMm: 297 });
check('A4 (216 × 303 mm with bleed) fits at 300 DPI: 9.1 MP', [a4.dpi, a4.widthPx, a4.heightPx, a4.widthPx * a4.heightPx <= 16e6], [300, 2552, 3579, true]);
const a3 = D.designExportSize({ wMm: 297, hMm: 420 });
check('A3 would be 17.9 MP at 300 — over the 16 MP every device can hold — so less, never over the limit, never under 150',
  [a3.kind, a3.dpi < 300 && a3.dpi >= 150, a3.widthPx * a3.heightPx <= D.DESIGN_MAX_PIXELS], ['ok', true, true]);
const over = (e, dpi) => D.pixelsFor(e.wMm, dpi) * D.pixelsFor(e.hMm, dpi) > D.DESIGN_MAX_PIXELS;
check('…and A3 at the HIGHEST DPI that fits: 282 is 15.9 MP, one more would be 16.03', [a3.dpi, over(a3, a3.dpi), over(a3, a3.dpi + 1)], [282, false, true]);
const a2 = D.designExportSize({ wMm: 420, hMm: 594 });
check('A2: 200 DPI, the largest standard size the designer makes', [a2.kind, a2.dpi, over(a2, a2.dpi + 1)], ['ok', 200, true]);
check('A1, A0 and a 1 × 2 m banner cannot reach 150 DPI under the cap: refused up front, with what WOULD fit',
  [D.designExportSize({ wMm: 594, hMm: 841 }).kind, D.designExportSize({ wMm: 841, hMm: 1189 }).kind, D.designExportSize({ wMm: 1000, hMm: 2000 }).kind,
    D.designExportSize({ wMm: 594, hMm: 841 }).maxDpi < 150], ['too-large', 'too-large', 'too-large', true]);
check('a 2 m × 5 cm strip: the longest side, not the area, is what does not fit', D.designExportSize({ wMm: 2000, hMm: 50 }).kind, 'too-large');
check('no size, zero or nonsense: nothing to design on',
  [D.designExportSize(null).kind, D.designExportSize({ wMm: 0, hMm: 50 }).kind, D.designExportSize({ wMm: 'x', hMm: 50 }).kind], ['no-size', 'no-size', 'no-size']);
// THE BOUNDARY: the largest products that still fit, and the floor they are
// measured against. A file one pixel short of minPixelsFor is refused by the
// shop's own check.
const boundary = [];
for (let w = 400; w <= 620; w += 7) {
  for (const ratio of [1, 1.414, 0.5, 2.37]) {
    const h = Math.round(w * ratio * 10) / 10;
    const e = D.designExportSize({ wMm: w, hMm: h });
    if (e.kind !== 'ok') continue;
    const wpx = e.widthPx, hpx = e.heightPx;
    if (wpx * hpx > D.DESIGN_MAX_PIXELS || Math.max(wpx, hpx) > D.DESIGN_MAX_SIDE_PX) boundary.push(`${w}x${h} over the cap`);
    if (wpx < D.minPixelsFor(w + 6) || hpx < D.minPixelsFor(h + 6)) boundary.push(`${w}x${h} a pixel short: ${wpx}x${hpx}`);
  }
}
check('every size near the limit: under the cap AND never a pixel short of the 150 DPI floor', boundary, []);
check('pixels are rounded up: 591.0000000001 is still 591, 591.2 is 592', [D.pixelsFor(50.038, 300) >= 591, D.pixelsFor(50, 300), D.pixelsFor(50.04, 300)], [true, 591, 592]);
check('the file name says size, resolution and bleed — production reads it on the job sheet',
  [D.designFileName({ wMm: 50, hMm: 50 }, s50, 'image/png'), D.designFileName({ wMm: 85.5, hMm: 55 }, { dpi: 283, bleedMm: 3 }, 'image/jpeg')],
  ['online-design_50x50mm_300dpi_bleed3mm.png', 'online-design_85.5x55mm_283dpi_bleed3mm.jpg']);

console.log('\n== a photo inside the design: what it prints at ==\n');
check('a 640 px phone photo across an A3 poster: 55 DPI, poor', [Math.round(D.effectiveDpi(640, 297)), D.imageQuality(D.effectiveDpi(640, 297))], [55, 'poor']);
check('a 4000 px photo across A4: 484 DPI, good', [Math.round(D.effectiveDpi(4000, 210)), D.imageQuality(D.effectiveDpi(4000, 210))], [484, 'good']);
check('between the floor and 250: fair', [D.imageQuality(150), D.imageQuality(249.9), D.imageQuality(149.9), D.imageQuality(250)], ['fair', 'fair', 'poor', 'good']);
check('nothing placed, nothing measured', [D.effectiveDpi(0, 50), D.effectiveDpi(500, 0)], [0, 0]);

console.log('\n== a customer\'s picture, cut down on the way in: by its AREA (code review DSN-06) ==\n');
const cut = (w, h, ...limits) => D.scaledPictureSize(w, h, D.pictureScale(w, h, ...limits));
const photo24 = cut(6000, 4000);
check('a 24 MP camera photo keeps 5016 × 3344 — the most one iPhone canvas holds — not 4096 × 2731',
  [photo24.width, photo24.height, photo24.width * photo24.height <= D.CANVAS_MAX_PIXELS], [5016, 3344, true]);
check('…on a 50 × 70 cm poster that is about 180 DPI across 70 cm, where the long-side cut gave about 150',
  [Math.round(D.effectiveDpi(5016, 706)), Math.round(D.effectiveDpi(4096, 706))], [180, 147]);
check('a 12 MP photo and a 4096 × 4096 picture fit as they are', [D.pictureScale(4000, 3000), D.pictureScale(4096, 4096)], [1, 1]);
const pano = cut(12000, 1500);
check('a panorama is held to 8192 px on its long side', [pano.width, pano.height], [8192, 1024]);
const big = cut(8688, 5792);
check('a 50 MP photo: under both limits, rounded DOWN (never one pixel past what the canvas holds)',
  big.width * big.height <= D.CANVAS_MAX_PIXELS && Math.max(big.width, big.height) <= 8192 && big.width * big.height > 16_700_000, true);
check('the owner\'s templates stay at 4096 on the long side', Object.values(cut(6000, 4000, 4096)), [4096, 2730]);
check('a strip one pixel high keeps a pixel', Object.values(cut(100000, 1)), [8192, 1]);
// By device (second pass, a watch on DSN-06): the area cut on a computer only. On a phone
// or a tablet each full-size copy would cost half as much memory again: 4096, as before.
const onDevice = (w, h, device) => {
  const limits = D.pictureLimits(device);
  return Object.values(cut(w, h, limits.maxSide, limits.maxPixels));
};
check('a 24 MP camera photo on a computer: 5016 × 3344, cut by its area', onDevice(6000, 4000, 'desktop'), [5016, 3344]);
check('…on a phone or a tablet: 4096 × 2730, its long side cut to 4096 as it was', onDevice(6000, 4000, 'touch'), [4096, 2730]);
check('a 12 MP photo fits as it is on both', [onDevice(4000, 3000, 'desktop'), onDevice(4000, 3000, 'touch')], [[4000, 3000], [4000, 3000]]);
check('a panorama: 8192 px long on a computer, 4096 on a phone', [onDevice(12000, 1500, 'desktop'), onDevice(12000, 1500, 'touch')], [[8192, 1024], [4096, 512]]);
check('…and on neither past what one canvas holds (a 50 MP photo)',
  ['desktop', 'touch'].map((device) => onDevice(8688, 5792, device)).every(([w, h]) => w * h <= D.CANVAS_MAX_PIXELS && Math.max(w, h) <= 8192), true);

console.log('\n== a size typed in mm (the studio\'s W × H box, code review DSN-20) ==\n');
const typed = (now, side, mm, keep) => Object.values(D.typedSizeMm(now, side, mm, keep, { min: 1, max: 600 })).map((v) => Math.round(v * 100) / 100);
check('a 40 × 30 mm picture typed 80 wide: 80 × 60, its proportions kept', typed({ w: 40, h: 30 }, 'w', 80, true), [80, 60]);
check('…typed 15 high: 20 × 15', typed({ w: 40, h: 30 }, 'h', 15, true), [20, 15]);
check('a shape with its chain off: only the side typed changes', typed({ w: 40, h: 30 }, 'w', 80, false), [80, 30]);
check('too large: held at the largest, the proportions still kept', typed({ w: 40, h: 30 }, 'w', 5000, true), [600, 450]);
check('too small: held at 1 mm on its short side, the proportions still kept', typed({ w: 40, h: 4 }, 'w', 0.5, true), [10, 1]);
check('…with the chain off, each side on its own', typed({ w: 40, h: 30 }, 'h', 9999, false), [40, 600]);
// A thin object, shrunk with its proportions kept, never grows (second pass #4): a
// 100 × 0.5 mm rule typed 50 wide came out 200 × 1.
check('a 100 × 0.5 mm rule typed 50 wide: 50 × 0.25 — it shrinks in proportion, it does not grow to 200 × 1', typed({ w: 100, h: 0.5 }, 'w', 50, true), [50, 0.25]);
check('…typed under the least size: its length held at 1 mm, its thickness following (0.005 mm)',
  Object.values(D.typedSizeMm({ w: 100, h: 0.5 }, 'w', 0.5, true, { min: 1, max: 600 })).map((v) => Math.round(v * 10000) / 10000), [1, 0.005]);
check('…its thin side typed thinner still, under 1 mm: left as it is, not pushed up to 1 mm (and 200 long)', typed({ w: 100, h: 0.5 }, 'h', 0.3, true), [100, 0.5]);
check('…its thin side typed thicker: 2 mm thick, 400 long; 10 mm: held at the largest, 600 × 3', [typed({ w: 100, h: 0.5 }, 'h', 2, true), typed({ w: 100, h: 0.5 }, 'h', 10, true)], [[400, 2], [600, 3]]);
check('with the chain off its thickness is left alone: 50 × 0.5, not 50 × 1', typed({ w: 100, h: 0.5 }, 'w', 50, false), [50, 0.5]);
check('…its thin side typed under 1 mm stays as it is; typed 0.8, it is held at the least size, 1 mm',
  [typed({ w: 100, h: 0.5 }, 'h', 0.3, false), typed({ w: 100, h: 0.5 }, 'h', 0.8, false)], [[100, 0.5], [100, 1]]);
check('already larger than the largest, typed larger still: left as it is, not shrunk to the largest', typed({ w: 700, h: 10 }, 'w', 800, true), [700, 10]);
// A line has no height of its own (its thickness is its stroke's): only its length.
check('a line 60 mm long typed 30: 30 long, still no height — with the chain on or off', [typed({ w: 60, h: 0 }, 'w', 30, true), typed({ w: 60, h: 0 }, 'w', 30, false)], [[30, 0], [30, 0]]);
check('…its height typed: nothing to scale, nothing changes; its length typed huge: held at the largest',
  [typed({ w: 60, h: 0 }, 'h', 5, true), typed({ w: 60, h: 0 }, 'w', 9000, true)], [[60, 0], [600, 0]]);
check('nothing typed, or less than nothing: nothing changes', [typed({ w: 40, h: 30 }, 'w', 0, true), typed({ w: 40, h: 30 }, 'h', -5, false)], [[40, 30], [40, 30]]);

console.log('\n== the upload check takes the bleed the shop asks for ==\n');
const card = { wMm: 85, hMm: 55 };
check('a PDF at the trim size (85 × 55): accepted, as before', D.checkArtworkFit({ kind: 'pdf', widthMm: 85, heightMm: 55 }, card), { kind: 'ok', withBleed: false });
check('a PDF WITH the 3 mm bleed (91 × 61) — what the dropzone tells him to make — was refused; now accepted',
  D.checkArtworkFit({ kind: 'pdf', widthMm: 91, heightMm: 61 }, card), { kind: 'ok', withBleed: true });
check('…turned 90°, and within ±2 mm', [D.checkArtworkFit({ kind: 'pdf', widthMm: 61, heightMm: 91 }, card).kind, D.checkArtworkFit({ kind: 'pdf', widthMm: 92.5, heightMm: 59.5 }, card).kind], ['ok', 'ok']);
check('a PDF that is neither (A4 for a business card): still refused', D.checkArtworkFit({ kind: 'pdf', widthMm: 210, heightMm: 297 }, card).kind, 'size-mismatch');
// 91 × 61 mm at 150 DPI is 538 × 361 px.
check('a picture with the bleed\'s proportions (91 × 61), enough pixels: accepted — it was 3.5 % off the trim and refused',
  D.checkArtworkFit({ kind: 'raster', widthPx: 1075, heightPx: 721 }, card), { kind: 'ok', withBleed: true });
check('a picture at the trim\'s proportions, enough pixels: accepted as before', D.checkArtworkFit({ kind: 'raster', widthPx: 1004, heightPx: 650 }, card), { kind: 'ok', withBleed: false });
check('the right proportions, too few pixels: refused, quoting the trim\'s floor (the smaller demand)',
  D.checkArtworkFit({ kind: 'raster', widthPx: 300, heightPx: 194 }, card), { kind: 'too-low-res', minWPx: 502, minHPx: 325 });
check('the bleed reading, too few pixels for IT: refused with its own floor when the trim reading does not match',
  D.checkArtworkFit({ kind: 'raster', widthPx: 400, heightPx: 268 }, card), { kind: 'too-low-res', minWPx: 538, minHPx: 361 });
check('a square picture for a business card: still refused', D.checkArtworkFit({ kind: 'raster', widthPx: 2000, heightPx: 2000 }, card).kind, 'ratio-mismatch');
// A SQUARE product: both readings fit any square file, so it may carry the bleed
// and must have the pixels for it (56 mm at 150 DPI = 331 px). 296 px is enough
// for the bare 50 mm but would print the bleed version at 134 DPI.
const sticker = { wMm: 50, hMm: 50 };
check('a square sticker file of 300 px: refused, quoting the size WITH its bleed (331 px) — either could be meant',
  D.checkArtworkFit({ kind: 'raster', widthPx: 300, heightPx: 300 }, sticker), { kind: 'too-low-res', minWPx: 331, minHPx: 331 });
check('…340 px: accepted, and nobody can say whether it carries the bleed (null), so nothing claims it does',
  D.checkArtworkFit({ kind: 'raster', widthPx: 340, heightPx: 340 }, sticker), { kind: 'ok', withBleed: null });
check('whole inches: a file of exactly 150 DPI is enough (152.4 mm needs 900 px, not 901)', [D.minPixelsFor(152.4), D.minPixelsFor(609.6)], [900, 3600]);
check('an SVG or EPS: not measurable, accepted as always', D.checkArtworkFit({ kind: 'unmeasurable' }, card), { kind: 'ok', withBleed: false });
// The designer's own export: what it makes passes the shop's own check, at every size.
const own = [[50, 50], [85, 55], [210, 297], [297, 420], [420, 594], [30, 120], [19, 19]].map(([w, h]) => {
  const e = D.designExportSize({ wMm: w, hMm: h });
  return D.checkArtworkFit({ kind: 'raster', widthPx: e.widthPx, heightPx: e.heightPx }, { wMm: w, hMm: h }).kind;
});
check('the designer\'s own file passes the shop\'s own check, at every size it makes', own, ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);

console.log('\n== the safe area, inside the cut line ==\n');
const inside = (inner, outer) => inner.xMm >= outer.xMm - 1e-9 && inner.yMm >= outer.yMm - 1e-9 &&
  inner.xMm + inner.wMm <= outer.xMm + outer.wMm + 1e-9 && inner.yMm + inner.hMm <= outer.yMm + outer.hMm + 1e-9;
const round = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 100) / 100]));
check('a rectangle: 3 mm in from the trim', round(D.safeBox('rect', 85, 55)), { xMm: 3, yMm: 3, wMm: 79, hMm: 49 });
check('a 50 mm circle: its inscribed square, 3 mm in', round(D.safeBox('circle', 50, 50)), { xMm: 10.32, yMm: 10.32, wMm: 29.36, hMm: 29.36 });
const inEllipse = (b, W, H) => [[b.xMm, b.yMm], [b.xMm + b.wMm, b.yMm], [b.xMm, b.yMm + b.hMm], [b.xMm + b.wMm, b.yMm + b.hMm]]
  .every(([x, y]) => ((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2 <= 1 + 1e-9);
check('round and oval products: every corner of the safe area is inside the curve, at any size',
  [inEllipse(D.safeBox('circle', 50, 50), 50, 50), inEllipse(D.safeBox('ellipse', 90, 50), 90, 50), inEllipse(D.safeBox('ellipse', 30, 100), 30, 100)], [true, true, true]);
const shapes = ['rect', 'square', 'circle', 'ellipse', 'stadium', 'half_circle', 'arch', 'leaf', 'hexagon', 'triangle', 'star', 'heart', 'seal', 'rect_scalloped', 'plaque', 'custom'];
const sizes = [[50, 50], [85, 55], [55, 85], [210, 297], [30, 120]];
const outside = [];
for (const k of shapes) for (const [w, h] of sizes) {
  const b = D.safeBox(k, w, h);
  if (!inside(b, { xMm: 0, yMm: 0, wMm: w, hMm: h }) || b.wMm < 0 || b.hMm < 0) outside.push(`${k} ${w}x${h}`);
}
check('16 shapes × 5 sizes: the safe area is always on the product, never negative', outside, []);

console.log('\n== the ready-made layouts ==\n');
const words = { headline: 'Headline', subline: 'Subline', caption: 'Caption' };
check('"Blank" is blank', D.templateLayout('blank', { wMm: 50, hMm: 50, outline: 'circle' }, words), []);
const escaped = [];
for (const id of D.DESIGN_TEMPLATES) for (const k of shapes) for (const [w, h] of sizes) {
  const safe = D.safeBox(k, w, h);
  for (const el of D.templateLayout(id, { wMm: w, hMm: h, outline: k }, words)) {
    if (!inside(el.box, safe)) escaped.push(`${id} ${k} ${w}x${h} ${el.type}`);
    if (el.type === 'text' && !(el.fontSizeMm > 0 && el.fontSizeMm <= Math.min(safe.wMm, safe.hMm))) escaped.push(`${id} ${k} ${w}x${h} font ${el.fontSizeMm}`);
  }
}
check('every layout, on every shape and size, stays inside the safe area — text never crosses the cut line', escaped, []);
check('a star on a narrow 30 × 120 mm label has under 4 mm of safe area: it starts blank, not with text bigger than its room',
  D.templateLayout('headline', { wMm: 30, hMm: 120, outline: 'star' }, words), []);
const cardLayout = D.templateLayout('headline', { wMm: 85, hMm: 55, outline: 'rect' }, words);
const poster = D.templateLayout('headline', { wMm: 297, hMm: 420, outline: 'rect' }, words);
check('the same layout on a business card and on a poster: the headline in proportion to each',
  [cardLayout[0].fontSizeMm < 20, poster[0].fontSizeMm > 50, cardLayout[0].text, cardLayout[0].bold], [true, true, 'Headline', true]);
check('the centred logo is round on a round product', D.templateLayout('centred-logo', { wMm: 50, hMm: 50, outline: 'circle' }, words)[0].round, true);

console.log('\n== where "Design online" is offered, and when it opens ==\n');
const template = { id: 'af-supply-template', label: 'Design online from a ready-made template', value: 'online_template', priceModifier: 0 };
const pdf = { id: 'af-supply-pdf', label: 'Upload a print-ready PDF', value: 'print_ready_pdf', priceModifier: 0, isDefault: true };
const method = { id: 'artwork_supply_method', name: 'Artwork supply method', enabled: true, options: [pdf, template] };
const service = { id: 'design_service', name: 'Design service', enabled: true, options: [
  { id: 'sv-dsgn-upload', label: 'Upload', value: 'upload_own', priceModifier: 0, isDefault: true },
  { id: 'sv-dsgn-online', label: 'Design it online with a free template', value: 'online_template', priceModifier: 0 },
] };
check('the artwork step\'s "Design online" is open now — the designer is behind it', D.isOptionAvailable(template), true);
check('the design service\'s "Design it online" (same value, nothing behind it) stays hidden', D.isOptionAvailable(service.options[1]), false);
check('…so the page keeps one and drops the other', D.withoutUnavailableOptions([method, service]).map((f) => f.options.map((o) => o.id)),
  [['af-supply-pdf', 'af-supply-template'], ['sv-dsgn-upload']]);
check('…and a hidden "Design online" is still hidden: the owner\'s hide wins', D.isOptionAvailable({ ...template, hidden: true }), false);
const priced = D.resolveSelectionFromIds([method], ['af-supply-template']);
check('the server prices it like any 0 kr choice — never refused', [priced.hiddenChosen.length, priced.matched.map((m) => m.optionId ?? m.id ?? m.option?.id)], [0, ['af-supply-template']]);
check('offered: the upload box on, his switch not off', [
  D.onlineDesignOffered({ artworkEnabled: true }), D.onlineDesignOffered({ artworkEnabled: true, onlineDesign: true }),
  D.onlineDesignOffered({ artworkEnabled: true, onlineDesign: false }), D.onlineDesignOffered({ artworkEnabled: false }), D.onlineDesignOffered({})],
  [true, true, false, false, false]);
check('switched off: the choice leaves the page; a question left empty goes with it',
  [D.designerWhereItWorks([method], false).map((f) => f.options.map((o) => o.id)), D.designerWhereItWorks([{ ...method, options: [template] }], false).length,
    D.designerWhereItWorks([service], false)[0] === service],
  [[['af-supply-pdf']], 0, true]);
check('offered: kept on the top-level supply question — and on nothing else (a copy inside another question would be a card with nothing behind it)',
  [D.designerWhereItWorks([method], true)[0].options.map((o) => o.id),
    D.designerWhereItWorks([{ id: 'finish', name: 'Finish', enabled: true, options: [pdf, { ...template }] }], true)[0].options.map((o) => o.id),
    D.designerWhereItWorks([{ id: 'kind', name: 'Kind', enabled: true, options: [{ id: 'k', label: 'K', value: 'k', priceModifier: 0, subFields: [method] }] }], true)[0].options[0].subFields[0].options.map((o) => o.id)],
  [['af-supply-pdf', 'af-supply-template'], ['af-supply-pdf'], ['af-supply-pdf']]);
const sized = { id: 'size', name: 'Size', enabled: true, options: [{ id: 's1', label: '50 × 50 mm', value: '50', priceModifier: 0 }] };
const named = { id: 'size', name: 'Size', enabled: true, options: [{ id: 's1', label: 'Standard', value: 'std', priceModifier: 0 }] };
const roundWithDiameter = { id: 'kind', name: 'Kind', enabled: true, cutShape: true, options: [{ id: 'k1', label: 'Round', value: 'r', outline: 'circle', priceModifier: 0, subFields: [
  { id: 'dia', name: 'Diameter', enabled: true, options: [{ id: 'd30', label: '30 mm', value: '30', dimensions: '30 mm ø', priceModifier: 0 }] }] }] };
const diameterOnly = { id: 'dia', name: 'Diameter', enabled: true, options: [{ id: 'd30', label: '30 mm', value: '30', dimensions: '30 mm ø', priceModifier: 0 }] };
const huge = { id: 'size', name: 'Size', enabled: true, options: [{ id: 'b1', label: 'Banner 600x100 cm', value: 'b1', priceModifier: 0 }, { id: 'b2', label: 'Banner 520x300 cm', value: 'b2', priceModifier: 0 }] };
const large = { id: 'size', name: 'Size', enabled: true, options: [{ id: 'a0', label: 'Poster A0', value: 'a0', priceModifier: 0 }, { id: 'ru', label: 'Rollup 85x200 cm', value: 'ru', priceModifier: 0 }] };
const ownShapeOnly = { id: 'product_shape', name: 'Shape', enabled: true, cutShape: true, options: [{ id: 'cs-shape-custom', label: 'Custom contour', value: 'custom', outline: 'custom', priceModifier: 0 }] };
check('it can open on: written sizes, A-sizes, a diameter where a round cut can be chosen, a custom size, the area calculator — and (designer v2, a tiled PDF) A0 and roll-ups',
  [D.designerCanOpenOn([sized], false), D.designerCanOpenOn([{ ...named, options: [{ id: 'a', label: 'Poster A3', value: 'a3', priceModifier: 0 }] }], false),
    D.designerCanOpenOn([roundWithDiameter], false), D.designerCanOpenOn([{ ...named, allowCustomSize: true }], false), D.designerCanOpenOn([], true),
    D.designerCanOpenOn([large], false)],
  [true, true, true, true, true, true]);
check('…and never offered where it could never open: sizes that are words, every size over 5 m a side, a diameter with no round cut, only an own-shape cut',
  [D.designerCanOpenOn([named], false), D.designerCanOpenOn([huge], false), D.designerCanOpenOn([diameterOnly], false), D.designerCanOpenOn([sized, ownShapeOnly], false)],
  [false, false, false, false]);
check('a custom size whose SMALLEST allowed size is already too large (over 5 m): not offered', D.designerCanOpenOn([{ ...named, allowCustomSize: true, minWidthCm: 600, minHeightCm: 100 }], false), false);
const noDefault = { id: 'artwork_supply_method', name: 'Artwork', enabled: true, options: [{ ...template }, { id: 'af-supply-later', label: 'Later', value: 'artwork_later', priceModifier: 0 }] };
check('with no default marked, the cheapest choice is pre-selected — but never the designer (it would hold the order for a design nobody asked for)',
  [D.defaultSelection([noDefault], 'Custom')['artwork_supply_method']?.id, D.defaultSelection([{ ...noDefault, options: [{ ...template, isDefault: true }, noDefault.options[1]] }], 'Custom')['artwork_supply_method']?.id],
  ['af-supply-later', 'af-supply-template']);
check('why it cannot open right now', [
  D.designerBlock(null), D.designerBlock({ wMm: 50, hMm: 50 }, { customSizeInvalid: true }), D.designerBlock({ wMm: 50, hMm: 50 }, { outline: 'custom' }),
  D.designerBlock({ wMm: 6000, hMm: 1000 }), D.designerBlock({ wMm: 50, hMm: 50 }, { outline: 'circle' }), D.designerBlock({ wMm: 850, hMm: 2000 })],
  ['no-size', 'invalid-size', 'custom-contour', 'too-large', null, null]);
check('…and when the print is not a picture\'s to make: spot / metallic ink, all-over, unprinted', [
  D.designerBlock({ wMm: 85, hMm: 55 }, { sides: 'special-ink' }), D.designerBlock({ wMm: 85, hMm: 55 }, { sides: 'all-over' }),
  D.designerBlock({ wMm: 85, hMm: 55 }, { sides: 'unprinted' }), D.designerBlock({ wMm: 85, hMm: 55 }, { sides: null })],
  ['special-ink', 'all-over', 'unprinted', null]);

console.log('\n== the owner\'s templates: which one a customer is offered ==\n');
const card8555 = { trimMm: { wMm: 85, hMm: 55 }, outline: null };
check('a business-card template: on 85 × 55 and 86 × 55 (1 % off) — never on 85 × 85, nor turned to 55 × 85',
  [D.templateFits(card8555, { wMm: 85, hMm: 55 }, null), D.templateFits(card8555, { wMm: 86, hMm: 55 }, 'rect'),
    D.templateMiss(card8555, { wMm: 85, hMm: 85 }, null), D.templateMiss(card8555, { wMm: 55, hMm: 85 }, null)],
  [true, true, 'proportions', 'proportions']);
check('the 2 % edge: 85 × 55 against 86.5 × 55 (1.7 % apart) yes, against 87 × 55 (2.3 %) no',
  [D.templateFits(card8555, { wMm: 86.5, hMm: 55 }, null), D.templateMiss(card8555, { wMm: 87, hMm: 55 }, null)], [true, 'proportions']);
const a4Template = { trimMm: { wMm: 210, hMm: 297 }, outline: 'rect' };
check('an A4 template: on A4, A3 (same √2 proportions, 1.41×) and A2 (2.0×, the limit) — not on A5 (0.71×, too far down) nor A1 (2.83×)',
  [D.templateFits(a4Template, { wMm: 297, hMm: 420 }, null), D.templateMiss(a4Template, { wMm: 148, hMm: 210 }, null),
    D.templateFits(a4Template, { wMm: 420, hMm: 594 }, null), D.templateMiss(a4Template, { wMm: 594, hMm: 841 }, null)],
  [true, 'product-smaller', true, 'product-larger']);
const round50 = { trimMm: { wMm: 50, hMm: 50 }, outline: 'circle' };
check('a round 50 mm template: on 45–100 mm round stickers — not 30 mm, not a square, not a star',
  [D.templateFits(round50, { wMm: 45, hMm: 45 }, 'circle'), D.templateFits(round50, { wMm: 100, hMm: 100 }, 'circle'),
    D.templateMiss(round50, { wMm: 30, hMm: 30 }, 'circle'), D.templateMiss(round50, { wMm: 50, hMm: 50 }, null), D.templateMiss(round50, { wMm: 50, hMm: 50 }, 'star')],
  [true, true, 'product-smaller', 'cut', 'cut']);
const withLogo = { ...card8555, lowestPictureDpi: 240 };
check('its pictures must still print at 150 DPI: a 240-DPI logo is fine at 1.5×, not at 1.7× (141 DPI)',
  [D.templateFits(withLogo, { wMm: 127.5, hMm: 82.5 }, null), D.templateMiss(withLogo, { wMm: 144.5, hMm: 93.5 }, null)], [true, 'pictures']);
check('a rectangle and a square are one cut family; nothing chosen is the plain cut', [D.cutFamily(null), D.cutFamily('square'), D.cutFamily('rect'), D.cutFamily('heart')], ['rect', 'rect', 'rect', 'heart']);
check('…but a SQUARE cut on a size that is not square cuts a square out of it: its own cut, so a card layout is not offered there',
  [D.cutFamily('square', { wMm: 85, hMm: 55 }), D.cutFamily('square', { wMm: 50, hMm: 50 }), D.templateMiss(card8555, { wMm: 85, hMm: 55 }, 'square'),
    D.templateFits({ trimMm: { wMm: 50, hMm: 50 }, outline: null }, { wMm: 50, hMm: 50 }, 'square')],
  ['square', 'rect', 'cut', true]);
check('no size yet, or nonsense: nothing fits', [D.templateMiss(card8555, null, null), D.templateMiss({ trimMm: { wMm: 0, hMm: 55 } }, { wMm: 85, hMm: 55 }, null)], ['no-size', 'no-size']);
const cats = [{ id: 'stickers', name: 'Stickers', parentId: null }, { id: 'round', name: 'Round stickers', parentId: 'stickers' }, { id: 'cards', name: 'Business cards', parentId: null }];
const inCats = (ids) => D.cleanScope({ kind: 'categories', ids });
check('where he put it: everywhere; a category; its SUB-categories too; not a neighbour',
  [D.templateInScope(D.cleanScope({ kind: 'all' }), { id: 'p1', categoryId: 'cards' }, cats),
    D.templateInScope(inCats(['stickers']), { id: 'p1', categoryId: 'stickers' }, cats),
    D.templateInScope(inCats(['stickers']), { id: 'p2', categoryId: 'round' }, cats),
    D.templateInScope(inCats(['stickers']), { id: 'p3', categoryId: 'cards' }, cats)],
  [true, true, true, false]);
check('a product whose categoryId holds the category NAME (both forms are in the data) is still found',
  D.templateInScope(inCats(['stickers']), { id: 'p4', categoryId: 'Round stickers' }, cats), true);
check('on chosen products only', [D.templateInScope(D.cleanScope({ kind: 'products', ids: ['p1', 'p2'] }), { id: 'p2', categoryId: 'cards' }, cats), D.templateInScope(D.cleanScope({ kind: 'products', ids: ['p1'] }), { id: 'p9' }, cats)], [true, false]);
check('a scope as stored is made safe: unknown kinds mean everywhere, ids are strings, deduplicated',
  [D.cleanScope(null), D.cleanScope({ kind: 'bogus' }), D.cleanScope({ kind: 'products', ids: ['a', 'a', 3, '', null] })],
  [{ kind: 'all' }, { kind: 'all' }, { kind: 'products', ids: ['a', '3'] }]);
check('a parent loop in bad data does not hang', D.templateInScope(inCats(['zz']), { id: 'p', categoryId: 'x' }, [{ id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }]), false);

console.log('\n== a template document, as the shop serves it ==\n');
const ours = (u) => u.startsWith('https://firebasestorage.googleapis.com/v0/b/demo/o/');
const URL1 = 'https://firebasestorage.googleapis.com/v0/b/demo/o/logo.png?alt=media&token=1';
const slot = { type: 'Group', objects: [{ type: 'Rect', fill: '#eee' }, { type: 'Textbox', text: 'Your photo here' }] };
const design = JSON.stringify({ version: '7.4.0', background: '#fef3c7', rxTemplate: { id: 'x' }, objects: [
  { type: 'Textbox', text: 'Hej', rxLock: 'words', fill: '#111111' },
  { type: 'Image', rxImageId: 'img-a1-b1', rxLock: 'locked', src: 'blob:x', filters: [] },
  { type: 'Image', rxImageId: 'img-a2-b2', src: 'blob:y' },
  slot,
] });
const good = { name: ' Summer\ncard ', nameI18n: { sv: 'Sommarkort', ar: 'x' }, trimMm: { wMm: 85, hMm: 55 }, outline: null, json: design,
  images: { 'img-a1-b1': { url: URL1 }, 'img-a2-b2': { url: URL1 } }, thumbnailUrl: URL1, scope: { kind: 'categories', ids: ['cards'] }, sortOrder: 20, lockBackground: true, lowestPictureDpi: 280 };
const cleaned = D.cleanTemplateDoc('t1', good, ours);
check('a whole template is served: its name (no line breaks: it goes on a plain-text sheet), its languages (sv/da/no only), size, cut, scope, its pictures by id',
  [cleaned?.name, cleaned?.nameI18n, cleaned?.trimMm, cleaned?.outline, cleaned?.scope, Object.keys(cleaned?.images ?? {}).sort(), cleaned?.lockBackground, cleaned?.lowestPictureDpi],
  ['Summer card', { sv: 'Sommarkort' }, { wMm: 85, hMm: 55 }, null, { kind: 'categories', ids: ['cards'] }, ['img-a1-b1', 'img-a2-b2'], true, 280]);
const served = JSON.parse(cleaned?.json ?? '{}');
check('its design reaches the browser as the background colour and the objects ONLY — fabric sets any other key on the customer\'s canvas',
  [Object.keys(served).sort(), served.background, served.objects?.length], [['background', 'objects', 'version'], '#fef3c7', 4]);
check('…its pictures with their addresses taken out (the browser puts in the checked ones, by id)', served.objects?.filter((o) => o.type === 'Image').map((o) => o.src), ['', '']);
check('every picture the design names, groups included', D.referencedImageIds(design).sort(), ['img-a1-b1', 'img-a2-b2']);
check('NOT served when the design names a picture it does not hold — the shop\'s logo would silently be missing from the print',
  D.cleanTemplateDoc('t2', { ...good, images: { 'img-a1-b1': { url: URL1 } } }, ours), null);
check('…nor when a picture lives anywhere but the shop\'s own storage',
  D.cleanTemplateDoc('t3', { ...good, images: { 'img-a1-b1': { url: 'https://evil.example/x.png' }, 'img-a2-b2': { url: URL1 } } }, ours), null);
const withObjects = (...objects) => ({ ...good, json: JSON.stringify({ objects }) });
check('…nor a design with anything the designer does not make, or an address anywhere but a picture\'s own',
  [D.cleanTemplateDoc('e', withObjects({ type: 'Path', path: [] }), ours),
    D.cleanTemplateDoc('f', withObjects({ type: 'Group', objects: [{ type: 'Image', rxImageId: 'img-a1-b1' }] }), ours),
    D.cleanTemplateDoc('g', withObjects({ type: 'Image', src: 'https://evil.example/x.png' }), ours),
    D.cleanTemplateDoc('h', withObjects({ type: 'Rect', fill: { type: 'pattern', source: 'https://evil.example/p.png' } }), ours),
    D.cleanTemplateDoc('i', withObjects({ type: 'Rect', clipPath: { type: 'Rect' } }), ours)],
  [null, null, null, null, null]);
// Designer v2: the cleaner is an ALLOWLIST — a key outside it is DROPPED, not copied
// (src/lib/designSchema.ts). Per-character styles are pinned empty, so an address
// hidden in them never reaches a customer's browser, and the text itself is kept.
const stylesServed = D.cleanTemplateDoc('j', withObjects({ type: 'Textbox', text: 'x', styles: { 0: { 0: { src: 'https://evil.example/' } } } }), ours);
check('…an address hidden in per-character styles is dropped with the styles: the text is served, the address is not',
  [JSON.parse(stylesServed?.json ?? '{}').objects?.[0]?.text, /evil/.test(stylesServed?.json ?? 'evil')], ['x', false]);
const deep = { type: 'Rect' };
let level = deep;
for (let i = 0; i < 20; i += 1) {
  level.x = {};
  level = level.x;
}
check('…and a key the designer never writes is dropped whole, however deep it goes: nothing nested in it is served',
  JSON.parse(D.cleanTemplateDoc('m', withObjects(deep), ours)?.json ?? '{}').objects, [{ type: 'Rect' }]);
check('…nor a picture id that is a name every object has ("constructor", "__proto__")',
  [D.cleanTemplateDoc('k', { ...withObjects({ type: 'Image', rxImageId: 'constructor' }), images: {} }, ours),
    D.cleanTemplateDoc('l', { ...withObjects({ type: 'Image', rxImageId: '__proto__' }), images: JSON.parse('{"__proto__": {"url": "x"}}') }, ours)],
  [null, null]);
const padded = JSON.stringify({ objects: [{ type: 'Textbox', text: 'x'.repeat(200001) }] });
check('…nor a custom contour, a size of nothing, a design over 200 000 characters (VALID JSON — the cap itself), or not JSON',
  [D.cleanTemplateDoc('a', { ...good, outline: 'custom' }, ours), D.cleanTemplateDoc('b', { ...good, trimMm: { wMm: 0, hMm: 55 } }, ours),
    D.cleanTemplateDoc('c', { ...good, json: padded }, ours), D.cleanTemplateDoc('c2', { ...good, json: JSON.stringify({ objects: [{ type: 'Textbox', text: 'x'.repeat(1000) }] }) }, ours) !== null,
    D.cleanTemplateDoc('d', { ...good, json: '{nope' }, ours)],
  [null, null, null, true, null]);
check('the list sends no design and no pictures', Object.keys(D.summaryOf(cleaned)).sort(),
  ['id', 'lowestPictureDpi', 'name', 'nameI18n', 'outline', 'scope', 'sortOrder', 'thumbnailUrl', 'trimMm']);

console.log('\n== the shop\'s copy of the templates: no database read per page view ==\n');
{
  const tick = () => new Promise((r) => setImmediate(r));
  // A fake host: a clock, the owner's change stamp, the shared disk copy, and a
  // database whose reads are answered by hand, in any order.
  const host = () => {
    const h = { t: 1000, stamp: 0, disk: null, reads: 0, pending: [] };
    h.copies = D.templateCopies({
      now: () => h.t,
      changedAt: () => h.stamp,
      readDisk: () => h.disk,
      writeDisk: (items, at) => { h.disk = { at, items }; },
      read: () => { h.reads += 1; return new Promise((resolve, reject) => h.pending.push({ resolve, reject })); },
      maxAgeMs: 12 * 3600e3,
      retryMs: 60e3,
    });
    h.answer = async (items, i = 0) => { h.pending.splice(i, 1)[0].resolve(items); await tick(); };
    h.refuse = async () => { h.pending.shift().reject(new Error('quota')); await tick(); };
    return h;
  };
  const told = (p) => p.then(() => 'answered', () => 'could not say');

  const a = host();
  const g1 = a.copies.get();
  const g2 = a.copies.get();
  await a.answer(['T1']);
  check('the first visitors together cause ONE read, the next ones none (single flight, then memory)',
    [a.reads, await g1, await g2, await a.copies.get(), a.reads], [1, ['T1'], ['T1'], ['T1'], 1]);
  check('…and the copy goes on disk for the other workers, stamped with when the read BEGAN', a.disk, { at: 1000, items: ['T1'] });
  const b = host();
  b.disk = { at: 900, items: ['T1'] };
  check('another worker answers from that disk copy, without a read', [await b.copies.get(), b.reads], [['T1'], 0]);
  a.t = 2000;
  a.stamp = 1500;
  const g4 = a.copies.get();
  await a.answer(['T2']);
  check('the owner changed them: the next visitor causes one read, and sees the change', [a.reads, await g4], [2, ['T2']]);

  const c = host();
  const old = c.copies.get();
  c.t = 1100;
  c.stamp = 1050;
  const after = c.copies.get();
  check('a change WHILE a read runs: the next visitor does not wait for the read begun before it', c.reads, 2);
  await c.answer(['OLD']);
  await c.answer(['NEW']);
  check('…each read answers its own visitor, and the copy kept — in memory and on disk — is the new one',
    [await old, await after, await c.copies.get(), c.reads, c.disk], [['OLD'], ['NEW'], ['NEW'], 2, { at: 1100, items: ['NEW'] }]);
  const d = host();
  void d.copies.get();
  d.t = 1100;
  d.stamp = 1050;
  void d.copies.get();
  await d.answer(['NEW'], 1);
  await d.answer(['OLD'], 0);
  check('…and an older read finishing LAST does not put its copy over the newer one, in memory or on disk',
    [await d.copies.get(), d.reads, d.disk], [['NEW'], 2, { at: 1100, items: ['NEW'] }]);

  const e = host();
  e.disk = { at: 500, items: ['STALE'] };
  e.stamp = 600;
  const eg = e.copies.get();
  await e.refuse();
  check('the read refused (the quota): the newest copy there is, old or not', await eg, ['STALE']);
  e.t += 30e3;
  check('…and no new read for a minute, however many visitors', [await e.copies.get(), await e.copies.get(), e.reads], [['STALE'], ['STALE'], 1]);
  e.t += 31e3;
  const eg2 = e.copies.get();
  await e.answer(['FRESH']);
  check('…then one try, which answered is the copy', [e.reads, await eg2], [2, ['FRESH']]);
  const f = host();
  const fg = told(f.copies.get());
  await f.refuse();
  check('no copy anywhere and the read refused: the caller is TOLD — it answers "could not say", never "there are none"',
    [await fg, await told(f.copies.get()), f.reads], ['could not say', 'could not say', 1]);
  const g = host();
  const gg = g.copies.get();
  await g.answer(['A']);
  await gg;
  g.t += 12 * 3600e3 + 1;
  void g.copies.get();
  check('a copy older than 12 hours is read again, once', g.reads, 2);
  const k = host();
  k.disk = { at: 1, items: ['X'] };
  k.stamp = 2;
  const kg = k.copies.get();
  await k.refuse();
  await kg;
  k.stamp = 3;
  k.copies.forget();
  void k.copies.get();
  check('told of a change, it reads again at once — the minute of waiting after a refusal or not', k.reads, 2);

  const r = host();
  const r1 = r.copies.get();
  await r.answer(['A']);
  await r1;
  r.t = 2000;
  r.stamp = 1500;
  const rl = r.copies.reload();
  await r.answer(['B']);
  check('after a change, "ok" only once the NEW copy is read — and on disk for the other workers',
    [await rl, r.disk, await r.copies.get(), r.reads], [true, { at: 2000, items: ['B'] }, ['B'], 2]);
  const q = host();
  q.disk = { at: 500, items: ['OLD'] };
  q.stamp = 600;
  const ql = q.copies.reload();
  await q.refuse();
  check('…and NOT ok when that read is refused: customers still get the old copy, so its files must stay',
    [await ql, await q.copies.get()], [false, ['OLD']]);
  const w = host();
  w.stamp = 5000;
  const w1 = w.copies.get();
  await w.answer(['W']);
  check('a clock that stepped back (the change dated ahead of it): one read, then the copy counts — not a read per visitor',
    [await w1, await w.copies.get(), await w.copies.get(), w.reads], [['W'], ['W'], ['W'], 1]);
  const v = host();
  v.disk = { at: 1, items: ['X'] };
  v.stamp = 2;
  v.t = 10000;
  const v1 = v.copies.get();
  await v.refuse();
  await v1;
  v.t = 5000;
  void v.copies.get();
  check('…and a refusal dated ahead of it does not hold back the next try', v.reads, 2);
  check('a new stamp must be later than the newest copy there is', [r.copies.newestAt(), host().copies.newestAt()], [2000, 0]);
}

console.log('\n== a customer\'s words in the shop\'s box ("Only the words") ==\n');
{
  const { Textbox } = createRequire(join(ROOT, 'package.json'))('fabric/node');
  // The box the shop drew: 600 × 68 units, its type 60 — one line.
  const BOX = { w: 600, h: 67.8, size: 60 };
  const fitted = (text) => {
    const tb = new Textbox(text, { width: BOX.w, fontSize: BOX.size, fontFamily: 'sans-serif' });
    D.fitText(tb, BOX.w, BOX.h);
    return tb;
  };
  const fitsAt = (text, size) => {
    const tb = new Textbox(text, { width: BOX.w, fontSize: size, fontFamily: 'sans-serif' });
    tb.initDimensions();
    return tb.width <= BOX.w + 0.5 && tb.height <= BOX.h + 0.5;
  };
  const short = fitted('Your name here');
  check('words that fit keep the shop\'s own size', short.fontSize, BOX.size);
  for (const text of ['Anna Andersson Lindqvist', 'Happy 40th birthday Karin!', 'Sara Lindqvist-Andersson, Försäljningschef på ReklamX Sverige AB']) {
    const tb = fitted(text);
    const inside = tb.width <= BOX.w + 0.5 && tb.height <= BOX.h + 0.5;
    // The LARGEST that fits: half a point more no longer does (one step by the
    // overflow left a name that had wrapped onto two lines at under half size).
    check(`"${text.slice(0, 26)}…": inside the box, at the largest size that fits (${tb.fontSize.toFixed(1)} of ${BOX.size})`,
      [inside, tb.fontSize <= BOX.size, !fitsAt(text, tb.fontSize + 0.5)], [true, true, true]);
  }
}

console.log('\n== the resolution, written into the file ==\n');
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(662, 0); ihdr.writeUInt32BE(662, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
const tagged = Buffer.from(D.withPngDpi(new Uint8Array(png), 300));
const phys = tagged.subarray(33, 54);
check('PNG: a pHYs chunk right after IHDR — 11811 pixels per metre (300 DPI) both ways, unit metre, with a CRC zlib agrees with',
  [phys.subarray(4, 8).toString('latin1'), phys.readUInt32BE(8), phys.readUInt32BE(12), phys[16], phys.readUInt32BE(17) === crc32(phys.subarray(4, 17)), tagged.length - png.length],
  ['pHYs', 11811, 11811, 1, true, 21]);
check('…and the rest of the file is untouched', [tagged.subarray(0, 33).equals(png.subarray(0, 33)), tagged.subarray(54).equals(png.subarray(33))], [true, true]);
const jfif = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9]);
const j = Buffer.from(D.withJpegDpi(new Uint8Array(jfif), 282));
check('JPEG with a JFIF header (aspect ratio only): units become dots per inch, density 282 × 282', [j[13], j.readUInt16BE(14), j.readUInt16BE(16), j.length], [1, 282, 282, jfif.length]);
const bare = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x02, 0xff, 0xd9]);
const jb = Buffer.from(D.withJpegDpi(new Uint8Array(bare), 300));
check('JPEG without one: a JFIF header is added after the start marker, the rest unchanged',
  [jb.subarray(6, 11).toString('latin1'), jb[13], jb.readUInt16BE(14), jb.subarray(20).equals(bare.subarray(2))], ['JFIF\u0000', 1, 300, true]);
check('anything that is not a PNG or a JPEG is returned as it was', [D.withPngDpi(new Uint8Array([1, 2, 3]), 300).length, D.withJpegDpi(new Uint8Array([1, 2, 3]), 300).length], [3, 3]);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all designer checks passed\n');
process.exit(failed ? 1 : 0);
