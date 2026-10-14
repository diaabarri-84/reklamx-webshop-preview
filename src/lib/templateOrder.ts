/**
 * THE OWNER'S ORDER OF EVERY DESIGN — his templates and the shop's own, one list
 * (designer v2; his decision of 2026-10-07: "he decides who shows first, moves them
 * as he likes"). Saved by his drag in the dashboard as settings.designTemplateOrder;
 * the dashboard's list and the customer's gallery both read it through this, so the
 * two can never disagree.
 *
 * A DESIGN THE ORDER HAS NOT SEEN IS NEWER THAN IT. Ranked "after everything", his
 * new template went below all sixteen of the shop's designs — in his list and in the
 * gallery — the moment he had ever arranged them once. His own new template now
 * comes FIRST (he has just made it; he finds it at the top and drags it where he
 * wants), and one of the shop's own the order has never seen (a new one in an
 * update) comes LAST, so his arrangement stands. Unseen items keep the order they
 * came in. Pure; scripts/test-template-order.mjs.
 */
export function inOwnerOrder<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  isOwn: (item: T) => boolean,
  order: readonly string[] | null | undefined,
): T[] {
  const rank = new Map((order ?? []).map((id, i) => [id, i]));
  const key = (item: T, i: number) => {
    const r = rank.get(idOf(item));
    if (r !== undefined) return r;
    return isOwn(item) ? -1_000_000 + i : 1_000_000 + i;
  };
  return items
    .map((item, i) => ({ item, k: key(item, i) }))
    .sort((a, b) => a.k - b.k)
    .map(({ item }) => item);
}

/** One design a customer may start from: one of his templates, or one of the shop's own. */
export type OfferedDesign<TTemplate extends { id: string; sortOrder?: number }, TStarter extends { id: string }> =
  | { type: 'shop'; id: string; summary: TTemplate }
  | { type: 'starter'; id: string; def: TStarter };

/**
 * THE DESIGNS A CUSTOMER IS OFFERED on a product — in the gallery AND in the studio's
 * Designs panel, from this one function so the two can never disagree: his templates
 * that fit this size and cut, the shop's own for this kind of product (unless he
 * switched them off), none he hid, in his order. (The studio's panel listed every
 * starter for the kind in its built-in order, hidden or switched off or not.)
 */
export function offeredDesigns<TTemplate extends { id: string; sortOrder?: number }, TStarter extends { id: string }>(input: {
  templates: readonly TTemplate[] | null | undefined;
  fits: (template: TTemplate) => boolean;
  /** The shop's own designs for this kind of product (startersFor(kind)). */
  starters: readonly TStarter[];
  /** His switch "Also offer the shop's own ready-made designs" (settings.designerBasicLayouts !== false). */
  startersOn: boolean;
  hidden: readonly string[] | null | undefined;
  order: readonly string[] | null | undefined;
}): OfferedDesign<TTemplate, TStarter>[] {
  const hide = new Set(input.hidden ?? []);
  const shop: OfferedDesign<TTemplate, TStarter>[] = (input.templates ?? [])
    .filter((x) => input.fits(x))
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((summary) => ({ type: 'shop' as const, id: summary.id, summary }));
  const starters: OfferedDesign<TTemplate, TStarter>[] = input.startersOn
    ? input.starters.map((def) => ({ type: 'starter' as const, id: def.id, def }))
    : [];
  return inOwnerOrder(
    [...shop, ...starters].filter((d) => !hide.has(d.id)),
    (d) => d.id,
    (d) => d.type === 'shop',
    input.order,
  );
}
