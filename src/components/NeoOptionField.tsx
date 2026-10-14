import React from 'react';
import { ChevronDown, Check, Info, Ruler } from 'lucide-react';
import { PrintingField, PrintingFieldOption } from '../types';
import { NEO } from './NeumorphicSidebar';
import { cn } from '../lib/utils';
import SafeImage from './SafeImage';
import { localized } from '../lib/localizedText';
import { useAuth } from '../App';
import type { TranslationKey } from '../lib/translations';
import NeoColorSwatches, { looksLikeColourField } from './product/NeoColorSwatches';
import NeoSizeGrid, { looksLikeSizeField } from './product/NeoSizeGrid';

/**
 * One printing-option field, rendered HelloPrint-style but in the shop's
 * neumorphic language:
 *
 *  - a header row: bold field name, an ⓘ tooltip when the field carries a
 *    description, and the current selection echoed in brand orange;
 *  - few options (≤ MAX_CARD_OPTIONS) → a grid of raised selection cards, each
 *    with label, a dimensions line (stored or derived from the label), an
 *    optional small illustration, an orange "Recommended" badge, and the
 *    honest surcharge ("+49 kr/st") whenever the option costs anything;
 *  - many options (page counts, run lengths…) → a pressed-in dropdown well
 *    with a chevron, because forty cards is a wall, not a choice;
 *  - a COLOUR field → a row of colour tiles with a "+N" overflow, and a garment
 *    SIZE field → a row of size tiles in real garment order. Both are decided by
 *    the deliberately conservative heuristics the two components export: a field
 *    they misread falls through to the ordinary cards, which are never wrong.
 *
 * Selected = orange ring + slight raise. Unselected cards rest on the surface
 * and raise further on hover. All variant classes are complete literals —
 * Tailwind never sees concatenated class names.
 */

/** Above this many options a card grid stops being scannable — switch to a dropdown. */
const MAX_CARD_OPTIONS = 6;

/**
 * The custom-size sentinel moved to src/lib/optionTree.ts, next to the rest of
 * the option-tree arithmetic, so a node script can test the money without
 * pulling React in. Re-exported here because half the shop imports it from this
 * file and there is no reason to make that half care where it lives.
 */
import { CUSTOM_SIZE_OPTION_ID, makeCustomSizeOption } from '../lib/optionTree';
import { isChargedOnce } from '../lib/chargeOnce';
export { CUSTOM_SIZE_OPTION_ID, makeCustomSizeOption };

/**
 * THE PRINT-SIZE ARITHMETIC MOVED TO src/lib/printSize.ts.
 *
 * It decides whether a customer's artwork is accepted, and it could not be
 * tested here without rendering a React component — the same reason the
 * option-tree pricing lives in src/lib/optionTree.ts. Re-exported because the
 * configurator imports it from this file and there is no reason to make it care
 * where it lives. scripts/test-print-size.mjs is the test that this file could
 * not have.
 */
import { optionDimensions, parseDimensionsMm } from '../lib/printSize';
export { optionDimensions, parseDimensionsMm };
import { iconOutline, outlineOf } from '../lib/shapes';

interface NeoOptionFieldProps {
  field: PrintingField;
  selected?: PrintingFieldOption;
  onSelect: (option: PrintingFieldOption) => void;
  /**
   * What one unit would cost with this option chosen. Optional: the caller that
   * has the product's pricing passes it, and the card then shows the price the
   * way the reference shops do instead of only the difference. Omitted, the card
   * falls back to the surcharge line it always had.
   */
  unitPriceFor?: (option: PrintingFieldOption) => number;
  formatPrice?: (value: number) => string;
  t: (key: TranslationKey) => string;
}

export default function NeoOptionField({ field, selected, onSelect, unitPriceFor, formatPrice, t }: NeoOptionFieldProps) {
  const { language, formatPriceWithVat } = useAuth();

  /** Owner-authored text in the shopper's language, English as the fallback. */
  const fieldName = localized(field.name, field.nameI18n, language);
  const fieldDescription = field.description
    ? localized(field.description, field.descriptionI18n, language)
    : '';
  const optionLabel = (option: PrintingFieldOption) =>
    localized(option.label, option.labelI18n, language);

  /**
   * "+49 kr/st" / "-10 kr/st" — shown whenever the option is not free. A one-off
   * option (a die, a proof, a designer) says "+850 kr engångsavgift" instead: it
   * is added to the order line once, and "/st" would promise the opposite.
   */
  const surchargeText = (option: PrintingFieldOption) => {
    const mod = option.priceModifier || 0;
    return t(isChargedOnce(option) ? 'cfgSurchargeOnce' : 'cfgSurchargePerUnit')
      .replace('{0}', mod > 0 ? `+${mod}` : String(mod));
  };

  // HIS SWITCH FIRST (round 16, item 4): picture cards however many there are,
  // or always a list. Automatic is what it always was — and an explicit choice
  // also overrides the colour-swatch and size-grid layouts below.
  const useDropdown =
    field.display === 'list' ? true : field.display === 'cards' ? false : field.options.length > MAX_CARD_OPTIONS;

  // Picture cards for shapes: an option with no picture of its own is DRAWN
  // from its outline — but only when every option in the field has one or the
  // other, so a row never mixes drawings with blank tiles. When NONE has a
  // picture they are small tiles (sixteen shapes in a few rows); beside real
  // pictures a drawing takes a picture's place and size, so the row lines up.
  const drawOutlines =
    field.display === 'cards' &&
    field.options.some((o) => !o.imageUrl) &&
    field.options.every((o) => o.imageUrl || outlineOf(o, field));
  const outlineTiles = drawOutlines && field.options.every((o) => !o.imageUrl);

  // A field the owner opened up to free sizes keeps the card grid: that is where
  // the "Custom size" card lives, and neither specialised control has a slot for it.
  const specialised = field.allowCustomSize || field.display
    ? null
    : looksLikeColourField(field)
      ? 'colour'
      : looksLikeSizeField(field)
        ? 'size'
        : null;

  // The extra "Custom size" choice (card or dropdown row) on fields that allow it.
  const customOption = field.allowCustomSize ? makeCustomSizeOption(t('cfgCustomSizeCard')) : null;
  const isCustomSelected = selected?.id === CUSTOM_SIZE_OPTION_ID;

  /**
   * HOW MANY CARDS FIT ON A ROW — decided by how many there ARE.
   *
   * It used to be three, always. A field with four choices therefore broke as
   * three and a lonely one underneath, which is precisely what the owner saw on
   * the sticker shapes: choosing "on a roll" adds the oval, and the oval fell to
   * its own line as if it were a different kind of answer. Choices that belong to
   * one question should read as one row.
   *
   * Every class here is a COMPLETE literal. Tailwind v4 scans source text and
   * never sees a class built by concatenation, so `md:grid-cols-${'{n}'}` would
   * compile to nothing at all — a rule this project has been bitten by before.
   */
  const cardCount = field.options.length + (customOption ? 1 : 0);
  const cardGrid = outlineTiles && cardCount >= 4
    // Drawn shapes are small tiles: three to a row on a phone, sixteen shapes in
    // a few rows rather than a screen and a half of cards.
    ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-5'
    : cardCount >= 4
      ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
      : cardCount === 3
        ? 'grid-cols-2 sm:grid-cols-3'
        : 'grid-cols-2';

  return (
    /* TYPE AND SPACE, on one scale (2026-10-13, "airier, easier on the eye"):
         16 px semibold  the question      — the one strong voice in the group
         13 px medium    each answer
         13 px regular   its price         — read, not shouted
         11 px regular   size, surcharge, the answer echoed beside the question
       Spacing on a 4 px grid: 14 px between the question and its answers,
       12 px between cards, 16 px inside one — and the configurator puts 40 px
       between questions, so what belongs together is visibly together. Weight
       and colour carry the hierarchy; nothing is bold just to be seen. */
    <div className="space-y-4">
      {/* The question · ⓘ · the current answer, quietly. The question is a step
          up the scale (16 px against the answers' 13 px, ~1.25×): it says WHAT is
          being chosen, and has to be read before the answers are. */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-base font-semibold tracking-tight text-gray-900">
          <span>{fieldName}</span>
          {fieldDescription && (
            <span title={fieldDescription} aria-label={t('cfgFieldInfo')} className="cursor-help text-gray-300 hover:text-orange-600 transition-colors">
              <Info className="w-4 h-4" />
            </span>
          )}
        </span>
        {selected && (
          <span className="text-xs font-medium text-gray-400 truncate max-w-[50%]">
            {optionLabel(selected) || selected.value}
          </span>
        )}
      </div>

      {specialised === 'colour' ? (
        <NeoColorSwatches
          options={field.options}
          selected={selected}
          onSelect={onSelect}
          labelOf={optionLabel}
          t={t}
        />
      ) : specialised === 'size' ? (
        <NeoSizeGrid
          options={field.options}
          selected={selected}
          onSelect={onSelect}
          labelOf={optionLabel}
          formatPrice={(amount) => formatPriceWithVat(amount).formatted}
          // 15.5.7 — once the owner has arranged this field with the move
          // arrows, his order is the order. Without this the grid would re-sort
          // the tiles into garment order and he would arrange them in the
          // dashboard to no visible effect.
          preserveOrder={field.keepOwnerOrder === true}
          t={t}
        />
      ) : useDropdown ? (
        /* Many options: a pressed-in well with a chevron, not a wall of cards. */
        <div className="relative">
          <select
            value={selected?.id ?? ''}
            onChange={(e) => {
              if (customOption && e.target.value === CUSTOM_SIZE_OPTION_ID) {
                onSelect(customOption);
                return;
              }
              const opt = field.options.find((o) => o.id === e.target.value);
              if (opt) onSelect(opt);
            }}
            aria-label={fieldName}
            className={cn(
              // outline-none with nothing in its place left a keyboard user with
              // no idea which control they were on.
              'w-full appearance-none rounded-2xl px-4 py-3.5 pr-10 bg-[#e9ebf2] text-[0.8125rem] font-medium text-gray-800 outline-none cursor-pointer',
              'focus-visible:ring-2 focus-visible:ring-orange-500',
              NEO.inset,
            )}
          >
            {field.options.map((option) => {
              const dims = optionDimensions(option);
              const mod = option.priceModifier || 0;
              return (
                <option key={option.id} value={option.id}>
                  {optionLabel(option)}
                  {dims ? ` (${dims})` : ''}
                  {mod !== 0 ? ` — ${surchargeText(option)}` : ''}
                </option>
              );
            })}
            {customOption && (
              <option value={CUSTOM_SIZE_OPTION_ID}>{customOption.label}</option>
            )}
          </select>
          <ChevronDown className="w-4 h-4 text-gray-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      ) : (
        /* Few options: HelloPrint-style visual selection cards, as many per row as
           there are choices (up to four). */
        <div className={cn('grid gap-3 pt-2', cardGrid)}>
          {field.options.map((option) => {
            const isSelected = selected?.id === option.id;
            const dims = optionDimensions(option);
            const mod = option.priceModifier || 0;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onSelect(option)}
                aria-pressed={isSelected}
                /* Names this button for what it is. `aria-pressed` alone also
                   matches the tax toggle, the gallery arrows and the language
                   switch, so a test asking "do all option cards show a price?"
                   was counting half the header as an unpriced option. */
                data-option-card={option.id}
                className={cn(
                  'relative p-4 rounded-2xl text-left flex flex-col h-full transition-all duration-300',
                  NEO.card,
                  NEO.ease,
                  isSelected
                    ? 'ring-2 ring-orange-500/70 text-gray-900 shadow-[8px_8px_18px_#c9cdd8,-8px_-8px_18px_#ffffff]'
                    : 'text-gray-700 shadow-[5px_5px_12px_#c9cdd8,-5px_-5px_12px_#ffffff] hover:shadow-[8px_8px_18px_#c9cdd8,-8px_-8px_18px_#ffffff]',
                )}
              >
                {/* A tint, not a gradient: it should help a choice, not outshout it. */}
                {option.recommended && (
                  <span className="absolute -top-2.5 left-4 z-10 px-2 py-0.5 rounded-full text-[0.5625rem] font-semibold uppercase tracking-wider text-orange-700 bg-orange-100 ring-1 ring-orange-200/80">
                    {t('cfgRecommended')}
                  </span>
                )}

                {/* An option illustration is decoration. Some of the URLs in the
                    shop's own data point at supplier sites that refuse to serve
                    them, so this must vanish rather than leave a grey broken tile
                    in the middle of a row of otherwise clean cards. */}
                {/* A shape with no picture: its outline, drawn. */}
                {!option.imageUrl && drawOutlines && (() => {
                  const kind = outlineOf(option, field);
                  if (!kind) return null;
                  const icon = iconOutline(kind, 40);
                  return (
                    <svg
                      viewBox="0 0 48 48"
                      className={cn(
                        'mx-auto text-gray-700',
                        outlineTiles ? 'w-10 h-10 mb-1.5' : 'w-full h-28 sm:h-32 lg:h-36 mb-2 p-6',
                      )}
                      aria-hidden="true"
                      data-rx-outline-tile={kind}
                    >
                      <path
                        d={icon.d}
                        transform={`translate(${4 + icon.dx} ${4 + icon.dy})`}
                        fill={isSelected ? '#fed7aa' : 'none'}
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeDasharray={kind === 'custom' ? '4 3' : undefined}
                      />
                    </svg>
                  );
                })()}
                {option.imageUrl && (
                  <div className="w-full h-28 sm:h-32 lg:h-36 mb-2 rounded-xl overflow-hidden bg-white/60 empty:hidden">
                    {/* CONTAIN, not cover.
                        Most of these pictures are diagrams — a shape outline, a
                        fold, a winding direction — and `object-cover` cropped
                        them to the tile: a circle came out as two arcs and a
                        square as two vertical bars, so the three shapes a
                        customer is choosing between looked identical. A
                        photograph loses nothing by being shown whole; a diagram
                        loses everything by being cropped. */}
                    {/* A FIXED HEIGHT FOR THE BOX, the picture's own shape
                        inside it.

                        Both previous attempts were wrong, and the owner said so
                        about each. `h-14` made every illustration a 56px
                        thumbnail nobody looked at. `h-auto max-h-72` then let
                        the SOURCE set the height — height = card width / the
                        image's own ratio — so every card in one row came out a
                        different height (his "once they were big and once they
                        became small"), the whole card grew to 368px against a
                        366px product photo (his "the option image is bigger
                        than the product image itself"), and the 180px supplier
                        thumbnails this shop actually uses were stretched to
                        288px and went soft.

                        A fixed, stepped box height fixes all three at once: one
                        height per row whatever the pictures are, always a
                        clear fraction of the product photo beside it, and no
                        upscaling of a 180px source. object-contain keeps the
                        shape he asked to keep — these are diagrams, and a crop
                        turns a circle into two arcs. 112 / 128 / 144px is
                        2 to 2.5 times the old thumbnail and about a third of
                        the product image at every width. */}
                    <SafeImage
                      src={option.imageUrl}
                      alt={optionLabel(option)}
                      hideOnError
                      className="w-full h-full object-contain p-1.5"
                    />
                  </div>
                )}

                <span className="flex items-start justify-between gap-2 w-full">
                  <span className="text-[0.8125rem] font-medium leading-snug">{optionLabel(option)}</span>
                  {isSelected && (
                    <span className="w-4 h-4 mt-0.5 rounded-full bg-orange-600 flex items-center justify-center flex-shrink-0">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </span>
                  )}
                </span>

                {dims && (
                  <span className="text-[0.6875rem] font-normal text-gray-400 mt-1">{dims}</span>
                )}

                {/* THE PRICE, then what it adds — in that order.
                    A card that reads only "+150 kr" tells a shopper what an
                    option costs EXTRA and never what the thing costs, so three
                    sizes side by side could not be compared on price at all. The
                    figure is the same one the basket and the server arrive at,
                    because it comes from the same pricing function. */}
                {/* mt-auto: the price sits on the card's floor, so a row of cards
                    with one- and three-line titles still reads its prices on one line. */}
                <span className="mt-auto pt-3 flex items-baseline gap-2 flex-wrap">
                  {unitPriceFor && formatPrice ? (
                    <>
                      <span className="text-[0.8125rem] font-normal tabular-nums text-gray-900">
                        {formatPrice(unitPriceFor(option))}
                      </span>
                      {mod !== 0 && (
                        <span className="text-[0.6875rem] font-normal tabular-nums text-gray-400">
                          {surchargeText(option)}
                        </span>
                      )}
                    </>
                  ) : (
                    <span
                      className={cn(
                        'text-[0.6875rem] font-normal tabular-nums',
                        mod !== 0 ? 'text-gray-500' : 'text-gray-400',
                      )}
                    >
                      {mod !== 0 ? surchargeText(option) : t('cfgPriceIncluded')}
                    </span>
                  )}
                </span>
              </button>
            );
          })}

          {/* "Custom size" card — the customer types width × height themselves. */}
          {customOption && (
            <button
              type="button"
              onClick={() => onSelect(customOption)}
              aria-pressed={isCustomSelected}
              className={cn(
                'relative p-4 rounded-2xl text-left flex flex-col h-full transition-all duration-300',
                NEO.card,
                NEO.ease,
                isCustomSelected
                  ? 'ring-2 ring-orange-500/70 text-gray-900 shadow-[8px_8px_18px_#c9cdd8,-8px_-8px_18px_#ffffff]'
                  : 'text-gray-700 shadow-[5px_5px_12px_#c9cdd8,-5px_-5px_12px_#ffffff] hover:shadow-[8px_8px_18px_#c9cdd8,-8px_-8px_18px_#ffffff]',
              )}
            >
              <span className="flex items-start justify-between gap-2 w-full">
                <span className="text-[0.8125rem] font-medium leading-snug flex items-center gap-1.5">
                  <Ruler className="w-3.5 h-3.5 text-orange-600 flex-shrink-0" />
                  <span>{customOption.label}</span>
                </span>
                {isCustomSelected && (
                  <span className="w-4 h-4 mt-0.5 rounded-full bg-orange-600 flex items-center justify-center flex-shrink-0">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </span>
                )}
              </span>
              <span className="text-[0.6875rem] font-normal text-gray-400 mt-1">… × … cm</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
