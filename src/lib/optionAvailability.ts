/**
 * OPTIONS THE CATALOGUE OFFERS THAT THE SHOP CANNOT DELIVER YET.
 *
 * "Design it online with a free template" sits in two catalogue fields: the
 * design service and the artwork supply method. Until round 16 neither had
 * anything behind it, so both were hidden here, in one place, for every field
 * the product page renders and for the server's pricing.
 *
 * ROUND 16, ITEM 5: THE ARTWORK STEP'S ONE IS REAL NOW. `af-supply-template`
 * opens the online designer (src/components/product/designer), and the file it
 * makes is attached like any upload. That one option is open, on the page AND
 * on the server, which prices it like any other 0 kr choice. Whether a product
 * SHOWS it is the page's decision (src/lib/onlineDesign.ts). The server never
 * refuses it, so a basket filled before the owner switched the designer off on
 * a product still goes through with its finished design.
 *
 * The design service's own "Design it online" (`sv-dsgn-online`, same value)
 * is a different question, with no designer wired behind it, and it stays
 * hidden. Matching by value alone would have surfaced it as a card leading
 * nowhere. The data and prices are left exactly as they are.
 */

import type { PrintingField, PrintingFieldOption } from '../types/index.js';

const NOT_YET_AVAILABLE = /online_template/i;

/** The artwork step's "Design online from a ready-made template" — the designer. */
export const ONLINE_DESIGN_OPTION_ID = 'af-supply-template';

/** Can a customer be offered this option today? Not if the owner has hidden it. */
export function isOptionAvailable(option: Pick<PrintingFieldOption, 'id' | 'value' | 'hidden'> | null | undefined): boolean {
  if (!option) return false;
  if (option.hidden === true) return false;
  if (String(option.id ?? '') === ONLINE_DESIGN_OPTION_ID) return true;
  return !NOT_YET_AVAILABLE.test(String(option.value ?? '')) && !NOT_YET_AVAILABLE.test(String(option.id ?? ''));
}

/**
 * The fields with every not-yet-available option taken out, nested questions
 * included. A field left with nothing to choose is dropped, unless it is a
 * free-size field — those have no preset options on purpose.
 */
export function withoutUnavailableOptions(fields: PrintingField[]): PrintingField[] {
  const out: PrintingField[] = [];
  for (const field of fields ?? []) {
    const had = (field.options ?? []).length;
    const options = (field.options ?? [])
      .filter(isOptionAvailable)
      .map((o) => (o.subFields?.length ? { ...o, subFields: withoutUnavailableOptions(o.subFields) } : o));
    if (had > 0 && options.length === 0 && !field.allowCustomSize) continue;
    out.push(options.length === had && options.every((o, i) => o === field.options[i]) ? field : { ...field, options });
  }
  return out;
}
