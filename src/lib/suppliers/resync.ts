// What a re-sync is allowed to change, and what it must never touch.
//
// A supplier re-sync runs unattended over hundreds of products the owner has
// since worked on. The plan says it "never touches `isHidden` or `salePrice`,
// with a sanity check refusing any price move beyond ±X % unattended", and both
// halves of that exist because of what the alternative does:
//
//   * `isHidden` is his decision. He imports hidden, reviews, and publishes what
//     he wants. A re-sync that rewrote it would either un-publish his shop or
//     publish the products he had deliberately held back — and he would not know
//     which until a customer found one.
//
//   * `salePrice` is a promise he has made. Overwriting an offer that is running
//     changes the price on a page a customer may be looking at.
//
//   * A price that moves 400% is almost never a price change. It is a feed with
//     a decimal in a different place, a currency field that changed, or a rate
//     typed with a comma. Applying it to four hundred products unattended is how
//     a shop sells a 3 000 kr banner for 30 — and this shop has already had one
//     underpricing incident of exactly that shape.
//
// Pure, and tested in scripts/test-resync.mjs.

export interface ResyncCandidate {
  productId: string;
  /** What the shop charges now. */
  currentPrice: number | null;
  /** What the feed says it should charge, already converted and marked up. */
  nextPrice: number | null;
}

export type ResyncOutcome =
  | { productId: string; action: 'update'; from: number; to: number; movePercent: number }
  | { productId: string; action: 'unchanged'; price: number }
  | { productId: string; action: 'skipped'; reason: string; from?: number; to?: number; movePercent?: number };

export interface ResyncPlan {
  updates: { productId: string; price: number }[];
  outcomes: ResyncOutcome[];
  /** Every price move the guard refused, for a human to look at. */
  refused: ResyncOutcome[];
}

/** How far a price moved, as a percentage of where it was. */
export function movePercent(from: number, to: number): number {
  if (!Number.isFinite(from) || from <= 0) return Infinity;
  return ((to - from) / from) * 100;
}

/**
 * @param maxMovePercent the most a price may move in either direction. 0 means
 *   "change nothing" — an explicit dry run — and is honoured rather than treated
 *   as "no limit", which is the mistake a falsy check would make.
 */
export function planResync(
  candidates: ResyncCandidate[],
  maxMovePercent: number,
): ResyncPlan {
  const limit = Number.isFinite(maxMovePercent) && maxMovePercent >= 0 ? maxMovePercent : 25;
  const outcomes: ResyncOutcome[] = [];
  const updates: { productId: string; price: number }[] = [];

  for (const c of candidates) {
    const to = c.nextPrice;
    const from = c.currentPrice;

    if (typeof to !== 'number' || !(to > 0)) {
      // The feed no longer prices it. That is NOT a reason to zero the shop's
      // price — it is a reason to leave it and tell somebody.
      outcomes.push({ productId: c.productId, action: 'skipped', reason: 'the supplier no longer prices it' });
      continue;
    }
    if (typeof from !== 'number' || !(from > 0)) {
      // Nothing to compare against, so the guard cannot protect anything. Taking
      // the feed's price here is the only sensible answer.
      updates.push({ productId: c.productId, price: to });
      outcomes.push({ productId: c.productId, action: 'update', from: 0, to, movePercent: Infinity });
      continue;
    }
    if (from === to) {
      outcomes.push({ productId: c.productId, action: 'unchanged', price: to });
      continue;
    }

    const move = movePercent(from, to);
    if (Math.abs(move) > limit) {
      outcomes.push({
        productId: c.productId,
        action: 'skipped',
        reason: `the price would move ${move > 0 ? '+' : ''}${move.toFixed(1)}%, past the ${limit}% limit`,
        from, to, movePercent: move,
      });
      continue;
    }
    updates.push({ productId: c.productId, price: to });
    outcomes.push({ productId: c.productId, action: 'update', from, to, movePercent: move });
  }

  return {
    updates,
    outcomes,
    refused: outcomes.filter((o) => o.action === 'skipped' && typeof (o as any).movePercent === 'number'),
  };
}

/**
 * The fields a re-sync may write. Named rather than described, so the rule is
 * enforceable and a future field cannot join the list by accident.
 *
 * `isHidden` and `salePrice` are absent on purpose. So is `categoryId`: he moves
 * products between categories and a feed re-import must not move them back.
 */
export const RESYNC_WRITABLE_FIELDS = [
  'basePrice',
  'nameI18n',
  'descriptionI18n',
  'images',
  'supplierName',
  'supplierOfferId',
  'importedAt',
  'updatedAt',
] as const;

/** Strip anything the re-sync is not allowed to write. */
export function forResync<T extends Record<string, any>>(product: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const key of RESYNC_WRITABLE_FIELDS) {
    if (product[key] !== undefined) out[key] = product[key];
  }
  return out as Partial<T>;
}

/**
 * WHAT A RE-IMPORT MAY WRITE onto a product that is already in the shop — DAT-01.
 *
 * Importing a product a second time (the obvious way to refresh its price) wrote
 * the WHOLE new document over it with merge: the name, the category he had moved
 * it to, isHidden from the picker's "import hidden" (taking it out of the shop),
 * salePrice null (ending his offer), options and printing fields emptied, and a
 * new slug — `<slug>-2`, because its own was counted as taken — so the address
 * customers and Google knew stopped answering.
 *
 * Now the re-sync's rule (forResync): the price, the translations, the supplier's
 * references, and updatedAt. Two things fewer:
 *   - not the PICTURES. He replaces the feed's photos with his own in the product
 *     editor, and pictures moved to the shop's own storage would be pointed back
 *     at the supplier's server — one press and his work is gone, with nothing on
 *     screen to say so. A product's pictures are his once it is in the shop.
 *   - not a translation the feed does NOT have. A feed without one sends null, and
 *     null written over the names he typed by hand would erase them.
 * A product NEW to the shop is imported whole, as it always was.
 */
export function forReimport<T extends Record<string, any>>(product: T, nowIso: string): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(forResync(product))) {
    if (key === 'images' || value === null) continue;
    out[key] = value;
  }
  out.updatedAt = nowIso;
  return out;
}
