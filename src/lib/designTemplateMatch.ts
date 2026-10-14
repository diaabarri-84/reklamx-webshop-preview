/**
 * WHICH OF THE OWNER'S DESIGN TEMPLATES A CUSTOMER IS OFFERED — round 16, item 5b.
 *
 * The shop owner makes templates in the dashboard (Design templates), and a
 * customer starts the online designer from one and edits it. The decisions, as
 * the owner's developer approved them on 2026-10-06:
 *
 *  - A TEMPLATE IS NEVER STRETCHED. It is offered only on a size with the same
 *    proportions (within 2 %), turned the same way: a business card template on
 *    business cards, an A4 one on A4 and A3 (every A-size has the same √2
 *    proportions). Stretched, a design made for one shape is a distorted design
 *    on another — and even 5 % left white edges where a full-bleed band could not
 *    follow (the review measured it).
 *  - NOR BLOWN UP OR SHRUNK TOO FAR: between 0.85× and 2× the size it was made
 *    at. All A-sizes share one ratio and all circles are 1:1, so ratio alone would
 *    put an A6 template on A0 — the shop's own (locked) logo printed blurred, and
 *    text placed at the safe line pushed into the margin on a much smaller one,
 *    neither of which the customer can fix. The owner duplicates a template for
 *    another size range. And its pictures must still print at 150 DPI or more.
 *  - THE SAME CUT. A template made for a round sticker is a composition inside a
 *    circle; on a rectangle it is a circle floating in a box. A plain rectangle and
 *    a square count as one family (no shape chosen, or the plain cut) — but a
 *    SQUARE cut on a size that is not square is not: it cuts the largest square
 *    out of the middle, and a rectangle's layout would lose both ends to it.
 *  - WHERE THE OWNER PUT IT: everywhere, in some categories (a sub-category's
 *    products included), or on some products.
 *
 * When a template is NOT offered, `templateMiss` says why, so the dashboard and
 * an admin looking at a product page can tell the owner instead of leaving him
 * guessing. Pure: the server uses the scope rule (it holds the categories), the
 * designer the fit rule (the customer can change the size while the page is
 * open). scripts/test-design.mjs.
 */
import type { OutlineKind } from './shapes.js';
import { DESIGN_MIN_DPI } from './designSize.js';

/** How far the proportions may differ, as a fraction (2 %). */
export const TEMPLATE_RATIO_TOLERANCE = 0.02;
/** The template may be used from this fraction of its size… */
export const TEMPLATE_SCALE_MIN = 0.85;
/** …up to this multiple of it. */
export const TEMPLATE_SCALE_MAX = 2;

/**
 * A rectangle and a square are the same cut; nothing chosen is the plain cut.
 * A 'square' cut at a size that is NOT square is its own: it cuts the largest
 * centred square out of the size (src/lib/shapes.ts), so a layout made for the
 * whole rectangle would lose both ends — locked elements included.
 */
export function cutFamily(
  outline: OutlineKind | null | undefined,
  trim?: { wMm: number; hMm: number } | null,
): OutlineKind {
  if (outline === 'square' && trim) {
    const w = Number(trim.wMm);
    const h = Number(trim.hMm);
    if (w > 0 && h > 0 && Math.abs(w - h) > 0.01 * Math.max(w, h)) return 'square';
  }
  return !outline || outline === 'square' ? 'rect' : outline;
}

export interface TemplateFitInput {
  trimMm: { wMm: number; hMm: number };
  outline?: OutlineKind | null;
  /** The lowest resolution any of its pictures prints at, at the size it was made (null: no pictures). */
  lowestPictureDpi?: number | null;
}

/** How much the template is scaled on this size: the smaller of the two axes, as the refit does. */
export function templateScale(template: TemplateFitInput, trim: { wMm: number; hMm: number }): number {
  return Math.min(Number(trim.wMm) / Number(template.trimMm.wMm), Number(trim.hMm) / Number(template.trimMm.hMm));
}

/** Why a template is NOT offered on this size and cut — or null when it is. */
export type TemplateMiss = 'no-size' | 'cut' | 'proportions' | 'product-smaller' | 'product-larger' | 'pictures';

export function templateMiss(
  template: TemplateFitInput,
  trim: { wMm: number; hMm: number } | null | undefined,
  outline: OutlineKind | null | undefined,
): TemplateMiss | null {
  const tw = Number(template?.trimMm?.wMm);
  const th = Number(template?.trimMm?.hMm);
  const w = Number(trim?.wMm);
  const h = Number(trim?.hMm);
  if (!(tw > 0 && th > 0 && w > 0 && h > 0)) return 'no-size';
  if (cutFamily(template.outline, { wMm: tw, hMm: th }) !== cutFamily(outline, { wMm: w, hMm: h })) return 'cut';
  if (Math.abs((tw / th) / (w / h) - 1) > TEMPLATE_RATIO_TOLERANCE) return 'proportions';
  const s = templateScale(template, { wMm: w, hMm: h });
  if (s < TEMPLATE_SCALE_MIN) return 'product-smaller';
  if (s > TEMPLATE_SCALE_MAX) return 'product-larger';
  const dpi = Number(template.lowestPictureDpi);
  if (dpi > 0 && dpi / s < DESIGN_MIN_DPI) return 'pictures';
  return null;
}

/** Can a template made at `template` be used on a product of `trim` cut to `outline`? */
export function templateFits(
  template: TemplateFitInput,
  trim: { wMm: number; hMm: number } | null | undefined,
  outline: OutlineKind | null | undefined,
): boolean {
  return templateMiss(template, trim, outline) === null;
}

export type TemplateScope =
  | { kind: 'all' }
  | { kind: 'categories'; ids: string[] }
  | { kind: 'products'; ids: string[] };

/** A scope as stored, made safe: unknown or empty means "everywhere" only when it says so. */
export function cleanScope(raw: unknown): TemplateScope {
  const s = raw as { kind?: unknown; ids?: unknown } | null | undefined;
  const ids = Array.isArray(s?.ids) ? [...new Set(s!.ids.map((v) => String(v ?? '').trim()).filter(Boolean))].slice(0, 500) : [];
  if (s?.kind === 'categories') return { kind: 'categories', ids };
  if (s?.kind === 'products') return { kind: 'products', ids };
  return { kind: 'all' };
}

/**
 * Is a template with this scope offered on this product? Categories count with
 * their sub-categories: a template put on "Stickers" shows on "Stickers > Round".
 */
export function templateInScope(
  scope: TemplateScope,
  product: { id: string; categoryId?: string | null },
  categories: Array<{ id: string; parentId?: string | null; name?: string | null }>,
): boolean {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'products') return scope.ids.includes(String(product.id));
  const wanted = new Set(scope.ids);
  const parentOf = new Map(categories.map((c) => [String(c.id), c.parentId ? String(c.parentId) : null]));
  // A product's categoryId holds the category's id OR its NAME — both are in
  // the data (PrintingFieldsAdmin matches both for the same reason).
  const raw = product.categoryId ? String(product.categoryId) : null;
  let at: string | null =
    raw && !parentOf.has(raw) ? String(categories.find((c) => c.name === raw)?.id ?? raw) : raw;
  // A parent chain is short; the guard only stops a loop in bad data.
  for (let i = 0; at && i < 20; i += 1) {
    if (wanted.has(at)) return true;
    at = parentOf.get(at) ?? null;
  }
  return false;
}
