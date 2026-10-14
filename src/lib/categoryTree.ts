// Categories that contain categories.
//
// `Category.parentId` has been stored since round 13 and nothing has ever
// rendered it, so the data is real and unverified — which is exactly the shape
// of data that breaks tree code. Every function here is written to survive it:
//
//   * a parentId pointing at a category that does not exist (deleted, renamed,
//     or typed by hand) — the category is treated as a root rather than lost;
//   * a CYCLE. A → B → A is two ordinary saves apart, and the naive walk up the
//     parents to build a breadcrumb never terminates. Every walk here is bounded
//     and every one refuses to visit a node twice.
//
// It lives apart from the screens because the dashboard tree, the shop's
// breadcrumb and the product filter must agree about what "inside" means, and
// because a tree bug is invisible until the data is deep. See
// scripts/test-category-tree.mjs.

import { compareOwnerOrder } from './ownerOrder.js';

export interface TreeCategory {
  id: string;
  name?: string;
  parentId?: string | null;
  /** The owner's order among its siblings — src/lib/ownerOrder.ts. */
  sortOrder?: unknown;
}

export interface CategoryNode<T extends TreeCategory = TreeCategory> {
  category: T;
  children: CategoryNode<T>[];
  /** 0 for a root, 1 for its children, and so on. */
  depth: number;
}

/** The parent that actually exists. Anything else makes the category a root. */
function realParentId<T extends TreeCategory>(c: T, byId: Map<string, T>): string | null {
  const p = (c.parentId ?? '').toString().trim();
  if (!p || p === c.id) return null;      // a category is never its own parent
  return byId.has(p) ? p : null;          // a dangling parent makes it a root
}

/**
 * The forest, siblings in the owner's order — the ones he arranged first, then
 * the rest by name, which is the order every category had before he could
 * arrange them.
 *
 * A category caught in a cycle appears as a ROOT rather than vanishing. Dropping
 * it would hide products from the dashboard with no explanation of where they
 * went, and the owner cannot fix what he cannot see.
 */
export function buildCategoryTree<T extends TreeCategory>(
  categories: T[],
  /** The name siblings are compared by after his order — the shop passes the visitor's language. */
  nameOf: (c: T) => string = (c) => String(c.name ?? c.id),
): CategoryNode<T>[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];

  for (const c of categories) {
    const parent = realParentId(c, byId);
    if (parent === null) { roots.push(c); continue; }
    // Walk up to check this parent is reachable from a root. A node inside a
    // cycle never reaches one, and is treated as a root so it stays visible.
    const seen = new Set<string>([c.id]);
    let cursor: string | null = parent;
    let inCycle = false;
    while (cursor) {
      if (seen.has(cursor)) { inCycle = true; break; }
      seen.add(cursor);
      const next = byId.get(cursor);
      cursor = next ? realParentId(next, byId) : null;
    }
    if (inCycle) { roots.push(c); continue; }
    const list = childrenOf.get(parent) ?? [];
    list.push(c);
    childrenOf.set(parent, list);
  }

  const byName = (a: T, b: T) => compareOwnerOrder(a, b, (x, y) => nameOf(x).localeCompare(nameOf(y)));
  const build = (c: T, depth: number): CategoryNode<T> => ({
    category: c,
    depth,
    children: (childrenOf.get(c.id) ?? []).sort(byName).map((child) => build(child, depth + 1)),
  });
  return roots.sort(byName).map((c) => build(c, 0));
}

/**
 * A category and everything under it, ids only.
 *
 * This is what "show me this category's products" means once categories nest —
 * D4: a parent leads to all of its descendants' products, not to a list of
 * sub-categories the shopper has to click through again.
 *
 * Always includes the id itself, even when it names nothing: the caller is
 * filtering, and an empty list would mean "no filter" and show the whole shop.
 */
export function descendantIds<T extends TreeCategory>(categories: T[], id: string): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenOf = new Map<string, string[]>();
  for (const c of categories) {
    const parent = realParentId(c, byId);
    if (parent === null) continue;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), c.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;   // a cycle cannot make this loop forever
    seen.add(current);
    out.push(current);
    stack.push(...(childrenOf.get(current) ?? []));
  }
  return out;
}

/**
 * Root → … → this one, for a breadcrumb.
 *
 * Bounded and cycle-safe: the naive version of this is a `while (parent)` loop,
 * and one A → B → A in the data hangs the tab.
 */
export function breadcrumb<T extends TreeCategory>(categories: T[], id: string): T[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const path: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = id;
  while (cursor && byId.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor)!;
    path.unshift(node);
    cursor = realParentId(node, byId);
  }
  return path;
}

/**
 * Would making `parentId` the parent of `id` create a loop?
 *
 * The dashboard has to ask before it saves. Without it, dragging a category
 * under its own child is one click, and the result is a set of categories that
 * cannot be reached from anywhere and products that appear in no tree at all.
 */
export function wouldCycle<T extends TreeCategory>(
  categories: T[],
  id: string,
  parentId: string,
): boolean {
  if (!parentId) return false;
  if (parentId === id) return true;
  // A cycle is created exactly when the proposed parent is already BELOW us.
  return descendantIds(categories, id).includes(parentId);
}

/** Flattened depth-first, which is the order a tree renders in. */
export function flattenTree<T extends TreeCategory>(nodes: CategoryNode<T>[]): CategoryNode<T>[] {
  const out: CategoryNode<T>[] = [];
  const walk = (list: CategoryNode<T>[]) => {
    for (const n of list) { out.push(n); walk(n.children); }
  };
  walk(nodes);
  return out;
}

/**
 * Every category in tree order, each with the indent its label should carry.
 *
 * WHY THIS IS SHARED. A sub-category is only a sub-category if the owner can
 * SEE that it is one. Six screens in the dashboard let him pick a category —
 * the product form, the bulk move bar, the supplier importer, the printing-field
 * targets, the competitor analyser and the category form itself — and five of
 * them printed a flat alphabetical list, so a child and its parent looked
 * identical. He read that as the feature not existing: "Sub Categories ما فعاله".
 *
 * The indent is NON-BREAKING spaces on purpose. A <select> collapses ordinary
 * leading whitespace in an <option>, which is exactly where this matters most.
 */
export function categoryPickList<T extends TreeCategory>(
  categories: T[],
): { category: T; depth: number; indent: string }[] {
  return flattenTree(buildCategoryTree(categories)).map(({ category, depth }) => ({
    category,
    depth,
    indent: depth > 0 ? `${'\u00A0\u00A0'.repeat(depth)}└ ` : '',
  }));
}
