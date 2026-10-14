/**
 * WHERE THE PARCEL GOES — one rule for every document that says so.
 *
 * Checkout lets a customer send the order somewhere other than the billing
 * address ("Deliver to a different address"). Only the Zendr draft and the Drive
 * order sheet ever read that second address: the packing slip, the work order,
 * the staff dashboard card and the shop's own notification e-mail all printed
 * the BILLING address as the destination. Billing Stockholm, deliver to
 * Frankfurt — the carrier label (Zendr) said Frankfurt and the slip in the box
 * said Stockholm.
 *
 * A separate address the customer ticked but left without a street AND a city
 * is treated as not given, so a half-filled form never replaces a complete
 * billing address with an empty one.
 *
 * Dependency-free: the browser documents and the server's e-mail both use it.
 */

export interface DeliveryAddress {
  company: string;
  name: string;
  address1: string;
  address2: string;
  postcode: string;
  city: string;
  country: string;
  /** True when this is the customer's separate delivery address, not the billing one. */
  separate: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function deliveryAddressOf(order: any): DeliveryAddress {
  const c = order?.customerDetails ?? {};
  const ship = c.differentShippingAddress ? c.shippingAddressDetails : null;

  if (ship && (str(ship.address1) || str(ship.city))) {
    const name = [str(ship.firstName), str(ship.lastName)].filter(Boolean).join(' ');
    return {
      company: str(ship.company),
      name: name || str(order?.customerName),
      address1: str(ship.address1),
      address2: str(ship.address2),
      postcode: str(ship.postcode),
      city: str(ship.city),
      // The delivery form has had its own country only since 2026-10; an older
      // separate address carries 'Sverige' or nothing, and billing is the
      // better guess for nothing.
      country: str(ship.country) || str(c.country),
      separate: true,
    };
  }

  return {
    company: str(c.company || c.companyName),
    name: str(order?.customerName) || [str(c.firstName), str(c.lastName)].filter(Boolean).join(' '),
    // Every shape an address has ever been stored in on this shop: orders from
    // before `customerDetails` existed still have to produce a slip.
    address1: str(c.address1 || c.address || order?.shippingAddress?.street),
    address2: str(c.address2),
    postcode: str(c.postcode),
    city: str(c.city || order?.shippingAddress?.city),
    country: str(c.country),
    separate: false,
  };
}
