/**
 * The owner's design templates, as a customer's browser gets them — round 16,
 * item 5b. Never from Firestore: from the server's copy (GET /api/design-templates),
 * so a product page costs the shop no read.
 *
 * PICTURES ARE ALL OR NOTHING. A template's pictures are fetched into Blobs
 * (same-origin blob: URLs, so the print file can still be drawn: a picture from
 * another origin would taint the canvas and the export would throw). If any one
 * of them fails to arrive or to decode, the template is not opened at all.
 * Opened without it, the shop's own locked logo would simply be missing from the
 * customer's print file, and nobody would notice.
 */
import type { TemplateSummary } from '../../../lib/designTemplateDoc';

export interface TemplateFullClient extends TemplateSummary {
  json: string;
  images: Record<string, string>;
  lockBackground: boolean;
}

/**
 * A fetch WITH ITS BODY, within a deadline. This host has answered in 46 seconds
 * before now, and a chooser that says "loading" for that long, with nothing to
 * do, is a broken one. The deadline runs until the body is read: headers that
 * arrive on time over a body that stalls would otherwise wait for ever.
 */
async function within<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), ms);
  try {
    return await run(ctl.signal);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * The templates offered on this product: an empty list when there are none —
 * and NULL when the shop could not say (an error, a timeout). The two are not the
 * same: "none" sends a customer straight on, "could not say" offers a retry.
 */
export async function fetchTemplateList(productId: string, categoryId: string | null | undefined): Promise<TemplateSummary[] | null> {
  try {
    const q = new URLSearchParams({ product: productId, category: String(categoryId ?? '') });
    return await within(15_000, async (signal) => {
      const res = await fetch(`/api/design-templates?${q}`, { signal });
      if (!res.ok) return null;
      const body = (await res.json()) as { templates?: TemplateSummary[] };
      return Array.isArray(body.templates) ? body.templates : null;
    });
  } catch {
    return null;
  }
}

export async function fetchTemplateFull(id: string): Promise<TemplateFullClient | null> {
  try {
    return await within(20_000, async (signal) => {
      const res = await fetch(`/api/design-templates/${encodeURIComponent(id)}`, { signal });
      if (!res.ok) return null;
      const t = (await res.json()) as TemplateFullClient;
      return t && typeof t.json === 'string' && t.images && typeof t.images === 'object' ? t : null;
    });
  } catch {
    return null;
  }
}

/** Every picture, as a Blob that decodes — or null if even one does not. */
export async function fetchPictures(images: Record<string, string>): Promise<Record<string, Blob> | null> {
  try {
    const entries = await Promise.all(
      Object.entries(images).map(async ([id, url]) => {
        const blob = await within(30_000, async (signal) => {
          const res = await fetch(url, { signal });
          if (!res.ok) throw new Error(`picture ${id}: ${res.status}`);
          return res.blob();
        });
        // A body that is not an image (an error page, a moved file) must fail HERE.
        const bitmap = await createImageBitmap(blob);
        bitmap.close();
        return [id, blob] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch (err) {
    console.warn('A template picture could not be loaded:', err);
    return null;
  }
}
