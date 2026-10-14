import React, { useMemo, useRef } from 'react';
import { Check } from 'lucide-react';
import { NEO } from '../NeumorphicSidebar';
import { cn } from '../../lib/utils';
import type { PrintingField, PrintingFieldOption } from '../../types';
import type { TranslationKey } from '../../lib/translations';

/**
 * The garment size picker: a row of small raised tiles (S · M · L · XL · XXL),
 * the size code font-black in the middle and its surcharge in orange beneath.
 *
 * The HelloPrint reference lets the shopper type a quantity into every size box
 * at once; our cart line carries exactly ONE size, so this renders the same grid
 * as a single select and the run quantity stays where it already lives — the
 * field's own quantity input — rather than being split per size.
 *
 * Tiles are ordered by real garment order, not alphabetically and not by the
 * order the options happen to sit in the database, so 'XL' comes before 'XXL'
 * comes before '3XL'. Selected = orange ring + slight raise, exactly like
 * NeoOptionField's cards, and every variant class is a complete literal because
 * Tailwind cannot see class names built by concatenation.
 */

/** Canonical garment sizes, smallest → largest. Tile order comes from this. */
const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'] as const;

type CanonicalSize = (typeof SIZE_ORDER)[number];

/**
 * Every spelling of a garment size we accept, folded onto its canonical code.
 * Deliberately short: this table doubles as the vocabulary that decides whether
 * a whole field is a size field, so a loose entry would start capturing paper
 * formats and finishes.
 */
const SIZE_ALIASES: Record<string, CanonicalSize> = {
  XXS: 'XXS',
  '2XS': 'XXS',
  XS: 'XS',
  XSMALL: 'XS',
  EXTRASMALL: 'XS',
  S: 'S',
  SMALL: 'S',
  M: 'M',
  MED: 'M',
  MEDIUM: 'M',
  L: 'L',
  LG: 'L',
  LARGE: 'L',
  XL: 'XL',
  XLARGE: 'XL',
  EXTRALARGE: 'XL',
  XXL: 'XXL',
  '2XL': 'XXL',
  XXLARGE: 'XXL',
  XXXL: '3XL',
  '3XL': '3XL',
  XXXXL: '4XL',
  '4XL': '4XL',
  XXXXXL: '5XL',
  '5XL': '5XL',
};

/**
 * The canonical size a label stands for, or null when it is not a size at all.
 * Punctuation and spacing are dropped first, so "X-Large" and "x large" both
 * land on XL — but "A4" stays unrecognised, which is the whole point.
 */
function canonicalSize(label: string | undefined): CanonicalSize | null {
  const key = (label || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!key) return null;
  return SIZE_ALIASES[key] ?? null;
}

/** The rank a tile sorts by; unrecognised labels share the last rank. */
function sizeRank(option: PrintingFieldOption, label: string): number {
  const canonical = canonicalSize(label) ?? canonicalSize(option.label) ?? canonicalSize(option.value);
  return canonical ? SIZE_ORDER.indexOf(canonical) : SIZE_ORDER.length;
}

/** Field names in the four shop languages that announce a size field. */
const SIZE_NAME_HINTS = ['size', 'storlek', 'storrelse', 'stoerrelse'];

/**
 * Accent-free lowercase, so "Størrelse" (da/no) and "Strl." compare against the
 * plain-ASCII hints above. NFD strips the combining marks; ø carries none, so it
 * gets replaced by hand.
 */
function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o');
}

/**
 * True when a field's options are garment sizes (S, M, L, XL, XXL, 3XL, XS...).
 *
 * Both halves have to agree: the field must NAME itself a size (in any of the
 * four shop languages) and at least 60% of its options must read as sizes. The
 * second half is what keeps a paper-format field — "Size: A4, A5, A6" — out,
 * since those labels are in nobody's size vocabulary.
 */
export function looksLikeSizeField(field: PrintingField): boolean {
  const options = field.options ?? [];
  if (options.length === 0) return false;

  // The owner may have named the field in one language only, so every stored
  // spelling of the name counts, plus the machine `code` when there is one.
  const named = foldName(
    [field.name, field.code ?? '', ...Object.values(field.nameI18n ?? {})].join(' '),
  );
  if (!SIZE_NAME_HINTS.some((hint) => named.includes(hint))) return false;

  const sizeLike = options.filter(
    (option) => canonicalSize(option.label) !== null || canonicalSize(option.value) !== null,
  ).length;
  return sizeLike / options.length >= 0.6;
}

export interface NeoSizeGridProps {
  options: PrintingFieldOption[];
  selected?: PrintingFieldOption;
  onSelect: (option: PrintingFieldOption) => void;
  labelOf: (option: PrintingFieldOption) => string;
  formatPrice: (amount: number) => string;
  /** The field's `keepOwnerOrder`: show the tiles exactly as stored. */
  preserveOrder?: boolean;
  t: (key: TranslationKey) => string;
}

export default function NeoSizeGrid({
  options,
  selected,
  onSelect,
  labelOf,
  formatPrice,
  preserveOrder,
  t,
}: NeoSizeGridProps) {
  // Arrow keys move the selection AND the focus, so the tile that is now
  // selected is the tile the next arrow press steps from.
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  /**
   * Size order, UNLESS the owner has arranged this field himself — 15.5.7.
   *
   * Sorting into real garment order (S before M before L, never alphabetical)
   * is right for a field nobody has touched, and wrong the moment he has
   * pressed the move arrows: he would arrange the list in the dashboard, open
   * the shop, and find the old order — which is the complaint this round
   * started from. `preserveOrder` is the field's own `keepOwnerOrder`, set the
   * first time an arrow is pressed on it.
   */
  const ordered = useMemo(() => {
    if (preserveOrder) return options;
    return options
      .map((option, index) => ({ option, index, rank: sizeRank(option, labelOf(option)) }))
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.option);
  }, [options, labelOf, preserveOrder]);

  if (ordered.length === 0) return null;

  /** "+49,00 kr" / "−20,00 kr" — the caller owns the money formatting. */
  const surchargeText = (modifier: number) => {
    const key: TranslationKey = modifier > 0 ? 'ppSizeSurcharge' : 'ppSizeDiscount';
    return t(key).replace('{0}', formatPrice(Math.abs(modifier)));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + ordered.length) % ordered.length;
    onSelect(ordered[next]);
    tileRefs.current[next]?.focus();
  };

  return (
    <div className="space-y-2">
      <div role="group" aria-label={t('ppSizeGridLabel')} className="flex flex-wrap gap-2.5 pt-1">
        {ordered.map((option, index) => {
          const isSelected = selected?.id === option.id;
          const modifier = option.priceModifier || 0;
          return (
            <button
              key={option.id}
              ref={(node) => {
                tileRefs.current[index] = node;
              }}
              type="button"
              onClick={() => onSelect(option)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              aria-pressed={isSelected}
              className={cn(
                'relative min-w-14 min-h-14 px-3 py-2 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all duration-300',
                NEO.card,
                NEO.ease,
                isSelected
                  ? 'ring-2 ring-orange-500 -translate-y-0.5 text-gray-900 shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]'
                  : 'text-gray-700 shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff] hover:shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff] hover:-translate-y-0.5',
              )}
            >
              {isSelected && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-white" />
                </span>
              )}

              <span className="text-sm font-black leading-none whitespace-nowrap">
                {labelOf(option) || option.value}
              </span>

              {modifier !== 0 && (
                <span className="text-[0.5625rem] font-black leading-none text-orange-600 whitespace-nowrap">
                  {surchargeText(modifier)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Says out loud why there is no per-size quantity box, unlike the reference. */}
      <p className="text-[0.625rem] font-bold text-gray-500">{t('ppSizeGridOneSizeHint')}</p>
    </div>
  );
}
