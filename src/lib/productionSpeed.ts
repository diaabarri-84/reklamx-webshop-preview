/**
 * A PAID PRODUCTION SPEED IS A PROMISE — round 16 (Q2).
 *
 * Customers choose how fast a job is made ("Next day — dispatched within 24
 * hours", +345 kr). The choice was priced and then thrown away: the promised date
 * and the automatic stages came from the shop-wide settings alone, so a Next-day
 * order was promised the same date as a standard one and sat in the same place in
 * the production queue.
 *
 * The speed's days are WORKING DAYS UNTIL DISPATCH, read from the option itself —
 * the words the customer saw on the product page, which already showed "today +
 * N working days" from them. One parcel per order, so the slowest line sets the
 * date; a line with no speed question takes the settings' production days. An
 * order with no speed anywhere is promised as before — counted, like every
 * order now, on the shop's Swedish calendar rather than the host's.
 *
 * Pure: the server (the order's promise), the product page (its estimate) and the
 * checkout (its "≈ N working days") all count with these functions, so the three
 * cannot disagree. scripts/test-production-speed.mjs.
 */

import { toShopWall } from './reportDays';

/** The speed question (src/components/Admin/optionCatalogue.ts). The older `delivery_date` is door-to-door, not production. */
export const SPEED_FIELD_ID = 'production_delivery_speed';

/** A speed as either side knows it: the page's option (id, value, label) or the server's matched option. */
export interface SpeedOptionRef {
  id?: string | null;
  optionId?: string | null;
  value?: string | null;
  label?: string | null;
  optionLabel?: string | null;
}

/** The catalogue's own speeds, for an option whose words say nothing countable. */
const SPEED_ID_DAYS: Record<string, number> = {
  'sv-speed-standard': 5,
  'sv-speed-fast': 3,
  'sv-speed-express': 2,
  'sv-speed-nextday': 1,
};

/** "Next day" as a shop writes it with no number in it — in the four languages. */
const NEXT_DAY =
  /\b(?:next[\s-]?(?:working[\s-]|business[\s-])?day|over[\s-]?night|tomorrow|nästa\s+(?:arbets|var)?dag|i\s?morgon|næste\s+(?:hver|arbejds)?dag|neste\s+(?:virke|arbeids)?dag|i\s?morgen)(?![a-zåäöæø])/i;

// A number counts only with its unit RIGHT AFTER it — a hyphen ("3-day", "48-hour")
// and a possessive s ("2 dagars leverans") allowed: "order before 12:00", "kl 14"
// and "v.42" are not lead times. Longest alternatives first.
const UNIT =
  'working\\s+days?|business\\s+days?|work\\s*days?|arbetsdagar|arbetsdag|vardagar|vardag|bankdagar|bankdag|' +
  'arbejdsdage|arbejdsdag|hverdager|hverdage|hverdag|virkedager|virkedage|virkedag|arbeidsdager|arbeidsdag|' +
  'dagar|dager|dage|dag|days?|dygn|døgn|dgr|' +
  'weeks?|veckor|vecka|uger|uge|uker|uke|' +
  'hours?|hrs?|timmar|timme|timer|h';
const NUMBER = '(\\d+(?:[.,]\\d+)?)';
const LEAD = new RegExp(`${NUMBER}(?:\\s*(?:[-–—]|to|till|til)\\s*${NUMBER})?\\s*-?\\s*(${UNIT})s?(?![a-zåäöæø])`, 'gi');
const HOUR_UNIT = /^(?:hours?|hrs?|timmar|timme|timer|h)$/;
const WEEK_UNIT = /^(?:weeks?|veckor|vecka|uger|uge|uker|uke)$/;
/**
 * "före 15h", "before 14h", "kl 12h": a time of day, not a lead time — but only the
 * bare "h". These words also mean "within" ("sendes innen 48 timer", "senast 48
 * timmar efter godkänd fil"), and there the hours ARE the lead time.
 */
const CLOCK_BEFORE = /(?:\bkl\.?|klockan|före|innan|before|\bby|until|senast|inden|før|innen)\s*$/i;
/** A number glued to what comes before it is not one: "12:00", "A4", "v.42", "1,5". */
const GLUED = /[a-zåäöæø\d.,:]/i;

function inDays(n: number, unit: string): number {
  const u = unit.toLowerCase();
  if (HOUR_UNIT.test(u)) return n / 24;
  if (WEEK_UNIT.test(u)) return n * 5;
  return n;
}

/** Whole working days, rounded UP (a promise must be kept), at least one; nonsense is null. */
const sane = (n: number) => (Number.isFinite(n) && n > 0 && n <= 60 ? Math.max(1, Math.ceil(n - 1e-9)) : null);

/**
 * Fastest and slowest working days until dispatch, or null when the option says
 * nothing countable. The words first (what the customer read, so an owner who
 * retypes "5" as "4" is followed) — the FIRST countable lead time, as a label
 * says dispatch before delivery ("Next day — dispatched within 24 hours, delivered
 * in 2–3 days" is one day); then the next-day phrases; then a value like
 * `standard_5d` / `next_day_24h`; then the catalogue's own ids.
 *
 * Not a lead time: a time of day ("Beställ före 15h för 2 dagars leverans" is two
 * days), a number glued to a word or another number ("12:00 – 2 arbetsdagar" is
 * two), and a range that runs DOWN — a clock hour beside the real number ("Order
 * before 12 - 2 working days" is two, not twelve).
 */
export function speedRangeOf(option: SpeedOptionRef | null | undefined): { min: number; max: number } | null {
  if (!option) return null;
  const label = String(option.label ?? option.optionLabel ?? '');
  const lead = new RegExp(LEAD.source, 'gi');
  for (let m = lead.exec(label); m; m = lead.exec(label)) {
    // Restart one character on, so the real number inside a skipped match is still seen.
    const skip = () => {
      lead.lastIndex = m!.index + 1;
    };
    if (m.index > 0 && GLUED.test(label[m.index - 1])) {
      skip();
      continue;
    }
    const unit = m[3].toLowerCase();
    if (unit === 'h' && CLOCK_BEFORE.test(label.slice(0, m.index))) {
      skip();
      continue;
    }
    let a = inDays(parseFloat(m[1].replace(',', '.')), unit);
    const b = m[2] ? inDays(parseFloat(m[2].replace(',', '.')), unit) : a;
    if (a > b) a = b;
    const min = sane(a);
    const max = sane(b);
    if (min === null || max === null) {
      skip();
      continue;
    }
    return { min, max };
  }
  if (NEXT_DAY.test(label)) return { min: 1, max: 1 };
  const value = /_(\d+)(d|h)$/i.exec(String(option.value ?? ''));
  if (value) {
    const n = sane(inDays(Number(value[1]), value[2].toLowerCase() === 'h' ? 'h' : 'days'));
    if (n !== null) return { min: n, max: n };
  }
  const fromId = SPEED_ID_DAYS[String(option.optionId ?? option.id ?? '')];
  return fromId ? { min: fromId, max: fromId } : null;
}

/** The days the ORDER is promised on: the slower bound — a promise must be kept. */
export function speedDaysOf(option: SpeedOptionRef | null | undefined): number | null {
  return speedRangeOf(option)?.max ?? null;
}

/**
 * The order's production days. `lineDays`: each line's speed days, null for a line
 * with no speed. The slowest line wins (one parcel); a line without a speed takes
 * the settings' days. `fromSpeed` says whether any speed counted at all — when it
 * is false the caller does exactly what it did before speeds existed.
 */
export function orderProductionDays(
  lineDays: Array<number | null | undefined>,
  settingDays: number,
): { days: number; fromSpeed: boolean } {
  const base = Number.isFinite(settingDays) && settingDays >= 0 ? settingDays : 3;
  const speeds = lineDays.filter((d): d is number => typeof d === 'number' && Number.isFinite(d) && d >= 1);
  if (speeds.length === 0) return { days: base, fromSpeed: false };
  const unspeeded = lineDays.some((d) => !(typeof d === 'number' && Number.isFinite(d) && d >= 1));
  return { days: Math.max(...speeds, ...(unspeeded ? [base] : [])), fromSpeed: true };
}

/** The owner's delivery-time settings (settings/siteConfig.deliveryPromise), made safe. */
export interface PromiseNumbers {
  productionDays: number;
  zone: number;
  weekday: number;
  pickup: number;
  skipWeekends: boolean;
}

export function promiseNumbers(raw: any): PromiseNumbers {
  const num = (value: unknown, fallback: number) =>
    Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  return {
    productionDays: num(raw?.productionDays, 3),
    zone: num(raw?.shippingDaysZone, 2),
    weekday: num(raw?.shippingDaysWeekday, 1),
    pickup: num(raw?.shippingDaysPickup, 0),
    skipWeekends: raw?.skipWeekends !== false,
  };
}

/** Transit days for a shipping method — the one mapping the server and the checkout share. */
export function transitDaysFor(method: unknown, p: PromiseNumbers): number {
  if (method === 'pickup') return p.pickup;
  if (method === 'express' || method === 'dsv_weekday') return p.weekday;
  return p.zone;
}

/**
 * A shop wall-clock time (src/lib/reportDays.ts toShopWall) plus `days` working
 * days, same time of day. Counting starts with the day AFTER — the rule the
 * promised date has always used; the product page counts the same way (it used to
 * move a weekend start to Monday first, and showed one working day more than the
 * order then promised).
 */
export function addWorkingDaysOnWall(wall: Date, days: number, skipWeekends: boolean): Date {
  const d = new Date(wall.getTime());
  // Bounded: a mistyped 10 000 000 in the settings must not stall the payment webhook.
  let left = Math.min(3660, Math.max(0, Math.floor(Number(days) || 0)));
  while (left > 0 && Number.isFinite(d.getTime())) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (skipWeekends && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) continue;
    left -= 1;
  }
  return d;
}

/**
 * THE PROMISED DAY: `from` plus `days` working days, as YYYY-MM-DD on the SHOP'S
 * calendar — Stockholm, whatever zone the server or the browser runs in, so the
 * order, the product page and the checkout name the same day. '' when `from` is
 * unusable.
 */
export function promisedDay(from: Date, days: number, skipWeekends: boolean): string {
  const d = addWorkingDaysOnWall(toShopWall(from), days, skipWeekends);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : '';
}

/** Today on the shop's calendar — or the Monday after, on a weekend when weekends are skipped. */
export function firstWorkingDay(from: Date, skipWeekends: boolean): string {
  const d = toShopWall(from);
  if (!Number.isFinite(d.getTime())) return '';
  while (skipWeekends && (d.getUTCDay() === 0 || d.getUTCDay() === 6)) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A YYYY-MM-DD to put on screen: noon UTC that day. Formatted with timeZone 'UTC', it reads that day anywhere. */
export function dayToShow(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}
