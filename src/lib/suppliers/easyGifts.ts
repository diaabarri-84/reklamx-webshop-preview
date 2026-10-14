// EasyGifts — supplier #3, and the one worth doing first.
//
// Static JSON files, no authentication on the data itself, and the whole
// catalogue ships in five languages INCLUDING Swedish and Danish. Round 13 built
// `nameI18n` and left the owner to type every translation by hand; this feed
// fills sv and da for 1 331 products for nothing, which is the single biggest
// win available in the plan.
//
//     https://easygifts.com.pl/data/webapi2/<lang>/json/<file>.json
//     lang = pl | en | se | fi | dk        file = offer | prices | stocks | categories
//
// Verified against the live files on 2026-09-12, not from documentation:
//   offer.json (se)   13.0 MB   2 792 rows
//   prices.json       { currency: "EUR", products: [{ code_full, price }] }
//   stocks.json       [{ code_full, stock, stocks: [...] }]  — 2 756 entries
//
// ────────────────────────────────────────────────────────────────────────────
// THE ROWS ARE COLOURS, NOT PRODUCTS. 2 792 rows are 1 331 products; one
// umbrella is sixteen of them. `baseinfo.code_short` is the product and
// `code_full` is the sellable colour, and prices and stocks are keyed on the
// colour. Import row-by-row and the shop lists the same umbrella sixteen times.
//
// Everything here is pure. It is handed parsed JSON and returns products; it
// fetches nothing, so scripts/test-easygifts.mjs can check every rule in it.

import type { SupplierProduct, SupplierVariant, SupplierMarking } from './types';

/** The shop's four languages, mapped to the feed's directory names. */
export const EASYGIFTS_LANGS: Record<string, string> = {
  en: 'en',   // canonical
  sv: 'se',
  da: 'dk',
  // Norwegian is NOT in this feed. Leaving it out is the honest answer; filling
  // it with Swedish would put the wrong language in front of a Norwegian
  // customer and look deliberate.
};

export interface EasyGiftsRow {
  baseinfo?: {
    id?: unknown; code_short?: unknown; code_full?: unknown;
    name?: unknown; ean?: unknown; intro?: unknown; detailed_content?: unknown;
  };
  url?: unknown;
  color?: { id?: unknown; name?: unknown; code?: unknown };
  brand?: { name?: unknown } | unknown;
  attributes?: Record<string, unknown>;
  images?: { file?: unknown }[];
  categories?: { id?: unknown; name?: unknown; subcategory?: { id?: unknown; name?: unknown } }[];
  markings?: { code?: unknown; name?: unknown; size?: unknown; colors_max?: unknown }[];
}

export interface EasyGiftsInput {
  /**
   * The canonical language's offer rows — English.
   *
   * IT IS NOT THE COMPLETE ONE. Measured 2026-09-12: the English file holds
   * 2 659 rows and the Swedish 2 792, and 133 products exist in Swedish and not
   * in English at all. Iterating this list alone would silently drop 104 real
   * products, so `translations` is treated as a source of rows too and the
   * canonical name falls back to whichever language has one.
   */
  offers: EasyGiftsRow[];
  /** `{ currency, products: [{ code_full, price }] }`. */
  prices?: { currency?: unknown; products?: { code_full?: unknown; price?: unknown }[] } | null;
  /** `[{ code_full, stock }]`. */
  stocks?: { code_full?: unknown; stock?: unknown }[] | null;
  /**
   * The other languages, keyed by the SHOP's code: `{ sv: rows, da: rows }`.
   * Joined on `code_full`, which is the same id in every language file.
   */
  translations?: Record<string, EasyGiftsRow[]>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/**
 * A price as the feed writes it: a string, sometimes a number, sometimes a comma.
 *
 * ZERO MEANS "NOT PRICED" IN THIS FEED, and that is a measurement rather than an
 * assumption: 75 of the 2 792 rows carry `"price": 0` on 2026-09-12, and they are
 * real products — an eyeliner tool, a Bluetooth speaker — that also carry NO
 * CATEGORY. They are stock the supplier has not priced, not stock he gives away.
 *
 * Treating it as a real price would put them in the shop at the minimum-price
 * floor, make every margin figure on them read as total profit, and let a bulk
 * "re-price at 150%" produce 0. So it becomes null, the same as a missing price,
 * and the picker can show that they cannot be imported yet.
 */
function price(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** The supplier's HTML intro, as text. The shop stores plain descriptions. */
export function stripHtml(html: unknown): string {
  return str(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** ['Pennor och skrivartiklar', 'Metallpennor'] — root first, sub second. */
function pathsOf(row: EasyGiftsRow): string[][] {
  const out: string[][] = [];
  for (const c of row.categories ?? []) {
    const root = str(c?.name);
    if (!root) continue;
    const sub = str(c?.subcategory?.name);
    out.push(sub ? [root, sub] : [root]);
  }
  return out;
}

export function parseEasyGifts(input: EasyGiftsInput): SupplierProduct[] {
  const currency = str(input.prices?.currency) || 'EUR';

  const priceBySku = new Map<string, number>();
  for (const p of input.prices?.products ?? []) {
    const sku = str(p?.code_full);
    const value = price(p?.price);
    if (sku && value !== null) priceBySku.set(sku, value);
  }

  const stockBySku = new Map<string, number>();
  for (const s of input.stocks ?? []) {
    const sku = str(s?.code_full);
    const n = Number(s?.stock);
    if (sku && Number.isFinite(n)) stockBySku.set(sku, Math.max(0, Math.floor(n)));
  }

  // Translations, indexed by the colour code — the one id that is identical
  // across the language files.
  const translated: Record<string, Map<string, EasyGiftsRow>> = {};
  for (const [lang, rows] of Object.entries(input.translations ?? {})) {
    const map = new Map<string, EasyGiftsRow>();
    for (const r of rows ?? []) {
      const sku = str(r?.baseinfo?.code_full);
      if (sku) map.set(sku, r);
    }
    translated[lang] = map;
  }

  // THE UNION OF EVERY LANGUAGE, not just the canonical one.
  //
  // The English file is missing 133 rows the Swedish file has. Walking `offers`
  // alone drops them, and they are ordinary products — dropping a supplier's
  // stock because one translation is late is not a decision anyone made.
  //
  // The English row is used when there is one, because the shop's canonical
  // `name` is English; otherwise the row from whichever language HAS it carries
  // the product, and its own name becomes the canonical one. A Swedish name in
  // the canonical field is not ideal; an absent product is worse.
  const rowsBySku = new Map<string, EasyGiftsRow>();
  for (const rows of Object.values(input.translations ?? {})) {
    for (const r of rows ?? []) {
      const sku = str(r?.baseinfo?.code_full);
      if (sku && !rowsBySku.has(sku)) rowsBySku.set(sku, r);
    }
  }
  // Second, so English overwrites any stand-in.
  for (const r of input.offers ?? []) {
    const sku = str(r?.baseinfo?.code_full);
    if (sku) rowsBySku.set(sku, r);
  }
  const allRows = rowsBySku.size ? [...rowsBySku.values()] : (input.offers ?? []);

  const byProduct = new Map<string, SupplierProduct>();

  for (const row of allRows) {
    const productKey = str(row?.baseinfo?.code_short);
    const sku = str(row?.baseinfo?.code_full);
    // A row with no product key cannot be grouped and a row with no sku cannot
    // be priced or ordered. Skipped rather than guessed: an invented key would
    // merge unrelated products under one listing.
    if (!productKey || !sku) continue;

    const images = (row.images ?? [])
      .map((i) => str(i?.file))
      .filter((u) => /^https?:\/\//i.test(u));

    const variant: SupplierVariant = {
      sku,
      colorName: str(row?.color?.name),
      colorCode: str(row?.color?.code) || null,
      sourcePrice: priceBySku.get(sku) ?? null,
      // undefined, not 0. stocks.json covers 2 756 of 2 792 rows, and a product
      // the feed says nothing about is not a product with none.
      stock: stockBySku.has(sku) ? stockBySku.get(sku)! : null,
      images,
    };

    const colorI18n: Record<string, string> = {};
    for (const [lang, map] of Object.entries(translated)) {
      const name = str(map.get(sku)?.color?.name);
      if (name) colorI18n[lang] = name;
    }
    if (Object.keys(colorI18n).length) variant.colorI18n = colorI18n;

    const existing = byProduct.get(productKey);
    if (existing) {
      existing.variants.push(variant);
      // The lowest colour price is what a listing shows for a product sold in
      // several — quoting the dearest would make the whole catalogue look
      // expensive against competitors listing the same item.
      if (variant.sourcePrice !== null) {
        existing.sourcePrice = existing.sourcePrice === null
          ? variant.sourcePrice
          : Math.min(existing.sourcePrice, variant.sourcePrice);
      }
      // Images from every colour, deduplicated: the first row's pictures are of
      // one colour only, and the product page should show what is on offer.
      for (const img of images) if (!existing.images.includes(img)) existing.images.push(img);
      continue;
    }

    const nameI18n: Record<string, string> = {};
    const descriptionI18n: Record<string, string> = {};
    for (const [lang, map] of Object.entries(translated)) {
      const tr = map.get(sku);
      const name = str(tr?.baseinfo?.name);
      if (name) nameI18n[lang] = name;
      const intro = stripHtml(tr?.baseinfo?.intro);
      if (intro) descriptionI18n[lang] = intro;
    }

    const markings: SupplierMarking[] = (row.markings ?? []).map((m) => ({
      code: str(m?.code),
      name: str(m?.name),
      size: str(m?.size) || null,
      maxColors: Number.isFinite(Number(m?.colors_max)) ? Number(m.colors_max) : null,
    })).filter((m) => m.code || m.name);

    const attributes: Record<string, string> = {};
    for (const [k, v] of Object.entries(row.attributes ?? {})) {
      const value = str(v);
      if (value) attributes[k] = value;
    }

    const paths = pathsOf(row);
    byProduct.set(productKey, {
      supplier: 'easygifts',
      productKey,
      name: str(row?.baseinfo?.name),
      nameI18n,
      description: stripHtml(row?.baseinfo?.intro),
      descriptionI18n,
      // The FIRST path is the one the product is filed under; the rest are kept
      // for mapping, because this feed files a pen under three at once.
      categoryPath: paths[0] ?? [],
      categoryPaths: paths,
      images: [...images],
      variants: [variant],
      sourcePrice: variant.sourcePrice,
      sourceCurrency: currency,
      markings,
      attributes,
      ean: str(row?.baseinfo?.ean) || null,
      brand: str((row as any)?.brand?.name) || null,
      supplierUrl: str(row?.url) || null,
    });
  }

  // Colours in a stable order, so two imports of the same feed produce the same
  // option list and a re-sync does not look like a change.
  for (const p of byProduct.values()) {
    p.variants.sort((a, b) => a.sku.localeCompare(b.sku));
  }
  return [...byProduct.values()];
}
