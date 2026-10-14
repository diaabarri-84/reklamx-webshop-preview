#!/usr/bin/env node
// Which day an order belongs to — src/lib/reportDays.ts.
//
// WHY IT EXISTS
// `dayKey` was `iso.slice(0, 10)`, the UTC date. Sweden is one or two hours ahead
// of UTC, so every order placed between local midnight and 01:00 or 02:00 was
// counted on the PREVIOUS day. On an ordinary evening that is the last orders of
// the day landing in yesterday's total; at a month boundary it moves revenue
// between months, and the shop's books and this report then disagree.
//
// The offset also CHANGES TWICE A YEAR, which is why the cases below sit on both
// sides of the March and October switches. A fixed +01:00 is wrong for half the
// year and a fixed +02:00 for the other half.
//
// Usage:  node scripts/test-report-days.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-days-'));
const out = join(outDir, 'reportDays.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'reportDays.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { dayKeyInShopTime, startOfShopDay, shopDayRange, addDays, shopDaysBetween } =
  await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

console.log('\ndayKeyInShopTime — the bug, in both seasons');
// WINTER, +01:00. 23:30 UTC on the 11th is 00:30 on the 12th in Stockholm.
check('an order at 23:30 UTC belongs to the NEXT day in Sweden',
  dayKeyInShopTime('2026-01-11T23:30:00.000Z'), '2026-01-12');
check('slice(0,10) would have said the 11th — that is the defect',
  '2026-01-11T23:30:00.000Z'.slice(0, 10), '2026-01-11');
// SUMMER, +02:00.
check('in summer the boundary is two hours earlier',
  dayKeyInShopTime('2026-07-11T22:30:00.000Z'), '2026-07-12');
check('and 21:30 UTC in summer is still the same day',
  dayKeyInShopTime('2026-07-11T21:30:00.000Z'), '2026-07-11');
check('midday is midday', dayKeyInShopTime('2026-05-20T12:00:00.000Z'), '2026-05-20');

console.log('\nthe month boundary — where it moves money between months');
check('23:30 UTC on 31 January is 1 February in Sweden',
  dayKeyInShopTime('2026-01-31T23:30:00.000Z'), '2026-02-01');
check('and 22:30 UTC on 31 July is 1 August',
  dayKeyInShopTime('2026-07-31T22:30:00.000Z'), '2026-08-01');

console.log('\ntimestamps that cannot be read');
check('an empty string is not today', dayKeyInShopTime(''), '');
check('nor is nonsense', dayKeyInShopTime('not a date'), '');
check('nor is null', dayKeyInShopTime(null), '');
check('nor undefined', dayKeyInShopTime(undefined), '');
// Mollie returns "+00:00" where createdAt uses "Z"; both must work.
check('a +00:00 offset reads the same as Z',
  dayKeyInShopTime('2026-05-20T12:00:00+00:00'), dayKeyInShopTime('2026-05-20T12:00:00Z'));

console.log('\nstartOfShopDay — midnight in Sweden, as a UTC instant');
check('winter midnight is 23:00 UTC the day before', startOfShopDay('2026-01-12'), '2026-01-11T23:00:00.000Z');
check('summer midnight is 22:00 UTC the day before', startOfShopDay('2026-07-12'), '2026-07-11T22:00:00.000Z');
// The two days a year a fixed offset gets wrong.
check('the day the clocks go forward (29 March 2026)', startOfShopDay('2026-03-29'), '2026-03-28T23:00:00.000Z');
check('the day after', startOfShopDay('2026-03-30'), '2026-03-29T22:00:00.000Z');
check('the day the clocks go back (25 October 2026)', startOfShopDay('2026-10-25'), '2026-10-24T22:00:00.000Z');
check('the day after', startOfShopDay('2026-10-26'), '2026-10-25T23:00:00.000Z');
check('a malformed day is empty, not epoch zero', startOfShopDay('nope'), '');

console.log('\nshopDayRange — half-open, so two ranges cannot double-count');
const r = shopDayRange('2026-09-01', '2026-09-30');
check('starts at Swedish midnight on the 1st', r.startIso, '2026-08-31T22:00:00.000Z');
check('ends at Swedish midnight on 1 October, exclusive', r.endIso, '2026-09-30T22:00:00.000Z');
// Without this the first two hours of September are missed and the first two
// hours of October are counted in.
check('an order at 22:30 UTC on 31 August is inside it',
  '2026-08-31T22:30:00.000Z' >= r.startIso && '2026-08-31T22:30:00.000Z' < r.endIso, true);
check('an order at 22:30 UTC on 30 September is NOT',
  '2026-09-30T22:30:00.000Z' < r.endIso, false);

console.log('\naddDays and the zero-filled series');
check('across a month end', addDays('2026-01-31', 1), '2026-02-01');
check('across a leap day', addDays('2028-02-28', 1), '2028-02-29');
check('backwards', addDays('2026-03-01', -1), '2026-02-28');
check('a week has seven days', shopDaysBetween('2026-09-01', '2026-09-07').length, 7);
check('one day is one day', shopDaysBetween('2026-09-01', '2026-09-01'), ['2026-09-01']);
check('a reversed range is empty, not infinite', shopDaysBetween('2026-09-07', '2026-09-01'), []);
check('and the series has no gaps across a month end',
  shopDaysBetween('2026-01-30', '2026-02-02'), ['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02']);

console.log(`\n${failed === 0 ? 'Every day lands in the right bucket.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
