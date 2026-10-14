/**
 * WHAT A DESIGNED FILE BRINGS WITH IT — designer v2.
 *
 * A file from the studio is a PNG (one side) or a PDF of every page (two sides, or a
 * large format). Production must never open a 40 MB PDF to see what a line is, so each
 * page comes with a small picture of it (the trim, ~800 px), uploaded beside the file:
 * the basket, the order pages, the job sheet and the production queue show THOSE.
 * And the sides the file holds, in print order, so the job sheet can say
 * "Page 1 Front / Page 2 Back".
 *
 * The browser sends these; the server keeps them only through here: a preview only at
 * the shop's own storage (the same rule as the file itself), at most one per side, the
 * sides only front/back, each once, in print order. Pure; scripts/test-design-doc.mjs.
 */

export type FileSide = 'front' | 'back';

export interface DesignPreview {
  side: FileSide;
  url: string;
}

const SIDES: readonly FileSide[] = ['front', 'back'];

/** The page previews a line may keep, or null when there are none worth keeping. */
export function cleanDesignPreviews(raw: unknown, isOurUrl: (url: unknown) => boolean): DesignPreview[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DesignPreview[] = [];
  for (const p of raw.slice(0, 4)) {
    const r = p as { side?: unknown; url?: unknown } | null;
    if (!r || typeof r !== 'object') continue;
    const side = SIDES.find((s) => s === r.side);
    if (!side || out.some((x) => x.side === side) || !isOurUrl(r.url)) continue;
    out.push({ side, url: String(r.url) });
  }
  out.sort((a, b) => SIDES.indexOf(a.side) - SIDES.indexOf(b.side));
  return out.length ? out : null;
}

/** The sides a designed file holds, in print order — or null when it does not say, or says nonsense. */
export function cleanDesignSides(raw: unknown): FileSide[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 2) return null;
  if (!raw.every((s) => SIDES.includes(s as FileSide))) return null;
  if (new Set(raw).size !== raw.length) return null;
  return [...(raw as FileSide[])].sort((a, b) => SIDES.indexOf(a) - SIDES.indexOf(b));
}

/** The picture to show for a line: its front page's preview, else its only one, else nothing. */
export function previewOf(spec: { previews?: DesignPreview[] | null } | null | undefined, side: FileSide = 'front'): string | null {
  const list = Array.isArray(spec?.previews) ? spec!.previews! : [];
  return list.find((p) => p.side === side)?.url ?? list[0]?.url ?? null;
}
