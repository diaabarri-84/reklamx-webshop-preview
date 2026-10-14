/**
 * The automatic production stages.
 *
 * The owner asked for the stage tracker to move by itself: "لو اكتمل من نفسها
 * يعملها ولو بيتصمم يكون برضو تلقائيًا". Until now every step was a human
 * clicking — a dropdown on the staff card, and (worse) a "simulate" button on
 * the customer's own screen, which has been removed.
 *
 * HOW IT WORKS
 * When money actually arrives, the order gets a PLAN: one timestamp per stage,
 * measured from the moment it was paid. A sweep in server.ts wakes up every
 * quarter of an hour, picks up the orders whose next timestamp has passed, and
 * moves them one step. Nothing is guessed at read time — the stage on the
 * customer's screen is the stage stored on the order, so staff, production, the
 * customer and the job sheet can never disagree.
 *
 * WHY A PLAN AND NOT A TIMER
 * Timers die with the process. The site is restarted, redeployed and (right now)
 * switched off entirely; a plan made of timestamps survives all three, and an
 * order that should have moved three stages while the server was down catches
 * up on the next sweep instead of being stuck forever.
 *
 * This module is deliberately pure — no Firestore, no dates from the ambient
 * clock beyond what the caller passes in — so both server.ts and the dashboard
 * compute the same schedule from the same numbers, and neither can drift.
 */

import { addWorkingDaysOnWall } from './productionSpeed';
import { fromShopWall, toShopWall } from './reportDays';

/** The stages an order moves through on its own, in order. */
export const AUTO_STAGE_ORDER = ['in_design', 'in_print', 'finishing', 'shipped', 'completed'] as const;

export type AutoStageKey = (typeof AUTO_STAGE_ORDER)[number];

/** Nothing advances out of these. */
export const TERMINAL_STATUSES = ['completed', 'cancelled'] as const;

export interface AutoStageSettings {
  /** Master switch. Off = the stages only ever move by hand. */
  enabled: boolean;
  /**
   * Hours spent in the PREVIOUS stage before this one begins, counted from when
   * the order entered it. `in_design` is counted from the moment of payment.
   */
  hours: Record<AutoStageKey, number>;
  /**
   * A print shop does not ship on a Sunday. A stage that would land on a weekend
   * is pushed to the Monday, at the same time of day — the same rule the
   * promised delivery date already uses.
   */
  skipWeekends: boolean;
}

/**
 * The defaults, chosen to land on the delivery promise the shop already makes
 * (three production days, then transit): 4 h to reach design, then 20 + 24 + 24
 * hours through print, finishing and despatch — 72 h, three days — and 48 h of
 * transit before it counts as delivered.
 */
export const AUTO_STAGE_DEFAULTS: AutoStageSettings = {
  enabled: true,
  hours: {
    in_design: 4,
    in_print: 20,
    finishing: 24,
    shipped: 24,
    completed: 48,
  },
  skipWeekends: true,
};

/** One stored timestamp per stage. */
export type StagePlan = Partial<Record<AutoStageKey, string>>;

/** Anything the owner can type, turned into numbers this module can trust. */
export function sanitizeAutoStageSettings(raw: any): AutoStageSettings {
  const hours = {} as Record<AutoStageKey, number>;
  for (const stage of AUTO_STAGE_ORDER) {
    const value = Number(raw?.hours?.[stage]);
    // 0 is legitimate (a shop that does not do finishing wants that stage to
    // pass straight through); a negative or unreadable value is not.
    hours[stage] = Number.isFinite(value) && value >= 0 ? value : AUTO_STAGE_DEFAULTS.hours[stage];
  }
  return {
    enabled: raw?.enabled !== false,
    hours,
    skipWeekends: raw?.skipWeekends !== false,
  };
}

/** Saturday or Sunday on a shop wall clock (src/lib/reportDays.ts toShopWall). */
function isWeekendWall(wall: Date): boolean {
  const day = wall.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Push a weekend timestamp to the following Monday, same time of day — on the
 * SHOP'S calendar. This counted UTC days: a stage due at 00:30 on a Monday in
 * Stockholm is still Sunday in UTC, and was pushed to TUESDAY 00:30.
 */
function skipToMonday(date: Date): Date {
  const wall = toShopWall(date);
  if (!Number.isFinite(wall.getTime()) || !isWeekendWall(wall)) return new Date(date.getTime());
  while (isWeekendWall(wall)) wall.setUTCDate(wall.getUTCDate() + 1);
  return fromShopWall(wall);
}

/** The stage that comes after `status`, or null at the end of the line. */
export function nextAutoStage(status: string): AutoStageKey | null {
  const s = String(status || '').toLowerCase().trim();
  if ((TERMINAL_STATUSES as readonly string[]).includes(s)) return null;
  // 'pending' — and any status this module does not know — starts at the top.
  const idx = (AUTO_STAGE_ORDER as readonly string[]).indexOf(s);
  if (idx === -1) return AUTO_STAGE_ORDER[0];
  return AUTO_STAGE_ORDER[idx + 1] ?? null;
}

/**
 * NOTHING IS AUTOMATICALLY "SHIPPED" WHEN NOTHING SHIPS.
 *
 * An order the customer chose to COLLECT was being walked through the same five
 * stages as a courier job: the sweep wrote 'shipped', then 'completed', then
 * stamped `deliveredAt`. So a customer who ticked Pickup was told their parcel
 * had been dispatched by courier and then delivered to their address, while the
 * job sat on the counter — and they were never told it was ready to collect.
 * The shop's own records showed a delivery that never happened, and the order
 * left the production queue as Completed.
 *
 * The rest of the code already knows the difference — the Zendr booking declines
 * with "This order is collected, not shipped", and the confirmation email prints
 * a "Collect your order here" box. Only the stage plan did not.
 *
 * So a pickup order is planned as far as `finishing` and stops. With no
 * `shipped` entry in the plan, `nextStageAtFor` returns null and the sweep has
 * nothing to act on: the last move is a human's, which is right, because the
 * last move IS a human handing a box over a counter.
 */
export function stagesForShipping(shippingMethod?: string | null): readonly AutoStageKey[] {
  return String(shippingMethod ?? '').toLowerCase().trim() === 'pickup'
    ? (['in_design', 'in_print', 'finishing'] as const)
    : AUTO_STAGE_ORDER;
}

/** The stages before the job leaves the building — what a production speed compresses or stretches. */
const BEFORE_DISPATCH: readonly AutoStageKey[] = ['in_design', 'in_print', 'finishing', 'shipped'];

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Working time from wall `a` to wall `b`: a weekend day counts for nothing when weekends are skipped. */
function workingMsBetween(a: number, b: number, skipWeekends: boolean): number {
  if (!skipWeekends) return Math.max(0, b - a);
  let total = 0;
  for (let t = a; t < b; ) {
    const end = Math.min((Math.floor(t / DAY_MS) + 1) * DAY_MS, b);
    if (!isWeekendWall(new Date(t))) total += end - t;
    t = end;
  }
  return total;
}

/** Wall `a` plus `ms` of working time — never landing on a weekend when they are skipped. */
function addWorkingMs(a: number, ms: number, skipWeekends: boolean): number {
  if (!skipWeekends) return a + ms;
  let t = a;
  let left = Math.max(0, ms);
  // Bounded: sixty working days is under a hundred calendar days.
  for (let guard = 0; guard < 200; guard += 1) {
    const dayEnd = (Math.floor(t / DAY_MS) + 1) * DAY_MS;
    if (!isWeekendWall(new Date(t))) {
      if (left < dayEnd - t) return t + left;
      left -= dayEnd - t;
    }
    t = dayEnd;
  }
  return t;
}

/** A production speed's days, when they can be trusted (1…60); anything else = no speed. */
function usableDays(productionDays: unknown): number | null {
  const n = Number(productionDays);
  return productionDays != null && Number.isFinite(n) && n >= 1 && n <= 60 ? Math.round(n) : null;
}

/**
 * THE PLAN OF AN ORDER WHOSE PRODUCTION SPEED SET ITS DAYS (src/lib/productionSpeed.ts).
 *
 * Dispatch is anchored at `from` + the speed's WORKING days — the same count the
 * promised date uses — and the stages before it are spread by the owner's own
 * proportions (4 : 20 : 24 : 24 by default) between the two. A single scale factor
 * on the hours drifted one to four calendar days against that date once weekends
 * fell inside. Transit to "completed" is the owner's hours, as for every order.
 * `share` is the part of the production days still to run (1 from the start; less
 * when a person moves a job on by hand). Returns null when anything is unusable —
 * the caller then plans exactly as before speeds existed.
 */
function speedPlan(
  from: Date,
  settings: AutoStageSettings,
  stages: readonly AutoStageKey[],
  productionDays: number,
): StagePlan | null {
  const fromWall = toShopWall(from).getTime();
  if (!Number.isFinite(fromWall)) return null;
  const total = BEFORE_DISPATCH.reduce((sum, k) => sum + Math.max(0, settings.hours[k]), 0);
  const ahead = stages.filter((k) => BEFORE_DISPATCH.includes(k));
  const aheadHours = ahead.reduce((sum, k) => sum + Math.max(0, settings.hours[k]), 0);
  // The share of the production days these stages stand for (all of them from the
  // start). With every hour set to 0 the owner has said nothing about proportions:
  // the stages still ahead all land at dispatch. Stages he set to 0 hours that are
  // all that is left pass straight through — no day is added under them.
  const share = total > 0 ? aheadHours / total : 1;
  const days = ahead.length > 0 ? Math.max(0, Math.ceil(productionDays * share - 1e-9)) : 0;
  const dispatchAt = addWorkingDaysOnWall(new Date(fromWall), days, settings.skipWeekends);
  // No days left to count (the stages ahead are 0 hours) from a Saturday: still
  // not dispatched on the weekend — Monday, same time, as every other stage.
  while (settings.skipWeekends && isWeekendWall(dispatchAt)) dispatchAt.setUTCDate(dispatchAt.getUTCDate() + 1);
  const dispatchWall = dispatchAt.getTime();
  // The stages share out the WORKING time to dispatch by his proportions. Spread
  // over calendar time and then pushed off the weekend one by one, a stage could
  // land after the next one, or after dispatch itself (368 of 1 680 start/speed
  // combinations did). Here none lands on a weekend, after dispatch, or before
  // the stage ahead of it.
  const span = workingMsBetween(fromWall, dispatchWall, settings.skipWeekends);
  const plan: StagePlan = {};
  let acc = 0;
  let last = from.getTime();
  for (const stage of stages) {
    let at: number;
    if (stage === 'completed') {
      at = last + settings.hours.completed * HOUR_MS;
      if (settings.skipWeekends) at = skipToMonday(new Date(at)).getTime();
    } else {
      acc += Math.max(0, settings.hours[stage]);
      const part = aheadHours > 0 ? acc / aheadHours : 1;
      const wall = part >= 1 ? dispatchWall : Math.min(addWorkingMs(fromWall, span * part, settings.skipWeekends), dispatchWall);
      at = Math.max(fromShopWall(new Date(wall)).getTime(), last);
    }
    if (!Number.isFinite(at)) return null;
    plan[stage] = new Date(at).toISOString();
    last = at;
  }
  return plan;
}

/**
 * The whole schedule, from the moment the order was paid.
 *
 * Returns `{}` when the feature is switched off, so a caller can store the
 * result unconditionally and an order simply carries no plan. `productionDays`:
 * set only for an order whose production speed set its days — dispatch is then
 * that many working days from the start (src/lib/productionSpeed.ts).
 */
export function buildStagePlan(
  startIso: string,
  settings: AutoStageSettings,
  shippingMethod?: string | null,
  productionDays?: number | null,
): StagePlan {
  if (!settings.enabled) return {};
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return {};
  const speedDays = usableDays(productionDays);
  if (speedDays !== null) {
    const plan = speedPlan(start, settings, stagesForShipping(shippingMethod), speedDays);
    if (plan) return plan;
  }

  const plan: StagePlan = {};
  let cursor = start;
  for (const stage of stagesForShipping(shippingMethod)) {
    cursor = new Date(cursor.getTime() + settings.hours[stage] * 60 * 60 * 1000);
    if (settings.skipWeekends) cursor = skipToMonday(cursor);
    plan[stage] = cursor.toISOString();
  }
  return plan;
}

/**
 * Re-plan from HERE.
 *
 * Used when a human moves a job by hand: the press finished early, the paper is
 * late. Everything still to come is re-measured from this moment, so a job
 * pushed forward at 09:00 does not get dragged back by a schedule made at
 * midnight — and a job pushed BACK gets a fresh run at the stages it repeats.
 */
export function replanFrom(
  status: string,
  fromIso: string,
  settings: AutoStageSettings,
  shippingMethod?: string | null,
  productionDays?: number | null,
): StagePlan {
  if (!settings.enabled) return {};
  const start = new Date(fromIso);
  if (Number.isNaN(start.getTime())) return {};

  const plan: StagePlan = {};
  const next = nextAutoStage(status);
  if (!next) return {};

  // A speed order re-planned (moved by hand, or its artwork arrived): the stages
  // still ahead get their share of the speed's days, from now.
  const speedDays = usableDays(productionDays);
  if (speedDays !== null) {
    const all = stagesForShipping(shippingMethod);
    const ahead = all.slice(Math.max(0, all.indexOf(next)));
    const speeded = all.includes(next) ? speedPlan(start, settings, ahead, speedDays) : null;
    if (speeded) return speeded;
  }

  let cursor = start;
  let reached = false;
  // Same shipping rule as buildStagePlan: a collected order is never planned
  // past `finishing`, whichever direction it is being re-planned from.
  for (const stage of stagesForShipping(shippingMethod)) {
    if (stage === next) reached = true;
    if (!reached) continue;
    cursor = new Date(cursor.getTime() + settings.hours[stage] * 60 * 60 * 1000);
    if (settings.skipWeekends) cursor = skipToMonday(cursor);
    plan[stage] = cursor.toISOString();
  }
  return plan;
}

/** When this order is next due to move, or null when it is not due to move at all. */
export function nextStageAtFor(status: string, plan: StagePlan | null | undefined): string | null {
  const next = nextAutoStage(status);
  if (!next || !plan) return null;
  return plan[next] ?? null;
}

/**
 * May this order advance on its own right now?
 *
 * The rules, and why each one exists:
 *  - MONEY FIRST. An unpaid order never moves. A tracker that walks an unpaid
 *    job into production is how a shop prints for free.
 *  - A cancelled or completed order is finished with.
 *  - No artwork, no press. A line with no file cannot be printed, so the order
 *    holds at design and waits for a human — silently marching it to "Shipped"
 *    would tell the customer their job left the building when nothing was ever
 *    made.
 */
export function autoAdvanceBlockedReason(order: {
  status?: string;
  paymentStatus?: string;
  /** Placed to pay on delivery (a customer the owner chose): produced before it is paid. */
  payOnDelivery?: boolean;
  artworkPending?: boolean;
  items?: { artworkPending?: boolean; artworkSource?: string | null }[];
}): 'unpaid' | 'terminal' | 'artwork_pending' | 'artwork_by_shop' | null {
  const status = String(order.status || '').toLowerCase().trim();
  if ((TERMINAL_STATUSES as readonly string[]).includes(status)) return 'terminal';
  if (String(order.paymentStatus || '').toLowerCase() !== 'paid' && order.payOnDelivery !== true) return 'unpaid';

  const artworkMissing =
    order.artworkPending === true || (order.items ?? []).some((item) => item?.artworkPending === true);
  // Design is as far as a job with no file may go.
  if (artworkMissing && nextAutoStage(status) !== 'in_design') return 'artwork_pending';

  // THE SHOP'S OWN ARTWORK — a reprint of an earlier order's file, or the
  // studio's design. Not the customer's to send, so nothing is "awaited" from
  // him; but nothing is on the order to print either, so the same rule holds: it
  // goes no further than design until a person moves it to print.
  const shopArtwork = (order.items ?? []).some(
    (item) => item?.artworkSource === 'reprint' || item?.artworkSource === 'studio',
  );
  if (shopArtwork && nextAutoStage(status) === 'in_print') return 'artwork_by_shop';

  return null;
}
