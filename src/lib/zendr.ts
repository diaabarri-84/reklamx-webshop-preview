/**
 * Zendr — the freight platform the shop books its shipments through.
 *
 * WHAT THIS API CAN AND CANNOT DO (Zendr API v1.0.6, the specification the
 * owner exported from the portal on 2026-08-29):
 *
 *   - It creates order DRAFTS and reports tracking.
 *   - It does NOT book a shipment and it does NOT quote a price. Zendr's own
 *     note is explicit: "we currently only offer the possibility to create
 *     drafts for orders. To finalize the booking, you need to log in to our
 *     user portal and book the order manually."
 *
 * So this does the part a computer can do. Every paid order that is being
 * shipped arrives in Zendr as a draft with both addresses, the parcel and the
 * order reference already filled in — the staff member opens it in the portal,
 * picks the carrier and price they want and presses book. What the shop charges
 * the customer for shipping is unchanged: it is still the fixed fee in
 * PRICING_DEFAULTS.shippingFees, because the API cannot tell us a price.
 *
 * Tracking comes back the other way and is written onto the order, so the
 * customer sees where their parcel is without anyone retyping a number.
 *
 * Server-side only: the key must never reach a browser.
 */

import { deliveryAddressOf } from './deliveryAddress';
import { toCountryCode } from './vatRegime';

const TEST_BASE = 'https://test-api.zendr.se/api/v1';
const LIVE_BASE = 'https://api.zendr.se/api/v1';

/** How long any single Zendr call may take before it is abandoned. */
const TIMEOUT_MS = 15_000;

export type ZendrContact = {
  name?: string;
  company?: string;
  email?: string;
  phoneNumber?: string;
  vatNumber?: string;
};

export type ZendrAddress = {
  postalCode?: string;
  postalTown?: string;
  countryCode?: string;
  addressLine1?: string;
  addressLine2?: string;
};

export type ZendrParty = {
  type?: 'private' | 'business';
  contact: ZendrContact;
  address: ZendrAddress;
};

export type ZendrPackage = {
  type: 'package' | 'pallet';
  width: number;
  height: number;
  length: number;
  count: number;
  weight: number;
  stackable?: boolean;
  description?: string;
};

export type ZendrDraft = {
  orderId: string;
  sender: ZendrParty;
  receiver: ZendrParty;
  packages: ZendrPackage[];
  information?: { reference?: string; description?: string };
};

export type ZendrDraftResult = { orderId: string; importedOrderId: number };

export type ZendrTracking = {
  orderId: string;
  trackingNumber?: string;
  status?: 'APPROVED' | 'SHIPPED' | 'IN_TRANSIT' | 'DELIVERED' | 'REJECTED' | 'CANCELLED';
  carrier?: string;
  pickupDate?: string;
  lastUpdated?: string;
};

/** No key, no integration — and no noisy failures either. */
export function zendrConfigured(): boolean {
  return Boolean((process.env.ZENDR_API_KEY ?? '').trim());
}

/**
 * Test or production. ZENDR_MODE=test points every call at Zendr's test server,
 * which is where an integration is proved before it touches the real freight
 * account. Anything else means production, because that is where the shop's
 * shipments actually live.
 */
export function zendrBaseUrl(): string {
  const override = (process.env.ZENDR_API_BASE ?? '').trim().replace(/\/+$/, '');
  if (override) return override;
  return (process.env.ZENDR_MODE ?? '').trim().toLowerCase() === 'test' ? TEST_BASE : LIVE_BASE;
}

/** Where a draft can be opened and booked by hand. */
export function zendrPortalUrl(importedOrderId: number | string): string {
  const base = (process.env.ZENDR_PORTAL_URL ?? 'https://portal.zendr.se').replace(/\/+$/, '');
  return `${base}/create/imported/${importedOrderId}`;
}

async function call<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
  const key = (process.env.ZENDR_API_KEY ?? '').trim();
  if (!key) throw new Error('ZENDR_API_KEY is not configured.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${zendrBaseUrl()}${path}`, {
      method: init.method,
      headers: {
        'x-api-key': key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });

    const text = await resp.text();
    let parsed: any = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!resp.ok) {
      // Zendr answers errors as {code, message}; anything else is reported as
      // the raw body, trimmed, so a proxy's HTML page does not fill the log.
      const detail = parsed?.message ?? text.slice(0, 300) ?? '';
      throw new Error(`Zendr ${resp.status}${detail ? `: ${detail}` : ''}`);
    }
    return parsed as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error(`Zendr did not answer within ${TIMEOUT_MS / 1000}s.`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create drafts. The endpoint takes an array and returns ONLY the ones it
 * accepted, so a caller sending one draft must check that it got one back
 * rather than assuming success from the 200.
 */
export async function createOrderDrafts(drafts: ZendrDraft[]): Promise<ZendrDraftResult[]> {
  const created = await call<ZendrDraftResult[]>('/order/draft', { method: 'POST', body: drafts });
  return Array.isArray(created) ? created : [];
}

/** Tracking for one order. 404 means Zendr has nothing yet, which is not an error. */
export async function fetchTracking(orderId: string): Promise<ZendrTracking | null> {
  try {
    return await call<ZendrTracking>(`/order/${encodeURIComponent(orderId)}/tracking`, { method: 'GET' });
  } catch (err: any) {
    if (String(err?.message ?? '').startsWith('Zendr 404')) return null;
    throw err;
  }
}

/** Tracking for many orders in one call — what the scheduled sweep uses. */
export async function fetchTrackingBatch(orderIds: string[]): Promise<ZendrTracking[]> {
  if (orderIds.length === 0) return [];
  const rows = await call<ZendrTracking[]>('/order/tracking', {
    method: 'POST',
    body: { orderIds },
  });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Ask Zendr whether a key is real before it is saved from the dashboard.
 *
 * There is no "whoami" endpoint, so the probe asks for tracking on an order id
 * that cannot exist. What matters is HOW it fails: a 404 means the request got
 * past authentication (the key works); a 401/403 means the key itself was
 * refused. Anything else is a connectivity problem, reported as such rather
 * than blamed on the key.
 */
export async function verifyZendrKey(apiKey: string): Promise<{ ok: boolean; reason?: string }> {
  const key = apiKey.trim();
  if (key.length < 32) {
    return { ok: false, reason: 'That looks too short to be a Zendr API key.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${zendrBaseUrl()}/order/RX-KEY-PROBE/tracking`, {
      headers: { 'x-api-key': key, Accept: 'application/json' },
      signal: controller.signal,
    });
    // Zendr answers 404 to a bad key AND to a good key asking about a
    // non-existent order — the status alone proves nothing. The body is what
    // differs: an unknown key gets "Integration not found", while an
    // authenticated caller asking about a nonsense order gets "Tracking
    // information not found". Verified against the live API, both ways.
    const body = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403 || /integration not found/i.test(body)) {
      return { ok: false, reason: 'Zendr rejected this key. Copy it again from portal.zendr.se → Tillägg → Zendr API.' };
    }
    if (resp.status === 404 || resp.ok) return { ok: true };
    return { ok: false, reason: `Zendr answered unexpectedly (${resp.status}) — try again.` };
  } catch (err: any) {
    if (err?.name === 'AbortError') return { ok: false, reason: 'Zendr did not answer in time — try again.' };
    return { ok: false, reason: `Could not reach Zendr: ${String(err?.message ?? err).slice(0, 120)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Zendr will not accept a shipment that has already arrived or been called off. */
export function trackingIsFinal(status?: string): boolean {
  return status === 'DELIVERED' || status === 'REJECTED' || status === 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Turning one of our orders into one of their drafts
// ---------------------------------------------------------------------------

const COUNTRY_CODES: Record<string, string> = {
  sverige: 'SE',
  sweden: 'SE',
  norge: 'NO',
  norway: 'NO',
  danmark: 'DK',
  denmark: 'DK',
  finland: 'FI',
  suomi: 'FI',
  deutschland: 'DE',
  germany: 'DE',
};

/**
 * The checkout stores country names ("Sverige"); Zendr wants ISO codes. Falls back
 * to SE — which is right for the SENDER (the shop's own address from the
 * environment) and wrong for a customer: see receiverCountryCodeOf.
 */
export function countryCodeOf(country: unknown): string {
  const raw = String(country ?? '').trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return COUNTRY_CODES[raw.toLowerCase()] ?? 'SE';
}

/** A country name or code to ISO, or null when it is not certain — never a guess. */
function strictCountryCode(country: unknown): string | null {
  const raw = String(country ?? '').trim().toLowerCase();
  // Own keys only ('__proto__' is not a country).
  return Object.hasOwn(COUNTRY_CODES, raw) ? COUNTRY_CODES[raw] : toCountryCode(raw);
}

/**
 * Where the parcel goes, as Zendr needs it. The order's own code first — the
 * server stores it from the owner's country list (round 16) — else read from the
 * delivery address the slip and the job sheet print. Unknown is null, NOT
 * Sweden: the owner can now add countries, and a Dutch parcel drafted as Swedish
 * is a label that costs money to fix.
 */
export function receiverCountryCodeOf(order: any): string | null {
  const stored = String(order?.deliveryCountryCode ?? '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(stored)) return stored;
  const named = deliveryAddressOf(order).country;
  // NO country at all is an order from before checkout asked for one — every
  // one of those was Swedish, and they were always drafted as SE. Only a name
  // nobody can read is refused.
  if (!String(named ?? '').trim()) return 'SE';
  return strictCountryCode(named);
}

/**
 * Zendr's phone pattern is strict: +, country code, digits, nothing else. A
 * Swedish customer types "070-123 45 67", which fails it — so a national number
 * is promoted to its country's international form, and anything that still does
 * not fit is left out rather than sent to be rejected.
 */
export function toE164(phone: unknown, countryCode: string): string | undefined {
  const raw = String(phone ?? '').trim();
  if (!raw) return undefined;

  // Every country the owner is likely to add. A national number from a country
  // NOT here is left out rather than given +46: a Dutch "06 1234 5678" became a
  // valid-looking Swedish number on the carrier's label.
  const dialling: Record<string, string> = {
    SE: '46', NO: '47', DK: '45', FI: '358', AX: '358', IS: '354', DE: '49', NL: '31', BE: '32', LU: '352',
    FR: '33', ES: '34', PT: '351', IT: '39', AT: '43', CH: '41', LI: '423', GB: '44', IE: '353', PL: '48',
    CZ: '420', SK: '421', HU: '36', SI: '386', HR: '385', RO: '40', BG: '359', GR: '30', CY: '357', MT: '356',
    EE: '372', LV: '371', LT: '370', US: '1', CA: '1',
  };
  let digits = raw.replace(/[^\d+]/g, '');

  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (!digits.startsWith('+')) {
    const code = dialling[countryCode];
    if (!code) return undefined;
    digits = `+${code}${digits.replace(/^0+/, '')}`;
  }
  digits = `+${digits.slice(1).replace(/\D/g, '')}`;
  return /^\+[1-9]\d{1,14}$/.test(digits) ? digits : undefined;
}

/** Zendr caps most free-text fields at 35 characters and rejects longer ones. */
function cap(value: unknown, max = 35): string | undefined {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : undefined;
}

/**
 * The shop's own address, which every draft ships FROM.
 *
 * It lives in the environment rather than in site settings because the settings
 * document holds one free-text line ("companyAddress") and Zendr needs the
 * street, the postcode and the town apart from each other.
 */
export function senderFromEnv(): ZendrParty | null {
  const line1 = (process.env.ZENDR_SENDER_ADDRESS1 ?? '').trim();
  const postalCode = (process.env.ZENDR_SENDER_POSTAL_CODE ?? '').trim();
  const postalTown = (process.env.ZENDR_SENDER_POSTAL_TOWN ?? '').trim();
  // Without a real from-address the draft would be created and then be
  // unbookable, which is worse than not creating it.
  if (!line1 || !postalCode || !postalTown) return null;

  const countryCode = countryCodeOf(process.env.ZENDR_SENDER_COUNTRY ?? 'SE');
  return {
    type: 'business',
    contact: {
      name: cap(process.env.ZENDR_SENDER_NAME ?? 'ReklamX'),
      company: cap(process.env.ZENDR_SENDER_COMPANY ?? 'ReklamX'),
      email: cap(process.env.ZENDR_SENDER_EMAIL, 100),
      phoneNumber: toE164(process.env.ZENDR_SENDER_PHONE, countryCode),
    },
    address: {
      addressLine1: cap(line1),
      postalCode,
      postalTown: cap(postalTown),
      countryCode,
    },
  };
}

/** Parcel defaults, overridable per shop: "LxWxH,kg" in centimetres/kilograms. */
function defaultPackage(description: string): ZendrPackage {
  const spec = (process.env.ZENDR_DEFAULT_PACKAGE ?? '40x30x20,5').toLowerCase();
  const m = /^(\d+)x(\d+)x(\d+),(\d+)$/.exec(spec.replace(/\s/g, ''));
  return {
    type: 'package',
    length: m ? Number(m[1]) : 40,
    width: m ? Number(m[2]) : 30,
    height: m ? Number(m[3]) : 20,
    weight: m ? Number(m[4]) : 5,
    count: 1,
    stackable: true,
    description,
  };
}

/**
 * A draft carries the addresses, the parcel and the order number. Dimensions and
 * weight are the shop's defaults: printed goods are made to order and nothing in
 * the catalogue records a weight, so the staff member who books the shipment
 * adjusts the parcel in the portal. Sending a plausible parcel beats sending
 * none — an empty draft cannot be booked at all.
 */
export function draftFromOrder(order: any, sender: ZendrParty): ZendrDraft {
  const details = order?.customerDetails ?? {};
  // The address the packing slip and the job sheet print (src/lib/deliveryAddress.ts)
  // — one rule. This read the separate address with its own `?? billing` rule, so
  // a ticked-but-blank form sent blank lines to the carrier while the slip in
  // the box showed the billing address.
  const dest = deliveryAddressOf(order);
  const countryCode = receiverCountryCodeOf(order);
  if (!countryCode) {
    throw new Error(`The delivery country "${dest.country || '?'}" is not one this shop can hand to Zendr — make this draft by hand in the Zendr portal.`);
  }
  const company = dest.company || undefined;
  const name = dest.name || order?.customerName || 'Customer';

  const lines: any[] = Array.isArray(order?.items) ? order.items : [];
  const contents =
    lines
      .map((i) => `${i.quantity ?? 1} x ${i.productName ?? 'Print'}`)
      .join(', ')
      .slice(0, 200) || 'Printed goods';

  return {
    // Zendr keys the draft on OUR order number, which is what makes tracking
    // answerable later and what a repeat call would collide with.
    orderId: String(order?.id ?? ''),
    sender,
    receiver: {
      type: company ? 'business' : 'private',
      contact: {
        name: cap(name)!,
        company: cap(company),
        email: cap(details.email ?? order?.customerEmail, 100),
        // The phone is the CUSTOMER's, typed with the billing details — its
        // country code comes from the billing country, not from where the
        // parcel goes. (Billing Sverige, ship to Danmark: "070-…" is +46, not +45.)
        // The billing country's code as the order recorded it (from the owner's
        // own list, so a country he added counts), else read from the name.
        phoneNumber: toE164(details.phone, String(order?.buyerCountryCode ?? '') || strictCountryCode(details.country) || ''),
        vatNumber: cap(details.taxId, 15),
      },
      address: {
        addressLine1: cap(dest.address1),
        // The separate delivery form has no second line (deliveryAddressOf
        // keeps it empty); the billing one belongs to a different address.
        addressLine2: cap(dest.address2),
        postalCode: dest.postcode,
        postalTown: cap(dest.city),
        countryCode,
      },
    },
    packages: [defaultPackage(contents)],
    information: {
      reference: `ReklamX ${order?.id ?? ''}`.trim(),
      // The service the customer paid for travels with the draft, because the
      // person booking it in the portal has to pick a carrier and a speed and
      // would otherwise have to go and look the order up.
      description: order?.shippingMethodTitle
        ? `${contents} — ${order.shippingMethodTitle}`.slice(0, 250)
        : contents,
    },
  };
}

/** Pickup is not a shipment; nothing is sent to a carrier. */
export function orderShips(order: any): boolean {
  const method = String(order?.shippingMethod ?? '');
  return method !== '' && method !== 'pickup';
}
