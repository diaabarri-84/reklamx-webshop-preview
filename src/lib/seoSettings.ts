// Everything about Google that the owner sets himself, in one shape.
//
// WHY THIS FILE EXISTS
// The shop's head, its robots.txt, its sitemap and its Merchant Center feed were
// all written in code: the titles lived in a const in server-seo.ts, the robots
// rules in an array beside them, and changing a single sentence meant an edit, a
// build and a deploy. The owner asked — repeatedly, and finally in as many words
// — to "make me the fields in the dashboard and I'll fill them in myself". So
// every one of those strings now has a home in settings/siteConfig, and this
// module is the shape both sides agree on.
//
// IT IS IMPORTED BY THE SERVER. Keep it free of React, of `window`, and of
// anything that only exists in a browser — server-seo.ts pulls it in through
// esbuild, and a stray DOM reference here becomes a crash on boot.
//
// NOTHING HERE IS A SECRET. Ids, verification tokens and feed settings are all
// visible in the page source of any site that runs them; they are settings, not
// credentials, and they must never go near the server's secret store.

/** The four shop languages. Structurally the same as LocalizedText in src/types. */
export type SeoText = Partial<Record<'en' | 'sv' | 'da' | 'no', string>>;

export type SeoLang = 'en' | 'sv' | 'da' | 'no';

export const SEO_LANGS: { code: SeoLang; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'sv', label: 'Svenska', flag: '🇸🇪' },
  { code: 'da', label: 'Dansk', flag: '🇩🇰' },
  { code: 'no', label: 'Norsk', flag: '🇳🇴' },
];

/**
 * Pick the right string out of a four-language map.
 *
 * Falls back to English and then to the supplied default, because a half-filled
 * translation table must never produce an empty <title> — an empty title is
 * worse in a search result than an English one.
 */
export function seoText(map: SeoText | undefined, lang: SeoLang, fallback = ''): string {
  const wanted = (map?.[lang] ?? '').trim();
  if (wanted) return wanted;
  const english = (map?.en ?? '').trim();
  if (english) return english;
  return fallback;
}

/** True when at least one language of a map carries text. */
export function seoTextFilled(map: SeoText | undefined): number {
  return SEO_LANGS.filter(({ code }) => (map?.[code] ?? '').trim().length > 0).length;
}

// ------------------------------------------------------------------- pages

/** One editable page. Everything is optional: blank means "use the built-in". */
export interface SeoPageSettings {
  title?: SeoText;
  description?: SeoText;
  /** Keep the page out of Google entirely. */
  noindex?: boolean;
  /** Keep it out of the sitemap without hiding it from Google. */
  excludeFromSitemap?: boolean;
  /** Sitemap hints. Strings, because that is what the XML wants. */
  priority?: string;
  changefreq?: string;
}

/**
 * The pages the dashboard offers a form for.
 *
 * The path is the key in `seo.pages`, and it is also the sitemap entry — so this
 * list and STATIC_ROUTES in server-seo.ts describe the same nine addresses. The
 * defaults here are the strings that used to be hard-coded in PAGE_META, moved
 * out so the screen can show the owner what he is overriding.
 */
/** The sentence used wherever a page has nothing of its own to say. */
export const SITE_DESCRIPTION =
  'Swedish web-to-print shop. Order business cards, stickers, banners, signs and branded merchandise online — upload your own artwork or design it in your browser.';

export interface SeoPageDefinition {
  path: string;
  label: string;
  priority: string;
  changefreq: string;
  /** What the shop says today. Shown in the dashboard as the placeholder. */
  title: string;
  description: string;
}

export const SEO_PAGES: SeoPageDefinition[] = [
  {
    path: '/',
    label: 'Home page',
    priority: '1.0',
    changefreq: 'weekly',
    title: 'ReklamX — Printing, signs and branded merchandise in Sweden',
    description: SITE_DESCRIPTION,
  },
  {
    path: '/products',
    label: 'All products',
    priority: '0.9',
    changefreq: 'daily',
    title: 'All products — printing, signs and packaging | ReklamX',
    description:
      'Browse everything ReklamX prints: rollups and banners, business cards, stickers and labels, packaging, signs and branded merchandise. Prices shown with and without VAT.',
  },
  {
    path: '/services',
    label: 'Services',
    priority: '0.7',
    changefreq: 'monthly',
    title: 'Our printing services | ReklamX',
    description:
      'Large format, offset and digital printing, finishing, signage and installation — what ReklamX does, and how a job runs from file to delivery.',
  },
  {
    path: '/custom-upload',
    label: 'Upload your own file',
    priority: '0.7',
    changefreq: 'monthly',
    title: 'Upload your own print file | ReklamX',
    description:
      'Send us your own artwork and we price it by the metre — banners, rolls and custom formats, with a preflight check before anything is printed.',
  },
  {
    path: '/about',
    label: 'About us',
    priority: '0.5',
    changefreq: 'monthly',
    title: 'About ReklamX | Print house in Sweden',
    description: 'Who we are, where we print, and how to reach us.',
  },
  {
    path: '/contact',
    label: 'Contact',
    priority: '0.5',
    changefreq: 'monthly',
    title: 'Contact ReklamX',
    description: 'Phone, e-mail, address and opening hours — and a form that reaches us directly.',
  },
  {
    path: '/privacy',
    label: 'Privacy policy',
    priority: '0.2',
    changefreq: 'yearly',
    title: 'Privacy policy | ReklamX',
    description: 'What ReklamX stores, why, and for how long.',
  },
  {
    path: '/terms',
    label: 'Terms & conditions',
    priority: '0.2',
    changefreq: 'yearly',
    title: 'Terms and conditions | ReklamX',
    description: 'The terms you buy under at ReklamX.',
  },
  {
    path: '/cookies',
    label: 'Cookie policy',
    priority: '0.2',
    changefreq: 'yearly',
    title: 'Cookies and browser storage | ReklamX',
    description: 'Exactly what this shop keeps in your browser, and what it never does.',
  },
];

/** The shipped wording for one path, or undefined for an address not in the list. */
export function shippedPageMeta(path: string): SeoPageDefinition | undefined {
  return SEO_PAGES.find((p) => p.path === path);
}

// -------------------------------------------------------------- verification

/**
 * Site-ownership tokens.
 *
 * Google's Domain method needs a DNS record the owner cannot add from here, and
 * that is what stalled Search Console for a fortnight. The HTML-tag method needs
 * exactly this string in the head of the home page, which the server can put
 * there — so the whole verification becomes paste-and-save.
 */
export interface SeoVerification {
  /** The content= value of Google's <meta name="google-site-verification">. */
  google?: string;
  bing?: string;
  pinterest?: string;
  facebook?: string;
  /** Anything else, as a full meta tag name/content pair. */
  otherName?: string;
  otherContent?: string;
}

/**
 * Listed rather than derived from the interface, because a save has to write
 * every one of these keys — including the ones the owner has just emptied — and
 * an object it builds from what is filled in cannot know about the rest.
 */
export const VERIFICATION_KEYS: (keyof SeoVerification)[] = [
  'google',
  'bing',
  'pinterest',
  'facebook',
  'otherName',
  'otherContent',
];

// ---------------------------------------------------------------- merchant

/** Google Shopping. Off until the owner switches it on. */
export interface MerchantSettings {
  enabled?: boolean;
  /** Fallback brand for products that do not set their own. */
  defaultBrand?: string;
  /** new | refurbished | used — Google only accepts these three. */
  defaultCondition?: 'new' | 'refurbished' | 'used';
  /** Google's own taxonomy id or path, e.g. "Business & Industrial > Signage". */
  defaultGoogleCategory?: string;
  /** ISO-2 country the shipping line is quoted for. */
  shippingCountry?: string;
  /** Flat shipping price in SEK. 0 is a legitimate answer — free delivery. */
  shippingPrice?: number;
  /** Include products whose price is 0. Off: a 0 kr item is a configuration bug. */
  includeZeroPriced?: boolean;
}

export const MERCHANT_CONDITIONS: MerchantSettings['defaultCondition'][] = ['new', 'refurbished', 'used'];

// ------------------------------------------------------------- the whole lot

export interface SeoSettings {
  /**
   * Which language the crawler's copy of the page is written in.
   *
   * The visitor's language lives in localStorage, so the SERVER cannot know it —
   * it renders one head, for everybody, before any JavaScript runs. This is the
   * language that head is written in. In a real browser react-helmet still
   * rewrites it into the visitor's own language a moment later.
   */
  defaultLang?: SeoLang;
  /**
   * Appended to every page title.
   *
   * Absent means " | <the shop's name>", which is what it has always done. A
   * stored value is used verbatim — including an empty string, which is how the
   * owner switches the suffix off entirely.
   */
  titleSuffix?: string;
  /** Used wherever a page has nothing better to say. */
  defaultDescription?: SeoText;
  /** og:image for pages with no picture of their own. Absolute URL or /path. */
  shareImageUrl?: string;
  /** @reklamx — shown on the Twitter/X card. */
  twitterSite?: string;
  verification?: SeoVerification;
  /** Keyed by path, e.g. seo.pages['/products']. */
  pages?: Record<string, SeoPageSettings>;
  /** 'auto' builds robots.txt from the rules below; 'custom' serves robotsCustom verbatim. */
  robotsMode?: 'auto' | 'custom';
  /** Extra Disallow lines, one path per entry, added to the built-in list. */
  robotsExtraDisallow?: string[];
  /** The whole file, when robotsMode is 'custom'. */
  robotsCustom?: string;
  /** Product ids kept out of the sitemap without hiding them from the shop. */
  sitemapExcludeProductIds?: string[];
  merchant?: MerchantSettings;
}

export const DEFAULT_SEO_SETTINGS: SeoSettings = {
  defaultLang: 'en',
  // Absent, not ' | ReklamX': the suffix follows whatever the shop is called.
  defaultDescription: {},
  shareImageUrl: '',
  twitterSite: '',
  verification: {},
  pages: {},
  robotsMode: 'auto',
  robotsExtraDisallow: [],
  robotsCustom: '',
  sitemapExcludeProductIds: [],
  merchant: {
    enabled: false,
    defaultBrand: '',
    defaultCondition: 'new',
    defaultGoogleCategory: '',
    shippingCountry: 'SE',
    shippingPrice: 0,
    includeZeroPriced: false,
  },
};

/**
 * One stored page, read back into the shape the rest of the code expects.
 *
 * A save writes `null` into every box the owner emptied — see pruneSeoForSave
 * for why it has to — and this is where those nulls stop. Nothing downstream
 * should ever have to ask whether an unset title is a missing key, an
 * `undefined` or a `null`; it is simply not there.
 */
function normalizeSeoPage(raw: Record<string, unknown>): SeoPageSettings {
  const page: SeoPageSettings = {};
  const title = raw.title && typeof raw.title === 'object' ? pruneSeoText(raw.title as SeoText) : undefined;
  const description =
    raw.description && typeof raw.description === 'object' ? pruneSeoText(raw.description as SeoText) : undefined;
  if (title) page.title = title;
  if (description) page.description = description;
  if (typeof raw.noindex === 'boolean') page.noindex = raw.noindex;
  if (typeof raw.excludeFromSitemap === 'boolean') page.excludeFromSitemap = raw.excludeFromSitemap;
  if (typeof raw.priority === 'string' && raw.priority.trim()) page.priority = raw.priority;
  if (typeof raw.changefreq === 'string' && raw.changefreq.trim()) page.changefreq = raw.changefreq;
  return page;
}

/**
 * Read a stored settings object into a complete one.
 *
 * Every screen and both sides of the wire go through this, so a document written
 * before a field existed behaves exactly like one that leaves it blank — and a
 * `seo` key that Firestore returns as something other than an object (it has
 * happened, through a hand-edited document) cannot take the server down.
 */
export function normalizeSeo(raw: unknown): SeoSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<SeoSettings>;
  const pages: Record<string, SeoPageSettings> = {};
  if (src.pages && typeof src.pages === 'object') {
    for (const [path, value] of Object.entries(src.pages)) {
      if (value && typeof value === 'object') pages[path] = normalizeSeoPage(value as Record<string, unknown>);
    }
  }
  const merchantSrc = (src.merchant && typeof src.merchant === 'object' ? src.merchant : {}) as MerchantSettings;
  // Rebuilt key by key rather than passed through, for the same reason the pages
  // are: a save writes a cleared token as `null`, and a reader should see an
  // absent key. Rebuilding also puts the keys in one fixed order, which is what
  // lets the dashboard tell "unsaved changes" from "the same thing in a
  // different order" — it compares the two as JSON.
  const verificationSrc = (src.verification && typeof src.verification === 'object'
    ? src.verification
    : {}) as Record<string, unknown>;
  const verification: SeoVerification = {};
  for (const key of VERIFICATION_KEYS) {
    const v = typeof verificationSrc[key] === 'string' ? (verificationSrc[key] as string).trim() : '';
    if (v) verification[key] = v;
  }
  return {
    defaultLang: (['en', 'sv', 'da', 'no'] as const).includes(src.defaultLang as SeoLang)
      ? (src.defaultLang as SeoLang)
      : 'en',
    // undefined is meaningful here — it is what selects the automatic
    // " | <site name>" — so it must survive normalisation rather than being
    // replaced by a default that hard-codes the old name.
    titleSuffix: typeof src.titleSuffix === 'string' ? src.titleSuffix : undefined,
    defaultDescription:
      (src.defaultDescription && typeof src.defaultDescription === 'object'
        ? pruneSeoText(src.defaultDescription as SeoText)
        : undefined) ?? {},
    shareImageUrl: typeof src.shareImageUrl === 'string' ? src.shareImageUrl.trim() : '',
    twitterSite: typeof src.twitterSite === 'string' ? src.twitterSite.trim() : '',
    verification,
    pages,
    robotsMode: src.robotsMode === 'custom' ? 'custom' : 'auto',
    robotsExtraDisallow: Array.isArray(src.robotsExtraDisallow)
      ? src.robotsExtraDisallow.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      : [],
    robotsCustom: typeof src.robotsCustom === 'string' ? src.robotsCustom : '',
    sitemapExcludeProductIds: Array.isArray(src.sitemapExcludeProductIds)
      ? src.sitemapExcludeProductIds.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      : [],
    merchant: {
      enabled: merchantSrc.enabled === true,
      defaultBrand: typeof merchantSrc.defaultBrand === 'string' ? merchantSrc.defaultBrand.trim() : '',
      defaultCondition: MERCHANT_CONDITIONS.includes(merchantSrc.defaultCondition)
        ? merchantSrc.defaultCondition
        : 'new',
      defaultGoogleCategory:
        typeof merchantSrc.defaultGoogleCategory === 'string' ? merchantSrc.defaultGoogleCategory.trim() : '',
      shippingCountry:
        typeof merchantSrc.shippingCountry === 'string' && merchantSrc.shippingCountry.trim()
          ? merchantSrc.shippingCountry.trim().toUpperCase().slice(0, 2)
          : 'SE',
      shippingPrice:
        typeof merchantSrc.shippingPrice === 'number' && Number.isFinite(merchantSrc.shippingPrice)
          ? Math.max(0, merchantSrc.shippingPrice)
          : 0,
      includeZeroPriced: merchantSrc.includeZeroPriced === true,
    },
  };
}

/**
 * Firestore rejects an explicit `undefined`, and an empty translation map means
 * exactly the same as no map — so a save strips both rather than storing noise
 * that the next reader has to interpret.
 */
export function pruneSeoText(map: SeoText | undefined): SeoText | undefined {
  if (!map) return undefined;
  const out: SeoText = {};
  for (const { code } of SEO_LANGS) {
    const v = (map[code] ?? '').trim();
    if (v) out[code] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * The same map, but for the WRITE path: every language assigned, `null` where
 * it is empty — 15.7.3.
 *
 * `pruneSeoText` returns only the languages that have text in them, which is
 * right for reading and wrong for saving, and the difference is invisible until
 * a language is CLEARED. settings/siteConfig is written with { merge: true },
 * and a merge recurses into nested maps: a `title` of { sv, da, no } does not
 * replace the stored title, it merges into it, so the English the owner just
 * deleted stays exactly where it was and goes on being served to Google with
 * an empty box on the screen and a success toast over it.
 *
 * The enclosing function's own comment already states this rule — "ALWAYS
 * ASSIGN, NEVER OMIT" — and this map was the one level deeper that it did not
 * reach. It became reachable THIS ROUND: before the translate button the
 * crawler-language box was usually the only one filled, so clearing it left an
 * empty map and `?? null` cleared the whole field correctly. One press of the
 * new button fills the other three, and from then on the main box cannot be
 * emptied at all.
 *
 * Returns null only when every language is empty, which clears the field
 * outright, exactly as before.
 */
export type SeoTextForSave = { [K in keyof SeoText]: string | null };

function seoTextForSave(map: SeoText | undefined): SeoTextForSave | null {
  const out = {} as SeoTextForSave;
  let any = false;
  for (const { code } of SEO_LANGS) {
    const v = (map?.[code] ?? '').trim();
    if (v) { out[code] = v; any = true; } else { out[code] = null; }
  }
  return any ? out : null;
}

/** One page as it goes to Firestore: every key present, `null` where it is empty. */
export interface SeoPageSettingsForSave {
  title: SeoTextForSave | null;
  description: SeoTextForSave | null;
  noindex: boolean;
  excludeFromSitemap: boolean;
  priority: string | null;
  changefreq: string | null;
}

/**
 * The whole document as it goes to Firestore.
 *
 * Deliberately a different type from SeoSettings: `null` is a thing the write
 * path says and the read path never has to hear, because normalizeSeo() turns
 * every one of them back into an absent key. Keeping the two shapes apart is
 * what stops the nulls leaking into server-seo.ts and the dashboard forms.
 */
export interface SeoSettingsForSave {
  defaultLang: SeoLang;
  titleSuffix: string | null;
  defaultDescription: SeoTextForSave | null;
  shareImageUrl: string;
  twitterSite: string;
  verification: Record<keyof SeoVerification, string | null>;
  pages: Record<string, SeoPageSettingsForSave>;
  robotsMode: 'auto' | 'custom';
  robotsExtraDisallow: string[];
  robotsCustom: string;
  sitemapExcludeProductIds: string[];
  merchant: MerchantSettings;
}

/**
 * Flatten the draft into the document that goes to Firestore.
 *
 * ALWAYS ASSIGN, NEVER OMIT — the same rule as the SKU field in
 * ProductsAdmin.tsx, and here for exactly the same reason. settings/siteConfig
 * is written with { merge: true }, and a merge recurses into nested maps: a key
 * left out of seo.pages['/products'] is not cleared, it is KEPT. This function
 * used to drop every falsy value, so the Google tab could set a thing and never
 * unset it — untick "keep this page out of Google", save, watch the box stay
 * unticked, and the server would go on serving `noindex, follow` to Googlebot
 * with nothing on the screen able to undo it. The same held for the sitemap
 * exclusions, the Search Console tokens and the default description.
 *
 * `null` is what clears a field; Firestore rejects an explicit `undefined`. The
 * two switches are written as plain booleans, `false` included, which reads the
 * same as absent everywhere they are used.
 */
export function pruneSeoForSave(seo: SeoSettings): SeoSettingsForSave {
  const pages: Record<string, SeoPageSettingsForSave> = {};
  for (const [path, page] of Object.entries(seo.pages || {})) {
    pages[path] = {
      // 15.7.3 — seoTextForSave, not pruneSeoText: a language the owner cleared
      // has to travel as an explicit null or the merge keeps the old text.
      title: seoTextForSave(page.title),
      description: seoTextForSave(page.description),
      noindex: page.noindex === true,
      excludeFromSitemap: page.excludeFromSitemap === true,
      priority: (page.priority || '').trim() || null,
      changefreq: (page.changefreq || '').trim() || null,
    };
  }

  const verification = {} as Record<keyof SeoVerification, string | null>;
  for (const key of VERIFICATION_KEYS) {
    verification[key] = String(seo.verification?.[key] ?? '').trim() || null;
  }

  return {
    defaultLang: seo.defaultLang || 'en',
    // The one place an empty string is not the same as nothing: '' is how the
    // owner switches the suffix off, and null is how he hands it back to the
    // automatic " | <site name>". Only the second may be a cleared key.
    titleSuffix: typeof seo.titleSuffix === 'string' ? seo.titleSuffix : null,
    defaultDescription: seoTextForSave(seo.defaultDescription),
    shareImageUrl: (seo.shareImageUrl || '').trim(),
    twitterSite: (seo.twitterSite || '').trim(),
    verification,
    pages,
    robotsMode: seo.robotsMode === 'custom' ? 'custom' : 'auto',
    // Arrays are the one thing a merge does replace wholesale, so an emptied
    // list here really does empty the stored one.
    robotsExtraDisallow: (seo.robotsExtraDisallow || []).map((s) => s.trim()).filter(Boolean),
    robotsCustom: seo.robotsCustom || '',
    sitemapExcludeProductIds: (seo.sitemapExcludeProductIds || []).filter(Boolean),
    merchant: seo.merchant || DEFAULT_SEO_SETTINGS.merchant,
  };
}

// ----------------------------------------------------------- length advice

/**
 * What Google actually shows.
 *
 * These are not hard limits — Google measures pixels, not characters — but a
 * title past ~60 and a description past ~155 are cut mid-word in the result, and
 * the owner should be able to see that before he saves, not after he wonders why
 * his sentence ends in an ellipsis.
 */
export const TITLE_LIMIT = 60;
export const DESCRIPTION_LIMIT = 155;

export function lengthTone(value: string, limit: number): 'empty' | 'good' | 'long' {
  const n = value.trim().length;
  if (n === 0) return 'empty';
  return n > limit ? 'long' : 'good';
}
