/**
 * SEARCHING AND ORDERING A SUPPLIER'S CATALOGUE — round 16, item 9.
 *
 * The client's words: "صفحه supplier — ترتيب عرض المنتجات — البحث لايعمل" (the
 * supplier page: the order products are shown in; the search does not work).
 * Measured on the real EasyGifts copy (1 330 rows): the search was ONE lower-cased
 * substring, so "a5 anteckningsbok" found 1 of 24, "atervunnen" (no å) 0 of 43,
 * "notebooks" 0 of 41, "office" (a category) 0, "lhzm04" 0 of "LH-ZM04"; and the
 * list was sorted by an English-collated name with no choice at all — å, ä, ö
 * filed under a and o, "T" seventeen presses of "Show more" away.
 *
 * Now: every word must match, in any order, across the name, the Swedish name,
 * the product number and the categories; accents and "&amp;" are folded away;
 * plurals are tried as their singular — narrowly, because a loose rule made
 * "notes" find Nottingham and "cases" Picasso; a code is matched with its spaces
 * and hyphens ignored, but only within one field. Rows matching by name or number
 * come before rows matching only by category. The owner picks the order.
 *
 * Pure (no Firestore, no DOM): the server's catalogue endpoint and the screen use
 * it. scripts/test-supplier-search.mjs.
 */

export interface SearchableRow {
  productKey?: string | null;
  name?: string | null;
  nameSv?: string | null;
  categoryPath?: string[] | null;
  sourcePrice?: number | null;
  stock?: number | null;
}

export type SupplierSort = 'category' | 'name' | 'price-asc' | 'price-desc' | 'stock';
export const SUPPLIER_SORTS: readonly SupplierSort[] = ['category', 'name', 'price-asc', 'price-desc', 'stock'];

export function cleanSort(raw: unknown): SupplierSort {
  return (SUPPLIER_SORTS as readonly string[]).includes(String(raw)) ? (raw as SupplierSort) : 'category';
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

/** "Eating &amp; drinking" → "Eating & drinking" (the feed's names are never decoded). */
export function decodeEntities(text: unknown): string {
  return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Lower case, no accents, only letters and digits separated by single spaces. */
export function foldText(text: unknown): string {
  return decodeEntities(text)
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Folded {
  name: string;
  nameSv: string;
  key: string;
  category: string;
}

// Rows are kept in memory between requests: fold each one once.
const foldedRows = new WeakMap<object, Folded>();
function folded(row: SearchableRow): Folded {
  const hit = foldedRows.get(row as object);
  if (hit) return hit;
  const f: Folded = {
    name: foldText(row.name),
    nameSv: foldText(row.nameSv),
    key: foldText(row.productKey),
    category: (Array.isArray(row.categoryPath) ? row.categoryPath : []).map(foldText).join(' '),
  };
  foldedRows.set(row as object, f);
  return f;
}

const hasDigit = (w: string) => /\d/.test(w);
const compact = (s: string) => s.replace(/ /g, '');
/**
 * A WHOLE word: an English singular must not match the middle of "Picasso" (cases
 * → cas…), nor the start of a longer word ("notes" → note… → notebook).
 */
const wholeWord = (hay: string, w: string) => ` ${hay} `.includes(` ${w} `);

/** English singulars: -s (not -ss); -es only after s, x, z, ch, sh. Matched as WHOLE words, so a short stem is safe ("boxes" → box). */
function englishStems(w: string): string[] {
  const out: string[] = [];
  if (w.length >= 5 && w.endsWith('es') && /(s|x|z|ch|sh)$/.test(w.slice(0, -2))) out.push(w.slice(0, -2));
  if (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss')) out.push(w.slice(0, -1));
  return out;
}

/**
 * Swedish, Danish and Norwegian plurals — tried against the Swedish name only, a
 * stem of four letters or more, INSIDE words (compounds: "pennor" finds
 * "Kulspetspenna"). Not "-er": that is also the end of English words, and
 * "sticker" found Bestick, "burger" SALZBURG, "opener" COPENHAGEN. An "-er"
 * plural ("paraplyer") is tried only at the START of a word, with five letters.
 */
function nordicStems(w: string): { stem: string; inside: boolean }[] {
  for (const ending of ['arna', 'orna', 'erna', 'ar', 'or', 'na']) {
    if (w.endsWith(ending) && w.length - ending.length >= 4) return [{ stem: w.slice(0, -ending.length), inside: true }];
  }
  if (w.endsWith('er') && w.length - 2 >= 5) return [{ stem: w.slice(0, -2), inside: false }];
  return [];
}

/**
 * Where a word was found: 'name' — literally in the name, Swedish name or number
 * (or as an English whole-word singular, or a code without its hyphens); 'stem' —
 * only as a Nordic plural's stem; 'category' — only in a category; or not at all.
 */
function wordHit(w: string, f: Folded): 'name' | 'stem' | 'category' | null {
  const own = [f.name, f.nameSv, f.key];
  if (own.some((field) => field.includes(w))) return 'name';
  // A code: spaces and hyphens ignored — "lhzm04" is "LH-ZM04", "500ml" is "500 ml" —
  // but only inside ONE field, never across the gap between two.
  if (hasDigit(w) && own.some((field) => compact(field).includes(compact(w)))) return 'name';
  if (englishStems(w).some((stem) => own.some((field) => wholeWord(field, stem)))) return 'name';
  if (nordicStems(w).some(({ stem, inside }) => (inside ? f.nameSv.includes(stem) : ` ${f.nameSv}`.includes(` ${stem}`)))) return 'stem';
  if (f.category.includes(w) || englishStems(w).some((stem) => wholeWord(f.category, stem))) return 'category';
  return null;
}

/**
 * Does the row match every word of the query? The lower, the earlier it is shown:
 * 0 = every word literally in the name or number, 1 = some word only as a Nordic
 * plural's stem, 2 = some word only in a category; null = no.
 */
export function matchQuery(row: SearchableRow, query: string): 0 | 1 | 2 | null {
  const words = foldText(query).split(' ').filter(Boolean);
  if (words.length === 0) return 0;
  const f = folded(row);
  let rank: 0 | 1 | 2 = 0;
  for (const w of words) {
    const hit = wordHit(w, f);
    if (!hit) return null;
    if (hit === 'category') rank = 2;
    else if (hit === 'stem' && rank < 1) rank = 1;
  }
  return rank;
}

let collator: Intl.Collator | null = null;
function sv(): Intl.Collator {
  if (!collator) {
    try {
      collator = new Intl.Collator('sv', { sensitivity: 'base', numeric: true });
    } catch {
      collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    }
  }
  return collator;
}

/** The name the screen shows: Swedish first, decoded. */
export function displayName(row: SearchableRow): string {
  return decodeEntities(row.nameSv || row.name || '').trim();
}

const categoryKey = (row: SearchableRow) =>
  (Array.isArray(row.categoryPath) ? row.categoryPath : []).map(decodeEntities).join(' / ');
const price = (row: SearchableRow) => (typeof row.sourcePrice === 'number' && row.sourcePrice > 0 ? row.sourcePrice : null);
const stockOf = (row: SearchableRow) => (typeof row.stock === 'number' && Number.isFinite(row.stock) ? row.stock : null);

/** The owner's order, in Swedish collation (å, ä, ö after z). Ties fall back to the name, then the number. */
export function compareRows(a: SearchableRow, b: SearchableRow, sort: SupplierSort): number {
  const c = sv();
  const byName = () => c.compare(displayName(a), displayName(b)) || c.compare(String(a.productKey ?? ''), String(b.productKey ?? ''));
  const missingLast = (x: number | null, y: number | null, cmp: (p: number, q: number) => number) =>
    x === null && y === null ? 0 : x === null ? 1 : y === null ? -1 : cmp(x, y);
  switch (sort) {
    case 'name':
      return byName();
    case 'price-asc':
      return missingLast(price(a), price(b), (p, q) => p - q) || byName();
    case 'price-desc':
      return missingLast(price(a), price(b), (p, q) => q - p) || byName();
    case 'stock':
      return missingLast(stockOf(a), stockOf(b), (p, q) => q - p) || byName();
    default: {
      // Rows with no category go last, not first.
      const ka = categoryKey(a);
      const kb = categoryKey(b);
      if (!ka !== !kb) return ka ? -1 : 1;
      return c.compare(ka, kb) || byName();
    }
  }
}

/**
 * Filter by the query and put in order: the product whose NUMBER is the query
 * first, then literal name/number matches, then plural-stem matches, then
 * category-only matches — each in the owner's chosen order.
 */
export function searchAndSort<T extends SearchableRow>(rows: T[], query: string, sort: SupplierSort): T[] {
  const exact = compact(foldText(query));
  const scored: Array<{ row: T; rank: number }> = [];
  for (const row of rows) {
    const rank = matchQuery(row, query);
    if (rank === null) continue;
    const isNumber = exact !== '' && compact(folded(row).key) === exact;
    scored.push({ row, rank: isNumber ? -1 : rank });
  }
  scored.sort((x, y) => x.rank - y.rank || compareRows(x.row, y.row, sort));
  return scored.map((s) => s.row);
}

/** The category chips: each path part with its count; the RAW name stays the filter value, the decoded one is shown. */
export function categoryChips(rows: SearchableRow[]): Array<{ name: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const part of Array.isArray(r.categoryPath) ? r.categoryPath : []) {
      const key = String(part);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, label: decodeEntities(name), count }))
    .sort((a, b) => sv().compare(a.label, b.label));
}
