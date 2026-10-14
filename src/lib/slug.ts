/**
 * Product web addresses.
 *
 * A product used to live at `/products/prod-1787944572548` — a timestamp. It
 * tells a shopper nothing, reads as junk when the link is pasted into a
 * WhatsApp message, and gives a search engine no words to index. The address is
 * now the product's NAME: `/products/premium-card`.
 *
 * The document id does not change. It is still the key every order line, every
 * cart entry and every old link carries, so the rename costs no data migration
 * and no dead URLs: the product page resolves a name first and an id second.
 */

/** Characters that do not decompose to ASCII on their own. */
const FOLD: Array<[RegExp, string]> = [
  [/ø/g, 'o'],
  [/æ/g, 'ae'],
  [/ß/g, 'ss'],
  [/đ/g, 'd'],
  [/ł/g, 'l'],
];

/**
 * "Premium Card 350gsm" → "premium-card-350gsm".
 *
 * Swedish, Danish and Norwegian names are the normal case here, so å/ä/ö/é are
 * folded to their ASCII base rather than dropped — "Måttbeställda skyltar"
 * becomes "mattbestallda-skyltar", not "mttbestllda-skyltar".
 */
export function slugify(input: string): string {
  let text = (input || '').toLowerCase();
  for (const [pattern, replacement] of FOLD) text = text.replace(pattern, replacement);
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

type SluggableProduct = { id: string; slug?: string | null; name?: string };

/**
 * The name part of a product's address. Empty when the product has no slug and
 * its name yields nothing usable (a name written only in a non-Latin script, or
 * only in punctuation) — the caller then falls back to the id.
 */
export function productSlug(product: SluggableProduct): string {
  const stored = (product.slug || '').trim();
  return stored || slugify(product.name || '');
}

/** Where this product lives. Never returns an empty address. */
export function productPath(product: SluggableProduct): string {
  return `/products/${productSlug(product) || product.id}`;
}

/** The shape ids have had since the shop opened: `prod-<epoch millis>`. */
export function looksLikeProductId(param: string): boolean {
  return /^prod-\d+$/.test(param);
}

/**
 * Two products may legitimately be called the same thing (a duplicate starts
 * life as an exact copy), and one address can only point at one of them — so a
 * clash gets a counter: premium-card, premium-card-2, premium-card-3.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!base) return '';
  if (!used.has(base)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
