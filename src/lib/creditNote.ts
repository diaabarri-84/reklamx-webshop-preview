// Kreditnota — the document a Swedish business issues when it gives money back.
//
// He confirmed on 2026-09-12 that he issues a formal document when he refunds,
// not just the money. Swedish accounting law is the reason this is not optional:
// an invoice that has been issued cannot be edited or deleted, so a refund is a
// SECOND document that references the first and carries negative amounts.
//
// Everything here is pure arithmetic and decisions about it. Numbering, writing
// and sending live in server.ts; the sums live here because they are money and
// because scripts/test-credit-note.mjs can then check them.
//
// ────────────────────────────────────────────────────────────────────────────
// THE TWO RULES THAT MATTER
//
// 1. A CREDIT NOTE IS FOR THE INCREMENT, NOT THE TOTAL. `refundedAmount` on the
//    order is cumulative. Refund 100 today and 150 tomorrow and the field reads
//    250 — issuing a credit note for 250 the second time would credit the
//    customer 350 on paper against a 250 refund, and the books would never
//    reconcile.
//
// 2. THE VAT SPLIT COMES FROM THE ORDER, NOT FROM TODAY'S RATE. The rate can
//    change, and a refund of a 6% order must return 6% VAT however many years
//    later. The proportion used is the one the order itself carries — the same
//    one the revenue report uses, so the two can never disagree.

export interface CreditableOrder {
  grossTotal?: unknown;
  totalAmount?: unknown;
  netTotal?: unknown;
  vatAmount?: unknown;
  vatRate?: unknown;
}

export interface CreditNoteFigures {
  /** Positive magnitudes. The document prints them negative; the data stays positive. */
  gross: number;
  net: number;
  vat: number;
  /** The proportion actually applied, for the document to show. */
  vatShare: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * How much a NEW credit note is for, given the cumulative figures.
 *
 * Returns null when nothing is due — which is the common case, because payment
 * webhooks repeat and most of them carry no change at all.
 */
export function creditNoteAmountDue(
  previouslyRefunded: unknown,
  nowRefunded: unknown,
  orderGross: unknown,
): number | null {
  const before = Math.max(0, num(previouslyRefunded));
  const after = Math.max(0, num(nowRefunded));
  const gross = Math.max(0, num(orderGross));

  const increment = round2(after - before);
  if (increment <= 0) return null;           // a repeat, or a correction downwards

  // A refund cannot exceed what was paid. If it somehow does, credit only up to
  // the order — a credit note for more than the invoice is not a document any
  // accountant can use, and the excess belongs in a conversation, not in a file.
  const creditable = round2(Math.max(0, gross - before));
  const amount = Math.min(increment, creditable);
  return amount > 0 ? amount : null;
}

/**
 * Split a gross refund into net and VAT, in the order's own proportion.
 *
 * Orders written before the breakdown existed carry neither netTotal nor
 * vatAmount; for those the rate on the order is used, and if that is missing too
 * the caller's fallback is. Deriving is honest; inventing a 25% split for a 6%
 * order is not.
 */
export function creditNoteFigures(
  order: CreditableOrder,
  refundGross: number,
  fallbackRate = 0.25,
): CreditNoteFigures {
  const gross = round2(Math.max(0, num(refundGross)));
  const orderGross = num(order?.grossTotal ?? order?.totalAmount);
  const storedNet = num(order?.netTotal);
  const storedVat = num(order?.vatAmount);

  let vatShare: number;
  if (orderGross > 0 && (storedNet > 0 || storedVat > 0)) {
    // The same expression the revenue report uses, so a credit note and the
    // report can never disagree about what a refund did to the VAT.
    vatShare = storedVat / orderGross;
  } else {
    // PRESENT, not TRUTHY. A reverse-charge or export order stores vatRate: 0,
    // and testing `> 0` reads that as "no rate recorded" and falls back to 25% —
    // crediting the customer VAT that was never charged and putting a VAT figure
    // into the books against a sale that carried none. The test for this case is
    // in scripts/test-credit-note.mjs; it failed on the first version of this
    // line.
    const raw = Number(order?.vatRate);
    const rate = Number.isFinite(raw) && raw >= 0 ? raw : fallbackRate;
    vatShare = rate > 0 ? rate / (1 + rate) : 0;
  }
  // Guard the arithmetic rather than trust the stored fields: a corrupt vatAmount
  // larger than the gross would otherwise produce a credit note whose VAT is
  // bigger than its total.
  if (!Number.isFinite(vatShare) || vatShare < 0) vatShare = 0;
  if (vatShare > 1) vatShare = 1;

  const vat = round2(gross * vatShare);
  return { gross, vat, net: round2(gross - vat), vatShare };
}

/** `K` for kredit, then the year, then a sequence of its own. Never an order number. */
export function formatCreditNoteNumber(year: number, sequence: number): string {
  return `K${year}${String(sequence).padStart(5, '0')}`;
}
