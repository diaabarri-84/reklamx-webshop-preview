/**
 * AI PICTURES FOR THE DESIGNER — the rules of POST /api/designer/ai-images
 * (designer v2's AI Studio).
 *
 * A customer describes a picture; the shop's own Google key makes four. It costs the
 * owner money per picture (Google's image models need billing on his project), so:
 *  - it is OFF until he switches it on (settings `designerAiImages`);
 *  - a shop-wide cap per day (his `designerAiDailyCap`, default 80 pictures), counted
 *    on the server's disk, so a restart does not reset it;
 *  - a per-visitor limit on top (server.ts), so one visitor cannot spend the day.
 * The words go to Google and nowhere else; nothing is stored.
 *
 * Pure; scripts/test-ai-images.mjs.
 */

export type AiImageShape = 'portrait' | 'landscape' | 'square';

/** Pictures made per request. */
export const AI_IMAGE_COUNT = 4;
export const AI_IMAGE_PROMPT_MAX = 500;
export const AI_IMAGE_DAILY_CAP_DEFAULT = 80;
export const AI_IMAGE_DAILY_CAP_MAX = 2000;

const ASPECT: Record<AiImageShape, '3:4' | '4:3' | '1:1'> = { portrait: '3:4', landscape: '4:3', square: '1:1' };

/** The request made safe, or null: words (no control characters, ≤ 500), a shape. */
export function cleanAiImageRequest(body: unknown): { prompt: string; aspectRatio: '3:4' | '4:3' | '1:1' } | null {
  const b = body as { prompt?: unknown; shape?: unknown } | null;
  if (!b || typeof b !== 'object') return null;
  // A string or nothing. String() on a crafted object ({"toString":1}) throws, and a
  // throw here once took the whole server process down with it.
  const prompt = (typeof b.prompt === 'string' ? b.prompt : '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, AI_IMAGE_PROMPT_MAX);
  if (prompt.length < 3) return null;
  const shape = (['portrait', 'landscape', 'square'] as const).find((s) => s === b.shape) ?? 'square';
  return { prompt, aspectRatio: ASPECT[shape] };
}

/**
 * The owner's daily cap, made safe: absent or empty, the default; at most 2000; 0 is
 * his "none today". A request makes four pictures, so a cap is a whole number of
 * requests — rounded UP to four (a cap of 1–3 let no request through at all, while
 * the studio still offered the AI panel and answered every try with "limit").
 */
export function dailyCap(raw: unknown): number {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return AI_IMAGE_DAILY_CAP_DEFAULT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return AI_IMAGE_DAILY_CAP_DEFAULT;
  return Math.min(AI_IMAGE_DAILY_CAP_MAX, Math.ceil(Math.floor(n) / AI_IMAGE_COUNT) * AI_IMAGE_COUNT);
}

/** Today's count of pictures made, and whether `want` more fit under the cap. */
export function takeBudget(
  state: { day?: unknown; used?: unknown } | null | undefined,
  today: string,
  cap: number,
  want: number,
): { ok: boolean; next: { day: string; used: number } } {
  const used = state && state.day === today && Number.isFinite(Number(state.used)) ? Math.max(0, Number(state.used)) : 0;
  if (used + want > cap) return { ok: false, next: { day: today, used } };
  return { ok: true, next: { day: today, used: used + want } };
}

/**
 * Today's count with `want` given back — for a request Google answered with no
 * pictures, or refused with an HTTP error: it made nothing the owner pays for, and
 * the customer's try should not use up the shop's day. Null when there is nothing
 * to give back: a count from another day (the day it belonged to is over, and
 * writing it would overwrite today's), or none used. Never below zero.
 */
export function giveBack(
  state: { day?: unknown; used?: unknown } | null | undefined,
  today: string,
  want: number,
): { day: string; used: number } | null {
  if (!state || state.day !== today || !Number.isFinite(Number(state.used))) return null;
  const used = Math.max(0, Number(state.used));
  if (used === 0) return null;
  return { day: today, used: Math.max(0, used - Math.max(0, Number(want) || 0)) };
}

/** The pictures in Google's answer, as base64 PNG/JPEG bytes (none when it made none). */
export function imagesFromResponse(r: unknown): Array<{ data: string; mime: string }> {
  const list = (r as { generatedImages?: Array<{ image?: { imageBytes?: unknown; mimeType?: unknown } }> } | null)?.generatedImages;
  if (!Array.isArray(list)) return [];
  return list
    .map((g) => ({ data: typeof g?.image?.imageBytes === 'string' ? g.image.imageBytes : '', mime: typeof g?.image?.mimeType === 'string' ? g.image.mimeType : 'image/png' }))
    .filter((x) => x.data.length > 100 && /^image\/(png|jpeg|webp)$/.test(x.mime))
    .slice(0, AI_IMAGE_COUNT);
}

/** What a failed call means for the customer: switched off / out for today / try again. */
export function aiImageFailure(status: number | undefined, message: string): 'off' | 'limit' | 'failed' {
  if (status === 429 || /quota|rate|exhausted/i.test(message)) return 'limit';
  if (status === 401 || status === 403 || status === 404 || /bill(ing|ed)|permission|not found|not available|api key/i.test(message)) return 'off';
  return 'failed';
}
