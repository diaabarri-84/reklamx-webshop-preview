// The loyalty programme's numbers — all of them, in one place, and all settable.
//
// 4.26: "انا بحدد النقاط واقدر اعدل متى اريد" — he decides the points and can
// change them whenever he likes. Until now "10 points = 1 SEK" was a constant in
// pricing.ts, another literal in the checkout, three more in locale strings, and
// the tier thresholds were written out in three files. Changing the rate meant
// changing code, and any one of those copies could be missed.
//
// 4.25 also asks for the tiers to follow LIFETIME SPEND rather than the current
// balance. They followed the balance, which at a generous rate means a customer
// reaches Gold on one order and is DEMOTED the moment he spends his points —
// punished for using the programme.
//
// Everything here is pure and takes the settings as an argument. That matters
// more than it looks: `calcOrderTotals` runs on the server AND in the browser,
// so a rate read from settings in one place and compiled into the other would
// quote one price and charge another.
//
// Tested in scripts/test-loyalty.mjs.

export interface LoyaltySettings {
  /** One point is earned per this many SEK of qualifying net. */
  pointsEarnedPerSek: number;
  /** This many points redeem for 1 SEK. */
  pointsPerSek: number;
  /** 4.21 — fewer than this cannot be redeemed at all. 0 = no minimum. */
  minRedeemPoints: number;
  /** 4.18 — points expire this many months after they are earned. 0 = never. */
  pointsExpiryMonths: number;
  /** 4.25 — lifetime spend, in SEK, at which a customer becomes Gold. */
  tierGoldSpend: number;
  tierPlatinumSpend: number;
}

/**
 * What the shop does with nothing configured — the rates that were compiled in
 * before this existed, so switching to settings changes nothing on its own.
 *
 * `pointsExpiryMonths: 0` is deliberate. Points have never expired in this shop,
 * and turning that on by default would quietly delete balances customers have
 * already earned. It is his switch to throw.
 */
export const LOYALTY_DEFAULTS: LoyaltySettings = {
  pointsEarnedPerSek: 250,
  pointsPerSek: 10,
  minRedeemPoints: 0,
  pointsExpiryMonths: 0,
  tierGoldSpend: 5000,
  tierPlatinumSpend: 25000,
};

const positive = (value: unknown, fallback: number, max: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= max ? n : fallback;
};

const zeroOrMore = (value: unknown, fallback: number, max: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.floor(n) : fallback;
};

/**
 * Read the settings document into something safe to compute with.
 *
 * A rate of 0 would divide by zero and a negative one would pay customers to
 * order, so the two RATES fall back rather than clamp — a nonsense value must
 * not silently become "everything is free". The limits and thresholds may
 * legitimately be zero, which means "off".
 */
export function loyaltySettingsFrom(raw: Record<string, any> | null | undefined): LoyaltySettings {
  const s = raw ?? {};
  const gold = zeroOrMore(s.tierGoldSpend, LOYALTY_DEFAULTS.tierGoldSpend, 100_000_000);
  const platinum = zeroOrMore(s.tierPlatinumSpend, LOYALTY_DEFAULTS.tierPlatinumSpend, 100_000_000);
  return {
    pointsEarnedPerSek: positive(s.pointsEarnedPerSek, LOYALTY_DEFAULTS.pointsEarnedPerSek, 1_000_000),
    pointsPerSek: positive(s.pointsPerSek, LOYALTY_DEFAULTS.pointsPerSek, 1_000_000),
    minRedeemPoints: zeroOrMore(s.minRedeemPoints, LOYALTY_DEFAULTS.minRedeemPoints, 1_000_000),
    pointsExpiryMonths: zeroOrMore(s.pointsExpiryMonths, LOYALTY_DEFAULTS.pointsExpiryMonths, 600),
    tierGoldSpend: gold,
    // Platinum below Gold is unreachable and would make the higher tier a
    // narrower band than the lower one. Kept above it rather than refused: the
    // owner typing them in the wrong order should not break every badge.
    tierPlatinumSpend: Math.max(platinum, gold),
  };
}

/**
 * Points earned on an order — 4.22.
 *
 * THE BASE IS THE NET GOODS: after any discount, EXCLUDING VAT and shipping.
 * It used to be the gross total, so the shop paid loyalty points on the tax it
 * collects for the state and on the freight it pays a carrier — neither of which
 * is its revenue. On a 1 000 kr order with 99 kr delivery that is points on
 * 1 373 kr instead of on 1 000.
 */
export function pointsEarnedOn(qualifyingNet: number, s: LoyaltySettings): number {
  const net = Number(qualifyingNet);
  if (!Number.isFinite(net) || net <= 0) return 0;
  return Math.floor(net / s.pointsEarnedPerSek);
}

/** What a number of points is worth in kronor. Rounded DOWN — never in the customer's favour by a fraction of an öre. */
export function pointsValueSek(points: number, s: LoyaltySettings): number {
  const p = Math.max(0, Math.floor(Number(points) || 0));
  return Math.floor(p / s.pointsPerSek);
}

/** How many points a customer may spend on an order of this value. */
export function maxRedeemablePoints(balance: number, orderNet: number, s: LoyaltySettings): number {
  const have = Math.max(0, Math.floor(Number(balance) || 0));
  const worth = Math.max(0, Number(orderNet) || 0);
  const capped = Math.min(have, Math.floor(worth * s.pointsPerSek));
  // 4.21 — BELOW THE MINIMUM, NOTHING. Returning the balance here and refusing
  // it later is how a checkout shows a slider that cannot be used.
  return capped >= s.minRedeemPoints ? capped : 0;
}

export type LoyaltyTier = 'Silver' | 'Gold' | 'Platinum';

/**
 * 4.25(b) — the tier follows LIFETIME SPEND, not the current balance.
 *
 * On the balance, a customer reached Gold on one order and was demoted the
 * moment he redeemed — the programme punishing him for using it. Spend only ever
 * goes up.
 */
export function tierForSpend(lifetimeSpend: number, s: LoyaltySettings): LoyaltyTier {
  const spent = Number(lifetimeSpend) || 0;
  if (s.tierPlatinumSpend > 0 && spent >= s.tierPlatinumSpend) return 'Platinum';
  if (s.tierGoldSpend > 0 && spent >= s.tierGoldSpend) return 'Gold';
  return 'Silver';
}

// ---------------------------------------------------------------------------
// 4.18 — EXPIRY.
//
// Points are a liability (4.20 counts it), and a liability with no end never
// leaves the books. Expiry has to be FIFO: the oldest points are spent first,
// or a customer who has redeemed regularly would still see his earliest points
// expire while later ones sit untouched.
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  /** ISO date the entry was written. */
  date?: string;
  /** Positive earns, negative spends and reversals. */
  points?: number;
  type?: string;
}

export interface ExpiryPlan {
  /** Points to take off the balance now. */
  expire: number;
  /** The balance implied by the ledger, before expiry. */
  ledgerBalance: number;
  /** The oldest lot still live, for the "your points expire on…" line. */
  nextExpiryIso: string | null;
}

/** The instant points earned at `earnedAt` run out, or null when expiry is off. */
export function pointsExpireAt(earnedAt: string | null | undefined, s: LoyaltySettings): string | null {
  if (!(s.pointsExpiryMonths > 0)) return null;
  const at = new Date(String(earnedAt ?? ''));
  if (!Number.isFinite(at.getTime())) return null;
  const out = new Date(at.getTime());
  // setUTCMonth handles the overflow: 31 January plus one month is 3 March in a
  // non-leap year, which is what the calendar does and what a customer reading
  // "12 months" expects of the day-of-month.
  out.setUTCMonth(out.getUTCMonth() + s.pointsExpiryMonths);
  return out.toISOString();
}

/**
 * Replay the ledger oldest-first and say how many points have expired.
 *
 * Spends consume the oldest live lot first. Anything left in a lot whose expiry
 * has passed is gone. Entries of type 'expired' are spends like any other, which
 * is what stops a second sweep taking the same points twice.
 */
export function planPointsExpiry(entries: LedgerEntry[], nowMs: number, s: LoyaltySettings): ExpiryPlan {
  const sorted = [...(entries ?? [])]
    .filter((e) => Number.isFinite(Number(e?.points)))
    .sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')));

  let ledgerBalance = 0;
  const lots: { remaining: number; expiresAt: number | null; expiresIso: string | null }[] = [];

  for (const e of sorted) {
    const points = Number(e.points) || 0;
    ledgerBalance += points;
    if (points > 0) {
      const iso = pointsExpireAt(e.date, s);
      lots.push({ remaining: points, expiresAt: iso ? Date.parse(iso) : null, expiresIso: iso });
      continue;
    }
    // A spend. Oldest lot first.
    let owed = -points;
    for (const lot of lots) {
      if (owed <= 0) break;
      const take = Math.min(lot.remaining, owed);
      lot.remaining -= take;
      owed -= take;
    }
    // `owed` left over means the ledger spent points it has no record of
    // earning — an adjustment, or a balance that predates the ledger. Nothing to
    // consume, and nothing to invent.
  }

  let expire = 0;
  let nextExpiryIso: string | null = null;
  for (const lot of lots) {
    if (lot.remaining <= 0) continue;
    if (lot.expiresAt !== null && lot.expiresAt <= nowMs) {
      expire += lot.remaining;
      continue;
    }
    if (lot.expiresIso && (nextExpiryIso === null || lot.expiresIso < nextExpiryIso)) {
      nextExpiryIso = lot.expiresIso;
    }
  }

  return { expire, ledgerBalance: Math.max(0, ledgerBalance), nextExpiryIso };
}
