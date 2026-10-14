/**
 * SHIPPING — the owner's own prices and countries (round 16, item 2: "there is
 * no place to edit shipping prices and countries"; "he sets the shipping price
 * from the dashboard").
 *
 * Until now the fees were compiled in (PRICING_DEFAULTS.shippingFees: 99 / 169 /
 * 0) and the countries were five names typed into the checkout. They live in
 * `settings/printSettings.shipping` now — the one settings document the browser
 * already reads once per visit and the server once per quote, so this costs no
 * new reads on a project whose free read quota has run out three times.
 *
 * THE SHAPE, and why it is this small. A first design let him invent methods,
 * mark them "pickup" or "delivery", limit each to a list of countries and set
 * a free-delivery threshold. A review of it against the code found that nearly
 * every serious problem came from those extras — the worst: a method whose
 * country list he emptied would have been sold in EVERY country, because an
 * empty list meant "all". So:
 *
 *   - three fixed methods: standard, express (delivered) and pickup;
 *   - a delivered method is offered in a country ONLY where it has a price for
 *     that country — a new country starts with nothing for sale until priced;
 *   - pickup has one fee and no country;
 *   - countries: an ISO code (fixed once saved), the name written on orders
 *     (as orders always have: 'Sverige'), and an on/off switch; one is home.
 *
 * FAIL CLOSED. Anything unreadable — a negative price, NaN, an unknown country
 * code, '__proto__' — means "not offered", never 0 kr. Defaults are used ONLY
 * when the setting does not exist at all (he has never saved it), and then they
 * reproduce exactly what the shop charged before this existed.
 *
 * Pure and dependency-light: the checkout, the server and the feed all use it.
 * Tested in scripts/test-shipping.mjs.
 */

import { PRICING_DEFAULTS } from './pricing';

export type ShipLang = 'en' | 'sv' | 'da' | 'no';
export const SHIP_LANGS: readonly ShipLang[] = ['en', 'sv', 'da', 'no'];
export type Localised = Partial<Record<ShipLang, string>>;

export type ShippingMethodId = 'standard' | 'express' | 'pickup';
export const SHIPPING_METHOD_IDS: readonly ShippingMethodId[] = ['standard', 'express', 'pickup'];

export interface ShippingCountry {
  /** ISO 3166-1 alpha-2, upper case. Fixed once saved: it keys the prices. */
  code: string;
  /** What is written on the order and printed on documents — 'Sverige'. */
  name: string;
  enabled: boolean;
}

export interface ShippingMethodSettings {
  id: ShippingMethodId;
  enabled: boolean;
  name: Localised;
  /** The small line under the name at checkout ("DHL, DSV or UPS"). */
  note: Localised;
  /** standard / express: net SEK per country code. No price = not offered there. */
  prices: Record<string, number>;
  /** pickup: one net fee. null = not offered (an unreadable fee is never 0). */
  fee: number | null;
}

export interface ShippingSettings {
  /** The country checkout starts on. Dragging another to the top does NOT change it. */
  homeCountry: string;
  /** In his order. */
  countries: ShippingCountry[];
  /** Always the three methods, in his order. */
  methods: ShippingMethodSettings[];
}

/** One line of the checkout's menu: a method that is offered here, at this fee. */
export interface ShippingOption {
  id: ShippingMethodId;
  fee: number;
  name: Localised;
  note: Localised;
}

/** Every ISO 3166-1 alpha-2 code (and XK). A typo like "UK" is not a country to Google, Zendr or the tax table. */
const ISO_CODES = new Set(
  ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
    'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
    'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
    'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO ' +
    'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
    'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
    'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' '),
);
export function isIsoCountry(code: unknown): boolean {
  return typeof code === 'string' && ISO_CODES.has(code);
}

/** What the shop sold before this existed — the five countries checkout listed, at the compiled fees. */
export const DEFAULT_SHIPPING_COUNTRIES: ShippingCountry[] = [
  { code: 'SE', name: 'Sverige', enabled: true },
  { code: 'NO', name: 'Norge', enabled: true },
  { code: 'DK', name: 'Danmark', enabled: true },
  { code: 'FI', name: 'Finland', enabled: true },
  { code: 'DE', name: 'Deutschland', enabled: true },
];

/** The names checkout showed (translations.ts), so nothing changes on screen until he edits them. */
const DEFAULT_NAMES: Record<ShippingMethodId, { name: Localised; note: Localised }> = {
  standard: {
    name: { en: 'Standard delivery', sv: 'Standardleverans', da: 'Standardlevering', no: 'Standardlevering' },
    note: { en: 'DHL, DSV or UPS', sv: 'DHL, DSV eller UPS', da: 'DHL, DSV eller UPS', no: 'DHL, DSV eller UPS' },
  },
  express: {
    name: { en: 'Express delivery', sv: 'Expressleverans', da: 'Expresslevering', no: 'Ekspresslevering' },
    note: { en: 'DHL, DSV or UPS', sv: 'DHL, DSV eller UPS', da: 'DHL, DSV eller UPS', no: 'DHL, DSV eller UPS' },
  },
  pickup: {
    name: { en: 'Pickup', sv: 'Avhämtning', da: 'Afhentning', no: 'Henting' },
    note: { en: 'Self collection at print hub', sv: 'Hämta själv hos tryckeriet', da: 'Afhent selv hos trykkeriet', no: 'Hent selv hos trykkeriet' },
  },
};

/**
 * The titles orders have always been stored under, kept for an unrenamed
 * method so invoices, e-mails and Zendr descriptions read exactly as before.
 */
const LEGACY_TITLES: Record<ShippingMethodId, string> = {
  standard: 'Standard delivery (DHL / DSV / UPS)',
  express: 'Express delivery (DHL / DSV / UPS)',
  pickup: 'Pick up at the print shop',
};

const everyDefaultCountry = (fee: number) =>
  Object.fromEntries(DEFAULT_SHIPPING_COUNTRIES.map((c) => [c.code, fee]));

export const DEFAULT_SHIPPING: ShippingSettings = {
  homeCountry: 'SE',
  countries: DEFAULT_SHIPPING_COUNTRIES,
  methods: [
    { id: 'standard', enabled: true, ...DEFAULT_NAMES.standard, prices: everyDefaultCountry(PRICING_DEFAULTS.shippingFees.standard), fee: null },
    { id: 'express', enabled: true, ...DEFAULT_NAMES.express, prices: everyDefaultCountry(PRICING_DEFAULTS.shippingFees.express), fee: null },
    { id: 'pickup', enabled: true, ...DEFAULT_NAMES.pickup, prices: {}, fee: PRICING_DEFAULTS.shippingFees.pickup },
  ],
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A price, or null: finite, not negative, at most a million, in öre. Never
 * "0 because it was unreadable". Typed text takes a comma or a point for the
 * decimals and spaces for thousands; one separator followed by exactly three
 * digits ("1.000", "1,000") is refused as ambiguous — a Dane means a thousand,
 * the parser would have read one krona.
 */
export function cleanPrice(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const text = v.replace(/[\s\u00a0]/g, '');
    if (!text) return null;
    const separators = text.match(/[.,]/g) ?? [];
    if (separators.length > 1) return null;
    if (separators.length === 1 && /[.,]\d{3}$/.test(text)) return null;
    n = /^\d+([.,]\d+)?$/.test(text) ? Number(text.replace(',', '.')) : NaN;
  } else return null;
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return Math.round(n * 100) / 100;
}

function cleanText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function cleanLocalised(v: unknown, max: number): Localised {
  const out: Localised = {};
  if (!isObject(v)) return out;
  for (const lang of SHIP_LANGS) {
    if (!Object.hasOwn(v, lang)) continue;
    const text = cleanText(v[lang], max);
    if (text) out[lang] = text;
  }
  return out;
}

/**
 * The stored setting → something every caller can trust.
 *
 * `undefined`/`null` (never saved) → the defaults. Anything else is read entry by
 * entry, and an entry that cannot be read is dropped — it is not replaced with a
 * default, because a default price is a real price somebody would be charged.
 */
export function normaliseShipping(raw: unknown): ShippingSettings {
  // A copy: a caller that edits what it was given must not edit the defaults
  // every other request in this process will be handed.
  if (raw === undefined || raw === null) return JSON.parse(JSON.stringify(DEFAULT_SHIPPING)) as ShippingSettings;
  const src = isObject(raw) ? raw : {};

  const countries: ShippingCountry[] = [];
  const seenCodes = new Set<string>();
  const seenNames = new Set<string>();
  for (const c of Array.isArray(src.countries) ? src.countries : []) {
    if (!isObject(c)) continue;
    const code = cleanText(c.code, 2).toUpperCase();
    const name = cleanText(c.name, 60);
    if (!isIsoCountry(code) || !name || seenCodes.has(code) || seenNames.has(name.toLowerCase())) continue;
    seenCodes.add(code);
    seenNames.add(name.toLowerCase());
    countries.push({ code, name, enabled: c.enabled !== false });
  }

  const enabledCodes = countries.filter((c) => c.enabled).map((c) => c.code);
  const home = cleanText(src.homeCountry, 2).toUpperCase();
  const homeCountry = enabledCodes.includes(home) ? home : (enabledCodes[0] ?? '');

  const methods: ShippingMethodSettings[] = [];
  const rawMethods = Array.isArray(src.methods) ? src.methods : [];
  for (const m of rawMethods) {
    if (!isObject(m)) continue;
    const id = m.id as ShippingMethodId;
    if (!SHIPPING_METHOD_IDS.includes(id) || methods.some((x) => x.id === id)) continue;
    const prices: Record<string, number> = {};
    if (id !== 'pickup' && isObject(m.prices)) {
      for (const code of Object.keys(m.prices)) {
        // Own keys only, real country codes only, and only countries he has.
        if (!seenCodes.has(code)) continue;
        const price = cleanPrice(m.prices[code]);
        if (price !== null) prices[code] = price;
      }
    }
    methods.push({
      id,
      enabled: m.enabled === true,
      name: cleanLocalised(m.name, 80),
      note: cleanLocalised(m.note, 120),
      prices,
      fee: id === 'pickup' ? cleanPrice(m.fee) : null,
    });
  }
  // Always all three, so the screens have three rows to show. One that is
  // missing from what he saved is OFF, not on at a default price.
  for (const id of SHIPPING_METHOD_IDS) {
    if (!methods.some((m) => m.id === id)) {
      methods.push({ id, enabled: false, name: {}, note: {}, prices: {}, fee: null });
    }
  }
  return { homeCountry, countries, methods };
}

/** A country he has (on or off), by its code or by the name an order carries. */
export function countryOf(settings: ShippingSettings, value: unknown): ShippingCountry | null {
  const text = cleanText(value, 60);
  if (!text) return null;
  const upper = text.toUpperCase();
  return (
    settings.countries.find((c) => c.code === upper) ??
    settings.countries.find((c) => c.name.toLowerCase() === text.toLowerCase()) ??
    null
  );
}

/** A country checkout may deliver to: one he has AND has switched on. */
export function enabledCountry(settings: ShippingSettings, code: unknown): ShippingCountry | null {
  const c = countryOf(settings, code);
  return c && c.enabled && c.code === String(code ?? '').trim().toUpperCase() ? c : null;
}

export function methodById(settings: ShippingSettings, id: unknown): ShippingMethodSettings | null {
  return settings.methods.find((m) => m.id === id) ?? null;
}

/**
 * What checkout offers a customer whose parcel goes to `countryCode`, in his
 * order. A delivered method only where it is switched on AND priced for that
 * country, and only if the country itself is switched on; pickup wherever it
 * is switched on and has a readable fee — it does not travel.
 */
export function shippingOptions(settings: ShippingSettings, countryCode: unknown): ShippingOption[] {
  const country = enabledCountry(settings, countryCode);
  const out: ShippingOption[] = [];
  for (const m of settings.methods) {
    if (!m.enabled) continue;
    if (m.id === 'pickup') {
      if (m.fee !== null) out.push({ id: m.id, fee: m.fee, name: m.name, note: m.note });
      continue;
    }
    if (!country || !Object.hasOwn(m.prices, country.code)) continue;
    const fee = cleanPrice(m.prices[country.code]);
    if (fee !== null) out.push({ id: m.id, fee, name: m.name, note: m.note });
  }
  return out;
}

/** The fee for one method to one country, or null when it is not offered there. */
export function feeFor(settings: ShippingSettings, methodId: unknown, countryCode: unknown): number | null {
  return shippingOptions(settings, countryCode).find((o) => o.id === methodId)?.fee ?? null;
}

const pick = (text: Localised, lang: string): string =>
  (SHIP_LANGS.includes(lang as ShipLang) ? text[lang as ShipLang] : undefined) || text.en || '';

/** The method's name in the shopper's language — his words, else the English, else what checkout always said. */
export function methodName(m: Pick<ShippingMethodSettings, 'id' | 'name'>, lang: string): string {
  return pick(m.name, lang) || pick(DEFAULT_NAMES[m.id]?.name ?? {}, lang) || m.id;
}
export function methodNote(m: Pick<ShippingMethodSettings, 'note'>, lang: string): string {
  return pick(m.note, lang);
}

/**
 * The title an order is stored under. An unrenamed method keeps the title orders
 * have always carried, so invoices and e-mails do not change by themselves the
 * day this ships.
 */
export function orderTitleOf(m: Pick<ShippingMethodSettings, 'id' | 'name'>): string {
  const en = (m.name.en ?? '').trim();
  if (!en || en === DEFAULT_NAMES[m.id]?.name.en) return LEGACY_TITLES[m.id];
  return en;
}

/** A country's name in the shopper's language (the browser's own list), else the name he typed. */
export function countryLabel(c: ShippingCountry, lang: string): string {
  try {
    const display = new Intl.DisplayNames([lang === 'no' ? 'nb' : lang], { type: 'region' }).of(c.code);
    if (display && display !== c.code) return display;
  } catch {
    /* an old browser without Intl.DisplayNames — the stored name is fine */
  }
  return c.name;
}

/**
 * Google Shopping's shipping lines: one per country he delivers to, at the
 * cheapest delivered method there, INCLUDING VAT (Google shows consumer prices).
 * Pickup is not shipping. A country with no delivery price is left out rather
 * than advertised as free.
 */
export function feedShippingLines(settings: ShippingSettings, vatRate: number): Array<{ country: string; price: string }> {
  const rate = Number.isFinite(vatRate) && vatRate >= 0 && vatRate < 1 ? vatRate : 0.25;
  const lines: Array<{ country: string; price: string }> = [];
  for (const c of settings.countries) {
    if (!c.enabled) continue;
    const fees = shippingOptions(settings, c.code).filter((o) => o.id !== 'pickup').map((o) => o.fee);
    if (fees.length === 0) continue;
    lines.push({ country: c.code, price: (Math.round(Math.min(...fees) * (1 + rate) * 100) / 100).toFixed(2) });
  }
  return lines;
}

/**
 * Why a setting cannot be saved, as translation keys — the admin screen refuses
 * to write any of these. Normalising would quietly drop the bad entry; the
 * owner should be told instead.
 */
export function shippingSaveProblems(raw: ShippingSettings): string[] {
  const problems = new Set<string>();
  const codes = new Set<string>();
  const names = new Set<string>();
  for (const c of raw.countries) {
    const code = String(c.code ?? '').trim().toUpperCase();
    if (!isIsoCountry(code)) problems.add('shipErrCountryCode');
    if (codes.has(code)) problems.add('shipErrCountryDuplicate');
    codes.add(code);
    // Compared exactly as normaliseShipping will read it (spaces collapsed, at
    // most 60 characters) — "A B" and "A  B" passed this check and then the
    // second country, with its prices, was silently dropped on reading.
    const name = cleanText(c.name, 60).toLowerCase();
    if (!name) problems.add('shipErrCountryName');
    if (name && names.has(name)) problems.add('shipErrCountryDuplicate');
    names.add(name);
  }
  // A NAME that is another country's CODE: orders are matched by code first, so
  // a "DE" typed as Denmark's name would have been priced as Germany.
  for (const c of raw.countries) {
    const asCode = cleanText(c.name, 60).toUpperCase();
    if (codes.has(asCode) && asCode !== String(c.code ?? '').trim().toUpperCase()) problems.add('shipErrCountryDuplicate');
  }
  if (!raw.countries.some((c) => c.enabled)) problems.add('shipErrNoCountry');
  if (!raw.countries.some((c) => c.enabled && c.code === raw.homeCountry)) problems.add('shipErrHome');
  for (const m of raw.methods) {
    if (!String(m.name.en ?? '').trim()) problems.add('shipErrNameEn');
    if (m.id === 'pickup') {
      if (m.enabled && cleanPrice(m.fee) === null) problems.add('shipErrPrice');
    } else {
      for (const v of Object.values(m.prices ?? {})) if (cleanPrice(v) === null) problems.add('shipErrPrice');
    }
  }
  const sellable = normaliseShipping(raw);
  if (!sellable.countries.some((c) => shippingOptions(sellable, c.code).length > 0)) problems.add('shipErrNothingSold');
  return [...problems];
}
