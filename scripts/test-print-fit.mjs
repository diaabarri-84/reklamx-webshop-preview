#!/usr/bin/env node
// The one-A4-page search (src/lib/printFit.ts): never zoom up, never past the
// floor, every zoom it returns was measured to fit, it does not over-shrink a
// sheet whose text re-wraps as it gets smaller, and a sheet that cannot fit at
// all is printed at its normal size rather than tiny on two pages anyway.
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-printfit-'));
const out = join(dir, 'f.mjs');
await build({ entryPoints: [join(ROOT, 'src/lib/printFit.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const f = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => { if (ok) console.log(`  ✅ ${name}`); else { failed += 1; console.error(`  ❌ ${name} ${detail}`); } };
const H = f.A4_CONTENT_HEIGHT_PX;
const ROOM = H - 12;
// Fake sheets: each is a function from zoom to the height it would print at.
const linear = (h) => (z) => h * z;
const rewraps = (h) => (z) => h * z * z; // shorter than linear: longer lines as it shrinks
const clamped = (h, least) => (z) => Math.max(h * z, least); // text stops shrinking
const calls = (fn) => { const seen = []; return { seen, fn: (z) => { seen.push(z); return fn(z); } }; };

check('A4 minus 10 mm margins is 718 × 1046 px', f.A4_CONTENT_WIDTH_PX === 718 && H === 1046);
check('a sheet that fits is not zoomed — and is measured once', (() => { const c = calls(linear(900)); return f.findFitZoom(c.fn) === 1 && c.seen.length === 1; })());
check('a sheet that fits only without slack IS zoomed (rounding guard)', f.findFitZoom(linear(H - 2)) < 1);
check('half again a page → about two thirds', Math.abs(f.findFitZoom(linear(1.5 * H)) - ROOM / (1.5 * H)) < 0.006, String(f.findFitZoom(linear(1.5 * H))));
check('the floor is 0.6 — the smallest text (10 px) prints at 6 px', f.MIN_PRINT_ZOOM === 0.6);
for (const [name, sheet] of [['linear', linear], ['re-wrapping', rewraps]]) {
  // Either the zoom found fits, or it is 1 because not even the floor fits.
  check(`${name}: the zoom found fits the page — or is 1 because nothing above the floor does`, [1040, 1100, 1500, 2000, 2200].every((h) => {
    const z = f.findFitZoom(sheet(h));
    return z < 1 ? sheet(h)(z) <= ROOM : sheet(h)(1) <= ROOM || sheet(h)(f.MIN_PRINT_ZOOM) > ROOM;
  }));
}
check('re-wrapping text is NOT over-shrunk: it gets a larger zoom than the one-shot guess', (() => {
  const z = f.findFitZoom(rewraps(1500));
  return z > ROOM / 1500 + 0.05 && Math.abs(z - Math.sqrt(ROOM / 1500)) < 0.01;
})(), String(f.findFitZoom(rewraps(1500))));
check('text that stops shrinking: the one-shot guess would spill; the search keeps going down', (() => {
  const sheet = (z) => (z > 0.6 ? 1500 * z : 1500 * 0.6 + (0.6 - z) * 200); // shrinks slower below 0.6
  const z = f.findFitZoom(sheet);
  return sheet(z) <= ROOM && z < ROOM / 1500;
})());
check('a sheet that cannot fit even at the floor prints at its normal size (two readable pages, not two tiny ones)', f.findFitZoom(clamped(1500, 1200)) === 1 && f.findFitZoom(linear(100000)) === 1);
check('never below the readable floor', [1100, 1500, 2000, 2300].every((h) => { const z = f.findFitZoom(linear(h)); return z === 1 || z >= f.MIN_PRINT_ZOOM; }));
check('…and a sheet that fits only AT the floor gets the floor', Math.abs(f.findFitZoom(linear(Math.floor(ROOM / f.MIN_PRINT_ZOOM))) - f.MIN_PRINT_ZOOM) < 0.006);
check('nonsense heights do nothing', [0, -5, NaN, Infinity].every((h) => f.findFitZoom(() => h) === 1));
check('a measurement that breaks half-way stops the search at 1, never NaN', f.findFitZoom((z) => (z === 1 ? 2000 : NaN)) === 1);
check('it measures a bounded number of times (a print must not hang)', (() => { const c = calls(rewraps(5000)); f.findFitZoom(c.fn); return c.seen.length <= 21; })());
console.log(failed ? `\n❌ ${failed} failed\n` : '\n✅ all print-fit checks passed\n');
process.exit(failed ? 1 : 0);
