#!/usr/bin/env node
// The print PDF's pure parts — src/lib/pdfWriter.ts and src/lib/printSpec.ts
// (designer v2). The browser half (tiles, encoders, the byte budget) runs in
// Chromium and WebKit in scripts/local-e2e/print-engine.mjs.
//
//   node scripts/test-print-file.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(ROOT, 'package.json'));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-printfile-'));
await build({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(join(ROOT, 'src/lib/pdfWriter.ts'))};`,
      `export * from ${JSON.stringify(join(ROOT, 'src/lib/printSpec.ts'))};`,
      `export { readPageBoxes, chooseArtworkBox } from ${JSON.stringify(join(ROOT, 'src/lib/pdfBoxes.ts'))};`,
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  outfile: join(dir, 'p.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const P = await import(pathToFileURL(join(dir, 'p.mjs')).href);
rmSync(dir, { recursive: true, force: true });
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const { createCanvas } = require('canvas');

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const r1 = (v) => Math.round(v * 10) / 10;

console.log('\n== the PDF writer ==\n');
// A two-sided 85 × 55 card with 3 mm bleed at 300 dpi: front in two tiles (one JPEG
// from node-canvas, one Flate), back in one Flate tile.
const MM = P.MM_TO_PT;
const dpi = 300;
const W = 85 + 6;
const H = 55 + 6;
const wPx = Math.ceil((W / 25.4) * dpi);
const hPx = Math.ceil((H / 25.4) * dpi);
const paint = (w, h, colour) => {
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = colour;
  x.fillRect(0, 0, w, h);
  return c;
};
const flate = (canvas) => {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4) { rgb[j++] = data[i]; rgb[j++] = data[i + 1]; rgb[j++] = data[i + 2]; }
  return new Blob([deflateSync(rgb)]);
};
const half = Math.floor(hPx / 2);
const pt = 72 / dpi;
const page = (tiles) => ({ widthPt: W * MM, heightPt: H * MM, bleedBox: [0, 0, W * MM, H * MM], trimBox: [3 * MM, 3 * MM, (W - 3) * MM, (H - 3) * MM], tiles });
const top = paint(wPx, half, '#1d71b8');
const bottom = paint(wPx, hPx - half, '#e30613');
const back = paint(wPx, hPx, '#009640');
const pdf = P.writePrintPdf([
  page([
    { data: new Blob([top.toBuffer('image/jpeg', { quality: 0.92 })]), filter: 'DCTDecode', widthPx: wPx, heightPx: half, xPt: 0, yPt: 0, wPt: wPx * pt, hPt: half * pt },
    { data: flate(bottom), filter: 'FlateDecode', widthPx: wPx, heightPx: hPx - half, xPt: 0, yPt: half * pt, wPt: wPx * pt, hPt: (hPx - half) * pt },
  ]),
  page([{ data: flate(back), filter: 'FlateDecode', widthPx: wPx, heightPx: hPx, xPt: 0, yPt: 0, wPt: wPx * pt, hPt: hPx * pt }]),
], { title: 'Test (card)' });
const bytes = new Uint8Array(await pdf.arrayBuffer());
const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
check('pdf.js opens it: two pages, each 91 × 61 mm (the card with its bleed)', [doc.numPages, ...(await Promise.all([1, 2].map(async (n) => (await doc.getPage(n)).view.map((v) => r1(v / MM)))))], [2, [0, 0, 91, 61], [0, 0, 91, 61]]);
const boxes = [];
for (const n of [1, 2]) {
  const p = await doc.getPage(n);
  const b = await P.readPageBoxes(bytes, p.ref, p.view);
  boxes.push(b && P.chooseArtworkBox({ view: p.view, trim: b.trim, bleed: b.bleed, userUnit: 1, rotate: 0 }));
}
// The BleedBox IS the page here (no slug), which the reader reports as page size: the
// bleed is the page around the TrimBox — what production places by.
check('the shop\'s own reader finds the TrimBox (85 × 55) on a 91 × 61 page — 3 mm of bleed all round — on both pages',
  boxes.map((b) => b && [b.source, r1(b.widthMm), r1(b.heightMm), r1(b.pageWidthMm), r1(b.pageHeightMm)]), [['trimbox', 85, 55, 91, 61], ['trimbox', 85, 55, 91, 61]]);
// Where each tile is drawn: "q w 0 0 h x y cm /Tn Do Q" — y measured from the BOTTOM.
// (Rendering is checked with pdf.js in Chromium and WebKit, scripts/local-e2e/print-engine.mjs.)
const latin = new TextDecoder('latin1').decode(bytes);
const placed = [...latin.matchAll(/q ([-\d.]+) 0 0 ([-\d.]+) ([-\d.]+) ([-\d.]+) cm \/T(\d+) Do Q/g)].map((m) => m.slice(1, 5).map(Number));
const pageH = H * MM;
// The page in pixels is rounded UP, so the last row hangs off the bottom by less than
// one pixel (0.24 pt at 300 dpi) — inside the bleed, and clipped by the page.
const onePx = 72 / 300;
check('the tiles land where they were put: the TOP tile drawn high on the page, the bottom one at the bottom (y flipped)',
  [placed.length, Math.abs(placed[0][3] - (pageH - half * pt)) < 0.01, Math.abs(placed[1][3]) < onePx, Math.abs(placed[0][1] - half * pt) < 0.01], [3, true, true, true]);
const text = new TextDecoder('latin1').decode(bytes);
check('it ends with a cross-reference table pdf.js did not have to repair, and the title is plain ASCII',
  [/startxref\n\d+\n%%EOF\n$/.test(text), /\/Title \(Test \\\(card\\\)\)/.test(text)], [true, true]);
check('a page larger than PDF allows (200 in) is refused, not written', (() => { try { P.writePrintPdf([{ ...page([]), widthPt: 14_401 }]); return 'written'; } catch { return 'refused'; } })(), 'refused');

console.log('\n== how a product is printed ==\n');
check('the kind comes from the size question the product uses',
  ['rollup_banner_size', 'large_format_size', 'flag_size', 'business_card_size', 'sticker_label_size', 'poster_size', 'standard_paper_format'].map((f) => P.kindOfProduct([f])),
  ['rollup', 'banner', 'flag', 'card', 'sticker', 'poster', 'print']);
const rollup = P.printSpecFor({ kind: 'rollup', trimMm: { wMm: 850, hMm: 2000 } });
check('a roll-up 85 × 200: 3 mm bleed, nothing in the bottom 100 mm (cassette) or the top 30 mm (rail), 150 dpi, never below 100',
  [rollup.bleedMm, rollup.hiddenMm, rollup.targetDpi, rollup.minDpi], [3, { top: 30, right: 0, bottom: 100, left: 0 }, 150, 100]);
check('a business card: 300 dpi, never below 150; an A2 poster: 200 (150)',
  [P.printSpecFor({ kind: 'card', trimMm: { wMm: 85, hMm: 55 } }).targetDpi, P.printSpecFor({ kind: 'poster', trimMm: { wMm: 420, hMm: 594 } }).targetDpi], [300, 200]);
const bands = P.cleanDpiBands([{ maxLongSideMm: 600, targetDpi: 250, minDpi: 200 }, { maxLongSideMm: null, targetDpi: 120, minDpi: 90 }, { maxLongSideMm: 'x', targetDpi: 1 }]);
check('HIS resolution table (from the dashboard) is used, made safe; a broken row is dropped',
  [bands, P.printSpecFor({ kind: 'banner', trimMm: { wMm: 2000, hMm: 1000 }, bands }).minDpi], [[{ maxLongSideMm: 600, targetDpi: 250, minDpi: 200 }, { maxLongSideMm: null, targetDpi: 120, minDpi: 90 }], 90]);
check('…and HIS values for one product win over the kind\'s',
  (({ bleedMm, safeMm, hiddenMm, minDpi }) => ({ bleedMm, safeMm, hiddenMm, minDpi }))(P.printSpecFor({ kind: 'rollup', trimMm: { wMm: 850, hMm: 2000 }, override: { bleedMm: 5, safeMm: 25, hiddenMm: { bottom: 150 }, minDpi: 120 } })),
  { bleedMm: 5, safeMm: 25, hiddenMm: { top: 30, right: 0, bottom: 150, left: 0 }, minDpi: 120 });
check('…each hidden side on its own: only the foot given, the rail\'s 30 mm at the top stays (an empty box is the usual value, not 0)',
  P.cleanSpecOverride({ hiddenMm: { bottom: 120, top: '', left: null } }), { hiddenMm: { bottom: 120 } });
check('…and kept inside the product: a 100 mm foot on a 55 mm card, a 500 mm safe margin',
  (({ safeMm, hiddenMm }) => ({ safeMm, hiddenMm }))(P.printSpecFor({ kind: 'card', trimMm: { wMm: 85, hMm: 55 }, override: { safeMm: 500, hiddenMm: { bottom: 100 } } })),
  { safeMm: 13.75, hiddenMm: { top: 0, right: 0, bottom: 33, left: 0 } });
check('a target below his floor is raised to the floor', P.printSpecFor({ kind: 'card', trimMm: { wMm: 85, hMm: 55 }, override: { targetDpi: 100, minDpi: 200 } }).targetDpi, 200);
check('resolutions tried, best first, ending exactly at the floor', P.dpiSteps({ targetDpi: 300, minDpi: 150 }), [300, 255, 216, 183, 155, 150]);
check('the page in pixels is rounded UP (never short of the size): 91 × 61 mm at 300 dpi', P.pagePixels({ wMm: 85, hMm: 55 }, 3, 300), { w: 1075, h: 721 });

console.log('\n== tiles ==\n');
const roll = P.pagePixels({ wMm: 850, hMm: 2000 }, 3, 150);
const tiles = P.tilePlan(roll.w, roll.h);
const covered = tiles.reduce((s, t) => s + t.w * t.h, 0);
const overlaps = tiles.some((a, i) => tiles.some((b, j) => i !== j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
check(`a roll-up at 150 dpi (${roll.w} × ${roll.h} px) in ${tiles.length} tiles: every pixel once, none twice`, [covered === roll.w * roll.h, overlaps], [true, false]);
check('…each tile at most 4096 px a side and 8 MP (a phone renders them one at a time)', tiles.every((t) => t.w <= 4096 && t.h <= 4096 && t.w * t.h <= 8_000_000), true);
check('a business card is one tile', P.tilePlan(1075, 721).length, 1);
check('the largest page the catalogue sells (4 × 2 m at 100 dpi) still tiles within the limits',
  (() => { const p = P.pagePixels({ wMm: 4000, hMm: 2000 }, 3, 100); const t = P.tilePlan(p.w, p.h); return t.every((x) => x.w <= 4096 && x.w * x.h <= 8_000_000) && t.reduce((s, x) => s + x.w * x.h, 0) === p.w * p.h; })(), true);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ every print-file rule holds\n');
process.exit(failed ? 1 : 0);
