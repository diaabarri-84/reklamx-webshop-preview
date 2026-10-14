/**
 * THE PRICE ON A PRODUCT CARD — the shop grid's and the suggestions' under a
 * product, one rule for both.
 *
 * Whether the card says "on offer" is the shop's own pricing function's answer,
 * at the product's minimum quantity (what its page opens on): the minimum-price
 * floor can lift an offer straight back to the list price, and a card that
 * advertised "−19%, from 120 kr" for a product its page then charged 149 for
 * was a bug the grid had. What the card SAYS comes from the product's two prices
 * (see below), by the same rule the product page's badge reads, so the two can
 * never quote different percentages.
 *
 * Needs `minQuantity`, `customUploadRules` and `pricingRules` beside the two
 * prices — without them calcConfiguredItemPrice falls back to the 149 kr floor
 * and hides genuine offers. Formatting (currency, VAT) stays with the caller.
 *
 * THE PRICE IT SHOWS is never under what the page charges (code review ADM-14):
 * a product priced below its minimum unit price is sold at the minimum, and its
 * card said the lower figure — 64 kr in the grid, 149 kr on the page. When the
 * floor lifts the price, the card shows the floor.
 *
 * …AND THE PERCENTAGE IT SAYS is the one between the two prices it shows, each
 * lifted to that minimum (code review 2026-10-11, REVIEW-3 #4 / N). From the
 * product's own two prices, 200 kr offered at 100 with the 149 kr minimum read
 * "−50 %" beside 149 and a struck-through 200: a 25.5 % reduction. The product
 * page's badge reads it from here too (ProductConfigurator, offerPercentShown).
 */
import { calcConfiguredItemPrice, PRICING_DEFAULTS } from './pricing';

/**
 * The minimum unit price as the pricing reads it — the product's, else the shop's —
 * and as a number, whatever is stored ("149"). 0: no minimum.
 */
export function unitPriceFloor(customUploadRules: unknown): number {
  const minPrice = (customUploadRules as { minPrice?: unknown } | null | undefined)?.minPrice;
  return Number(minPrice ?? PRICING_DEFAULTS.minPrice) || 0;
}

/**
 * The offer's percentage between the two prices a shopper is SHOWN: the list price
 * and the offer price, each lifted to the minimum unit price. 0 when there is no
 * offer (the pricing's own test: above 0 and under the list price), or when the
 * minimum leaves nothing between the two to show. Rounded to whole percent, as
 * every badge has been.
 */
export function offerPercentShown(basePrice: unknown, salePrice: unknown, floor: number): number {
  const base = Number(basePrice) || 0;
  const offer = Number(salePrice);
  if (!(Number.isFinite(offer) && offer > 0 && offer < base)) return 0;
  const was = Math.max(floor, base);
  const now = Math.max(floor, offer);
  return now < was ? Math.round(((was - now) * 100) / was) : 0;
}

export interface CardPriceSource {
  basePrice?: unknown;
  salePrice?: unknown;
  minQuantity?: unknown;
  customUploadRules?: unknown;
  pricingRules?: unknown;
}

export function cardPrices(product: CardPriceSource): {
  onSale: boolean;
  offPercent: number;
  /** Net SEK: the offer price when on offer, else the list price. */
  price: number;
  /** Net SEK, struck through beside `price` when on offer. */
  listPrice: number | null;
} {
  const base = Number(product.basePrice) || 0;
  const sale = Number(product.salePrice) || 0;
  const priced = calcConfiguredItemPrice({
    basePrice: base,
    salePrice: product.salePrice == null ? null : sale,
    quantity: Math.max(1, Number(product.minQuantity) || 1),
    uploadRules: (product.customUploadRules ?? undefined) as never,
    pricingRules: (product.pricingRules ?? undefined) as never,
  });
  // The minimum as the page applies it to a piece with nothing added. Read here,
  // not inferred from the priced line: for an area-priced product that line carries
  // the default size's surcharge, which the card does not show (a 20 kr card said
  // 149, a 64 kr one 64).
  const floor = unitPriceFloor(product.customUploadRules);
  const shown = priced.isOnSale ? sale : base;
  const offPercent = priced.isOnSale ? offerPercentShown(base, product.salePrice, floor) : 0;
  // Advertised only when the two figures on the card differ: an area-priced product
  // under its minimum can be on offer at its default size while the card, which
  // shows no size, would print "−0 %" over a struck-through price under its own.
  const onSale = offPercent > 0;
  return {
    onSale,
    offPercent,
    price: floor > shown ? floor : shown,
    listPrice: onSale ? base : null,
  };
}
