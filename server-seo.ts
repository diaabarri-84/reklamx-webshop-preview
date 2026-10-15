// What a crawler sees.
//
// THE PROBLEM THIS SOLVES
// The shop is a client-rendered Vite SPA: the server answers every address with
// the same `dist/index.html`, and react-helmet-async only writes the real title
// and description once React has mounted. Google runs JavaScript eventually,
// but Bing, Facebook, LinkedIn, WhatsApp, Slack and every price comparison
// crawler do not — and even Google's first pass indexes the raw HTML. So every
// page of this shop, product pages included, presented itself to the outside
// world as one generic document with one title.
//
// This module rewrites the head of that shell per request: a real title, a real
// description, a canonical address, share tags, and — on a product page — the
// structured data that lets Google show the price and availability in the
// result. It also serves robots.txt and a sitemap that rebuilds itself from the
// catalogue.
//
// EVERY FIRESTORE READ HERE IS CACHED. This shop has already been dark for
// seven hours once because the free-tier read quota ran out; a sitemap that
// re-read the catalogue for every crawler hit would be a fine way to do it
// again.

import fs from 'fs';
import { PRICING_DEFAULTS } from './src/lib/pricing.js';
import path from 'path';
import type { Firestore } from 'firebase-admin/firestore';
import { productSlug } from './src/lib/slug.js';
// The storefront's own picker — 15.7.1. The head was built from `product.name`
// alone, so the per-language names rounds 13 and 14 added reached the browser
// and never reached Google: a fully translated product still came up in English
// in a Swedish search result, and the Swedish visitor read English until React
// hydrated and ProductPage re-titled the tab behind their back. Importing the
// shop's function rather than writing a second fallback rule here is the point:
// two rules drift, and the one that drifts is the one nobody is looking at.
import { localized } from './src/lib/localizedText.js';
import type { LocalizedText } from './src/types/index.js';
import {
  DEFAULT_SEO_SETTINGS,
  normalizeSeo,
  seoText,
  SEO_PAGES,
  SITE_DESCRIPTION,
  type SeoLang,
  type SeoSettings,
} from './src/lib/seoSettings.js';

// ---------------------------------------------------------------- utilities

/** HTML-escape a value that is going into an attribute or a text node. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Product descriptions are written in the dashboard's rich-text box, so they
 * arrive as HTML. A meta description must be plain text, one line, and about
 * 155 characters — longer is simply truncated by Google, mid-word.
 */
export function plainSummary(html: string | undefined, limit = 155): string {
  const text = String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

// ------------------------------------------------------------ the catalogue

export interface SeoProduct {
  id: string;
  /**
   * The CANONICAL name, and it stays canonical here.
   *
   * It is what productSlug() builds the address from and what findProduct()
   * matches an incoming address against, so a translated string must never be
   * written over it: the Swedish name would produce a Swedish slug, the sitemap
   * would advertise an address the router cannot resolve, and every existing
   * link into the shop would 404. Translation happens at the moment the name is
   * printed into the head, and nowhere else.
   */
  name: string;
  /** Per-language name, from round 13. `null` is a cleared map. See `localized`. */
  nameI18n?: LocalizedText | null;
  slug?: string;
  description?: string;
  /** Per-language description. Same contract as `nameI18n`. */
  descriptionI18n?: LocalizedText | null;
  basePrice?: number;
  /** Special offer price, net SEK. See Product.salePrice. */
  salePrice?: number;
  /**
   * The product's own minimum unit price, as stored (Product.customUploadRules).
   * Only `minPrice` is kept: the shop's pricing lifts any lower price to it, and
   * Google must not be told a price under the one the page charges (ADM-14).
   */
  customUploadRules?: { minPrice?: unknown };
  images?: string[];
  categoryId?: string;
  updatedAt?: string;
  /**
   * The shop's own "take it off the storefront" flag — set by Duplicate, and by
   * the hide switch in the product form. There is no `isActive` field anywhere
   * in this codebase; filtering on one silently matched everything, which put
   * unreleased drafts and their prices in the sitemap.
   */
  isHidden?: boolean;

  // ---- what the owner writes for search engines, per product, in the form ----
  /** Overrides the <title>. Blank falls back to "<name> | <site>". */
  seoTitle?: string;
  /** Overrides the meta description. Blank falls back to the product text. */
  seoDescription?: string;
  /** Keep this one product out of Google without hiding it from the shop. */
  seoNoindex?: boolean;
  /** Keep it out of the sitemap only. */
  seoExcludeFromSitemap?: boolean;

  // ---- Google Shopping ----
  brand?: string;
  gtin?: string;
  mpn?: string;
  condition?: string;
  googleProductCategory?: string;
}

const CATALOGUE_TTL_MS = 10 * 60 * 1000;
let catalogue: { at: number; items: SeoProduct[] } | null = null;
let inFlight: Promise<SeoProduct[]> | null = null;

/**
 * THE SHOP'S OWN COPY OF ITS PRODUCTS, when the server hands one over (server.ts).
 * This module read every product again on a ten-minute clock of its own — a second
 * full read of the catalogue, every ten minutes, in every worker, on a database
 * whose free 50 000 reads a day ran out. With a source set, the shop's copy (read
 * with these fields too, kept until something changes) is the only read there is.
 */
let catalogueSource: (() => Promise<Record<string, unknown>[]>) | null = null;
let fromSource: { rows: Record<string, unknown>[]; items: SeoProduct[] } | null = null;
export function setCatalogueSource(source: () => Promise<Record<string, unknown>[]>): void {
  catalogueSource = source;
  fromSource = null;
}

/**
 * The catalogue, at most once every ten minutes however many crawlers ask.
 * Concurrent callers share one read rather than each starting their own.
 */
export async function getCatalogue(db: Firestore | null): Promise<SeoProduct[]> {
  if (catalogueSource) {
    const rows = await catalogueSource();
    // Mapped once per copy: the sitemap and every crawled page ask for it.
    if (!fromSource || fromSource.rows !== rows) {
      fromSource = { rows, items: rows.map((v) => toSeoProduct(String(v.id ?? ''), v)) };
    }
    return fromSource.items;
  }
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL_MS) return catalogue.items;
  if (!db) return catalogue?.items ?? [];
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      // A field mask, for the reason server.ts gives about PRODUCT_PRICING_FIELDS:
      // product documents carry their photos inline as base64 data: URLs, up to
      // Firestore's 1 MiB per document, and an unmasked read pulls every one of
      // them for a title and a price. Only the first image is ever used (it is
      // the share card), so only the first is kept.
      const snap = await db
        .collection('products')
        .select(
          'name', 'slug', 'description', 'basePrice', 'salePrice', 'images', 'categoryId', 'updatedAt', 'isHidden',
          // The translations — 15.7.1. A field the mask leaves out arrives
          // undefined and looks exactly like a product nobody has translated,
          // so localized() would have fallen back to English for the whole
          // catalogue and the head would have read as untranslated as it did
          // before the fix — with every test still green. Four short strings
          // each: they cost bytes, not reads.
          'nameI18n', 'descriptionI18n',
          // The owner's own search-engine text, and the Shopping attributes. Kept
          // in the mask rather than read separately: the fields are short strings
          // and adding them costs nothing, while a second query would double the
          // read count on the endpoint that answers every crawler.
          'seoTitle', 'seoDescription', 'seoNoindex', 'seoExcludeFromSitemap',
          'brand', 'gtin', 'mpn', 'condition', 'googleProductCategory',
          // The minimum price, which the advertised price may not undercut
          // (review 2026-10-11). A few numbers and flags per product — the shop's
          // own copy (server.ts) reads the same object for its cards.
          'customUploadRules',
        )
        .get();
      const items: SeoProduct[] = snap.docs.map((d) => toSeoProduct(d.id, d.data() as Record<string, unknown>));
      catalogue = { at: Date.now(), items };
      return items;
    } catch (err) {
      console.warn('SEO: could not read the catalogue —', (err as Error).message);
      // Serve the last good copy rather than an empty sitemap: an empty one
      // tells Google the shop has no products, which it then acts on.
      return catalogue?.items ?? [];
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** One product document (or the shop's copy of one) as the search engines' pages use it. */
function toSeoProduct(id: string, v: Record<string, unknown>): SeoProduct {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  /**
   * A four-language map, with anything that is not a string thrown away.
   *
   * A cleared language is stored as null on purpose (LocalizedTextFields
   * writes the null so a { merge: true } save actually deletes it), and
   * String(null) would put the literal text "null" in a <title>. Only real
   * strings are kept, and a map with nothing left in it becomes undefined
   * so localized() goes straight to the canonical value.
   */
  const i18n = (v: unknown): LocalizedText | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    const out: LocalizedText = {};
    for (const code of ['en', 'sv', 'da', 'no'] as const) {
      const text = (v as Record<string, unknown>)[code];
      if (typeof text === 'string' && text.trim() !== '') out[code] = text.trim();
    }
    return Object.keys(out).length ? out : undefined;
  };
  const images = Array.isArray(v.images)
    ? (v.images as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim() !== '').slice(0, 1)
    : [];
  return {
    id,
    name: String(v.name ?? ''),
    nameI18n: i18n(v.nameI18n),
    slug: typeof v.slug === 'string' ? v.slug : undefined,
    description: typeof v.description === 'string' ? v.description : '',
    descriptionI18n: i18n(v.descriptionI18n),
    basePrice: typeof v.basePrice === 'number' ? v.basePrice : undefined,
    salePrice: typeof v.salePrice === 'number' ? v.salePrice : undefined,
    // As stored, so floorOf reads it exactly as the pricing does — null and absent
    // alike fall back to the shop's minimum, 0 is none.
    customUploadRules:
      v.customUploadRules && typeof v.customUploadRules === 'object'
        ? { minPrice: (v.customUploadRules as { minPrice?: unknown }).minPrice }
        : undefined,
    images,
    categoryId: typeof v.categoryId === 'string' ? v.categoryId : undefined,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : undefined,
    isHidden: v.isHidden === true,
    seoTitle: str(v.seoTitle),
    seoDescription: str(v.seoDescription),
    seoNoindex: v.seoNoindex === true,
    seoExcludeFromSitemap: v.seoExcludeFromSitemap === true,
    brand: str(v.brand),
    gtin: str(v.gtin),
    mpn: str(v.mpn),
    condition: str(v.condition),
    googleProductCategory: str(v.googleProductCategory),
  };
}

/** Drop the cache — called when a product is written, so a new one is indexable at once. */
export function invalidateCatalogue(): void {
  catalogue = null;
}

// ------------------------------------------------------------------ origin

/**
 * The address this shop answers on. PUBLIC_URL wins when it is set; otherwise
 * the request's own host is used, so a staging copy links to itself rather than
 * to production.
 */
export function originFrom(req: { headers: Record<string, unknown>; protocol?: string }): string {
  const configured = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'shop.reklamx.se').split(',')[0].trim();

  // The scheme, carefully. This shop runs behind a proxy that terminates TLS
  // and speaks plain HTTP to us, so req.protocol is 'http' — and Express only
  // reports otherwise when `trust proxy` is set, which it is not here. Taking
  // it at face value would stamp http:// on every canonical link, every og:url
  // and every entry in the sitemap, which is how a site tells Google its pages
  // live at an address that immediately redirects. So: believe the proxy header
  // when there is one, assume plain HTTP only for a local address, and assume
  // https for a real hostname.
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = forwarded || (isLocal ? String(req.protocol || 'http') : 'https');
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------- robots.txt

/** Routes that must never be indexed: they are private, transactional, or both. */
const PRIVATE_PATHS = [
  '/admin',
  '/admin-dashboard',
  '/staff-dashboard',
  '/customer-dashboard',
  '/checkout',
  '/order/',
  '/editor',
  '/login',
  '/register',
  '/reset-password',
  '/api/',
];

/**
 * robots.txt, built from the owner's settings.
 *
 * 'custom' hands him the whole file. That is a real foot-gun — one stray
 * `Disallow: /` de-indexes the shop — so the dashboard warns about it, keeps the
 * generated version beside the box, and the Sitemap line is appended here even
 * to a custom file if he forgot it: a robots.txt with no sitemap is the single
 * most common way a shop stays invisible.
 */
export function buildRobots(origin: string, seo?: SeoSettings): string {
  const s = seo ?? DEFAULT_SEO_SETTINGS;
  const sitemapLine = `Sitemap: ${origin}/sitemap.xml`;

  if (s.robotsMode === 'custom' && (s.robotsCustom || '').trim()) {
    const body = s.robotsCustom!.replace(/\r\n/g, '\n').trimEnd();
    return /^sitemap:/im.test(body) ? `${body}\n` : `${body}\n\n${sitemapLine}\n`;
  }

  const extra = (s.robotsExtraDisallow || [])
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.startsWith('/') ? p : `/${p}`));

  return [
    'User-agent: *',
    'Allow: /',
    ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
    ...extra.map((p) => `Disallow: ${p}`),
    '',
    sitemapLine,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- sitemap.xml

/** The public, indexable pages that are not products. */
export const STATIC_ROUTES: Array<{ path: string; priority: string; changefreq: string }> = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/products', priority: '0.9', changefreq: 'daily' },
  { path: '/services', priority: '0.7', changefreq: 'monthly' },
  { path: '/custom-upload', priority: '0.7', changefreq: 'monthly' },
  { path: '/about', priority: '0.5', changefreq: 'monthly' },
  { path: '/contact', priority: '0.5', changefreq: 'monthly' },
  { path: '/privacy', priority: '0.2', changefreq: 'yearly' },
  { path: '/terms', priority: '0.2', changefreq: 'yearly' },
  { path: '/cookies', priority: '0.2', changefreq: 'yearly' },
];

export function buildSitemap(origin: string, products: SeoProduct[], seo?: SeoSettings): string {
  const s = seo ?? DEFAULT_SEO_SETTINGS;
  const excluded = new Set(s.sitemapExcludeProductIds || []);

  const entry = (loc: string, priority: string, changefreq: string, lastmod?: string) =>
    [
      '  <url>',
      `    <loc>${esc(origin + loc)}</loc>`,
      lastmod ? `    <lastmod>${esc(lastmod.slice(0, 10))}</lastmod>` : '',
      `    <changefreq>${changefreq}</changefreq>`,
      `    <priority>${priority}</priority>`,
      '  </url>',
    ]
      .filter(Boolean)
      .join('\n');

  const rows = [
    ...STATIC_ROUTES
      // A page the owner marked noindex must not be advertised in the sitemap
      // either: listing a page and then telling Google not to index it is the
      // contradiction that fills Search Console with "Excluded by noindex".
      .filter((r) => {
        const page = s.pages?.[r.path];
        return !page?.excludeFromSitemap && !page?.noindex;
      })
      .map((r) => {
        const page = s.pages?.[r.path];
        return entry(r.path, page?.priority || r.priority, page?.changefreq || r.changefreq);
      }),
    ...products
      .filter(
        (p) =>
          !p.isHidden &&
          !p.seoNoindex &&
          !p.seoExcludeFromSitemap &&
          !excluded.has(p.id) &&
          (p.name || p.slug),
      )
      .map((p) => entry(`/products/${productSlug(p) || p.id}`, '0.8', 'weekly', p.updatedAt)),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

// ------------------------------------------------------------- the shell

let shell: { at: number; mtimeMs: number; html: string } | null = null;

/** dist/index.html, re-read only when the file on disk changes. */
export function readShell(distPath: string): string {
  const file = path.join(distPath, 'index.html');
  const stat = fs.statSync(file);
  if (!shell || shell.mtimeMs !== stat.mtimeMs) {
    shell = { at: Date.now(), mtimeMs: stat.mtimeMs, html: fs.readFileSync(file, 'utf-8') };
  }
  return shell.html;
}

const START = '<!--seo:start-->';
const END = '<!--seo:end-->';

export interface HeadMeta {
  title: string;
  description: string;
  canonical: string;
  image: string;
  imageAlt?: string;
  type?: 'website' | 'product' | 'article';
  robots?: string;
  jsonLd?: unknown[];
  /** og:site_name. Was hard-coded to "ReklamX"; now it is whatever the shop is called. */
  siteName?: string;
  /** @handle for the Twitter/X card, when the owner set one. */
  twitterSite?: string;
  /**
   * Ownership tokens: [name, content] pairs, rendered as plain <meta> tags.
   *
   * Google's, Bing's and Pinterest's verification all work this way, and this is
   * what turns Search Console from "add a DNS record at your registrar" — the
   * step that stalled it for a fortnight — into pasting a string in the
   * dashboard.
   */
  verificationMeta?: [string, string][];
  /**
   * The language this head is written in — the owner's "Language Google is
   * shown". It sets <html lang> and og:locale, which used to be fixed at "en"
   * and "sv_SE" whatever he chose, so the two disagreed on every page.
   */
  lang?: SeoLang;
  /**
   * The HTTP status to send the page with. 404 for an address that is no page
   * of the shop's: the app still draws its own "not found" screen, but a crawler
   * is told the truth instead of a 200 (a "soft 404").
   */
  status?: number;
}

/** og:locale for each of the shop's languages. */
const OG_LOCALE: Record<SeoLang, string> = { sv: 'sv_SE', en: 'en_GB', da: 'da_DK', no: 'nb_NO' };

/** Replace the block between the markers with tags built for THIS address. */
export function injectHead(html: string, meta: HeadMeta): string {
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  // No markers (an old build, or someone editing index.html by hand): return
  // the shell untouched rather than producing a page with two titles.
  if (start === -1 || end === -1 || end < start) return html;
  // The page's language attribute follows the head's language.
  if (meta.lang) html = html.replace(/<html lang="[^"]*"/, `<html lang="${meta.lang}"`);

  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${esc(meta.canonical)}" />`,
    meta.robots ? `<meta name="robots" content="${esc(meta.robots)}" />` : '',
    // Verification first: Google fetches the home page and reads the head, and a
    // token buried after twenty other tags is a token it has been known to miss
    // when the head is truncated by a proxy.
    ...(meta.verificationMeta ?? []).map(
      ([name, content]) => `<meta name="${esc(name)}" content="${esc(content)}" />`,
    ),
    `<meta property="og:site_name" content="${esc(meta.siteName || 'ReklamX')}" />`,
    `<meta property="og:type" content="${meta.type ?? 'website'}" />`,
    `<meta property="og:url" content="${esc(meta.canonical)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:image" content="${esc(meta.image)}" />`,
    `<meta property="og:image:alt" content="${esc(meta.imageAlt || meta.title)}" />`,
    `<meta property="og:locale" content="${OG_LOCALE[meta.lang ?? 'sv'] ?? 'sv_SE'}" />`,
    ...(Object.keys(OG_LOCALE) as SeoLang[])
      .filter((l) => l !== (meta.lang ?? 'sv'))
      .map((l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}" />`),
    `<meta name="twitter:card" content="summary_large_image" />`,
    meta.twitterSite ? `<meta name="twitter:site" content="${esc(meta.twitterSite)}" />` : '',
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(meta.image)}" />`,
    ...(meta.jsonLd ?? []).map(
      (block) =>
        `<script type="application/ld+json">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`,
    ),
  ].filter(Boolean);

  return html.slice(0, start) + START + '\n    ' + tags.join('\n    ') + '\n    ' + html.slice(end);
}

// ------------------------------------------------------- per-route metadata

/**
 * Titles and descriptions for the pages that are not products.
 *
 * Built from SEO_PAGES rather than written out again here: the dashboard shows
 * the owner what he is replacing, and a placeholder that does not match what the
 * server actually serves is a lie told in a helpful voice.
 */
const PAGE_META: Record<string, { title: string; description: string }> = Object.fromEntries(
  SEO_PAGES.map((p) => [p.path, { title: p.title, description: p.description }]),
);

/** Pages that must render, but must not be indexed. */
const NOINDEX = /^\/(login|register|checkout|order|admin|admin-dashboard|staff-dashboard|customer-dashboard|editor)(\/|$)/;

export interface MetaContext {
  origin: string;
  siteName: string;
  products: SeoProduct[];
  /**
   * The shop's VAT rate as a fraction (0.25), for the structured price.
   *
   * Optional so every existing caller and test keeps working; it falls back to
   * PRICING_DEFAULTS.vatRate, the same fallback the feed uses.
   */
  vatRate?: number;
  /** Absolute URL of the share card used when a page has no picture of its own. */
  defaultImage: string;
  /**
   * The owner's own titles, descriptions and tokens. Optional so every existing
   * caller and every test keeps working with the shipped defaults.
   */
  seo?: SeoSettings;
  /**
   * The ?category= of a catalogue address. A category page is its own page, so
   * its canonical must name it — pointing every one of them at /products told
   * Google they were all the same page, and none of them was indexed.
   */
  category?: string;
}

/**
 * Every address the app draws a page for. Anything else gets the app's "not
 * found" screen — and, now, a real 404 to go with it.
 */
const APP_ROUTE =
  /^\/(?:about|admin|admin\/login|admin-dashboard|checkout|contact|cookies|custom-upload|customer-dashboard|editor|login|order\/[^/]+|privacy|products|products\/[^/]+|register|reset-password|services|staff-dashboard|terms)?\/?$/;

/**
 * Turn a possibly-relative setting into something a crawler can fetch.
 *
 * A share image entered as `/og-image.png` is correct in the dashboard and
 * useless in an og:image tag — Facebook and WhatsApp do not resolve relative
 * URLs, they simply show no picture.
 */
export function absoluteUrl(origin: string, value: string | undefined, fallback: string): string {
  const v = (value || '').trim();
  if (!v) return fallback;
  if (/^https?:\/\//i.test(v)) return v;
  return `${origin}${v.startsWith('/') ? '' : '/'}${v}`;
}

/** The [name, content] pairs for whichever ownership tokens are filled in. */
export function verificationTags(seo?: SeoSettings): [string, string][] {
  const v = seo?.verification ?? {};
  const tags: [string, string][] = [];
  if (v.google) tags.push(['google-site-verification', v.google]);
  if (v.bing) tags.push(['msvalidate.01', v.bing]);
  if (v.pinterest) tags.push(['p:domain_verify', v.pinterest]);
  if (v.facebook) tags.push(['facebook-domain-verification', v.facebook]);
  if (v.otherName && v.otherContent) tags.push([v.otherName, v.otherContent]);
  return tags;
}

/** Find the product a `/products/<something>` address refers to. */
export function findProduct(products: SeoProduct[], param: string): SeoProduct | null {
  // Express has already percent-decoded the route parameter, so decoding it a
  // second time is both wrong and dangerous: `/media/product/%25/0` arrives as
  // the single character '%', and decodeURIComponent('%') throws URIError. In
  // an async route with no catch that becomes an unhandled rejection, which
  // Node 22 treats as fatal — one unauthenticated request, and the shop is
  // down until the host respawns it.
  let wanted: string;
  try {
    wanted = decodeURIComponent(param).toLowerCase();
  } catch {
    wanted = param.toLowerCase();
  }
  return (
    products.find((p) => (productSlug(p) || '').toLowerCase() === wanted) ??
    products.find((p) => p.id.toLowerCase() === wanted) ??
    null
  );
}

/** Where a product's picture can be fetched from as an ordinary URL. */
export function productImageUrl(origin: string, product: SeoProduct): string | null {
  const first = (product.images ?? []).find((s) => typeof s === 'string' && s.trim() !== '');
  if (!first) return null;
  // Most product photos are stored as data: URLs inside the document. No
  // crawler and no chat app can render one of those, so they are served
  // through a route of their own instead.
  if (first.startsWith('data:')) return `${origin}/media/product/${encodeURIComponent(product.id)}/0`;
  if (first.startsWith('http://') || first.startsWith('https://')) return first;
  return `${origin}${first.startsWith('/') ? '' : '/'}${first}`;
}

export function metaForPath(pathname: string, ctx: MetaContext): HeadMeta {
  const seo = ctx.seo ?? DEFAULT_SEO_SETTINGS;
  const lang: SeoLang = seo.defaultLang || 'en';
  // A catalogue address keeps its category: /products?category=Banners is the
  // Banners page, not a copy of /products. Only a sane id is kept, so a junk
  // parameter cannot make up canonicals.
  const category = /^\/products\/?$/.test(pathname) && ctx.category && /^[\p{L}\p{N} _&-]{1,64}$/u.test(ctx.category) ? ctx.category : '';
  const canonical = category
    ? `${ctx.origin}/products?category=${encodeURIComponent(category)}`
    : `${ctx.origin}${pathname === '/' ? '/' : pathname.replace(/\/+$/, '')}`;
  const noindex = NOINDEX.test(pathname) ? 'noindex, nofollow' : undefined;

  // The owner's share card wins over the shipped one, and a `/path` he typed is
  // made absolute here — no chat app resolves a relative og:image.
  const defaultImage = absoluteUrl(ctx.origin, seo.shareImageUrl, ctx.defaultImage);
  const siteDescription = seoText(seo.defaultDescription, lang, SITE_DESCRIPTION);

  /** Carried on every page: who the site is, and who owns it. */
  const identity = {
    lang,
    siteName: ctx.siteName,
    twitterSite: seo.twitterSite || undefined,
    verificationMeta: verificationTags(seo),
  };

  /**
   * "<page> | ReklamX".
   *
   * An unset suffix follows the shop's own name, so renaming the shop renames
   * every title with it. A stored empty string means the owner switched it off.
   * Never applied twice: a title he wrote WITH the suffix must not gain a second.
   */
  const suffix = typeof seo.titleSuffix === 'string' ? seo.titleSuffix : ` | ${ctx.siteName}`;
  const withSuffix = (title: string): string => {
    const s = suffix.trim();
    if (!s) return title;
    return title.includes(s) ? title : `${title}${suffix}`;
  };

  const productMatch = /^\/products\/([^/]+)\/?$/.exec(pathname);
  if (productMatch) {
    const product = findProduct(ctx.products, productMatch[1]);
    // Written in the product form, and used ahead of the generated text. This is
    // the whole point of the exercise: a title he chose beats a title we built.
    //
    // seoTitle and seoDescription are plain strings with no per-language map and
    // no box to type one in, so they stay what they have always been: an
    // override. When he has written one it still wins in every language; when he
    // has not, what follows is now the TRANSLATED name rather than the English
    // one — 15.7.1.
    const ownTitle = (product?.seoTitle || '').trim();
    const ownDescription = (product?.seoDescription || '').trim();

    // `lang` is the owner's "Language Google is shown" setting, the same one the
    // site pages below are already served in. It is deliberately not the
    // visitor's own language: that is chosen in the browser and kept in
    // localStorage, so nothing in the request tells this server what it is.
    const productName = product ? localized(product.name, product.nameI18n, lang) : '';
    const productDescription = product
      ? localized(product.description ?? '', product.descriptionI18n, lang)
      : '';

    if (product && (product.isHidden || product.seoNoindex)) {
      // Reachable by address, deliberately not on the storefront — or marked
      // noindex in the form. Describe it, but never offer it to the index with a
      // price and an InStock claim.
      return {
        ...identity,
        title: ownTitle ? withSuffix(ownTitle) : withSuffix(productName),
        description: ownDescription || plainSummary(productDescription) || siteDescription,
        canonical,
        image: productImageUrl(ctx.origin, product) || defaultImage,
        robots: 'noindex, follow',
      };
    }
    if (product) {
      const image = productImageUrl(ctx.origin, product) || defaultImage;
      const description =
        ownDescription ||
        plainSummary(productDescription) ||
        `${productName} from ${ctx.siteName}. Configure size, material and quantity online and see the price before you order.`;
      // ONE FIGURE, AND IT IS THE ONE THE FEED SENDS — the total a consumer pays.
      //
      // This quoted the NET price while buildProductFeed quoted the gross, so the
      // same product was advertised at 161.00 here and 201.25 there. Merchant
      // Center compares the two and calls it a price mismatch; enough of them
      // suspends the account. In the EU a consumer offer is quoted including VAT,
      // so the gross figure is the correct one for both — and the product page
      // now always prints it beside the net one, so the visible page agrees too.
      const netPrice = offerPriceOf(product);
      const shownPrice =
        typeof netPrice === 'number' ? Number(grossPrice(netPrice, ctx.vatRate ?? PRICING_DEFAULTS.vatRate)) : undefined;
      const offers =
        typeof shownPrice === 'number' && shownPrice > 0
          ? {
              '@type': 'Offer',
              url: canonical,
              price: shownPrice.toFixed(2),
              priceCurrency: 'SEK',
              availability: 'https://schema.org/InStock',
              seller: { '@type': 'Organization', name: ctx.siteName },
            }
          : undefined;
      const title = ownTitle ? withSuffix(ownTitle) : withSuffix(productName);
      // The brand Google Shopping is told, so the rich result and the feed agree
      // rather than showing two different manufacturers for the same product.
      const brand = product.brand || seo.merchant?.defaultBrand || ctx.siteName;
      return {
        ...identity,
        title,
        description,
        canonical,
        image,
        imageAlt: productName,
        type: 'product',
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: productName,
            description,
            image: [image],
            sku: product.id,
            ...(product.gtin ? { gtin: product.gtin } : {}),
            ...(product.mpn ? { mpn: product.mpn } : {}),
            brand: { '@type': 'Brand', name: brand },
            ...(offers ? { offers } : {}),
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${ctx.origin}/` },
              { '@type': 'ListItem', position: 2, name: 'Products', item: `${ctx.origin}/products` },
              { '@type': 'ListItem', position: 3, name: productName, item: canonical },
            ],
          },
        ],
      };
    }
    // A product address that resolves to nothing is a 404 in the app; telling
    // Google to index it would fill the index with dead pages.
    //
    // UNLESS WE SIMPLY COULD NOT LOOK. getCatalogue returns an empty list when
    // the service account is missing or Firestore refused, and an empty list
    // would then mark EVERY product page in the shop noindex — quietly, and for
    // as long as the credential was absent. Not knowing is not the same as
    // knowing it is gone.
    if (ctx.products.length === 0) {
      return {
        ...identity,
        title: `${ctx.siteName} — Web2Print print shop`,
        description: siteDescription,
        canonical,
        image: defaultImage,
      };
    }
    return {
      ...identity,
      title: `Product not found | ${ctx.siteName}`,
      description: siteDescription,
      canonical,
      image: defaultImage,
      robots: 'noindex, follow',
      // We looked, and there is no such product: say so with the status too.
      status: 404,
    };
  }

  const pageKey = pathname.replace(/\/+$/, '') || '/';
  const page = PAGE_META[pageKey];
  if (page) {
    // What the owner typed for THIS page, in the language the crawler's copy is
    // written in, falling back to the shipped English through seoText().
    const own = seo.pages?.[pageKey];
    const ownTitle = seoText(own?.title, lang);
    const ownDescription = seoText(own?.description, lang);

    const jsonLd =
      pathname === '/'
        ? [
            {
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: ctx.siteName,
              url: `${ctx.origin}/`,
              logo: defaultImage,
            },
            {
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: ctx.siteName,
              url: `${ctx.origin}/`,
              potentialAction: {
                '@type': 'SearchAction',
                target: `${ctx.origin}/products?q={search_term_string}`,
                'query-input': 'required name=search_term_string',
              },
            },
          ]
        : undefined;
    return {
      ...identity,
      // A title he wrote gets the suffix like any other; the shipped ones already
      // carry "| ReklamX" in the string and withSuffix will not double it.
      title: ownTitle ? withSuffix(ownTitle) : page.title,
      description: ownDescription || (pageKey === '/' ? siteDescription : page.description),
      canonical,
      image: defaultImage,
      // His own noindex switch, and the route-based one, are both honoured — the
      // stricter of the two wins.
      robots: own?.noindex ? 'noindex, follow' : noindex,
      jsonLd,
    };
  }

  // Nothing matched. The app renders its own 404 here, so telling search
  // engines this is a page — with a canonical pointing at itself, on a 200 —
  // is how a site fills Google's index with soft 404s from old flyers and
  // scanner probes.
  return {
    ...identity,
    title: `${ctx.siteName} — Web2Print print shop`,
    description: siteDescription,
    canonical,
    image: defaultImage,
    robots: noindex ?? 'noindex, follow',
    // A page of the app with no head of its own (sign-in, an order) is still a
    // page; an address the app has no page for is a 404.
    status: APP_ROUTE.test(pathname) ? undefined : 404,
  };
}

/**
 * The shop's own name, at most once every ten minutes.
 *
 * The head needs it on every HTML response, and the only source is a Firestore
 * document read with no cache — one billed read per page view, on an endpoint
 * that answers every extensionless address on the site. A for-loop over
 * /x1../x60000 would have burned the whole free-tier daily quota, which is the
 * failure that has already taken this shop dark for seven hours.
 */
const SITE_NAME_TTL_MS = 10 * 60 * 1000;
let siteConfigCache: { at: number; siteName: string; seo: SeoSettings } | null = null;

export interface SeoConfig {
  siteName: string;
  seo: SeoSettings;
}

/**
 * The shop's name and the owner's SEO settings, at most once every ten minutes.
 *
 * One read serves both. The head needs them on every HTML response, and reading
 * settings/siteConfig per page view is one billed read on an endpoint that
 * answers every extensionless address on the site — a for-loop over /x1../x60000
 * would have burned the whole free-tier daily quota, which is the failure that
 * has already taken this shop dark for seven hours.
 *
 * Ten minutes is a long time to wait to see your own change, so the dashboard
 * calls /api/admin/seo/refresh after a save and the wait becomes none.
 */
export async function getSeoConfig(load: () => Promise<Record<string, unknown>>): Promise<SeoConfig> {
  if (siteConfigCache && Date.now() - siteConfigCache.at < SITE_NAME_TTL_MS) {
    return { siteName: siteConfigCache.siteName, seo: siteConfigCache.seo };
  }
  try {
    const config = await load();
    const siteName = String(config.siteName || 'ReklamX');
    const seo = normalizeSeo(config.seo);
    siteConfigCache = { at: Date.now(), siteName, seo };
    return { siteName, seo };
  } catch {
    // The last good copy beats a generic head, and a generic head beats no page.
    return siteConfigCache
      ? { siteName: siteConfigCache.siteName, seo: siteConfigCache.seo }
      : { siteName: 'ReklamX', seo: DEFAULT_SEO_SETTINGS };
  }
}

/** Drop the settings cache, so a save in the dashboard is live on the next hit. */
export function invalidateSeoConfig(): void {
  siteConfigCache = null;
}

export async function getSiteName(load: () => Promise<Record<string, unknown>>): Promise<string> {
  return (await getSeoConfig(load)).siteName;
}

/**
 * Resolve `work`, or give up and return null.
 *
 * The head is a nice-to-have; the page is not. Before this the SPA handler
 * awaited Firestore with no deadline, so a degraded firestore.googleapis.com
 * (or a stalled DNS lookup) meant the shop served nothing at all rather than
 * serving a page with a generic title.
 */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

// ------------------------------------------------------ Google Merchant Center
//
// The product feed Google Shopping reads. It is the same catalogue the sitemap
// is built from, expressed the way Merchant Center wants it, and it is served
// only when the owner switches it on — an unfinished feed in Merchant Center is
// worse than none, because every missing attribute becomes a policy warning
// against the account rather than a quiet gap.
//
// TWO THINGS ARE EASY TO GET WRONG HERE, and both suspend a Merchant account:
//
//   1. THE PRICE MUST INCLUDE VAT. Every price in this shop is stored NET —
//      the product form says so on the field — and Sweden requires the shown
//      price to be the price a consumer pays. A feed of net prices means the
//      landing page shows a higher number than the ad, which Merchant Center
//      detects automatically and calls a price mismatch.
//   2. A PRODUCT WITH NO GTIN NEEDS `identifier_exists: no`. Custom print has no
//      barcode; claiming otherwise by silence makes Google look one up, fail,
//      and reject the item.

export interface FeedContext {
  origin: string;
  siteName: string;
  seo: SeoSettings;
  /** 0.25 for 25%. The shop's own rate, from printSettings. */
  vatRate: number;
  /**
   * One per country he delivers to, incl. VAT (src/lib/shipping.ts,
   * feedShippingLines) — what checkout charges. Absent: the old single line from
   * the Google tab's own fields.
   */
  shippingLines?: Array<{ country: string; price: string }>;
}

/**
 * The product's minimum unit price, read EXACTLY as calcConfiguredItemPrice reads
 * it (src/lib/pricing.ts): `customUploadRules.minPrice ?? PRICING_DEFAULTS.minPrice`
 * — the product's own, else the shop's 149 — where 0 (anything not above zero)
 * is no floor at all. A number, whatever is stored ("149").
 */
function floorOf(p: SeoProduct): number {
  const n = Number(p.customUploadRules?.minPrice ?? PRICING_DEFAULTS.minPrice);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Is this product actually on offer?
 *
 * The SAME test calcConfiguredItemPrice applies — above zero and genuinely below
 * the list price. Google must never be told about an "offer" the shop would not
 * honour, and the two answers have to come from one rule.
 */
function onSale(p: SeoProduct): boolean {
  const sale = Number(p.salePrice);
  const list = Number(p.basePrice);
  if (!(Number.isFinite(sale) && sale > 0 && Number.isFinite(list) && sale < list)) return false;
  // AND THE FLOOR, which the shop applies to both prices before it compares them
  // (isOnSale: the list price floored against the offer floored). A floor at or
  // above the list price lifts both to the floor: no offer — a product at 149
  // with an offer of 120 is not on offer, and the feed that advertised 120 as a
  // sale price while the page charged 149 is how a Merchant Center account gets
  // suspended. Below the list price, it IS an offer, at the floor when the offer
  // is under it (200 → 149, not 100) — offerPriceOf says what it costs.
  //
  // The product's own floor now (review 2026-10-11): the shop-wide 149 stood in
  // for it while the field mask left it out, and called a genuine offer on a
  // product with a lower floor (or none) "not on offer".
  return floorOf(p) < list;
}

/**
 * The price the shop is charging today: the offer if there is one, else the list
 * price — and never under the product's minimum, which the shop's pricing lifts
 * any lower price to (code review ADM-14; review 2026-10-11). A product priced at
 * 64 is sold at 149; the feed and the page's structured data said 64.
 *
 * NET, as basePrice is: the callers add VAT (grossPrice), as before. A product
 * with no price (0, or none) is left without one: what it costs comes from
 * options this module cannot see, and the floor is not it.
 */
function offerPriceOf(p: SeoProduct): number | undefined {
  const price = onSale(p) ? Number(p.salePrice) : typeof p.basePrice === 'number' ? p.basePrice : undefined;
  return typeof price === 'number' && price > 0 ? Math.max(floorOf(p), price) : price;
}

/** The list price, floored the same way — Google's struck-through "was" figure. */
function listPriceOf(p: SeoProduct): number {
  const list = typeof p.basePrice === 'number' ? p.basePrice : 0;
  return list > 0 ? Math.max(floorOf(p), list) : list;
}

/** Net → gross, to the öre, because Merchant Center compares it with the page. */
function grossPrice(net: number, vatRate: number): string {
  const rate = Number.isFinite(vatRate) && vatRate >= 0 && vatRate < 1 ? vatRate : 0.25;
  return (Math.round(net * (1 + rate) * 100) / 100).toFixed(2);
}

export function buildProductFeed(products: SeoProduct[], ctx: FeedContext): string {
  const m = ctx.seo.merchant ?? {};
  // THE FEED AND THE LANDING PAGE MUST READ THE SAME — 15.7.1. The channel
  // description below has always followed the owner's crawler language, and
  // metaForPath now writes the translated name into the <title> and the Product
  // block. An item whose g:title is still the English name points at a page
  // titled in Swedish, and Merchant Center compares the item with the page it
  // lands on. Same setting, same name, one story.
  const lang: SeoLang = ctx.seo.defaultLang || 'en';
  const items = products.filter((p) => {
    if (p.isHidden || p.seoNoindex) return false;
    if (!p.name) return false;
    const price = offerPriceOf(p) ?? 0;
    if (price <= 0 && !m.includeZeroPriced) return false;
    return true;
  });

  const rows = items.map((p) => {
    // The link keeps the CANONICAL name: productSlug reads p.name, and a slug
    // built from a translation is an address the router cannot resolve.
    const link = `${ctx.origin}/products/${productSlug(p) || p.id}`;
    const image = productImageUrl(ctx.origin, p);
    const name = localized(p.name, p.nameI18n, lang);
    const description =
      (p.seoDescription || '').trim() ||
      plainSummary(localized(p.description ?? '', p.descriptionI18n, lang), 5000) ||
      `${name} from ${ctx.siteName}.`;
    const brand = p.brand || m.defaultBrand || ctx.siteName;
    const condition = p.condition || m.defaultCondition || 'new';
    const category = p.googleProductCategory || m.defaultGoogleCategory || '';
    const hasIdentifier = Boolean(p.gtin || p.mpn);

    return [
      '    <item>',
      `      <g:id>${esc(p.id)}</g:id>`,
      // Merchant Center truncates a title at 150 characters and a description at
      // 5000; sending more is not an error, it is a silent trim mid-word.
      `      <g:title>${esc((p.seoTitle || name).slice(0, 150))}</g:title>`,
      `      <g:description>${esc(description.slice(0, 5000))}</g:description>`,
      `      <g:link>${esc(link)}</g:link>`,
      image ? `      <g:image_link>${esc(image)}</g:image_link>` : '',
      '      <g:availability>in_stock</g:availability>',
      // g:price is the LIST price and g:sale_price the offer, which is how
      // Google shows a struck-through price in Shopping. Sending only the offer
      // as g:price would work but throws away the "was" figure; sending the list
      // price alone would contradict the page and get the item disapproved.
      // Both FLOORED as the page floors them: a product listed at 64 is charged
      // 149, and 64 is a price the shop does not sell at (review 2026-10-11).
      `      <g:price>${grossPrice(listPriceOf(p), ctx.vatRate)} SEK</g:price>`,
      onSale(p) ? `      <g:sale_price>${grossPrice(offerPriceOf(p) ?? 0, ctx.vatRate)} SEK</g:sale_price>` : '',
      `      <g:brand>${esc(brand)}</g:brand>`,
      `      <g:condition>${esc(condition)}</g:condition>`,
      p.gtin ? `      <g:gtin>${esc(p.gtin)}</g:gtin>` : '',
      p.mpn ? `      <g:mpn>${esc(p.mpn)}</g:mpn>` : '',
      hasIdentifier ? '' : '      <g:identifier_exists>no</g:identifier_exists>',
      category ? `      <g:google_product_category>${esc(category)}</g:google_product_category>` : '',
      ...(ctx.shippingLines
        ? ctx.shippingLines.map((line) =>
            ['      <g:shipping>', `        <g:country>${esc(line.country)}</g:country>`, `        <g:price>${esc(line.price)} SEK</g:price>`, '      </g:shipping>'].join('\n'))
        : [
            '      <g:shipping>',
            `        <g:country>${esc(m.shippingCountry || 'SE')}</g:country>`,
            `        <g:price>${(m.shippingPrice ?? 0).toFixed(2)} SEK</g:price>`,
            '      </g:shipping>',
          ]),
      '    </item>',
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '  <channel>',
    `    <title>${esc(ctx.siteName)}</title>`,
    `    <link>${esc(ctx.origin)}/</link>`,
    `    <description>${esc(seoText(ctx.seo.defaultDescription, ctx.seo.defaultLang || 'en', SITE_DESCRIPTION))}</description>`,
    ...rows,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
