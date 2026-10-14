// Putting a configured product into the basket.
//
// WHY THIS FILE EXISTS
// This was ~50 lines living inside the products page's JSX. When the product
// detail page arrived it needed exactly the same 50 lines, and the two copies
// would have drifted the first time either was touched — the shape written here
// is what checkout, the server's re-pricing and the production screens all read,
// so a divergence would surface as a wrong price or a lost artwork file rather
// than as anything obvious.

import { artworkWouldOverflow, BASE64_OVERHEAD } from './artworkLimits';
import { artworkExpected, artworkSourceOf } from './artwork';
import type { PrintingFieldOption, Product } from '../types';
import { CUSTOM_SIZE_OPTION_ID } from '../components/NeoOptionField';
import { cleanDesignLaterMarker, type DesignLaterMarker, type UploadedDesign } from './designLater';

// Re-exported from cartKeys.ts, which holds nothing but these two names. Code
// that only needs to LISTEN for a basket change can import them from there
// without pulling in this module's dependency on the product types and the
// option field — which reach the PDF worker.
export { CART_STORAGE_KEY, CART_CHANGED_EVENT } from './cartKeys';
import { CART_STORAGE_KEY, CART_CHANGED_EVENT } from './cartKeys';

/**
 * THE ONLY WAY THE BASKET IS WRITTEN.
 *
 * Seven screens used to call localStorage.setItem themselves, and only this
 * file announced the change — so the header badge was kept honest by a
 * setInterval running every 1.5 seconds, for the life of every page, parsing
 * the whole cart out of localStorage each time whether anything had happened or
 * not. Writing through one function means the badge can be told instead of
 * asked, and the timer is gone.
 */
export function writeCart(items: unknown[]): void {
  // Deliberately NOT wrapped in try/catch. The design editor and the custom
  // upload page both rely on a failed write THROWING — that is how they know
  // not to tell the customer their basket was updated when the browser's
  // storage quota rejected it. Swallowing the error here would have left both
  // screens showing "Added to cart" over a basket that had not changed.
  localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  announceCartChange();
}

/** Empty it — checkout completing, or the customer clearing the drawer. */
export function clearCart(): void {
  try {
    localStorage.removeItem(CART_STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
  announceCartChange();
}

export function announceCartChange(): void {
  try {
    window.dispatchEvent(new Event(CART_CHANGED_EVENT));
    // Kept for anything still listening for the old signal.
    window.dispatchEvent(new Event('storage'));
  } catch {
    /* not a browser */
  }
}

/**
 * DESIGN LATER, IN THE BASKET (designer v2): the design he has just made goes on the
 * line he bought without one — found by its id, in the basket as it is NOW (another
 * tab may have changed it). The line then reads exactly as if it had been designed on
 * the product page. 'gone' when the line is no longer there, 'has-file' when it has
 * one already (the caller deletes the upload and says which); throws when the
 * browser's storage refuses the write.
 */
export function attachDesignToCartLine(lineId: string, design: UploadedDesign): 'attached' | 'gone' | 'has-file' {
  let items: any[];
  try {
    items = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
  } catch {
    return 'gone';
  }
  if (!Array.isArray(items)) return 'gone';
  const at = items.findIndex((i) => i && i.id === lineId);
  const line = at >= 0 ? items[at] : null;
  if (!line) return 'gone';
  if (line.fileUrl || line.fileName) return 'has-file';
  const widthCm = Number(line.widthCm) > 0 ? Number(line.widthCm) : Number(line.printWidthCm) > 0 ? Number(line.printWidthCm) : Math.round(design.trimMm.wMm) / 10;
  const heightCm = Number(line.heightCm) > 0 ? Number(line.heightCm) : Number(line.printHeightCm) > 0 ? Number(line.printHeightCm) : Math.round(design.trimMm.hMm) / 10;
  const { designLater: _done, ...rest } = line;
  items[at] = {
    ...rest,
    printWidthCm: Number(line.printWidthCm) > 0 ? line.printWidthCm : Math.round(design.trimMm.wMm) / 10,
    printHeightCm: Number(line.printHeightCm) > 0 ? line.printHeightCm : Math.round(design.trimMm.hMm) / 10,
    fileName: design.fileName,
    fileUrl: design.fileUrl,
    storagePath: design.storagePath,
    artworkPending: false,
    fileSpecs: {
      fileName: design.fileName,
      fileUrl: design.fileUrl,
      storagePath: design.storagePath,
      widthCm,
      heightCm,
      fileType: (design.fileName.split('.').pop() || 'PDF').toUpperCase(),
      ...(Number(design.bleedMm) > 0 ? { bleedMm: Number(design.bleedMm) } : {}),
      ...(Number(design.dpi) > 0 ? { dpi: Number(design.dpi) } : {}),
      ...(design.template?.id ? { templateId: String(design.template.id).slice(0, 64), template: String(design.template.name ?? '').slice(0, 120) } : {}),
      ...(design.previews.length ? { previews: design.previews.map((p) => ({ side: p.side, url: p.url })) } : {}),
      ...(design.sides.length ? { sides: [...design.sides], pages: design.sides.length } : {}),
    },
  };
  writeCart(items);
  return 'attached';
}

export interface ConfiguredLineInput {
  product: Product;
  selectedOptions: Record<string, PrintingFieldOption>;
  quantity: number;
  totalUnitPrice: number;
  totalPrice: number;
  widthCm: number;
  heightCm: number;
  /**
   * The size the customer's ARTWORK has to be — 15.6.3.
   *
   * Separate from widthCm/heightCm on purpose, and never sent to the server as
   * those: that pair is a PRICING input (calcConfiguredItemPrice charges by
   * area from it), and it is deliberately omitted unless the shopper was asked
   * for a size, because the fallback is a 50 × 70 default that once printed
   * "50 × 70 cm" on every line in the shop.
   *
   * This one is descriptive only. It comes from the option he chose — "Rollup
   * 85x200 cm" — so the file's own record finally says what size the job is,
   * on the products where the customer never types a size at all.
   */
  printWidthCm?: number;
  printHeightCm?: number;
  fileName?: string;
  /** Base64 bytes — the fallback, used only when object storage was unreachable. */
  fileDataUrl?: string | null;
  /** The object-storage download URL, when the upload succeeded. */
  fileUrl?: string | null;
  storagePath?: string | null;
  /**
   * Millimetres of bleed the FILE carries on every side (round 16): the online
   * designer's file always has 3, and a customer's file may now be either size.
   * Absent when it has none or nobody can tell (src/lib/artworkFit.ts).
   */
  fileBleedMm?: number | null;
  /** The print file's own resolution, when the shop made it (the online designer). */
  fileDpi?: number | null;
  /**
   * The owner's design template the file started from (round 16, 5b). The id is
   * what counts: the server names it from its own copy when the order is placed.
   */
  fileTemplate?: { id: string; name: string } | null;
  /** A PDF/X with crop marks, accepted by its own box: place it by that box, not by the page. */
  filePlaceBy?: 'trimbox' | 'bleedbox' | null;
  filePageMm?: { wMm: number; hMm: number } | null;
  /**
   * A studio design (designer v2): a small picture of each page, uploaded beside the
   * file — what the basket, the order and production show — and the pages the file
   * holds, in print order (src/lib/designFileSpecs.ts).
   */
  filePreviews?: Array<{ side: 'front' | 'back'; url: string }> | null;
  fileSides?: Array<'front' | 'back'> | null;
  /**
   * "Add to basket without the design" (designer v2, design later): what the designer
   * needs to open on this line from the basket — the size, the cut, the pages. Only
   * on a line bought as "Design online" with no design yet (src/lib/designLater.ts).
   * The ORDER's copy is the server's own.
   */
  designLater?: DesignLaterMarker | null;
}

// The success arm carries the optional-undefined siblings on purpose: this
// project compiles without `strict`, and there a bare `{ ok: true }` arm does not
// narrow reliably at the call site — reading `result.message` after `if
// (!result.ok)` was a compile error. Declaring the keys on both arms keeps the
// discriminant honest and the callers simple.
export type AddToCartResult =
  | { ok: true; reason?: undefined; message?: undefined }
  | { ok: false; reason: 'artwork-overflow' | 'storage-failed'; message: string };

/**
 * Append one configured line to the basket in localStorage.
 *
 * `id` is stamped from the clock so two lines of the same product stay separate
 * rows the shopper can remove independently.
 *
 * The line carries BOTH shapes of the option data on purpose:
 *   * `selectedOptions` — human-readable labels, for the cart drawer, the order
 *     confirmation and the production sheet;
 *   * `selectedOptionIds` plus `widthCm`/`heightCm` — what the server needs to
 *     re-derive the price at checkout without trusting anything the browser says.
 *
 * @param storageFailedMessage already-translated text for the storage failure,
 *        because this module has no access to the translation context.
 */
export function addConfiguredLineToCart(
  input: ConfiguredLineInput,
  storageFailedMessage: string,
): AddToCartResult {
  const formattedOptions: Record<string, string> = {};
  Object.entries(input.selectedOptions || {}).forEach(([fieldId, opt]) => {
    if (opt && typeof opt === 'object') {
      formattedOptions[fieldId] = opt.label || opt.value || String(opt);
    } else if (opt) {
      formattedOptions[fieldId] = String(opt);
    }
  });

  // The "custom size" sentinel is scoped to the field it was chosen on.
  //
  // It used to travel as a bare '__custom_size', which named no field — so the
  // server, seeing it, enforced the size bounds of EVERY field on the product
  // that allows a custom size. prod-003 has two such fields with different
  // limits, and a size legal for the one the shopper actually used was rejected
  // by the other, failing the whole basket at payment with an error the shopper
  // could not act on. The server accepts both forms; only old baskets carry the
  // bare one.
  const selectedOptionIds = Object.entries(input.selectedOptions || {})
    .filter(([, opt]) => Boolean(opt?.id))
    .map(([fieldId, opt]) =>
      opt.id === CUSTOM_SIZE_OPTION_ID ? `${CUSTOM_SIZE_OPTION_ID}:${fieldId}` : String(opt.id),
    );

  // What he chose, as the artwork rule reads it (src/lib/artwork.ts).
  const chosen = Object.entries(input.selectedOptions || {}).map(([fieldId, opt]) => ({
    fieldId,
    id: opt?.id ?? null,
    value: opt?.value ?? null,
  }));
  const artworkSource = artworkSourceOf(chosen);

  const newItem = {
    id: `prod-${input.product.id}-${Date.now()}`,
    productId: input.product.id,
    productName: input.product.name,
    image: input.product.images?.[0],
    quantity: input.quantity,
    unitPrice: input.totalUnitPrice,
    totalPrice: input.totalPrice,
    selectedOptions: formattedOptions,
    selectedOptionIds,
    widthCm: input.widthCm,
    heightCm: input.heightCm,
    // 15.6.3 — the size his ARTWORK has to be, kept on the line itself and not
    // only inside fileSpecs. A line with no file yet has no fileSpecs at all,
    // and that is exactly the case this is for: he buys now, the designer
    // finishes on Thursday, and the upload box he opens then has to be able to
    // tell him how big to make it.
    printWidthCm: input.printWidthCm,
    printHeightCm: input.printHeightCm,
    // Without these the order reached production with no artwork at all.
    //
    // The object-storage URL wins over the base64 bytes: it is a few hundred
    // characters instead of megabytes, so the order document stays small and the
    // 1 MiB Firestore limit stops being the thing that decides how big a print
    // file a customer may send.
    fileName: input.fileName,
    fileUrl: input.fileUrl ?? input.fileDataUrl ?? null,
    storagePath: input.storagePath ?? null,
    // Artwork is optional on most products, so "no file" is now a legitimate
    // state rather than an impossible one. Say it out loud on the line: an
    // empty thumbnail on the production screen looks like a broken image, a
    // flag looks like a job waiting for a file — which is what it is.
    // THE SAME QUESTION THE SERVER ASKS, from the same function. "No file" is
    // not "waiting for a file": a product whose upload box was never switched on
    // has nothing pending, and the abandoned-basket snapshot and the order must
    // not disagree about that.
    artworkPending: artworkExpected(false, input.product as any, chosen) && !input.fileName,
    // A reprint or the shop's studio: the artwork is the shop's to provide, not
    // his to send (src/lib/artwork.ts). Only when it is so — never undefined.
    ...(artworkSource ? { artworkSource } : {}),
    // Design later: the designer opens on this line from the basket. Never with a file.
    ...(() => {
      const marker = input.fileName ? null : cleanDesignLaterMarker(input.designLater);
      return marker ? { designLater: marker } : {};
    })(),
    // Frozen at the time of the order: renaming a product's SKU later must not
    // rewrite the code printed on work orders that already went to the press.
    sku: input.product.sku || null,
    fileSpecs:
      input.fileUrl || input.fileDataUrl
        ? {
            fileName: input.fileName,
            fileUrl: input.fileUrl ?? input.fileDataUrl,
            storagePath: input.storagePath ?? null,
            // The priced size when there is one, otherwise the size of the
            // option he chose. fileSpecs is what the work order, the packing
            // slip and the customer's own order page print, and on a
            // preset-size product both of these used to be undefined — so the
            // paperwork for a roll-up said nothing about how big it is.
            widthCm: input.widthCm ?? input.printWidthCm,
            heightCm: input.heightCm ?? input.printHeightCm,
            fileType: (input.fileName?.split('.').pop() || 'PDF').toUpperCase(),
            // So production places the file by its TRIM and cuts the bleed off,
            // instead of printing it as part of the product (round 16).
            ...(Number(input.fileBleedMm) > 0 ? { bleedMm: Number(input.fileBleedMm) } : {}),
            ...(Number(input.fileDpi) > 0 ? { dpi: Number(input.fileDpi) } : {}),
            ...(input.fileTemplate?.id
              ? { templateId: String(input.fileTemplate.id).slice(0, 64), template: String(input.fileTemplate.name ?? '').slice(0, 120) }
              : {}),
            // A studio design: every page's picture, and its pages in print order.
            ...(input.filePreviews?.length ? { previews: input.filePreviews.map((p) => ({ side: p.side, url: p.url })) } : {}),
            ...(input.fileSides?.length ? { sides: [...input.fileSides], pages: input.fileSides.length } : {}),
            // A PDF/X with crop marks: production places it by its own box.
            ...(input.filePlaceBy === 'trimbox' || input.filePlaceBy === 'bleedbox'
              ? {
                  placeBy: input.filePlaceBy,
                  ...(input.filePageMm && input.filePageMm.wMm > 0 && input.filePageMm.hMm > 0
                    ? { pageWidthMm: Math.round(input.filePageMm.wMm * 10) / 10, pageHeightMm: Math.round(input.filePageMm.hMm * 10) / 10 }
                    : {}),
                }
              : {}),
          }
        : null,
  };

  try {
    const existingCart = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
    // A file that went to storage contributes a URL, not bytes — only an
    // embedded fallback can overflow the order document.
    const newFileBytes = input.fileDataUrl
      ? Math.ceil(input.fileDataUrl.length / BASE64_OVERHEAD)
      : 0;
    const overflow = artworkWouldOverflow(existingCart, newFileBytes);
    if (overflow) {
      return { ok: false, reason: 'artwork-overflow', message: overflow };
    }
    existingCart.push(newItem);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(existingCart));
    // The cart drawer and the header badge listen for this.
    announceCartChange();
    return { ok: true };
  } catch (err) {
    console.error('Could not save the cart:', err);
    return { ok: false, reason: 'storage-failed', message: storageFailedMessage };
  }
}
