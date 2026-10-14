/**
 * THE ORDER QUEUE — search, filters and sorts, shared by the production queue
 * (/staff-dashboard) and the admin's Orders tab.
 *
 * The client asked to sort orders "by priority, by print date and by delivery
 * date", with priority set by the staff. Two new fields on the order make that
 * possible, both written by staff from either screen:
 *
 *   priority   'urgent' | 'high' | absent (= normal)
 *   printDate  'YYYY-MM-DD' — the day the job is planned for the press
 *
 * and `dueDate` (the promised delivery day) was already there. One module, so
 * the two screens can never disagree about what "sorted by priority" means, and
 * so the rules are tested rather than eyeballed.
 *
 * Pure and dependency-free. Dates are compared as Stockholm calendar days — a
 * shop in Sweden means "orders from the 5th" in Swedish time, not UTC.
 */

import type { TranslationKey } from './translations';

export type OrderPriority = 'normal' | 'high' | 'urgent';

/**
 * The production stages, in order, with the label each is shown under (the sd*
 * keys exist in all four shop languages). Shared so the admin screens and the
 * printed invoice name a stage the same way — the invoice printed the raw value,
 * "IN_PRINT", to the customer.
 */
export const ORDER_STAGES: ReadonlyArray<{ id: string; key: TranslationKey }> = [
  { id: 'pending', key: 'sdStatusPending' },
  { id: 'in_design', key: 'sdStatusInDesign' },
  { id: 'in_print', key: 'sdStatusInPrint' },
  { id: 'finishing', key: 'sdStatusFinishing' },
  { id: 'shipped', key: 'sdStatusShipped' },
  { id: 'completed', key: 'sdStatusCompleted' },
  { id: 'cancelled', key: 'sdStatusCancelled' },
];

/**
 * The stage an order is in. A missing or unknown status counts as 'pending' —
 * the label already said "Pending" for it while the Pending filter left it out,
 * so it showed under a name no filter could find.
 */
export function stageOf(order: AnyOrder | null | undefined): string {
  const s = order?.status;
  return ORDER_STAGES.some((st) => st.id === s) ? String(s) : 'pending';
}

export function stageLabelKey(status: unknown): TranslationKey {
  return ORDER_STAGES.find((s) => s.id === status)?.key ?? 'sdStatusPending';
}

/**
 * The label of a stage the shop knows, or null. For documents a customer
 * keeps: a legacy or unknown status must not print as "Pending". 'delivered'
 * is the old name of 'completed'.
 */
export function knownStageLabelKey(status: unknown): TranslationKey | null {
  const id = status === 'delivered' ? 'completed' : status;
  return ORDER_STAGES.find((s) => s.id === id)?.key ?? null;
}
export type OrderSort = 'newest' | 'priority' | 'printDate' | 'dueDate';
export type PaymentFilter = 'all' | 'paid' | 'unpaid' | 'reversed';

/**
 * What an order's payment means, in the four classes the server's reports use
 * (server.ts, /api/admin/reports) — so a dashboard tile's number and the list it
 * opens count the same orders:
 *
 *   test      paid or not, with Mollie's TEST key: never money
 *   paid      real money in
 *   reversed  refunded or charged back: a sale undone, not a checkout abandoned
 *   unpaid    everything else — open, expired, failed, cancelled, or no payment
 */
export type PaymentClass = 'test' | 'paid' | 'reversed' | 'unpaid';

export function paymentClass(order: AnyOrder | null | undefined): PaymentClass {
  if (order?.paymentMode === 'test') return 'test';
  const s = String(order?.paymentStatus ?? '').toLowerCase();
  if (s === 'paid') return 'paid';
  if (s === 'refunded' || s === 'chargeback') return 'reversed';
  return 'unpaid';
}

/** The payment state in words, in the shop's four languages — never Mollie's raw value. */
/**
 * PLACED TO PAY ON DELIVERY AND STILL OPEN — agreed with the owner, produced before
 * the money arrives: not paid yet, not refunded, not cancelled. Committed work for
 * the queue and the tiles; never revenue.
 */
export function isOnDeliveryOpen(order: AnyOrder | null | undefined): boolean {
  if (order?.payOnDelivery !== true) return false;
  const pay = String(order?.paymentStatus ?? '').toLowerCase();
  return !['paid', 'refunded', 'chargeback'].includes(pay) && String(order?.status ?? '').toLowerCase() !== 'cancelled';
}

/**
 * HOW THE ORDER IS — OR IS TO BE — PAID, in the reader's language where the shop
 * wrote the words itself (pay on delivery, and how it was then paid); otherwise the
 * title stored on the order (Mollie's method), as before.
 */
export function paymentTitleOf(order: AnyOrder | null | undefined, t: (k: TranslationKey) => string): string {
  if (order?.payOnDelivery === true) {
    if (String(order?.paymentStatus ?? '').toLowerCase() !== 'paid') return t('payStatusOnDelivery');
    const how: Partial<Record<string, TranslationKey>> = {
      cash: 'oaPaidCash', card: 'oaPaidCard', bank: 'oaPaidBank', invoice: 'oaPaidInvoice',
    };
    const method = String(order?.paymentRecordedMethod ?? '');
    const word = method === 'swish' ? 'Swish' : how[method] ? t(how[method]!) : null;
    if (word) return t('docPaidOnDelivery').replace('{0}', word);
  }
  return String(order?.paymentMethodTitle ?? '') || '';
}

export function paymentLabelKey(order: AnyOrder | null | undefined): TranslationKey {
  // Placed to pay on delivery: not paid yet, but not a checkout left unpaid either.
  if (isOnDeliveryOpen(order)) return 'payStatusOnDelivery';
  switch (String(order?.paymentStatus ?? '').toLowerCase()) {
    case 'paid': return 'payStatusPaid';
    case 'open':
    case 'pending': return 'payStatusOpen';
    case 'authorized': return 'payStatusAuthorized';
    case 'expired': return 'payStatusExpired';
    case 'failed': return 'payStatusFailed';
    case 'canceled':
    case 'cancelled': return 'payStatusCanceled';
    case 'refunded': return 'payStatusRefunded';
    case 'chargeback': return 'payStatusChargeback';
    default: return 'payStatusNone';
  }
}

/**
 * Done with, as far as the queue is concerned: finished or cancelled work, and
 * checkouts whose payment is dead. These sort after the live work in every
 * sort but "newest" — sorted by delivery date, a completed job from last month
 * and fifty expired checkouts were the top of the press operator's list.
 */
export function isClosed(order: AnyOrder | null | undefined): boolean {
  const st = stageOf(order);
  if (st === 'completed' || st === 'cancelled') return true;
  const p = String(order?.paymentStatus ?? '').toLowerCase();
  return ['expired', 'failed', 'canceled', 'refunded', 'chargeback'].includes(p);
}

export interface QueueFilters {
  /**
   * An order status ('pending', 'in_print' …), 'all', or one of two groups the
   * dashboard tiles open: 'active' (paid, not finished or cancelled — the
   * "Active orders" tile) and 'production' (in design, printing or finishing —
   * the "Printer capacity" tile).
   */
  stage?: string;
  payment?: PaymentFilter;
  /** Free text: order number, name, e-mail, phone, company, product. */
  q?: string;
  /** Inclusive Stockholm calendar days, 'YYYY-MM-DD'. */
  from?: string;
  to?: string;
  /** Only this priority (or 'all'). */
  priority?: OrderPriority | 'all';
}

type AnyOrder = Record<string, any>;

export function priorityOf(order: AnyOrder | null | undefined): OrderPriority {
  const p = order?.priority;
  return p === 'urgent' || p === 'high' ? p : 'normal';
}

/** urgent 0, high 1, normal 2 — lower sorts first. */
export function priorityRank(order: AnyOrder | null | undefined): number {
  const p = priorityOf(order);
  return p === 'urgent' ? 0 : p === 'high' ? 1 : 2;
}

export function isPaid(order: AnyOrder | null | undefined): boolean {
  return String(order?.paymentStatus ?? '').toLowerCase() === 'paid';
}

/** A 'YYYY-MM-DD' day stored on the order, or null when absent or malformed. */
export function dayField(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * When the order was placed, in ms. createdAt is ISO with "Z"; Mollie's own
 * timestamps end in "+00:00" — Date.parse reads both, a string compare would not.
 */
export function createdMs(order: AnyOrder | null | undefined): number {
  const ms = Date.parse(String(order?.createdAt ?? ''));
  return Number.isFinite(ms) ? ms : 0;
}

const stockholmDay = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Stockholm',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Stockholm calendar day an order was placed on, 'YYYY-MM-DD'. */
export function createdDay(order: AnyOrder | null | undefined): string | null {
  const ms = createdMs(order);
  return ms ? stockholmDay.format(new Date(ms)) : null;
}

// ø and æ have no decomposition, so NFKD alone left "soren" unable to find
// "Søren" — and this shop's customers are Danish and Norwegian too.
const fold = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');

/**
 * A phone number as digits, the Swedish way: +46 70… and 0046 70… are 070…,
 * so a number typed either way finds one stored the other way.
 */
function phoneDigits(raw: unknown): string {
  const s = String(raw ?? '').trim();
  const d = s.replace(/\D/g, '');
  if (s.startsWith('+46')) return `0${d.slice(2).replace(/^0/, '')}`;
  if (d.startsWith('0046')) return `0${d.slice(4).replace(/^0/, '')}`;
  return d;
}

/**
 * Does the order match every word of the search? Words are matched anywhere in
 * the order number, the customer's name, e-mail, company and phone, and the
 * product names — so "anna 2026000" and "roll up stockholm" both work. A word of
 * digits also matches the phone with its spaces and dashes removed.
 */
export function matchesQuery(order: AnyOrder, q: string | undefined): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const c = order?.customerDetails ?? {};
  const haystack = fold(
    [
      order?.id,
      order?.customerName,
      order?.customerEmail,
      c.company,
      c.city,
      c.phone,
      ...((order?.items ?? []) as AnyOrder[]).map((i) => i?.productName),
    ].join(' '),
  );
  const phone = phoneDigits(c.phone);
  return words.every((w) => {
    if (haystack.includes(w)) return true;
    if (!/^\+?[\d-]+$/.test(w)) return false;
    const digits = phoneDigits(w);
    return digits.length > 0 && phone.includes(digits);
  });
}

export function filterOrders<T extends AnyOrder>(orders: T[], f: QueueFilters = {}): T[] {
  return orders.filter((o) => {
    // For the queue an order agreed to be paid on delivery is cleared like a paid
    // one — it is being made — while its badge still says "Pay on delivery".
    const pay = isOnDeliveryOpen(o) ? 'paid' : paymentClass(o);
    // The two tile groups count exactly what the tiles count: real paid orders
    // (the server skips test payments and counts stages of paid orders only).
    if (f.stage === 'active') {
      if (pay !== 'paid' || ['completed', 'cancelled'].includes(stageOf(o))) return false;
    } else if (f.stage === 'production') {
      if (pay !== 'paid' || !['in_design', 'in_print', 'finishing'].includes(stageOf(o))) return false;
    } else if (f.stage && f.stage !== 'all' && stageOf(o) !== f.stage) return false;
    if (f.payment && f.payment !== 'all' && pay !== f.payment) return false;
    if (f.priority && f.priority !== 'all' && priorityOf(o) !== f.priority) return false;
    if (f.from || f.to) {
      const day = createdDay(o);
      if (!day) return false;
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
    return matchesQuery(o, f.q);
  });
}

/** Missing days sort LAST, whatever the direction of the rest. */
const byDay = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
};

/**
 * The four orders of the queue. Stable: equal orders keep the order they came
 * in. Within a tie the most useful next question decides — what is promised
 * soonest, then whoever ordered first. Every sort but "newest" puts the closed
 * orders (isClosed) after the live ones.
 */
export function sortOrders<T extends AnyOrder>(orders: T[], mode: OrderSort = 'newest'): T[] {
  const indexed = orders.map((order, index) => ({ order, index }));
  const cmp = (x: { order: T; index: number }, y: { order: T; index: number }): number => {
    const a = x.order;
    const b = y.order;
    let d = 0;
    if (mode === 'newest') {
      d = createdMs(b) - createdMs(a);
    } else if (isClosed(a) !== isClosed(b)) {
      d = isClosed(a) ? 1 : -1;
    } else if (mode === 'priority') {
      d = priorityRank(a) - priorityRank(b)
        || byDay(dayField(a.dueDate), dayField(b.dueDate))
        || createdMs(a) - createdMs(b);
    } else if (mode === 'printDate') {
      d = byDay(dayField(a.printDate), dayField(b.printDate))
        || priorityRank(a) - priorityRank(b)
        || byDay(dayField(a.dueDate), dayField(b.dueDate))
        || createdMs(a) - createdMs(b);
    } else if (mode === 'dueDate') {
      d = byDay(dayField(a.dueDate), dayField(b.dueDate))
        || priorityRank(a) - priorityRank(b)
        || createdMs(a) - createdMs(b);
    }
    return d || x.index - y.index;
  };
  return indexed.sort(cmp).map((x) => x.order);
}
