// Pro Media Plus, on the shared supplier shape — plan task 3.7.
//
// The feed itself is parsed in src/lib/supplierFeed.ts and that parser is left
// exactly as it is: it is proven against the live XML, it is hand-written because
// this project must not ship an XML dependency (see the note at the top of that
// file), and rewriting a working parser is how a feed that worked stops working.
//
// What moves is the SHAPE. Round 14 gave every supplier one — SupplierProduct,
// with colours hanging off it — and until now Pro Media Plus had its own
// importer, its own preview endpoint, its own re-sync and its own product
// mapping. Two of everything means a fix lands in one and not the other, and the
// picker (3.5), the per-supplier re-sync (3.10) and the category mapping (3.9)
// were all built against the model rather than against that importer.
//
// WHAT MUST NOT BE LOST, and the reason this file is careful:
//
//   * The 31 products already imported, and their cost records. Their ids are
//     `prod-pmp-<offer id>`, so `shopProductId` keeps that prefix for this
//     supplier (see LEGACY_ID_PREFIX). A re-import through this path UPDATES
//     them; a changed prefix would have created 31 duplicates and orphaned the
//     originals from the re-sync meant to maintain them.
//   * The richer product the old importer wrote: stock, bullet points, a spec
//     table, a manufacturer's part number. Those fields are now on the shared
//     shape, optional, and carried across by supplierProductToShop.
//
// This feed has NO COLOUR ROWS — one offer is one product — so `variants` is
// empty and the price is the offer's own. That is not a gap in the adapter; it
// is what the supplier sells.
//
// Pure, and tested in scripts/test-promediaplus.mjs.

import type { SupplierProduct } from './types';
import { attrValue, specsOf, type SupplierOffer } from '../supplierFeed';

/** The slug this supplier is known by, everywhere. */
export const PRO_MEDIA_PLUS = 'promediaplus';

/**
 * One parsed offer → one SupplierProduct.
 *
 * `attributes` carries every attribute the feed shipped, so nothing is thrown
 * away on the way through: the shape's own fields take what they can name and
 * the rest stays readable.
 */
export function offerToSupplierProduct(offer: SupplierOffer): SupplierProduct {
  const ean = attrValue(offer, 'EAN').replace(/[\s-]/g, '');
  const producerCode = attrValue(offer, 'Kod producenta');
  const productCode = attrValue(offer, 'Product code');

  const attributes: Record<string, string> = {};
  for (const a of offer.attrs ?? []) {
    const name = String(a?.name ?? '').trim();
    if (name) attributes[name] = String(a?.value ?? '');
  }

  return {
    supplier: PRO_MEDIA_PLUS,
    // The offer's own id, because that is what the existing 31 products are
    // keyed on and what their cost records store in supplierOfferId.
    productKey: String(offer.id),
    name: offer.name,
    // The feed is fetched from the /en/ path and ships no other language. Empty
    // maps rather than copies of the English: `localized()` treats a missing
    // language as "fall back", and a Swedish page showing an English name it
    // was never given is honest. A COPY would look translated and never be
    // corrected.
    nameI18n: {},
    description: offer.description,
    descriptionI18n: {},
    categoryPath: offer.categoryPath,
    // One path per offer: the feed's <cat> is a single breadcrumb.
    categoryPaths: offer.categoryPath.length ? [offer.categoryPath] : [],
    images: offer.images,
    // No colour rows in this feed. One offer is one sellable thing.
    variants: [],
    sourcePrice: Number.isFinite(offer.price) && offer.price > 0 ? offer.price : null,
    // EUR, NET of VAT. The feed's `tax` attribute is 23 on every row — Polish
    // VAT on the supplier's side, irrelevant to what this shop charges.
    sourceCurrency: 'EUR',
    // The feed says nothing about print methods, and inventing an empty marking
    // would show the owner a print option the supplier has not offered.
    markings: [],
    attributes,
    ean: ean || null,
    // Falls back to the supplier's own name, as the old importer did: the feed
    // carried no producer for all 110 rows imported so far, and Google Shopping
    // wants a brand.
    brand: attrValue(offer, 'producer') || 'Pro Media Plus',
    supplierUrl: offer.url || null,
    stock: Number.isFinite(offer.stock) ? offer.stock : null,
    features: offer.features ?? [],
    specs: specsOf(offer),
    mpn: producerCode || productCode || null,
    sku: productCode || `PMP-${offer.id}`,
  };
}

export function offersToSupplierProducts(offers: SupplierOffer[]): SupplierProduct[] {
  return (offers ?? []).map(offerToSupplierProduct);
}
