/**
 * WHO IS AN ADMINISTRATOR, REMEMBERED — for ONE screen (round 16, item 9).
 *
 * Every admin request reads users/{uid} to check the role. On the supplier
 * picker that is a read per keystroke of a search, and when the free plan's
 * daily read quota is spent the search dies at that read — before the shop's own
 * disk copy of the catalogue, which would have answered, is ever reached. That is
 * one way "the search does not work" looked from the owner's chair.
 *
 * So the picker's read-only catalogue request may reuse an answer: one from the
 * last minute (a burst of searches costs one read), and — only when Firestore
 * REFUSES the read (quota, unavailable, deadline) — the last POSITIVE answer up to
 * a day old. Every other admin request reads, as before: demoting or suspending
 * someone is written from the browser, and the server never hears of it.
 *
 * Pure: server.ts keeps the map and the disk copy. scripts/test-supplier-search.mjs.
 */

export interface RoleAnswer {
  admin: boolean;
  suspended: boolean;
  email: string | null;
  /** When it was read. */
  at: number;
}

/** A refused read — not "no such user": RESOURCE_EXHAUSTED (8), UNAVAILABLE (14), DEADLINE_EXCEEDED (4). */
export function isReadRefusal(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = Number(e?.code);
  if (code === 4 || code === 8 || code === 14) return true;
  return /RESOURCE_EXHAUSTED|Quota (limit )?exceeded|UNAVAILABLE|DEADLINE_EXCEEDED/i.test(String(e?.message ?? ''));
}

export function roleCache({ freshMs, staleMs, max }: { freshMs: number; staleMs: number; max: number }) {
  const map = new Map<string, RoleAnswer>();
  return {
    /** An answer from the last `freshMs` — positive or not — used instead of a read. */
    fresh(uid: string, now: number): RoleAnswer | null {
      const a = map.get(uid);
      return a && now >= a.at && now - a.at < freshMs ? a : null;
    },
    /** Whether this worker has seen ANY answer for this person — a "no" here outranks an older "yes" on disk. */
    has(uid: string): boolean {
      return map.has(uid);
    },
    /** When the read is refused: the last answer that let this person in, up to `staleMs` old. */
    stale(uid: string, now: number): RoleAnswer | null {
      const a = map.get(uid);
      return a && a.admin && !a.suspended && now - a.at < staleMs ? a : null;
    },
    remember(uid: string, answer: RoleAnswer): void {
      map.delete(uid);
      map.set(uid, answer);
      // The oldest goes first: a handful of admins, never an unbounded map.
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
  };
}
