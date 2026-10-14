/**
 * WHICH OPTIONS ARE CHARGED ONCE PER ORDER LINE, AND WHICH PER PIECE.
 *
 * An option's `priceModifier` is added to the unit price, so the quantity
 * multiplies it. That is right for paper, laminate or a second printed side, and
 * badly wrong for anything that is done once for the whole job. Until 2026-10
 * every option was per piece, so the shop quoted:
 *
 *     100 stickers + "New cutting die (one-off tooling) +850 kr"   →  +85 000 kr
 *     500 flyers   + "Designer creates the design +995 kr"         → +497 500 kr
 *
 * WHY A LIST OF IDS, and not only the `chargeOnce` flag.
 * Every product carries its own COPY of its options, made when the owner switched
 * them on. A flag added to the catalogue today reaches none of those copies, so a
 * flag alone would leave every product already in the shop charging per piece.
 * The catalogue's option ids are copied verbatim, so they identify a one-off
 * option wherever it now lives — the shared library or a product — and the fix
 * applies to all of them without rewriting a single document.
 *
 * The owner decides in the end: an option with `chargeOnce` set to true or false
 * follows that, whatever this list says. The list is only the default for an
 * option nobody has decided about.
 *
 * KEEP IN STEP WITH THE CATALOGUE. scripts/test-charge-once.mjs fails if an option
 * marked `chargeOnce: true` in src/components/Admin/optionCatalogue.ts is missing
 * here, or if an id here no longer exists there.
 *
 * Dependency-free on purpose: the server imports it through optionTree.ts.
 */

import type { PrintingFieldOption } from '../types/index.js';

export const DEFAULT_ONCE_OPTION_IDS: ReadonlySet<string> = new Set([
  // Cutting die / tooling — the tool is made once. (The digital plotter, 0.9 kr,
  // stays per piece: that one really is per cut.)
  'cs-tool-mag', 'cs-tool-new-die', 'cs-tool-new-die-large',
  // Artwork check & proofing
  'sv-proof-digital', 'sv-proof-premium', 'sv-proof-designer', 'sv-proof-hard', 'sv-proof-contract',
  // Design service
  'sv-dsgn-fix', 'sv-dsgn-basic', 'sv-dsgn-standard', 'sv-dsgn-premium', 'sv-dsgn-campaign',
  // Sample before the full run
  'sv-smpl-blank', 'sv-smpl-book', 'sv-smpl-print1', 'sv-smpl-print5', 'sv-smpl-press',
  // Artwork supply method — our studio lays it out / designs it
  'af-supply-images', 'af-supply-designer',
  // Cutting guide / die-line
  'af-die-drawn', 'af-die-new-tool',
  // Artwork file check
  'af-check-premium', 'af-check-premium-fix',
  // Artwork preparation done for him — once per job, like the checks above
  'af-bleed-added', 'af-spot-create', 'af-spot-vectorise',
  // Artwork delivered on physical media
  'af-transfer-media',
  // Delivery split over several addresses
  'sv-splt-2', 'sv-splt-3', 'sv-splt-5', 'sv-splt-10', 'sv-splt-25', 'sv-splt-list',
  // Storage & call-off
  'sv-stor-call1', 'sv-stor-3m', 'sv-stor-6m', 'sv-stor-call4', 'sv-stor-12m', 'sv-stor-call12',
  // Installation — a visit, not a piece. (The mounting kit stays per piece:
  // one kit per sign.)
  'sv-inst-survey', 'sv-inst-removal', 'sv-inst-local', 'sv-inst-halfday', 'sv-inst-fullday',
  // Delivery method — one delivery per order
  'sv-dm-door', 'sv-dm-inside', 'sv-dm-saturday', 'sv-dm-timed', 'sv-dm-pallet', 'sv-dm-courier',
  // Sustainability add-ons — certification, offset and packing for the order
  'sv-eco-pack', 'sv-eco-climate', 'sv-eco-fsc', 'sv-eco-full', 'sv-eco-swan',
  // Production & delivery speed — the JOB is rushed, not each piece
  'sv-speed-fast', 'sv-speed-express', 'sv-speed-nextday',
  // Label dispenser hardware — the field says it itself: "priced per unit of
  // hardware, not per label", and the quantity on a label product is LABELS.
  'sl-hw-wall', 'sl-hw-handheld', 'sl-hw-tabletop', 'sl-hw-rewinder', 'sl-hw-electric',
  // A fire certificate is one document for the order
  'lf-fire-doc',
  // The older built-in fields (PrintingFieldsAdmin): speed, designer proof, and
  // handling several artwork files. ('cads-1', the die-line upload, is NOT here:
  // it is the default and only answer of its field, so it has always acted as
  // part of the unit price; making it one-off would quietly cut the price of
  // every product carrying that field. He can tick it himself if he wants.)
  'dd-2', 'dd-3', 'aa-2', 'nof-3',
]);

/**
 * Is this option added to the line once, rather than once per piece?
 *
 * Once PER ORDER LINE — per product in the basket — not once per whole order:
 * options belong to a product, so a basket of three products that each carry
 * "Saturday delivery" carries it three times. The dashboard says "per line" for
 * exactly that reason.
 *
 * A DISCOUNT (a negative price) is never one-off, whatever the flag says. The
 * line total adds one-off charges only upwards (calcConfiguredItemPrice clamps
 * their sum at zero, so a one-off discount could never be given), and a card
 * reading "-200 kr engångsavgift" would promise money the basket does not take
 * off. Per piece is the only way a negative option is priced honestly.
 */
export function isChargedOnce(
  option: Pick<PrintingFieldOption, 'id' | 'chargeOnce' | 'priceModifier'> | null | undefined,
): boolean {
  if (!option) return false;
  if (Number(option.priceModifier) < 0) return false;
  if (option.chargeOnce === true) return true;
  if (option.chargeOnce === false) return false;
  return DEFAULT_ONCE_OPTION_IDS.has(String(option.id ?? ''));
}
