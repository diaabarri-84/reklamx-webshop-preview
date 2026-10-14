// What a coupon's badge should say — computed the way the SERVER decides, not
// the way the document happens to be flagged.
//
// 4.1. The dashboard read `c.active` alone and printed Active or Inactive. A
// code whose expiry date had passed, or one that had already been redeemed its
// maximum number of times, still carried a green "Active" badge — while
// `resolveCoupon` in server.ts refused it at the till. The owner then had a
// screen telling him a code worked and a customer telling him it did not, and
// nothing on the screen to explain the difference.
//
// The order matters and is the plan's: Expired → Used up → Inactive → Active. A
// code that is switched off AND expired is expired; turning it back on would
// not make it work, so "Inactive" would send him to the wrong switch.
//
// "Needs a maximum" sits before Inactive for the same reason (review 2026-10-11,
// G): above 50% with no ceiling in kronor, the till refuses the code whatever the
// switch says (server.ts, fetchCoupon) — and this list called it Active, while
// customers were told it was not valid.
//
// Pure, and tested in scripts/test-coupon-status.mjs.

import { addDays, startOfShopDay } from './reportDays';
import { couponNotStartedYet, couponLimit } from './couponRules';

export type CouponStatusKind = 'expired' | 'usedUp' | 'needsCap' | 'inactive' | 'scheduled' | 'active';

export interface CouponStatusInput {
  active?: boolean;
  expiresAt?: string | null;
  /** 4.10 — a code with a future start date is Scheduled, not Active. */
  startsAt?: string | null;
  maxUses?: number | null;
  usedCount?: number | null;
  /** With the ceiling below: above 50% with none, the till refuses the code. */
  percent?: number | null;
  /** The most it takes off one order, in kronor — read through couponLimit. */
  maxDiscountAmount?: number | null;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instant a coupon stops working, in epoch ms, or null for "never".
 *
 * A bare date means the END of that day in Stockholm — the same reading
 * `couponExpiresAtMs` in server.ts uses, and for the same reason: read as UTC
 * midnight, a code set to expire "6 September" died at 02:00 on the 6th and was
 * dead for the whole of the day it was still supposed to work. The two must
 * agree, or this badge becomes a second, differently-wrong answer.
 */
export function couponExpiryMs(expiresAt: unknown): number | null {
  const raw = String(expiresAt ?? '').trim();
  if (!raw) return null;
  if (!DATE_ONLY.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  // Midnight opening the NEXT day, less one millisecond. startOfShopDay carries
  // the daylight-saving arithmetic and is already tested.
  const nextDay = startOfShopDay(addDays(raw, 1));
  if (!nextDay) return null;
  const ms = Date.parse(nextDay);
  return Number.isFinite(ms) ? ms - 1 : null;
}

/** True once every allowed redemption has been taken. 0 or absent = unlimited. */
export function couponIsUsedUp(maxUses: unknown, usedCount: unknown): boolean {
  const max = Number(maxUses) || 0;
  if (max <= 0) return false;
  return (Number(usedCount) || 0) >= max;
}

/**
 * Above half price with no ceiling in kronor — the till's own test (fetchCoupon in
 * server.ts refuses such a code, PAY-01's rule 4.2), read the same way: an empty
 * box or 0 is no ceiling (couponLimit).
 */
export function couponNeedsCap(percent: unknown, maxDiscountAmount: unknown): boolean {
  return Number(percent) > 50 && couponLimit(maxDiscountAmount) === null;
}

export function couponStatus(c: CouponStatusInput, nowMs: number): CouponStatusKind {
  const expiry = couponExpiryMs(c.expiresAt);
  if (expiry !== null && expiry < nowMs) return 'expired';
  if (couponIsUsedUp(c.maxUses, c.usedCount)) return 'usedUp';
  // Refused at the till until a ceiling is set — switched on or off, and before
  // or after its start date.
  if (couponNeedsCap(c.percent, c.maxDiscountAmount)) return 'needsCap';
  if (c.active !== true) return 'inactive';
  // Switched on, in date, with room left — but not yet. The till refuses it, so
  // the badge must not say Active.
  if (couponNotStartedYet(c.startsAt, nowMs)) return 'scheduled';
  return 'active';
}

/**
 * `2/4`, or `2` when the code is unlimited — 4.5.
 *
 * The owner could not see how much of a limited code was left without opening
 * it, which is exactly the number he needs while a campaign is running.
 */
export function couponUsageLabel(maxUses: unknown, usedCount: unknown): string {
  const used = Number(usedCount) || 0;
  const max = Number(maxUses) || 0;
  return max > 0 ? `${used}/${max}` : String(used);
}

/**
 * Whether the till turns a NEW customer away — the uses paid for and the uses
 * unpaid orders hold (PAY-02) leave none. Not "used up": a hold is given back if
 * its order is not paid, so the badge stays on the paid count, and this colours
 * the number instead (review 2026-10-11, G).
 */
export function couponIsFull(maxUses: unknown, usedCount: unknown, heldUses: unknown): boolean {
  const max = Number(maxUses) || 0;
  if (max <= 0) return false;
  return (Number(usedCount) || 0) + Math.max(0, Number(heldUses) || 0) >= max;
}

/**
 * Whether the badge may be clicked to flip `active`.
 *
 * Only the two states the switch actually controls. Clicking "Expired" used to
 * write `active: false` and change nothing visible — the code stays refused —
 * so the click is removed rather than left to lie a second time.
 */
export function couponStatusIsToggleable(kind: CouponStatusKind, active?: boolean): boolean {
  // 'scheduled' is included: the switch still does something — it takes a code
  // out of a campaign that has not begun. 'expired' and 'usedUp' are not, and
  // writing active:false on those would change nothing a customer could see.
  //
  // 'needsCap' only while it is ON, and only to switch it OFF: the save refuses to
  // switch such a code on until it has a ceiling, so offering that click would
  // only answer with an error.
  if (kind === 'needsCap') return active === true;
  return kind === 'active' || kind === 'inactive' || kind === 'scheduled';
}
