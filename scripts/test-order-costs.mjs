#!/usr/bin/env node
// What an order cost us — src/lib/orderCosts.ts.
//
// WHY IT EXISTS
// Every margin figure the shop will ever show is built on these numbers, and two
// of the cases below are ways of being wrong that nobody would notice:
//
//   * a missing cost written as 0 makes a product read as PURE PROFIT. That is
//     the most flattering possible lie and the hardest to spot in a report;
//   * rounding each unit before multiplying turns a half-öre into a krona of
//     drift on a run of two hundred, every time.
//
// Usage:  node scripts/test-order-costs.mjs
// Exit:   0 = every figure is honest

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-costs-'));
const outFile = join(outDir, 'orderCosts.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'orderCosts.ts')],
  outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { buildCostSnapshot } = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond, detail) => {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
};

const costs = (obj) => new Map(Object.entries(obj));

console.log('\nan ordinary line');
let s = buildCostSnapshot(
  [{ productId: 'p1', quantity: 10 }],
  costs({ p1: { sourcePrice: 2.05, sourceRate: 11.5, sourceCurrency: 'EUR', supplier: 'promediaplus' } }),
);
check('unit cost is trade × rate', s.lines[0].unitCost, 23.58);
check('line cost is unit × quantity, rounded ONCE', s.lines[0].lineCost, 235.75);
ok('rounding the unit first would have given 235.80 — a 5 öre drift on ten',
  s.lines[0].lineCost !== 235.8, `got ${s.lines[0].lineCost}`);
check('the trade figures are kept so the number can be explained',
  [s.lines[0].sourcePrice, s.lines[0].sourceCurrency, s.lines[0].sourceRate], [2.05, 'EUR', 11.5]);
check('the supplier travels with it', s.lines[0].supplier, 'promediaplus');
check('the order total', s.goodsCost, 235.75);
check('and it is complete', s.complete, true);

console.log('\nTHE LIE THIS EXISTS TO PREVENT — a cost that is not known');
s = buildCostSnapshot([{ productId: 'own-product', quantity: 5 }], costs({}));
ok('no cost record → costKnown: false, NOT a cost of zero', s.lines[0].costKnown === false);
ok('and no unitCost key at all', !('unitCost' in s.lines[0]));
check('the order total does not pretend', s.goodsCost, 0);
check('and says it is incomplete', s.complete, false);
check('with the count spelled out', [s.linesWithCost, s.lineCount], [0, 1]);

console.log('\nrecords that exist but say nothing usable');
const junk = {
  'no-rate': { sourcePrice: 10 },
  'zero-rate': { sourcePrice: 10, sourceRate: 0 },
  'negative-rate': { sourcePrice: 10, sourceRate: -1 },
  'no-price': { sourceRate: 11.5 },
  'string-price': { sourcePrice: 'ten', sourceRate: 11.5 },
  'negative-price': { sourcePrice: -5, sourceRate: 11.5 },
  'nan': { sourcePrice: NaN, sourceRate: 11.5 },
};
for (const [id, record] of Object.entries(junk)) {
  const one = buildCostSnapshot([{ productId: id, quantity: 1 }], costs({ [id]: record }));
  ok(`${id.padEnd(15)} is treated as unknown, not as free`, one.lines[0].costKnown === false,
    JSON.stringify(one.lines[0]));
}
// The one that IS legitimate: a genuinely free item.
s = buildCostSnapshot([{ productId: 'freebie', quantity: 3 }], costs({ freebie: { sourcePrice: 0, sourceRate: 11.5 } }));
check('a trade price of ZERO is a real cost of zero, and is kept', s.lines[0].unitCost, 0);
check('and counts as known', s.complete, true);

console.log('\na mixed order — the case a single total would misrepresent');
s = buildCostSnapshot(
  [{ productId: 'p1', quantity: 2 }, { productId: 'handmade', quantity: 1 }, { productId: null, quantity: 1 }],
  costs({ p1: { sourcePrice: 10, sourceRate: 10 } }),
);
check('the known line is costed', s.lines[0].lineCost, 200);
check('the unknown ones are not', [s.lines[1].costKnown, s.lines[2].costKnown], [false, false]);
check('the total covers only what is known', s.goodsCost, 200);
check('and the counts say how much that is', [s.linesWithCost, s.lineCount], [1, 3]);
ok('complete is FALSE — a goodsCost that hides two uncosted lines is worse than none',
  s.complete === false);

console.log('\nquantities');
s = buildCostSnapshot([{ productId: 'p1', quantity: 2.7 }], costs({ p1: { sourcePrice: 10, sourceRate: 10 } }));
check('a fractional quantity is floored — half a unit was never sold', s.lines[0].quantity, 2);
s = buildCostSnapshot([{ productId: 'p1', quantity: -5 }], costs({ p1: { sourcePrice: 10, sourceRate: 10 } }));
check('a negative quantity cannot produce a negative cost', [s.lines[0].quantity, s.lines[0].lineCost], [0, 0]);
s = buildCostSnapshot([{ productId: 'p1' }], costs({ p1: { sourcePrice: 10, sourceRate: 10 } }));
check('a missing quantity is 0, not 1', s.lines[0].quantity, 0);

console.log('\nnothing at all');
s = buildCostSnapshot([], costs({}));
check('an empty order has no total and is not "complete"', [s.goodsCost, s.complete, s.lineCount], [0, false, 0]);

console.log(`\n${failed === 0 ? 'Every cost figure is honest.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
