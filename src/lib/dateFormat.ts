/**
 * Every date and time the shop prints, in one place.
 *
 * WHY THIS FILE EXISTS
 * The owner reported Arabic dates all over the dashboard — `20 ص8:14:19 ،2026/8/`
 * on the order card, `الجمعة، 21 أغسطس` on the tracker. Nothing in this shop is
 * written in Arabic. The cause was nineteen calls to `toLocaleString()`,
 * `toLocaleDateString([])` and friends with NO locale argument: with no locale,
 * the browser uses the machine's own, and this shop is built on a Mac set to
 * Arabic. On a Swedish customer's laptop the very same code produced Swedish, so
 * it never looked broken from the outside — it silently followed whoever was
 * looking.
 *
 * The same bug reached money: `currency.ts` formatted prices with
 * `toLocaleString(undefined, …)`, which on an Arabic machine renders Arabic-Indic
 * digits — ١١ ٥٦١ instead of 11 561.
 *
 * THE RULES HERE
 *  1. Every formatter states its locale. There is no "whatever the browser
 *     thinks" path in this module.
 *  2. 24-hour clock, always — `hourCycle: 'h23'`, so 20:14, never 8:14 ص. The
 *     owner asked for this outright: his customers read time that way.
 *  3. Staff, production and printed documents use ONE fixed locale whatever the
 *     browser is set to. Two people looking at the same job must read the same
 *     date, and `2026-08-20` cannot be misread the way `08/09/2026` can.
 *  4. Customer-facing text follows the SHOP language the customer picked — not
 *     their operating system.
 *
 * There is a guard for rule 1 in scripts/check-date-locales.mjs, wired into
 * `npm run verify`, so a locale-less `toLocale*` cannot come back unnoticed.
 */

/** The four shop languages, mapped to the locale tags Intl actually knows. */
export const LOCALE_FOR_LANGUAGE: Record<string, string> = {
  en: 'en-GB',
  sv: 'sv-SE',
  da: 'da-DK',
  no: 'nb-NO',
};

/**
 * Staff, production, invoices, job sheets, packing slips.
 *
 * Swedish, because the shop is Swedish and its dates come out ISO — 2026-08-21 —
 * which is unambiguous on a printed sheet in a workshop.
 */
export const OPERATIONS_LOCALE = 'sv-SE';

/** The shop language a customer is reading in → the locale to format for. */
export function localeFor(language: string | undefined): string {
  return LOCALE_FOR_LANGUAGE[String(language || 'en')] ?? LOCALE_FOR_LANGUAGE.en;
}

/** Anything an order might carry in a date field → a Date, or null. */
function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** What every formatter prints when there is no usable date. Never "Invalid Date". */
const EMPTY = '—';

/** 24-hour, everywhere, without exception. */
const CLOCK: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };

/** `2026-08-21` in operations, `21/08/2026` for an English customer. */
export function formatDate(
  value: string | number | Date | null | undefined,
  locale: string = OPERATIONS_LOCALE,
): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString(locale) : EMPTY;
}

/** `20:14`. */
export function formatTime(
  value: string | number | Date | null | undefined,
  locale: string = OPERATIONS_LOCALE,
): string {
  const date = toDate(value);
  return date ? date.toLocaleTimeString(locale, CLOCK) : EMPTY;
}

/** `2026-08-21 20:14`. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  locale: string = OPERATIONS_LOCALE,
): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return `${date.toLocaleDateString(locale)} ${date.toLocaleTimeString(locale, CLOCK)}`;
}

/** `fre 21 aug` — a short human date for a card or a badge. */
export function formatShortDate(
  value: string | number | Date | null | undefined,
  locale: string = OPERATIONS_LOCALE,
): string {
  const date = toDate(value);
  return date
    ? date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
    : EMPTY;
}

/** `21 augusti 2026` — the long form, for a printed document. */
export function formatLongDate(
  value: string | number | Date | null | undefined,
  locale: string = OPERATIONS_LOCALE,
): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }) : EMPTY;
}

/**
 * `WEDNESDAY` — the despatch day, shouted across the packing slip the way the
 * supplier's own slip does it. Always English: it is read by whoever is loading
 * the van, and the shop's paperwork is English.
 */
export function formatDispatchWeekday(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase() : EMPTY;
}

/**
 * `in 3 h`, `in 2 days`, `now` — how far away a moment is.
 *
 * Plain English on purpose: it is used on staff screens, beside the automatic
 * stage schedule, where an exact hour matters less than "is this about to move".
 */
export function formatRelativeToNow(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  const minutes = Math.round((date.getTime() - now.getTime()) / 60000);
  if (minutes <= 0) return 'due now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}
