/**
 * THE PRODUCT PAGE IN HIS ORDER — every row of it, not only the properties.
 *
 * "ما قادر اتحكم فيها جميعها" (2026-10-05, the client, under a screenshot of
 * his mesh banner): he could drag the properties and the quantity table, but
 * the size calculator, the artwork box and the delivery time stayed nailed
 * below them, so "width × height" could never come before "material". Each of
 * them is a row now, in the one list he drags:
 *
 *   Product.pageOrder   the page's rows, top to bottom: property ids and the
 *                       block ids below. Absent: the layout every product has
 *                       always had (defaultPageRows), so nothing moves until he
 *                       arranges something.
 *
 * The order of `printingFields` and `quantityAfterFieldId` are still written
 * alongside it, so everything that read them before reads the same answer.
 *
 * Pure — the product page and the dashboard both use it (pageRowsOf is the ONE
 * rule for which rows exist), and scripts/test-page-order.mjs asserts it.
 */

import type { PrintingField } from '../types/index.js';
import { withoutUnavailableOptions } from './optionAvailability.js';
import { QUANTITY_AT_TOP } from './optionTree.js';

export const PAGE_BLOCKS = {
  quantity: '__quantity__',
  size: '__size__',
  artwork: '__artwork__',
  delivery: '__delivery__',
} as const;

export type PageBlockId = (typeof PAGE_BLOCKS)[keyof typeof PAGE_BLOCKS];

const BLOCK_IDS: readonly string[] = Object.values(PAGE_BLOCKS);

export function isPageBlock(id: string): id is PageBlockId {
  return BLOCK_IDS.includes(id);
}

/**
 * The page as it has always been laid out: the properties in their order, then
 * the size calculator, the artwork box, the quantity table and the delivery
 * time — the quantity table wherever `quantityAfterFieldId` put it. Only the
 * blocks this product shows.
 */
export function defaultPageRows(
  fieldIds: readonly string[],
  opts: {
    quantityAnchor?: string | null;
    /** The anchor value meaning "above every property" (optionTree's QUANTITY_AT_TOP). */
    quantityAtTop: string;
    size: boolean;
    artwork: boolean;
    delivery: boolean;
  },
): string[] {
  const anchor = opts.quantityAnchor ?? null;
  const atTop = anchor === opts.quantityAtTop;
  const afterField = anchor && !atTop && fieldIds.includes(anchor) ? anchor : null;
  const rows: string[] = [];
  if (atTop) rows.push(PAGE_BLOCKS.quantity);
  for (const id of fieldIds) {
    rows.push(id);
    if (id === afterField) rows.push(PAGE_BLOCKS.quantity);
  }
  if (opts.size) rows.push(PAGE_BLOCKS.size);
  if (opts.artwork) rows.push(PAGE_BLOCKS.artwork);
  if (!atTop && !afterField) rows.push(PAGE_BLOCKS.quantity);
  if (opts.delivery) rows.push(PAGE_BLOCKS.delivery);
  return rows;
}

/**
 * `primary` in its own order, then every id of `secondary` that `primary` does
 * not hold, put back between the two rows it sits between in `secondary`:
 * straight BEFORE the row that follows it there, as long as that row still
 * comes after the one before it; otherwise straight after the one before it.
 * Never drops an id of either, never repeats one.
 *
 * Why before the next row rather than after the previous one: he dragged the
 * size calculator to the top of a banner, then ticked the artwork box on — by
 * default it follows the size calculator, and "after its predecessor" put the
 * upload box second on the page, above every property. Before the quantity
 * table, which it also precedes by default, is where anybody would put it; and
 * a property added at the end lands after his last property, not between two.
 */
export function interleave(primary: readonly string[], secondary: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of primary) if (!out.includes(id)) out.push(id);
  secondary.forEach((id, i) => {
    if (out.includes(id)) return;
    let before = -1;
    for (let j = i - 1; j >= 0 && before < 0; j -= 1) before = out.indexOf(secondary[j]);
    let after = -1;
    for (let j = i + 1; j < secondary.length && after < 0; j += 1) after = out.indexOf(secondary[j]);
    if (after >= 0 && after > before) out.splice(after, 0, id);
    else if (before >= 0) out.splice(before + 1, 0, id);
    else out.push(id);
  });
  return out;
}

function cleanIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];
}

/**
 * The rows this product shows today (`rows`, from defaultPageRows), in his
 * order (`owner`, Product.pageOrder). A row he never placed — a property
 * switched on since, the artwork box turned on later — comes straight after the
 * row it follows by default; a row that is gone (switched off, deleted) is
 * skipped.
 */
export function arrangePageRows(rows: readonly string[], owner: unknown): string[] {
  const placed = cleanIds(owner).filter((id) => rows.includes(id));
  if (placed.length === 0) return [...rows];
  return interleave(placed, rows);
}

/**
 * What to store after he drags the rows on screen into `visible`: that order,
 * with every row he placed EARLIER but cannot see now — the artwork box while
 * it is switched off, a property switched off — kept after the row it followed,
 * so switching it back on puts it back where he left it.
 */
export function rememberPageOrder(visible: readonly string[], previous: unknown): string[] {
  return interleave(visible, cleanIds(previous));
}

/** The two catalogue questions the page draws as blocks of their own, not as rows. */
export const DELIVERY_FIELD_ID = 'production_delivery_speed';
export const ARTWORK_METHOD_FIELD_ID = 'artwork_supply_method';

/**
 * THE ROWS THE PRODUCT PAGE DRAWS, in his order — the one rule the page and the
 * dashboard's "Order on the product page" both use, so the list he drags is
 * exactly what a customer sees. A property whose every option is hidden is not
 * a row; the delivery time with every speed hidden is not one either.
 */
export function pageRowsOf(product: {
  printingFields?: PrintingField[] | null;
  /** customUploadRules.areaPriced — the size calculator. */
  areaPriced: boolean;
  /** artworkBoxShown(product) — the upload box. */
  artworkShown: boolean;
  quantityAfterFieldId?: string | null;
  pageOrder?: unknown;
}): string[] {
  const active = withoutUnavailableOptions((product.printingFields ?? []).filter((f) => f?.enabled));
  const delivery = active.find((f) => f.id === DELIVERY_FIELD_ID);
  const fieldIds = active.filter((f) => f.id !== DELIVERY_FIELD_ID && f.id !== ARTWORK_METHOD_FIELD_ID).map((f) => f.id);
  return arrangePageRows(
    defaultPageRows(fieldIds, {
      quantityAnchor: product.quantityAfterFieldId,
      quantityAtTop: QUANTITY_AT_TOP,
      size: product.areaPriced && !active.some((f) => f.allowCustomSize),
      artwork: product.artworkShown,
      delivery: (delivery?.options?.length ?? 0) > 0,
    }),
    product.pageOrder,
  );
}

/**
 * What a drop — or an arrow — in "Order on the product page" writes, so every
 * reader of the product agrees with the page:
 *  - `pageOrder`: the rows in his order, remembering the rows he placed earlier
 *    that are not on screen now (the artwork box while it is off, a property
 *    switched off);
 *  - `fieldOrder`: the properties in that same order, switched-off ones
 *    included — printingFields follows it, so a property switched off and on
 *    again comes back to ONE place, not one in each list;
 *  - `quantityAnchor`: the property the quantity table follows, as the page
 *    read it before pageOrder: QUANTITY_AT_TOP when no property is above it,
 *    undefined when it is below every property. The blocks do not count.
 */
export function pageOrderAfterDrop(
  visibleRows: readonly string[],
  previous: unknown,
): { pageOrder: string[]; fieldOrder: string[]; quantityAnchor: string | undefined } {
  const pageOrder = rememberPageOrder(visibleRows, previous);
  const fieldOrder = pageOrder.filter((id) => !isPageBlock(id));
  const fieldsAndQuantity = visibleRows.filter((id) => !isPageBlock(id) || id === PAGE_BLOCKS.quantity);
  const at = fieldsAndQuantity.indexOf(PAGE_BLOCKS.quantity);
  const quantityAnchor =
    at < 0 || at === fieldsAndQuantity.length - 1 ? undefined : at === 0 ? QUANTITY_AT_TOP : fieldsAndQuantity[at - 1];
  return { pageOrder, fieldOrder, quantityAnchor };
}

/**
 * "Replace everything with the library" on a page he arranged: the PROPERTIES
 * take the library's order (`fieldOrder`, the product's new printingFields
 * order), each block keeps its row. A property the library removed leaves its
 * row; one it added is placed by arrangePageRows like any he never placed.
 * Null when there is no arrangement to keep.
 */
export function withFieldOrder(pageOrder: unknown, fieldOrder: readonly string[]): string[] | null {
  const order = cleanIds(pageOrder);
  if (order.length === 0) return null;
  const named = new Set(order.filter((id) => !isPageBlock(id)));
  const properties = fieldOrder.filter((id) => named.has(id));
  let k = 0;
  const out: string[] = [];
  for (const id of order) {
    if (isPageBlock(id)) out.push(id);
    else if (k < properties.length) out.push(properties[k++]);
  }
  return out;
}

/** What is worth storing: blocks, and properties the product still has. */
export function prunePageOrder(pageOrder: unknown, fieldIds: readonly string[]): string[] | null {
  const order = cleanIds(pageOrder).filter((id) => isPageBlock(id) || fieldIds.includes(id));
  return order.length > 0 ? [...new Set(order)] : null;
}
