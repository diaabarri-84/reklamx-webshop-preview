// midocean, on the shared supplier shape — plan task 3.8.
//
// WHAT IS ALREADY KNOWN, from a read-only probe of the live API on 2026-09-10
// with the owner's own key (memory: reklamx-midocean-api):
//
//   base      https://api.midocean.com        (apitest rejects this key with 401)
//   auth      header  x-Gateway-APIKey: <key>
//   products  GET /gateway/products/2.0?language=en   → 303 to a signed S3 URL
//   prices    GET /gateway/pricelist/2.0
//
//   2 519 master products · 15 273 sellable variants · 26 MB of JSON
//   PRICES COME BACK IN SEK ALREADY — no conversion, unlike Pro Media Plus
//   the category tree is on the VARIANT: category_level1 / 2 / 3
//   55 926 images on cdn1.midocean.com, as URLs
//
// TWO THINGS THIS FILE IS BUILT AROUND.
//
// 1. THE ROWS ARE NOT PRODUCTS. 15 273 variants are 2 519 products in colours.
//    Importing rows directly puts the same bag in the catalogue sixteen times.
//    So a master becomes one SupplierProduct and its SKUs become colours, which
//    is exactly what the shared shape was designed for.
//
// 2. THE PRICES ARE ALREADY IN SEK. Every other feed in this shop is EUR, and
//    the importer multiplies by an exchange rate. Applying an 11.5 rate to a
//    price that is already in kronor sells an 89 kr notebook for 1 024 — the
//    same shape of mistake as the 3 020 → 1 490 incident, in the other
//    direction. `sourceCurrency` says SEK, and the server refuses any rate but
//    1 for a feed that is already in the shop's currency.
//
// WHY THE FIELD LOOKUPS ARE TOLERANT. This was written against a probe of the
// feed and the vendor's public documentation, not against a schema anyone
// guarantees. Where a concept has more than one plausible name, the names are
// tried in order and the first non-empty one wins — so a feed that calls the
// picture list `digital_assets` and one that calls it `assets` both work, and
// neither silently produces a product with no images. `scripts/probe-midocean.mjs`
// prints what the live feed actually contains, and the moment that has been run
// against the real key this list can be narrowed to what it found.
//
// Pure, and tested in scripts/test-midocean.mjs.

import type { SupplierProduct, SupplierVariant, SupplierMarking } from './types';

export const MIDOCEAN = 'midocean';

/** The feed's own currency. Kept here so the server can refuse a rate against it. */
export const MIDOCEAN_CURRENCY = 'SEK';

/** The first of these keys that carries something. */
function pick(source: any, ...names: string[]): any {
  if (!source || typeof source !== 'object') return undefined;
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/**
 * A price out of the feed.
 *
 * midocean sends prices as STRINGS — "12.34" — and a comma decimal has been seen
 * in European feeds. `Number('12,34')` is NaN, which would drop the product
 * silently, so the comma is handled rather than trusted not to appear.
 */
export function toPrice(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const raw = text(value).replace(/\s/g, '').replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * SKU → price, from the pricelist endpoint.
 *
 * Rows in a currency that is not the feed's are DROPPED rather than taken: a
 * price list that answered in EUR for some rows and SEK for others would
 * otherwise price a tenth of the catalogue at a ninth of its cost.
 */
export function priceIndex(pricelist: any, currency = MIDOCEAN_CURRENCY): Map<string, number> {
  const rows: any[] = Array.isArray(pricelist)
    ? pricelist
    : (pick(pricelist, 'price', 'prices', 'pricelist', 'items') as any[]) ?? [];
  const out = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const sku = text(pick(row, 'sku', 'variant_sku', 'variant_id'));
    if (!sku) continue;
    const rowCurrency = text(pick(row, 'currency', 'currency_code')).toUpperCase();
    if (rowCurrency && rowCurrency !== currency.toUpperCase()) continue;
    const price = toPrice(pick(row, 'price', 'net_price', 'unit_price', 'value'));
    if (price === null) continue;
    // The LOWEST quoted price for a SKU when the list repeats it: the scale
    // prices are quantity breaks, and a catalogue lists the price a single unit
    // starts at. Taking the last row would show a 500-unit price against one.
    const existing = out.get(sku);
    out.set(sku, existing === undefined ? price : Math.min(existing, price));
  }
  return out;
}

/** Image URLs from a digital-assets list, biggest usable first, deduplicated. */
export function assetUrls(assets: any): string[] {
  const list: any[] = Array.isArray(assets) ? assets : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const asset of list) {
    const type = text(pick(asset, 'type', 'asset_type')).toLowerCase();
    // Anything that is not an image — a PDF data sheet, a video — must not end
    // up as a product photograph.
    if (type && type !== 'image') continue;
    const url = text(pick(asset, 'url', 'url_highress', 'url_highres', 'link', 'href'));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** The print positions the supplier will decorate, as markings. */
export function toMarkings(master: any): SupplierMarking[] {
  const positions: any[] = (pick(master, 'printing_positions', 'print_positions', 'printingPositions') as any[]) ?? [];
  if (!Array.isArray(positions)) return [];
  return positions.map((p, i) => {
    const width = text(pick(p, 'max_print_size_width', 'print_size_width', 'width'));
    const height = text(pick(p, 'max_print_size_height', 'print_size_height', 'height'));
    const techniques: any[] = (pick(p, 'printing_techniques', 'techniques') as any[]) ?? [];
    return {
      code: text(pick(p, 'position_id', 'code', 'id')) || `pos-${i + 1}`,
      name: text(pick(p, 'print_position_type', 'name', 'position')) || `Position ${i + 1}`,
      // As printed by the supplier. Deliberately not parsed: the units and the
      // formats vary between positions, and a half-parsed size is worse than the
      // supplier's own string.
      size: width && height ? `${width} x ${height}` : null,
      maxColors: Number(pick(p, 'max_colours', 'max_colors')) || null,
    };
  });
}

export interface MidoceanInput {
  /** The products file, as the 303 redirect delivers it. */
  products: any;
  /** The pricelist file. Absent means nothing is priced, and nothing imports. */
  prices?: any;
}

/**
 * The whole feed → the shop's shape.
 *
 * A master with no sellable SKU still comes through, with `sourcePrice: null`:
 * `supplierProductToShop` refuses it, and the picker can show the owner that the
 * supplier carries it but has not priced it. Dropping it here would make those
 * products invisible rather than visibly unpriced.
 */
export function parseMidocean(input: MidoceanInput): SupplierProduct[] {
  const masters: any[] = Array.isArray(input?.products)
    ? input.products
    : (pick(input?.products, 'products', 'product', 'items') as any[]) ?? [];
  const prices = priceIndex(input?.prices);

  const out: SupplierProduct[] = [];
  for (const master of Array.isArray(masters) ? masters : []) {
    const productKey = text(pick(master, 'master_code', 'master_id', 'code'));
    if (!productKey) continue;   // nothing to key an import on

    const rawVariants: any[] = (pick(master, 'variants', 'variant', 'skus') as any[]) ?? [];
    const variants: SupplierVariant[] = [];
    const categoryPaths: string[][] = [];
    const seenPaths = new Set<string>();
    const masterImages = assetUrls(pick(master, 'digital_assets', 'assets', 'images'));

    for (const v of Array.isArray(rawVariants) ? rawVariants : []) {
      const sku = text(pick(v, 'sku', 'variant_id', 'code'));
      if (!sku) continue;

      // THE CATEGORY TREE IS ON THE VARIANT, not the master. Every level that is
      // present, in order, with the empties dropped — a product filed under
      // level 1 only must not produce ['Bags', '', ''].
      const path = [
        text(pick(v, 'category_level1', 'categoryLevel1')),
        text(pick(v, 'category_level2', 'categoryLevel2')),
        text(pick(v, 'category_level3', 'categoryLevel3')),
      ].filter(Boolean);
      if (path.length) {
        const key = path.join(' › ');
        if (!seenPaths.has(key)) { seenPaths.add(key); categoryPaths.push(path); }
      }

      variants.push({
        sku,
        colorName: text(pick(v, 'color_description', 'colour_description', 'color_group', 'color')) || sku,
        colorCode: text(pick(v, 'color_code', 'pms_color', 'colour_code')) || null,
        sourcePrice: prices.get(sku) ?? null,
        // The feed's stock lives behind a separate endpoint, so nothing is
        // claimed here. Null is "not stated", which is not zero — zero would take
        // every product out of the shop.
        stock: null,
        images: assetUrls(pick(v, 'digital_assets', 'assets', 'images')),
      });
    }

    const sellable = variants.filter((v) => typeof v.sourcePrice === 'number' && v.sourcePrice > 0);
    const attributes: Record<string, string> = {};
    for (const [label, keys] of [
      ['Material', ['material']],
      ['Dimensions', ['dimensions']],
      ['Net weight', ['net_weight']],
      ['Gross weight', ['gross_weight']],
      ['Country of origin', ['country_of_origin']],
      ['Commodity code', ['commodity_code']],
      ['Product class', ['product_class']],
    ] as [string, string[]][]) {
      const value = text(pick(master, ...keys));
      if (value) attributes[label] = value;
    }

    out.push({
      supplier: MIDOCEAN,
      productKey,
      name: text(pick(master, 'product_name', 'name', 'short_description')) || productKey,
      // The products endpoint is asked for ONE language at a time. Filling these
      // means a second and third download of a 26 MB file, which is a decision
      // about bandwidth rather than about code — so they are left empty and the
      // shop falls back to the English, rather than being given copies of it
      // that would look translated and never be corrected.
      nameI18n: {},
      description: text(pick(master, 'long_description', 'short_description', 'description')),
      descriptionI18n: {},
      // The first path any of its colours is filed under, for the shop category.
      categoryPath: categoryPaths[0] ?? [],
      categoryPaths,
      // The master's own pictures first — they are the studio shots — then the
      // colours', so a product with no master image still has one.
      images: masterImages.length ? masterImages : (variants[0]?.images ?? []),
      variants,
      // The CHEAPEST sellable colour, which is what a catalogue lists against a
      // product that has several. Null when the feed priced none of them.
      sourcePrice: sellable.length ? Math.min(...sellable.map((v) => v.sourcePrice as number)) : null,
      sourceCurrency: MIDOCEAN_CURRENCY,
      markings: toMarkings(master),
      attributes,
      // The barcode belongs to a colour, not to the master; the first one is the
      // only honest answer at product level, and Google rejects a malformed one.
      ean: text(pick(rawVariants?.[0], 'gtin', 'ean')).replace(/[\s-]/g, '') || null,
      brand: text(pick(master, 'brand')) || null,
      supplierUrl: null,
      stock: null,
      sku: productKey,
    });
  }
  return out;
}
