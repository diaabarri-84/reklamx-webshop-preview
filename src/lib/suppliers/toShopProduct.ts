// A supplier's product becomes one of the shop's — colours and all.
//
// This is where D1 lands. `Product` has no variant concept: one product, one
// basePrice, one stock number. The machinery for the right answer was already
// 80% built before this — printing-field options carry a `priceModifier` and an
// `imageUrl`, and the configurator already prices a chosen option — so a colour
// becomes an OPTION FIELD rather than a new data model.
//
// That choice has a consequence worth stating: the shop still stores one stock
// number and one price per product. Per-colour stock is kept on the cost record
// (nobody may see it) and the colour option carries the price DIFFERENCE from the
// cheapest colour. A product whose colours differ in price therefore prices
// correctly; a product whose colours differ in availability does not yet show
// that, and pretending otherwise in the option labels would be worse than the
// gap.

import type { SupplierProduct } from './types';

export interface ToShopOptions {
  /** EUR → SEK, or whatever the feed's currency is. */
  rate: number;
  /** The shop's markup, as a percentage: 150 means ×2.5. */
  marginPercent: number;
  /** The shop category this import files them under. May be empty. */
  categoryId?: string;
  /** Slugs already taken, so two imports cannot collide on an address. */
  takenSlugs?: Iterable<string>;
  /** At most this many pictures per product. Feeds ship up to nineteen. */
  maxImages?: number;
  /** Imported hidden by default, so nothing reaches the shop unreviewed. */
  hidden?: boolean;
  nowIso: string;
}

export interface ShopProductWrite {
  product: Record<string, any>;
  /** Written to productCosts/<id>, which no browser may read. */
  costs: Record<string, any>;
}

const round = (n: number) => Math.round(n);

/**
 * The selling price from a trade price. The same formula the Pro Media Plus
 * importer uses — imported from there rather than rewritten, so a change to the
 * shop's pricing cannot apply to one supplier and not another.
 */
export function sellPrice(sourcePrice: number, rate: number, marginPercent: number): number {
  return round(sourcePrice * rate * (1 + marginPercent / 100));
}

/**
 * A stable, readable document id.
 *
 * Deterministic on purpose: re-importing the same supplier product must UPDATE
 * it rather than create a second copy, which is what `prod-${Date.now()}` does
 * — and at batch speed that also collides with itself.
 */
/**
 * Prefixes that are NOT derived from the supplier's slug.
 *
 * Pro Media Plus imported 31 products before it was moved onto this model (3.7),
 * under ids of the form `prod-pmp-47`, and their cost records share those ids.
 * Deriving the prefix from the slug would produce `prod-promediapl-47` instead —
 * a second copy of every one of them, and the original left orphaned from the
 * re-sync that is supposed to maintain it. The old prefix is therefore the
 * supplier's prefix, permanently.
 */
const LEGACY_ID_PREFIX: Record<string, string> = {
  promediaplus: 'pmp',
};

export function shopProductId(supplier: string, productKey: string): string {
  const slug = String(supplier ?? '').toLowerCase();
  const s = LEGACY_ID_PREFIX[slug] ?? slug.replace(/[^a-z0-9]+/gi, '').slice(0, 12);
  const k = String(productKey).replace(/[^\w.-]+/g, '-').slice(0, 40);
  return `prod-${s}-${k}`;
}

export function supplierProductToShop(
  p: SupplierProduct,
  opts: ToShopOptions,
  slugify: (s: string) => string,
  uniqueSlug: (base: string, taken: Iterable<string>) => string,
): ShopProductWrite | null {
  // No usable trade price means no sellable product. 74 of EasyGifts' 1 330 are
  // in this state; importing them would put them in the shop at the minimum-price
  // floor with a margin that reads as total profit.
  if (typeof p.sourcePrice !== 'number' || !(p.sourcePrice > 0)) return null;
  if (!Number.isFinite(opts.rate) || opts.rate <= 0) return null;

  const id = shopProductId(p.supplier, p.productKey);
  const basePrice = sellPrice(p.sourcePrice, opts.rate, opts.marginPercent);

  // Colours that can actually be sold. A colour with no price cannot carry a
  // price DIFFERENCE, and guessing one would charge the customer a number nobody
  // set.
  const sellable = p.variants.filter((v) => typeof v.sourcePrice === 'number' && v.sourcePrice > 0);
  const cheapest = sellable.length ? Math.min(...sellable.map((v) => v.sourcePrice as number)) : p.sourcePrice;

  // One field, one option per colour. Only when there is a CHOICE: a single
  // colour is a fact about the product, and offering a field with one option is
  // a question with one answer.
  const colourField = sellable.length > 1 ? [{
    id: `field-colour-${id}`,
    label: 'Colour',
    labelI18n: { sv: 'Färg', da: 'Farve', no: 'Farge' },
    type: 'select',
    required: true,
    enabled: true,
    options: sellable.map((v, i) => ({
      id: `opt-${v.sku}`,
      label: v.colorName || v.sku,
      labelI18n: v.colorI18n ?? {},
      value: v.sku,
      // The DIFFERENCE from the cheapest colour, in the shop's currency. The
      // base price is the cheapest one, so a customer who picks it pays exactly
      // the advertised price and nobody is surprised at the till.
      priceModifier: sellPrice(v.sourcePrice as number, opts.rate, opts.marginPercent)
        - sellPrice(cheapest, opts.rate, opts.marginPercent),
      isDefault: i === 0,
      ...(v.images[0] ? { imageUrl: v.images[0] } : {}),
    })),
  }] : [];

  const name = p.name || p.productKey;
  const slug = uniqueSlug(slugify(name), opts.takenSlugs ?? []);

  const product: Record<string, any> = {
    id,
    name,
    // Round 13 built these and left them to be typed by hand. This feed fills
    // them, which is the whole reason EasyGifts was done first.
    nameI18n: Object.keys(p.nameI18n).length ? p.nameI18n : null,
    description: p.description,
    descriptionI18n: Object.keys(p.descriptionI18n).length ? p.descriptionI18n : null,
    slug,
    categoryId: opts.categoryId ?? '',
    basePrice,
    salePrice: null,
    images: p.images.slice(0, Math.max(1, opts.maxImages ?? 6)),
    // HIDDEN unless told otherwise. A thousand products appearing in the shop
    // because somebody pressed Import is not a decision anyone made.
    isHidden: opts.hidden !== false,
    isWeb2Print: false,
    minQuantity: 1,
    // A maxQuantity below the minimum is read as bad data by the quantity ladder
    // and silently becomes min×1000, so it is clamped rather than taken straight
    // from a stock figure that can be zero.
    maxQuantity: typeof p.stock === 'number' && p.stock > 0
      ? Math.max(10, Math.min(p.stock, 10000))
      : 10000,
    // The feed's number when it has one. `0` is only written when the feed
    // actually says zero — absent means "not stated", and writing 0 for that
    // would take the product out of the shop.
    stock: typeof p.stock === 'number' ? p.stock : 0,
    printingFields: colourField,
    options: [],
    // Carried across from the Pro Media Plus importer when it was folded into
    // this one, because these two lists are what its product page shows.
    ...(p.features?.length ? { features: p.features } : {}),
    ...(p.specs?.length ? { specs: p.specs } : {}),
    // areaPriced MUST be false, EXPLICITLY. Left to a default, every imported
    // product silently gains areaSqm × 350 kr on a 50×70 size nobody chose —
    // the phantom surcharge the owner reported in round 9 and could not switch
    // off. `enabled: false` alone is not the same statement.
    customUploadRules: { enabled: false, areaPriced: false, minPrice: 0 },
    // Undefined here falls back to PRICING_DEFAULTS: a 49 kr setup fee per line
    // and 10/20/30/40% volume discounts. Those are print-job rules and have no
    // business on resold hardware.
    pricingRules: { baseSetupFee: 0, volumeDiscounts: [] },
    brand: p.brand || null,
    gtin: p.ean || null,
    ...(p.mpn ? { mpn: p.mpn } : {}),
    sku: p.sku || p.productKey,
    condition: 'new',
    // 1.7 — who supplied it, readable, beside the closed cost record.
    supplierName: supplierDisplayName(p.supplier),
    supplierOfferId: p.productKey,
    importedAt: opts.nowIso,
    createdAt: opts.nowIso,
    updatedAt: opts.nowIso,
  };

  const costs: Record<string, any> = {
    supplier: p.supplier,
    supplierOfferId: p.productKey,
    supplierUrl: p.supplierUrl ?? null,
    sourcePrice: cheapest,
    sourceCurrency: p.sourceCurrency,
    sourceRate: opts.rate,
    marginPercent: opts.marginPercent,
    // Per colour, where the shop's own model has nowhere to put it. Closed, so
    // it can hold what the product document must not.
    variants: p.variants.map((v) => ({
      sku: v.sku,
      colorName: v.colorName,
      sourcePrice: v.sourcePrice,
      stock: v.stock,
    })),
  };

  return { product, costs };
}

const DISPLAY_NAMES: Record<string, string> = {
  easygifts: 'EasyGifts',
  promediaplus: 'Pro Media Plus',
  midocean: 'midocean',
  tedgifted: 'TedGifted',
  lshopteam: 'L-SHOP-TEAM',
};

/** The owner reads this, so it is a name and not a slug. */
export function supplierDisplayName(slug: string): string {
  const key = String(slug ?? '').toLowerCase();
  return DISPLAY_NAMES[key] ?? key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
