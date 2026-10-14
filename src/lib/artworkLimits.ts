// How much artwork one order can carry, defined once for both sides.
//
// WHY THIS FILE EXISTS
// The upload page accepted files up to 3 MB and told the customer "Format
// Validated". The server rejected the order when the base64 artwork passed
// ~891 kB of text, which is only about 668 kB of actual file. The quote endpoint
// does not carry artwork, so nothing complained: the customer picked a size,
// filled in their name, address and phone, chose shipping, accepted the terms,
// pressed the button — and only then got "Your artwork is too large". For a
// print shop a 1 MB press-ready PDF is the normal case, not the edge case.
//
// Both limits now come from here, so they cannot drift apart again.
//
// The real fix is object storage: src/lib/uploadFile.ts and storage.rules are
// written and wired to nothing, because Firebase Storage is not enabled on the
// project yet. Until then artwork travels as base64 inside the order document
// and Firestore rejects any document over 1 MiB.

/**
 * The file types the shop accepts when a product's own rules say nothing.
 *
 * This lived in two places — the configurator's fallback rules and the product
 * page's "Design guidelines" panel — and the two lists disagreed, so the same
 * page told the shopper PDF/PNG/JPG/SVG in one panel and nine formats in the box
 * three sections below it.
 */
export const DEFAULT_ARTWORK_FORMATS = [
  'pdf', 'png', 'jpg', 'jpeg', 'svg', 'eps', 'tiff', 'psd', 'ai',
] as const;

/** Firestore's hard ceiling for one document. */
export const FIRESTORE_DOC_LIMIT = 1_048_576;

/**
 * Share of the document we are willing to spend on artwork. The rest is the
 * customer's details, the line items, the option labels and the totals.
 */
const ARTWORK_SHARE = 0.85;

/** Total base64 characters of artwork allowed across one order. */
export const MAX_ARTWORK_BASE64 = Math.floor(FIRESTORE_DOC_LIMIT * ARTWORK_SHARE);

/**
 * Base64 is 4 characters per 3 bytes, so a file inflates by a third on its way
 * into the document.
 */
export const BASE64_OVERHEAD = 4 / 3;

/** Actual file bytes that fit in one order, across every item in the cart. */
export const MAX_ARTWORK_BYTES = Math.floor(MAX_ARTWORK_BASE64 / BASE64_OVERHEAD);

/**
 * Ceiling for a single file, in megabytes, rounded down to one decimal so the
 * number shown to the customer is one they can act on.
 */
export const MAX_FILE_MB = Math.floor((MAX_ARTWORK_BYTES / (1024 * 1024)) * 10) / 10;

/** Sum the base64 artwork already sitting in a cart. */
export function artworkBase64Length(items: Array<{ fileSpecs?: { fileUrl?: string | null } | null }>): number {
  return (items ?? []).reduce((sum, item) => {
    const url = item?.fileSpecs?.fileUrl;
    return sum + (typeof url === 'string' ? url.length : 0);
  }, 0);
}

/**
 * Would adding a file of this size push the cart past what an order can hold?
 * Returns null when it fits, or a sentence to show the customer when it does not.
 */
export function artworkWouldOverflow(
  existingItems: Array<{ fileSpecs?: { fileUrl?: string | null } | null }>,
  newFileBytes: number,
): string | null {
  const used = artworkBase64Length(existingItems);
  const adding = Math.ceil(newFileBytes * BASE64_OVERHEAD);
  if (used + adding <= MAX_ARTWORK_BASE64) return null;

  const remainingBytes = Math.max(0, Math.floor((MAX_ARTWORK_BASE64 - used) / BASE64_OVERHEAD));
  const remainingMb = Math.floor((remainingBytes / (1024 * 1024)) * 10) / 10;

  return used === 0
    ? `This file is too large. The largest we can accept with an order is ${MAX_FILE_MB} MB.`
    : remainingMb > 0.1
      ? `Your basket already holds artwork, so there is room for about ${remainingMb} MB more. Place this order first, or use a smaller file.`
      : 'Your basket already holds as much artwork as one order can carry. Please place this order first.';
}

/**
 * THE RESOLUTION THE SHOP ACTUALLY ACCEPTS — 15.6.2b.
 *
 * It lived as a bare `const MIN_DPI = 150` inside the configurator's upload
 * handler, which was fine while it was only ever used to REFUSE a file. Round
 * 15 put a resolution figure on the dropzone as well — the pixel size a
 * customer should aim for — and wrote 300 into it, so the shop told him his
 * roll-up needed 10039 × 23622 px "or it prints blurred" and then happily
 * accepted 5020 × 11812. Two numbers for one rule, and the one the customer
 * reads was the wrong one: he would either believe a good file was unusable or
 * make one four times larger than the press needs.
 *
 * One constant, used by the sentence and by the check. 150 dpi is the
 * large-format trade standard this shop already prints to; changing it changes
 * both at once, which is the point.
 */
export const ARTWORK_MIN_DPI = 150;

/**
 * The smallest usable pixel size for a print of this many millimetres.
 *
 * The epsilon is for whole inches: 152.4 mm / 25.4 is 6.000000000000001 in
 * floating point, and without it a file of exactly 900 px (exactly 150 DPI) was
 * refused for want of a 901st. The designer's export rounds the same way
 * (designSize.ts pixelsFor), so its file is never measured against a different
 * number from the one it was made to.
 */
export function minPixelsFor(mm: number): number {
  return Math.ceil((mm / 25.4) * ARTWORK_MIN_DPI - 1e-9);
}

/**
 * THE LARGEST FILE THAT CAN TRAVEL INSIDE AN ORDER when object storage is down,
 * as a data: URL. The server keeps one only up to this many characters
 * (sanitizeFileSpecs) and drops anything longer without a word. The product page
 * used to allow 0.6 MB, about 839,000 characters, so a file between 513 KB and
 * 600 KB was accepted on the page and then silently lost: the line was filed as
 * still waiting for artwork. Both sides now read this one number.
 */
export const MAX_EMBEDDED_DATA_URL_CHARS = 700_000;

/** File bytes that still fit as a data: URL (base64 is 4 characters per 3 bytes, plus the header). */
export const MAX_EMBEDDED_FILE_BYTES = Math.floor(((MAX_EMBEDDED_DATA_URL_CHARS - 200) * 3) / 4);
