/**
 * "ADD TO BASKET WITHOUT THE DESIGN" — design it later (designer v2; the owner's
 * decision of 2026-10-07: "yes, and he designs it from the order page").
 *
 * A line whose artwork method is "Design online" may go to the basket — and be paid
 * for — before it is designed. The order then waits for the design like it waits
 * for any file sent later (artworkPending: the production hold), and the customer
 * designs it from the basket or, after paying, from his order page.
 *
 * To open the designer there, away from the product page, the line carries what the
 * product page knew: the size, the cut, the pages and their ink, the kind of product
 * and the owner's own print values for it. The ORDER's copy is the server's, worked
 * out from the options it priced (never the browser's word), so the design is made
 * at the size production cuts. Pure; scripts/test-design-later.mjs.
 */
import { kindOfProduct, cleanSpecOverride, type ProductKind } from './printSpec.js';
import { printSides, type SideId, type SideInk } from './printSides.js';
import { primaryOutline, isOutlineKind, type OutlineKind } from './shapes.js';
import { designOnlineChosen } from './artwork.js';

export interface DesignLaterMarker {
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  sides: SideId[];
  ink: Record<SideId, SideInk>;
  sameOnBothSides: boolean;
  kind: ProductKind;
  /** The owner's own print values for the product (product.printSpec), made safe; null = the defaults. */
  printSpec: ReturnType<typeof cleanSpecOverride> | null;
  /** For the owner's templates scoped to a category. */
  categoryId: string | null;
}

/**
 * A design made in the studio after the line was bought, already in storage — what
 * the basket line or the order is given (lib/cart.ts attachDesignToCartLine, the
 * order's /artwork endpoint).
 */
export interface UploadedDesign {
  fileName: string;
  fileUrl: string;
  storagePath: string;
  /** The page pictures' own storage paths, so a design that could not be attached can be tidied away. */
  previewPaths: string[];
  trimMm: { wMm: number; hMm: number };
  bleedMm: number | null;
  dpi: number | null;
  template: { id: string; name: string } | null;
  previews: Array<{ side: SideId; url: string }>;
  sides: SideId[];
}

export interface MarkerOption {
  fieldId?: string | null;
  id?: string | null;
  optionId?: string | null;
  value?: string | null;
  outline?: unknown;
}

const KINDS: readonly ProductKind[] = ['card', 'print', 'poster', 'sticker', 'sign', 'rollup', 'banner', 'flag'];
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/**
 * The marker for a line chosen as "Design online" — or null (not chosen, or no size:
 * a design cannot be made at no size).
 */
export function designLaterMarker(input: {
  options: MarkerOption[] | null | undefined;
  printWidthCm?: unknown;
  printHeightCm?: unknown;
  printSpec?: unknown;
  categoryId?: unknown;
}): DesignLaterMarker | null {
  const options = input.options ?? [];
  if (!designOnlineChosen(options)) return null;
  const w = Number(input.printWidthCm) * 10;
  const h = Number(input.printHeightCm) * 10;
  if (!(w > 0 && h > 0 && w <= 5000 && h <= 5000)) return null;
  const shapes = options
    .filter((o) => isOutlineKind(o.outline))
    .map((o) => ({ outline: o.outline as OutlineKind, label: '' }));
  const outline = primaryOutline(shapes);
  const sides = printSides(options.map((o) => ({ fieldId: o.fieldId, optionId: o.optionId ?? o.id, value: o.value })));
  // His own cut line, special inks, an all-over print: the designer cannot make those.
  if (outline === 'custom' || sides.blocked) return null;
  const own = cleanSpecOverride(input.printSpec);
  return {
    trimMm: { wMm: Math.round(w * 10) / 10, hMm: Math.round(h * 10) / 10 },
    outline: outline && outline !== 'rect' ? outline : null,
    sides: sides.sides,
    ink: sides.ink,
    sameOnBothSides: sides.sameOnBothSides,
    kind: kindOfProduct(options.map((o) => String(o.fieldId ?? ''))),
    printSpec: Object.keys(own).length ? own : null,
    categoryId: typeof input.categoryId === 'string' && input.categoryId ? input.categoryId.slice(0, 200) : null,
  };
}

/** A marker read back from an order or a basket, made safe — or null. */
export function cleanDesignLaterMarker(raw: unknown): DesignLaterMarker | null {
  const r = raw as Partial<DesignLaterMarker> | null;
  if (!r || typeof r !== 'object') return null;
  const w = Number(r.trimMm?.wMm);
  const h = Number(r.trimMm?.hMm);
  if (!(finite(w) && finite(h) && w > 0 && h > 0 && w <= 5000 && h <= 5000)) return null;
  const sides = (Array.isArray(r.sides) ? r.sides : []).filter((s): s is SideId => s === 'front' || s === 'back');
  const inkOf = (v: unknown): SideInk => (v === 'black' || v === 'greyscale' ? v : 'colour');
  return {
    trimMm: { wMm: w, hMm: h },
    outline: isOutlineKind(r.outline) && r.outline !== 'custom' ? (r.outline as OutlineKind) : null,
    sides: sides.length ? [...new Set(sides)] : ['front'],
    ink: { front: inkOf(r.ink?.front), back: inkOf(r.ink?.back) },
    sameOnBothSides: r.sameOnBothSides === true,
    kind: KINDS.includes(r.kind as ProductKind) ? (r.kind as ProductKind) : 'print',
    printSpec: r.printSpec ? cleanSpecOverride(r.printSpec) : null,
    categoryId: typeof r.categoryId === 'string' && r.categoryId ? r.categoryId.slice(0, 200) : null,
  };
}
