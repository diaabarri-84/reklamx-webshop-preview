// The quantity price ladder: "100 st → 7,13 kr/st → 713,42 kr → −50 %".
//
// WHY THIS FILE EXISTS
// The shop already knew how to price ONE configuration (lib/pricing.ts). What it
// never showed was the shape of the curve — that ordering ten times as many makes
// each piece a third of the price. Every print shop the client compared us to puts
// that table on the product page, and it is the single thing he asked for by name.
//
// Nothing here invents a price. Every row calls calcConfiguredItemPrice with the
// same inputs the configurator uses, changing only the quantity, so a ladder row
// and the sticky total can never disagree — and the server, which re-prices from
// the product document with that same function, agrees with both.

import { calcConfiguredItemPrice, ConfiguredItemInput } from './pricing';

export interface QuantityLadderRow {
  quantity: number;
  /** Net price per piece at this quantity, setup fee amortised across the run. */
  unitPrice: number;
  /** Net line total: unit price × quantity, setup fee included. */
  total: number;
  /** Price per piece at the SMALLEST run the shop sells — what the saving is measured against. */
  listUnitPrice: number;
  /** 0–100. How much cheaper one piece is here than in that smallest run. */
  savingsPercent: number;
  /** Marks the best-value step; the page badges it. */
  recommended?: boolean;
}

/**
 * Quantity steps a print buyer actually orders. Runs are quoted in round numbers,
 * so the ladder offers round numbers — 250 and 500, never 237 and 474.
 */
const PRESET_STEPS = [
  1, 2, 3, 4, 5, 10, 15, 20, 25, 30, 50, 75, 100, 150, 200, 250, 500, 750,
  1000, 1500, 2000, 2500, 5000, 10000, 25000, 50000,
];

/** Rows beyond this and the table stops being a comparison and becomes a list. */
const MAX_ROWS = 9;

/**
 * Thin a sorted list down to `limit` entries, always keeping the first and the
 * last and spreading the rest evenly across what is left. Picking "every other
 * one" instead would drop the whole tail of a long ladder.
 */
function thin(values: number[], limit: number): number[] {
  if (values.length <= limit) return values;
  const kept: number[] = [];
  const stride = (values.length - 1) / (limit - 1);
  for (let i = 0; i < limit; i++) kept.push(values[Math.round(i * stride)]);
  return Array.from(new Set(kept));
}

/**
 * The quantities a product's ladder should show: its minimum, every volume-discount
 * threshold it defines (those are the steps where the price visibly drops, so
 * hiding them would make the table look arbitrary), a spread of round numbers in
 * between, and — always — the quantity the shopper currently has configured, so the
 * highlighted row is never missing from the table they are looking at.
 */
export function ladderQuantities(options: {
  minQuantity?: number;
  maxQuantity?: number;
  volumeDiscounts?: { minQuantity: number; discountPercentage: number }[];
  currentQuantity?: number;
  maxRows?: number;
}): number[] {
  const min = Math.max(1, Math.floor(options.minQuantity || 1));
  // A maximum of 0 or a maximum below the minimum is bad data from the dashboard,
  // not an instruction to show nothing.
  const rawMax = Math.floor(options.maxQuantity || 0);
  const max = rawMax > min ? rawMax : min * 1000;

  const thresholds = (options.volumeDiscounts ?? [])
    .map((t) => Math.floor(t.minQuantity))
    .filter((q) => q > min && q <= max);

  const presets = PRESET_STEPS.filter((q) => q > min && q <= max);

  // Thresholds are kept whole; only the filler presets are thinned, so a product
  // with five discount tiers still shows all five.
  const limit = Math.max(2, (options.maxRows ?? MAX_ROWS) - thresholds.length - 1);
  const spread = thin(
    presets.filter((q) => !thresholds.includes(q)),
    limit,
  );

  const current = Math.floor(options.currentQuantity || 0);
  const all = new Set<number>([min, ...thresholds, ...spread]);
  if (current >= min && current <= max) all.add(current);

  return [...all].sort((a, b) => a - b);
}

/**
 * Price every step of the ladder. `input` is the configuration as it stands —
 * base price, chosen options, size — with its quantity ignored: each row supplies
 * its own.
 */
export function buildQuantityLadder(
  input: Omit<ConfiguredItemInput, 'quantity'>,
  quantities: number[],
): QuantityLadderRow[] {
  // The saving is measured against the SMALLEST run this product is sold in —
  // not against a run of one.
  //
  // Measuring against one looked more impressive and was a lie by arithmetic: the
  // setup fee is charged once per line, so on a 36 kr bottle with a 650 kr setup
  // a single piece "costs" 686 kr and every real row then advertised −85 % to
  // −97 % off a price the shop will not sell at (the minimum order is ten).
  // Against the minimum, the first row honestly shows no saving and the rest show
  // what the shopper actually gains by ordering more.
  const baseQuantity = quantities.length > 0 ? Math.min(...quantities) : 1;
  const smallestRun = calcConfiguredItemPrice({ ...input, quantity: baseQuantity });
  const listUnitPrice = smallestRun.totalPrice / Math.max(1, baseQuantity);

  const rows: QuantityLadderRow[] = quantities.map((quantity) => {
    const priced = calcConfiguredItemPrice({ ...input, quantity });
    const unitPrice = priced.totalPrice / quantity;
    const savingsPercent =
      listUnitPrice > 0 ? Math.round((1 - unitPrice / listUnitPrice) * 100) : 0;
    return {
      quantity,
      unitPrice,
      total: priced.totalPrice,
      listUnitPrice,
      // A negative saving is arithmetically possible if an owner ever configures a
      // negative discount tier; showing "−0 %" is quieter than showing "+3 %".
      savingsPercent: Math.max(0, savingsPercent),
    };
  });

  // Badge the step where the curve stops paying: the largest saving that is still
  // within two points of the best one on the table. Recommending the very last row
  // would just be recommending "buy the most", which is not advice.
  const best = rows.reduce((a, b) => (b.savingsPercent > a.savingsPercent ? b : a), rows[0]);
  if (best && best.savingsPercent > 0) {
    const knee = rows.find((r) => r.savingsPercent >= best.savingsPercent - 2);
    if (knee) knee.recommended = true;
  }

  return rows;
}
