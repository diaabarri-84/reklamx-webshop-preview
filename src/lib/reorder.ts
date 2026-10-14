/**
 * THE ARITHMETIC OF A DRAG, kept out of React so it can be tested.
 *
 * A drag hands back "these ids, in this order". Turning that into the array that
 * gets saved has two traps, and both lose or scramble data silently:
 *
 *  1. The list on screen is often a SUBSET of the array. A product's page-order
 *     list shows only the properties that are switched on — the switched-off
 *     ones are still in `printingFields`, with whatever the owner edited on
 *     them. Rebuilding the array from the screen would delete them.
 *  2. The screen can contain something that is not in the array at all — the
 *     quantity table is a row in the page-order list, but it is stored as "the
 *     field it follows", not as an element.
 *
 * Nothing here ever drops an element it was given.
 */

/** Put `items` in the order of `orderedIds`; anything not named keeps its relative place at the end. */
export function reorderById<T extends { id: string }>(items: T[], orderedIds: string[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  const placed = new Set<string>();
  const out: T[] = [];
  for (const id of orderedIds) {
    const item = byId.get(id);
    if (item && !placed.has(id)) {
      out.push(item);
      placed.add(id);
    }
  }
  for (const item of items) {
    if (!placed.has(item.id)) out.push(item);
  }
  return out;
}

/**
 * Reorder only the elements a list on screen showed, leaving every other element
 * exactly where it was.
 *
 * The members occupy the same SLOTS in the array as before; they are simply
 * dealt into those slots in the new order. So a switched-off property that sat
 * between two switched-on ones is still between the same two positions, and
 * switching it back on later puts it back where the owner last saw it.
 */
export function reorderSubset<T extends { id: string }>(
  items: T[],
  isMember: (item: T) => boolean,
  orderedMemberIds: string[],
): T[] {
  const slots: number[] = [];
  const members: T[] = [];
  items.forEach((item, i) => {
    if (isMember(item)) {
      slots.push(i);
      members.push(item);
    }
  });
  const ordered = reorderById(members, orderedMemberIds);
  const out = [...items];
  slots.forEach((slot, k) => {
    out[slot] = ordered[k];
  });
  return out;
}

/**
 * Where the quantity table now sits, given the page-order list after a drag.
 *
 * Stored as the id of the field it follows (Product.quantityAfterFieldId):
 * `atTop` when it is first, `undefined` when it is last (the layout every
 * product had before this existed), otherwise the field just above it.
 */
export function quantityAnchorFromOrder(
  orderedIds: string[],
  quantityRowId: string,
  atTop: string,
): string | undefined {
  const at = orderedIds.indexOf(quantityRowId);
  if (at < 0 || at === orderedIds.length - 1) return undefined;
  if (at === 0) return atTop;
  return orderedIds[at - 1];
}

/**
 * For lists of plain values (image URLs, feature lines) that have no id of their
 * own: the screen names each row by its index (`img-0`, `img-1` …) and this
 * deals the values back out in the dragged order. Duplicate values are fine —
 * the index, not the value, is the identity — and nothing is ever dropped.
 */
export function reorderByIndexIds<T>(list: T[], orderedIds: string[], prefix: string): T[] {
  const out: T[] = [];
  const used = new Set<number>();
  for (const id of orderedIds) {
    if (!id.startsWith(prefix)) continue;
    const i = Number(id.slice(prefix.length));
    if (Number.isInteger(i) && i >= 0 && i < list.length && !used.has(i)) {
      out.push(list[i]);
      used.add(i);
    }
  }
  list.forEach((value, i) => {
    if (!used.has(i)) out.push(value);
  });
  return out;
}

/** A short, stable fingerprint of a string (FNV-1a) — not security, just identity. */
function fingerprint(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Ids for a list of plain values that STAY WITH THE VALUE when it moves —
 * `${prefix}<fingerprint>-<n>` for the n-th occurrence of that value.
 *
 * Index ids (`img-0`, `img-1` …) were correct for the saved order but made the
 * drop animation slide the wrong tiles: after a drop "img-0" was suddenly a
 * different photo. Duplicates still get distinct ids by their occurrence.
 */
export function valueIds(list: unknown[], prefix: string): string[] {
  const seen = new Map<string, number>();
  return list.map((value) => {
    const fp = fingerprint(String(value));
    const n = seen.get(fp) ?? 0;
    seen.set(fp, n + 1);
    return `${prefix}${fp}-${n}`;
  });
}

/** `list` in the order of ids made by valueIds(list, prefix). Never drops a value. */
export function reorderByValueIds<T>(list: T[], orderedIds: string[], prefix: string): T[] {
  const ids = valueIds(list, prefix);
  const at = new Map(ids.map((id, i) => [id, i]));
  const used = new Set<number>();
  const out: T[] = [];
  for (const id of orderedIds) {
    const i = at.get(id);
    if (i !== undefined && !used.has(i)) {
      out.push(list[i]);
      used.add(i);
    }
  }
  list.forEach((value, i) => {
    if (!used.has(i)) out.push(value);
  });
  return out;
}
