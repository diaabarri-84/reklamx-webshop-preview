/**
 * "DESIGN ONLINE" ON A PRODUCT — round 16, item 5.
 *
 * The catalogue has always sold "Design online from a ready-made template" in
 * the artwork step (`af-supply-template`). Round 16 put the designer behind it.
 * These are the rules for WHERE it is offered and WHEN it can open, shared by the
 * product page and the product editor so the two cannot disagree.
 *
 *  - OFFERED (per product, decided once): the upload box is on, the owner has
 *    not switched the designer off ("all products, or the client picks": absent
 *    means on), and some choice on the product gives a size the designer can work
 *    at. A product whose sizes are words ("Standard") would offer a designer that
 *    could never open.
 *  - CAN OPEN (per choice, right now): a size is chosen and valid, the cut is not
 *    a custom contour (its cut line has to be drawn in the customer's own file),
 *    the size is one the studio makes (up to 5 m a side: designer v2 draws large
 *    formats into a tiled PDF — src/components/product/designer/printFile.ts), and
 *    the print is one a picture can make (no spot, white, metallic or neon ink, no
 *    all-over print — src/lib/printSides.ts). When it cannot, the step says why
 *    rather than hiding the option. Whether an option is on the page
 *    must not depend on the size chosen, or switching sizes would silently drop
 *    the customer's choice.
 *
 * The server never refuses the option (src/lib/optionAvailability.ts): it is a
 * 0 kr "how the file was made" answer, and production gets the file either way.
 * Pure; scripts/test-design.mjs.
 */
import type { PrintingField, PrintingFieldOption } from '../types/index.js';
import { artworkBoxShown, type ArtworkFlags } from './artwork.js';
import { ONLINE_DESIGN_OPTION_ID } from './optionAvailability.js';
import { parseDimensionsMm } from './printSize.js';
import { diameterMm, outlineOf, type OutlineKind } from './shapes.js';
import type { DesignBlock as SidesBlock } from './printSides.js';
// How the artwork reaches us: the field the designer is a choice of.
import { ARTWORK_METHOD_FIELD_ID } from './pageOrder.js';

export { ONLINE_DESIGN_OPTION_ID, ARTWORK_METHOD_FIELD_ID };

/** Is this artwork-step choice the designer? */
export function isDesignerMethod(option: { id?: unknown } | null | undefined): boolean {
  return String(option?.id ?? '') === ONLINE_DESIGN_OPTION_ID;
}

/** The owner's switch: on unless he turned it off, and only where the upload box is shown. */
export function onlineDesignOffered(
  product: (ArtworkFlags & { onlineDesign?: boolean }) | null | undefined,
): boolean {
  return artworkBoxShown(product) && product?.onlineDesign !== false;
}

/** Every (field, option) on the product, sub-questions included. */
function eachOption(
  fields: PrintingField[] | null | undefined,
  visit: (field: PrintingField, option: PrintingFieldOption) => void,
  depth = 0,
) {
  for (const field of fields ?? []) {
    if (field?.enabled === false) continue;
    for (const option of field.options ?? []) {
      visit(field, option);
      if (depth < 6) eachOption(option.subFields, visit, depth + 1);
    }
  }
}

/**
 * Is there ANY choice on this product the designer could open for?
 *
 * Readable is not enough (round 16 review): a roll-up line whose every size is
 * over the browser's limit, a "30 mm ø" size on a product with no round cut to
 * choose (the page only reads a diameter for a circle), or a product whose only
 * cut is a custom contour would each show a "Design online" card that never
 * opens. Since the designer is on by default, that would be on every such
 * product. A choice counts when the designer can really open at it: a written
 * size or A-size that fits, a diameter where a circle can be chosen, a custom
 * size at its smallest allowed, or the area calculator (10 cm a side at least).
 */
/** The longest side the studio designs, mm: its PDF pages go up to 5 080 mm with the bleed. */
export const STUDIO_MAX_SIDE_MM = 5000;

/** A size the studio can make a print file for. */
export function studioCanMake(trim: { wMm: number; hMm: number } | null | undefined): boolean {
  const w = Number(trim?.wMm);
  const h = Number(trim?.hMm);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && w <= STUDIO_MAX_SIDE_MM && h <= STUDIO_MAX_SIDE_MM;
}

export function designerCanOpenOn(fields: PrintingField[] | null | undefined, areaPriced: boolean): boolean {
  const outlines = new Set<OutlineKind>();
  eachOption(fields, (field, option) => {
    const outline = outlineOf(option, field);
    if (outline) outlines.add(outline);
  });
  if (outlines.size > 0 && [...outlines].every((o) => o === 'custom')) return false;
  const fits = (wMm: number, hMm: number) => studioCanMake({ wMm, hMm });
  if (areaPriced && fits(100, 100)) return true;
  let possible = false;
  const visitFields = (list: PrintingField[] | null | undefined, depth: number) => {
    for (const field of list ?? []) {
      if (possible || field?.enabled === false) continue;
      if (field.allowCustomSize === true) {
        const w = Math.max(1, Number(field.minWidthCm) || 1) * 10;
        const h = Math.max(1, Number(field.minHeightCm) || 1) * 10;
        if (fits(w, h)) possible = true;
      }
      for (const option of field.options ?? []) {
        const dims = parseDimensionsMm(option);
        const d = diameterMm(option);
        if ((dims && fits(dims.wMm, dims.hMm)) || (d && outlines.has('circle') && fits(d, d))) possible = true;
        if (!possible && depth < 6) visitFields(option.subFields, depth + 1);
      }
    }
  };
  visitFields(fields, 0);
  return possible;
}

/**
 * The page's fields with "Design online" kept only where the designer is behind
 * it: the top-level supply-method question, on a product that offers it. Inside
 * any other question, or on a product that does not offer it, the option would be
 * a plain card with nothing behind it and no hold on the order, which is the
 * "order with no artwork" this round set out to end. A question left with nothing
 * to choose is dropped, as withoutUnavailableOptions drops one emptied by hiding.
 */
export function designerWhereItWorks(fields: PrintingField[], offered: boolean): PrintingField[] {
  const strip = (list: PrintingField[], top: boolean): PrintingField[] => {
    const out: PrintingField[] = [];
    for (const field of list ?? []) {
      const keep = top && offered && field.id === ARTWORK_METHOD_FIELD_ID;
      const had = (field.options ?? []).length;
      const options = (field.options ?? [])
        .filter((o) => keep || !isDesignerMethod(o))
        .map((o) => (o.subFields?.length ? { ...o, subFields: strip(o.subFields, false) } : o));
      if (had > 0 && options.length === 0 && !field.allowCustomSize) continue;
      const same = options.length === had && options.every((o, i) => o === field.options[i]);
      out.push(same ? field : { ...field, options });
    }
    return out;
  };
  return strip(fields, true);
}

export type DesignerBlock = 'no-size' | 'invalid-size' | 'custom-contour' | 'too-large' | SidesBlock;

/** Why the designer cannot open for the size, cut and print chosen right now, or null when it can. */
export function designerBlock(
  trim: { wMm: number; hMm: number } | null | undefined,
  {
    customSizeInvalid = false,
    outline = null,
    sides = null,
  }: { customSizeInvalid?: boolean; outline?: OutlineKind | null; sides?: SidesBlock | null } = {},
): DesignerBlock | null {
  if (customSizeInvalid) return 'invalid-size';
  if (outline === 'custom') return 'custom-contour';
  // Unprinted, spot / white / metallic / neon ink, or all-over: not a picture's to make.
  if (sides) return sides;
  const w = Number(trim?.wMm);
  const h = Number(trim?.hMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 'no-size';
  if (!studioCanMake(trim)) return 'too-large';
  return null;
}
