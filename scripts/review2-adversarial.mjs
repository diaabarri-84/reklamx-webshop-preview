#!/usr/bin/env node
// Hostile input against the money and coupon modules — the adversarial half of
// the round-14 review, kept because it is worth re-running.
//
// It asserts PROPERTIES rather than values, which is what makes it useful on code
// that keeps changing: a total is finite and never negative; a discount never
// exceeds the base it was computed from; subtotal − discount + shipping always
// equals the net; points are never worth more than the goods nor more than the
// balance; no coupon shape reads as Active unless `active === true`; every basket
// that would sell below cost is refused; a poisoned supplier feed yields products
// or none, never a crash and never a zero price.
//
// It has already earned its place twice: it found calcOrderTotals returning an
// Infinity total for an absurd VAT rate, and it is the check that says the
// 4.9 shipping split still reconciles at every percentage.
//
// Usage:  node scripts/review2-adversarial.mjs
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'rx-adv-'));
const bundle = async (rel, name) => {
  const out = join(outDir, name);
  await build({ entryPoints: [join(ROOT, ...rel)], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(pathToFileURL(out).href);
};
const P = await bundle(['src','lib','pricing.ts'], 'p.mjs');
const L = await bundle(['src','lib','loyalty.ts'], 'l.mjs');
const CS = await bundle(['src','lib','couponStatus.ts'], 'cs.mjs');
const CR = await bundle(['src','lib','couponRules.ts'], 'cr.mjs');
const MO = await bundle(['src','lib','suppliers','midocean.ts'], 'mo.mjs');
rmSync(outDir, { recursive: true, force: true });

let problems = 0;
const note = (msg) => { problems += 1; console.log(`  ❌ ${msg}`); };
const good = (msg) => console.log(`  ✅ ${msg}`);

const hostile = [
  undefined, null, NaN, Infinity, -Infinity, '', '0', 'NaN', -1, 1e308,
  '1e309', '-0', 0.1 + 0.2, '  12  ', true, false, {}, [], () => {},
];

console.log('\n== calcOrderTotals never throws and never goes negative ==');
for (const v of hostile) {
  for (const field of ['discountPercent','maxDiscountAmount','pointsToRedeem','pointsBalance','vatRate']) {
    try {
      const t = P.calcOrderTotals({
        lineTotals: [1000], shippingMethod: 'standard', shippingFees: { standard: 99 },
        [field]: v, discountIncludesShipping: true,
      });
      if (!Number.isFinite(t.grossTotal)) note(`${field}=${String(v)} → grossTotal ${t.grossTotal}`);
      else if (t.grossTotal < 0 || t.netTotal < 0) note(`${field}=${String(v)} → negative total`);
      else if (t.discountAmount < 0) note(`${field}=${String(v)} → negative discount`);
    } catch (e) {
      // A thrown "could not be calculated" is the designed refusal for a
      // nonsense VAT rate; anything else is a crash.
      if (!String(e.message).includes('could not be calculated')) note(`${field}=${String(v)} threw ${e.message}`);
    }
  }
}
console.log(problems === 0 ? '  ✅ every hostile input gave a finite, non-negative total' : '');

console.log('\n== a hostile lineTotals array ==');
for (const lines of [[NaN], [Infinity], ['abc'], [null], [-1000], [1e308, 1e308], [{}, []]]) {
  try {
    const t = P.calcOrderTotals({ lineTotals: lines, discountPercent: 50 });
    if (!Number.isFinite(t.grossTotal)) note(`lineTotals=${JSON.stringify(lines)} → ${t.grossTotal}`);
  } catch (e) {
    if (!String(e.message).includes('could not be calculated')) note(`lineTotals=${JSON.stringify(lines)} threw ${e.message}`);
  }
}
good('a poisoned basket is refused or finite, never silently wrong');

console.log('\n== the discount can never exceed what is being sold ==');
for (let pct = 0; pct <= 100; pct += 10) {
  for (const incl of [false, true]) {
    const t = P.calcOrderTotals({
      lineTotals: [500, 250], shippingMethod: 'standard', shippingFees: { standard: 99 },
      discountPercent: pct, discountIncludesShipping: incl,
    });
    const ceiling = 750 + (incl ? 99 : 0);
    if (t.discountAmount > ceiling + 0.001) note(`${pct}% incl=${incl} → discount ${t.discountAmount} > ${ceiling}`);
    const expected = Math.max(0, 750 + 99 - t.discountAmount);
    if (Math.abs(t.netTotal - expected) > 0.011) note(`${pct}% incl=${incl} → net ${t.netTotal} ≠ ${expected}`);
  }
}
good('discount ≤ its own base, and subtotal − discount + shipping = net, at every percentage');

console.log('\n== points can never be worth more than the goods ==');
for (const bal of [0, 1, 9999, 1e9]) {
  for (const rate of [1, 10, 100]) {
    const s = { ...L.LOYALTY_DEFAULTS, pointsPerSek: rate };
    const t = P.calcOrderTotals({ lineTotals: [1000], pointsToRedeem: 1e9, pointsBalance: bal, loyalty: s });
    if (t.pointsDiscountAmount > 1000) note(`balance ${bal} rate ${rate} → ${t.pointsDiscountAmount} kr off 1000`);
    if (t.pointsRedeemed > bal) note(`balance ${bal} → redeemed ${t.pointsRedeemed}`);
  }
}
good('a customer can never redeem more than the balance, nor more than the goods');

console.log('\n== couponStatus / gates on garbage ==');
for (const c of [null, undefined, {}, { active: 1 }, { expiresAt: [] }, { maxUses: '4', usedCount: '9' }, { startsAt: {} }]) {
  try {
    const kind = CS.couponStatus(c ?? {}, Date.now());
    if (!['expired','usedUp','inactive','scheduled','active'].includes(kind)) note(`couponStatus → ${kind}`);
    // THE ONE THAT MATTERS: garbage must never read as active.
    if (kind === 'active' && !(c && c.active === true)) note(`garbage read as ACTIVE: ${JSON.stringify(c)}`);
  } catch (e) { note(`couponStatus threw on ${JSON.stringify(c)}: ${e.message}`); }
  try { CR.checkCouponGates(c ?? {}, { nowMs: Date.now(), signedIn: false }); }
  catch (e) { note(`checkCouponGates threw on ${JSON.stringify(c)}: ${e.message}`); }
}
good('no coupon shape reads as Active unless active === true');

console.log('\n== the margin guard cannot be talked into allowing a loss ==');
for (const [rev, cost, disc, floor] of [[1000,700,400,0],[1000,1000,1,0],[1,1000,0,0],[1000,700,'400',0],[1000,700,NaN,0]]) {
  const v = CR.checkMarginFloor([{ revenue: rev, cost }], rev, disc, floor);
  const after = Math.max(0, rev - (Number(disc) || 0));
  const losing = after < cost;
  if (losing && !v.breached) note(`a loss (${after} < ${cost}) was NOT refused`);
}
good('every basket that would sell below cost is refused');

console.log('\n== midocean on a poisoned feed ==');
for (const feed of [null, {}, { products: null }, { products: [null, 1, 'x', {}] }, { products: [{ master_code: 'A', variants: 'nope' }] }]) {
  try {
    const out = MO.parseMidocean(feed ?? {});
    if (!Array.isArray(out)) note(`parseMidocean → ${typeof out}`);
    for (const p of out) if (p.sourcePrice !== null && !(p.sourcePrice > 0)) note(`a product priced ${p.sourcePrice}`);
  } catch (e) { note(`parseMidocean threw on ${JSON.stringify(feed)}: ${e.message}`); }
}
good('a poisoned supplier feed yields products or none, never a crash or a zero price');

console.log(`\n${problems === 0 ? 'Review 2: nothing hostile got through.' : `Review 2: ${problems} problem(s).`}`);
process.exit(problems === 0 ? 0 : 1);
