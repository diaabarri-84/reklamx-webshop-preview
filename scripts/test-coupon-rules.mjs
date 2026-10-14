#!/usr/bin/env node
// The gates on a discount code that are not about money — src/lib/couponRules.ts.
//
// WHY IT EXISTS
// 4.10 start date, 4.11 who it is for, 4.12 first order only, 4.13 no stacking,
// and 4.7's margin guard. Each is a rule the owner sets and the till enforces,
// and every one of them has a failure mode that costs real money if it is off by
// a day, an account type, or a rounding.
//
// Usage:  node scripts/test-coupon-rules.mjs

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-couponrules-'));
const out = join(outDir, 'couponRules.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'couponRules.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
// The till's own totals, for the one case that has to be followed from the
// stored document to the kronor it takes off.
const pricingOut = join(outDir, 'pricing.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'pricing.ts')],
  outfile: pricingOut, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const {
  couponStartsMs, couponNotStartedYet, toAudience, checkCouponGates,
  checkMarginFloor, generateCouponCodes, CODE_ALPHABET, couponLimit,
  COUPON_HOLD_MS, cleanCouponHolds, liveCouponHolders, placeCouponHold, releaseCouponHold, couponHolderKeys,
} = await import(pathToFileURL(out).href);
const { calcOrderTotals } = await import(pathToFileURL(pricingOut).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

const NOW = Date.parse('2026-09-13T09:00:00.000Z');
const base = { nowMs: NOW, signedIn: true, accountType: 'individual', priorPaidOrders: 0, pointsToRedeem: 0 };

console.log('\n4.10 — a start date means the START of that day, here');
// Summer: Stockholm is +02:00, so 1 October begins at 22:00 UTC on 30 September.
check('1 October begins at 22:00 UTC on 30 September',
  couponStartsMs('2026-10-01'), Date.parse('2026-09-30T22:00:00.000Z'));
check('no start date is null — the code is live now', couponStartsMs(''), null);
check('a full timestamp is taken as stored',
  couponStartsMs('2026-10-01T12:00:00.000Z'), Date.parse('2026-10-01T12:00:00.000Z'));
check('an unreadable start date does not hold the code back',
  couponNotStartedYet('soon', NOW), false);
check('the day before, it has not started', couponNotStartedYet('2026-09-14', NOW), true);
check('on the morning of the day itself, it has',
  couponNotStartedYet('2026-09-13', NOW), false);
check('and the gate names the date so the customer knows when to come back',
  checkCouponGates({ startsAt: '2026-10-01' }, base),
  { code: 'notStarted', message: 'This discount code is not active until 2026-10-01.', value: '2026-10-01' });
check('a started code passes', checkCouponGates({ startsAt: '2026-09-01' }, base), null);

console.log('\n4.11 — who the code is for');
check('business/b2b/company all mean business',
  [toAudience('business'), toAudience('b2b'), toAudience('company')], ['business', 'business', 'business']);
check('individual/private/b2c all mean individual',
  [toAudience('individual'), toAudience('private'), toAudience('b2c')], ['individual', 'individual', 'individual']);
// EVERY coupon written before this field existed has no audience, and must keep
// discounting for everybody.
check('anything else — including absent — means everybody',
  [toAudience(undefined), toAudience(null), toAudience('all'), toAudience('nonsense')],
  ['all', 'all', 'all', 'all']);
check('a business code refuses a private customer',
  checkCouponGates({ audience: 'business' }, base)?.code, 'audience');
check('and accepts a company',
  checkCouponGates({ audience: 'business' }, { ...base, accountType: 'business' }), null);
check('a private code refuses a company',
  checkCouponGates({ audience: 'individual' }, { ...base, accountType: 'business' })?.code, 'audience');
check('an account with nothing recorded is a private customer, not a company',
  checkCouponGates({ audience: 'individual' }, { ...base, accountType: null }), null);
check('a targeted code asks a guest to sign in first — the shop cannot tell guests apart',
  checkCouponGates({ audience: 'business' }, { ...base, signedIn: false })?.code, 'signIn');

console.log('\n4.12 — first order only');
check('a customer with no paid orders may use it',
  checkCouponGates({ firstOrderOnly: true }, base), null);
check('a customer with one may not',
  checkCouponGates({ firstOrderOnly: true }, { ...base, priorPaidOrders: 1 })?.code, 'notFirstOrder');
check('a guest is asked to sign in', 
  checkCouponGates({ firstOrderOnly: true }, { ...base, signedIn: false })?.code, 'signIn');
// FAILS OPEN on an unreadable count, the same choice couponAlreadyUsedBy makes.
check('an unreadable order count does not refuse the code',
  checkCouponGates({ firstOrderOnly: true }, { ...base, priorPaidOrders: null }), null);

console.log('\n4.13 — no stacking with loyalty points');
check('redeeming points with a no-stacking code is refused',
  checkCouponGates({ noStacking: true }, { ...base, pointsToRedeem: 50 })?.code, 'noStacking');
check('the same code with no points passes',
  checkCouponGates({ noStacking: true }, { ...base, pointsToRedeem: 0 }), null);
check('and an ordinary code stacks happily',
  checkCouponGates({}, { ...base, pointsToRedeem: 50 }), null);

console.log('\ngate order — the most useful answer first');
// Not-started beats sign-in: signing in would not make a future code work.
check('a future business-only code says "not active yet", not "sign in"',
  checkCouponGates({ startsAt: '2026-12-01', audience: 'business' }, { ...base, signedIn: false })?.code,
  'notStarted');

console.log('\n4.7 — the margin guard');
// 1 000 kr of goods that cost 700. A 20% code takes 200 off, leaving 800 against
// 700 — a 12.5% margin, which is thin but above water.
const lines = [{ revenue: 1000, cost: 700 }];
check('a 20% code on a 30% margin survives a floor of 0',
  checkMarginFloor(lines, 1000, 200, 0).breached, false);
check('and the margin it leaves is reported', 
  checkMarginFloor(lines, 1000, 200, 0).marginPercent, 12.5);
// 40% off the same goods sells at 600 against a 700 cost.
check('40% off sells it below cost, and is refused',
  checkMarginFloor(lines, 1000, 400, 0).breached, true);
check('the margin is reported negative, not clamped',
  checkMarginFloor(lines, 1000, 400, 0).marginPercent < 0, true);
check('a 20% floor refuses the 20% code too',
  checkMarginFloor(lines, 1000, 200, 20).breached, true);
check('a code landing exactly ON the floor is allowed — that is the line he set',
  checkMarginFloor([{ revenue: 1000, cost: 875 }], 1000, 0, 12.5).breached, false);

console.log('\nthe guard only looks at lines whose cost it actually knows');
// A product the owner priced by hand has no cost record. Treating that as zero
// would read as pure profit and wave every code through.
check('a basket with no recorded costs is never refused',
  checkMarginFloor([{ revenue: 1000, cost: null }], 1000, 900, 0).breached, false);
check('and reports no margin rather than a made-up one',
  checkMarginFloor([{ revenue: 1000, cost: null }], 1000, 900, 0).marginPercent, null);
// The discount is apportioned: charging ALL of it against the one priced line
// would refuse codes that are in fact safe.
check('the discount is shared out in proportion to the priced lines',
  checkMarginFloor(
    [{ revenue: 1000, cost: 700 }, { revenue: 1000, cost: null }],
    2000, 400, 0,
  ).revenueAfterDiscount, 800);
check('so a 20% code across a half-priced basket still passes',
  checkMarginFloor(
    [{ revenue: 1000, cost: 700 }, { revenue: 1000, cost: null }],
    2000, 400, 0,
  ).breached, false);
check('a negative or nonsense revenue line is ignored, not counted',
  checkMarginFloor([{ revenue: -5, cost: 1 }, { revenue: 100, cost: 50 }], 100, 0, 0).pricedRevenue, 100);

console.log('\nPAY-01 — a cap or a margin floor read back from the coupon document');
// The coupon screen stores an EMPTY box as null. Number(null) is 0, and the reader
// used to keep any finite number: every code saved without a cap was capped at 0 kr.
check('a stored null is no cap — and a 10% code on 1 000 kr takes 100 kr off, not 0',
  calcOrderTotals({ lineTotals: [1000], discountPercent: 10, maxDiscountAmount: couponLimit(null), vatRate: 0.25 }).discountAmount, 100);
check('absent, empty, 0, negative or garbled: no limit',
  [couponLimit(undefined), couponLimit(''), couponLimit(0), couponLimit('0'), couponLimit(-5), couponLimit('abc'), couponLimit(Infinity)],
  [null, null, null, null, null, null, null]);
check('a real cap is kept, typed or as text', [couponLimit(200), couponLimit('150'), couponLimit(0.5)], [200, 150, 0.5]);
check('…and still caps', calcOrderTotals({ lineTotals: [1000], discountPercent: 90, maxDiscountAmount: couponLimit(200), vatRate: 0.25 }).discountAmount, 200);
// The margin floor the same way: an empty box falls back to the shop's floor
// (`coupon ?? shop`), where it used to become a 0% floor that replaced it.
check('an empty margin box leaves the shop floor in charge', couponLimit(null) ?? 25, 25);
check('a margin floor he set is his', couponLimit(30) ?? 25, 30);

console.log('\nPAY-02 — a limited code\'s use, held from the order to the money');
const T0 = Date.parse('2026-10-11T10:00:00.000Z');
const ago = (ms) => new Date(T0 - ms).toISOString();
// Anna has TWO open orders (a payment she backed out of, then a second press of
// Pay); Bo's ran out; a guest's bank transfer is three days in.
const holds = {
  '202600101': { holder: 'uid:anna', at: ago(120_000) },
  '202600105': { holder: 'uid:anna', at: ago(60_000) },
  '202600102': { holder: 'uid:bo', at: ago(COUPON_HOLD_MS + 1) },
  '202600103': { holder: 'email:c1', at: ago(3 * 24 * 3600_000) },
};
check('the hold lasts 14 days — past Mollie\'s 12 for a bank transfer', COUPON_HOLD_MS, 14 * 24 * 3600_000);
check('holds out of the document, made safe: garbage is no hold',
  Object.keys(cleanCouponHolds({ ...holds, bad: { holder: 7, at: 'x' }, worse: null, noAt: { holder: 'uid:x' } })).sort(),
  ['202600101', '202600102', '202600103', '202600105']);
check('…and a document with none, or nonsense, holds nothing', [cleanCouponHolds(undefined), cleanCouponHolds('x'), cleanCouponHolds([1])], [{}, {}, {}]);
check('customers holding a use: Anna ONCE for her two orders, the guest; not Bo, whose ran out', liveCouponHolders(holds, T0), 2);
check('…and never the asking customer himself', liveCouponHolders(holds, T0, 'uid:anna'), 1);

check('uses paid + customers holding reach the limit: usedUp',
  placeCouponHold({ holds, usedCount: 3, maxUses: 5, holderKeys: 'uid:dan', orderId: '202600106', nowMs: T0 }), { ok: false, code: 'usedUp' });
check('…while there is one left, he holds it, beside the others; the expired hold is dropped on the way',
  Object.keys(placeCouponHold({ holds, usedCount: 2, maxUses: 5, holderKeys: 'uid:dan', orderId: '202600106', nowMs: T0 }).holds).sort(),
  ['202600101', '202600103', '202600105', '202600106']);
// 5 uses, 3 paid: the two left are Anna's and the guest's.
check('A RETRY IS NEVER REFUSED: Anna\'s third press holds — her own two do not count against her',
  placeCouponHold({ holds, usedCount: 3, maxUses: 5, holderKeys: 'uid:anna', orderId: '202600107', nowMs: T0 }).ok, true);
check('…but another customer, on that same last use, is refused',
  placeCouponHold({ holds, usedCount: 3, maxUses: 5, holderKeys: 'uid:eva', orderId: '202600108', nowMs: T0 }).ok, false);
check('a code with no usage limit is never refused a hold (and the server no longer asks: review E)',
  placeCouponHold({ holds, usedCount: 900, maxUses: 0, holderKeys: 'uid:eva', orderId: '202600108', nowMs: T0 }).ok, true);
check('a code already used up by PAID orders is refused with no holds at all',
  placeCouponHold({ holds: undefined, usedCount: 5, maxUses: 5, holderKeys: 'uid:eva', orderId: '202600108', nowMs: T0 }).ok, false);

// Given back when an order can no longer be paid: ITS hold, nobody else's.
const expired = releaseCouponHold(holds, '202600105', T0);
check('Anna\'s second try expires: its hold goes — her first, still payable, keeps hers (no orphaned order)',
  [expired.released, Object.keys(expired.holds).sort()], [true, ['202600101', '202600103']]);
// Paid: the hold becomes the use, and her other open try gives its hold back too.
const paid = releaseCouponHold(holds, '202600101', T0, { paid: true });
check('Anna pays her first order: both her holds go (she is not counted twice), the guest\'s stays',
  [paid.released, Object.keys(paid.holds)], [true, ['202600103']]);
check('a repeated release (a webhook replay) gives back nothing more',
  releaseCouponHold(paid.holds, '202600101', T0, { paid: true }).released, false);
check('an order that held nothing releases nothing', releaseCouponHold(holds, '202609999', T0).released, false);

console.log('\nPAY-02 / review F — one customer is ONE holder, by every key he is known by');
// The server's own hash (server.ts passes the same function): sha256, 24 hex.
const sha24 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 24);
const annaMail = `email:${sha24('anna@example.se')}`;
const annaWork = `email:${sha24('anna@work.se')}`;
check('the keys: the account first, then each e-mail — trimmed, in lower case, hashed, each once',
  couponHolderKeys('anna', [' Anna@Example.se ', 'anna@example.se', 'anna@work.se'], sha24), ['uid:anna', annaMail, annaWork]);
check('a guest with an e-mail is that e-mail', couponHolderKeys(null, ['anna@example.se'], sha24), [annaMail]);
check('a guest\'s quote, before the e-mail is typed, is nobody (his holds count like anyone\'s)',
  couponHolderKeys(null, [undefined, null, '  '], sha24), []);
check('the address never appears in a key, only its hash', couponHolderKeys(null, ['anna@example.se'], sha24)[0].includes('@'), false);
// THE FINDING: Anna's unpaid GUEST order holds the last use. Signed in, her quote
// knows her by her account AND the account's e-mail, so the hold is hers.
const guestHold = { '202600201': { holder: annaMail, at: ago(60_000) } };
const annaSignedIn = couponHolderKeys('anna', ['anna@example.se'], sha24);
check('signed in, her own guest hold does NOT count against her (it was "fully redeemed")',
  liveCouponHolders(guestHold, T0, annaSignedIn), 0);
check('…by uid alone it still would — which is why the quote adds the account e-mail',
  liveCouponHolders(guestHold, T0, 'uid:anna'), 1);
check('…and she may place the order on that last use',
  placeCouponHold({ holds: guestHold, usedCount: 0, maxUses: 1, holderKeys: annaSignedIn, orderId: '202600202', nowMs: T0 }).ok, true);
check('…while Bo, on the same last use, is refused',
  placeCouponHold({ holds: guestHold, usedCount: 0, maxUses: 1, holderKeys: couponHolderKeys('bo', ['bo@example.se'], sha24), orderId: '202600203', nowMs: T0 }),
  { ok: false, code: 'usedUp' });
const placed = placeCouponHold({ holds: guestHold, usedCount: 0, maxUses: 1, holderKeys: couponHolderKeys('anna', ['anna@work.se', 'anna@example.se'], sha24), orderId: '202600202', nowMs: T0 });
check('the new hold keeps every key the server knew — the account as its holder',
  placed.holds['202600202'], { holder: 'uid:anna', keys: ['uid:anna', annaWork, annaMail], at: new Date(T0).toISOString() });
// Linked THROUGH a hold: her signed-in order (account + work address) joins her guest
// try (home address) only through her account's own hold — still one customer.
const linked = {
  ...guestHold,
  '202600202': { holder: 'uid:anna', keys: ['uid:anna', annaWork, annaMail], at: ago(30_000) },
  '202600204': { holder: annaWork, at: ago(20_000) },
  '202600205': { holder: 'uid:bo', at: ago(10_000) },
};
check('her three open orders, by three different keys, are ONE holder; with Bo, two',
  liveCouponHolders(linked, T0), 2);
check('asked by her work address alone, none of her three counts against her',
  liveCouponHolders(linked, T0, annaWork), 1);
check('a guest with an address nobody holds counts both customers',
  liveCouponHolders(linked, T0, couponHolderKeys(null, ['eva@example.se'], sha24)), 2);
const annaPays = releaseCouponHold(linked, '202600204', T0, { paid: true });
check('she pays the guest try: all three of her holds go, by any key; Bo\'s stays',
  [annaPays.released, Object.keys(annaPays.holds)], [true, ['202600205']]);
check('an older hold, holder only, still reads as it did', cleanCouponHolds({ x: { holder: 'uid:anna', at: ago(1) } }).x, { holder: 'uid:anna', at: ago(1) });
check('keys that are not strings are dropped, the holder is always among them, at most four',
  cleanCouponHolds({ x: { holder: 'uid:a', keys: ['email:1', 7, '', null, 'email:1', 'email:2', 'email:3', 'email:4'], at: ago(1) } }).x.keys,
  ['uid:a', 'email:1', 'email:2', 'email:3']);
check('a hold whose only "key" is garbage is still its holder\'s',
  cleanCouponHolds({ x: { holder: 'uid:a', keys: 'email:1', at: ago(1) } }).x, { holder: 'uid:a', at: ago(1) });

console.log('\n4.14 — a batch of unique codes');
let seed = 0;
const fakeRandom = (max) => { seed += 7; return seed % max; };
const batch = generateCouponCodes('SUMMER', 10, 6, fakeRandom);
check('it produces the number asked for', batch.length, 10);
check('every one is unique', new Set(batch).size, 10);
check('each carries the prefix', batch.every((c) => c.startsWith('SUMMER')), true);
check('and the right length', batch.every((c) => c.length === 'SUMMER'.length + 6), true);
check('the alphabet has no O, 0, I or 1 — these get read over a phone',
  /[O0I1]/.test(CODE_ALPHABET), false);
check('codes already taken are never handed out again',
  generateCouponCodes('X', 1, 4, () => 0, ['XAAAA']).includes('XAAAA'), false);
check('the prefix is cleaned of anything untypeable',
  generateCouponCodes('su m-mer!', 1, 4, () => 0)[0].startsWith('SUMMER'), true);
check('asking for none returns none', generateCouponCodes('X', 0, 6, fakeRandom), []);
check('an absurd batch is capped rather than run forever',
  generateCouponCodes('X', 100000, 6, fakeRandom).length <= 500, true);
// A four-character body on a 32-letter alphabet with a generator that always
// returns the same index can only ever make ONE code; it must stop, not hang.
check('a generator that cannot produce enough unique codes returns fewer, not never',
  generateCouponCodes('X', 5, 4, () => 3).length, 1);

console.log(`\n${failed === 0 ? 'Every gate holds.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
