// The shape every supplier adapter produces, whatever its feed looks like.
//
// Deliberately written BEFORE the second adapter rather than extracted after it.
// Three feeds are already known in detail and they disagree about almost
// everything — Pro Media Plus is XML over HTTP Basic in EUR with hotlinked
// images, EasyGifts is static JSON files in five languages, midocean is REST
// with an API key and answers in SEK — so a shape designed around whichever one
// was written first would have to be rebuilt for the next.
//
// The one thing they agree on, and the one this shape is built around: THE ROWS
// ARE NOT PRODUCTS. EasyGifts' 2 792 rows are 1 331 products in colours;
// midocean's 15 273 are 2 519. Importing rows directly shows the same umbrella
// sixteen times, and the shop's catalogue page and search both become useless.
// So a `SupplierProduct` is the product, and the colours hang off it.

/** One sellable colour of a product. Stock and price are per colour in every feed seen so far. */
export interface SupplierVariant {
  /** The supplier's own sellable code — EasyGifts `code_full`, midocean's SKU. */
  sku: string;
  colorName: string;
  /** The colour's name in the shop's other languages, when the feed carries them. */
  colorI18n?: Record<string, string>;
  colorCode?: string | null;
  /** Trade price in the feed's currency, for THIS colour. */
  sourcePrice: number | null;
  /** Units the supplier holds. Null when the feed does not say, which is not zero. */
  stock: number | null;
  images: string[];
}

/** A print method the supplier will apply, with the area it can cover. */
export interface SupplierMarking {
  code: string;
  name: string;
  /** As printed by the supplier, e.g. "5 x 0,6 cm". Not parsed: the formats vary. */
  size?: string | null;
  maxColors?: number | null;
}

export interface SupplierProduct {
  /** Which adapter produced this. */
  supplier: string;
  /** The supplier's PRODUCT key — the thing colours share. EasyGifts `code_short`. */
  productKey: string;
  /** Canonical name, always the English one where the feed has languages. */
  name: string;
  /** sv / da / no, filled from the feed when it ships them. */
  nameI18n: Record<string, string>;
  description: string;
  descriptionI18n: Record<string, string>;
  /** Root first: ['Pennor och skrivartiklar', 'Metallpennor']. */
  categoryPath: string[];
  /** Every category the supplier files it under, for mapping. */
  categoryPaths: string[][];
  images: string[];
  variants: SupplierVariant[];
  /**
   * The LOWEST trade price across the colours, which is what a catalogue lists
   * against a product that has several. Null when the feed priced none of them.
   */
  sourcePrice: number | null;
  sourceCurrency: string;
  markings: SupplierMarking[];
  /** Whatever the feed says that does not fit above — size, weight, EAN, packing. */
  attributes: Record<string, string>;
  ean?: string | null;
  brand?: string | null;
  supplierUrl?: string | null;

  // ── What some feeds carry and others do not ────────────────────────────────
  //
  // All optional, all added when Pro Media Plus was moved onto this shape (3.7).
  // Its importer wrote a RICHER product than EasyGifts' does — stock, bullet
  // points, a spec table, a manufacturer's part number — and moving it onto a
  // shared shape had to carry those across rather than quietly drop them. A
  // product that lost its spec table in a refactor is a worse outcome than two
  // importers.

  /**
   * Units the supplier holds of the PRODUCT.
   *
   * Distinct from the per-colour stock on a variant: a feed with no colour rows
   * has one number, and a feed with colours has one per colour and none here.
   * Null or absent is "the feed does not say", which is NOT zero — zero would
   * take the product out of the shop.
   */
  stock?: number | null;
  /** Bullet points, where the feed's description contains a list. */
  features?: string[];
  /** A specification table, label and value as the supplier printed them. */
  specs?: { label: string; value: string }[];
  /** The manufacturer's part number, for Google Shopping. */
  mpn?: string | null;
  /** The supplier's own article code, where it differs from `productKey`. */
  sku?: string | null;
}

/**
 * What the picker lists — a few hundred bytes instead of the whole product.
 *
 * The plan's 3.1: "a SLIM index, not a request-time cache". EasyGifts' Swedish
 * offer file alone is 13 MB; no request that also serves the storefront may parse
 * one, and no screen may download one.
 */
export interface SupplierIndexEntry {
  supplier: string;
  productKey: string;
  name: string;
  /** Swedish where the feed has it, because that is what the owner reads. */
  nameSv?: string | null;
  categoryPath: string[];
  sourcePrice: number | null;
  sourceCurrency: string;
  image: string | null;
  variantCount: number;
  /** Summed across colours, or null when the feed said nothing about stock. */
  stock: number | null;
}

export function toIndexEntry(p: SupplierProduct): SupplierIndexEntry {
  const stocks = p.variants.map((v) => v.stock).filter((s): s is number => typeof s === 'number');
  return {
    supplier: p.supplier,
    productKey: p.productKey,
    name: p.name,
    nameSv: p.nameI18n?.sv ?? null,
    categoryPath: p.categoryPath,
    sourcePrice: p.sourcePrice,
    sourceCurrency: p.sourceCurrency,
    // ONE image. The picker shows a thumbnail; sending nineteen per product is
    // how a 1 331-product list becomes unusable on a phone.
    image: p.images[0] ?? null,
    variantCount: p.variants.length,
    // Null, not 0, when nothing is known: "out of stock" and "not stated" are
    // different answers and the picker must not merge them.
    //
    // A feed with no colour rows — Pro Media Plus — carries one number on the
    // product instead, and falling through to null there would show every one of
    // its 635 products as "stock not stated".
    stock: stocks.length
      ? stocks.reduce((a, b) => a + b, 0)
      : (typeof p.stock === 'number' ? p.stock : null),
  };
}
