// Single source of truth for every price the shop calculates.
//
// WHY THIS FILE EXISTS
// Until now the same formula was written out three times — once in the product
// configurator, once on the custom-upload page and once on the checkout page —
// and all three ran in the customer's browser. That made the price whatever the
// browser said it was. This module is deliberately dependency-free (no Firebase,
// no React, no DOM) so `server.ts` can import it and recompute the authoritative
// price from the product documents, while the browser imports the very same code
// to show a preview. One formula, two callers, no drift.
//
// The numbers below are the values the shop is running with TODAY. They are moved
// here verbatim, not changed. Several of them are placeholders nobody has ever
// confirmed — see CLIENT-PAYMENT-QUESTIONS.md. Change them only from the answers.

import {
  LOYALTY_DEFAULTS,
  maxRedeemablePoints as maxRedeemableLoyaltyPoints,
  pointsEarnedOn,
  pointsValueSek,
  type LoyaltySettings,
} from './loyalty';

export const PRICING_DEFAULTS = {
  /** Floor applied to the unit price of every product. */
  minPrice: 149,
  /** Surcharge per square metre of the configured size. */
  pricePerSqm: 350,
  /** Roll printing: price per linear metre of height. */
  pricePerLinearMeter: 250,
  /** Charged once per cart line, never discounted. */
  baseSetupFee: 49,
  /** Quantity → discount on the unit price. */
  volumeDiscounts: [
    { minQuantity: 10, discountPercentage: 10 },
    { minQuantity: 50, discountPercentage: 20 },
    { minQuantity: 100, discountPercentage: 30 },
    { minQuantity: 500, discountPercentage: 40 },
  ],
  /** Default configured size, in centimetres. */
  defaultWidthCm: 50,
  defaultHeightCm: 70,
  /** Swedish standard VAT. Reduced rates (12 %, 6 %) are not modelled yet. */
  vatRate: 0.25,
  /**
   * Shipping options, in SEK, EXCLUDING VAT — the same basis as every product
   * price in this shop, and what the checkout shows by default.
   *
   * The owner set these on 2026-08-30: 99 standard, 169 express, collection
   * free. He books the freight himself in Zendr and uses DHL, DSV or UPS, so
   * the customer chooses a SPEED and the shop chooses the carrier — which is
   * why there is no carrier in these ids any more.
   *
   * The two dsv_* ids are retired but must stay: an order placed before this
   * change still prices and prints through them.
   */
  shippingFees: {
    standard: 99.0,
    express: 169.0,
    pickup: 0.0,
    dsv_zone: 63.2,
    dsv_weekday: 149.0,
  } as Record<string, number>,
  /**
   * The loyalty rates, kept here only so older call sites still resolve.
   *
   * 4.26 made these SETTINGS — see src/lib/loyalty.ts, which is where they are
   * read, clamped and used. Defined FROM those defaults rather than repeated, so
   * a change cannot land in one copy and not the other.
   */
  pointsEarnedPerSek: LOYALTY_DEFAULTS.pointsEarnedPerSek,
  pointsPerSek: LOYALTY_DEFAULTS.pointsPerSek,
} as const;

export type VolumeDiscountTier = { minQuantity: number; discountPercentage: number };

export type UploadRules = {
  enabled?: boolean;
  /** Charge area × rate. Opt-in; see calcConfiguredItemPrice. */
  areaPriced?: boolean;
  minPrice?: number;
  pricePerSqm?: number;
  pricePerLinearMeter?: number;
};

export type ProductPricingRules = {
  baseSetupFee?: number;
  volumeDiscounts?: VolumeDiscountTier[];
};

/** No single side of a printed piece is larger than this. */
const MAX_DIMENSION_CM = 10_000; // 100 metres

/**
 * A printable dimension in centimetres: finite, positive, and not a wall.
 *
 * Exported so the order writer can store the size a line was PRICED on using
 * exactly the same clamping the price was computed with — storing the raw
 * request instead would record a number the shop never charged for.
 */
export function clampDimension(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, MAX_DIMENSION_CM);
}

/**
 * Highest tier the quantity qualifies for. Returns 0 when no tier applies.
 */
export function volumeDiscountPercent(quantity: number, tiers?: VolumeDiscountTier[]): number {
  const applicable = (tiers ?? [])
    .filter((t) => quantity >= t.minQuantity)
    .sort((a, b) => b.minQuantity - a.minQuantity)[0];
  return applicable ? applicable.discountPercentage : 0;
}

export type ConfiguredItemInput = {
  basePrice?: number;
  /**
   * Special-offer price that stands in for `basePrice` while it is set.
   *
   * NET SEK, exactly like `basePrice` — the owner types net prices everywhere in
   * this shop and VAT is added once, at the end, by calcOrderTotals.
   *
   * It is honoured only when it is a real number, above zero, and genuinely
   * below the list price. Anything else is treated as "no offer" rather than as
   * an error: this value arrives from a Firestore document that no security rule
   * validates, and a typo must not be able to give the shop away.
   */
  salePrice?: number | null;
  /** Sum of priceModifier over every selected PER-PIECE printing option. */
  optionsSurcharge?: number;
  /**
   * Sum of priceModifier over every selected option charged ONCE per line — a
   * cutting die, a proof, a designer's fee (src/lib/chargeOnce.ts). Added to the
   * line total after the quantity, never multiplied by it, never volume-
   * discounted, and outside the minimum-price floor, exactly like the setup fee.
   */
  onceCharges?: number;
  widthCm?: number;
  heightCm?: number;
  quantity: number;
  uploadRules?: UploadRules;
  pricingRules?: ProductPricingRules;
};

export type ConfiguredItemPrice = {
  dimensionSurcharge: number;
  optionsSurcharge: number;
  basePrice: number;
  /** Unit price before the volume discount, after the minimum-price floor. */
  rawUnitPrice: number;
  discountPercent: number;
  unitPrice: number;
  setupFee: number;
  /** The one-off option charges in this line (never negative). */
  onceCharges: number;
  /** Line total, net of VAT: unitPrice × quantity + setupFee + onceCharges. */
  totalPrice: number;
  /**
   * True when a special offer actually made this line cheaper.
   *
   * Not simply "salePrice was set": the minimum-price floor below can lift an
   * offer straight back to the list price, and a struck-through price that
   * equals the price beside it makes the shop look like it is lying. So this is
   * derived from the two totals, after every rule has run.
   */
  isOnSale: boolean;
  /** Unit price the shopper would have paid without the offer. */
  listUnitPrice: number;
  /** Line total the shopper would have paid without the offer. */
  listTotalPrice: number;
};

/**
 * Price of one cart line for a catalogue product configured in the modal.
 * Mirrors ProductConfiguratorModal exactly, rounding included.
 */
export function calcConfiguredItemPrice(input: ConfiguredItemInput): ConfiguredItemPrice {
  const rules: UploadRules = input.uploadRules ?? {};
  const pricing: ProductPricingRules = input.pricingRules ?? {};

  // Clamped, because these arrive from the browser. A negative width produced a
  // negative surcharge and therefore a negative line total, which offset the rest
  // of the cart; 1e400 produced Infinity and then NaN, and NaN passed the
  // "total > 0" check as false without ever being caught as a number problem.
  const widthCm = clampDimension(input.widthCm, PRICING_DEFAULTS.defaultWidthCm);
  const heightCm = clampDimension(input.heightCm, PRICING_DEFAULTS.defaultHeightCm);
  const quantity = Math.max(1, Math.floor(input.quantity || 1));

  // AREA PRICING IS OPT-IN, and `enabled` is not the flag that opts in.
  //
  // This read `rules.enabled ?? true`, which is the artwork-upload switch and
  // defaults to on — so every product charged `areaSqm × pricePerSqm` on top of
  // its base price, using the 50 × 70 cm fallback when the shopper had never
  // been shown a size at all. A 1500 kr rollup quietly sold for 1622. The owner
  // had no way to stop it: `enabled` appears nowhere in the dashboard.
  //
  // `areaPriced` is the flag for this question and it defaults to OFF. Both the
  // browser and this function read the same one, so what the shopper is shown
  // stays what the server charges.
  const areaPriced = rules.areaPriced === true;
  const pricePerSqm = rules.pricePerSqm ?? PRICING_DEFAULTS.pricePerSqm;
  const minPrice = rules.minPrice ?? PRICING_DEFAULTS.minPrice;

  const areaSqm = (widthCm * heightCm) / 10000;
  const dimensionSurcharge = areaPriced ? Math.round(areaSqm * pricePerSqm) : 0;

  // NUMBERS, whatever the document holds. A price stored as the TEXT "149" was
  // joined, not added: "149" + 0 + 0 is "14900", and that string went on to be
  // the unit price (found by a review brute-forcing the card prices, round 16).
  const listBasePrice = Number(input.basePrice) || 0;
  const optionsSurcharge = Number(input.optionsSurcharge) || 0;

  // The offer replaces the BASE, not the finished price: options and area still
  // cost what they cost, the volume tier still applies on top, and the minimum
  // floor still holds. That is what makes an offer safe to switch on — it moves
  // one number and every other rule in this function keeps doing its job.
  const offer = Number(input.salePrice);
  const offerApplies = Number.isFinite(offer) && offer > 0 && offer < listBasePrice;
  const basePrice = offerApplies ? offer : listBasePrice;

  const discountPercent = volumeDiscountPercent(
    quantity,
    pricing.volumeDiscounts ?? (PRICING_DEFAULTS.volumeDiscounts as unknown as VolumeDiscountTier[]),
  );
  const setupFee = pricing.baseSetupFee ?? PRICING_DEFAULTS.baseSetupFee;

  // One-off charges can only ADD to a line. A negative one (an owner typing
  // "-100" on an option he also marked one-off) would otherwise subtract from
  // the line outside every floor this function keeps, and a big enough one would
  // make the line — and with it the basket — negative. Non-finite is 0.
  const onceRaw = Number(input.onceCharges);
  const onceCharges = Number.isFinite(onceRaw) && onceRaw > 0 ? Math.round(onceRaw * 100) / 100 : 0;

  // Run identically for both bases, so the struck-through "was" figure is the
  // price this shop would really have charged — not an estimate of it.
  const priceFrom = (base: number) => {
    let raw = base + optionsSurcharge + dimensionSurcharge;
    if (minPrice && raw < minPrice) raw = minPrice;
    const unit = Math.round(raw * (1 - discountPercent / 100));
    return { rawUnitPrice: raw, unitPrice: unit, totalPrice: unit * quantity + setupFee + onceCharges };
  };

  const now = priceFrom(basePrice);
  const list = offerApplies ? priceFrom(listBasePrice) : now;

  return {
    dimensionSurcharge,
    optionsSurcharge,
    basePrice,
    rawUnitPrice: now.rawUnitPrice,
    discountPercent,
    unitPrice: now.unitPrice,
    setupFee,
    onceCharges,
    totalPrice: now.totalPrice,
    // Derived from the finished totals: an offer that the minimum-price floor
    // lifted back to the list price is not an offer, and must not be shown as one.
    isOnSale: list.totalPrice > now.totalPrice,
    listUnitPrice: list.unitPrice,
    listTotalPrice: list.totalPrice,
  };
}

export type LinearMeterInput = {
  heightCm: number;
  quantity: number;
  pricePerLinearMeter?: number;
  minPrice?: number;
};

/**
 * Roll printing priced by height only — the width is fixed by the machine and
 * does not affect the price. Mirrors CustomFileUploadPage.
 */
export function calcLinearMeterPrice(input: LinearMeterInput): { unitPrice: number; totalPrice: number } {
  const perMetre = input.pricePerLinearMeter ?? PRICING_DEFAULTS.pricePerLinearMeter;
  const minPrice = input.minPrice ?? PRICING_DEFAULTS.minPrice;
  const quantity = Math.max(1, Math.floor(input.quantity || 1));

  const heightMeters = clampDimension(input.heightCm, 0) / 100;
  const raw = heightMeters * perMetre;
  const unitPrice = raw < minPrice ? minPrice : Math.round(raw * 100) / 100;

  return { unitPrice, totalPrice: unitPrice * quantity };
}

export type OrderTotalsInput = {
  /** Net line totals already computed per item. */
  lineTotals: number[];
  /**
   * Which of those lines the coupon is allowed to discount, index for index.
   *
   * A coupon used to be a single percentage multiplied against the whole
   * basket, because there was nothing a coupon could be limited TO. Now one can
   * be scoped to chosen products, and a product already sold at a special offer
   * is excluded from codes entirely — so the discount has to know which lines it
   * may touch.
   *
   * Omit it and every line is eligible, which is exactly the old behaviour. That
   * default matters: this function is called from the server AND from the
   * checkout's instant local preview, and the two must never disagree.
   */
  couponEligible?: boolean[];
  /** Coupon percentage, 0–100. */
  discountPercent?: number;
  /**
   * The most this coupon may ever take off, in kronor. Required on the shop's
   * side for anything above 50% — see CouponsLoyaltyAdmin. Absent means no
   * ceiling, which is how every coupon written before this behaves.
   */
  maxDiscountAmount?: number | null;
  /**
   * 4.9 — whether the percentage also comes off the delivery fee.
   *
   * Absent or false is what every coupon written before this means, and what
   * the shop has always done: the code discounts the goods, and delivery is
   * charged in full. True is for the "20% off everything, shipping included"
   * campaign, where charging 99 kr delivery on top of "everything" reads as a
   * broken promise.
   */
  discountIncludesShipping?: boolean;
  /** Points the customer asked to spend. Clamped to their balance and the order value. */
  pointsToRedeem?: number;
  pointsBalance?: number;
  /**
   * 4.26 — the loyalty rates, which are the owner's to set.
   *
   * MUST BE PASSED BY BOTH SIDES. This function runs on the server and in the
   * checkout's instant preview, and a rate read from settings in one and
   * compiled into the other would quote one price and charge another. Absent,
   * LOYALTY_DEFAULTS applies — the rates that were compiled in before this.
   */
  loyalty?: LoyaltySettings;
  shippingMethod?: string;
  shippingFees?: Record<string, number>;
  vatRate?: number;
};

export type OrderTotals = {
  rawSubtotal: number;
  /**
   * The part of rawSubtotal a coupon is allowed to discount.
   *
   * Equal to rawSubtotal when no scoping is in play. Worth returning rather than
   * recomputing at each call site: the minimum-order gate has to be checked
   * against THIS, or a "500 kr minimum" code passes on a basket made entirely of
   * items it cannot discount.
   */
  eligibleSubtotal: number;
  discountAmount: number;
  /** What the percentage alone would have taken off, before any cap. */
  uncappedDiscountAmount: number;
  discountedSubtotal: number;
  maxRedeemablePoints: number;
  pointsRedeemed: number;
  pointsDiscountAmount: number;
  /**
   * 4.22 — what the customer actually PAYS for the goods: after the discount,
   * after any points spent, excluding VAT and shipping. The base loyalty points
   * are earned on, returned rather than recomputed so the server and the browser
   * cannot arrive at different answers.
   */
  pointsQualifyingNet: number;
  /**
   * The delivery fee BEFORE any coupon reaches it.
   *
   * Deliberately the undiscounted figure: the checkout shows subtotal, minus
   * discount, plus shipping, and those three have to add up to the total on the
   * screen. When a code discounts shipping too, the saving is already inside
   * `discountAmount`, and showing a reduced fee here as well would subtract it
   * twice in the customer's own arithmetic.
   */
  shippingCost: number;
  /** How much of `discountAmount` came off the delivery fee rather than the goods. */
  shippingDiscountAmount: number;
  /** Everything except VAT. */
  netTotal: number;
  vatAmount: number;
  /** netTotal + vatAmount. */
  grossTotal: number;
};

/**
 * The order of operations here is load-bearing: the discount applies to the
 * subtotal (and, when the coupon says so, to the delivery fee), points come off
 * after that, and VAT is charged on what is left.
 *
 * 4.8 — THE DISCOUNT IS TAKEN BEFORE VAT, and that is not an implementation
 * detail: it is the only reading that is correct on a Swedish invoice. Every
 * `lineTotals` figure reaching this function is EXCLUDING VAT (see
 * calcConfiguredItemPrice, which never adds it), the coupon comes off that net
 * amount, and `vatAmount` is charged on the discounted net at the end. So a
 * 1 000 kr net order with a 10% code is invoiced as 900 net + 225 VAT = 1 125,
 * not as 1 250 gross less 10%. The two happen to give the same money at a single
 * rate — they stop agreeing the moment a basket mixes rates or an order is
 * reverse-charged at 0%, and the tax authority's copy has to match the shop's.
 * The kreditnota arithmetic in src/lib/creditNote.ts reads it the same way.
 */
export function calcOrderTotals(input: OrderTotalsInput): OrderTotals {
  const fees = input.shippingFees ?? PRICING_DEFAULTS.shippingFees;
  // `??`, not `||`: a genuine 0% rate — export, reverse charge — is falsy, and
  // `||` silently replaced it with 25%, charging VAT that should not exist.
  //
  // AND BOUNDED TO [0, 1], because this is a FRACTION. `Number.isFinite` alone
  // let 1e308 through, and the function then returned a VAT amount and a gross
  // total of Infinity without complaining — a money authority answering Infinity
  // is worse than one refusing. Nothing reaches this with an out-of-range rate
  // today (the server validates the setting, the browser reads it from a
  // validated context); this is so nothing ever can.
  const rawVatRate = Number(input.vatRate);
  const vatRate = Number.isFinite(rawVatRate) && rawVatRate >= 0 && rawVatRate <= 1
    ? rawVatRate
    : PRICING_DEFAULTS.vatRate;

  const rawSubtotal = input.lineTotals.reduce((sum, n) => sum + (Number(n) || 0), 0);

  // Missing flags mean "everything is eligible", and a flags array shorter than
  // the basket does NOT silently exclude the tail — an eligibility list that has
  // drifted out of step with the lines is a bug, and the safe reading of it is
  // the one that does not quietly overcharge the customer.
  const flags = input.couponEligible;
  const eligibleSubtotal = flags
    ? input.lineTotals.reduce((sum, n, i) => sum + (flags[i] === false ? 0 : Number(n) || 0), 0)
    : rawSubtotal;

  // Object.hasOwn, not fees[key]: 'constructor' and '__proto__' resolve through
  // the prototype chain and returned a function, which turned the total into NaN.
  //
  // Nothing in the basket means nothing to deliver, so no delivery to charge
  // for. Opening /checkout with an empty basket used to read "Standard
  // delivery 99.00 kr / VAT 24.75 kr / PAYMENT DUE 123.75 kr" over the words
  // "Your shopping cart is empty" — a price for shipping air. The Pay button
  // was correctly disabled underneath it, which only made the screen harder to
  // read: a total to pay, and no way to pay it.
  //
  // Computed HERE, above the discount, because 4.9 lets a coupon reach it.
  const method = input.shippingMethod ?? '';
  const hasSomethingToShip = input.lineTotals.length > 0;
  const shippingCost = hasSomethingToShip && Object.hasOwn(fees, method) ? Number(fees[method]) || 0 : 0;

  const discountPercent = Math.min(100, Math.max(0, input.discountPercent ?? 0));
  // 4.9 — the delivery fee joins the base only when the coupon says so. A code
  // that reaches nothing in the basket must not discount the shipping either:
  // `eligibleSubtotal > 0` is the same test the server uses to decide the code
  // applies at all.
  const shippingIsDiscountable = input.discountIncludesShipping === true && eligibleSubtotal > 0;
  const discountBase = eligibleSubtotal + (shippingIsDiscountable ? shippingCost : 0);
  const uncappedDiscount = Math.round(((discountBase * discountPercent) / 100) * 100) / 100;
  // A CEILING IN KRONOR, when the coupon carries one.
  //
  // A percentage alone scales with the basket, so a 90% code is worth 90 kr on a
  // 100 kr order and 9 000 kr on a 10 000 kr one. TEST100 — a live, working,
  // 100% code — sat in this shop's coupon list; the cap is what turns a mistake
  // of that kind into a small one.
  //
  // `??`, not `||`: a cap of 0 is a coupon that discounts nothing, which is
  // strange but is what was asked for, and `||` would read it as "no cap".
  const discountCap = input.maxDiscountAmount;
  const discountAmount = typeof discountCap === 'number' && Number.isFinite(discountCap) && discountCap >= 0
    ? Math.min(uncappedDiscount, discountCap)
    : uncappedDiscount;
  // HOW THE DISCOUNT IS SPLIT between the goods and the delivery fee — in
  // proportion to the base it was computed from.
  //
  // It is not cosmetic. Points may only be spent against GOODS, and their
  // ceiling is the goods after the discount. Taking the whole discount off the
  // goods first would leave the delivery fee at its full price while the
  // customer had been promised 20% off everything: on an order paid mostly in
  // points, the two readings end at different totals. In proportion, the
  // delivery fee really is discounted and the points still cannot pay for it.
  //
  // With shipping OUT of the discount — the default, and every coupon written
  // before this — the share is zero and every figure below is what it always was.
  const shippingDiscountAmount = shippingIsDiscountable && discountBase > 0
    ? Math.min(shippingCost, Math.round(discountAmount * (shippingCost / discountBase) * 100) / 100)
    : 0;
  const discountOnGoods = Math.min(rawSubtotal, Math.max(0, discountAmount - shippingDiscountAmount));
  const discountedSubtotal = Math.max(0, rawSubtotal - discountOnGoods);

  // 4.21 and 4.26 — the redemption rate and the minimum are settings now, and
  // both live in src/lib/loyalty.ts with their own tests.
  const loyalty = input.loyalty ?? LOYALTY_DEFAULTS;
  const balance = Math.max(0, input.pointsBalance ?? 0);
  const maxRedeemablePoints = maxRedeemableLoyaltyPoints(balance, discountedSubtotal, loyalty);
  const pointsRedeemed = Math.min(Math.max(0, input.pointsToRedeem ?? 0), maxRedeemablePoints);
  const pointsDiscountAmount = pointsValueSek(pointsRedeemed, loyalty);

  const afterPoints = Math.max(0, discountedSubtotal - pointsDiscountAmount);
  const netTotal = afterPoints + Math.max(0, shippingCost - shippingDiscountAmount);
  const vatAmount = Math.round(netTotal * vatRate * 100) / 100;

  // The GROSS as well as the net: VAT is the only step between them, and a
  // number that survives to here and then becomes Infinity is exactly what this
  // check is for.
  if (!Number.isFinite(netTotal) || netTotal < 0 || !Number.isFinite(vatAmount)) {
    throw new Error('The order total could not be calculated.');
  }

  return {
    rawSubtotal,
    eligibleSubtotal,
    discountAmount,
    uncappedDiscountAmount: uncappedDiscount,
    discountedSubtotal,
    maxRedeemablePoints,
    pointsRedeemed,
    pointsDiscountAmount,
    // The goods, after everything the customer did not pay cash for.
    pointsQualifyingNet: afterPoints,
    shippingCost,
    shippingDiscountAmount,
    netTotal,
    vatAmount,
    grossTotal: netTotal + vatAmount,
  };
}

/**
 * Loyalty points granted for an order.
 *
 * 4.22 — THE BASE IS `pointsQualifyingNet`, not the gross total. It used to be
 * the gross, so the shop paid points on the VAT it collects for the state and on
 * the freight it pays a carrier. Pass `totals.pointsQualifyingNet`.
 */
export function pointsEarnedFor(qualifyingNet: number, loyalty?: LoyaltySettings): number {
  return pointsEarnedOn(qualifyingNet, loyalty ?? LOYALTY_DEFAULTS);
}
