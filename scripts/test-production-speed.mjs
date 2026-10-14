#!/usr/bin/env node
// A paid production speed is a promise — src/lib/productionSpeed.ts (round 16).
//
// "Next day — dispatched within 24 hours" was charged +345 kr and then thrown
// away: the order was promised the settings' days like any other. These checks
// pin how a speed's days are READ (the owner types the words, in four languages),
// how an order's days are combined, and that the stage plan dispatches on the
// speed's working day — and that an order with NO speed is planned exactly as
// before.
//
// Usage:  node scripts/test-production-speed.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-speed-'));
writeFileSync(join(dir, 'e.ts'), [
  `export * from ${JSON.stringify(join(ROOT, 'src/lib/productionSpeed.ts'))};`,
  `export { buildStagePlan, replanFrom, AUTO_STAGE_DEFAULTS, AUTO_STAGE_ORDER } from ${JSON.stringify(join(ROOT, 'src/lib/orderStages.ts'))};`,
  `export { toShopWall } from ${JSON.stringify(join(ROOT, 'src/lib/reportDays.ts'))};`,
].join('\n'));
await build({ entryPoints: [join(dir, 'e.ts')], outfile: join(dir, 'e.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const S = await import(pathToFileURL(join(dir, 'e.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const days = (label, extra = {}) => S.speedDaysOf({ label, ...extra });

console.log('\n== reading a speed, as the owner wrote it ==\n');
check('the catalogue\'s four: 5, 3, 2 and "within 24 hours" = 1',
  [days('Standard — 5 working days'), days('Fast — 3 working days'), days('Express — 2 working days'), days('Next day — dispatched within 24 hours')],
  [5, 3, 2, 1]);
check('in Swedish, Danish and Norwegian words',
  [days('Standard — 5 arbetsdagar'), days('Snabb 3 dagar'), days('Ekspres — 2 hverdage'), days('Ekspress — 2 virkedager'), days('Express 2 arbejdsdage')],
  [5, 3, 2, 2, 2]);
check('hours become days (rounded UP, at least one): "24 timmar", "48h", "12 timer"',
  [days('Leverans inom 24 timmar'), days('48h'), days('Klar på 12 timer')], [1, 2, 1]);
check('next-day words with no number at all', [days('Next day'), days('Nästa dag'), days('Næste dag'), days('Neste dag')], [1, 1, 1, 1]);
check('a range is promised on its SLOWER bound; weeks are five working days',
  [S.speedRangeOf({ label: '3–5 Business Days' }), days('3-5 working days'), days('2–3 veckor')], [{ min: 3, max: 5 }, 5, 15]);
check('a number without its unit is not a lead time: "order before 12:00", "kl 14", "v.42"',
  [days('Express (order before 12:00)'), days('Beställ före kl 14'), days('Leverans v.42')], [null, null, null]);
check('…but the real one beside it still counts', days('Express — 2 working days (order before 12:00)'), 2);
check('nothing countable in the words: the value (express_2d, next_day_24h), then the catalogue id',
  [days('Snabbt', { value: 'express_2d' }), days('Kvickt', { value: 'next_day_24h' }), days('Snabb', { id: 'sv-speed-fast' }), days('Hmm', { id: 'nope' })],
  [2, 1, 3, null]);
check('the WORDS win over the id (an owner who retypes "5" as "4" is followed)', days('Standard — 4 working days', { id: 'sv-speed-standard' }), 4);
check('nonsense is not a promise (365 days, 0 days)', [days('365 days'), days('0 days')], [null, null]);
check('the words a Swedish shop writes: vardagar, bankdagar, dygn, dgr, timmars, "Nästa arbetsdag"',
  [days('5 vardagar'), days('2 bankdagar'), days('1-2 dygn'), days('Snabb 3 dgr'), days('Klar inom 24 timmars'), days('Nästa arbetsdag')],
  [5, 2, 2, 3, 1, 1]);
check('…Danish and Norwegian: døgn, arbeidsdager, hverdager, "Næste hverdag", "Neste virkedag"',
  [days('2 døgn'), days('5 arbeidsdager'), days('3-5 hverdager'), days('Næste hverdag'), days('Neste virkedag')], [2, 5, 5, 1, 1]);
check('…possessives: "2 dagars leverans", "2 dages", "2 dagers"', [days('2 dagars leverans'), days('2 dages levering'), days('2 dagers levering')], [2, 2, 2]);
check('…English: workdays, "3-day", "48-hour", next working/business day, tomorrow',
  [days('5 workdays'), days('3-day service'), days('48-hour turnaround'), days('Next working day'), days('Next business day'), days('Ready tomorrow')],
  [5, 3, 2, 1, 1, 1]);
check('a time of day before the lead time is not one: "Beställ före 15h för 2 dagars leverans" is 2, not 1',
  [days('Beställ före 15h för 2 dagars leverans'), days('Order before 14h — 3 working days'), days('Order by 14h')], [2, 3, null]);
check('the FIRST lead time written counts: "2 days (48 hours)"; a half day rounds UP', [days('2 days (48 hours)'), days('1,5 dagar')], [2, 2]);
check('"within" said with a clock word is still a lead time: innen, senast, innan, inden, by + timer/timmar/hours',
  [days('Ekspress — sendes innen 48 timer'), days('Express — skickas senast 48 timmar efter godkänd fil'), days('Express — klar innan 48 timmar'),
    days('Afsendes inden 24 timer'), days('Ready by 48 hours')],
  [2, 2, 2, 1, 2]);
check('dispatch is written before delivery: "dispatched within 24 hours, delivered in 2–3 days" is ONE day',
  [days('Next day — dispatched within 24 hours, delivered in 2–3 days'), days('Nästa dag — skickas inom 24 timmar, leverans 1–2 dagar'),
    days('Sendes innen 24 timer, levering 1-3 virkedager')],
  [1, 1, 1]);
// The price of "first written": a deadline in hours written BEFORE the lead time
// reads as the lead time. Chosen deliberately — the reverse misread every
// "dispatched within 24 hours, delivered in 2–3 days".
check('…and knowingly: "Order within 2 hours for dispatch in 3 days" reads as one day', days('Order within 2 hours for dispatch in 3 days'), 1);
check('a clock hour beside the lead time is not a range: "before 12 - 2 working days" is 2, not 12',
  [days('Order before 12 - 2 working days'), days('Bestill før kl 14 – 3 virkedager'), days('Express kl 12 - 2 dagar'),
    days('Bestil inden 12 til 2 dages levering'), days('Beställ före 12:00 – 2 arbetsdagar'), days('Order by 14:00 - 2 working days')],
  [2, 3, 2, 2, 2, 2]);
check('a number glued to a word is not a lead time: "Format A4 — 3 arbetsdagar" is 3', days('Format A4 — 3 arbetsdagar'), 3);
check('a word that only starts like a unit is not one: "5 hotels", "3 dagis"', [days('5 hotels'), days('3 dagis')], [null, null]);

console.log('\n== the order\'s days ==\n');
check('no speed anywhere: the settings\' days, and nothing changes', [S.orderProductionDays([], 3), S.orderProductionDays([null, null], 3)],
  [{ days: 3, fromSpeed: false }, { days: 3, fromSpeed: false }]);
check('one Next-day line: one day', S.orderProductionDays([1], 3), { days: 1, fromSpeed: true });
check('one parcel — the slowest line wins: Next day + Standard-5 = 5; Next day + a line with no speed = the settings\' 3',
  [S.orderProductionDays([1, 5], 3), S.orderProductionDays([1, null], 3)], [{ days: 5, fromSpeed: true }, { days: 3, fromSpeed: true }]);
check('a paid speed faster than the settings brings the date forward', S.orderProductionDays([2], 3), { days: 2, fromSpeed: true });

console.log(`\n== counting working days, one way for the page and the order — on SWEDISH days (this host: ${Intl.DateTimeFormat().resolvedOptions().timeZone}) ==\n`);
const at = (iso) => new Date(iso);
check('Friday + 1 working day = Monday; without the weekend rule, Saturday',
  [S.promisedDay(at('2026-10-09T08:00:00Z'), 1, true), S.promisedDay(at('2026-10-09T08:00:00Z'), 1, false)], ['2026-10-12', '2026-10-10']);
check('from a Saturday: Monday is the first working day (the page used to say Tuesday)', S.promisedDay(at('2026-10-10T08:00:00Z'), 1, true), '2026-10-12');
check('00:30 on a Tuesday in Stockholm is still Monday in UTC — counted from TUESDAY, as the page in Sweden shows it',
  S.promisedDay(at('2026-10-05T22:30:00Z'), 2, true), '2026-10-08');
check('23:30 on a Friday in Stockholm (21:30 UTC) is Friday: + 1 = Monday', S.promisedDay(at('2026-10-09T21:30:00Z'), 1, true), '2026-10-12');
check('…and 00:30 on a Saturday in Stockholm (Friday 22:30 UTC) is the weekend: + 1 = Monday too', S.promisedDay(at('2026-10-09T22:30:00Z'), 1, true), '2026-10-12');
check('across the clock change (25 Oct 2026): Friday 23 + 2 = Tuesday 27', S.promisedDay(at('2026-10-23T10:00:00Z'), 2, true), '2026-10-27');
check('the upload deadline: today, or Monday on a weekend', [S.firstWorkingDay(at('2026-10-07T10:00:00Z'), true), S.firstWorkingDay(at('2026-10-10T10:00:00Z'), true), S.firstWorkingDay(at('2026-10-10T10:00:00Z'), false)],
  ['2026-10-07', '2026-10-12', '2026-10-10']);
check('an unusable start promises nothing rather than a wrong day', [S.promisedDay(new Date('nope'), 2, true), S.firstWorkingDay(new Date(NaN), true)], ['', '']);
check('a day to show reads as that day in any zone', S.dayToShow('2026-10-12').toISOString(), '2026-10-12T12:00:00.000Z');
check('transit per method: pickup 0, express and dsv_weekday 1, the rest 2',
  ['pickup', 'express', 'dsv_weekday', 'standard', 'anything'].map((m) => S.transitDaysFor(m, S.promiseNumbers({}))), [0, 1, 1, 2, 2]);
check('his numbers, made safe', S.promiseNumbers({ productionDays: '4', shippingDaysZone: -1, skipWeekends: false }),
  { productionDays: 4, zone: 2, weekday: 1, pickup: 0, skipWeekends: false });

console.log('\n== the stage plan dispatches on the speed\'s day ==\n');
const settings = { ...S.AUTO_STAGE_DEFAULTS, hours: { ...S.AUTO_STAGE_DEFAULTS.hours } };
const wed = '2026-10-07T10:00:00.000Z';
const fri = '2026-10-09T10:00:00.000Z';
const next = S.buildStagePlan(wed, settings, 'standard', 1);
check('Next day, paid Wednesday 10:00: shipped Thursday 10:00, stages in order before it, delivered 48 h later',
  [next.shipped, next.in_design < next.in_print && next.in_print < next.finishing && next.finishing <= next.shipped, next.completed],
  // Thursday 10:00 + 48 h is Saturday: moved to Monday, like every stage.
  ['2026-10-08T10:00:00.000Z', true, '2026-10-12T10:00:00.000Z']);
check('paid Friday: shipped Monday (never on the weekend)', S.buildStagePlan(fri, settings, 'standard', 1).shipped, '2026-10-12T10:00:00.000Z');
check('Standard-5 from Wednesday: shipped the next Wednesday', S.buildStagePlan(wed, settings, 'standard', 5).shipped, '2026-10-14T10:00:00.000Z');
check('NO speed: exactly the plan every order had before', S.buildStagePlan(wed, settings, 'standard'), S.buildStagePlan(wed, settings, 'standard', null));
check('pickup, Next day: ready (finishing) within the day, never "shipped"',
  (() => { const p = S.buildStagePlan(wed, settings, 'pickup', 1); return [p.finishing <= '2026-10-08T10:00:00.000Z', 'shipped' in p, 'completed' in p]; })(),
  [true, false, false]);
const zero = { ...settings, hours: { in_design: 0, in_print: 0, finishing: 0, shipped: 0, completed: 0 } };
check('every hour set to 0 does not throw: all of it at dispatch', S.buildStagePlan(wed, zero, 'standard', 2).shipped, '2026-10-09T10:00:00.000Z');
check('unusable days (0, NaN, 999) plan as before', [0, NaN, 999].map((d) => JSON.stringify(S.buildStagePlan(wed, settings, 'standard', d)) === JSON.stringify(S.buildStagePlan(wed, settings, 'standard'))), [true, true, true]);
check('the artwork arrives Wednesday 10:00 on a held Next-day order: shipped Thursday 10:00',
  S.replanFrom('in_design', wed, settings, 'standard', 1).shipped, '2026-10-08T10:00:00.000Z');

// The reviewer's two: stages spread over calendar time and pushed off the weekend
// one by one came out of order (finishing after shipped; in_print before in_design).
const order = (p) => S.AUTO_STAGE_ORDER.filter((k) => k in p).map((k) => p[k]);
const inOrder = (p) => order(p).every((v, i, a) => i === 0 || a[i - 1] <= v);
const fast3 = S.buildStagePlan('2026-10-07T00:00:00.000Z', settings, 'standard', 3);
check('Fast-3 paid Wednesday 00:00 UTC: in order, finishing before shipped on the Monday', [inOrder(fast3), fast3.finishing < fast3.shipped, fast3.shipped], [true, true, '2026-10-12T00:00:00.000Z']);
const satNext = S.buildStagePlan('2026-10-10T10:00:00.000Z', settings, 'standard', 1);
const swedishDay = (iso) => S.toShopWall(new Date(iso)).toISOString().slice(0, 10);
check('Next day paid Saturday 10:00 UTC: every stage on the Swedish Monday, in order, shipped Monday 10:00',
  [inOrder(satNext), swedishDay(satNext.in_design), swedishDay(satNext.in_print), satNext.shipped], [true, '2026-10-12', '2026-10-12', '2026-10-12T10:00:00.000Z']);
const weekendOf = (iso) => { const d = S.toShopWall(new Date(iso)).getUTCDay(); return d === 0 || d === 6; };
let bad = [];
for (let hour = 0; hour < 24 * 14; hour += 1) {
  const start = new Date(Date.UTC(2026, 9, 5, 0, 0, 0) + hour * 3600e3).toISOString();
  for (const speed of [1, 2, 3, 5, 10]) {
    for (const method of ['standard', 'pickup']) {
      const p = S.buildStagePlan(start, settings, method, speed);
      const last = method === 'pickup' ? p.finishing : p.shipped;
      const stages = S.AUTO_STAGE_ORDER.filter((k) => k in p && k !== 'completed');
      if (!inOrder(p) || stages.some((k) => p[k] > last || p[k] < start || weekendOf(p[k]))) bad.push(`${start} ${speed}d ${method}`);
    }
  }
}
check('every start hour of two weeks × five speeds × courier and pickup: in order, never after dispatch, never on a Swedish weekend', bad.slice(0, 3), []);
const zeroLate = { ...settings, hours: { ...settings.hours, finishing: 0, shipped: 0 } };
check('…but never on the weekend: the same job moved on a Saturday ships Monday, same time',
  S.replanFrom('finishing', '2026-10-10T08:00:00.000Z', { ...settings, hours: { ...settings.hours, shipped: 0 } }, 'standard', 1).shipped, '2026-10-12T08:00:00.000Z');
check('stages he set to 0 hours pass straight through: a Next-day job moved by hand to finishing ships at once',
  S.replanFrom('in_print', wed, zeroLate, 'standard', 1).shipped, wed);
check('a stage due 00:30 Monday in Stockholm (Sunday 22:30 UTC) stays on Monday — UTC weekends pushed it to Tuesday',
  S.buildStagePlan('2026-10-11T18:30:00.000Z', { ...settings, hours: { ...settings.hours, in_design: 4 } }, 'standard').in_design, '2026-10-11T22:30:00.000Z');

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ every speed rule holds\n');
process.exit(failed ? 1 : 0);
