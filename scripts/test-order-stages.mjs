#!/usr/bin/env node
// The schedule test for the automatic production stages.
//
// The owner asked for the stage tracker to move by itself. The rules that keep
// that safe are not visible from the screen — an unpaid order must never enter
// production, a job with no artwork must stop and wait for a human, and a member
// of staff moving a job by hand must always beat the clock. None of that can be
// verified by looking at a dashboard, so it is asserted here against the pure
// schedule in src/lib/orderStages.ts.
//
// Usage:  node scripts/test-order-stages.mjs
// Exit:   0 = every rule holds, 1 = an order can move when it must not

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-stages-'));
const outFile = join(outDir, 'orderStages.mjs');

await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'orderStages.ts')],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
});

const stages = await import(pathToFileURL(outFile).href);
rmSync(outDir, { recursive: true, force: true });

const {
  AUTO_STAGE_DEFAULTS,
  AUTO_STAGE_ORDER,
  autoAdvanceBlockedReason,
  buildStagePlan,
  nextAutoStage,
  nextStageAtFor,
  replanFrom,
  sanitizeAutoStageSettings,
  stagesForShipping,
} = stages;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else {
    failed += 1;
    console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`);
  }
};

const hoursBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 3600000);

// A Monday at 09:00 UTC, so the weekend rule is not in play unless a case wants it.
const MONDAY = '2026-08-17T09:00:00.000Z';

console.log('\nThe automatic stage schedule\n');

// ---------------------------------------------------------------- the order
check('the stages run in production order', AUTO_STAGE_ORDER, [
  'in_design', 'in_print', 'finishing', 'shipped', 'completed',
]);
check('pending starts at the top', nextAutoStage('pending'), 'in_design');
check('in_print is followed by finishing', nextAutoStage('in_print'), 'finishing');
check('completed is the end of the line', nextAutoStage('completed'), null);
check('cancelled never moves', nextAutoStage('cancelled'), null);

// ---------------------------------------------------------------- the plan
const noWeekends = { ...AUTO_STAGE_DEFAULTS, skipWeekends: false };
const plan = buildStagePlan(MONDAY, noWeekends);
check('every stage is scheduled', Object.keys(plan), [
  'in_design', 'in_print', 'finishing', 'shipped', 'completed',
]);
check('design begins 4 h after payment', hoursBetween(MONDAY, plan.in_design), 4);
check('the press follows 20 h later', hoursBetween(plan.in_design, plan.in_print), 20);
check('paid to despatch is three days', hoursBetween(MONDAY, plan.shipped), 72);
check('delivered two days after that', hoursBetween(plan.shipped, plan.completed), 48);
check('the schedule only ever runs forwards',
  AUTO_STAGE_ORDER.every((s, i) => i === 0 || new Date(plan[s]) > new Date(plan[AUTO_STAGE_ORDER[i - 1]])),
  true);

// The shop does not ship on a Sunday.
const friday = '2026-08-21T15:00:00.000Z';
const weekendPlan = buildStagePlan(friday, AUTO_STAGE_DEFAULTS);
const landsOnWeekend = Object.values(weekendPlan).some((iso) => [0, 6].includes(new Date(iso).getUTCDay()));
check('no stage lands on a Saturday or Sunday', landsOnWeekend, false);

// ---------------------------------------------------------- what is due next
check('a pending order is due at the design timestamp', nextStageAtFor('pending', plan), plan.in_design);
check('an order in print is due at the finishing timestamp', nextStageAtFor('in_print', plan), plan.finishing);
check('a completed order is never due', nextStageAtFor('completed', plan), null);
check('no plan means nothing is due', nextStageAtFor('pending', null), null);

// ------------------------------------------------------- the hand always wins
const noon = '2026-08-17T12:00:00.000Z';
const replanned = replanFrom('in_print', noon, noWeekends);
check('a manual move re-plans only what is still to come', Object.keys(replanned), [
  'finishing', 'shipped', 'completed',
]);
check('and measures it from that moment', hoursBetween(noon, replanned.finishing), 24);
check('a manual move to completed schedules nothing', replanFrom('completed', noon, noWeekends), {});

// ------------------------------------------------------------- the hard rules
const paid = { status: 'in_design', paymentStatus: 'paid', items: [{ artworkPending: false }] };
check('a paid job with artwork advances', autoAdvanceBlockedReason(paid), null);
// Pay on delivery (a customer the owner chose): produced before it is paid —
// and only that: the same order without the agreement is still held.
check('an order placed to pay on delivery advances while unpaid',
  autoAdvanceBlockedReason({ ...paid, paymentStatus: 'unpaid', payOnDelivery: true }), null);
check('…but not when it is cancelled',
  autoAdvanceBlockedReason({ ...paid, paymentStatus: 'unpaid', payOnDelivery: true, status: 'cancelled' }), 'terminal');
check('…and its artwork rule still holds',
  autoAdvanceBlockedReason({ ...paid, paymentStatus: 'unpaid', payOnDelivery: true, status: 'in_design', artworkPending: true }), 'artwork_pending');
check('an UNPAID order never advances',
  autoAdvanceBlockedReason({ ...paid, paymentStatus: 'unpaid' }), 'unpaid');
check('a failed payment never advances',
  autoAdvanceBlockedReason({ ...paid, paymentStatus: 'failed' }), 'unpaid');
check('a cancelled order never advances',
  autoAdvanceBlockedReason({ ...paid, status: 'cancelled' }), 'terminal');
check('a completed order never advances',
  autoAdvanceBlockedReason({ ...paid, status: 'completed' }), 'terminal');
check('a job with no artwork stops before the press',
  autoAdvanceBlockedReason({ ...paid, items: [{ artworkPending: true }] }), 'artwork_pending');
check('but a paid order with no artwork may still reach design',
  autoAdvanceBlockedReason({ status: 'pending', paymentStatus: 'paid', artworkPending: true }), null);
check('one missing file out of three still stops the order',
  autoAdvanceBlockedReason({ ...paid, items: [{ artworkPending: false }, { artworkPending: true }] }),
  'artwork_pending');
// THE SHOP'S OWN ARTWORK (round 16): a reprint or the studio's design is not the
// customer's to send — but nothing is on the order to print, so it waits at design.
check('a reprint or a studio line reaches design, then waits for a person to move it to print',
  [autoAdvanceBlockedReason({ status: 'pending', paymentStatus: 'paid', items: [{ artworkSource: 'reprint' }] }),
    autoAdvanceBlockedReason({ ...paid, items: [{ artworkSource: 'reprint' }] }),
    autoAdvanceBlockedReason({ ...paid, items: [{ artworkPending: false }, { artworkSource: 'studio' }] })],
  [null, 'artwork_by_shop', 'artwork_by_shop']);
check('…and once a person has moved it to print, the clock runs on',
  autoAdvanceBlockedReason({ ...paid, status: 'in_print', items: [{ artworkSource: 'studio' }] }), null);
check('a file the customer still owes is said first', autoAdvanceBlockedReason({ ...paid, items: [{ artworkPending: true }, { artworkSource: 'studio' }] }), 'artwork_pending');

// ------------------------------------------------------------ owner settings
check('the master switch produces no plan',
  buildStagePlan(MONDAY, { ...AUTO_STAGE_DEFAULTS, enabled: false }), {});
check('zero hours is a legitimate answer',
  sanitizeAutoStageSettings({ hours: { in_design: 0 } }).hours.in_design, 0);
check('a negative number is not',
  sanitizeAutoStageSettings({ hours: { in_design: -5 } }).hours.in_design,
  AUTO_STAGE_DEFAULTS.hours.in_design);
check('nonsense falls back to the default',
  sanitizeAutoStageSettings({ hours: { in_print: 'soon' } }).hours.in_print,
  AUTO_STAGE_DEFAULTS.hours.in_print);
check('an unreadable date schedules nothing', buildStagePlan('not a date', AUTO_STAGE_DEFAULTS), {});

// ------------------------------------------------------- collected, not shipped
//
// A pickup order used to be walked through the same five stages as a courier
// job: the sweep wrote 'shipped', then 'completed', then stamped deliveredAt. So
// a customer who ticked Pickup was told their parcel had been dispatched by
// courier and delivered to their address while the job sat on the counter, and
// was never told it was ready to collect.
check('a collected order is planned only as far as finishing',
  Object.keys(buildStagePlan(MONDAY, noWeekends, 'pickup')),
  ['in_design', 'in_print', 'finishing']);
check('a delivered order still gets the whole plan',
  Object.keys(buildStagePlan(MONDAY, noWeekends, 'standard')),
  ['in_design', 'in_print', 'finishing', 'shipped', 'completed']);
check('no shipping method given means the full plan, as before',
  Object.keys(buildStagePlan(MONDAY, noWeekends)),
  ['in_design', 'in_print', 'finishing', 'shipped', 'completed']);
check('so nothing is ever due after finishing for a collected order',
  nextStageAtFor('finishing', buildStagePlan(MONDAY, noWeekends, 'pickup')), null);
check('while a shipped one still has its next move',
  typeof nextStageAtFor('finishing', buildStagePlan(MONDAY, noWeekends, 'standard')), 'string');
check('re-planning a collected order by hand keeps the same ceiling',
  Object.keys(replanFrom('in_print', MONDAY, noWeekends, 'pickup')), ['finishing']);
check('PICKUP in any case is still pickup',
  Object.keys(buildStagePlan(MONDAY, noWeekends, ' PickUp ')).length, 3);

// --------------------------------------------- the artwork hold must re-measure
//
// An order parked for missing artwork carries a plan drawn when it was PAID.
// Weeks later the file arrives and every timestamp in that plan is in the past,
// so the sweep marched the job to completed inside an hour with nothing printed.
{
  const paidLongAgo = '2026-08-04T09:00:00.000Z';
  const fileArrives = '2026-09-01T09:00:00.000Z';
  const stale = buildStagePlan(paidLongAgo, noWeekends, 'standard');
  const overdue = Object.values(stale).filter((v) => Date.parse(v) <= Date.parse(fileArrives)).length;
  check('the plan drawn at payment is entirely in the past by then', overdue, 5);
  const fresh = replanFrom('in_print', fileArrives, noWeekends, 'standard');
  const stillOverdue = Object.values(fresh).filter((v) => Date.parse(v) <= Date.parse(fileArrives)).length;
  check('re-planning from the upload leaves nothing overdue', stillOverdue, 0);
}

console.log(failed === 0 ? '\n  Every stage rule holds\n' : `\n  ${failed} rule(s) BROKEN\n`);
process.exit(failed ? 1 : 0);
