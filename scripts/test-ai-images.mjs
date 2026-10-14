#!/usr/bin/env node
// AI pictures for the designer — src/lib/aiImages.ts (designer v2's AI Studio).
//
//   node scripts/test-ai-images.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-aiimg-'));
await build({ entryPoints: [join(ROOT, 'src/lib/aiImages.ts')], outfile: join(dir, 'a.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const A = await import(pathToFileURL(join(dir, 'a.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

console.log('\n== the request ==\n');
check('words and a shape', A.cleanAiImageRequest({ prompt: '  Citroner i\n akvarell ', shape: 'portrait' }), { prompt: 'Citroner i akvarell', aspectRatio: '3:4' });
check('an unknown shape is square; landscape is 4:3', [A.cleanAiImageRequest({ prompt: 'abc', shape: 'x' }).aspectRatio, A.cleanAiImageRequest({ prompt: 'abc', shape: 'landscape' }).aspectRatio], ['1:1', '4:3']);
check('too few words, or none: refused', [A.cleanAiImageRequest({ prompt: 'a' }), A.cleanAiImageRequest(null), A.cleanAiImageRequest({})], [null, null, null]);
check('at most 500 characters', A.cleanAiImageRequest({ prompt: 'x'.repeat(900) }).prompt.length, 500);
check('words that are not a string are no words — a crafted object never throws', [A.cleanAiImageRequest({ prompt: { toString: 1 } }), A.cleanAiImageRequest({ prompt: ['abc', 'def'] }), A.cleanAiImageRequest({ prompt: 12345 })], [null, null, null]);

console.log('\n== the daily cap ==\n');
check('the owner\'s cap, made safe', [A.dailyCap(undefined), A.dailyCap('20'), A.dailyCap(-1), A.dailyCap(99999), A.dailyCap(0)], [80, 20, 80, 2000, 0]);
check('…an emptied box is not "none" (the default), and a cap is whole requests of four, rounded up', [A.dailyCap(''), A.dailyCap('  '), A.dailyCap(1), A.dailyCap(3), A.dailyCap(21)], [80, 80, 4, 4, 24]);
check('a fresh day starts at 0', A.takeBudget({ day: '2026-10-06', used: 79 }, '2026-10-07', 80, 4), { ok: true, next: { day: '2026-10-07', used: 4 } });
check('four more fit under the cap', A.takeBudget({ day: '2026-10-07', used: 76 }, '2026-10-07', 80, 4), { ok: true, next: { day: '2026-10-07', used: 80 } });
check('…and not one more', A.takeBudget({ day: '2026-10-07', used: 80 }, '2026-10-07', 80, 4), { ok: false, next: { day: '2026-10-07', used: 80 } });
check('a cap of 0 makes nothing', A.takeBudget(null, '2026-10-07', 0, 4).ok, false);
check('a garbled count reads as none used', A.takeBudget({ day: '2026-10-07', used: 'x' }, '2026-10-07', 80, 4), { ok: true, next: { day: '2026-10-07', used: 4 } });
// DSN-02 — Google made nothing (no pictures, or an HTTP error): the four go back.
check('given back: the four a request took', A.giveBack({ day: '2026-10-07', used: 80 }, '2026-10-07', 4), { day: '2026-10-07', used: 76 });
check('…so the customer who was told "limit" by nothing can try again',
  A.takeBudget(A.giveBack({ day: '2026-10-07', used: 80 }, '2026-10-07', 4), '2026-10-07', 80, 4).ok, true);
check('never below zero', A.giveBack({ day: '2026-10-07', used: 2 }, '2026-10-07', 4), { day: '2026-10-07', used: 0 });
check('a count from another day is left alone (writing it would overwrite today\'s)', A.giveBack({ day: '2026-10-06', used: 80 }, '2026-10-07', 4), null);
check('nothing used, or nothing readable: nothing to give back',
  [A.giveBack({ day: '2026-10-07', used: 0 }, '2026-10-07', 4), A.giveBack(null, '2026-10-07', 4), A.giveBack({ day: '2026-10-07', used: 'x' }, '2026-10-07', 4)], [null, null, null]);

console.log('\n== Google\'s answer ==\n');
const bytes = 'A'.repeat(200);
check('the pictures in it, at most four, PNG/JPEG/WebP only', A.imagesFromResponse({ generatedImages: [
  { image: { imageBytes: bytes, mimeType: 'image/png' } }, { image: { imageBytes: bytes, mimeType: 'image/jpeg' } }, { image: { imageBytes: bytes, mimeType: 'text/html' } },
  { image: { imageBytes: 'short', mimeType: 'image/png' } }, { image: { imageBytes: bytes } }, { image: { imageBytes: bytes } }, { image: { imageBytes: bytes } } ] }).map((x) => x.mime),
  ['image/png', 'image/jpeg', 'image/png', 'image/png']);
check('no pictures: none', [A.imagesFromResponse({}), A.imagesFromResponse(null), A.imagesFromResponse({ generatedImages: 'x' })], [[], [], []]);
check('what a failure means', [A.aiImageFailure(429, ''), A.aiImageFailure(403, ''), A.aiImageFailure(400, 'Imagen API is only accessible to billed users'), A.aiImageFailure(500, 'boom')], ['limit', 'off', 'off', 'failed']);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ AI picture rules hold\n');
process.exit(failed ? 1 : 0);
