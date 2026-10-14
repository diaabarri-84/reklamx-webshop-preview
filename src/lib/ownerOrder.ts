/**
 * THE OWNER'S ORDER — for categories and for the products on a category page.
 *
 * Until 2026-10 the shop had no order of its own: categories and products were
 * listed alphabetically, everywhere, and nothing in the dashboard could change
 * it. "هو اللي يتحكم في ترتيب المنتجات" — he drags them into the order he wants.
 *
 * Two shapes, chosen so that arranging writes as little as possible:
 *
 *   Category.sortOrder     a number per category. Dragging siblings writes only
 *                          those siblings. Categories without one come after the
 *                          ones that have one, by name — exactly the old order,
 *                          so nothing moves until he arranges something.
 *
 *   Category.productOrder  the product ids of ONE category page, in his order.
 *                          One document written per arrangement, however many
 *                          products — never a write to every product. Products
 *                          not in the list follow, in the order they already had
 *                          (by name), so a product added later simply appears
 *                          after his arranged ones.
 *
 * Pure: the server sorts with it, the home page and the dashboard sort with it,
 * and scripts/test-owner-order.mjs asserts it.
 */

/** A finite sortOrder, or +Infinity for "not arranged". */
export function sortOrderValue(item: { sortOrder?: unknown } | null | undefined): number {
  const n = Number(item?.sortOrder);
  return item?.sortOrder !== null && item?.sortOrder !== undefined && item?.sortOrder !== '' && Number.isFinite(n)
    ? n
    : Number.POSITIVE_INFINITY;
}

/** His order first; the tie-breaker (normally the name) for the rest and for ties. */
export function compareOwnerOrder<T extends { sortOrder?: unknown }>(
  a: T,
  b: T,
  tieBreak: (a: T, b: T) => number,
): number {
  const x = sortOrderValue(a);
  const y = sortOrderValue(b);
  if (x !== y) return x < y ? -1 : 1;
  return tieBreak(a, b);
}

/** The sortOrder values to write after a drag: 10, 20, 30… leaving room between. */
export function sortOrdersFor(orderedIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  orderedIds.forEach((id, i) => {
    if (!(id in out)) out[id] = (i + 1) * 10;
  });
  return out;
}

/** id → position in his list. Ids repeated in the list keep their first place. */
export function rankMap(orderIds: unknown): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(orderIds)) return map;
  orderIds.forEach((id, i) => {
    const key = String(id ?? '');
    if (key && !map.has(key)) map.set(key, i);
  });
  return map;
}

/**
 * `items` in his order: the ones named in `orderIds` first, in that order, then
 * every other item in the order it came in. Stable, and never drops an item.
 */
export function orderByIdList<T extends { id?: unknown }>(items: T[], orderIds: unknown): T[] {
  const ranks = rankMap(orderIds);
  if (ranks.size === 0) return items;
  return items
    .map((item, index) => ({ item, index, rank: ranks.get(String(item.id)) }))
    .sort((a, b) => {
      const ra = a.rank ?? Number.POSITIVE_INFINITY;
      const rb = b.rank ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra < rb ? -1 : 1;
      return a.index - b.index;
    })
    .map((x) => x.item);
}

/**
 * Where the next page of a list starts, given the cursor the previous page
 * handed out (the last item it served: id `i`, name `n`, and on an arranged
 * page its rank `r`).
 *
 * Normally just "after that item". If that item is gone — hidden, deleted,
 * moved out of the category — it falls back to the item's SORT POSITION, so a
 * shopper scrolling a long category carries on from roughly where he was
 * instead of being sent back to the top: on an arranged page that position is
 * his rank first, then the name among the products he never arranged.
 */
export function pageStartAfter<T extends { id?: unknown; name?: unknown }>(
  list: T[],
  cursor: { i: string; n: string; r?: number } | null,
  ranks: Map<string, number> | null,
): number {
  if (!cursor) return 0;
  const at = list.findIndex((p) => String(p.id) === cursor.i);
  if (at !== -1) return at + 1;
  const rankOf = (p: T) => ranks?.get(String(p.id)) ?? Number.POSITIVE_INFINITY;
  const cursorRank = typeof cursor.r === 'number' && Number.isFinite(cursor.r) ? cursor.r : Number.POSITIVE_INFINITY;
  const from = list.findIndex((p) => {
    const r = rankOf(p);
    if (r !== cursorRank) return r > cursorRank;
    return String(p.name ?? '').localeCompare(cursor.n) > 0;
  });
  return from === -1 ? list.length : from;
}
