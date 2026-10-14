/**
 * `Product.quantityAfterFieldId` sentinel: the quantity table renders above
 * every field. Lives here because the storefront that reads it and the
 * dashboard that writes it both need the same literal.
 */
export const QUANTITY_AT_TOP = '__quantity_first__';

/**
 * OPTIONS INSIDE OPTIONS — the shape, the paths and the arithmetic.
 *
 * A printing field's chosen option can carry `subFields`: further fields that
 * exist only while that option is the chosen one. Pick "printed on a roll" and
 * the shop asks about winding direction and core size; pick "individual
 * stickers" and it asks about a cut shape instead. They are not the same
 * question with different answers — they are different questions.
 *
 * WHY THIS IS A LIBRARY AND NOT PART OF THE CONFIGURATOR
 * Everything here decides what a customer is CHARGED. It used to be inline in a
 * 1000-line React component, where the only way to check it was to click through
 * the shop and read the price — and the one thing that must never happen (a
 * surcharge from a branch nobody chose reaching the total) is invisible to that
 * kind of testing. It is pure functions over plain data now, and
 * scripts/test-option-tree.mjs asserts the money directly.
 *
 * HOW A SELECTION IS KEYED
 * By its PATH through the tree, not by field id:
 *
 *     'sticker_type'                              a top-level field
 *     'sticker_type>opt_roll>winding_direction'   a field inside an option
 *
 * Two branches of the same field may each hold a sub-field with the same id —
 * they are in different worlds, and an owner has no reason to think otherwise.
 * The path keeps them apart. For a top-level field the path IS the field id, so
 * every product configured before sub-options existed keys exactly as it did
 * before: nothing migrates.
 */

import type { PrintingField, PrintingFieldOption } from '../types/index.js';
import { isChargedOnce } from './chargeOnce.js';
import { outlineOf, type OutlineKind } from './shapes.js';
import { isOptionAvailable, ONLINE_DESIGN_OPTION_ID } from './optionAvailability.js';

/** Separates the segments of a selection path. Not legal in a Firestore id. */
export const FIELD_PATH_SEP = '>';

/**
 * Two levels of nesting, and no more.
 *
 * Three levels is a configurator no shopper can hold in their head and an editor
 * no owner can navigate. The cap is enforced in the browser, in the dashboard
 * and on the server — a product nested deeper than the shop can render would
 * price something no customer was ever shown.
 */
export const MAX_OPTION_DEPTH = 2;

/**
 * Sentinel id for the "Custom size" choice on a field with `allowCustomSize`.
 * It is NOT stored in the product document: the configurator appends it to the
 * rendered choices and treats a selection with this id as "custom size mode"
 * (free width × height, area-based pricing). The server ignores unknown option
 * ids, so it never adds a phantom surcharge.
 */
export const CUSTOM_SIZE_OPTION_ID = '__custom_size';

/** The sentinel option itself — label localised by the caller. */
export function makeCustomSizeOption(label: string): PrintingFieldOption {
  return { id: CUSTOM_SIZE_OPTION_ID, label, value: 'custom-size', priceModifier: 0 };
}

export interface FieldEntry {
  field: PrintingField;
  pathKey: string;
}

export function fieldPathKey(path: string[]): string {
  return path.join(FIELD_PATH_SEP);
}

/** The field id at the end of a selection path — what the cart and server read. */
export function fieldIdFromPath(pathKey: string): string {
  const parts = pathKey.split(FIELD_PATH_SEP);
  return parts[parts.length - 1];
}

/** How deep a field sits: 0 at the top, 1 inside an option, and so on. */
export function depthOfPath(pathKey: string): number {
  return pathKey.split(FIELD_PATH_SEP).length >> 1;
}

/** The sub-fields an option offers, minus any the owner switched off. */
export function subFieldsOf(option: PrintingFieldOption | undefined): PrintingField[] {
  return (option?.subFields ?? []).filter((f) => f.enabled !== false);
}

/**
 * Every field currently ON SCREEN — top-level, plus the sub-fields of whichever
 * options are chosen right now.
 *
 * This is the list everything else walks, and that is what makes the pricing
 * safe: an option hiding behind a choice nobody made never appears here, so it
 * cannot contribute a surcharge and cannot reject a basket for being unanswered.
 */
export function visibleFieldEntries(
  fields: PrintingField[],
  selected: Record<string, PrintingFieldOption>,
  parentPath: string[] = [],
  depth = 0,
): FieldEntry[] {
  const out: FieldEntry[] = [];
  for (const field of fields) {
    const path = [...parentPath, field.id];
    const pathKey = fieldPathKey(path);
    out.push({ field, pathKey });
    if (depth >= MAX_OPTION_DEPTH) continue;
    const chosen = selected[pathKey];
    if (!chosen) continue;
    const children = subFieldsOf(chosen);
    if (children.length) {
      out.push(...visibleFieldEntries(children, selected, [...path, chosen.id], depth + 1));
    }
  }
  return out;
}

/**
 * The opening configuration: the option flagged isDefault, or else the CHEAPEST
 * one. Taking `options[0]` instead — as this once did — pre-selected whatever
 * happened to be first, and an "Express delivery +95/unit" first option inflated
 * the quoted price by a third before the shopper had touched a control.
 *
 * Recursive, because a default option may itself open further questions: without
 * seeding those, the shopper lands on a sub-field with nothing selected and the
 * price on screen is missing whatever it was going to cost.
 */
export function defaultSelection(
  fields: PrintingField[],
  customSizeLabel: string,
  parentPath: string[] = [],
  depth = 0,
): Record<string, PrintingFieldOption> {
  const initial: Record<string, PrintingFieldOption> = {};
  for (const field of fields) {
    const pathKey = fieldPathKey([...parentPath, field.id]);

    // A FREE-SIZE field: the owner ticked "allow custom size" and gave it no
    // preset sizes at all, because the whole point is that the customer types
    // their own. Nothing was selected for it, so the two width/height boxes —
    // which only appear once the custom choice is active — never appeared, and
    // the field rendered as an empty space. Select the sentinel up front: the
    // shopper lands on two empty boxes, which is the feature.
    if (!field.options || field.options.length === 0) {
      if (field.allowCustomSize) initial[pathKey] = makeCustomSizeOption(customSizeLabel);
      continue;
    }

    const flagged = field.options.find((o) => o.isDefault);
    // "Design online" is never chosen FOR the customer (round 16, item 5):
    // picked by default it holds add-to-cart until he designs something he
    // never asked to design. Only the owner's own default may be the designer.
    const pool = field.options.filter((o) => String(o?.id) !== ONLINE_DESIGN_OPTION_ID);
    const cheapest = (pool.length > 0 ? pool : field.options).reduce(
      (best, o) => ((o.priceModifier || 0) < (best.priceModifier || 0) ? o : best),
      (pool.length > 0 ? pool : field.options)[0],
    );
    const chosen = flagged || cheapest;
    initial[pathKey] = chosen;

    if (depth < MAX_OPTION_DEPTH) {
      const children = subFieldsOf(chosen);
      if (children.length) {
        Object.assign(
          initial,
          defaultSelection(children, customSizeLabel, [...parentPath, field.id, chosen.id], depth + 1),
        );
      }
    }
  }
  return initial;
}

/**
 * Choose an option, and deal with everything that choice implies.
 *
 * LEAVING A BRANCH TAKES ITS ANSWERS WITH IT. Everything selected underneath
 * this field belonged to the option chosen a moment ago. Left in place it would
 * go on adding its surcharge to a price for questions no longer on screen, and
 * travel into the cart as an option the shopper cannot see and did not choose.
 *
 * The new branch arrives with its own defaults, so the price is complete the
 * instant the option is clicked rather than after the shopper notices the new
 * questions.
 */
export function selectOption(
  previous: Record<string, PrintingFieldOption>,
  pathKey: string,
  option: PrintingFieldOption,
  customSizeLabel: string,
): Record<string, PrintingFieldOption> {
  const next = { ...previous, [pathKey]: option };

  const branchPrefix = `${pathKey}${FIELD_PATH_SEP}`;
  for (const key of Object.keys(next)) {
    if (key.startsWith(branchPrefix)) delete next[key];
  }

  const depth = depthOfPath(pathKey);
  if (depth < MAX_OPTION_DEPTH) {
    const children = subFieldsOf(option);
    if (children.length) {
      Object.assign(
        next,
        defaultSelection(children, customSizeLabel, [...pathKey.split(FIELD_PATH_SEP), option.id], depth + 1),
      );
    }
  }

  return next;
}

/**
 * What the chosen options add to the UNIT price — the per-piece ones only.
 *
 * An option charged once per order line (a die, a proof, a designer's fee) is
 * NOT in this sum: the quantity would multiply it. It is in onceChargesOf, and
 * both sums go to calcConfiguredItemPrice. See src/lib/chargeOnce.ts.
 */
export function optionsSurchargeOf(selected: Record<string, PrintingFieldOption>): number {
  return Object.values(selected).reduce(
    (sum, option) => (isChargedOnce(option) ? sum : sum + (Number(option?.priceModifier) || 0)),
    0,
  );
}

/** What the chosen options add to the LINE, once, whatever the quantity. */
export function onceChargesOf(selected: Record<string, PrintingFieldOption>): number {
  return Object.values(selected).reduce(
    (sum, option) => (isChargedOnce(option) ? sum + (Number(option?.priceModifier) || 0) : sum),
    0,
  );
}

/**
 * The flat `{ field: choice }` map the cart drawer, the order document and the
 * production screens have always read. A sub-option is a choice like any other,
 * and only one branch of a field is ever selected at a time, so flattening the
 * paths to field ids cannot lose a choice the shopper actually made.
 */
export function flattenSelectionByFieldId(
  selected: Record<string, PrintingFieldOption>,
): Record<string, PrintingFieldOption> {
  const out: Record<string, PrintingFieldOption> = {};
  for (const [pathKey, option] of Object.entries(selected)) {
    out[fieldIdFromPath(pathKey)] = option;
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE SERVER'S SIDE OF THE SAME TREE.
//
// The browser knows the customer's selection as a map of paths to options. What
// travels to the server is a flat list of option ids — the price must be
// re-derived from the product document, because a price the browser states is a
// price the browser can change.
//
// Both sides walk the SAME tree by the SAME rule, and after
// `resolveSelectionFromIds` they do it with the same code: the quote endpoint
// calls this, and scripts/test-option-tree.mjs asserts it against the browser's
// own arithmetic. A divergence here is a customer charged one number and shown
// another, which is the exact class of bug this shop has already shipped once.
// ---------------------------------------------------------------------------

export interface MatchedOption {
  fieldId: string;
  fieldLabel: string;
  optionId: string;
  optionLabel: string;
  /** The option's own value (stable across library copies) — what artworkSourceOf and the speed parser read. */
  value: string;
  priceModifier: number;
  /** Added to the line once instead of once per piece — see chargeOnce.ts. */
  chargeOnce: boolean;
  /** The cut outline this choice stands for, if it is a shape (src/lib/shapes.ts). */
  outline: OutlineKind | null;
}

export interface SelectionResolution {
  /** What the chosen per-piece options add to the unit price. */
  surcharge: number;
  /** What the chosen one-off options add to the line, once. */
  onceCharges: number;
  /** Every choice, flattened, for the order document and the printed sheets. */
  matched: MatchedOption[];
  /**
   * Required fields left unanswered — but only within branches the customer
   * actually entered. A required field inside an option nobody picked is not a
   * question that was skipped; it is a question that was never asked.
   */
  unansweredRequired: { fieldId: string; fieldName: string }[];
  /**
   * Fields on which the customer chose "custom size". The caller checks the
   * entered width × height against each one's bounds — this module has no
   * opinion about millimetres.
   */
  customSizeFields: PrintingField[];
  /**
   * Options asked for that the customer cannot be offered — hidden by the owner
   * (round 16, item 4) or not available yet. Not priced, not recorded — and the
   * caller refuses the line by name, rather than quietly dropping a shape (and
   * the size questions inside it) from a basket saved before he hid it.
   */
  hiddenChosen: {
    fieldId: string;
    fieldName: string;
    optionId: string;
    optionLabel: string;
    optionLabelI18n?: PrintingFieldOption['labelI18n'] | null;
  }[];
}

export function resolveSelectionFromIds(
  fields: PrintingField[],
  requestedOptionIds: string[],
): SelectionResolution {
  const out: SelectionResolution = {
    surcharge: 0,
    onceCharges: 0,
    matched: [],
    unansweredRequired: [],
    customSizeFields: [],
    hiddenChosen: [],
  };

  // The sentinel names its field ('__custom_size:sticker_label_size'). The bare
  // form used to match EVERY field with allowCustomSize, so on a product with two
  // of them the entered size had to satisfy both sets of bounds at once and the
  // basket was rejected at payment. A basket saved before that change still
  // carries the bare form, so it is still honoured — but only when no scoped one
  // is present.
  const anyScoped = requestedOptionIds.some((id) => id.startsWith(`${CUSTOM_SIZE_OPTION_ID}:`));

  const walk = (list: PrintingField[], depth: number): void => {
    for (const field of list ?? []) {
      if ((field as any)?.enabled === false) continue;

      const customSizeChosen =
        field?.allowCustomSize === true &&
        (requestedOptionIds.includes(`${CUSTOM_SIZE_OPTION_ID}:${String(field?.id ?? '')}`) ||
          (!anyScoped && requestedOptionIds.includes(CUSTOM_SIZE_OPTION_ID)));

      if (customSizeChosen) out.customSizeFields.push(field);

      // Required means required OF WHAT THE PAGE SHOWS. A question whose every
      // option is hidden (or not offered yet) is not on the page at all, and
      // demanding an answer to it made the product impossible to buy.
      if (field?.required && !customSizeChosen) {
        const ids = (field.options ?? []).filter(isOptionAvailable).map((o) => String(o?.id));
        if (ids.length && !ids.some((id) => requestedOptionIds.includes(id))) {
          out.unansweredRequired.push({
            fieldId: String(field?.id ?? ''),
            fieldName: String(field?.name ?? field?.id ?? ''),
          });
        }
      }

      // ONE answer per question. Every field is a single choice, but this used to
      // price every requested id it found in a field — so a hand-made request
      // could stack three negative surcharges of the same question.
      let answered = false;
      for (const option of field.options ?? []) {
        if (!requestedOptionIds.includes(String(option?.id))) continue;
        if (answered) continue;
        answered = true;

        if (!isOptionAvailable(option)) {
          out.hiddenChosen.push({
            fieldId: String(field?.id ?? ''),
            fieldName: String(field?.name ?? field?.id ?? ''),
            optionId: String(option?.id),
            optionLabel: String(option?.label ?? option?.value ?? option?.id),
            optionLabelI18n: option?.labelI18n ?? null,
          });
          continue;
        }

        const modifier = Number(option?.priceModifier) || 0;
        const once = isChargedOnce(option);
        if (once) out.onceCharges += modifier;
        else out.surcharge += modifier;
        out.matched.push({
          fieldId: String(field?.id ?? ''),
          fieldLabel: String(field?.name ?? field?.id ?? ''),
          optionId: String(option?.id),
          optionLabel: String(option?.label ?? option?.value ?? option?.id),
          value: String(option?.value ?? ''),
          priceModifier: modifier,
          chargeOnce: once,
          outline: outlineOf(option as any, field as any),
        });

        // ONLY the chosen option's own questions, and only while it is chosen.
        // This single `continue`-shaped rule is what stops a surcharge hiding
        // behind an unpicked option from reaching a price.
        const children = subFieldsOf(option);
        if (children.length && depth < MAX_OPTION_DEPTH) walk(children, depth + 1);
      }
    }
  };

  walk(fields ?? [], 0);
  return out;
}
