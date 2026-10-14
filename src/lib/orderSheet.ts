/**
 * Everything the shop knows about one order, as a page a human can read.
 *
 * The owner's ask was "the file AND all the data the customer chose" — so the
 * artwork goes to Drive beside this. It is deliberately plain text: it opens on
 * a phone, in Drive's preview, and in any editor, with no viewer to install.
 * A JSON twin sits next to it for anything that needs to parse rather than read.
 */

import { measuredLengthMismatch, measuredLengthText } from './printSize';

const line = '─'.repeat(64);

function money(value: unknown, currency = 'SEK'): string {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2)} ${currency}` : '—';
}

export function orderSheetText(order: any): string {
  const c = order.customerDetails ?? {};
  const ship = c.differentShippingAddress ? c.shippingAddressDetails ?? {} : null;
  const out: string[] = [];
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return;
    out.push(`${(k + ':').padEnd(20)}${v}`);
  };

  out.push(`ORDER #${order.id}`);
  out.push(line);
  put('Placed', order.createdAt);
  put('Paid', order.paidAt);
  put('Payment status', order.paymentStatus);
  put('Payment method', order.paymentMethodTitle || order.paymentMethod);
  put('Production stage', order.status);
  put('Promised for', order.dueDate);
  out.push('');

  out.push('CUSTOMER');
  out.push(line);
  put('Name', order.customerName);
  put('E-mail', order.customerEmail);
  put('Phone', c.phone);
  put('Company', c.company);
  put('Tax / VAT id', c.taxId);
  put('Address', [c.address1, c.address2].filter(Boolean).join(', '));
  put('Postcode / city', [c.postcode, c.city].filter(Boolean).join(' '));
  put('Country', c.country);
  if (ship) {
    out.push('');
    out.push('SHIPPING ADDRESS (different)');
    put('Name', [ship.firstName, ship.lastName].filter(Boolean).join(' '));
    put('Company', ship.company);
    put('Address', ship.address1);
    put('Postcode / city', [ship.postcode, ship.city].filter(Boolean).join(' '));
    put('Country', ship.country);
  }
  out.push('');

  out.push('DELIVERY & PAYMENT');
  out.push(line);
  put('Shipping', order.shippingMethodTitle || order.shippingMethod);
  put('Shipping cost', money(order.shippingCost, order.currency));
  if (order.shipment?.trackingNumber) {
    put('Tracking', `${order.shipment.trackingNumber} (${order.shipment.carrier ?? '—'})`);
  }
  if (order.zendr?.portalUrl) put('Zendr draft', order.zendr.portalUrl);
  out.push('');

  out.push('ITEMS');
  out.push(line);
  (order.items ?? []).forEach((item: any, i: number) => {
    out.push(`${i + 1}. ${item.productName ?? 'Item'}`);
    const putI = (k: string, v: unknown) => {
      if (v === undefined || v === null || v === '') return;
      out.push(`     ${(k + ':').padEnd(22)}${v}`);
    };
    putI('Quantity', item.quantity);
    putI('Line price', money(item.price, order.currency));
    putI('SKU', item.sku);
    if (item.widthCm || item.heightCm) putI('Size', `${item.widthCm ?? '?'} × ${item.heightCm ?? '?'} cm`);
    // PAY-05: a custom upload whose file is not the length he paid for — said
    // here, where the job is checked before it is printed (src/lib/printSize.ts).
    const measured = measuredLengthMismatch(item);
    if (measured) putI('Length', measuredLengthText(measured));
    // Already resolved to human labels server-side when the order was priced.
    for (const [k, v] of Object.entries(item.options ?? {})) putI(k, v as string);
    if (item.fileSpecs?.fileName) putI('Artwork file', item.fileSpecs.fileName);
    // Round 16, 5b: the owner's design template the customer started from.
    if (item.fileSpecs?.fileName && item.fileSpecs?.template) putI('Template', item.fileSpecs.template);
    // Designer v2: a studio design's file may hold two pages — which is which.
    if (item.fileSpecs?.fileName && Array.isArray(item.fileSpecs?.sides) && item.fileSpecs.sides.length > 1) {
      putI('Pages', item.fileSpecs.sides.map((sd: string, n: number) => `page ${n + 1} ${sd === 'back' ? 'back' : 'front'}`).join(', '));
    }
    // Round 16: the file may carry the shop's 3 mm bleed; placed at the size
    // above, its edge would be printed as part of the job.
    if (item.fileSpecs?.fileName && Number(item.fileSpecs?.bleedMm) > 0) {
      putI('Bleed', `${Number(item.fileSpecs.bleedMm)} mm on every side, included in the file`);
    }
    // A PDF/X with crop marks: placed by its own box, not by the page.
    if (item.fileSpecs?.fileName && (item.fileSpecs?.placeBy === 'trimbox' || item.fileSpecs?.placeBy === 'bleedbox')) {
      const pageMm =
        Number(item.fileSpecs?.pageWidthMm) > 0 && Number(item.fileSpecs?.pageHeightMm) > 0
          ? ` (page with marks ${Math.round(Number(item.fileSpecs.pageWidthMm))} × ${Math.round(Number(item.fileSpecs.pageHeightMm))} mm)`
          : '';
      putI('Placement', `Crop marks — place by the file's ${item.fileSpecs.placeBy === 'trimbox' ? 'TrimBox' : 'BleedBox'}${pageMm}`);
    }
    if (item.artworkPending) putI('Artwork', 'STILL AWAITED');
    // The shop provides it: the previous order's file, or the studio's design.
    if (item.artworkSource === 'reprint') putI('Artwork', "REPRINT — use the previous order's artwork");
    if (item.artworkSource === 'studio') putI('Artwork', 'STUDIO DESIGN — made by the shop');
    out.push('');
  });

  out.push('TOTALS');
  out.push(line);
  put('Goods', money(order.goodsNet, order.currency));
  put('Shipping', money(order.shippingCost, order.currency));
  if (Number(order.discountAmount) > 0) {
    put('Discount', `-${money(order.discountAmount, order.currency)}${order.discountCode ? ` (${order.discountCode})` : ''}`);
  }
  if (Number(order.pointsDiscountAmount) > 0) {
    put('Loyalty points', `-${money(order.pointsDiscountAmount, order.currency)} (${order.pointsRedeemed} pts)`);
  }
  put('Net', money(order.netTotal, order.currency));
  put(`VAT ${order.vatRate ? Math.round(order.vatRate * 100) + '%' : ''}`.trim(), money(order.vatAmount, order.currency));
  // The total as what it IS: an order placed to pay on delivery is filed before
  // any money arrives (and filed again once it is recorded).
  put(
    order.paymentStatus === 'paid' ? 'TOTAL PAID' : order.payOnDelivery === true ? 'TOTAL DUE ON DELIVERY' : 'TOTAL DUE',
    money(order.grossTotal, order.currency),
  );
  if (order.comments) {
    out.push('');
    out.push('CUSTOMER NOTES');
    out.push(line);
    out.push(String(order.comments));
  }
  out.push('');
  out.push(line);
  out.push(`Generated by the ReklamX shop · ${new Date().toISOString()}`);
  return out.join('\n');
}

/** A filesystem-safe folder name that sorts and reads well in Drive. */
export function orderFolderName(order: any): string {
  const who = String(order.customerName ?? 'Customer').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40);
  const day = String(order.createdAt ?? '').slice(0, 10);
  return `${order.id} — ${who}${day ? ` — ${day}` : ''}`;
}
