// Does this product offer an artwork upload, and is a file mandatory?
//
// TWO SCREENS ASK THE SAME QUESTION and they must never disagree: the storefront
// configurator, which decides whether a shopper sees the upload box, and the
// product editor, which shows the owner a tick-box that is supposed to reflect
// exactly that. They each had their own copy of the rule and each read
// `artworkEnabled !== false`, so when the default changed both had to change —
// and a pair of copies that must change together is a pair that will one day not.
//
// THE DEFAULT IS OFF, since 2026-09-13. It was "shown unless switched off", which
// put "YOUR ARTWORK · Click or drop your file here" on all 109 products, none of
// which had the field set — including an acrylic display stand, a finished good
// with nothing printed on it. The owner asked for the opposite: the box appears
// only where he has ticked it.
//
// Nothing had to be written to any product to change that. Every product simply
// has no value for the field, and no value now means off.

import { ONLINE_DESIGN_OPTION_ID } from './optionAvailability.js';

export interface ArtworkFlags {
  artworkEnabled?: boolean;
  artworkRequired?: boolean;
}

/**
 * Is the upload box on screen for this product?
 *
 * `=== true`, deliberately: anything else — absent, null, the string "false"
 * out of a bad import — is off. A rule that defaults to ON is a rule that shows
 * a print-file question on a product nobody prints.
 */
export function artworkBoxShown(product: ArtworkFlags | null | undefined): boolean {
  return product?.artworkEnabled === true;
}

/**
 * Is this line one we are WAITING for a file on?
 *
 * THE ORDER PIPELINE ASKED A DIFFERENT QUESTION and got the wrong answer. It set
 * `artworkPending` from "no file attached" alone, which was harmless while the
 * upload box was on everywhere. The moment the box defaults to OFF, no line can
 * ever carry a file — so every paid order was stamped "waiting for artwork", the
 * confirmation email told the customer "We still need your print file" for an
 * acrylic display stand, and the order page offered him a dropzone for a file the
 * product page had just told him was not wanted. Two of the shop's own screens
 * contradicting each other on every order.
 *
 * A CUSTOM UPLOAD IS ALWAYS EXPECTED. That line has no product document at all —
 * the customer's file IS the product — so asking `artworkBoxShown` about it would
 * answer "off" and file a job whose entire content is missing as needing nothing.
 */
export function artworkExpected(
  isCustomUpload: boolean,
  product: ArtworkFlags | null | undefined,
  options: ChosenOptionRef[] = [],
): boolean {
  if (isCustomUpload === true) return true;
  if (artworkSourceOf(options)) return false;
  return artworkBoxShown(product) || touchUpChosen(options) || designOnlineChosen(options);
}

/**
 * "DESIGN ONLINE" IS HIS ARTWORK TOO — designer v2, design later (the owner's
 * decision of 2026-10-07: he may pay first and design from his order page). A line
 * bought that way without its design waits for it exactly as a line waits for a
 * file sent later: the hold before print, the e-mail, and "Create your design" on
 * the order page — on a product whose upload box is off as well, since the
 * designer is how this line's artwork arrives. The exact option, in the exact
 * question (the one the product page opens the designer from).
 */
export function designOnlineChosen(options: ChosenOptionRef[] | null | undefined): boolean {
  return (options ?? []).some(
    (o) => String(o?.fieldId ?? '') === 'artwork_supply_method' && String(o?.optionId ?? o?.id ?? '') === ONLINE_DESIGN_OPTION_ID,
  );
}

/**
 * THE TOUCH-UP WORKS ON HIS FILE — so it is expected even where the owner left the
 * upload box off. "Designer touch-up — text, logo and colour fixes on my file" is
 * paid for, and on a product without the box nothing ever asked for that file: no
 * upload box on the order page, no "we still need your print file" in the e-mail,
 * no hold before print. The line is now waiting for it, and all three follow
 * (round 16 review). Same exact-id / exact-value rule as the sources below.
 */
const TOUCH_UP_IDS = new Set(['sv-dsgn-fix']);
const TOUCH_UP_VALUES = new Set(['designer_touch_up']);

export function touchUpChosen(options: ChosenOptionRef[] | null | undefined): boolean {
  return (options ?? []).some((o) => {
    const id = String(o?.optionId ?? o?.id ?? '');
    return TOUCH_UP_IDS.has(id) || (ARTWORK_FIELDS.has(String(o?.fieldId ?? '')) && TOUCH_UP_VALUES.has(String(o?.value ?? '')));
  });
}

/**
 * Where a line's artwork comes from when it is NOT the customer's file to send:
 * a reprint of an earlier order's artwork, or the shop's own studio designing it.
 *
 * THE CHOICE WAS NEVER ASKED. A line with no file on a product with the upload
 * box was "waiting for the customer's file" — so a customer who bought "Reprint —
 * use the artwork from a previous order" or the full design service was e-mailed
 * "We still need your print file", offered an upload box for a file nobody
 * wanted from him, and his order sat at design.
 *
 * EXACT ids and values only, and values only inside the two artwork questions: a
 * prefix rule ("designer_…") also caught a T-shirt quality tier whose value is
 * designer_220, and would have parked ordinary T-shirt orders. The touch-up
 * option ("fix my file") is deliberately absent — that one needs his file.
 * Studio beats reprint when a line somehow carries both.
 */
export type ArtworkSource = 'reprint' | 'studio';

/** A chosen option as either side knows it: the page (id, value) or the server (optionId, value). */
export interface ChosenOptionRef {
  fieldId?: string | null;
  id?: string | null;
  optionId?: string | null;
  value?: string | null;
}

const REPRINT_IDS = new Set(['af-supply-reprint']);
const STUDIO_IDS = new Set(['af-supply-designer', 'sv-dsgn-basic', 'sv-dsgn-standard', 'sv-dsgn-premium', 'sv-dsgn-campaign']);
const REPRINT_VALUES = new Set(['reprint_previous']);
const STUDIO_VALUES = new Set(['design_service', 'designer_basic', 'designer_standard', 'designer_premium', 'designer_campaign']);
/** The questions whose VALUES say where the artwork comes from (library copies keep the value, not always the id). */
const ARTWORK_FIELDS = new Set(['artwork_supply_method', 'design_service']);

export function artworkSourceOf(options: ChosenOptionRef[] | null | undefined): ArtworkSource | null {
  let reprint = false;
  for (const o of options ?? []) {
    const id = String(o?.optionId ?? o?.id ?? '');
    const value = String(o?.value ?? '');
    const inArtworkField = ARTWORK_FIELDS.has(String(o?.fieldId ?? ''));
    if (STUDIO_IDS.has(id) || (inArtworkField && STUDIO_VALUES.has(value))) return 'studio';
    if (REPRINT_IDS.has(id) || (inArtworkField && REPRINT_VALUES.has(value))) reprint = true;
  }
  return reprint ? 'reprint' : null;
}

/**
 * Must a file be attached before this product can be bought?
 *
 * ONLY WHEN THE BOX IS ON SCREEN. Without that guard, a product marked
 * "file required" whose box had been switched off would block checkout on a file
 * the shopper is never offered any way to attach — an unbuyable product with no
 * visible reason. `wantsFile` is the chosen delivery-of-artwork method: a shopper
 * who has said "I will send it later" is not asked for it now.
 */
export function artworkFileRequired(
  product: ArtworkFlags | null | undefined,
  wantsFile: boolean,
): boolean {
  return artworkBoxShown(product) && product?.artworkRequired === true && wantsFile;
}
