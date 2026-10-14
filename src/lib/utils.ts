import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Money as the shop actually trades it: Swedish krona, Swedish formatting.
 *
 * This used to be hardcoded to en-US / USD, so every amount that passed through
 * it printed a dollar sign — the add-to-cart button, the invoice total and the
 * receipt total included, while the VAT line right above said SEK.
 */
export function formatCurrency(amount: number, currency: string = 'SEK') {
  return new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency,
  }).format(Number(amount) || 0);
}

/**
 * An image src the browser can safely be handed.
 *
 * A stored value is only usable if it is an http(s) URL or a complete data: URL.
 * Anything else — most often a base64 blob whose `data:image/png;base64,` prefix
 * was lost on the way into the database — becomes a RELATIVE url when put in a
 * `src`, so the browser tries to fetch `https://yourshop.se/wCAYAAADrIbPP…` with
 * a 100 KB path and the request dies with 431 Request Header Fields Too Large.
 * Returns null so the caller can show a placeholder instead.
 */
export function safeImageSrc(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(v)) return v;
  if (v.startsWith('/')) return v; // served from our own public folder
  return null;
}

/**
 * Can this attachment be drawn in an <img>?
 *
 * WHY THIS EXISTS
 * Three screens decided it by asking whether the URL started with "http" — and
 * every print file in this shop is served over https from object storage, so a
 * press-ready PDF was handed to an <img> tag that can never render it. The
 * browser blocked the load, SafeImage fell back to its grey "no image" tile, and
 * the production screens showed what looked like a broken photo where they
 * should have shown a clean "PDF file" card. The artwork was fine the whole time.
 *
 * Decide on what the file IS, not on how it is delivered: the data URL's own
 * media type, the extension, or the fileType the order recorded.
 */
const RASTER_EXTENSIONS = /\.(jpe?g|png|gif|webp|svg|bmp|avif)($|\?|#)/i;
const RASTER_TYPES = new Set(['JPG', 'JPEG', 'PNG', 'GIF', 'WEBP', 'SVG', 'BMP', 'AVIF']);

export function isDisplayableImage(url?: string | null, fileName?: string | null, fileType?: string | null): boolean {
  if (!url) return false;
  if (url.startsWith('data:image')) return true;
  if (url.startsWith('data:')) return false;
  if (RASTER_EXTENSIONS.test(url)) return true;
  if (fileName && RASTER_EXTENSIONS.test(fileName)) return true;
  if (fileType && RASTER_TYPES.has(String(fileType).trim().toUpperCase())) return true;
  return false;
}
