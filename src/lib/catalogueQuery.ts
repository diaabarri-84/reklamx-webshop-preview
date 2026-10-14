// How the shop decides whether a product matches a filter.
//
// This lives on its own, away from server.ts, for two reasons. The rules are
// worth a unit test — scripts/test-catalogue-query.mjs — and a rule that cannot
// be tested is a rule nobody checks. And the browser keeps a Firestore fallback
// for when /api/catalogue is unreachable, so the same matching has to exist on
// both sides; two copies of it would drift, and a search that finds a product on
// the server but not in the fallback is worse than either behaviour alone.

/** Only the fields these functions read, so a test fixture need not be a Product. */
export interface CatalogueMatchable {
  categoryId?: unknown;
  name?: unknown;
  description?: unknown;
  nameI18n?: unknown;
  descriptionI18n?: unknown;
}

/**
 * Every category form a product might be filed under.
 *
 * Live data has products carrying the category's document id AND products
 * carrying its canonical NAME — the shop's own filter has always tested both,
 * and a count that tested only one was the bug where clicking a category listed
 * products while the number beside it said 0. The browser knows both forms, so
 * it sends both, comma-separated.
 *
 * A TRANSLATED name is never one of them. Category.nameI18n is for display; the
 * moment a Swedish label enters a comparison, the same category matches in one
 * language and not in another.
 */
export function parseCategoryFilter(raw: unknown): string[] | null {
  const list = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => String(v ?? '').split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return list.length ? list : null;
}

export function matchesCategory(p: CatalogueMatchable, categories: string[] | null): boolean {
  if (!categories) return true;
  const own = String(p.categoryId ?? '').trim();
  // A product with NO category is not in some category whose id happens to be
  // the empty string — it is in none, and it belongs only to the unfiltered
  // list. parseCategoryFilter never produces an empty entry, but this function
  // is exported and the browser's fallback calls it directly.
  if (!own) return false;
  return categories.includes(own);
}

/**
 * Everything about a product a shopper could reasonably type, in one lowercase
 * string.
 *
 * The shop used to filter on `name` and `description` alone. Those are the
 * CANONICAL English values, so a Swedish shopper who typed the Swedish name of
 * the product he was looking straight at got "no results" — the translated names
 * are exactly what round 13 added and exactly what the search ignored. The i18n
 * maps are already in the card projection, so reading them costs nothing.
 *
 * The fields are joined with U+0000 rather than a space. That character cannot
 * be typed into a search box, so a query can never match ACROSS the seam between
 * two fields — without it, a product whose name ends in "roll" and whose
 * description begins with "up" would be returned as a hit for "roll up".
 */
const FIELD_SEPARATOR = '\u0000';

export function catalogueHaystack(p: CatalogueMatchable): string {
  const parts: string[] = [String(p.name ?? ''), String(p.description ?? '')];
  for (const map of [p.nameI18n, p.descriptionI18n]) {
    if (map && typeof map === 'object') {
      for (const v of Object.values(map as Record<string, unknown>)) {
        // null is a deliberately CLEARED translation, not a missing one, and
        // String(null) would put the text "null" into the haystack — where
        // searching for "null" would return every product whose translation had
        // been cleared.
        if (typeof v === 'string') parts.push(v);
      }
    }
  }
  return parts.join(FIELD_SEPARATOR).toLowerCase();
}

/** Normalise what the shopper typed. Returns '' when there is no search at all. */
export function normaliseQuery(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function matchesQuery(p: CatalogueMatchable, needle: string): boolean {
  if (!needle) return true;
  return catalogueHaystack(p).includes(needle);
}

/** Both filters, in the order that discards the most work first. */
export function matchesCatalogueFilters(
  p: CatalogueMatchable,
  categories: string[] | null,
  needle: string,
): boolean {
  return matchesCategory(p, categories) && matchesQuery(p, needle);
}
