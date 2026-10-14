/**
 * The Pro Media Plus B2B product feed.
 *
 * The owner is a trade customer of promediaplus.pl and was given integration
 * credentials so his shop can carry their catalogue — 635 products, twenty
 * top-level categories, four thousand photographs. He asked to add them from the
 * dashboard rather than typing them in one at a time.
 *
 * WHY THIS PARSER IS HAND-WRITTEN. There is no XML parser in this project and
 * there must not be one: `npm run build` bundles the server with
 * `--packages=external`, and scripts/cpanel-deploy.sh ships only `dist/`. A
 * `require('fast-xml-parser')` inside dist/server.cjs would throw
 * MODULE_NOT_FOUND on a host with no SSH and no way to run npm install. So the
 * feed is parsed with string scanning, against this one known format.
 *
 * This module is imported by server.ts and by the unit test. Keep it free of
 * React, Firebase and `window` — esbuild pulls it straight into dist/server.cjs.
 *
 * THE FEED, as it actually arrives (fetched and inspected 2026-09-08):
 *
 *   <offers version="1">
 *     <o id="47" url="…" price="10.98" stock="18306" set="0" basket="1">
 *       <name>Roll Up Compact 85x200</name>
 *       <imgs><main url="…jpg"/><i url="…jpg"/>…</imgs>
 *       <desc>&lt;h2&gt;…escaped HTML…&lt;/h2&gt;</desc>
 *       <cat>Roll Ups,Compact</cat>
 *       <delivery>Product ready to be&lt;br/&gt;send out today!</delivery>
 *       <attrs><a name="producer">Pro Media Plus</a><a name="EAN">…</a>…</attrs>
 *     </o>
 *   </offers>
 *
 * `price` is EUR, NET of VAT. The `tax` attribute is 23 on every product — that
 * is POLISH VAT on the supplier's side and is irrelevant to what this shop
 * charges; ReklamX prices net and adds Swedish VAT at checkout.
 */

export type SupplierAttr = { name: string; value: string };

export type SupplierOffer = {
  /** The supplier's own id. Used to build a stable product id so a re-import updates. */
  id: string;
  name: string;
  /** EUR, net. */
  price: number;
  stock: number;
  /** The supplier's product page. Kept for the owner, never shown to a shopper. */
  url: string;
  /** Absolute image URLs, main first. */
  images: string[];
  /** Plain text, tags stripped and entities decoded. */
  description: string;
  /** Bullet points harvested from the description's <li> items. */
  features: string[];
  /** Breadcrumb segments, noise removed. First is the top-level category. */
  categoryPath: string[];
  attrs: SupplierAttr[];
};

/** XML/HTML entities, twice over: this feed escapes HTML and then embeds it in XML. */
export function decodeEntities(input: string): string {
  return String(input ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // LAST, or &amp;lt; would become < instead of &lt;
}

/**
 * Description HTML → plain text.
 *
 * The <desc> is escaped HTML containing <img src="/files/image/123.jpg"> and
 * <a href="/files/file/…pdf"> — RELATIVE to promediaplus.pl. Left in place those
 * become broken links and missing images on shop.reklamx.se, which is worse than
 * having no description at all. There is no sanitiser in this project either, so
 * the safe answer is to keep the words and drop the markup entirely.
 */
export function htmlToText(html: string): string {
  const decoded = decodeEntities(html);
  return decoded
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** The supplier writes a "PRODUCT ADVANTAGES" bullet list; those are real features. */
export function extractFeatures(html: string): string[] {
  const decoded = decodeEntities(html);
  const out: string[] = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decoded)) !== null) {
    const text = m[1]
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      // They prefix several with "- ".
      .replace(/^[-–—•\s]+/, '')
      .trim();
    if (text && text.length <= 200) out.push(text);
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Breadcrumb segments worth keeping.
 *
 * "List of all products in this category" is a navigation node the supplier
 * emits inside the path, in mixed case. It is not a category and must never
 * become one in this shop.
 */
const CATEGORY_NOISE = /^list of all products in this category$/i;

export function parseCategoryPath(raw: string): string[] {
  return String(raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && !CATEGORY_NOISE.test(s));
}

/** Attribute values on the <o> element, e.g. price="10.98". */
function attrOf(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

/** The text between <tag> and </tag>, first occurrence, within one offer block. */
function childText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

/**
 * Parse the whole feed.
 *
 * Scans for `<o …>` … `</o>` blocks rather than building a document tree: the
 * file is 1.7 MB and the shape is fixed, so there is nothing a tree would buy.
 * A malformed offer is SKIPPED rather than aborting the import — one bad row out
 * of 635 must not cost the owner the other 634.
 */
export function parseSupplierFeed(xml: string): { offers: SupplierOffer[]; skipped: number } {
  const offers: SupplierOffer[] = [];
  let skipped = 0;

  const re = /<o\s([^>]*)>([\s\S]*?)<\/o>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    try {
      const head = ` ${m[1]}`;
      const body = m[2];

      const id = attrOf(head, 'id').trim();
      const name = decodeEntities(childText(body, 'name')).trim();
      // A MISSING price attribute reads as the empty string, and Number('') is 0,
      // which is finite — so this guard used to pass an offer with no price at
      // all and import it as a product costing NOTHING. Require the attribute to
      // be present AND to parse to a positive number.
      const rawPrice = attrOf(head, 'price').trim();
      const price = Number(rawPrice);
      if (!id || !name || rawPrice === '' || !Number.isFinite(price) || price <= 0) { skipped += 1; continue; }

      const imgsBlock = childText(body, 'imgs');
      const images: string[] = [];
      const mainUrl = (imgsBlock.match(/<main[^>]*url="([^"]+)"/i) ?? [])[1];
      if (mainUrl) images.push(decodeEntities(mainUrl));
      const imgRe = /<i[^>]*url="([^"]+)"/gi;
      let im: RegExpExecArray | null;
      while ((im = imgRe.exec(imgsBlock)) !== null) images.push(decodeEntities(im[1]));

      const rawDesc = childText(body, 'desc');
      const attrs: SupplierAttr[] = [];
      const attrsBlock = childText(body, 'attrs');
      const aRe = /<a\s+name="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
      let am: RegExpExecArray | null;
      while ((am = aRe.exec(attrsBlock)) !== null) {
        const aName = decodeEntities(am[1]).trim();
        const aVal = decodeEntities(am[2]).replace(/\s+/g, ' ').trim();
        if (aName && aVal) attrs.push({ name: aName, value: aVal });
      }

      offers.push({
        id,
        name,
        price,
        stock: Math.max(0, Math.floor(Number(attrOf(head, 'stock')) || 0)),
        url: decodeEntities(attrOf(head, 'url')),
        images,
        description: htmlToText(rawDesc),
        features: extractFeatures(rawDesc),
        categoryPath: parseCategoryPath(decodeEntities(childText(body, 'cat'))),
        attrs,
      });
    } catch {
      skipped += 1;
    }
  }

  return { offers, skipped };
}

/** Attribute lookup, case-insensitive — the supplier mixes "EAN" and "Product code". */
export function attrValue(offer: SupplierOffer, name: string): string {
  const found = offer.attrs.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : '';
}

/**
 * Attributes that become a product's specification table.
 *
 * The five excluded here are not specifications: they are the fields that map to
 * brand, sku, gtin and mpn, and repeating them in the spec table would print the
 * barcode twice on the product page. `tax` is the supplier's Polish VAT rate and
 * has nothing to do with what this shop charges.
 */
const ATTRS_NOT_SPECS = new Set(['producer', 'tax', 'kod producenta', 'product code', 'ean']);

export function specsOf(offer: SupplierOffer): { label: string; value: string }[] {
  return offer.attrs
    .filter((a) => !ATTRS_NOT_SPECS.has(a.name.toLowerCase()))
    .map((a) => ({ label: a.name, value: a.value }));
}

export type MappingOptions = {
  /** EUR → SEK. The owner sets it; nothing here guesses at an exchange rate. */
  rate: number;
  /** Retail markup on the supplier's trade price, as a percentage. */
  marginPercent: number;
  /** Supplier top-level category → an EXISTING categories/ document id. */
  categoryMap: Record<string, string>;
  /** Slugs already in use, so a batch cannot collide with itself or the catalogue. */
  takenSlugs: Set<string>;
  /** Products land hidden by default; the owner reveals them when he has reviewed them. */
  hidden?: boolean;
  /** How many photographs to carry per product. */
  maxImages?: number;
  nowIso: string;
};

/**
 * What this shop PAYS for a product, and where it buys it.
 *
 * These seven fields are returned apart from the product document because for
 * one release they were not. Round 12's importer wrote them straight onto the
 * product, and `products` is `allow read: if true` — the storefront reads the
 * catalogue out of Firestore directly when the API's cache is cold. So all
 * sixteen live products published, to anybody with a browser and no account at
 * all, the euro trade price, the exchange rate, the uniform 150 % markup on top
 * of it and the supplier's own order page for the same item. A competitor could
 * price against us without asking anyone.
 *
 * They live in productCosts/<productId> now — same document id, a collection
 * that is closed to every browser (firestore.rules) and reachable only by the
 * Admin SDK. Nothing in the storefront ever read them: they exist so a re-sync
 * can tell a price this importer wrote from one the owner typed himself.
 */
export type ProductCosts = {
  supplier: string;
  supplierOfferId: string;
  /** The supplier's B2B product page. For the owner's eyes, and now only his. */
  supplierUrl: string;
  /** The trade price exactly as the feed gives it: EUR, net of VAT. */
  sourcePrice: number;
  sourceCurrency: string;
  sourceRate: number;
  marginPercent: number;
};

/**
 * The shop's selling price from a supplier's trade price.
 *
 * Exported because TWO places compute it and they must not drift: the importer,
 * and the dashboard's bulk "change the margin on these products", which has to
 * reprice from the same source figures rather than from the price already shown.
 * Repricing from the current price compounds — apply 40% twice and the second
 * one is charged on the first one's markup.
 *
 * Rounded to the krona, because that is what the shop displays and charges.
 */
export function priceFromSource(sourcePrice: number, rate: number, marginPercent: number): number {
  return Math.round(sourcePrice * rate * (1 + marginPercent / 100));
}

/**
 * One supplier offer → one ReklamX product document, and the costs that must
 * not be inside it.
 *
 * TWO objects on purpose. `product` is world-readable and `costs` is not, so the
 * caller has to say where each half is written; handing both back in one object
 * literal is exactly how the trade prices came to be published in the first
 * place. `costs` goes to productCosts/<product.id>.
 *
 * Pure, and deliberately so: every decision below is testable without a network,
 * a database or a browser, and scripts/test-supplier-feed.mjs asserts them.
 */
export function mapOfferToProduct(
  offer: SupplierOffer,
  opts: MappingOptions,
  slugify: (s: string) => string,
  uniqueSlug: (base: string, taken: Iterable<string>) => string,
): { product: Record<string, any>; costs: ProductCosts } {
  // A DETERMINISTIC ID, not `prod-${Date.now()}`.
  //
  // Two reasons. Date.now() has millisecond resolution and a batch writes far
  // faster than that, so ids would collide inside a single import. And a stable
  // id makes re-importing an UPDATE rather than 635 duplicates — the owner can
  // refresh prices next month without cleaning up after himself.
  const id = `prod-pmp-${offer.id}`;

  const slug = uniqueSlug(slugify(offer.name), opts.takenSlugs);
  // Feed it back in, or the nineteen products whose names begin "LUNIX™" all
  // resolve to the same address and eighteen of them become unreachable.
  opts.takenSlugs.add(slug);

  const top = offer.categoryPath[0] ?? '';
  const categoryId = opts.categoryMap[top] ?? opts.categoryMap[''] ?? '';

  // EUR trade price → SEK retail, net, rounded to the krona. The margin is the
  // owner's; there is no default, because a default margin is a guess about
  // somebody else's business.
  const basePrice = priceFromSource(offer.price, opts.rate, opts.marginPercent);

  const ean = attrValue(offer, 'EAN').replace(/[\s-]/g, '');
  const producerCode = attrValue(offer, 'Kod producenta');
  const productCode = attrValue(offer, 'Product code');

  const product = {
    id,
    name: offer.name,
    slug: slug || null,
    description: offer.description,
    categoryId,
    basePrice,
    salePrice: null,
    images: offer.images.slice(0, opts.maxImages ?? 4),
    options: [],
    printingFields: [],
    quantityAfterFieldId: null,
    // These are stocked hardware, not print jobs: nothing is designed, nothing is
    // uploaded, and the configurator renders perfectly well with no fields.
    isWeb2Print: false,
    artworkRequired: false,
    // HIDDEN ON ARRIVAL. Six hundred unreviewed products appearing in the shop at
    // once — with the storefront picking some of them arbitrarily — is worse than
    // no import at all. The owner reveals them when he has looked at them.
    isHidden: opts.hidden !== false,
    minQuantity: 1,
    // A maxQuantity below the minimum is treated as bad data by the quantity
    // ladder and silently becomes min×1000, so it is clamped rather than taken
    // from a stock figure that can be zero.
    maxQuantity: Math.max(10, Math.min(offer.stock || 0, 10000)),
    stock: offer.stock,
    features: offer.features,
    specs: specsOf(offer),
    // areaPriced MUST be false. Left true, every one of these products silently
    // gains areaSqm × 350 kr on a 50×70 default nobody chose — the phantom
    // surcharge the owner reported in round 9 and could not switch off.
    customUploadRules: { enabled: false, areaPriced: false, minPrice: 0 },
    // Undefined here would fall back to PRICING_DEFAULTS: a 49 kr setup fee per
    // line and 10/20/30/40% volume discounts. Those are print-job rules and have
    // no business on resold hardware.
    pricingRules: { baseSetupFee: 0, volumeDiscounts: [] },
    // Google Shopping. A real barcode makes the item matchable; a malformed one
    // gets it rejected, which is why the digits are stripped of spaces and dashes.
    brand: attrValue(offer, 'producer') || 'Pro Media Plus',
    gtin: ean || null,
    mpn: producerCode || productCode || null,
    condition: 'new',
    sku: productCode || `PMP-${offer.id}`,
    seoTitle: null,
    seoDescription: null,
    seoNoindex: false,
    seoExcludeFromSitemap: false,
    // WHO it came from, on the product — "يجب وضع اسم Supplier".
    //
    // This is NOT a reopening of the cost leak. The seven fields that moved to
    // productCosts were the trade price, the exchange rate, the markup and the
    // supplier's own order page: together, everything a competitor needs to
    // price against us. These two are the supplier's NAME and the row's id in
    // their feed, and the name is already public on every one of these products
    // anyway — `brand` above falls back to it whenever the feed carries no
    // producer, which it did for all 110 imported so far.
    //
    // What they buy is a dashboard that can answer "where did this come from"
    // without opening a closed collection, and a re-sync that can be scoped to
    // one supplier. The display name, not the slug: the owner reads this.
    supplierName: 'Pro Media Plus',
    supplierOfferId: offer.id,
    // The date stays on the product. It says when a row last came from the feed,
    // which the dashboard wants and which tells a competitor nothing.
    importedAt: opts.nowIso,
    createdAt: opts.nowIso,
    updatedAt: opts.nowIso,
  };

  // PROVENANCE — and it is written somewhere else. Without these a re-sync
  // cannot tell a price the owner set by hand from one this importer wrote, and
  // would overwrite his work, so they are still kept; they are just kept in
  // productCosts/<id>, under the same id as the product, where no browser can
  // read them.
  const costs: ProductCosts = {
    supplier: 'promediaplus',
    supplierOfferId: offer.id,
    supplierUrl: offer.url,
    sourcePrice: offer.price,
    sourceCurrency: 'EUR',
    sourceRate: opts.rate,
    marginPercent: opts.marginPercent,
  };

  return { product, costs };
}

/** Top-level categories in the feed, with a count, for the mapping screen. */
export function categoryHistogram(offers: SupplierOffer[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const o of offers) {
    const top = o.categoryPath[0] ?? '(none)';
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}
