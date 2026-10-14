// The gates a discount code has to pass that are NOT about the basket's money.
//
// 4.10 to 4.13, plus the 4.7 margin guard. Each one is a rule the owner sets on
// the coupon and the till has to enforce; putting them here rather than inline
// in `priceCart` means the checkout, the coupon screen and the tests all read
// the same sentence.
//
// Everything in this file is pure and takes `nowMs` rather than reading the
// clock, because a rule that cannot be tested at a chosen instant is a rule
// nobody can prove.
//
// Tested in scripts/test-coupon-rules.mjs.

import { addDays, startOfShopDay } from './reportDays';

export type CouponAudience = 'all' | 'business' | 'individual';

export interface CouponGateRules {
  /** 4.10 — the code does nothing before this date. Absent = live now. */
  startsAt?: string | null;
  /** 4.11 — who may use it. Absent = everybody, which is what older codes mean. */
  audience?: CouponAudience | string | null;
  /** 4.12 — only on a customer's FIRST paid order. */
  firstOrderOnly?: boolean;
  /** 4.13 — may not be combined with loyalty points. */
  noStacking?: boolean;
}

export interface CouponGateContext {
  nowMs: number;
  signedIn: boolean;
  /** 'business' or 'individual', as the user document stores it. */
  accountType?: string | null;
  /**
   * Paid orders this customer has placed before this one.
   *
   * `null` means the count could not be read. The gate then FAILS OPEN — the
   * same choice `couponAlreadyUsedBy` makes — because refusing every first-order
   * code because one lookup timed out is worse than the occasional extra
   * redemption, and the owner can see it in the audit log either way.
   */
  priorPaidOrders?: number | null;
  pointsToRedeem?: number;
}

export type CouponGateCode =
  | 'notStarted'
  | 'signIn'
  | 'audience'
  | 'notFirstOrder'
  | 'noStacking';

export interface CouponGateFailure {
  code: CouponGateCode;
  message: string;
  /** Filled where the message carries a number or date, for the `{0}` slot. */
  value?: string | number;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instant a code STARTS working, in epoch ms, or null for "already".
 *
 * A bare date means the beginning of that day in Stockholm — the mirror of the
 * expiry reading, which means the end of its day. Read as UTC midnight instead,
 * a code scheduled for "1 October" would have started discounting at 22:00 on
 * 30 September, and a campaign that begins the evening before is a campaign
 * nobody announced.
 */
export function couponStartsMs(startsAt: unknown): number | null {
  const raw = String(startsAt ?? '').trim();
  if (!raw) return null;
  if (!DATE_ONLY.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const iso = startOfShopDay(raw);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Whether a start date is still in the future — used by the badge as well. */
export function couponNotStartedYet(startsAt: unknown, nowMs: number): boolean {
  const start = couponStartsMs(startsAt);
  return start !== null && start > nowMs;
}

/** Normalise whatever is stored into one of the three audiences. */
export function toAudience(value: unknown): CouponAudience {
  const v = String(value ?? '').toLowerCase();
  if (v === 'business' || v === 'b2b' || v === 'company') return 'business';
  if (v === 'individual' || v === 'private' || v === 'b2c') return 'individual';
  return 'all';
}

/**
 * A limit read back from a coupon document — the most it may take off in kronor,
 * or its own margin floor — or null for "none".
 *
 * AN EMPTY BOX IS STORED AS null, and `Number(null)` is 0. Read with
 * `Number.isFinite`, every code saved without a cap came back capped at 0 kr: the
 * till accepted it and took nothing off, and nothing said so. An empty margin box
 * became a 0% floor that overruled the shop's own. Nothing above zero is no limit
 * — a code that is meant to discount nothing is switched off, not capped at 0.
 * The server and the coupon screen both read through this, so the screen's
 * toggle and edit form stop writing the 0 back.
 */
export function couponLimit(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The first gate the code fails, or null when it passes all of them.
 *
 * ORDER MATTERS, and it is the order that tells the customer the most useful
 * thing: a code that has not started yet is not a code he can fix by signing in.
 */
export function checkCouponGates(
  rules: CouponGateRules,
  ctx: CouponGateContext,
): CouponGateFailure | null {
  if (couponNotStartedYet(rules.startsAt, ctx.nowMs)) {
    const day = String(rules.startsAt ?? '').slice(0, 10);
    return { code: 'notStarted', message: `This discount code is not active until ${day}.`, value: day };
  }

  const audience = toAudience(rules.audience);
  const needsAccount = audience !== 'all' || rules.firstOrderOnly === true;
  if (needsAccount && !ctx.signedIn) {
    // The shop cannot tell one guest from the next, so a code restricted to a
    // kind of customer — or to a customer's first order — is meaningless
    // without an account. Same wording as the once-per-customer gate.
    return { code: 'signIn', message: 'Please sign in to use this discount code.' };
  }

  if (audience !== 'all') {
    // 'business' unless the document says otherwise: the sign-up form writes
    // 'individual' explicitly, and an account with nothing recorded is a
    // private customer, not a company.
    const isBusiness = String(ctx.accountType ?? '').toLowerCase() === 'business';
    const matches = audience === 'business' ? isBusiness : !isBusiness;
    if (!matches) {
      return {
        code: 'audience',
        message: audience === 'business'
          ? 'This discount code is for business accounts.'
          : 'This discount code is for private customers.',
      };
    }
  }

  if (rules.firstOrderOnly === true) {
    const prior = ctx.priorPaidOrders;
    // null = unreadable, and the gate fails open. See the field's own note.
    if (typeof prior === 'number' && prior > 0) {
      return { code: 'notFirstOrder', message: 'This discount code is only valid on a first order.' };
    }
  }

  if (rules.noStacking === true && (Number(ctx.pointsToRedeem) || 0) > 0) {
    return { code: 'noStacking', message: 'This discount code cannot be combined with loyalty points.' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// 4.7 — the margin guard.
//
// This shop has already sold a 3 020 kr banner for 1 490. A percentage code is
// the easiest way to do it again: 40% off a product carrying a 30% margin sells
// it below what it cost to buy, and nothing on the screen says so.
//
// The guard works on the lines whose cost is actually KNOWN — supplier imports
// carry one in `productCosts`, a product the owner priced by hand may not. A
// line with no cost contributes nothing to either side, so an unknown cost can
// neither block a code nor be treated as zero (which would read as pure profit
// and wave everything through).
// ---------------------------------------------------------------------------

export interface MarginLine {
  /** What the customer pays for this line, excluding VAT, before the discount. */
  revenue: number;
  /** What the goods cost the shop, or null when nobody recorded it. */
  cost: number | null;
}

export interface MarginVerdict {
  /** Sum of the lines that have a cost. The rest are invisible to the guard. */
  pricedRevenue: number;
  pricedCost: number;
  /** Revenue on those same lines after the discount is taken off. */
  revenueAfterDiscount: number;
  /** As a percentage of the discounted revenue, or null when nothing is priced. */
  marginPercent: number | null;
  /** True when the guard should refuse the code. */
  breached: boolean;
}

/**
 * @param discountAmount the money the coupon takes off, on the whole basket.
 *   It is apportioned onto the priced lines in proportion to their share of the
 *   eligible revenue — charging the whole discount against them would refuse
 *   codes that are in fact perfectly safe.
 * @param minMarginPercent the floor, as a percentage of the selling price.
 *   0 means "never below cost", which is the default and the only number the
 *   owner has to understand.
 */
export function checkMarginFloor(
  lines: MarginLine[],
  eligibleRevenue: number,
  discountAmount: number,
  minMarginPercent: number,
): MarginVerdict {
  let pricedRevenue = 0;
  let pricedCost = 0;
  for (const line of lines) {
    const revenue = Number(line.revenue);
    const cost = line.cost;
    if (!Number.isFinite(revenue) || revenue < 0) continue;
    if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) continue;
    pricedRevenue += revenue;
    pricedCost += cost;
  }

  if (pricedRevenue <= 0) {
    // Nothing the guard can see. It must not refuse on no evidence.
    return { pricedRevenue: 0, pricedCost, revenueAfterDiscount: 0, marginPercent: null, breached: false };
  }

  const base = Number.isFinite(eligibleRevenue) && eligibleRevenue > 0 ? eligibleRevenue : pricedRevenue;
  const share = Math.min(1, pricedRevenue / base);
  const discountHere = Math.max(0, Number(discountAmount) || 0) * share;
  const revenueAfterDiscount = Math.max(0, pricedRevenue - discountHere);
  const marginPercent = revenueAfterDiscount > 0
    ? ((revenueAfterDiscount - pricedCost) / revenueAfterDiscount) * 100
    : -Infinity;

  const floor = Number.isFinite(minMarginPercent) ? Number(minMarginPercent) : 0;
  // Strictly below. A code that lands exactly on the floor is allowed: the
  // owner set that number as the line he is willing to sell at.
  const breached = marginPercent < floor;
  return {
    pricedRevenue,
    pricedCost,
    revenueAfterDiscount,
    marginPercent: Number.isFinite(marginPercent) ? Math.round(marginPercent * 100) / 100 : marginPercent,
    breached,
  };
}

// ---------------------------------------------------------------------------
// 4.14 — a batch of unique codes.
// ---------------------------------------------------------------------------

/**
 * The alphabet for generated codes.
 *
 * No O, 0, I or 1. These get printed on a card, read over a phone and typed
 * back in, and a code nobody can transcribe is a support call, not a campaign.
 */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * @param randomInt must return an integer in [0, max). Injected so the tests
 *   can pin the output; the server passes a crypto-backed one, because
 *   Math.random is guessable and these codes are money.
 */
export function generateCouponCodes(
  prefix: string,
  count: number,
  length: number,
  randomInt: (max: number) => number,
  taken: Iterable<string> = [],
): string[] {
  const clean = String(prefix ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const want = Math.max(0, Math.min(500, Math.floor(Number(count) || 0)));
  const len = Math.max(4, Math.min(12, Math.floor(Number(length) || 6)));
  const seen = new Set<string>();
  for (const t of taken) seen.add(String(t).toUpperCase());

  const out: string[] = [];
  // Bounded: with a small alphabet and a big batch the generator can collide
  // repeatedly, and an unbounded while() would hang the request rather than
  // return fewer codes than asked for.
  let attempts = 0;
  const ceiling = want * 50 + 100;
  while (out.length < want && attempts < ceiling) {
    attempts += 1;
    let body = '';
    for (let i = 0; i < len; i += 1) body += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    const code = `${clean}${body}`;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

// ---------------------------------------------------------------------------
// PAY-02 — A LIMITED CODE'S USE, HELD FROM THE ORDER TO THE MONEY.
//
// A code's uses are counted when the money arrives (usedCount, at payment), and
// that is right — an abandoned checkout must not spend one. But nothing stood
// between the order and the money, so a code with ten uses left could sit on
// any number of unpaid orders at once, a bank transfer keeps one open for days,
// and every one of them that was paid counted. Each order with a code that has
// a USAGE LIMIT now holds one use on the coupon document until its payment
// settles. Every other code holds nothing and costs nothing extra — a code that
// is only "once per customer" has no count for a hold to protect; the till and
// the payment check that rule on their own (code review E).
//
// ONE HOLD PER ORDER, ONE COUNT PER CUSTOMER. Each order's hold is its own, so
// the payment of one order, or the failure of another, gives back exactly its
// own. A customer's holds never count against HIM — an abandoned payment and a
// second press of Pay are one customer buying once, and refusing the retry would
// refuse him his own code — and his several open orders count ONCE against
// everyone else.
//
// A CUSTOMER IS EVERY KEY HE IS KNOWN BY (code review F). The same person checks
// out as a guest (his e-mail) and later signed in (his account): held under one
// key each, he was two holders, and his own guest hold told him, signed in, that
// the code was fully redeemed. A hold now keeps every key the server knew for
// him, and holds that share any key — however they link — are one customer.
//
// Pure; the server reads and writes the document in a transaction around these.
// ---------------------------------------------------------------------------

/** One order's claim on a limited code: whose it is, and when it was made. */
export interface CouponHold {
  /** The customer: an account, or a guest's (hashed) e-mail — the server decides. */
  holder: string;
  /**
   * Every key the server knew him by when the order was placed — his account, the
   * order's e-mail, his account's e-mail — `holder` first. Absent on a hold that
   * has only `holder` (one written before these, or a guest with one address).
   */
  keys?: string[];
  at: string;
}
/** Keyed on the ORDER id. */
export type CouponHolds = Record<string, CouponHold>;

/** More keys than one customer can have (an account and two addresses) are not his. */
const MAX_HOLDER_KEYS = 4;

/**
 * Every key the shop knows a customer by, for the holds: his account, then each
 * e-mail (the order's, his account's) — trimmed, in lower case and HASHED by
 * `hash`, because the coupon document is the owner's screen, not a list of
 * customers' addresses. Each key once; the first is the hold's `holder`. Empty
 * when there is neither (a guest's quote, before the e-mail is typed): such a
 * caller cannot be told from anyone else, and his own holds count like anyone's.
 *
 * `hash` is the server's (sha256), passed in so this stays pure and testable.
 */
export function couponHolderKeys(
  uid: string | null | undefined,
  emails: readonly unknown[],
  hash: (text: string) => string,
): string[] {
  const keys: string[] = [];
  if (typeof uid === 'string' && uid) keys.push(`uid:${uid}`);
  for (const email of emails) {
    const clean = String(email ?? '').trim().toLowerCase();
    if (!clean) continue;
    const key = `email:${hash(clean)}`;
    if (!keys.includes(key)) keys.push(key);
  }
  return keys.slice(0, MAX_HOLDER_KEYS);
}

/** A hold's keys, `holder` among them, each once. */
function keysOfHold(h: CouponHold): string[] {
  return [...new Set([h.holder, ...(h.keys ?? [])])];
}

/** One key or several, as a list. */
const asKeys = (keys: string | readonly string[] | null | undefined): string[] =>
  (typeof keys === 'string' ? [keys] : [...(keys ?? [])]).filter((k): k is string => typeof k === 'string' && k !== '');

/**
 * How long a hold counts with nothing heard about its payment.
 *
 * Mollie keeps a BANK TRANSFER open for 12 days unless the payment names a
 * dueDate, and this shop names none (POST /api/checkout/pay). Every other method
 * closes in minutes to hours, and Mollie then calls the webhook with `canceled`,
 * `expired` or `failed`, which gives the hold back at once. Fourteen days covers
 * the slowest payment with room for a late webhook; a hold older than that is no
 * longer counted, so a payment whose webhook never came cannot keep a use forever.
 */
export const COUPON_HOLD_MS = 14 * 24 * 60 * 60 * 1000;

/** The holds a coupon document carries, made safe: anything malformed is no hold. */
export function cleanCouponHolds(raw: unknown): CouponHolds {
  const out: CouponHolds = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [orderId, value] of Object.entries(raw as Record<string, unknown>)) {
    const h = value as { holder?: unknown; keys?: unknown; at?: unknown } | null;
    if (!orderId || !h || typeof h !== 'object') continue;
    if (typeof h.holder !== 'string' || !h.holder) continue;
    if (typeof h.at !== 'string' || !Number.isFinite(Date.parse(h.at))) continue;
    // A key that is not a non-empty string is no key; `holder` is always one of them.
    const keys = [...new Set([h.holder, ...(Array.isArray(h.keys) ? asKeys(h.keys as string[]) : [])])]
      .slice(0, MAX_HOLDER_KEYS);
    out[orderId] = keys.length > 1 ? { holder: h.holder, keys, at: h.at } : { holder: h.holder, at: h.at };
  }
  return out;
}

const holdIsLive = (h: CouponHold, nowMs: number) => nowMs - Date.parse(h.at) < COUPON_HOLD_MS;

/**
 * The holds as CUSTOMERS: holds that share a key are one customer's, and so are
 * holds linked through another (his account on one order, his account and e-mail
 * on the next, the e-mail alone on a guest try). Each group with its keys, its
 * orders, and whether any of its holds still counts.
 */
function holdCustomers(holds: CouponHolds, nowMs: number): { keys: Set<string>; orders: string[]; live: boolean }[] {
  const groups: { keys: Set<string>; orders: string[]; live: boolean }[] = [];
  for (const [orderId, h] of Object.entries(holds)) {
    const keys = keysOfHold(h);
    const joined = { keys: new Set(keys), orders: [orderId], live: holdIsLive(h, nowMs) };
    // The groups never share a key (each new hold merges every group it touches),
    // so testing against this hold's own keys finds all of them.
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const g = groups[i];
      if (!keys.some((k) => g.keys.has(k))) continue;
      g.keys.forEach((k) => joined.keys.add(k));
      joined.orders.push(...g.orders);
      joined.live = joined.live || g.live;
      groups.splice(i, 1);
    }
    groups.push(joined);
  }
  return groups;
}

/**
 * How many CUSTOMERS hold a use right now — each once, however many open orders
 * he has — leaving out the asking customer (`except`: every key he is known by),
 * whose next order is his own, not a rival's.
 */
export function liveCouponHolders(
  holds: unknown,
  nowMs: number,
  except?: string | readonly string[] | null,
): number {
  const mine = new Set(asKeys(except));
  return holdCustomers(cleanCouponHolds(holds), nowMs)
    .filter((g) => g.live && ![...g.keys].some((k) => mine.has(k)))
    .length;
}

/**
 * Hold one use for this order — or `usedUp` when the uses already paid for and
 * the customers holding the rest leave none. Holds past COUPON_HOLD_MS are
 * dropped on the way. `holderKeys`: every key the server knows this customer by
 * (couponHolderKeys); the hold keeps them all.
 */
export function placeCouponHold(input: {
  holds: unknown;
  usedCount: unknown;
  maxUses: unknown;
  holderKeys: string | readonly string[];
  orderId: string;
  nowMs: number;
}): { ok: true; holds: CouponHolds } | { ok: false; code: 'usedUp' } {
  const clean = cleanCouponHolds(input.holds);
  // Never empty: an order always has its e-mail. Were it, the hold is its own.
  const keys = [...new Set(asKeys(input.holderKeys))].slice(0, MAX_HOLDER_KEYS);
  if (keys.length === 0) keys.push(`order:${input.orderId}`);
  const maxUses = Math.max(0, Number(input.maxUses) || 0);
  const used = Math.max(0, Number(input.usedCount) || 0);
  // Counted as the quote counts it — on everything the document holds, so a link
  // through a lapsed hold joins the same two holds here as there.
  if (maxUses > 0 && used + liveCouponHolders(clean, input.nowMs, keys) >= maxUses) {
    return { ok: false, code: 'usedUp' };
  }
  const live: CouponHolds = {};
  for (const [orderId, h] of Object.entries(clean)) {
    if (holdIsLive(h, input.nowMs)) live[orderId] = h;
  }
  live[input.orderId] = {
    holder: keys[0],
    ...(keys.length > 1 ? { keys } : {}),
    at: new Date(input.nowMs).toISOString(),
  };
  return { ok: true, holds: live };
}

/**
 * The holds without this order's — it can no longer be paid, or its money
 * arrived. `paid`: the hold becomes a use, and the customer's OTHER open orders
 * with the code give theirs back too — every hold of his, by any key he is known
 * by. His hold was for buying once and the order he paid is that once; the others
 * are tries he left behind, and holding a use for them as well would count him
 * twice against everyone else. Should he pay one of them as well, it is counted
 * then (and stamped if past the limit). `released` says whether anything of his
 * was given back.
 */
export function releaseCouponHold(
  holds: unknown,
  orderId: string,
  nowMs: number,
  opts: { paid?: boolean } = {},
): { holds: CouponHolds; released: boolean } {
  const clean = cleanCouponHolds(holds);
  const his = new Set<string>([orderId]);
  if (opts.paid && clean[orderId]) {
    for (const id of holdCustomers(clean, nowMs).find((g) => g.orders.includes(orderId))?.orders ?? []) his.add(id);
  }
  const kept: CouponHolds = {};
  let released = false;
  for (const [id, h] of Object.entries(clean)) {
    if (his.has(id)) {
      released = true;
      continue;
    }
    if (holdIsLive(h, nowMs)) kept[id] = h;
  }
  return { holds: kept, released };
}
