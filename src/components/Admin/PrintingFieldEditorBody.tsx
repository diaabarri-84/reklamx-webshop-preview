import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, CornerDownRight, Languages, Loader2, Plus, Upload, X } from 'lucide-react';
import { LocalizedText, PrintingField, PrintingFieldOption } from '../../types';
import { cn } from '../../lib/utils';
import { isChargedOnce } from '../../lib/chargeOnce';
import { OUTLINE_KINDS, OUTLINE_NAMES, iconOutline, isShapeField, outlineOf } from '../../lib/shapes';
import SortableList, { DragHandle, type SortableHandle } from './SortableList';
import { reorderById } from '../../lib/reorder';
import { useAuth } from '../../App';
// The sv/da/no control moved to its own module so the category screen can use
// it without pulling this whole editor in. Re-exported because the product
// form has always imported it from here.
import { aiHealth, LocalizedTextFields, translateManyViaApi } from './LocalizedTextFields';
export { LocalizedTextFields };

/**
 * The editor for ONE printing field: its name, its help text, and every option
 * the customer will be offered — label, surcharge, which one is pre-selected,
 * which carries the "Recommended" badge.
 *
 * WHY THIS IS ITS OWN FILE
 * The product form used to have two classes of field. A field the owner invented
 * himself ("custom-…") got this whole editor. A field from the printing-option
 * catalogue got a card that said "3 options available" and a checkbox — the
 * values were invisible and unreachable, and the owner had to leave the product,
 * open the Printing fields screen, and edit the field for the WHOLE shop just to
 * see what was in it. Both now mount this same component, so every property in
 * the product form has the same powers.
 *
 * Editing a catalogue field here changes it for THIS PRODUCT ONLY — the product
 * stores its own copy of printingFields, which is how the shop has always worked.
 * The Printing fields screen is still where a change for every product is made.
 */

/** The shop's three non-English storefront languages. */

export type FieldPatch = Partial<
  Pick<
    PrintingField,
    | 'name'
    | 'nameI18n'
    | 'description'
    | 'descriptionI18n'
    | 'required'
    | 'allowCustomSize'
    | 'keepOwnerOrder'
    // 15.4.5b — so the whole-property translation can be applied as ONE patch.
    // Written one-write-per-row it was silently lossy in the nested editor,
    // where every handler is rebuilt from state captured at render.
    | 'options'
    | 'minWidthCm'
    | 'maxWidthCm'
    | 'minHeightCm'
    | 'maxHeightCm'
    // Round 16, item 4: picture cards / list / automatic, and "this question
    // chooses the cut shape".
    | 'display'
    | 'cutShape'
  >
>;

export type OptionPatch = Partial<
  Pick<
    PrintingFieldOption,
    'label' | 'labelI18n' | 'priceModifier' | 'dimensions' | 'recommended' | 'imageUrl' | 'subFields' | 'chargeOnce'
    // Round 16, item 4 — undefined means "automatic" and is stripped before
    // saving (Firestore refuses an undefined value).
    | 'outline' | 'hidden' | 'hiddenOnProduct'
  >
>;

/**
 * How deep the questions may nest. Matches MAX_OPTION_DEPTH in the configurator —
 * a product the dashboard can build but the shop cannot render would be worse
 * than no feature at all.
 */
export const MAX_EDITOR_DEPTH = 2;

/** 'Silk Coated' → 'silk-coated'. Options are matched by id; value is the slug. */
function slugifyLabel(text: string): string {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'option';
}

/** A fresh question to ask inside an option, with one answer to start from. */
function makeSubField(seed: number): PrintingField {
  return {
    id: `sub-${seed}`,
    name: 'New question',
    group: 'product_builder',
    enabled: true,
    options: [
      { id: `subopt-${seed}`, label: 'First choice', value: 'first-choice', priceModifier: 0, isDefault: true },
    ],
  };
}

interface PrintingFieldEditorBodyProps {
  field: PrintingField;
  onUpdateField: (patch: FieldPatch) => void;
  onAddOption: () => void;
  onUpdateOption: (optionId: string, patch: OptionPatch) => void;
  onSetDefault: (optionId: string) => void;
  onRemoveOption: (optionId: string) => void;
  /**
   * Move one option up or down the list — 15.5.1.
   *
   * "هون ما قادر ارتبهم حسب الاولويه". Top to bottom in this array IS the order
   * the customer sees, and until now there was no way to change it: every
   * handler appends to the end, so the order was whatever the option happened
   * to be typed in, or whatever the AI emitted.
   *
   * Optional, because the parent owns the array. A parent that does not pass it
   * simply shows no arrows rather than showing dead ones. NOTE for anyone
   * wiring the nested editor below: this does NOT reach sub-options on its own
   * — that instance builds its own handlers, and gets its own.
   */
  onMoveOption?: (optionId: string, direction: -1 | 1) => void;
  /**
   * The whole option list in a new order, from a DRAG — the owner takes a row by
   * its grip and drops it where he wants it. The parent owns the array, exactly
   * as for onMoveOption; without this prop the rows simply have no grip.
   */
  onReorderOptions?: (orderedIds: string[]) => void;
  /**
   * Renaming is allowed everywhere by default: the product keeps its own copy of
   * the field, so calling the catalogue's "Paper type" something else on ONE
   * product is a legitimate thing to want and changes nothing anywhere else.
   * Set false only where a shared name is being edited.
   */
  allowRename?: boolean;
  /** Shown once above the options, to say where an edit lands. */
  scopeNote?: string;
  /**
   * Store an image file somewhere and resolve with the URL to save on the option.
   *
   * Injected rather than imported: this component is presentational — no
   * firebase, no auth, no uid — and each parent knows its own upload path. When
   * it is not supplied the row keeps its URL box and simply shows no button.
   */
  onUploadOptionImage?: (file: File) => Promise<string>;
  /**
   * How far inside an option this editor already is. 0 at the top. Used only to
   * stop the nesting at MAX_EDITOR_DEPTH; the parent never passes it.
   */
  depth?: number;
  /**
   * This is a PRODUCT's copy of the property (the product dialog), not the
   * library. Hiding an option here is then recorded as this product's own
   * decision (`hiddenOnProduct`), which a later push from the library keeps —
   * where hiding it in the library reaches every product that has not decided.
   */
  productCopy?: boolean;
}

const INPUT =
  'w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-bold text-gray-900 bg-white';
const SMALL_INPUT =
  'w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-[0.6875rem] font-bold text-gray-700 bg-white';

/**
 * THE HAND-ROLLED LANGUAGE BOXES ARE GONE — 15.4.1.
 *
 * This file carried its own copy of the sv/da/no control: a globe chip printing
 * "0/3" and three plain inputs, written three weeks before the AI translate
 * button existed and never retrofitted with it. So in ONE product dialog the
 * owner saw the purple button on the product name and the description, and no
 * button at all on every property, every help text and every option below them
 * — "هون شغال، وفي اماكن ما شغاله". It imported the shared control at the top of
 * this file only to re-export it for the product form, and rendered its own
 * instead.
 *
 * It now renders the shared one, which brings the button, the honest counter,
 * the per-language clear, the "same as English" warning and the four-language
 * hints with it. `patchI18n` went with the old widget: the shared control
 * already writes an explicit null for a cleared box, which is what makes a
 * { merge: true } write actually delete that language rather than leave the old
 * text standing on the storefront.
 */

export default function PrintingFieldEditorBody({
  field,
  onUpdateField,
  onAddOption,
  onUpdateOption,
  onSetDefault,
  onRemoveOption,
  onMoveOption,
  onReorderOptions,
  allowRename = true,
  scopeNote,
  onUploadOptionImage,
  depth = 0,
  productCopy = false,
}: PrintingFieldEditorBodyProps) {
  /**
   * The surcharge box holds a STRING while it is being typed.
   *
   * It used to be `<input type="number">` committing `Number(e.target.value) || 0`.
   * A number input reports an incomplete value — "-", "1." — as the empty string,
   * so the first keystroke of a NEGATIVE surcharge committed 0 and React wrote
   * "0" back over the minus. The owner could not type −18 at all; he got +18, a
   * sign flip on every unit, with nothing on screen to show it. Negative
   * surcharges are ordinary here: the catalogue ships them, and the writer script
   * generates them when it rebases a field's default.
   */
  const [surchargeDraft, setSurchargeDraft] = useState<Record<string, string>>({});
  /** Which option row is mid-upload, and what went wrong on the last try. */
  const [uploadingOptionId, setUploadingOptionId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<Record<string, string>>({});

  /**
   * TRANSLATE THE WHOLE PROPERTY IN ONE GO — 15.4.5.
   *
   * Every box here has its own purple button now, which is right for one box
   * and wrong for a property with fourteen options: that is sixteen requests,
   * and this shop's limiter is fifteen a minute shared with the chat, the
   * contact form and the competitor analyser. He would meet a 429 halfway
   * through and read it as "the translation failed" — the complaint this round
   * exists to fix.
   *
   * One request, one upstream call, and the option labels are translated
   * together so that a set like Small / Medium / Large comes back consistent
   * with itself. It fills only EMPTY boxes, exactly like the single button.
   */
  const { t } = useAuth();
  const [aiOn, setAiOn] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchNote, setBatchNote] = useState<{ text: string; tone: 'hint' | 'error' } | null>(null);
  useEffect(() => {
    let cancelled = false;
    aiHealth().then((on) => { if (!cancelled) setAiOn(on); });
    return () => { cancelled = true; };
  }, []);

  /**
   * Everything on this card that has English text and an empty language box.
   *
   * `what` says which box the answer belongs to; `id` is a BARE NUMBER, and
   * that is not cosmetic — 15.4.5c. The ids used to be the meaningful ones
   * ('__name', '__desc', the option's own id) and the model quietly renamed
   * them in its JSON: ask it to key an object by `__name` and it answers
   * `name`, so that row came back unmatched and was dropped. On a nested
   * question, whose only rows are the name and one choice, that is half the
   * card — and the note honestly reported "1 of 2" while the owner saw a
   * property name still at 0/3 with an AI request spent.
   *
   * A number has nothing to tidy up. Nothing is inferred from the id on the
   * way back either: the row it came from is looked up by position.
   */
  const untranslated = (): { id: string; text: string; what: 'name' | 'desc' | string }[] => {
    const rows: { id: string; text: string; what: 'name' | 'desc' | string }[] = [];
    const needs = (map: LocalizedText | undefined) =>
      ['sv', 'da', 'no'].some((code) => !(map?.[code as keyof LocalizedText] ?? '').trim());
    const push = (what: string, text: string) => rows.push({ id: String(rows.length), text, what });
    if (field.name.trim() && needs(field.nameI18n)) push('name', field.name.trim());
    if ((field.description || '').trim() && needs(field.descriptionI18n)) push('desc', (field.description || '').trim());
    for (const opt of field.options) {
      if (opt.label.trim() && needs(opt.labelI18n)) push(opt.id, opt.label.trim());
    }
    return rows;
  };

  const translateWholeField = async () => {
    if (batchBusy) return;
    const rows = untranslated();
    if (rows.length === 0) { setBatchNote({ text: t('i18nTranslateAllFilled'), tone: 'hint' }); return; }
    setBatchBusy(true);
    setBatchNote(null);
    try {
      const body = await translateManyViaApi(
        rows.map(({ id, text }) => ({ id, text })),
        ['sv', 'da', 'no'],
        'option label',
      );
      if (!body.ok) {
        setBatchNote({
          text: body.upstream ? `${t('i18nTranslateFailed')} (${body.upstream})` : t('i18nTranslateFailed'),
          tone: 'error',
        });
        return;
      }
      // Only the EMPTY languages are written, even though the model answered
      // for all three — the promise this control makes everywhere else is that
      // it never overwrites something he typed.
      const merge = (current: LocalizedText | undefined, got: Record<string, string>): LocalizedText => {
        const next: LocalizedText = { ...(current || {}) };
        for (const code of ['sv', 'da', 'no'] as (keyof LocalizedText)[]) {
          if ((next[code] ?? '').trim()) continue;
          const text = (got[code] ?? '').trim();
          if (text) next[code] = text;
        }
        return next;
      };
      /**
       * ONE WRITE, NOT ONE PER ROW — 15.4.5b.
       *
       * This used to call `onUpdateField` / `onUpdateOption` once per answer
       * inside this loop. At the TOP level that is safe: both handlers in
       * ProductsAdmin are `setFormPrintingFields(prev => …)` updaters, so
       * successive calls in one tick compose. In the NESTED editor — the
       * "asked only when X is chosen" card — they are not: `writeSub` rebuilds
       * the entire sub-field from the `sub` captured at render, so every write
       * threw away the one before it. Pressing the button on a nested question
       * with a name, a help text and five choices landed ONE of the seven and
       * reported "7 of 7 boxes filled in", spending an AI request each time.
       *
       * The whole answer is assembled here and handed over in a single patch,
       * which behaves identically at both depths. `filled` counts rows that
       * actually changed, so the note can no longer claim more than it did.
       */
      let filled = 0;
      const patch: FieldPatch = {};
      let options = field.options;
      for (const row of rows) {
        const got = body.results[row.id];
        if (!got) continue;
        if (row.what === 'name') { patch.nameI18n = merge(field.nameI18n, got); filled += 1; }
        else if (row.what === 'desc') { patch.descriptionI18n = merge(field.descriptionI18n, got); filled += 1; }
        else {
          const at = options.findIndex((o) => o.id === row.what);
          if (at < 0) continue;
          options = options.map((o, i) => (i === at ? { ...o, labelI18n: merge(o.labelI18n, got) } : o));
          filled += 1;
        }
      }
      if (options !== field.options) patch.options = options;
      if (filled > 0) onUpdateField(patch);
      if (filled === 0) { setBatchNote({ text: t('i18nTranslateEmpty'), tone: 'error' }); return; }
      // What was asked for and what came back, because a partial answer that
      // reads as a complete one is how a half-Swedish option list ships.
      setBatchNote({
        text: t('i18nTranslateFieldDone').replace('{0}', String(filled)).replace('{1}', String(rows.length)),
        tone: 'hint',
      });
    } catch {
      setBatchNote({ text: t('i18nTranslateFailed'), tone: 'error' });
    } finally {
      setBatchBusy(false);
    }
  };

  const handlePickOptionImage = async (optionId: string, file?: File | null) => {
    if (!file || !onUploadOptionImage) return;
    setUploadingOptionId(optionId);
    setUploadError((prev) => ({ ...prev, [optionId]: '' }));
    try {
      const url = await onUploadOptionImage(file);
      onUpdateOption(optionId, { imageUrl: url });
    } catch (err: any) {
      // Say what happened on the row itself. An upload that fails silently looks
      // exactly like one that worked but saved nothing.
      setUploadError((prev) => ({
        ...prev,
        [optionId]: String(err?.message ?? err) || 'The image could not be uploaded.',
      }));
    } finally {
      setUploadingOptionId(null);
    }
  };

  /** "−1,5" / "-1.5" → -1.5. Null while the text is not yet a number. */
  const parseSurcharge = (raw: string): number | null => {
    const cleaned = raw.replace('\u2212', '-').replace(',', '.').trim();
    if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const handleSurchargeInput = (optionId: string, raw: string) => {
    setSurchargeDraft((prev) => ({ ...prev, [optionId]: raw }));
    const parsed = parseSurcharge(raw);
    // Only a value that is actually a number is committed; "-" waits for a digit.
    if (parsed !== null) onUpdateOption(optionId, { priceModifier: parsed });
  };

  /** Leaving the box half-typed puts the last committed number back on screen. */
  const commitSurcharge = (optionId: string, current: number) => {
    setSurchargeDraft((prev) => {
      const next = { ...prev };
      delete next[optionId];
      return next;
    });
    void current;
  };

  /**
   * One option row. A function so the same row renders in the draggable list
   * (when the parent can reorder) and in the plain one (when it cannot).
   */
  const renderOption = (opt: PrintingFieldOption, optIdx: number, handle?: SortableHandle) => (
          <div key={opt.id} className="bg-white p-3 rounded-xl border border-gray-200 space-y-2">
            {/* Row 1: default radio · label · surcharge · translations · delete */}
            <div className="flex items-center gap-2">
              {handle && <DragHandle handle={handle} label="Drag this option" />}
              <label
                className="flex items-center space-x-1 cursor-pointer shrink-0"
                title="Pre-selected option in the configurator"
              >
                <input
                  type="radio"
                  name={`field-default-${field.id}`}
                  checked={!!opt.isDefault}
                  // A hidden option cannot be pre-selected: the shop would skip
                  // it and pick the cheapest visible one instead.
                  disabled={opt.hidden === true}
                  onChange={() => onSetDefault(opt.id)}
                  className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500 disabled:opacity-40"
                />
                <span className="text-[0.625rem] font-bold text-gray-500">Default</span>
              </label>
              <input
                type="text"
                value={opt.label}
                onChange={(e) => onUpdateOption(opt.id, { label: e.target.value })}
                placeholder="Option label (e.g. Navy Blue)"
                className="flex-1 min-w-0 px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-bold text-gray-900"
              />
              <div className="flex items-center space-x-1 shrink-0">
                <input
                  type="text"
                  inputMode="decimal"
                  value={surchargeDraft[opt.id] ?? String(opt.priceModifier ?? 0)}
                  onChange={(e) => handleSurchargeInput(opt.id, e.target.value)}
                  onBlur={() => commitSurcharge(opt.id, opt.priceModifier ?? 0)}
                  placeholder="0"
                  aria-label={isChargedOnce(opt) ? 'Surcharge, charged once per order line' : 'Surcharge per unit'}
                  className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-black text-gray-900 text-right"
                />
                <span className="text-[0.625rem] font-bold text-gray-500">
                  {isChargedOnce(opt) ? 'kr once' : 'kr/unit'}
                </span>
              </div>
              {/* 15.5.1 — the same pair of arrows the "Order on the product
                  page" panel already uses, on the list that decides what the
                  customer reads first. Disabled at the ends rather than hidden,
                  so the row does not change width as it moves. */}
              {onMoveOption && (
                <>
                  <button
                    type="button"
                    onClick={() => onMoveOption(opt.id, -1)}
                    disabled={optIdx === 0}
                    title="Move option up"
                    className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-25 disabled:hover:bg-transparent shrink-0"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMoveOption(opt.id, 1)}
                    disabled={optIdx === field.options.length - 1}
                    title="Move option down"
                    className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-25 disabled:hover:bg-transparent shrink-0"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onRemoveOption(opt.id)}
                title="Delete option"
                className="text-gray-400 hover:text-red-600 p-1 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <LocalizedTextFields
              label="Option label"
              fallback={opt.label}
              value={opt.labelI18n || {}}
              onChange={(next) => onUpdateOption(opt.id, { labelI18n: next })}
            />

            {/* Row 2: dimensions · image (upload or URL) · recommended */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <input
                type="text"
                value={opt.dimensions || ''}
                onChange={(e) => onUpdateOption(opt.id, { dimensions: e.target.value })}
                placeholder="148 × 210 mm"
                className={SMALL_INPUT}
              />
              <div className="flex items-center gap-1.5 min-w-0">
                {/* The picture itself, once there is one — the only way to tell a
                    saved image from an upload that quietly failed. */}
                {opt.imageUrl && (
                  <span className="relative shrink-0">
                    <img
                      src={opt.imageUrl}
                      alt=""
                      className="w-8 h-8 rounded-lg object-cover border border-gray-200 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => onUpdateOption(opt.id, { imageUrl: '' })}
                      title="Remove this image"
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center shadow"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                )}
                <input
                  type="url"
                  value={opt.imageUrl || ''}
                  onChange={(e) => onUpdateOption(opt.id, { imageUrl: e.target.value })}
                  placeholder="Image URL (optional)"
                  className={cn(SMALL_INPUT, 'min-w-0')}
                />
                {onUploadOptionImage && (
                  <label
                    title="Upload an image from this computer"
                    className={cn(
                      'shrink-0 cursor-pointer px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-blue-500 hover:text-blue-600 transition-colors flex items-center',
                      uploadingOptionId === opt.id && 'opacity-60 cursor-wait',
                    )}
                  >
                    {uploadingOptionId === opt.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Upload className="w-3.5 h-3.5" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingOptionId === opt.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        void handlePickOptionImage(opt.id, file);
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="flex items-center gap-3 px-1 justify-self-start md:justify-self-end">
                <label className="flex items-center space-x-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!opt.recommended}
                    onChange={(e) => onUpdateOption(opt.id, { recommended: e.target.checked })}
                    className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-[0.625rem] font-bold text-gray-600">Recommended</span>
                </label>
                {/* ONCE PER ORDER, or once per piece. The price box is added to
                    the UNIT price, so 100 pieces multiply it by 100 — right for
                    paper, wrong for a die, a proof or a designer's fee. Ticked
                    shows the option's real state, including the catalogue's own
                    default (src/lib/chargeOnce.ts); a click records his choice
                    explicitly, so it holds whatever that default says. */}
                <label
                  className={cn(
                    'flex items-center space-x-1.5',
                    (opt.priceModifier ?? 0) < 0 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  )}
                  title={
                    (opt.priceModifier ?? 0) < 0
                      ? 'A discount is always taken per piece.'
                      : "Added ONCE to this product's line in the basket, whatever the quantity — for a cutting die, a proof or a design fee. Unticked, the price is added to every piece."
                  }
                >
                  <input
                    type="checkbox"
                    checked={isChargedOnce(opt)}
                    disabled={(opt.priceModifier ?? 0) < 0}
                    onChange={(e) => onUpdateOption(opt.id, { chargeOnce: e.target.checked })}
                    className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-[0.625rem] font-bold text-gray-600">Once per line</span>
                </label>
                {/* HIDDEN — off the product page, kept for later. Hiding the
                    pre-selected option hands the default to the first one still
                    showing, or the shop would pre-select the cheapest.
                    ONE write for both: inside an option, every handler rebuilds
                    the question from what was on screen, so a hide and a default
                    move written one after the other kept only the second. */}
                <label
                  className="flex items-center space-x-1.5 cursor-pointer"
                  title={
                    productCopy && opt.hidden === true && opt.hiddenOnProduct === undefined
                      ? 'Hidden in the property library, for every product. Untick to show it on this product anyway.'
                      : 'Not offered to customers. Kept, so you can switch it back.'
                  }
                >
                  <input
                    type="checkbox"
                    checked={opt.hidden === true}
                    onChange={(e) => {
                      const hide = e.target.checked;
                      const heir = hide && opt.isDefault
                        ? field.options.find((o) => o.id !== opt.id && o.hidden !== true)
                        : undefined;
                      // Typed per option: left to infer, the conditional spreads
                      // made a union the compiler compared against the nested
                      // option type for fifteen minutes.
                      onUpdateField({
                        options: field.options.map((o): PrintingFieldOption => {
                          if (o.id === opt.id) {
                            const next: PrintingFieldOption = { ...o, hidden: hide ? true : undefined };
                            if (productCopy) next.hiddenOnProduct = hide;
                            if (heir) next.isDefault = false;
                            return next;
                          }
                          return heir && o.id === heir.id ? { ...o, isDefault: true } : o;
                        }),
                      });
                    }}
                    data-option-hidden={opt.id}
                    className="w-3.5 h-3.5 text-blue-600 rounded focus:ring-blue-500"
                  />
                  <span className="text-[0.625rem] font-bold text-gray-600">Hidden</span>
                </label>
              </div>
              {opt.hidden === true && (opt.subFields?.length ?? 0) > 0 && (
                <p className="md:col-span-2 text-[0.625rem] font-bold text-amber-700">
                  Hidden with its {opt.subFields!.length} nested question{opt.subFields!.length === 1 ? '' : 's'}.
                </p>
              )}
              {/* THE CUT OUTLINE — only inside a shape property. "Automatic" is
                  what the shop already knows (the catalogue's own shapes by id);
                  the drawing beside it is what the customer's tile shows. */}
              {isShapeField(field) && (() => {
                const auto = outlineOf({ ...opt, outline: undefined }, field);
                const shown = outlineOf(opt, field);
                return (
                  <label className="md:col-span-2 flex items-center gap-2 px-1">
                    <span className="text-[0.625rem] font-bold text-gray-600">Outline</span>
                    <select
                      value={opt.outline ?? ''}
                      onChange={(e) => onUpdateOption(opt.id, { outline: (e.target.value || undefined) as never })}
                      data-option-outline={opt.id}
                      className="px-2 py-1 border border-gray-200 rounded-lg text-[0.6875rem] font-bold text-gray-800 bg-white"
                    >
                      <option value="">Automatic ({auto ? OUTLINE_NAMES[auto] : 'not a shape'})</option>
                      <option value="none">Not a shape</option>
                      {OUTLINE_KINDS.map((k) => (
                        <option key={k} value={k}>{OUTLINE_NAMES[k]}</option>
                      ))}
                    </select>
                    {shown && (() => {
                      const icon = iconOutline(shown, 22);
                      return (
                        <svg viewBox="0 0 28 28" className="w-6 h-6 text-gray-700" aria-hidden="true">
                          <path d={icon.d} transform={`translate(${3 + icon.dx} ${3 + icon.dy})`} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray={shown === 'custom' ? '3 2' : undefined} />
                        </svg>
                      );
                    })()}
                  </label>
                );
              })()}
            </div>

            {uploadError[opt.id] && (
              <p className="text-[0.625rem] font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                {uploadError[opt.id]}
              </p>
            )}

            {/* ---------------- OPTIONS INSIDE THIS OPTION ----------------
                The owner asked for "اختيار داخل الاختيار نفسه": questions that
                only exist once this answer is the chosen one. Printed on a roll
                asks about winding; individual stickers ask about a cut shape.

                It mounts THIS SAME component, recursively, so a question inside
                an option has every power a question outside one has —
                surcharges, images, dimensions, translations, a default. There is
                no second, weaker editor to keep in step with this one.

                Everything here writes back through `subFields` on the option, so
                the parent screen persists it with the change it already saves. */}
            {depth < MAX_EDITOR_DEPTH && (
              <div className="pt-1">
                {(opt.subFields ?? []).length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onUpdateOption(opt.id, { subFields: [makeSubField(Date.now())] })}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-dashed border-gray-300 bg-white text-[0.625rem] font-black text-gray-400 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
                    title="Ask a further question, but only when this option is chosen"
                  >
                    <CornerDownRight className="w-3.5 h-3.5" />
                    Add options inside this option
                  </button>
                ) : (
                  <div className="ml-1 pl-3 border-l-2 border-emerald-300 space-y-3">
                    <p className="text-[0.625rem] font-black uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
                      <CornerDownRight className="w-3.5 h-3.5" />
                      Asked only when &ldquo;{opt.label || opt.id}&rdquo; is chosen
                    </p>

                    {/* The questions inside this option can be dragged into the
                        order the customer meets them in — they could not be
                        reordered at all before, only added and removed. */}
                    <SortableList
                      ids={(opt.subFields ?? []).map((f) => f.id)}
                      onReorder={(orderedIds) =>
                        onUpdateOption(opt.id, { subFields: reorderById(opt.subFields ?? [], orderedIds) })
                      }
                      className="space-y-3"
                      renderItem={(subId, { handle }) => {
                      const sub = (opt.subFields ?? []).find((f) => f.id === subId);
                      if (!sub) return null;
                      /** Replace one sub-field in this option's list. */
                      const writeSub = (next: PrintingField) =>
                        onUpdateOption(opt.id, {
                          subFields: (opt.subFields ?? []).map((f) => (f.id === sub.id ? next : f)),
                        });

                      return (
                        <div className="relative bg-white/70 rounded-xl border border-emerald-100 p-3">
                          <DragHandle handle={handle} label="Drag this question" className="absolute top-1.5 right-8" />
                          <button
                            type="button"
                            onClick={() =>
                              onUpdateOption(opt.id, {
                                subFields: (opt.subFields ?? []).filter((f) => f.id !== sub.id),
                              })
                            }
                            title="Remove this question"
                            className="absolute top-2 right-2 text-gray-400 hover:text-red-600 p-1"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>

                          <PrintingFieldEditorBody
                            field={sub}
                            depth={depth + 1}
                            productCopy={productCopy}
                            onUploadOptionImage={onUploadOptionImage}
                            onUpdateField={(patch) => writeSub({ ...sub, ...patch })}
                            onAddOption={() => {
                              const seed = Date.now();
                              writeSub({
                                ...sub,
                                options: [
                                  ...sub.options,
                                  {
                                    id: `subopt-${seed}`,
                                    label: 'New choice',
                                    value: `new-choice-${seed}`,
                                    priceModifier: 0,
                                    // Only the first answer can be the default —
                                    // a field with two defaults prices whichever
                                    // the configurator happens to see last.
                                    isDefault: sub.options.length === 0,
                                  },
                                ],
                              });
                            }}
                            onUpdateOption={(subOptionId, patch) =>
                              writeSub({
                                ...sub,
                                options: sub.options.map((so) => {
                                  if (so.id !== subOptionId) return so;
                                  const updated = { ...so, ...patch };
                                  // `value` follows the label only while it is
                                  // still the label's slug — a hand-written value
                                  // is the owner's and is left alone. Same rule as
                                  // the top-level editor.
                                  if (patch.label !== undefined) {
                                    const wasDerived = !so.value || so.value === slugifyLabel(so.label);
                                    if (wasDerived) updated.value = slugifyLabel(patch.label);
                                  }
                                  return updated;
                                }),
                              })
                            }
                            onSetDefault={(subOptionId) =>
                              writeSub({
                                ...sub,
                                options: sub.options.map((so) => ({ ...so, isDefault: so.id === subOptionId })),
                              })
                            }
                            onRemoveOption={(subOptionId) => {
                              const remaining = sub.options.filter((so) => so.id !== subOptionId);
                              // Never leave a question with answers but no
                              // default: the configurator would fall back to the
                              // cheapest, which is not always what the owner meant.
                              if (remaining.length && !remaining.some((so) => so.isDefault)) {
                                remaining[0] = { ...remaining[0], isDefault: true };
                              }
                              writeSub({ ...sub, options: remaining });
                            }}
                            // 15.5.1 — EXPLICITLY, because this nested instance
                            // builds every one of its handlers here. The arrows
                            // the outer editor was given do NOT reach a question
                            // inside an option; it would have been the one list
                            // on the screen that still could not be reordered.
                            onMoveOption={(subOptionId, direction) => {
                              const from = sub.options.findIndex((so) => so.id === subOptionId);
                              const to = from + direction;
                              if (from < 0 || to < 0 || to >= sub.options.length) return;
                              const options = [...sub.options];
                              [options[from], options[to]] = [options[to], options[from]];
                              writeSub({ ...sub, options, keepOwnerOrder: true });
                            }}
                            onReorderOptions={(orderedIds) =>
                              writeSub({ ...sub, options: reorderById(sub.options, orderedIds), keepOwnerOrder: true })
                            }
                          />
                        </div>
                      );
                      }}
                    />

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateOption(opt.id, {
                          subFields: [...(opt.subFields ?? []), makeSubField(Date.now())],
                        })
                      }
                      className="w-full py-1.5 bg-white border border-dashed border-emerald-300 hover:border-emerald-500 text-[0.6875rem] font-extrabold text-emerald-700 rounded-lg transition-all flex items-center justify-center"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add another question inside this option
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
  );

  return (
    <div className="space-y-3">
      {scopeNote && (
        <p className="text-[0.625rem] font-bold text-gray-500 bg-white/70 border border-gray-200 rounded-lg px-2.5 py-1.5">
          {scopeNote}
        </p>
      )}

      {/* ONE BUTTON FOR THE WHOLE CARD — 15.4.5. Every box below has its own,
          which is the right size for one box and the wrong size for a property
          with fourteen options. */}
      {aiOn && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => void translateWholeField()}
            disabled={batchBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-purple-200 bg-purple-50 text-purple-700 text-[0.6875rem] font-black hover:border-purple-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {batchBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
            <span>{batchBusy ? t('i18nTranslating') : t('i18nTranslateWholeField')}</span>
          </button>
          {batchNote && (
            <p
              role={batchNote.tone === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              className={cn(
                'text-[0.625rem] font-bold rounded-lg px-2 py-1 border',
                batchNote.tone === 'error'
                  ? 'text-red-600 bg-red-50 border-red-100'
                  : 'text-blue-700 bg-blue-50 border-blue-100',
              )}
            >
              {batchNote.text}
            </p>
          )}
        </div>
      )}

      {/* Field name — English is the canonical one every screen falls back to. */}
      <div className="space-y-1.5">
        <label className="block text-[0.625rem] font-black text-gray-500 uppercase">Property name</label>
        <input
          type="text"
          value={field.name}
          disabled={!allowRename}
          onChange={(e) => onUpdateField({ name: e.target.value })}
          placeholder="e.g. Paper type"
          className={cn(INPUT, !allowRename && 'bg-gray-100 text-gray-500 cursor-not-allowed')}
        />
        <LocalizedTextFields
          label="Property name"
          fallback={field.name}
          value={field.nameI18n || {}}
          onChange={(next) => onUpdateField({ nameI18n: next })}
        />
      </div>

      {/* Help text behind the ⓘ next to the field name in the shop. */}
      <div className="space-y-1.5">
        <label className="block text-[0.625rem] font-black text-gray-500 uppercase">
          Help text <span className="normal-case font-bold text-gray-400">(the ⓘ tooltip — optional)</span>
        </label>
        <input
          type="text"
          value={field.description || ''}
          onChange={(e) => onUpdateField({ description: e.target.value })}
          placeholder="One sentence telling the customer how to choose"
          className={INPUT}
        />
        <LocalizedTextFields
          label="Help text"
          fallback={field.description || ''}
          value={field.descriptionI18n || {}}
          onChange={(next) => onUpdateField({ descriptionI18n: next })}
        />
      </div>

      {/* Required. Off by default, and deliberately carrying its own warning:
          the shop once shipped a catalogue where 66 fields were required, and
          any basket filled BEFORE a field existed then failed at payment with
          "Please choose a Paper type" — an error the shopper could not answer,
          because the field was not on the page they had configured. */}
      {/* HOW THE CUSTOMER SEES THE OPTIONS — his choice (round 16, item 4). */}
      <label className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-gray-700">Show the options as</span>
        <select
          value={field.display ?? ''}
          onChange={(e) => onUpdateField({ display: (e.target.value || undefined) as never })}
          data-field-display={field.id}
          className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-bold text-gray-800 bg-white"
        >
          <option value="">Automatic (cards up to six, a list above)</option>
          <option value="cards">Picture cards — shapes are drawn</option>
          <option value="list">A list (dropdown)</option>
        </select>
      </label>
      {/* WHICH QUESTION IS THE CUT — his tick, never read from the name: the
          catalogue's own shape questions start ticked; his own "Form", "Stansform"
          or "Fasong" question is a shape the moment he ticks it, and a "Corner
          shape" or "Hole shape" never is unless he says so. The preview, the
          drawn picture cards and the job sheet's "Cut:" follow it. */}
      <label className="inline-flex items-center space-x-2 cursor-pointer">
        <input
          type="checkbox"
          checked={isShapeField(field)}
          onChange={(e) => onUpdateField({ cutShape: e.target.checked })}
          data-field-cut-shape={field.id}
          className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
        />
        <span className="text-xs font-bold text-gray-700">
          This question chooses the cut shape — the preview, the picture cards and the job sheet draw it
        </span>
      </label>
      {field.options.length > 0 && field.options.every((o) => o.hidden === true) && (
        <p className="text-[0.625rem] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          {field.allowCustomSize
            ? 'Every option is hidden — customers can only type their own size here.'
            : 'Every option is hidden — customers are not asked this question at all, and it is not required of them.'}
        </p>
      )}

      <div className="space-y-1.5">
        <label className="inline-flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!field.required}
            onChange={(e) => onUpdateField({ required: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
          <span className="text-xs font-bold text-gray-700">
            Required — the customer must pick an option
          </span>
        </label>
        {field.required && (
          <p className="text-[0.625rem] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
            The configurator already pre-selects a default, so this changes nothing for a
            normal shopper — but a basket saved before this property existed will now be
            refused at payment. Leave it off unless the order genuinely must not go to
            press without a deliberate choice.
          </p>
        )}
      </div>

      {/* Custom size: an extra card in the configurator where the customer types
          width × height, within the bounds below. */}
      <div className="space-y-2">
        <label className="inline-flex items-center space-x-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!field.allowCustomSize}
            onChange={(e) => onUpdateField({ allowCustomSize: e.target.checked })}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
          <span className="text-xs font-bold text-gray-700">
            Allow custom size — the customer types their own width × height (cm)
          </span>
        </label>

        {field.allowCustomSize && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(
                [
                  { key: 'minWidthCm', label: 'Min W (cm)' },
                  { key: 'maxWidthCm', label: 'Max W (cm)' },
                  { key: 'minHeightCm', label: 'Min H (cm)' },
                  { key: 'maxHeightCm', label: 'Max H (cm)' },
                ] as const
              ).map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-[0.625rem] font-bold text-gray-500 mb-0.5">{label}</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={field[key] ?? ''}
                    onChange={(e) =>
                      onUpdateField({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                    placeholder="—"
                    className={SMALL_INPUT}
                  />
                </div>
              ))}
            </div>
            <p className="text-[0.625rem] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
              Leave a box empty for NO limit on that side. Leave all four empty and the
              customer may enter any size at all.
              {field.options.length === 0 && (
                <span className="block mt-1 text-emerald-900">
                  This property has no preset sizes, so it is a pure free-size field: the
                  customer opens the product and finds two empty cm boxes waiting.
                </span>
              )}
            </p>
            <p className="text-[0.625rem] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              Turn this on for ONE property per product. The configurator has a single
              width × height pair, so two properties asking for a custom size have to
              agree — and when their limits differ, nothing the customer types satisfies both.
            </p>
          </>
        )}
      </div>

      {/* Options */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <span className="block text-[0.6875rem] font-extrabold text-gray-600">
            Options{field.options.length > 0 ? ` (${field.options.length})` : ''}
          </span>
          <span className="text-[0.625rem] font-bold text-gray-400">
            The customer picks exactly one
          </span>
        </div>

        {field.options.length === 0 && (
          <p className="text-[0.6875rem] text-gray-400 p-3 bg-white rounded-xl border border-dashed border-gray-200 text-center">
            No options yet. Add at least one choice the customer can pick.
          </p>
        )}

        {onReorderOptions ? (
          <SortableList
            ids={field.options.map((o) => o.id)}
            onReorder={onReorderOptions}
            className="space-y-2"
            renderItem={(id, { handle }) => {
              const optIdx = field.options.findIndex((o) => o.id === id);
              return optIdx < 0 ? null : renderOption(field.options[optIdx], optIdx, handle);
            }}
          />
        ) : (
          field.options.map((opt, optIdx) => renderOption(opt, optIdx))
        )}

        <button
          type="button"
          onClick={onAddOption}
          className="w-full py-2 bg-white border border-dashed border-gray-300 hover:border-blue-500 hover:bg-blue-50/30 text-xs font-extrabold text-blue-600 rounded-xl transition-all flex items-center justify-center"
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add option
        </button>
      </div>
    </div>
  );
}

