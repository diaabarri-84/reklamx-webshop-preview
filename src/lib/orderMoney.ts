/**
 * AN ORDER'S MONEY, ONE WAY — the invoice, the receipt and the admin's order page.
 *
 * The invoice and the receipt each carried this derivation; the admin's order
 * page (round 16) wrote its own and got it wrong: it showed the goods AFTER the
 * coupon as "Net", then took the coupon off again, and never showed loyalty
 * points — 1000 kr of goods with a 100 kr coupon and 100 kr shipping printed
 * rows summing to 1150 under a total of 1250. One function now, tested, and
 * every row it returns adds up:
 *
 *   goodsBeforeDiscounts − coupon − points = goodsNet
 *   goodsNet + shipping                    = net        (excl. VAT)
 *   net + vat                              = gross
 *
 * Orders written before the breakdown was stored fall back to deriving it from
 * the total, as the documents always did.
 */

const has = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const num = (v: unknown): number => (has(v) ? Number(v) : 0);

export interface OrderMoney {
  /** The goods as priced, before any discount, excl. VAT. */
  goodsBeforeDiscounts: number;
  coupon: number;
  points: number;
  /** The goods after discounts, excl. VAT. */
  goodsNet: number;
  shipping: number;
  /** Everything excl. VAT: goods after discounts plus shipping. */
  net: number;
  vatRate: number;
  vat: number;
  gross: number;
  refunded: number;
  currency: string;
}

export function orderMoney(order: Record<string, any> | null | undefined): OrderMoney {
  const o = order ?? {};
  const shipping = num(o.shippingCost);
  const points = num(o.pointsDiscountAmount);
  const coupon = num(o.discountAmount);
  const vatRate = num(o.vatRate) || 0.25;

  const hasBreakdown = has(o.netTotal) && has(o.vatAmount) && has(o.grossTotal);
  const net = hasBreakdown ? Number(o.netTotal) : num(o.totalAmount) / (1 + vatRate);
  const vat = hasBreakdown ? Number(o.vatAmount) : net * vatRate;
  const gross = hasBreakdown ? Number(o.grossTotal) : net + vat;
  // Shipping is inside `net`; this is the goods-only figure, so the printed rows
  // add up instead of counting delivery twice.
  const goodsNet = has(o.goodsNet) ? Number(o.goodsNet) : Math.max(0, net - shipping);

  return {
    goodsBeforeDiscounts: goodsNet + coupon + points,
    coupon,
    points,
    goodsNet,
    shipping,
    net,
    vatRate,
    vat,
    gross,
    refunded: num(o.refundedAmount),
    currency: typeof o.currency === 'string' && o.currency ? o.currency : 'SEK',
  };
}
