// The print engine (src/components/product/designer/printFile.ts) in REAL browsers:
// Chromium, and WebKit — the engine of every iPhone. Three files are made:
//   card   — a two-sided 85 × 55 business card (one tile a page, flat artwork);
//   rollup — an 85 × 200 cm roll-up: a pattern background, big type, a photo, a QR;
//   heavy  — a two-sided 100 × 200 cm design that is one noisy photograph on both
//            sides: the worst case for the byte budget.
// Each PDF is rendered back with pdf.js and compared with the design rendered by
// fabric — the whole page, and close-ups across tile seams at the file's own
// resolution — then its boxes are read with the shop's own PDF reader.
//
// No shop server needed: the harness (./print-engine/) is built with Vite and served
// by this script.  node scripts/local-e2e/print-engine.mjs
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(join(ROOT, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const esbuild = require('esbuild');
const { chromium, webkit } = require('playwright');
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);

const work = mkdtempSync(join(tmpdir(), 'reklamx-print-engine-'));
const site = join(work, 'site');
const out = join(work, 'out');
mkdirSync(out);
await build({
  configFile: false,
  root: join(ROOT, 'scripts/local-e2e/print-engine'),
  logLevel: 'error',
  build: { outDir: site, emptyOutDir: true, target: 'es2022' },
});
await esbuild.build({ entryPoints: [join(ROOT, 'src/lib/pdfBoxes.ts')], outfile: join(work, 'boxes.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const B = await import(pathToFileURL(join(work, 'boxes.mjs')).href);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff2': 'font/woff2', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/upload') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      writeFileSync(join(out, url.searchParams.get('name').replace(/[^\w.-]/g, '_')), Buffer.concat(chunks));
      res.end('ok');
    });
    return;
  }
  const path = join(site, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!path.startsWith(site) || !existsSync(path)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
  res.end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
};

for (const [label, type] of [['Chromium', chromium], ['WebKit', webkit]]) {
  console.log(`\n== ${label} ==\n`);
  const browser = await type.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
  await page.goto(base);
  await page.waitForFunction(() => document.getElementById('state')?.textContent === 'ready', null, { timeout: 60_000 });
  for (const name of ['card', 'rollup', 'heavy', 'round', 'grey']) {
    let r;
    try {
      r = await page.evaluate((n) => window.runCase(n), name, { timeout: 900_000 });
    } catch (e) {
      check(`${name}: the file was made`, false, String(e?.message ?? e).split('\n')[0]);
      continue;
    }
    const pdfBytes = new Uint8Array(readFileSync(join(out, r.file.replace(/[^\w.-]/g, '_'))));
    const doc = await pdfjs.getDocument({ data: pdfBytes.slice(), isEvalSupported: false }).promise;
    const boxes = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const p = await doc.getPage(n);
      const raw = await B.readPageBoxes(pdfBytes, p.ref, p.view);
      boxes.push(raw && B.chooseArtworkBox({ view: p.view, trim: raw.trim, bleed: raw.bleed, userUnit: 1, rotate: 0 }));
    }
    const mb = (r.bytes / 1024 / 1024).toFixed(1);
    console.log(`     ${name}: ${r.pages} page(s), ${r.dpi} dpi (target ${r.targetDpi}, floor ${r.minDpi}), JPEG ${r.quality}, ${r.tiles} tile(s)/page, ${mb} MB, ${(r.ms / 1000).toFixed(1)} s`);
    const expectedPages = name === 'rollup' || name === 'round' ? 1 : 2;
    const trims = { card: [85, 55], rollup: [850, 2000], heavy: [1000, 2000], round: [850, 2000], grey: [85, 55] }[name];
    check(`${name}: ${expectedPages} page(s), each with the product's TrimBox (${trims.join(' × ')} mm)`,
      r.pages === expectedPages && boxes.every((b) => b && b.source === 'trimbox' && Math.abs(b.widthMm - trims[0]) < 0.2 && Math.abs(b.heightMm - trims[1]) < 0.2),
      JSON.stringify(boxes.map((b) => b && [b.source, b.widthMm, b.heightMm])));
    check(`${name}: under the 38 MB the shop can store and file (${mb} MB), at or above the floor (${r.dpi} ≥ ${r.minDpi} dpi)`, r.bytes <= 38 * 1024 * 1024 && r.dpi >= r.minDpi);
    for (const c of r.checks) {
      // "heavy" is pure noise — every JPEG and every resampler differs on it most; it is
      // there for the byte budget. Real designs are held to the strict limit.
      const limit = name === 'heavy' ? 20 : 8;
      check(`${name} ${c.side}: the PDF looks like the design (whole page, mean difference ${c.whole} of 255, limit ${limit})`, c.whole < limit, JSON.stringify(c));
      const bad = c.seams.filter((s) => s.seamRow > s.elsewhere + 6);
      check(`${name} ${c.side}: no seam where tiles meet (${c.seams.length} seam(s) inspected at ${r.dpi} dpi)`, bad.length === 0, JSON.stringify(c.seams));
    }
    if (name === 'card') check('card: a preview per side', r.previews.length === 2 && r.previews.every(([, size]) => size > 0));
    // fabric caches a clipped object at 2 MP and scales it up: a round picture 600 mm across
    // a roll-up lost most of its detail in the file while the check before attaching was happy.
    if (name === 'round') {
      check(`round: a picture cut round prints as sharp as the picture itself (contrast ${r.sharpness?.pdf} of ${r.sharpness?.ref})`,
        !!r.sharpness && r.sharpness.ref > 20 && r.sharpness.pdf / r.sharpness.ref > 0.8, JSON.stringify(r.sharpness));
    }
    if (name === 'grey') {
      check(`grey: a side printed in black only is made in greys — the file and its pictures (most colour ${r.mostChroma}, previews ${r.previewChroma.join('/')})`,
        r.mostChroma !== null && r.mostChroma <= 8 && r.previewChroma.every((v) => v <= 2), JSON.stringify([r.mostChroma, r.previewChroma]));
    }
  }
  check(`${label}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

server.close();
rmSync(work, { recursive: true, force: true });
console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ the print engine holds in Chromium and WebKit\n');
process.exit(failed ? 1 : 0);
