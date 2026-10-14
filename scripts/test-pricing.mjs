#!/usr/bin/env node
// The money test for src/lib/pricing.ts.
//
// WHY IT EXISTS
// pricing.ts is the single formula behind every price in the shop: the product
// page computes with it, the checkout previews with it, and the server charges
// with it. Until 2026-09-08 it had NO test of any kind — test-option-tree.mjs
// bundles only optionTree.ts and never imports a pricing function. So the one
// file where a mistake means charging a customer the wrong amount was the one
// file nothing in `npm run verify` could catch.
//
// That mattered the moment special-offer prices arrived. tsconfig has no
// strictNullChecks and there is no ESLint, so `salePrice` used without a guard
// typechecks clean and surfaces as NaN in someone's basket. These cases are the
// guard.
//
// Usage:  node scripts/test-pricing.mjs
// Exit:   0 = every case charges the right amount, 1 = something does not

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-pricing-'));
const outFile = join(outDir, 'pricing.mjs');

await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'pricing.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});

const pricing = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

const { calcConfiguredItemPrice, calcOrderTotals, volumeDiscountPercent, PRICING_DEFAULTS } = pricing;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
  }
};

// No volume tiers and no setup fee unless a case asks for them, so the
// arithmetic under test is the arithmetic being asserted.
const PLAIN = { pricingRules: { baseSetupFee: 0, volumeDiscounts: [] } };
// minPrice 0 switches off the floor; several cases below are ABOUT the floor and
// set their own.
const NO_FLOOR = { uploadRules: { minPrice: 0 } };

console.log('\n== calcConfiguredItemPrice: the offer price ==\n');

const listOnly = calcConfiguredItemPrice({ basePrice: 1000, quantity: 1, ...PLAIN, ...NO_FLOOR });
check('no offer: unit price is the base price', listOnly.unitPrice, 1000);
check('no offer: isOnSale is false', listOnly.isOnSale, false);
check('no offer: the list figures equal the charged ones', [listOnly.listUnitPrice, listOnly.listTotalPrice], [1000, 1000]);

const onSale = calcConfiguredItemPrice({ basePrice: 1000, salePrice: 700, quantity: 2, ...PLAIN, ...NO_FLOOR });
check('offer: the offer price is charged', onSale.unitPrice, 700);
check('offer: isOnSale', onSale.isOnSale, true);
check('offer: the list price is kept for the struck-through figure', onSale.listUnitPrice, 1000);
check('offer: line total uses the offer', onSale.totalPrice, 1400);
check('offer: list line total is what it would have cost', onSale.listTotalPrice, 2000);

// Every one of these is a value a Firestore document can hold, because no
// security rule validates a product write. None may give the shop away.
const hostile = [
  ['null', null, 1000],
  ['undefined', undefined, 1000],
  ['zero', 0, 1000],
  ['negative', -500, 1000],
  ['a string that is not a number', 'free', 1000],
  ['NaN', NaN, 1000],
  ['Infinity', Infinity, 1000],
  ['higher than the list price', 1500, 1000],
  ['equal to the list price', 1000, 1000],
];
for (const [label, salePrice, expected] of hostile) {
  const r = calcConfiguredItemPrice({ basePrice: 1000, salePrice, quantity: 1, ...PLAIN, ...NO_FLOOR });
  check(`a salePrice of ${label} is ignored`, [r.unitPrice, r.isOnSale], [expected, false]);
}

// A numeric string is what an <input type="number"> hands back if it is ever
// stored unconverted; it is a real offer, not hostile data.
const stringy = calcConfiguredItemPrice({ basePrice: 1000, salePrice: '700', quantity: 1, ...PLAIN, ...NO_FLOOR });
check('a numeric string offer is honoured', [stringy.unitPrice, stringy.isOnSale], [700, true]);

console.log('\n== the offer against the shop\'s other rules ==\n');

// The floor still holds. An owner who types 50 on a product with a 149 floor
// does not sell at 50 — and must not be told there is an offer either.
const floored = calcConfiguredItemPrice({
  basePrice: 1000, salePrice: 50, quantity: 1,
  uploadRules: { minPrice: 149 }, pricingRules: { baseSetupFee: 0, volumeDiscounts: [] },
});
check('an offer below the minimum-price floor is lifted to the floor', floored.unitPrice, 149);
check('and it is still an offer, because 149 < 1000', floored.isOnSale, true);

// The floor can erase the offer entirely. Then the shop must not claim one.
const erased = calcConfiguredItemPrice({
  basePrice: 200, salePrice: 100, quantity: 1,
  uploadRules: { minPrice: 900 }, pricingRules: { baseSetupFee: 0, volumeDiscounts: [] },
});
check('an offer the floor lifts back to the list price is not shown as an offer', [erased.unitPrice, erased.listUnitPrice, erased.isOnSale], [900, 900, false]);

// The volume tier stacks ON TOP of the offer, and the "was" price carries the
// same tier — otherwise the struck-through figure is not a price this shop
// would ever have charged.
const tiered = calcConfiguredItemPrice({
  basePrice: 1000, salePrice: 800, quantity: 100,
  uploadRules: { minPrice: 0 },
  pricingRules: { baseSetupFee: 0, volumeDiscounts: [{ minQuantity: 50, discountPercentage: 10 }] },
});
check('volume tier applies on top of the offer', tiered.unitPrice, 720);
check('the tier is applied to the list price too', tiered.listUnitPrice, 900);
check('volume percent is reported unchanged', tiered.discountPercent, 10);

// Options and area are charged on top of the offer base, not replaced by it.
const withOptions = calcConfiguredItemPrice({
  basePrice: 1000, salePrice: 600, optionsSurcharge: 250, quantity: 1,
  uploadRules: { minPrice: 0 }, pricingRules: { baseSetupFee: 0, volumeDiscounts: [] },
});
check('option surcharges are added to the offer base', withOptions.unitPrice, 850);
check('and to the list base for the "was" figure', withOptions.listUnitPrice, 1250);

// The setup fee is per LINE, so it appears once in both totals and the saving
// is exactly the difference in unit price × quantity.
const withSetup = calcConfiguredItemPrice({
  basePrice: 1000, salePrice: 900, quantity: 3,
  uploadRules: { minPrice: 0 }, pricingRules: { baseSetupFee: 49, volumeDiscounts: [] },
});
check('setup fee is charged once on the offer total', withSetup.totalPrice, 2749);
check('and once on the list total', withSetup.listTotalPrice, 3049);

console.log('\n== the minimum unit price (ADM-14: a field of its own in the product editor) ==\n');

// The editor now shows the minimum the save used to write unseen (stored ?? 149).
// What each value it can save means at the till:
const atFloor = (minPrice, extra = {}) => calcConfiguredItemPrice({ basePrice: 64, quantity: 1, ...PLAIN, uploadRules: minPrice === undefined ? undefined : { minPrice }, ...extra });
check('a 64 kr product under the 149 minimum is charged 149 a piece', [atFloor(149).unitPrice, atFloor(149).rawUnitPrice, atFloor(149).basePrice], [149, 149, 64]);
check('no minimum stored: the shop\'s 149 (what the editor shows and saves for it, so a save changes no price)', atFloor(undefined).unitPrice, 149);
check('0 switches the minimum off: its own 64', atFloor(0).unitPrice, 64);
check('his own minimum, 99', atFloor(99).unitPrice, 99);
check('a minimum stored as text ("149") still holds', atFloor('149').unitPrice, 149);
check('the minimum is per piece BEFORE the quantity discount: 149 less 10 % at 100 pieces',
  atFloor(149, { quantity: 100, pricingRules: { baseSetupFee: 0, volumeDiscounts: [{ minQuantity: 50, discountPercentage: 10 }] } }).unitPrice, 134);
check('options that bring a piece over the minimum are charged as they add up',
  atFloor(149, { optionsSurcharge: 100 }).unitPrice, 164);

console.log('\n== calcOrderTotals: coupon scoping ==\n');

const base = { shippingMethod: 'pickup', shippingFees: { pickup: 0 }, vatRate: 0.25 };

const noFlags = calcOrderTotals({ lineTotals: [1000, 500], discountPercent: 10, ...base });
check('no eligibility flags: the whole basket is discounted, as before', noFlags.discountAmount, 150);
check('no eligibility flags: eligibleSubtotal is the whole subtotal', noFlags.eligibleSubtotal, 1500);

const scoped = calcOrderTotals({
  lineTotals: [1000, 500], couponEligible: [true, false], discountPercent: 10, ...base,
});
check('scoped coupon discounts only the eligible line', scoped.discountAmount, 100);
check('scoped coupon reports the eligible subtotal', scoped.eligibleSubtotal, 1000);
check('the ineligible line still counts towards what is owed', scoped.rawSubtotal, 1500);
check('subtotal after discount', scoped.discountedSubtotal, 1400);

const noneEligible = calcOrderTotals({
  lineTotals: [1000, 500], couponEligible: [false, false], discountPercent: 25, ...base,
});
check('a coupon that matches nothing discounts nothing', noneEligible.discountAmount, 0);
check('and the customer still owes the full subtotal', noneEligible.discountedSubtotal, 1500);

// A flags array out of step with the lines is a bug; the safe reading is the one
// that does not quietly overcharge.
const shortFlags = calcOrderTotals({
  lineTotals: [1000, 500], couponEligible: [true], discountPercent: 10, ...base,
});
check('a flags array shorter than the basket does not silently exclude the tail', shortFlags.eligibleSubtotal, 1500);

// VAT is charged on what is actually owed, after a scoped discount.
const vat = calcOrderTotals({
  lineTotals: [1000, 1000], couponEligible: [true, false], discountPercent: 50, ...base,
});
check('scoped discount flows through to net', vat.netTotal, 1500);
check('and VAT is charged on the reduced net', vat.vatAmount, 375);
check('gross', vat.grossTotal, 1875);

// The 0% rate must survive: `||` once replaced a genuine export rate with 25%.
const zeroVat = calcOrderTotals({ lineTotals: [1000], vatRate: 0, shippingMethod: 'pickup', shippingFees: { pickup: 0 } });
check('a genuine 0% VAT rate is not replaced by the default', zeroVat.vatAmount, 0);

// Points come off AFTER the discount, and shipping is added after that.
const points = calcOrderTotals({
  lineTotals: [1000], couponEligible: [true], discountPercent: 10,
  pointsToRedeem: 1000, pointsBalance: 5000,
  shippingMethod: 'standard', shippingFees: { standard: 99 }, vatRate: 0.25,
});
check('points redeem after the coupon', points.pointsDiscountAmount, 100);
check('shipping is added after points', points.netTotal, 899);

console.log('\n== regression: what these functions did before offers existed ==\n');

// The defaults must not have moved. Every price already in the database was
// computed with them.
check('minimum price default', PRICING_DEFAULTS.minPrice, 149);
check('VAT default', PRICING_DEFAULTS.vatRate, 0.25);
check('setup fee default', PRICING_DEFAULTS.baseSetupFee, 49);
check('volume tier lookup picks the highest qualifying tier', volumeDiscountPercent(100, [
  { minQuantity: 10, discountPercentage: 5 },
  { minQuantity: 50, discountPercentage: 15 },
]), 15);
check('volume tier lookup returns 0 below every tier', volumeDiscountPercent(5, [{ minQuantity: 10, discountPercentage: 5 }]), 0);

// A product with no offer field at all — every product in the shop today — must
// price exactly as it did before this change.
const legacy = calcConfiguredItemPrice({
  basePrice: 1500, optionsSurcharge: 120, quantity: 10,
  uploadRules: { minPrice: 149 },
  pricingRules: { baseSetupFee: 49, volumeDiscounts: [{ minQuantity: 5, discountPercentage: 10 }] },
});
check('a product with no offer prices exactly as before', [legacy.unitPrice, legacy.totalPrice], [1458, 14629]);
check('and reports itself as not on offer', legacy.isOnSale, false);

// ── THE COUPON CEILING ───────────────────────────────────────────────────────
//
// TEST100 — a live, working, 100% code — sat in this shop's own coupon list. A
// percentage alone scales with the basket, so a deep code is worth 90 kr on a
// 100 kr order and 9 000 kr on a 10 000 kr one. The cap is what turns a mistake
// of that kind into a small one, and it has to be honoured by the PRICING and
// not only asked for by the form.
console.log('\n== the coupon ceiling ==\n');
const capped = (cap) => calcOrderTotals({
  lineTotals: [1000], discountPercent: 90, maxDiscountAmount: cap, vatRate: 0.25,
});
check('with no cap, 90% takes 900', capped(undefined).discountAmount, 900);
check('a 200 kr ceiling takes 200', capped(200).discountAmount, 200);
check('and the uncapped figure is kept, so the screen can explain it', capped(200).uncappedDiscountAmount, 900);
check('a ceiling above the discount changes nothing', capped(2000).discountAmount, 900);
// `||` would read this as "no cap" and give the order away.
check('a ceiling of ZERO means no discount, not "no ceiling"', capped(0).discountAmount, 0);
check('null is no ceiling', capped(null).discountAmount, 900);
check('and the total reflects the cap', capped(200).grossTotal, calcOrderTotals({ lineTotals: [800], vatRate: 0.25 }).grossTotal);

// ── 4.9 — SHIPPING IN OR OUT OF THE DISCOUNT ─────────────────────────────────
//
// "20% off everything, free delivery included" is a campaign the owner asked to
// be able to run. Until now the percentage could only ever reach the goods, and
// charging 99 kr delivery on top of "everything" reads as a broken promise.
// The default — absent, false — must behave EXACTLY as the shop always has.
console.log('\n== 4.9: shipping in or out of the discount ==\n');
const ship = { shippingMethod: 'standard', shippingFees: { standard: 100 }, vatRate: 0.25 };

const goodsOnly = calcOrderTotals({ lineTotals: [1000], discountPercent: 20, ...ship });
check('by default the code discounts the goods only', goodsOnly.discountAmount, 200);
check('and the delivery fee is charged in full', goodsOnly.shippingCost, 100);
check('nothing came off shipping', goodsOnly.shippingDiscountAmount, 0);
check('net is 800 goods + 100 delivery', goodsOnly.netTotal, 900);

const withShipping = calcOrderTotals({
  lineTotals: [1000], discountPercent: 20, discountIncludesShipping: true, ...ship,
});
check('with shipping included, 20% is taken on 1100', withShipping.discountAmount, 220);
check('20 kr of it came off the delivery fee', withShipping.shippingDiscountAmount, 20);
check('the fee is still REPORTED in full, so the screen adds up', withShipping.shippingCost, 100);
// subtotal 1000 − discount 220 + shipping 100 = 880, which is what the customer
// can check on the screen with their own arithmetic.
check('and the net total is 880', withShipping.netTotal, 880);
check('VAT is charged on the discounted net, not the list price', withShipping.vatAmount, 220);

// A code scoped to products none of which are in the basket discounts NOTHING —
// including the delivery. Otherwise "20% off mugs" would knock 20% off the
// postage on an order containing no mugs.
const noMatch = calcOrderTotals({
  lineTotals: [1000], couponEligible: [false], discountPercent: 20,
  discountIncludesShipping: true, ...ship,
});
check('a code that reaches nothing does not discount the delivery either', noMatch.discountAmount, 0);
check('and the fee is untouched', noMatch.netTotal, 1100);

// The ceiling still binds, and it binds on the combined figure.
const cappedShip = calcOrderTotals({
  lineTotals: [1000], discountPercent: 20, discountIncludesShipping: true,
  maxDiscountAmount: 150, ...ship,
});
check('the kronor ceiling still applies to the combined discount', cappedShip.discountAmount, 150);
// Proportionally: 150 × (100 ÷ 1100). The goods take the rest.
check('and the capped discount is still split in proportion', cappedShip.shippingDiscountAmount, 13.64);
check('the money still adds up: 1000 + 100 − 150', cappedShip.netTotal, 950);

// A 100% "everything free" code must not go negative or hand money back.
const everything = calcOrderTotals({
  lineTotals: [1000], discountPercent: 100, discountIncludesShipping: true, ...ship,
});
check('100% off everything leaves nothing to pay', everything.netTotal, 0);
check('and the whole delivery fee is accounted for', everything.shippingDiscountAmount, 100);
check('gross is zero too — no VAT on nothing', everything.grossTotal, 0);

// THE CASE THE SPLIT DECIDES. Points pay for goods, never for delivery. With
// the whole discount taken off the goods first, a customer paying the goods off
// in points would still be charged the FULL 100 kr delivery on a "20% off
// everything" code — the promise and the till disagreeing by the shipping share.
const paidInPoints = calcOrderTotals({
  lineTotals: [1000], discountPercent: 20, discountIncludesShipping: true,
  pointsToRedeem: 100000, pointsBalance: 100000, ...ship,
});
check('points cover the discounted goods', paidInPoints.pointsDiscountAmount, 800);
check('and what is left is the DISCOUNTED delivery fee, not the full one', paidInPoints.netTotal, 80);

// An empty basket has nothing to deliver, so there is no fee to discount.
const empty = calcOrderTotals({ lineTotals: [], discountPercent: 20, discountIncludesShipping: true, ...ship });
check('an empty basket still charges nothing for shipping air', empty.shippingCost, 0);
check('and takes no discount', empty.discountAmount, 0);

console.log(failed === 0 ? '\n  All pricing cases pass\n' : `\n  ${failed} case(s) FAILED\n`);
process.exit(failed ? 1 : 0);
