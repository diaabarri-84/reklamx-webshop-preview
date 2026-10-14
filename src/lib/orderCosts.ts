// What an order cost us, computed from the trade figures stored per product.
//
// It lives here, away from server.ts, because it is money: the numbers it
// produces are what any margin figure is built on, and a rule that cannot be
// tested is a rule nobody has checked. See scripts/test-order-costs.mjs.
//
// Nothing here reads or writes anything. It is given the order's lines and the
// cost records that were found, and it decides what can honestly be said.

export interface CostRecord {
  sourcePrice?: unknown;
  sourceCurrency?: unknown;
  sourceRate?: unknown;
  supplier?: unknown;
}

export interface CostLine {
  productId: string | null;
  quantity: number;
  /** Present only when the cost is actually known. */
  sourcePrice?: number;
  sourceCurrency?: string;
  sourceRate?: number;
  unitCost?: number;
  lineCost?: number;
  supplier?: string | null;
  /** Present, and false, only when it is not. */
  costKnown?: false;
}

export interface CostSnapshot {
  lines: CostLine[];
  goodsCost: number;
  linesWithCost: number;
  lineCount: number;
  /** False when any line's cost is unknown — a total that hides that is a lie. */
  complete: boolean;
}

/** Money, to the öre. Anything else accumulates float dust across a year of orders. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Is there a real trade price here?
 *
 * A product the owner built himself has no cost record, and NEITHER DOES a
 * zero: writing 0 would make every one of his own products read as pure profit
 * in any margin report, which is the most flattering possible lie and the one
 * hardest to notice. A rate of 0 is the same trap wearing different clothes —
 * it produces a cost of 0 from a perfectly real trade price.
 */
function costIsKnown(c: CostRecord | null | undefined): c is CostRecord {
  if (!c) return false;
  const source = Number(c.sourcePrice);
  const rate = Number(c.sourceRate);
  return Number.isFinite(source) && source >= 0 && Number.isFinite(rate) && rate > 0;
}

export function buildCostSnapshot(
  items: { productId?: unknown; quantity?: unknown }[],
  costById: Map<string, CostRecord>,
): CostSnapshot {
  const lines: CostLine[] = (items ?? []).map((item) => {
    const productId = String(item?.productId ?? '').trim();
    // Floor, not round: half a unit was never sold, and a fractional quantity
    // arriving from anywhere is a bug that must not silently inflate a cost.
    const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
    const c = productId ? costById.get(productId) : null;

    if (!costIsKnown(c)) {
      return { productId: productId || null, quantity, costKnown: false as const };
    }
    const source = Number(c.sourcePrice);
    const rate = Number(c.sourceRate);
    const unitCost = round2(source * rate);
    return {
      productId: productId || null,
      quantity,
      sourcePrice: source,
      sourceCurrency: typeof c.sourceCurrency === 'string' && c.sourceCurrency ? c.sourceCurrency : 'EUR',
      sourceRate: rate,
      unitCost,
      // From the UNROUNDED unit cost times quantity, then rounded once. Rounding
      // the unit first and multiplying turns a half-öre into up to a krona of
      // drift on a run of two hundred.
      lineCost: round2(source * rate * quantity),
      supplier: typeof c.supplier === 'string' ? c.supplier : null,
    };
  });

  const linesWithCost = lines.filter((l) => typeof l.unitCost === 'number').length;
  return {
    lines,
    goodsCost: round2(lines.reduce((sum, l) => sum + (l.lineCost ?? 0), 0)),
    linesWithCost,
    lineCount: lines.length,
    complete: lines.length > 0 && linesWithCost === lines.length,
  };
}
