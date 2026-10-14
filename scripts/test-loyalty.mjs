#!/usr/bin/env node
// The loyalty programme's numbers — src/lib/loyalty.ts.
//
// WHY IT EXISTS
// 4.25 and 4.26. "10 points = 1 SEK" was a constant in pricing.ts, a literal in
// the checkout, three locale strings and tier thresholds written out in three
// files. The owner asked to set the rate himself, and every copy is a copy that
// can be missed. The tiers followed the CURRENT BALANCE, so a customer reached
// Gold on one order and was demoted the moment he spent his points.
//
// 4.22: points were earned on the GROSS total — the shop paying loyalty on the
// VAT it collects for the state and on the freight it pays a carrier.
//
// 4.18: expiry, FIFO, and it must be safe to run twice.
//
// Usage:  node scripts/test-loyalty.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-loyalty-'));
const out = join(outDir, 'loyalty.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'loyalty.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const {
  LOYALTY_DEFAULTS, loyaltySettingsFrom, pointsEarnedOn, pointsValueSek,
  maxRedeemablePoints, tierForSpend, pointsExpireAt, planPointsExpiry,
} = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

const D = LOYALTY_DEFAULTS;

console.log('\nloyaltySettingsFrom — nothing configured changes nothing');
check('an empty document gives exactly the rates that were compiled in before',
  loyaltySettingsFrom({}), D);
check('and so do null and undefined',
  [loyaltySettingsFrom(null), loyaltySettingsFrom(undefined)], [D, D]);
// A rate of zero divides by zero; a negative one pays customers to order.
check('a rate of 0 falls back rather than becoming "everything is free"',
  loyaltySettingsFrom({ pointsPerSek: 0, pointsEarnedPerSek: 0 }).pointsPerSek, D.pointsPerSek);
check('a negative rate likewise',
  loyaltySettingsFrom({ pointsEarnedPerSek: -5 }).pointsEarnedPerSek, D.pointsEarnedPerSek);
check('nonsense likewise', loyaltySettingsFrom({ pointsPerSek: 'ten' }).pointsPerSek, D.pointsPerSek);
check('a real rate is taken', loyaltySettingsFrom({ pointsPerSek: 20 }).pointsPerSek, 20);
// The limits MAY be zero — that means "off" — and must not fall back.
check('a minimum of 0 means no minimum, and is honoured',
  loyaltySettingsFrom({ minRedeemPoints: 0 }).minRedeemPoints, 0);
check('expiry of 0 means never, and is honoured',
  loyaltySettingsFrom({ pointsExpiryMonths: 0 }).pointsExpiryMonths, 0);
// Platinum below Gold would be an unreachable tier.
check('Platinum typed below Gold is lifted to it, not refused',
  loyaltySettingsFrom({ tierGoldSpend: 9000, tierPlatinumSpend: 1000 }).tierPlatinumSpend, 9000);

console.log('\n4.22 — points are earned on the NET GOODS, ex VAT and shipping');
check('1 000 kr of goods at 250 per point earns 4', pointsEarnedOn(1000, D), 4);
// The old behaviour: gross of a 1 000 kr order with 99 kr delivery at 25% VAT is
// 1 373.75, which earned 5 — a point paid on tax and freight.
check('and the gross figure would have earned 5 — that is the defect',
  pointsEarnedOn(1373.75, D), 5);
check('part of a point is not a point', pointsEarnedOn(249, D), 0);
check('nothing earns nothing', pointsEarnedOn(0, D), 0);
check('a refund that drives the base negative earns nothing, not minus',
  pointsEarnedOn(-500, D), 0);
check('the rate is the setting, not the constant',
  pointsEarnedOn(1000, { ...D, pointsEarnedPerSek: 100 }), 10);

console.log('\npointsValueSek — rounded down, never in the shop’s disfavour');
check('100 points at 10 per krona is 10 kr', pointsValueSek(100, D), 10);
check('105 points is still 10 kr, not 10.5', pointsValueSek(105, D), 10);
check('9 points is nothing yet', pointsValueSek(9, D), 0);
check('and the rate is settable', pointsValueSek(100, { ...D, pointsPerSek: 20 }), 5);

console.log('\n4.21 — a minimum redemption');
const min200 = { ...D, minRedeemPoints: 200 };
check('with no minimum, any balance may be spent', maxRedeemablePoints(50, 1000, D), 50);
check('below the minimum, NOTHING may be spent — not "some"',
  maxRedeemablePoints(150, 1000, min200), 0);
check('at the minimum, all of it may', maxRedeemablePoints(200, 1000, min200), 200);
check('the order value still caps it: 1 000 points on a 50 kr order',
  maxRedeemablePoints(1000, 50, D), 500);
// And the cap interacts with the minimum: a big balance on a tiny order can fall
// below the minimum once capped, and then nothing may be spent.
check('a balance capped by a small order below the minimum spends nothing',
  maxRedeemablePoints(1000, 10, min200), 0);
check('a negative balance is zero, not a debt', maxRedeemablePoints(-100, 1000, D), 0);

console.log('\n4.25 — the tier follows LIFETIME SPEND, not the balance');
check('nothing spent is Silver', tierForSpend(0, D), 'Silver');
check('5 000 kr is Gold', tierForSpend(5000, D), 'Gold');
check('a krona short of it is not', tierForSpend(4999, D), 'Silver');
check('25 000 kr is Platinum', tierForSpend(25000, D), 'Platinum');
check('the thresholds are settings',
  tierForSpend(1200, { ...D, tierGoldSpend: 1000, tierPlatinumSpend: 2000 }), 'Gold');
// The defect this fixes: on the BALANCE, redeeming demoted the customer. On
// spend, redeeming cannot.
check('spending points cannot demote anybody — spend only goes up',
  tierForSpend(26000, D), 'Platinum');

console.log('\n4.18 — when points expire');
check('with expiry off, they never do', pointsExpireAt('2026-01-01T00:00:00.000Z', D), null);
const exp12 = { ...D, pointsExpiryMonths: 12 };
check('twelve months after January is the following January',
  pointsExpireAt('2026-01-15T00:00:00.000Z', exp12), '2027-01-15T00:00:00.000Z');
check('and an unreadable date expires nothing',
  pointsExpireAt('whenever', exp12), null);

console.log('\nplanPointsExpiry — FIFO, and safe to run twice');
const NOW = Date.parse('2027-06-01T00:00:00.000Z');
// 100 points earned two years ago, 50 last month. Nothing spent.
const twoLots = [
  { date: '2025-06-01T00:00:00.000Z', points: 100, type: 'earned' },
  { date: '2027-05-01T00:00:00.000Z', points: 50, type: 'earned' },
];
check('the old lot expires and the new one does not',
  planPointsExpiry(twoLots, NOW, exp12).expire, 100);
check('and the ledger balance is reported untouched',
  planPointsExpiry(twoLots, NOW, exp12).ledgerBalance, 150);
check('with expiry off, nothing expires', planPointsExpiry(twoLots, NOW, D).expire, 0);
// THE FIFO RULE. 60 points spent since come off the OLDEST lot, so only 40 of it
// is left to expire — not the whole 100.
const spentSome = [...twoLots, { date: '2026-01-01T00:00:00.000Z', points: -60, type: 'redeemed' }];
check('a spend consumes the oldest points first, so less of the old lot expires',
  planPointsExpiry(spentSome, NOW, exp12).expire, 40);
// AND IT MUST BE SAFE TO RUN AGAIN. The sweep writes its own negative entry;
// replaying must find nothing left.
const afterSweep = [...spentSome, { date: '2027-06-01T00:00:00.000Z', points: -40, type: 'expired' }];
check('running the sweep a second time expires nothing more',
  planPointsExpiry(afterSweep, NOW, exp12).expire, 0);
check('the next expiry date is the newest lot’s, for the warning line',
  planPointsExpiry(afterSweep, NOW, exp12).nextExpiryIso, '2028-05-01T00:00:00.000Z');
// A balance that predates the ledger shows up as spends with no matching earn.
// There is nothing to consume and nothing to invent.
check('spends with no recorded earn do not go negative',
  planPointsExpiry([{ date: '2026-01-01T00:00:00.000Z', points: -500, type: 'redeemed' }], NOW, exp12),
  { expire: 0, ledgerBalance: 0, nextExpiryIso: null });
check('an empty ledger is an empty plan',
  planPointsExpiry([], NOW, exp12), { expire: 0, ledgerBalance: 0, nextExpiryIso: null });
// Entries arriving out of order must not change the answer: the sweep sorts.
check('the order the entries arrive in does not matter',
  planPointsExpiry([...spentSome].reverse(), NOW, exp12).expire, 40);
check('an entry with no points at all is ignored, not counted as zero-earn',
  planPointsExpiry([{ date: '2025-01-01T00:00:00.000Z' }], NOW, exp12).expire, 0);

console.log(`\n${failed === 0 ? 'Every loyalty figure is the owner’s to set.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
