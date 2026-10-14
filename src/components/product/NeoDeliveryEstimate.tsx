import { useId, useMemo } from 'react';
import { CalendarClock, Check } from 'lucide-react';
import type { DeliveryOption } from '../../types';
import { NEO } from '../NeumorphicSidebar';
import { cn } from '../../lib/utils';
import type { TranslationKey } from '../../lib/translations';
import { dayToShow, firstWorkingDay, promisedDay, speedRangeOf } from '../../lib/productionSpeed';

/**
 * The estimated-delivery block, HelloPrint-style but in our neumorphic orange:
 * one raised, full-width button per delivery speed, each promising a real
 * calendar date ("Fredag 28 augusti") rather than the abstract "3-5 Business
 * Days" the shop owner actually typed, with the guaranteed-by date underneath
 * and the surcharge on the right when the speed costs extra. Below the list,
 * one quiet line telling the customer when their artwork has to be approved.
 *
 * Selected = orange ring + slight raise, same language as NeoOptionField.
 * All variant classes are complete literals — Tailwind never sees a
 * concatenated class name.
 */

/** Our four shop languages mapped to the locale tags Intl actually knows. */
const LOCALE_TAGS: Record<string, string> = {
  en: 'en-GB',
  sv: 'sv-SE',
  da: 'da-DK',
  no: 'nb-NO',
};

/*
 * The lead time is read by src/lib/productionSpeed.ts — the same reading the
 * server promises the order on: a number counts only with its unit after it
 * ("order before 12:00" is not a lead time), "24 timmar" is one day, a range
 * "3–5 working days" is [fastest, slowest]. Nothing countable → no date, rather
 * than one we cannot defend. The days are counted on the shop's (Swedish)
 * calendar, as the order is, and shown as exactly that day.
 */

/** What one row of the list ended up being able to say. */
interface EstimateRow {
  option: DeliveryOption;
  /** Formatted arrival date, or undefined when the lead time was unparseable. */
  arrival?: string;
  /** Formatted guaranteed-by date; only set when the lead time is a real range. */
  guaranteed?: string;
}

interface NeoDeliveryEstimateProps {
  /** The product's delivery speeds. DeliveryOption is already declared in src/types. */
  options: DeliveryOption[];
  selectedId?: string;
  onSelect: (id: string) => void;
  formatPrice: (amount: number) => string;
  t: (key: TranslationKey) => string;
  /** The shopper's language, so dates read 'fredag 28 augusti' in Swedish. */
  language: string;
  /** Injected so the component stays pure and testable; defaults to new Date(). */
  now?: Date;
  /**
   * His standard transit days: a speed is working days until DISPATCH, and the
   * heading promises DELIVERY — the date the order will be promised on.
   */
  transitDays?: number;
  /** His Site Settings' "skip weekends", as the promised date counts. */
  skipWeekends?: boolean;
}

export default function NeoDeliveryEstimate({
  options,
  selectedId,
  onSelect,
  formatPrice,
  t,
  language,
  now,
  transitDays = 0,
  skipWeekends = true,
}: NeoDeliveryEstimateProps) {
  const headingId = useId();

  // Resolved in a memo rather than a default parameter: `new Date()` in a
  // default mints a fresh object on every render and would re-run every
  // downstream memo for nothing. A caller passing an invalid Date still gets
  // today instead of "Invalid Date" on the page.
  const today = useMemo(
    () => (now && !Number.isNaN(now.getTime()) ? now : new Date()),
    [now],
  );

  const formatDay = useMemo(() => {
    const base = (language || '').slice(0, 2).toLowerCase();
    const tag = LOCALE_TAGS[base] ?? LOCALE_TAGS.en;
    // timeZone UTC: the days arrive as noon UTC on the shop's day (dayToShow), so
    // a browser in any zone names that day.
    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    } catch {
      formatter = new Intl.DateTimeFormat(LOCALE_TAGS.en, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    }
    // Swedish, Danish and Norwegian write weekday names in lower case. A date
    // that stands alone as the headline of a row still takes a capital, the way
    // any line does; one substituted INTO a sentence ("Senast fredag 21
    // augusti", "Ladda upp ... senast onsdag 19 augusti") must not, or the
    // sentence is simply misspelt.
    return (day: string, position: 'headline' | 'inline' = 'headline') => {
      if (!day) return '';
      const text = formatter.format(dayToShow(day));
      if (position === 'inline') return text;
      return text.charAt(0).toUpperCase() + text.slice(1);
    };
  }, [language]);

  const rows: EstimateRow[] = useMemo(
    () =>
      options.map((option) => {
        const lead = option.lead ?? speedRangeOf({ label: option.deliveryDays });
        if (!lead) return { option };
        const transit = Math.max(0, Number(transitDays) || 0);
        return {
          option,
          // Counted the way the order is promised: working days from today, the
          // production days plus his standard transit.
          arrival: formatDay(promisedDay(today, lead.min + transit, skipWeekends)) || undefined,
          // A single-value lead time ("24 Hours") has no slower bound to
          // promise, so the "no later than" line is simply left off.
          guaranteed:
            lead.max > lead.min
              ? formatDay(promisedDay(today, lead.max + transit, skipWeekends), 'inline') || undefined
              : undefined,
        };
      }),
    [options, today, formatDay, transitDays, skipWeekends],
  );

  // Production on the fastest speed starts the moment the files are approved,
  // so the upload cut-off is the earliest option's own start: the next working
  // day. Only claimed when at least one row produced a real date — promising a
  // deadline for lead times we could not read would be a guess.
  const deadline = rows.some((row) => row.arrival)
    ? formatDay(firstWorkingDay(today, skipWeekends), 'inline') || null
    : null;

  // No speeds configured on the product: no heading, no empty box, nothing.
  if (options.length === 0) return null;

  return (
    <div className="space-y-2.5">
      <span id={headingId} className="block text-xs font-extrabold text-gray-900">
        {t('ppDeliveryEstimateTitle')}
      </span>

      <div role="group" aria-labelledby={headingId} className="space-y-2.5">
        {rows.map(({ option, arrival, guaranteed }) => {
          const isSelected = selectedId === option.id;
          const surcharge = option.priceSurcharge || 0;
          // Fall back to the owner's raw text, then to the speed's name — never
          // to an empty row and never to a fabricated date.
          const headline = arrival ?? (option.deliveryDays?.trim() || option.name?.trim() || '');
          const name = option.name?.trim();
          const showName = Boolean(name) && name !== headline;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              data-rx-speed={option.id}
              aria-pressed={isSelected}
              className={cn(
                'w-full p-3.5 rounded-2xl text-left flex items-start justify-between gap-3 transition-all duration-300',
                NEO.card,
                NEO.ease,
                isSelected
                  ? 'ring-2 ring-orange-500 -translate-y-0.5 shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]'
                  : 'shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff] hover:shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff] hover:-translate-y-0.5',
              )}
            >
              <span className="min-w-0 flex-1">
                {showName && (
                  <span className="block text-[0.5625rem] font-black uppercase tracking-wider text-gray-400 truncate">
                    {name}
                  </span>
                )}
                <span className="block text-xs font-black text-gray-900 leading-tight">
                  {headline}
                </span>
                {guaranteed && (
                  <span className="block text-[0.625rem] text-gray-500 mt-0.5">
                    {t('ppDeliveryGuaranteedBy').replace('{0}', guaranteed)}
                  </span>
                )}
              </span>

              <span className="flex items-center gap-2 flex-shrink-0">
                {surcharge !== 0 && (
                  <span className="text-[0.6875rem] font-black text-orange-600 whitespace-nowrap">
                    {surcharge > 0
                      ? t(option.chargeOnce ? 'ppDeliverySurchargeOnce' : 'ppDeliverySurcharge').replace('{0}', formatPrice(surcharge))
                      : formatPrice(surcharge)}
                  </span>
                )}
                {isSelected && (
                  <span className="w-4 h-4 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center flex-shrink-0">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {deadline && (
        <p className="flex items-start gap-1.5 text-[0.625rem] font-bold text-gray-500">
          <CalendarClock className="w-3.5 h-3.5 mt-px text-orange-600 flex-shrink-0" />
          <span className="min-w-0">{t('ppArtworkDeadline').replace('{0}', deadline)}</span>
        </p>
      )}
    </div>
  );
}
