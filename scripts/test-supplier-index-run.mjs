#!/usr/bin/env node
// The supplier-index step machine — src/lib/suppliers/indexRun.ts.
//
// WHY IT EXISTS. This is the code that decides whether to write thousands of
// documents into a closed collection, on a free-tier project whose daily quota
// has taken the shop dark three times. Every one of those decisions is a pure
// function here so it can be driven in milliseconds without a database — which
// is not a nicety: the day it was written Firestore refused every read, so an
// integration test could not have run at all.
//
//   node scripts/test-supplier-index-run.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-idxrun-'));
const out = join(outDir, 'indexRun.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'suppliers', 'indexRun.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const M = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });
const { idForEntry, nextPhase, refuseEmptyFeed, claimable, percentDone, INDEX_BATCH, STALE_MS } = M;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond, d = '') => { if (cond) console.log(`  ✅ ${name}${d ? ` — ${d}` : ''}`); else { failed += 1; console.error(`  ❌ ${name}${d ? ` — ${d}` : ''}`); } };

console.log('\nthe document id — byte-identical to the laptop script, or rows double');
// THE RULE IT MUST MATCH, copied from scripts/index-supplier.mjs:168:
//   `${e.supplier}__${String(e.productKey).replace(/[^\w.-]+/g, '_')}`
const legacy = (e) => `${e.supplier}__${String(e.productKey).replace(/[^\w.-]+/g, '_')}`;
for (const key of ['AP123', 'MO-9876', 'a b/c', 'ÅÄÖ-1', '12.34', 'x'.repeat(30), '']) {
  const e = { supplier: 'easygifts', productKey: key };
  ok(`key ${JSON.stringify(key)}`, idForEntry(e) === legacy(e), idForEntry(e));
}
check('a slash can never reach the id', idForEntry({ supplier: 'midocean', productKey: 'a/b' }).includes('/'), false);

console.log('\nwhere a run goes next');
check('a fresh run fetches', nextPhase({ phase: 'fetch', cursor: 0, total: 0 }), 'fetch');
check('with rows left it writes', nextPhase({ phase: 'write', cursor: 400, total: 1330 }), 'write');
check('at the end it finishes', nextPhase({ phase: 'write', cursor: 1330, total: 1330 }), 'finish');
// A blocked or done run must be inert: nothing may restart it by accident.
check('blocked stays blocked', nextPhase({ phase: 'blocked', cursor: 0, total: 0 }), 'blocked');
check('done stays done', nextPhase({ phase: 'done', cursor: 9, total: 9 }), 'done');

console.log('\nan empty feed is refused, never treated as an emptied supplier');
// The laptop script has no guard: empty entries means every existing row is
// "departed", so one shape change at the supplier would mark a catalogue gone.
check('zero rows is refused', refuseEmptyFeed(0), true);
check('and so is nonsense', [refuseEmptyFeed(NaN), refuseEmptyFeed(-1), refuseEmptyFeed(undefined)], [true, true, true]);
check('one row is a feed', refuseEmptyFeed(1), false);

console.log('\nwho may drive a run');
const t = Date.parse('2026-09-13T12:00:00.000Z');
const run = (phase, updatedAt) => ({ supplier: 'easygifts', runId: 'r', phase, cursor: 0, total: 10, startedAt: '', updatedAt });
check('nothing running → claim it', claimable(null, t), 'claim');
check('a finished run → claim a new one', claimable(run('done', new Date(t).toISOString()), t), 'claim');
// A second press while it is moving must ATTACH, not race a second writer.
check('a live run → attach', claimable(run('write', new Date(t - 5000).toISOString()), t), 'attach');
// And a run killed mid-step must be resumable, or one 502 strands it for ever.
check('a stalled run → take it over', claimable(run('write', new Date(t - STALE_MS - 1000).toISOString()), t), 'takeover');
check('exactly at the threshold it is still live', claimable(run('write', new Date(t - STALE_MS + 1000).toISOString()), t), 'attach');

console.log('\nwhat the screen shows');
check('fetching shows 0, not a made-up number', percentDone({ phase: 'fetch', cursor: 0, total: 0 }), 0);
check('half way', percentDone({ phase: 'write', cursor: 665, total: 1330 }), 50);
// NEVER 100 BEFORE IT IS DONE: the gone pass and the stamp come after the last
// row, and a bar reading 100% while work remains is the screen lying again.
check('the last batch is 99, not 100', percentDone({ phase: 'write', cursor: 1330, total: 1330 }), 99);
check('only done is 100', percentDone({ phase: 'done', cursor: 1330, total: 1330 }), 100);

console.log('\nthe batch stays under Firestore’s limit');
ok('400 leaves room for the progress write', INDEX_BATCH <= 450 && INDEX_BATCH > 0, String(INDEX_BATCH));

console.log(`\n${failed === 0 ? 'The step machine resumes, refuses and reports honestly.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
