// Building a supplier's index, one bounded step at a time.
//
// WHY IT IS A STEP MACHINE AND NOT A LOOP.
// The owner's client asked to be able to build the catalogue himself. The job is
// thousands of products — EasyGifts is a 13 MB feed and 1 330 rows, midocean is
// 26 MB and 2 519 masters — and the host it must run on drops roughly one request
// in five, has been measured returning 502 after 47 seconds, and lets Passenger
// reap an idle process between requests. A single request cannot hold that, and a
// `for` loop in a browser tab cannot survive the tab being closed.
//
// So the work is cut into units that each finish in seconds, and the CURSOR lives
// outside the process — on disk — so any caller can pick the job up where the
// last one left it: the owner's browser while his tab is open, the cron when it
// is not, and a retry after a dropped request without losing the work already
// committed.
//
// This file is pure on purpose. Every decision that leads to writing thousands of
// documents is a function of a plain object, so all of it is testable without a
// database, a host, or a supplier that happens to be up — which matters, because
// the day this was written Firestore was refusing every read.

/** Firestore's own limit is 500 operations in a batch; 400 leaves room for the progress write. */
export const INDEX_BATCH = 400;

/** How long a step may be unheard from before another caller may take the run over. */
export const STALE_MS = 4 * 60 * 1000;

export type IndexPhase = 'fetch' | 'write' | 'gone' | 'finish' | 'done' | 'blocked';

export interface IndexRun {
  supplier: string;
  runId: string;
  phase: IndexPhase;
  /** How many rows of the plan have been committed. The resume point. */
  cursor: number;
  /** How many rows the parsed feed produced. 0 until the fetch unit has run. */
  total: number;
  startedAt: string;
  updatedAt: string;
  /** A stable slug, never a sentence — the browser renders the language. */
  reason?: string;
  finishedAt?: string;
}

/**
 * A document id may not contain '/'.
 *
 * ⚠️ BYTE-IDENTICAL to scripts/index-supplier.mjs:168 on purpose. If the two ever
 * disagree, the same product gets two rows — one from the laptop and one from the
 * button — and the count on screen silently doubles. scripts/test-supplier-index-run.mjs
 * asserts this against literal keys copied from that file.
 */
export function idForEntry(e: { supplier: string; productKey: unknown }): string {
  return `${e.supplier}__${String(e.productKey).replace(/[^\w.-]+/g, '_')}`;
}

/** Where a run is up to, decided only by what it has already done. */
export function nextPhase(run: Pick<IndexRun, 'phase' | 'cursor' | 'total'>): IndexPhase {
  if (run.phase === 'blocked' || run.phase === 'done') return run.phase;
  if (run.phase === 'fetch') return 'fetch';
  if (run.cursor < run.total) return 'write';
  return 'finish';
}

/**
 * A FEED THAT PARSED TO NOTHING IS A BROKEN FEED, not an emptied supplier.
 *
 * The laptop script has no guard for this: entries empty means every existing id
 * is "departed", and one shape change at the supplier's end would mark a whole
 * catalogue gone in a single run. The button must never be able to do that.
 */
export function refuseEmptyFeed(total: number): boolean {
  return !Number.isFinite(total) || total <= 0;
}

/**
 * May this caller take the run over?
 *
 * A run whose last step finished seconds ago is being driven by someone — a
 * second press must attach to it, not start a competing one. A run untouched for
 * minutes was almost certainly killed mid-step (a dropped request, a reaped
 * process) and must be resumable, or a single 502 would strand the job for ever.
 */
export function claimable(run: IndexRun | null, nowMs: number): 'claim' | 'attach' | 'takeover' {
  if (!run || run.phase === 'done' || run.phase === 'blocked') return 'claim';
  const age = nowMs - Date.parse(run.updatedAt || '') || 0;
  return age > STALE_MS ? 'takeover' : 'attach';
}

/** What the screen shows: a whole number of percent, and never 100 before it is done. */
export function percentDone(run: Pick<IndexRun, 'phase' | 'cursor' | 'total'>): number {
  if (run.phase === 'done') return 100;
  if (run.phase === 'fetch' || !run.total) return 0;
  return Math.min(99, Math.floor((run.cursor / run.total) * 100));
}
