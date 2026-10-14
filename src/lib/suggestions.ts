// SUGGESTED PRODUCTS under a product (round 16, item 10) — the owner decides
// what is suggested.
//
// One rule, in one place: the server answers /api/catalogue/suggestions with it
// from the catalogue copy it already holds — and never starts a Firestore read
// for it, on a free plan whose daily read quota has taken the shop down three
// times — and scripts/test-suggestions.mjs asserts it.
//
//   1. HIS PICKS (Product.relatedProductIds — the page sends them), in the order
//      he dragged them into, as long as they are still in the shop: a hidden or
//      deleted product is skipped, never shown.
//   2. Fewer than four, and the shop may fill up (UI Customizer → Page Sections): the products
//      AFTER this one on its category's page — in the order he arranged that
//      page — wrapping round to the start, so neighbouring products suggest
//      different things rather than every product its category's first four;
//      and only if that is still short, the rest of the parent category.
//   3. Never the product itself, never one product twice.

import { descendantIds, type TreeCategory } from './categoryTree.js';
import { orderByIdList } from './ownerOrder.js';

/** How many cards the row shows — one row on a desktop, two on a phone. */
export const SUGGESTION_COUNT = 4;

/**
 * His one setting (UI Customizer → Page Sections): no row, only his picks, or his picks
 * and then the category. A shop that never saved it fills from the category.
 */
export type SuggestionMode = 'off' | 'picks' | 'fill';
export const DEFAULT_SUGGESTION_MODE: SuggestionMode = 'fill';

export function suggestionModeOf(raw: unknown): SuggestionMode {
  return raw === 'off' || raw === 'picks' || raw === 'fill' ? raw : DEFAULT_SUGGESTION_MODE;
}

/** His picks as stored: strings, each once, never the product itself, at most SUGGESTION_COUNT. */
export function cleanPickIds(raw: unknown, selfId?: string): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const id = typeof v === 'string' ? v.trim() : '';
    if (!id || id === selfId || out.includes(id)) continue;
    out.push(id);
    if (out.length >= SUGGESTION_COUNT) break;
  }
  return out;
}

export interface SuggestionProduct {
  id: string;
  categoryId?: unknown;
}

export interface SuggestionCategory extends TreeCategory {
  /** His order for this category's page — src/lib/ownerOrder.ts. */
  productOrder?: unknown;
}

/**
 * The products to suggest.
 *
 * `catalogue` is the VISIBLE catalogue in the shop's own order (by name), as the
 * server holds it; `categories` the visible categories, with his page orders.
 * `categoryId` is the product's own (a category's id OR — on older products —
 * its name); "the category" means exactly what that category's page shows, its
 * sub-categories' products included.
 */
export function pickSuggestions<T extends SuggestionProduct>(
  catalogue: readonly T[],
  categories: readonly SuggestionCategory[],
  opts: { picks: unknown; categoryId: unknown; exclude: unknown; fill: boolean; limit?: number },
): T[] {
  const limit = Math.min(12, Math.max(1, Math.floor(Number(opts.limit ?? SUGGESTION_COUNT)) || SUGGESTION_COUNT));
  const exclude = String(opts.exclude ?? '');
  const byId = new Map(catalogue.map((p) => [String(p.id), p]));
  const out: T[] = [];
  const seen = new Set<string>([exclude]);
  const take = (p: T) => {
    const id = String(p.id);
    if (out.length >= limit || seen.has(id)) return;
    seen.add(id);
    out.push(p);
  };

  for (const id of cleanPickIds(opts.picks, exclude)) {
    const p = byId.get(id);
    if (p) take(p);
  }
  if (!opts.fill || out.length >= limit) return out;

  const own = String(opts.categoryId ?? '').trim();
  if (!own) return out;
  const cat = categories.find((c) => c.id === own) ?? categories.find((c) => c.name === own);

  // What one category's page shows: its products and its sub-categories', in
  // his order for that page, the rest by name.
  const pageOf = (catId: string | null, extraForms: string[]): T[] => {
    const forms = new Set(extraForms);
    if (catId) {
      for (const id of descendantIds(categories as SuggestionCategory[], catId)) {
        forms.add(id);
        const c = categories.find((x) => x.id === id);
        if (c?.name) forms.add(String(c.name));
      }
    }
    const members = catalogue.filter((p) => forms.has(String(p.categoryId ?? '').trim()));
    const order = catId ? categories.find((c) => c.id === catId)?.productOrder : null;
    return orderByIdList(members, order);
  };
  // The ones after this product, then round to the start.
  const neighbours = (list: T[]): T[] => {
    const at = list.findIndex((p) => String(p.id) === exclude);
    return at < 0 ? list : [...list.slice(at + 1), ...list.slice(0, at)];
  };

  for (const p of neighbours(pageOf(cat?.id ?? null, [own]))) take(p);
  // A category that is gone or hidden has no parent to widen to.
  if (out.length >= limit || !cat) return out;

  const parentId = String(cat.parentId ?? '').trim();
  const parent = parentId && parentId !== cat.id ? categories.find((c) => c.id === parentId) : undefined;
  if (parent) for (const p of neighbours(pageOf(parent.id, []))) take(p);
  return out;
}
