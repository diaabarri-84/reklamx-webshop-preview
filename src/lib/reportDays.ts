// Which DAY an order belongs to, in the shop's own time.
//
// `dayKey` was `iso.slice(0, 10)` — the UTC date. Sweden is one or two hours
// ahead of UTC, so every order placed between midnight and 01:00 or 02:00 local
// time was counted on the PREVIOUS day. On a normal evening that is the last
// orders of the day landing in yesterday's total; at a month boundary it moves
// revenue between months, and the shop's own books and this report then disagree.
//
// It also moves twice a year. On the last Sunday of March the offset goes from
// +01:00 to +02:00, so a fixed offset is wrong for half the year — which is why
// this uses Intl rather than arithmetic.
//
// THIS MUST LAND BEFORE THE REPORTS ARE BUILT ON, and the plan says so: changing
// it later moves every bucket boundary and invalidates anything already signed
// off against the old numbers.
//
// Pure, and tested in scripts/test-report-days.mjs.

/** The shop is in Sweden. Not a setting: it is where the company is registered. */
export const SHOP_TIME_ZONE = 'Europe/Stockholm';

/**
 * `en-CA` gives YYYY-MM-DD directly, which is the format the whole report keys
 * on. Built once: constructing a DateTimeFormat per row is the expensive part,
 * and a year of orders is thousands of rows.
 */
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHOP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The calendar day an instant falls on, in Stockholm.
 *
 * An unparseable timestamp returns '' rather than today: a row whose date cannot
 * be read must not be silently counted into the current day, where it would look
 * like real activity.
 */
export function dayKeyInShopTime(iso: unknown): string {
  const text = String(iso ?? '');
  if (!text) return '';
  const at = new Date(text);
  if (!Number.isFinite(at.getTime())) return '';
  // en-CA already yields 2026-09-12; the replace is for engines that use a
  // different separator for this locale.
  return dayFormatter.format(at).replace(/\//g, '-');
}

/**
 * The UTC instants that bound a local day — the half-open range [start, end).
 *
 * A report asked for "1–30 September" means Swedish days, and the query that
 * fetches the orders runs on UTC timestamps. Without this the first two hours of
 * the 1st are missed and the first two hours of the 1st of October are included.
 *
 * Half-open on purpose: an inclusive end would double-count anything landing
 * exactly on the boundary when two ranges are put side by side.
 */
export function shopDayRange(fromDay: string, toDay: string): { startIso: string; endIso: string } {
  return { startIso: startOfShopDay(fromDay), endIso: startOfShopDay(addDays(toDay, 1)) };
}

/** Midnight in Stockholm on that calendar day, as a UTC instant. */
export function startOfShopDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!m) return '';
  const [, y, mo, d] = m;
  // Find the offset by asking what that wall-clock time IS in Stockholm, then
  // correcting. Doing it this way — rather than assuming +01:00 or +02:00 —
  // survives the two days a year when the offset changes.
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
  const offsetMs = stockholmOffsetMs(new Date(guess));
  // Apply the offset, then re-read it: on the spring-forward day the first
  // answer can be an hour out, because the offset at the guessed instant is not
  // the offset at the corrected one.
  const corrected = new Date(guess - offsetMs);
  const settled = new Date(guess - stockholmOffsetMs(corrected));
  return settled.toISOString();
}

/**
 * THE SHOP'S WALL CLOCK — for counting working days (src/lib/productionSpeed.ts,
 * src/lib/orderStages.ts).
 *
 * An instant read in Stockholm, its parts stored as if they were UTC: plain
 * getUTCDay / setUTCDate arithmetic on the result then counts SWEDISH days and
 * weekends, whatever zone the server or the browser runs in. Counting on the
 * host's own calendar made the promised date, the product page and the stage
 * plan three different calendars: an order at 00:30 on a Tuesday, Swedish time,
 * was promised a day earlier by a server running on UTC than the page had shown.
 * Every wall day is exactly 24 hours long, which is what a working day means here.
 */
const wallFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHOP_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export function toShopWall(at: Date): Date {
  const t = at instanceof Date ? at.getTime() : NaN;
  if (!Number.isFinite(t)) return new Date(NaN);
  const p: Record<string, number> = {};
  for (const part of wallFormatter.formatToParts(at)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  // Some engines print midnight as 24 under a 24-hour clock; it is 00 of the same date.
  const hour = p.hour === 24 ? 0 : p.hour;
  return new Date(Date.UTC(p.year, p.month - 1, p.day, hour, p.minute, p.second, ((t % 1000) + 1000) % 1000));
}

/** The instant at which Stockholm's clock reads `wall` (a toShopWall value). */
export function fromShopWall(wall: Date): Date {
  const w = wall instanceof Date ? wall.getTime() : NaN;
  if (!Number.isFinite(w)) return new Date(NaN);
  const offset = (at: number) => toShopWall(new Date(at)).getTime() - at;
  // Read the offset again at the corrected instant: across a clock change the
  // offset at the guess is not the offset at the answer.
  const first = w - offset(w);
  return new Date(w - offset(first));
}

/** How far ahead of UTC Stockholm is at that instant, in milliseconds. */
function stockholmOffsetMs(at: Date): number {
  // The same instant read in both zones; the difference is the offset.
  const asUtc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asLocal = new Date(at.toLocaleString('en-US', { timeZone: SHOP_TIME_ZONE }));
  return asLocal.getTime() - asUtc.getTime();
}

/** Calendar arithmetic on a YYYY-MM-DD string, with no timezone in sight. */
export function addDays(day: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!m) return '';
  const [, y, mo, d] = m;
  const at = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + delta));
  return at.toISOString().slice(0, 10);
}

/**
 * Every day from `fromDay` to `toDay` inclusive.
 *
 * The report draws a zero-filled series, and a gap in it reads as "no data" when
 * it means "no sales" — which are different answers on a chart.
 */
export function shopDaysBetween(fromDay: string, toDay: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDay) || !/^\d{4}-\d{2}-\d{2}$/.test(toDay)) return [];
  const out: string[] = [];
  let cursor = fromDay;
  // Bounded: a reversed or absurd range must not spin. Three years of days is
  // far more than any report asks for.
  for (let i = 0; i < 1100 && cursor <= toDay; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}
