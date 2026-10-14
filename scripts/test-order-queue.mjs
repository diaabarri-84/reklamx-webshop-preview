#!/usr/bin/env node
// The order queue's search, filters and four sorts (src/lib/orderQueue.ts).
//
// WHY IT EXISTS
// "Sort the orders by priority, by print date and by delivery date" decides what
// the press does next. A sort that puts an undated order first, treats a Mollie
// "+00:00" timestamp as text, or files an order under the wrong day around
// midnight is a job printed late — and none of that shows on a screen with three
// test orders. So the rules are asserted directly.
//
// Usage:  node scripts/test-order-queue.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-orderqueue-'));
const outFile = join(outDir, 'q.mjs');
await build({ entryPoints: [join(ROOT, 'src/lib/orderQueue.ts')], outfile: outFile, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const q = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ids = (list) => list.map((o) => o.id);

const orders = [
  { id: 'A', createdAt: '2026-10-01T08:00:00.000Z', status: 'pending', paymentStatus: 'open', dueDate: '2026-10-09' },
  { id: 'B', createdAt: '2026-10-02T08:00:00+00:00', status: 'in_print', paymentStatus: 'paid', priority: 'urgent', dueDate: '2026-10-10', printDate: '2026-10-06' },
  { id: 'C', createdAt: '2026-10-03T08:00:00.000Z', status: 'in_print', paymentStatus: 'paid', priority: 'high', printDate: '2026-10-05' },
  { id: 'D', createdAt: '2026-10-04T22:30:00.000Z', status: 'completed', paymentStatus: 'paid', dueDate: '2026-10-08',
    customerName: 'Anna Ångström', customerEmail: 'anna@firma.se', customerDetails: { phone: '070-123 45 67', company: 'Firma AB' },
    items: [{ productName: 'Roll Up Compact 85×200' }] },
  { id: 'E', createdAt: 'garbage', status: 'pending', paymentStatus: 'expired', priority: 'bogus' },
];

console.log('\n== fields ==\n');
check('absent / unknown priority is normal', [q.priorityOf(orders[0]), q.priorityOf(orders[4])], ['normal', 'normal']);
check('urgent before high before normal', [q.priorityRank(orders[1]), q.priorityRank(orders[2]), q.priorityRank(orders[0])], [0, 1, 2]);
check('a Mollie "+00:00" time parses', q.createdMs(orders[1]) > 0, true);
check('a garbage time is 0, not NaN', q.createdMs(orders[4]), 0);
check('22:30 UTC on the 4th is the 5th in Stockholm', q.createdDay(orders[3]), '2026-10-05');
check('a malformed day is no day', [q.dayField('2026-10-5'), q.dayField(' 2026-10-05 '), q.dayField(null)], [null, '2026-10-05', null]);

console.log('\n== sorts ==\n');
check('newest first (garbage time last)', ids(q.sortOrders(orders, 'newest')), ['D', 'C', 'B', 'A', 'E']);
// D is completed and E's payment expired: closed, so after the live work in
// every sort but "newest" (the review: a finished job and dead checkouts topped
// the operator's list).
check('priority: urgent, high, then by promised day, then oldest; closed last', ids(q.sortOrders(orders, 'priority')), ['B', 'C', 'A', 'D', 'E']);
check('print date: dated first (soonest), undated after by priority/due; closed last', ids(q.sortOrders(orders, 'printDate')), ['C', 'B', 'A', 'D', 'E']);
check('delivery date: soonest promise first, none last; closed last', ids(q.sortOrders(orders, 'dueDate')), ['A', 'B', 'C', 'D', 'E']);
check('the input is not reordered in place', ids(orders), ['A', 'B', 'C', 'D', 'E']);
const ties = [{ id: 'x', createdAt: '2026-10-01T00:00:00Z' }, { id: 'y', createdAt: '2026-10-01T00:00:00Z' }];
check('a true tie keeps the incoming order (stable)', ids(q.sortOrders(ties, 'priority')), ['x', 'y']);

console.log('\n== filters & search ==\n');
check('paid only', ids(q.filterOrders(orders, { payment: 'paid' })), ['B', 'C', 'D']);
check('unpaid = everything not paid', ids(q.filterOrders(orders, { payment: 'unpaid' })), ['A', 'E']);
check('one stage', ids(q.filterOrders(orders, { stage: 'in_print' })), ['B', 'C']);
check('"active" = paid and not finished (the tile)', ids(q.filterOrders(orders, { stage: 'active' })), ['B', 'C']);
check('"production" = design, print or finishing (the tile)', ids(q.filterOrders(orders, { stage: 'production' })), ['B', 'C']);
check('one priority', ids(q.filterOrders(orders, { priority: 'urgent' })), ['B']);
check('a Stockholm day range', ids(q.filterOrders(orders, { from: '2026-10-03', to: '2026-10-05' })), ['C', 'D']);
check('a range never matches an order with no time', q.filterOrders([orders[4]], { from: '2000-01-01' }).length, 0);
check('search: every word, any field, accents folded', ids(q.filterOrders(orders, { q: 'angstrom roll' })), ['D']);
check('search: the phone without its spaces', ids(q.filterOrders(orders, { q: '0701234567' })), ['D']);
check('search: part of the order number', ids(q.filterOrders(orders, { q: 'b' })).includes('B'), true);
check('search: a word that is nowhere finds nothing', q.filterOrders(orders, { q: 'zzz' }).length, 0);
check('no filters = everything', q.filterOrders(orders).length, 5);

console.log('\n== payment classes — the tiles and their lists count the same orders ==\n');
const more = [
  ...orders,
  { id: 'F', createdAt: '2026-10-05T08:00:00Z', status: 'in_print', paymentStatus: 'paid', paymentMode: 'test' },
  { id: 'G', createdAt: '2026-10-05T09:00:00Z', status: 'cancelled', paymentStatus: 'refunded' },
  { id: 'H', createdAt: '2026-10-05T10:00:00Z', paymentStatus: 'chargeback' },
  { id: 'I', createdAt: '2026-10-05T11:00:00Z', status: 'weird-legacy', paymentStatus: 'open', customerName: 'Søren Ærø',
    customerDetails: { phone: '+46 70-123 45 99' } },
];
check('classes: unpaid, paid, test, reversed, reversed', ['A', 'B', 'F', 'G', 'H'].map((id) => q.paymentClass(more.find((o) => o.id === id))), ['unpaid', 'paid', 'test', 'reversed', 'reversed']);
check('"paid only" = real money: a test payment is not in it', ids(q.filterOrders(more, { payment: 'paid' })), ['B', 'C', 'D']);
check('"unpaid" leaves out refunds, charge-backs and test payments', ids(q.filterOrders(more, { payment: 'unpaid' })), ['A', 'E', 'I']);
check('"refunded / charged back" is its own filter', ids(q.filterOrders(more, { payment: 'reversed' })), ['G', 'H']);
check('"active" (the tile) leaves out the test payment', ids(q.filterOrders(more, { stage: 'active' })), ['B', 'C']);
check('"production" (the tile) leaves out the test payment', ids(q.filterOrders(more, { stage: 'production' })), ['B', 'C']);
check('an unknown or missing status IS pending — label and filter agree', ids(q.filterOrders(more, { stage: 'pending' })), ['A', 'E', 'H', 'I']);
check('closed: finished, cancelled, and dead payments', more.filter((o) => q.isClosed(o)).map((o) => o.id), ['D', 'E', 'G', 'H']);
check('documents name only stages the shop knows ("delivered" = completed; a legacy value prints nothing)',
  [q.knownStageLabelKey('in_print'), q.knownStageLabelKey('delivered'), q.knownStageLabelKey('weird-legacy'), q.knownStageLabelKey(undefined)],
  ['sdStatusInPrint', 'sdStatusCompleted', null, null]);

console.log('\n== search — Nordic names and Swedish numbers ==\n');
check('"soren aero" finds Søren Ærø', ids(q.filterOrders(more, { q: 'soren aero' })), ['I']);
check('+46 70… stored, 070… typed', ids(q.filterOrders(more, { q: '0701234599' })), ['I']);
check('070… stored, +46 70… typed', ids(q.filterOrders(more, { q: '+46701234567' })), ['D']);
check('070… stored, 0046 70… typed', ids(q.filterOrders(more, { q: '0046701234567' })), ['D']);
check('a short run of digits still matches inside the number', ids(q.filterOrders(more, { q: '12345' })).sort(), ['D', 'I']);

// ---- pay on delivery (2026-10-07) ----
const pod = (extra) => ({ id: extra.id, status: 'in_print', paymentStatus: 'unpaid', payOnDelivery: true, ...extra });
const podOrders = [
  pod({ id: 'P1' }),
  pod({ id: 'P2', status: 'cancelled' }),
  pod({ id: 'P3', paymentStatus: 'paid' }),
  { id: 'U1', status: 'in_print', paymentStatus: 'unpaid' },
  { id: 'M1', status: 'in_print', paymentStatus: 'paid' },
];
check('open on delivery: unpaid and live — not cancelled, not yet paid', podOrders.map((o) => q.isOnDeliveryOpen(o)), [true, false, false, false, false]);
check('the queue\'s "Paid" filter holds what is cleared for production: paid, and open on delivery',
  ids(q.filterOrders(podOrders, { payment: 'paid' })).sort(), ['M1', 'P1', 'P3']);
check('…a plain unpaid checkout and a cancelled order to pay on delivery are not', ids(q.filterOrders(podOrders, { payment: 'unpaid' })).sort(), ['P2', 'U1']);
check('in production (the tile\'s list): the open order to pay on delivery counts', ids(q.filterOrders(podOrders, { stage: 'production' })).sort(), ['M1', 'P1', 'P3']);
check('its label is "Pay on delivery" while open; cancelled it is unpaid; recorded it is paid',
  [q.paymentLabelKey(podOrders[0]), q.paymentLabelKey(podOrders[1]), q.paymentLabelKey(podOrders[2])], ['payStatusOnDelivery', 'payStatusNone', 'payStatusPaid']);
const words = { payStatusOnDelivery: 'Betalas vid leverans', oaPaidCash: 'Kontanter', docPaidOnDelivery: 'Betald vid leverans ({0})' };
const tr = (k) => words[k] ?? k;
check('how it is paid, in the reader\'s language: to pay on delivery; paid on delivery (cash); Mollie\'s own title as before',
  [q.paymentTitleOf(podOrders[0], tr), q.paymentTitleOf({ ...podOrders[2], paymentRecordedMethod: 'cash' }, tr), q.paymentTitleOf({ paymentMethodTitle: 'Swish', paymentStatus: 'paid' }, tr)],
  ['Betalas vid leverans', 'Betald vid leverans (Kontanter)', 'Swish']);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ all order-queue checks passed\n');
process.exit(failed ? 1 : 0);
