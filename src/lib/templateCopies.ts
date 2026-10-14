/**
 * THE SHOP'S COPY OF THE OWNER'S DESIGN TEMPLATES — round 16, item 5b. The
 * policy only: server.ts gives it the files and the database, and
 * scripts/test-design.mjs drives it with fakes.
 *
 * A customer's page view must cost NO database read. The shop is on Firebase's
 * free plan, whose daily read quota has run out three times and taken the shop
 * down with it. So a list is answered from this worker's memory; else from the
 * disk copy every worker of the host shares; else by ONE read, which every
 * request arriving while it runs waits for.
 *
 * A copy counts only when it was taken after the owner's last change (`changedAt`
 * — a stamp on disk, because the change reaches only the worker it was sent to)
 * and within `maxAgeMs`. A read begun BEFORE a change cannot answer for after it.
 * A failed read is not tried again for `retryMs`, and meanwhile the newest copy
 * there is — old or not — is served; with none at all the caller is told, so it
 * can answer "could not say", never "there are none".
 */
export interface TemplateCopyDeps<T> {
  now(): number;
  /** When the owner last changed the templates (0: never). */
  changedAt(): number;
  /** The disk copy, parsed — the caller keeps it parsed until the file changes. */
  readDisk(): { at: number; items: T[] } | null;
  writeDisk(items: T[], at: number): void;
  /** The ONE database read. */
  read(): Promise<T[]>;
  maxAgeMs: number;
  retryMs: number;
}

export function templateCopies<T>(deps: TemplateCopyDeps<T>) {
  let memory: { at: number; items: T[] } | null = null;
  let inflight: { startedAt: number; promise: Promise<T[]> } | null = null;
  let failedAt = Number.NEGATIVE_INFINITY;

  const get = async (): Promise<T[]> => {
    const now = deps.now();
    const since = deps.changedAt();
    // A refusal "in the future" is a clock that stepped back: no reason to wait.
    if (failedAt > now) failedAt = Number.NEGATIVE_INFINITY;
    const fresh = (c: { at: number } | null): boolean => !!c && c.at >= since && now - c.at < deps.maxAgeMs;
    if (memory && fresh(memory)) return memory.items;
    const disk = deps.readDisk();
    if (disk && fresh(disk)) {
      memory = disk;
      return disk.items;
    }
    const newest = (): T[] | null => {
      const c = memory && (!disk || memory.at >= disk.at) ? memory : disk;
      return c ? c.items : null;
    };
    if (now - failedAt < deps.retryMs) {
      const copy = newest();
      if (copy) return copy;
      throw new Error('templates-unavailable');
    }
    let run = inflight;
    if (!run || run.startedAt < since) {
      // Never dated before the change it is read for — a stamp ahead of a clock
      // that stepped back would otherwise send every request to the database.
      const startedAt = Math.max(deps.now(), since);
      const next: { startedAt: number; promise: Promise<T[]> } = { startedAt, promise: Promise.resolve([]) };
      next.promise = (async () => {
        const items = await deps.read();
        // An older read finishing last must not put its copy over a newer one:
        // not in this worker's memory, and not on the disk every worker reads
        // (each of them would then read the database again).
        if (!memory || memory.at <= startedAt) memory = { at: startedAt, items };
        const onDisk = deps.readDisk();
        if (startedAt >= deps.changedAt() && (!onDisk || onDisk.at <= startedAt)) deps.writeDisk(items, startedAt);
        return items;
      })().finally(() => {
        if (inflight === next) inflight = null;
      });
      inflight = next;
      run = next;
    }
    try {
      return await run.promise;
    } catch (err) {
      failedAt = deps.now();
      const copy = newest();
      if (copy) return copy;
      throw err;
    }
  };

  return {
    get,
    /** The owner changed them: this worker's copy goes at once (the caller stamps the disk for the rest). */
    forget(): void {
      memory = null;
      failedAt = Number.NEGATIVE_INFINITY;
    },
    /**
     * Read the new copy NOW, after a change: true only once it is held — in this
     * worker and, for the others, on disk. The dashboard deletes the files of the
     * version before on that answer, so "stamped" alone must not count.
     */
    async reload(): Promise<boolean> {
      memory = null;
      failedAt = Number.NEGATIVE_INFINITY;
      try {
        await get();
      } catch {
        return false;
      }
      return !!memory && memory.at >= deps.changedAt();
    },
    /** The date of the newest copy there is — a new stamp must be later than it. */
    newestAt(): number {
      return Math.max(memory?.at ?? 0, deps.readDisk()?.at ?? 0);
    },
  };
}
