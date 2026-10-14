#!/usr/bin/env node
// What a coupon's badge says — src/lib/couponStatus.ts.
//
// WHY IT EXISTS
// The coupons table printed Active or Inactive from `c.active` alone. A code
// that had expired, or one that had already been redeemed its maximum number of
// times, still showed a green "Active" — while the server refused it at the
// till. The owner had a screen telling him a code worked and a customer telling
// him it did not.
//
// The cases below pin the ORDER (expired beats used up beats inactive) and the
// end-of-day expiry reading, which must agree with `couponExpiresAtMs` in
// server.ts or the shop gets two differently-wrong answers instead of one.
//
// Usage:  node scripts/test-coupon-status.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-coupon-'));
const out = join(outDir, 'couponStatus.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'couponStatus.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const {
  couponExpiryMs, couponIsUsedUp, couponStatus, couponUsageLabel, couponStatusIsToggleable,
  couponNeedsCap, couponIsFull,
} = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

// A summer instant: Stockholm is +02:00, so its day ends at 21:59:59.999 UTC.
const SUMMER_END = Date.parse('2026-09-06T21:59:59.999Z');
// A winter one: +01:00, so the day ends at 22:59:59.999 UTC.
const WINTER_END = Date.parse('2026-01-11T22:59:59.999Z');

console.log('\ncouponExpiryMs — a bare date means the END of that day, here');
check('summer: 6 September runs until 23:59:59.999 Swedish time',
  couponExpiryMs('2026-09-06'), SUMMER_END);
check('winter: and the offset is an hour smaller',
  couponExpiryMs('2026-01-11'), WINTER_END);
// THE BUG THIS GUARDS. new Date('2026-09-06') is UTC midnight = 02:00 local, so
// a code set to expire that day died at two in the morning of the day it was
// still meant to work.
check('a code is STILL ALIVE at 08:00 on the morning of its expiry date',
  couponStatus({ active: true, expiresAt: '2026-09-06' }, Date.parse('2026-09-06T06:00:00.000Z')), 'active');
check('and dead one millisecond after that day ends',
  couponStatus({ active: true, expiresAt: '2026-09-06' }, SUMMER_END + 1), 'expired');
check('a full timestamp is taken exactly as stored',
  couponExpiryMs('2026-09-06T10:00:00.000Z'), Date.parse('2026-09-06T10:00:00.000Z'));
check('no expiry is null, not zero — zero would expire every coupon in the shop',
  couponExpiryMs(''), null);
check('and so are null, undefined and nonsense',
  [couponExpiryMs(null), couponExpiryMs(undefined), couponExpiryMs('soon')], [null, null, null]);

console.log('\ncouponIsUsedUp — 0 and absent mean unlimited, not exhausted');
check('unlimited is never used up, however many times it is redeemed',
  couponIsUsedUp(0, 9999), false);
check('absent likewise', couponIsUsedUp(undefined, 9999), false);
check('4 of 4 is used up', couponIsUsedUp(4, 4), true);
check('5 of 4 is too — a race that overshot must not read as available',
  couponIsUsedUp(4, 5), true);
check('3 of 4 is not', couponIsUsedUp(4, 3), false);
check('and a missing usedCount counts as none used', couponIsUsedUp(4, undefined), false);

console.log('\ncouponStatus — the order: Expired → Used up → Inactive → Active');
const past = { expiresAt: '2020-01-01' };
const now = Date.parse('2026-09-13T09:00:00.000Z');
check('an expired code that is also used up and switched off reads EXPIRED',
  couponStatus({ ...past, active: false, maxUses: 2, usedCount: 2 }, now), 'expired');
// Turning it back on would not make it work, so "Inactive" would send the owner
// to the wrong switch.
check('an expired code that is still switched ON also reads EXPIRED',
  couponStatus({ ...past, active: true }, now), 'expired');
check('a used-up code that is switched off reads USED UP',
  couponStatus({ active: false, maxUses: 2, usedCount: 2 }, now), 'usedUp');
check('a live code that is switched off reads INACTIVE',
  couponStatus({ active: false, maxUses: 4, usedCount: 1 }, now), 'inactive');
check('and one with room left, in date, switched on, is ACTIVE',
  couponStatus({ active: true, maxUses: 4, usedCount: 1, expiresAt: '2026-12-31' }, now), 'active');
check('a coupon with no expiry and no cap is active',
  couponStatus({ active: true }, now), 'active');
check('`active` missing is NOT active — a half-written document must not discount',
  couponStatus({}, now), 'inactive');
check('`active: "true"` as a string is not the boolean either',
  couponStatus({ active: 'true' }, now), 'inactive');
// The server refuses an unparseable expiry by ignoring it (couponExpiresAtMs
// returns null); this must do the same rather than call it expired.
check('an unreadable expiry does not expire the code',
  couponStatus({ active: true, expiresAt: 'whenever' }, now), 'active');

console.log('\n4.10 — a code that has not started yet is Scheduled, not Active');
check('switched on, in date, room left — but starting next month',
  couponStatus({ active: true, startsAt: '2026-10-01' }, now), 'scheduled');
check('on the day it starts, it is Active',
  couponStatus({ active: true, startsAt: '2026-09-13' }, now), 'active');
// Being switched off is the more actionable truth: turning it back on is
// something he can do today, and the schedule then takes over.
check('switched OFF and scheduled reads Inactive',
  couponStatus({ active: false, startsAt: '2026-10-01' }, now), 'inactive');
check('and an expired code that is also scheduled is still Expired',
  couponStatus({ active: true, startsAt: '2026-10-01', expiresAt: '2020-01-01' }, now), 'expired');
check('a scheduled code can still be switched off',
  couponStatusIsToggleable('scheduled'), true);

console.log('\ncouponUsageLabel — 4.5, the number he needs mid-campaign');
check('limited shows both halves', couponUsageLabel(4, 2), '2/4');
check('unlimited shows just the count', couponUsageLabel(0, 7), '7');
check('absent cap likewise', couponUsageLabel(undefined, 7), '7');
check('a fresh limited code reads 0/4', couponUsageLabel(4, undefined), '0/4');
check('and a fresh unlimited one reads 0', couponUsageLabel(null, null), '0');

console.log('\ncouponStatusIsToggleable — the click only where the switch does something');
check('active can be switched off', couponStatusIsToggleable('active'), true);
check('inactive can be switched on', couponStatusIsToggleable('inactive'), true);
check('expired cannot — writing active:false changes nothing visible',
  couponStatusIsToggleable('expired'), false);
check('used up cannot either', couponStatusIsToggleable('usedUp'), false);

console.log('\nreview G — above 50% with no ceiling, the till refuses it: the badge must say so');
// fetchCoupon in server.ts: percent > 50 && couponLimit(maxDiscountAmount) === null.
check('90% with no maximum NEEDS ONE — it was shown Active while the till refused it',
  couponStatus({ active: true, percent: 90, maxDiscountAmount: null }, now), 'needsCap');
check('an empty box stored as 0 is no maximum either (couponLimit)',
  couponStatus({ active: true, percent: 90, maxDiscountAmount: 0 }, now), 'needsCap');
check('with a maximum it is Active', couponStatus({ active: true, percent: 90, maxDiscountAmount: 200 }, now), 'active');
check('exactly 50% needs none', couponStatus({ active: true, percent: 50, maxDiscountAmount: null }, now), 'active');
check('switched off, it still needs a maximum first — switching it on would not make it work',
  couponStatus({ active: false, percent: 90 }, now), 'needsCap');
check('scheduled, likewise: it will be refused on the day it starts',
  couponStatus({ active: true, percent: 75, startsAt: '2026-10-01' }, now), 'needsCap');
check('expired and used up still come first',
  [couponStatus({ ...past, active: true, percent: 90 }, now), couponStatus({ active: true, percent: 90, maxUses: 2, usedCount: 2 }, now)],
  ['expired', 'usedUp']);
check('a code with no percent recorded is not flagged', couponStatus({ active: true }, now), 'active');
check('the test on its own, as the till reads it', [couponNeedsCap(90, null), couponNeedsCap('90', '150'), couponNeedsCap(51, -5), couponNeedsCap(10, null)],
  [true, false, true, false]);
check('ON, its badge switches it off (the save allows that without a ceiling)', couponStatusIsToggleable('needsCap', true), true);
check('OFF, no click — the save would refuse to switch it on', couponStatusIsToggleable('needsCap', false), false);
check('…and the other badges do not depend on the switch', [couponStatusIsToggleable('active', true), couponStatusIsToggleable('inactive', false)], [true, true]);

console.log('\nreview G — the uses unpaid orders hold, beside the ones paid for');
check('18 paid + 2 held of 20: the till turns a new customer away', couponIsFull(20, 18, 2), true);
check('18 + 1 of 20: one left', couponIsFull(20, 18, 1), false);
check('an unlimited code is never full, however many hold it', couponIsFull(0, 900, 50), false);
check('nothing held reads as before', [couponIsFull(4, 4, undefined), couponIsFull(4, 3, null)], [true, false]);
check('…and the badge stays on the paid count: held uses can come back', couponStatus({ active: true, maxUses: 20, usedCount: 18 }, now), 'active');

console.log(`\n${failed === 0 ? 'The badge says what the server would do.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
