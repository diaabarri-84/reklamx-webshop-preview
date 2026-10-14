import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { NEO } from '../NeumorphicSidebar';
import { cn } from '../../lib/utils';
import { useAuth } from '../../App';
import VatTag from '../VatTag';
import type { Language, TranslationKey } from '../../lib/translations';
import type { QuantityLadderRow } from '../../lib/quantityLadder';

/**
 * The quantity price ladder — the piece of the HelloPrint reference the client
 * actually pointed at — rebuilt in the shop's neumorphic language:
 *
 *  - a free-entry row FIRST: a pressed-in well where the customer types any
 *    quantity, committed on Enter and on blur and clamped to the product's
 *    min/max, because the ladder steps are suggestions, not a menu;
 *  - then one raised strip per ladder step: quantity, the list unit price
 *    struck through beside the discounted one, the line total, and an orange
 *    savings pill;
 *  - the strip matching the configured quantity carries the orange ring and
 *    stays raised, exactly like a selected NeoOptionField card;
 *  - everything past `initialVisible` hides behind "Show more", so a nine-step
 *    ladder does not bury the rest of the configurator.
 *
 * It does NO arithmetic. Every unit price, total and percentage arrives already
 * computed on `rows`, so the ladder can never disagree with the price the cart
 * charges — one formula, one owner.
 */

// The row shape is owned by lib/quantityLadder, which computes it. Re-exported
// here so a caller that only renders a ladder imports from one place.
export type { QuantityLadderRow } from '../../lib/quantityLadder';

interface NeoQuantityLadderProps {
  rows: QuantityLadderRow[];
  /** The quantity currently configured; the matching row is highlighted. */
  quantity: number;
  onPick: (quantity: number) => void;
  /** Formats a net SEK amount for display, VAT mode already applied by the caller. */
  formatPrice: (amount: number) => string;
  t: (key: TranslationKey) => string;
  /** Rows beyond this many hide behind a "Show more" toggle. Default 6. */
  initialVisible?: number;
  minQuantity?: number;
  maxQuantity?: number;
}

/**
 * One literal shared by the header, the free-entry row and every ladder strip.
 *
 * Each row is its own grid container (they have to be — a row is a <button>),
 * so the tracks must size identically without looking at their contents or the
 * columns drift apart from row to row. Hence fixed rems and minmax(0,1fr):
 * `auto` would resolve differently in every row. The fr tracks are allowed to
 * shrink below their content so the unit-price cell wraps the struck-through
 * figure onto its own line on a narrow phone instead of overflowing.
 */
const ROW_GRID =
  'grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1.35fr)_3.5rem] items-center gap-2';

/** Raised at rest, further on hover; the shop's selected/unselected shadow pair. */
const REST_STRIP =
  'shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff] hover:shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff] hover:-translate-y-0.5';
const PICKED_STRIP =
  'ring-2 ring-orange-500 -translate-y-0.5 shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]';

/** Thousands grouping for the quantity integer ("1 000 st"), per shop language. */
const NUMBER_LOCALE: Record<Language, string> = {
  en: 'en-GB',
  sv: 'sv-SE',
  da: 'da-DK',
  no: 'nb-NO',
};

/** Digits only, so a pasted "1 000" or "1.000" still parses. NaN when empty. */
function parseQuantity(raw: string): number {
  const digits = raw.replace(/\D+/g, '');
  return digits ? Number.parseInt(digits, 10) : Number.NaN;
}

export default function NeoQuantityLadder({
  rows,
  quantity,
  onPick,
  formatPrice,
  t,
  initialVisible = 6,
  minQuantity = 1,
  maxQuantity,
}: NeoQuantityLadderProps) {
  const { language } = useAuth();

  const formatQuantity = useMemo(() => {
    const nf = new Intl.NumberFormat(NUMBER_LOCALE[language]);
    return (value: number) => nf.format(value);
  }, [language]);

  const selectedIndex = rows.findIndex((row) => row.quantity === quantity);
  /** No ladder step matches, so the configured quantity was typed by hand. */
  const isCustomQuantity = selectedIndex === -1;

  const [draft, setDraft] = useState(() => (isCustomQuantity ? String(quantity) : ''));

  /**
   * Keep the free-entry box honest about what is configured: it holds a
   * hand-typed quantity and empties the moment a ladder step is picked. Both
   * dependencies are primitives, so a parent that rebuilds `rows` on every
   * render cannot wipe what the customer is halfway through typing.
   */
  useEffect(() => {
    setDraft(isCustomQuantity ? String(quantity) : '');
  }, [isCustomQuantity, quantity]);

  const visibleCount = Math.max(1, initialVisible);
  const [expanded, setExpanded] = useState(() => selectedIndex >= visibleCount);

  /** A quantity set from outside must not sit hidden under "Show more". */
  useEffect(() => {
    if (selectedIndex >= visibleCount) setExpanded(true);
  }, [selectedIndex, visibleCount]);

  /**
   * NO SAVING, NO LADDER. A ladder whose every step costs the same per piece
   * promises a discount that is not there (the client's audit, 2026-10-10:
   * Stand Vista A4 offered 1, 2, 4, 10, 20 and 30 pieces, all at 592 SEK each).
   * With no saving anywhere it shows only the step that is configured, and the
   * free-entry row above it does the rest. A real price break brings it back.
   */
  const hasSavings = rows.some((row) => row.savingsPercent > 0);
  const ladderRows = hasSavings ? rows : rows.filter((row) => row.quantity === quantity);
  const visibleRows = expanded ? ladderRows : ladderRows.slice(0, visibleCount);
  const hasHiddenRows = ladderRows.length > visibleCount;

  /**
   * The free-entry row echoes prices only when the typed number lands exactly
   * on a ladder step — anywhere else we genuinely do not know the price and a
   * guess here would be a second pricing formula. Em dash until the parent
   * recalculates and hands us a row for it.
   */
  const draftRow = useMemo(() => {
    const typed = parseQuantity(draft);
    return Number.isNaN(typed) ? undefined : rows.find((row) => row.quantity === typed);
  }, [draft, rows]);

  const commitDraft = () => {
    const typed = parseQuantity(draft);
    if (Number.isNaN(typed) || typed <= 0) {
      setDraft(isCustomQuantity ? String(quantity) : '');
      return;
    }
    const ceiling = maxQuantity ?? Number.MAX_SAFE_INTEGER;
    const clamped = Math.min(Math.max(typed, minQuantity), ceiling);
    // Show the clamp rather than silently ordering something else than typed.
    setDraft(rows.some((row) => row.quantity === clamped) ? '' : String(clamped));
    if (clamped !== quantity) onPick(clamped);
  };

  return (
    <div className="space-y-3">
      {/*
        The strips are buttons, not table rows, so the visual header would only
        add loose text for a screen reader to trip over — each button already
        announces its own quantity, unit price and total.
      */}
      <div className="overflow-x-auto pt-3 pb-1">
        <div className="min-w-[19rem] space-y-2.5">
          <div className={cn(ROW_GRID, 'px-4 items-end')} aria-hidden="true">
            <span />
            <span className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400 text-right leading-tight">
              {t('ppQtyHeaderUnitPrice')}
            </span>
            <span className="flex flex-wrap items-baseline justify-end gap-x-1.5 text-[0.625rem] font-black uppercase tracking-wider text-gray-400 text-right leading-tight">
              <span>{t('ppQtyHeaderTotal')}</span>
              <VatTag />
            </span>
            <span />
          </div>

          {/* Free entry, first — the reference puts it above the steps too. */}
          <div
            className={cn(
              ROW_GRID,
              'w-full px-4 py-2.5 rounded-2xl transition-all duration-300',
              NEO.card,
              NEO.ease,
              isCustomQuantity ? PICKED_STRIP : 'shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff]',
            )}
          >
            <input
              type="text"
              inputMode="numeric"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault(); // never submit the configurator form
                commitDraft();
              }}
              onBlur={commitDraft}
              placeholder={t('ppQtyCustomPlaceholder')}
              aria-label={t('ppQtyCustomAria')}
              data-rx-qty-custom
              className={cn(
                'w-full min-w-0 rounded-full bg-[#e9ebf2] px-3 py-1.5 text-xs font-black text-gray-900 outline-none placeholder:font-bold placeholder:text-gray-400 focus:ring-2 focus:ring-orange-500',
                NEO.inset,
              )}
            />

            <span className="flex items-baseline justify-end text-xs font-extrabold text-gray-400">
              {draftRow ? (
                <span className="text-gray-800">{formatPrice(draftRow.unitPrice)}</span>
              ) : (
                <span aria-hidden="true">—</span>
              )}
            </span>

            <span className="flex items-baseline justify-end text-xs font-black text-gray-400">
              {draftRow ? (
                <span className="text-gray-900">{formatPrice(draftRow.total)}</span>
              ) : (
                <span aria-hidden="true">—</span>
              )}
            </span>

            <span />
          </div>

          {visibleRows.map((row) => {
            const isPicked = row.quantity === quantity;
            const savings = Math.round(row.savingsPercent);
            const hasSavings = savings > 0;
            const quantityLabel = t('ppQtyUnitSuffix').replace('{0}', formatQuantity(row.quantity));

            // The button's own text reads badly out of context ("20,83 kr
            // 12,50 kr"), so it gets a spoken sentence instead; the parts are
            // joined rather than one long key so each stays translatable alone.
            const spoken = [
              t('ppQtyRowAria')
                .replace('{0}', formatQuantity(row.quantity))
                .replace('{1}', formatPrice(row.unitPrice))
                .replace('{2}', formatPrice(row.total)),
              hasSavings ? t('ppQtySavingsAria').replace('{0}', String(savings)) : '',
              row.recommended ? t('ppQtyRecommended') : '',
            ]
              .filter(Boolean)
              .join(', ');

            return (
              <button
                key={row.quantity}
                type="button"
                onClick={() => onPick(row.quantity)}
                aria-pressed={isPicked}
                aria-label={spoken}
                className={cn(
                  ROW_GRID,
                  'relative w-full px-4 py-3 rounded-2xl text-left transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-orange-500',
                  NEO.card,
                  NEO.ease,
                  isPicked ? PICKED_STRIP : REST_STRIP,
                )}
              >
                {row.recommended && (
                  <span className="absolute -top-2 left-4 z-10 px-2 py-0.5 rounded-full text-[0.5625rem] font-black uppercase tracking-wider text-white bg-gradient-to-br from-orange-500 to-orange-700 shadow-[3px_3px_8px_#c9cdd8]">
                    {t('ppQtyRecommended')}
                  </span>
                )}

                <span className="text-xs font-black text-gray-900 whitespace-nowrap">
                  {quantityLabel}
                </span>

                <span className="flex flex-wrap items-baseline justify-end gap-x-1.5">
                  {hasSavings && (
                    <span className="text-[0.625rem] font-bold text-gray-400 line-through whitespace-nowrap">
                      {formatPrice(row.listUnitPrice)}
                    </span>
                  )}
                  <span
                    className={cn(
                      'text-xs font-extrabold whitespace-nowrap',
                      isPicked ? 'text-orange-600' : 'text-gray-800',
                    )}
                  >
                    {formatPrice(row.unitPrice)}
                  </span>
                </span>

                <span className="text-right text-xs font-black text-gray-900 whitespace-nowrap">
                  {formatPrice(row.total)}
                </span>

                <span className="flex justify-end">
                  {hasSavings && (
                    <span className="px-2 py-0.5 rounded-full text-[0.5625rem] font-black text-white whitespace-nowrap bg-gradient-to-br from-orange-500 to-orange-700">
                      {t('ppQtySavingsPill').replace('{0}', String(savings))}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Outside the scroller so it stays centred and tappable on any phone. */}
      {hasHiddenRows && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mx-auto flex items-center gap-1 text-[0.6875rem] font-black text-orange-600 hover:text-orange-700 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-orange-500 rounded-full px-2 py-0.5"
        >
          <span>{expanded ? t('ppQtyShowLess') : t('ppQtyShowMore')}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}
