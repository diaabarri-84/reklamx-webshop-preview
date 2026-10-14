/**
 * HOW THE SHARED PROPERTY LIBRARY IS APPLIED TO A PRODUCT — and the owner chooses.
 *
 * Until 2026-10 there was one way, and it was destructive: every target product
 * got the library's copy of every property, in the library's order, with the
 * library's on/off — and every property that existed only on that product (its
 * own custom attributes, the AI analyzer's) was deleted. Arranging a product's
 * properties, a different price on one product, a property switched off for one
 * product: all of it went on the next "Update & apply", with nothing on screen to
 * say so.
 *
 * "هو اللي يقدر يغير كل شي وهو يتحكم" — so there are three ways now, and he picks
 * one every time:
 *
 *   add-new          Products keep everything they have. A property switched on
 *                    in the library that a product does not have yet is added
 *                    at the end, switched on. Nothing else moves.
 *   update-selected  Only the properties he ticks are replaced by the library
 *                    copy — on every target product that has them, keeping that
 *                    product's own on/off and its own place in the order — and
 *                    added (switched on) where a product does not have them yet,
 *                    if they are on in the library. Everything else stays.
 *   replace-all      The old behaviour, deliberately chosen: the library's
 *                    copies, order and on/off. Properties that exist only on the
 *                    product are KEPT (after the library ones) unless he also
 *                    ticks "delete them".
 *
 * Pure and dependency-free: the server runs it per product inside the bulk
 * endpoint, and scripts/test-library-apply.mjs runs it directly.
 */

export type LibraryApplyMode = 'add-new' | 'update-selected' | 'replace-all';

export interface LibraryApplyOptions {
  mode: LibraryApplyMode;
  /** update-selected: the library property ids to push. */
  fieldIds?: string[];
  /**
   * update-selected: switch the chosen properties ON or OFF on every target
   * product, instead of keeping each product's own on/off — the way to show or
   * hide one property across many products at once. Absent = keep.
   */
  switchTo?: 'on' | 'off';
  /** replace-all: also delete the properties that exist only on the product. */
  dropProductOnly?: boolean;
}

interface FieldLike {
  id: string;
  enabled?: boolean;
  [key: string]: unknown;
}

const idOf = (f: unknown): string => String((f as FieldLike | null)?.id ?? '');

type OptionLike = {
  id?: unknown;
  hidden?: unknown;
  hiddenOnProduct?: unknown;
  isDefault?: unknown;
  subFields?: unknown;
  [key: string]: unknown;
};

/**
 * Keep the pre-selected option on one the customer can see: the product's own
 * default if it is still offered, else the first option still offered. A
 * default on a hidden option is skipped by the shop, which then pre-selects the
 * cheapest — not what he chose anywhere.
 */
function defaultOnVisible(options: OptionLike[], productDefaultId: string | null): OptionLike[] {
  const current = options.find((o) => o.isDefault === true);
  // No default at all is the library's own choice (the shop then pre-selects
  // the cheapest); only a default the customer cannot see is moved.
  if (!current || current.hidden !== true) return options;
  const visible = options.filter((o) => o.hidden !== true);
  if (visible.length === 0) return options;
  const heir = visible.find((o) => String(o.id) === productDefaultId) ?? visible[0];
  return options.map((o) => ({ ...o, isDefault: o === heir }));
}

/**
 * The library's question, with what the owner decided ON THIS PRODUCT kept —
 * round 16, item 4.
 *
 *  - An option he hid or showed in the product dialog (`hiddenOnProduct`) stays
 *    that way; otherwise the library's `hidden` decides. So hiding an option in
 *    the library, pushing, and un-hiding it again reaches every product that
 *    never decided for itself — an earlier version OR-ed the two and an option
 *    once hidden in the library stayed hidden on every product for good.
 *  - The default stays on an option the customer can see.
 *
 * Matched by PATH — this question's options by id, the questions inside an
 * option by id — never by one set of ids across every level.
 */
function withProductChoices<T extends FieldLike>(lib: T, productField: T): T {
  const productOptions = (Array.isArray(productField.options) ? productField.options : []) as OptionLike[];
  const mineById = new Map(productOptions.map((o) => [String(o?.id), o]));
  const libOptions = (Array.isArray(lib.options) ? lib.options : []) as OptionLike[];
  const merged = libOptions.map((o) => {
    const mine = mineById.get(String(o?.id));
    const decided = typeof mine?.hiddenOnProduct === 'boolean' ? (mine.hiddenOnProduct as boolean) : undefined;
    const next: OptionLike = { ...o };
    delete next.hidden;
    delete next.hiddenOnProduct;
    if (decided ?? o?.hidden === true) next.hidden = true;
    if (decided !== undefined) next.hiddenOnProduct = decided;
    if (Array.isArray(o?.subFields) && Array.isArray(mine?.subFields)) {
      const mineSubs = new Map((mine!.subFields as FieldLike[]).map((f) => [idOf(f), f]));
      next.subFields = (o.subFields as FieldLike[]).map((sub) => {
        const own = mineSubs.get(idOf(sub));
        return own ? withProductChoices(sub, own) : sub;
      });
    }
    return next;
  });
  const productDefault = productOptions.find((o) => o?.isDefault === true);
  return { ...lib, options: defaultOnVisible(merged, productDefault ? String(productDefault.id) : null) } as T;
}

/**
 * The product's new `printingFields`. Never mutates its inputs. Library entries
 * without an id are ignored — they could not be matched to anything.
 */
export function applyLibraryToProduct<T extends FieldLike>(
  productFields: T[] | null | undefined,
  libraryFields: T[] | null | undefined,
  options: LibraryApplyOptions,
): T[] {
  const product = (Array.isArray(productFields) ? productFields : []).filter((f) => idOf(f));
  const library = (Array.isArray(libraryFields) ? libraryFields : []).filter((f) => idOf(f));
  const libraryById = new Map(library.map((f) => [idOf(f), f]));
  const productIds = new Set(product.map(idOf));

  if (options.mode === 'add-new') {
    const added = library
      .filter((f) => f.enabled === true && !productIds.has(idOf(f)))
      .map((f) => ({ ...f, enabled: true }));
    return [...product, ...added];
  }

  if (options.mode === 'update-selected') {
    const chosen = new Set((options.fieldIds ?? []).map(String));
    const switchTo = options.switchTo === 'on' || options.switchTo === 'off' ? options.switchTo : null;
    const replaced = product.map((f) => {
      const id = idOf(f);
      const lib = chosen.has(id) ? libraryById.get(id) : undefined;
      if (!lib) return f;
      // His on/off for THIS product survives the update — the property's
      // content comes from the library, the decision to show it here does not —
      // unless he asked to switch the chosen properties on or off everywhere.
      const enabled = switchTo ? switchTo === 'on' : f.enabled === true;
      // What he hid or showed on THIS product stays so (round 16, item 4): the
      // library supplies the content, but hiding the star on product A and the
      // heart on B must not be undone by an update for the plaque.
      return { ...withProductChoices(lib, f), enabled } as T;
    });
    // Switching OFF never ADDS a property: hiding one a product does not carry
    // is nothing to do. Otherwise a chosen property the product lacks is added,
    // switched on — when it is on in the library, or when he said "on".
    const added = switchTo === 'off'
      ? []
      : library
          .filter((f) => chosen.has(idOf(f)) && (f.enabled === true || switchTo === 'on') && !productIds.has(idOf(f)))
          .map((f) => ({ ...f, enabled: true }));
    return [...replaced, ...added];
  }

  // replace-all — the library's copies, order and on/off, for every library
  // property that is on OR that this product already carries (a property
  // switched off in the library is not stripped from a product that has it —
  // it arrives switched off, exactly as before).
  const fromLibrary = library.filter((f) => f.enabled === true || productIds.has(idOf(f)));
  if (options.dropProductOnly === true) return fromLibrary.map((f) => ({ ...f }));
  const productOnly = product.filter((f) => !libraryById.has(idOf(f)));
  return [...fromLibrary.map((f) => ({ ...f })), ...productOnly];
}
