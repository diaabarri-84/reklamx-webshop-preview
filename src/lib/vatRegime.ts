// Which VAT treatment applies to an order, and why.
//
// He wrote "مطلوب محاسبياً في السويد". The shop has one global rate today and no
// idea who it is selling to, so every invoice it has ever issued charges Swedish
// VAT — which is right for most of them and wrong for two cases that a Swedish
// print shop meets in ordinary trade: a business in another EU country with a
// VAT number (reverse charge), and a customer outside the EU (export).
//
// ────────────────────────────────────────────────────────────────────────────
// THE RULE THIS FILE IS BUILT ON: NEVER ZERO-RATE ON A GUESS.
//
// Charging VAT that was not due is an inconvenience — the customer asks and it
// is corrected. NOT charging VAT that WAS due is money the shop owes Skatteverket
// out of its own pocket, discovered at an audit, with interest. So every path to
// a 0% rate below requires every one of its conditions to be positively met, and
// anything unclear falls back to the standard domestic rate.
//
// ────────────────────────────────────────────────────────────────────────────
// WHAT THIS FILE DOES **NOT** DO, and the owner has to decide about:
//
// A VAT number is checked for SHAPE only — the right prefix, the right length,
// the right characters for that country. It is NOT checked against VIES, the
// EU's own register, which is the only thing that proves the number belongs to a
// real, currently-registered business. A well-formed invented number passes here.
//
// Under Swedish practice the seller is expected to verify the number and keep
// evidence; if it turns out to be invalid, the VAT is the SELLER's to pay. So
// `requiresVerification` is set on every reverse-charge decision — the order
// carries it, and it is a flag for a human, not a technicality.

export type VatRegime =
  /** Sweden. Standard rate, whoever is buying. */
  | 'domestic'
  /** Another EU country, private buyer. Swedish VAT under the OSS threshold. */
  | 'eu_b2c'
  /** Another EU country, business with a VAT number. 0%, reverse charge. */
  | 'eu_b2b_reverse'
  /** Outside the EU. 0%, export. */
  | 'export';

export interface VatDecision {
  regime: VatRegime;
  /** The rate to charge, as a fraction. 0 for reverse charge and export. */
  rate: number;
  /** True when the 0% depends on a VAT number nobody has verified against VIES. */
  requiresVerification: boolean;
  /**
   * The sentence the invoice must carry. Swedish law requires a reverse-charge
   * invoice to say so; an invoice that simply shows 0% and no explanation is not
   * a valid one.
   */
  invoiceNote: string | null;
  /** Why this regime, in one line, frozen onto the order for the audit trail. */
  reason: string;
}

/** The 27, by ISO-3166-1 alpha-2. GB is deliberately absent. */
export const EU_COUNTRIES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
] as const;

/**
 * The VAT-number shape each member state issues, after the two-letter prefix.
 *
 * From the EU's own published formats. Shape only — see the note at the top.
 */
const VAT_FORMATS: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^0\d{9}$/,
  BG: /^\d{9,10}$/,
  HR: /^\d{11}$/,
  CY: /^\d{8}[A-Z]$/,
  CZ: /^\d{8,10}$/,
  DK: /^\d{8}$/,
  EE: /^\d{9}$/,
  FI: /^\d{8}$/,
  FR: /^[A-Z0-9]{2}\d{9}$/,
  DE: /^\d{9}$/,
  GR: /^\d{9}$/,
  HU: /^\d{8}$/,
  IE: /^(\d{7}[A-W]{1,2}|\d[A-Z+*]\d{5}[A-W])$/,
  IT: /^\d{11}$/,
  LV: /^\d{11}$/,
  LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/,
  MT: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  RO: /^\d{2,10}$/,
  SK: /^\d{10}$/,
  SI: /^\d{8}$/,
  ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
  SE: /^\d{12}$/,
};

/** Free text a human typed, to an ISO code. Returns null when it is not certain. */
const COUNTRY_NAMES: Record<string, string> = {
  sverige: 'SE', sweden: 'SE', se: 'SE', schweden: 'SE',
  danmark: 'DK', denmark: 'DK', dk: 'DK',
  norge: 'NO', norway: 'NO', no: 'NO',
  finland: 'FI', suomi: 'FI', fi: 'FI',
  tyskland: 'DE', germany: 'DE', deutschland: 'DE', de: 'DE',
  nederländerna: 'NL', netherlands: 'NL', nederland: 'NL', nl: 'NL',
  frankrike: 'FR', france: 'FR', fr: 'FR',
  polen: 'PL', poland: 'PL', polska: 'PL', pl: 'PL',
  spanien: 'ES', spain: 'ES', españa: 'ES', es: 'ES',
  italien: 'IT', italy: 'IT', italia: 'IT', it: 'IT',
  belgien: 'BE', belgium: 'BE', be: 'BE',
  österrike: 'AT', austria: 'AT', at: 'AT',
  irland: 'IE', ireland: 'IE', ie: 'IE',
  estland: 'EE', estonia: 'EE', ee: 'EE',
  lettland: 'LV', latvia: 'LV', lv: 'LV',
  litauen: 'LT', lithuania: 'LT', lt: 'LT',
  storbritannien: 'GB', 'united kingdom': 'GB', uk: 'GB', gb: 'GB', england: 'GB',
  usa: 'US', 'united states': 'US', us: 'US',
  schweiz: 'CH', switzerland: 'CH', ch: 'CH',
};

export function toCountryCode(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  // Already a code — but only if it is one we recognise, so a typo like "SX"
  // does not become a country and quietly qualify an order as an export.
  // Own keys only: COUNTRY_NAMES is a plain object, so '__proto__' or
  // 'constructor' as a "country" used to come back as Object.prototype — truthy,
  // not a code — and decideVatRegime read it as a non-EU country: export, 0%.
  const lookup = (key: string): string | null => (Object.hasOwn(COUNTRY_NAMES, key) ? COUNTRY_NAMES[key] : null);
  if (/^[A-Z]{2}$/.test(upper)) {
    if ((EU_COUNTRIES as readonly string[]).includes(upper)) return upper;
    return lookup(text.toLowerCase());
  }
  return lookup(text.toLowerCase().replace(/\s+/g, ' '));
}

/** Prefix and shape only. See the note at the top of this file. */
export function vatNumberLooksValid(raw: unknown, countryCode?: string | null): boolean {
  const cleaned = String(raw ?? '').toUpperCase().replace(/[\s.\-]/g, '');
  const m = cleaned.match(/^([A-Z]{2})(.+)$/);
  if (!m) return false;
  const [, prefix, rest] = m;
  const format = VAT_FORMATS[prefix];
  if (!format) return false;
  // The number must belong to the country being invoiced. A German number on a
  // French address is either a mistake or an attempt, and neither is a reason to
  // stop charging VAT.
  if (countryCode && prefix !== countryCode) return false;
  return format.test(rest);
}

export function normaliseVatNumber(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[\s.\-]/g, '');
}

export interface VatInput {
  /** The BILLING country, free text or a code. */
  country?: unknown;
  /** 'company' when the buyer says they are a business. */
  buyerType?: unknown;
  /** The EU VAT number, as typed. */
  vatNumber?: unknown;
  /** The shop's standard rate as a fraction, e.g. 0.25. */
  standardRate: number;
}

/**
 * Decide, conservatively.
 *
 * The order of these tests is the order of certainty: everything that is not
 * positively known to qualify for 0% ends up paying the standard rate.
 */
export function decideVatRegime(input: VatInput): VatDecision {
  const standardRate = Number.isFinite(input.standardRate) && input.standardRate >= 0
    ? input.standardRate
    : 0.25;
  const code = toCountryCode(input.country);
  const isCompany = String(input.buyerType ?? '').toLowerCase() === 'company';
  const vat = normaliseVatNumber(input.vatNumber);

  // A country we could not read is treated as Sweden. It is the shop's home
  // rate, it is the safe one, and the alternative — guessing "export" from an
  // address we did not understand — is the expensive mistake.
  if (!code || code === 'SE') {
    return {
      regime: 'domestic',
      rate: standardRate,
      requiresVerification: false,
      invoiceNote: null,
      reason: code === 'SE' ? 'Swedish buyer' : 'Country not recognised — charged as domestic',
    };
  }

  const inEu = (EU_COUNTRIES as readonly string[]).includes(code);

  if (!inEu) {
    return {
      regime: 'export',
      rate: 0,
      requiresVerification: false,
      invoiceNote: 'Export, outside the EU. VAT not charged (0%).',
      reason: `Buyer in ${code}, outside the EU`,
    };
  }

  // EU, and a business that has given a VAT number that matches its country.
  if (isCompany && vat && vatNumberLooksValid(vat, code)) {
    return {
      regime: 'eu_b2b_reverse',
      rate: 0,
      // The 0% rests on a number nobody has checked against VIES. Under Swedish
      // practice an unverified number that turns out to be invalid leaves the
      // VAT with the SELLER.
      requiresVerification: true,
      invoiceNote: 'Reverse charge — Omvänd betalningsskyldighet. Article 196, Council Directive 2006/112/EC.',
      reason: `EU business in ${code} with VAT number ${vat}`,
    };
  }

  // EU, everyone else: a consumer, or a business whose number is missing or does
  // not look like one. Swedish VAT, and the reason says which it was so the
  // owner can chase a number rather than wonder.
  return {
    regime: 'eu_b2c',
    rate: standardRate,
    requiresVerification: false,
    invoiceNote: null,
    reason: isCompany
      ? (vat
        ? `EU business in ${code}, VAT number not in a valid format — charged Swedish VAT`
        : `EU business in ${code} with no VAT number — charged Swedish VAT`)
      : `Private buyer in ${code}`,
  };
}
