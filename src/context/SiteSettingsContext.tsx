import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { invalidateShopCache } from '../lib/invalidateShopCache';
import type { MarketingSettings } from '../lib/gtag';
import { DEFAULT_SEO_SETTINGS, type SeoSettings, type SeoSettingsForSave } from '../lib/seoSettings';
import type { LocalizedText } from '../types';

export type { MarketingSettings, SeoSettings, SeoSettingsForSave };

/**
 * EVERY PIECE OF COPY THE OWNER TYPES CAN BE SAID IN FOUR LANGUAGES.
 *
 * The shop sells in en, sv, da and no. Its products, printing options and
 * categories all carry a per-language map beside the plain string; the site's
 * OWN copy did not, so a Swedish visitor read a Swedish product title under an
 * English headline, an English announcement bar and an English footer — the
 * first line on the page was in the wrong language. Each `…I18n` field below is
 * that map. The plain string stays the fallback and stays canonical, so nothing
 * typed before these existed changes, and a half-filled map degrades one
 * language at a time rather than showing a blank.
 *
 * `null` means the owner cleared every translation: these documents are written
 * with { merge: true }, under which an omitted key is KEPT, not deleted.
 */
export interface HeroSlide {
  id: string;
  imageUrl: string;
  title?: string;
  titleI18n?: LocalizedText | null;
  subtitle?: string;
  subtitleI18n?: LocalizedText | null;
  badge?: string;
  badgeI18n?: LocalizedText | null;
  /**
   * The offer this slide sells (2026-10-13 hero): net SEK, shown "from 995 kr"
   * through the shop's own price formatter — so it follows the currency and the
   * VAT switch like every other price. Empty = no price on the slide.
   */
  priceSek?: number | null;
  /** Where the slide's button goes, e.g. /products/rollup. Empty = the shop. */
  link?: string | null;
  /**
   * How the words sit on the picture:
   *  'bottom' (default) — eyebrow, headline, line, price and button stacked low;
   *  'top'    — the headline spread across the top with its line under it and no
   *             eyebrow, the price and button low: the middle of the picture stays
   *             clear, for a photograph that has to be seen.
   */
  layout?: 'bottom' | 'top' | null;
}

export interface BentoCardSetting {
  id: string;
  title: string;
  titleI18n?: LocalizedText | null;
  imageUrl: string;
  link?: string;
}

export interface ServiceItem {
  id: string;
  title: string;
  titleI18n?: LocalizedText | null;
  subtitle?: string;
  subtitleI18n?: LocalizedText | null;
  description: string;
  descriptionI18n?: LocalizedText | null;
  icon: string;
  imageUrl?: string;
  features: string[];
  linkUrl?: string;
}

export interface ServicesPageSettings {
  heroTitle: string;
  heroTitleI18n?: LocalizedText | null;
  heroSubtitle: string;
  heroSubtitleI18n?: LocalizedText | null;
  servicesList: ServiceItem[];
}

export interface AboutUsPageSettings {
  heroTitle: string;
  heroTitleI18n?: LocalizedText | null;
  heroSubtitle: string;
  heroSubtitleI18n?: LocalizedText | null;
  storyTitle: string;
  storyTitleI18n?: LocalizedText | null;
  storyContent: string;
  storyContentI18n?: LocalizedText | null;
  mission: string;
  missionI18n?: LocalizedText | null;
  vision: string;
  visionI18n?: LocalizedText | null;
  bannerImageUrl: string;
  stats: { label: string; value: string; icon?: string }[];
  teamMembers: { id: string; name: string; role: string; photoUrl: string; bio?: string }[];
}

export type BuiltinPaymentIcon =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'swish'
  | 'klarna'
  | 'applepay'
  | 'googlepay';

// One badge in the footer's payment-method row. Either a builtin brand mark
// (drawn inline, no network request) or a custom image the owner provides.
export interface PaymentIconEntry {
  id: string;
  builtin?: BuiltinPaymentIcon;
  label?: string;
  imageUrl?: string;
}

/** One line of the pickup counter's opening hours: "Mon–Fri", "09:00–17:00". */
export interface OpeningHoursRow {
  id: string;
  days: string;
  hours: string;
}

/**
 * Where "collect it yourself" actually is.
 *
 * The checkout offered Pickup with the words "Self collection at print hub" and
 * nothing else — no address, no company name, no hours. A customer who chose it
 * had no way of knowing where to go or when the door is open, and the order
 * confirmation did not say either.
 *
 * Kept separate from contactPageSettings on purpose: the office a customer
 * writes to and the counter they collect print from are not always the same
 * place, and the shop must be able to say so.
 */
export interface PickupLocationSettings {
  /** Show the details panel under the Pickup option. */
  enabled: boolean;
  companyName: string;
  address: string;
  phone: string;
  /** Opens a map in a new tab. Optional. */
  mapsUrl: string;
  openingHours: OpeningHoursRow[];
  /** Anything else the customer needs — door code, "ask at reception", parking. */
  note: string;
}

/**
 * How long the shop takes, so an order can promise a date instead of a shrug.
 *
 * Every screen that showed a delivery date computed its own: the production work
 * order hardcoded "+3 days" in the component. One place, set by the owner, is
 * what makes the date on the customer's dashboard and the date on the press
 * operator's sheet the same date.
 */
export interface DeliveryPromiseSettings {
  /** Days in the shop before the job is ready to leave. */
  productionDays: number;
  /** Days in transit, per shipping method. Pickup adds nothing. */
  shippingDaysZone: number;
  shippingDaysWeekday: number;
  shippingDaysPickup: number;
  /** Count only Monday–Friday. A print shop's promise is in working days. */
  skipWeekends: boolean;
}

/**
 * How long an order sits in each production stage before the shop moves it on
 * by itself. See src/lib/orderStages.ts — this is the owner-facing half of it.
 */
export interface AutoStageSettingsShape {
  enabled: boolean;
  hours: {
    in_design: number;
    in_print: number;
    finishing: number;
    shipped: number;
    completed: number;
  };
  skipWeekends: boolean;
}

export interface ContactPageSettings {
  heroTitle: string;
  heroTitleI18n?: LocalizedText | null;
  heroSubtitle: string;
  heroSubtitleI18n?: LocalizedText | null;
  address: string;
  phone: string;
  email: string;
  workingHours: string;
  googleMapsEmbedUrl?: string;
  faqList: { question: string; answer: string }[];
}

export interface SiteSettings {
  siteName: string;
  siteTagline: string;
  /** The tagline in the shop's other languages. See HeroSlide above. */
  siteTaglineI18n?: LocalizedText | null;
  logoType: 'text_and_icon' | 'image' | 'text_only';
  logoUrl?: string;

  primaryColor: string;
  accentColor: string;
  navbarBg: 'white' | 'dark' | 'custom';
  customNavbarBgHex?: string;

  showAnnouncementBar: boolean;
  announcementText: string;
  announcementTextI18n?: LocalizedText | null;
  announcementBg: string;

  showHero: boolean;
  heroTitle: string;
  heroTitleI18n?: LocalizedText | null;
  heroSubtitle: string;
  heroSubtitleI18n?: LocalizedText | null;
  heroCta1Text: string;
  heroCta1TextI18n?: LocalizedText | null;
  heroCta1Link: string;
  heroCta2Text: string;
  heroCta2TextI18n?: LocalizedText | null;
  heroCta2Link: string;
  heroImageUrl: string;
  heroBgOverlay: 'dark' | 'light' | 'gradient';

  heroSlides?: HeroSlide[];
  bentoCards?: BentoCardSetting[];

  showCategoriesSection: boolean;
  showEditorPromoSection: boolean;
  showStatsSection: boolean;
  /** The home page's sections in his order (src/lib/homeSections.ts); absent = the page as built. */
  homeSectionOrder?: string[];
  /**
   * The row of suggested products under every product (round 16, item 10):
   * none, only the products he picked on each product, or his picks and then
   * products from the same category. Read through suggestionModeOf
   * (src/lib/suggestions.ts), which supplies the default for a saved document
   * that predates it.
   */
  productSuggestions?: 'off' | 'picks' | 'fill';
  /**
   * The online designer also offers its four basic layouts, after the owner's
   * own design templates (round 16, 5b). Absent = yes; he switches them off in
   * Design templates.
   */
  designerBasicLayouts?: boolean;
  /**
   * Designer v2 (2026-10-07). AI pictures in the studio's AI Studio — OFF until he
   * switches it on: Google's image models need billing on his project, and each
   * picture costs him. With a shop-wide cap per day (src/lib/aiImages.ts).
   */
  designerAiImages?: boolean;
  designerAiDailyCap?: number;
  /** His resolution table by the product's size (src/lib/printSpec.ts cleanDpiBands); absent = the trade's defaults. */
  designerDpiBands?: Array<{ maxLongSideMm: number | null; targetDpi: number; minDpi: number }>;
  /** The order of every design in the gallery — his template ids and the shop's starter ids — and the ones he hid. */
  designTemplateOrder?: string[];
  designTemplateHidden?: string[];

  editorPromoTitle: string;
  editorPromoTitleI18n?: LocalizedText | null;
  editorPromoSubtitle: string;
  editorPromoSubtitleI18n?: LocalizedText | null;
  editorPromoImageUrl: string;

  contactPhone?: string;
  contactEmail?: string;

  // Legal seller identity, printed on invoices. Swedish invoicing rules require
  // these to be correct, so they start EMPTY: the invoice shows a visible gap
  // until the shop owner supplies the real values. Printing a plausible-looking
  // but invented org number is worse than printing nothing.
  companyLegalName?: string;
  companyAddress?: string;
  orgNumber?: string;
  vatNumber?: string;
  bankgiro?: string;
  hasFSkatt?: boolean;

  footerText: string;
  footerTextI18n?: LocalizedText | null;

  // Payment-method badges shown in the footer above the copyright row.
  // An empty array hides the row entirely.
  footerPaymentIcons: PaymentIconEntry[];
  /**
   * Let the footer badges follow the Mollie account instead of this list.
   *
   * The owner enables a method in his own Mollie dashboard; the footer should
   * say so without anyone editing a list. It was hand-curated, which is how it
   * came to advertise Klarna but not PayPal while both were live, and how a
   * Swish logo hotlinked from an unrelated charity's website ended up in it.
   *
   * Off by default: an existing shop keeps exactly the badges it has until the
   * owner asks for this.
   */
  footerPaymentIconsAuto?: boolean;

  // Dedicated Editable Pages Settings
  servicesPageSettings?: ServicesPageSettings;
  aboutUsPageSettings?: AboutUsPageSettings;
  contactPageSettings?: ContactPageSettings;

  /** Shown under "Pickup" at checkout, and repeated in the order confirmation. */
  pickupLocation?: PickupLocationSettings;
  /** Feeds the due date written on every order. */
  deliveryPromise?: DeliveryPromiseSettings;
  /** Drives the automatic production stages. */
  autoStages?: AutoStageSettingsShape;

  /**
   * Google Ads / Analytics ids, pasted by the owner in the dashboard.
   *
   * These live HERE, in the ordinary settings document, and not in the server's
   * secret store, for two reasons: they are public — every site running them
   * shows them in its page source — and the browser is what needs to read them.
   * settings/siteConfig is already world-readable and already live-synced, so
   * this needs no new endpoint and no new rule. Nothing loads until a visitor
   * accepts; see src/lib/gtag.ts.
   */
  marketing?: MarketingSettings;

  /**
   * Titles, descriptions, robots.txt, the sitemap and the Merchant Center feed —
   * everything a search engine reads, set from the dashboard rather than in code.
   *
   * The server reads this document to write the head of every page it serves, so
   * a title changed here reaches Google without a deploy. See src/lib/seoSettings.ts
   * for the shape and server-seo.ts for what is done with it.
   *
   * Two shapes, on purpose. A save hands us SeoSettingsForSave, which spells a
   * cleared field `null` so that the merge write below actually deletes it; what
   * comes back out of Firestore is read through normalizeSeo(), which turns those
   * nulls into absent keys again. Nobody should reach into this field directly —
   * go through normalizeSeo() and neither shape matters.
   */
  seo?: SeoSettings | SeoSettingsForSave;
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  // Empty on purpose: no ids, no tag, no consent banner asking about tags that
  // do not exist. The shop behaves exactly as it did until the owner fills
  // these in.
  marketing: { adsId: '', purchaseLabel: '', ga4Id: '' },
  // Every field blank: the server falls back to the titles and robots rules it
  // ships with, exactly as before, until the owner overrides one of them.
  seo: DEFAULT_SEO_SETTINGS,
  siteName: 'ReklamX',
  siteTagline: 'Professional Web2Print & Printing Hub',
  logoType: 'text_and_icon',
  logoUrl: '',

  primaryColor: '#bb965b',
  accentColor: '#bb965b',
  navbarBg: 'white',
  customNavbarBgHex: '#ffffff',

  showAnnouncementBar: true,
  announcementText: '🎉 Special 15% discount on all card and banner printing with code: PRINT15',
  announcementBg: '#1e293b',

  showHero: true,
  heroTitle: 'Your Vision.. Perfectly Printed',
  heroSubtitle: 'Complete Web2Print solutions for businesses and individuals. Design online, preview live, and receive top quality prints.',
  heroCta1Text: 'Upload Custom Print File',
  heroCta1Link: '/custom-upload',
  heroCta2Text: 'Browse All Products',
  heroCta2Link: '/products',
  heroImageUrl: 'https://images.pexels.com/photos/38041486/pexels-photo-38041486.jpeg?auto=compress&cs=tinysrgb&w=2000',
  heroBgOverlay: 'dark',

  // One offer per slide, written to be read in a second (2026-10-13): a short
  // eyebrow, one headline in sentence case, one line — and a price only where
  // the shop really sells at it. The owner rewrites all of it in UI Customizer.
  heroSlides: [
    {
      id: 's1',
      imageUrl: 'https://images.pexels.com/photos/38041486/pexels-photo-38041486.jpeg?auto=compress&cs=tinysrgb&w=2000',
      badge: 'Roll-up',
      badgeI18n: { sv: 'Roll-up', da: 'Roll-up', no: 'Roll-up' },
      title: 'Seen from the very first step.',
      titleI18n: { sv: 'Syns från första steget.', da: 'Synlig fra første skridt.', no: 'Synlig fra første skritt.' },
      subtitle: 'Printed, assembled and in its bag — ready for the trade show.',
      subtitleI18n: { sv: 'Tryckt, monterad och i väskan — redo för mässan.', da: 'Trykt, monteret og i tasken — klar til messen.', no: 'Trykket, montert og i vesken — klar for messen.' },
      priceSek: 995,
      link: '/products',
    },
    {
      id: 's2',
      imageUrl: 'https://images.pexels.com/photos/35138560/pexels-photo-35138560.jpeg?auto=compress&cs=tinysrgb&w=2000',
      badge: 'Trade shows',
      badgeI18n: { sv: 'Mässa', da: 'Messe', no: 'Messe' },
      title: 'Your stand, ready to build.',
      titleI18n: { sv: 'Din monter, redo att byggas.', da: 'Din stand, klar til at bygge.', no: 'Din stand, klar til å bygges.' },
      subtitle: 'Walls, counters and banners that pack into one case.',
      subtitleI18n: { sv: 'Väggar, diskar och banderoller som ryms i en väska.', da: 'Vægge, diske og bannere i én kuffert.', no: 'Vegger, disker og bannere i én koffert.' },
    },
    {
      id: 's3',
      imageUrl: 'https://images.pexels.com/photos/6250876/pexels-photo-6250876.jpeg?auto=compress&cs=tinysrgb&w=2000',
      badge: 'Labels on a roll',
      badgeI18n: { sv: 'Etiketter på rulle', da: 'Etiketter på rulle', no: 'Etiketter på rull' },
      title: 'Straight into the machine.',
      titleI18n: { sv: 'Rakt in i maskinen.', da: 'Direkte ind i maskinen.', no: 'Rett inn i maskinen.' },
      subtitle: 'Wound the way your applicator expects.',
      subtitleI18n: { sv: 'Lindade så som din applikator vill ha dem.', da: 'Viklet som din applikator forventer.', no: 'Viklet slik applikatoren din forventer.' },
    },
    {
      id: 's4',
      imageUrl: 'https://images.pexels.com/photos/19258787/pexels-photo-19258787.jpeg?auto=compress&cs=tinysrgb&w=2000',
      badge: 'Packaging',
      badgeI18n: { sv: 'Förpackningar', da: 'Emballage', no: 'Emballasje' },
      title: 'Boxes worth keeping.',
      titleI18n: { sv: 'Kartonger värda att spara.', da: 'Æsker værd at gemme.', no: 'Esker verdt å ta vare på.' },
      subtitle: 'Rigid board, foil, and a lid that closes with a sound.',
      subtitleI18n: { sv: 'Styv kartong, folie och ett lock som stängs med ett ljud.', da: 'Stift karton, folie og et låg, der lukker med en lyd.', no: 'Stiv kartong, folie og et lokk som lukkes med en lyd.' },
    }
  ],

  bentoCards: [
    { id: 'b1', title: 'Gift boxes', titleI18n: { sv: 'Presentaskar', da: 'Gaveæsker', no: 'Gaveesker' }, imageUrl: 'https://images.pexels.com/photos/33629669/pexels-photo-33629669.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b2', title: 'Custom labels', titleI18n: { sv: 'Etiketter', da: 'Etiketter', no: 'Etiketter' }, imageUrl: 'https://images.pexels.com/photos/33490518/pexels-photo-33490518.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b3', title: 'Exhibition stands', titleI18n: { sv: 'Mässmontrar', da: 'Messestande', no: 'Messestander' }, imageUrl: 'https://images.pexels.com/photos/12705461/pexels-photo-12705461.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b4', title: 'Paper cups', titleI18n: { sv: 'Pappersmuggar', da: 'Papkrus', no: 'Pappkrus' }, imageUrl: 'https://images.pexels.com/photos/6569972/pexels-photo-6569972.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b5', title: 'Doypacks', titleI18n: { sv: 'Doypacks', da: 'Doypacks', no: 'Doypacks' }, imageUrl: 'https://images.pexels.com/photos/16100293/pexels-photo-16100293.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b6', title: 'Illuminated signs', titleI18n: { sv: 'Ljusskyltar', da: 'Lysskilte', no: 'Lysskilt' }, imageUrl: 'https://images.pexels.com/photos/35091448/pexels-photo-35091448.jpeg?auto=compress&cs=tinysrgb&w=900' }
  ],

  showCategoriesSection: true,
  showEditorPromoSection: true,
  showStatsSection: true,
  productSuggestions: 'fill',
  designerBasicLayouts: true,

  editorPromoTitle: 'Design Like a Pro.. Right From Your Browser',
  editorPromoSubtitle: 'Advanced drag-and-drop online design editor with ready-to-print editable templates.',
  editorPromoImageUrl: '/placeholder-print.svg',

  contactPhone: '+46 40 614 30 30',
  contactEmail: 'info@reklamx.se',

  // Deliberately blank — see the note on the interface.
  companyLegalName: '',
  companyAddress: '',
  orgNumber: '',
  vatNumber: '',
  bankgiro: '',
  hasFSkatt: false,

  footerText: 'All rights reserved © ReklamX 2026. Professional Digital Web2Print Hub.',

  // What the shop actually accepts through Mollie today: cards, Swish, Klarna.
  // Apple Pay / Google Pay stay out of the defaults until they are enabled.
  footerPaymentIcons: [
    { id: 'pay-visa', builtin: 'visa' },
    { id: 'pay-mastercard', builtin: 'mastercard' },
    { id: 'pay-amex', builtin: 'amex' },
    { id: 'pay-swish', builtin: 'swish' },
    { id: 'pay-klarna', builtin: 'klarna' },
  ],
  // Off by default. Switching it on is the owner's decision, and an existing
  // shop must not have its footer rearranged by an update.
  footerPaymentIconsAuto: false,

  servicesPageSettings: {
    heroTitle: 'Our World-Class Web2Print Services',
    heroSubtitle: 'From high-speed digital offset printing to laser-cut rigid packaging and exhibition stands. Explore our full range of professional printing capabilities.',
    servicesList: [
      {
        id: 'srv-1',
        title: 'Digital & Offset Printing',
        subtitle: 'Digital and offset printing',
        description: 'Ultra high-definition 300 DPI printing for brochures, business cards, flyers, catalogs, and marketing collaterals with instant spot-UV & foil stamping options.',
        icon: 'Printer',
        imageUrl: 'https://images.pexels.com/photos/9550363/pexels-photo-9550363.jpeg?auto=compress&cs=tinysrgb&w=1200',
        features: ['Up to 10,000 sheets/hr', 'Spot-UV & Foil Stamping', 'Custom Heavyweight Cardstock', 'Bleed & Color Auto-Proofing']
      },
      {
        id: 'srv-2',
        title: 'Custom Packaging & Rigid Boxes',
        subtitle: 'Premium packaging and rigid boxes',
        description: 'Custom folded boxes, luxury rigid gift boxes, doypacks, and corrugated mailers designed with custom die-cut shapes and protective laminations.',
        icon: 'Box',
        imageUrl: 'https://images.pexels.com/photos/7309447/pexels-photo-7309447.jpeg?auto=compress&cs=tinysrgb&w=1200',
        features: ['Custom Dimensions & Structural Engineering', 'Eco-friendly Recycled Cardboard', 'Magnetic Latch & Ribbon Closure', 'Low Minimum Order Quantities']
      },
      {
        id: 'srv-3',
        title: 'Large Format Banners & Event Displays',
        subtitle: 'Large-format banners and exhibition graphics',
        description: 'Roll-up banners, backlit illuminated displays, pop-up booth walls, teardrop flags, and vinyl signage for events and indoor/outdoor displays.',
        icon: 'Layers',
        imageUrl: 'https://images.pexels.com/photos/5727002/pexels-photo-5727002.jpeg?auto=compress&cs=tinysrgb&w=1200',
        features: ['UV-Resistant & Weatherproof Inks', 'Aluminium Lightweight Frames', 'Carrying Cases Included', 'Fast 24-Hour Express Assembly']
      },
      {
        id: 'srv-4',
        title: 'Labels, Stickers & Roll Printing',
        subtitle: 'High-resolution labels and roll stickers',
        description: 'Laser die-cut roll stickers, waterproof vinyl decals, metallic foil product labels, and custom shape die-cuts for retail product branding.',
        icon: 'Tag',
        imageUrl: 'https://images.pexels.com/photos/12324202/pexels-photo-12324202.jpeg?auto=compress&cs=tinysrgb&w=1200',
        features: ['Waterproof & Scratch-Resistant', 'Rolls or Individual Sheet Cuts', 'Clear Transparent or Metallic Foil', 'Precision Optical Die-Cutting']
      },
      {
        id: 'srv-5',
        title: 'Custom Upload & Prepress Audit',
        subtitle: 'Upload and preflight your print files',
        description: 'Upload your vector PDF/AI/TIFF files directly. Our prepress engine performs live DPI checks, CMYK color space mapping, and bleed margin verification.',
        icon: 'UploadCloud',
        imageUrl: 'https://images.pexels.com/photos/6621020/pexels-photo-6621020.jpeg?auto=compress&cs=tinysrgb&w=1200',
        features: ['Instant Prepress DPI Audit', '3D Live Proof Renderer', 'CMYK / Pantone Matching', 'Express Direct-to-Press Workflow']
      },
      {
        id: 'srv-6',
        title: 'Express Logistics & Doorstep Shipping',
        subtitle: 'Shipping and express delivery',
        description: 'Real-time order production status tracking from file prepress to print shop curing and express courier dispatch right to your doorstep.',
        icon: 'Truck',
        imageUrl: 'https://images.pexels.com/photos/4440801/pexels-photo-4440801.jpeg?auto=compress&cs=tinysrgb&w=1200',
        features: ['Same-Day Production Available', 'Live Courier Tracking', 'Safe Reinforced Box Packaging', 'Worldwide Door-to-Door Shipping']
      }
    ]
  },

  // Nothing here may CLAIM anything: the previous defaults shipped three
  // invented employees with stock-photo portraits and stats like "18,500+
  // clients" — fiction a real customer would read as fact, and misleading
  // marketing under Swedish law (marknadsföringslagen). Defaults now say only
  // what is true of any shop running this code; the owner fills in the rest
  // from the dashboard, and empty stats/team simply hide those sections.
  aboutUsPageSettings: {
    heroTitle: 'About ReklamX',
    heroTitleI18n: { sv: 'Om ReklamX', da: 'Om ReklamX', no: 'Om ReklamX' },
    heroSubtitle: 'Custom print for businesses and individuals — configured online, priced instantly, delivered to your door.',
    heroSubtitleI18n: { sv: 'Tryck efter dina önskemål för företag och privatpersoner – allt ställs in online, priset visas direkt och leveransen kommer hem till dörren.', da: 'Tryk efter dine ønsker til virksomheder og privatpersoner – alt indstilles online, prisen vises med det samme, og leveringen kommer helt hjem.', no: 'Trykk etter dine ønsker for bedrifter og privatpersoner – alt stilles inn på nett, prisen vises med en gang, og leveransen kommer helt hjem.' },
    storyTitle: 'Who we are',
    storyTitleI18n: { sv: 'Vilka vi är', da: 'Hvem vi er', no: 'Hvem vi er' },
    storyContent: 'ReklamX is a Swedish web-to-print shop. Choose a product, set your size and options, upload your artwork and see the price immediately — we take care of the printing and the delivery.',
    storyContentI18n: { sv: 'ReklamX är ett svenskt web-to-print-tryckeri. Välj en produkt, ange format och tillval, ladda upp ditt original och se priset direkt – vi sköter tryck och leverans.', da: 'ReklamX er et svensk web-to-print-trykkeri. Vælg et produkt, angiv format og tilvalg, upload dit materiale og se prisen med det samme – vi tager os af tryk og levering.', no: 'ReklamX er et svensk web-to-print-trykkeri. Velg et produkt, angi format og tilvalg, last opp originalen din og se prisen med en gang – vi tar oss av trykk og levering.' },
    mission: 'Make professional print as easy to order as anything else you buy online — a clear price before you commit, a real person behind every order, and a delivery date we keep.',
    missionI18n: { sv: 'Att göra professionellt tryck lika enkelt att beställa som allt annat du köper online – ett tydligt pris innan du bestämmer dig, en riktig människa bakom varje order och ett leveransdatum vi håller.', da: 'At gøre professionelt tryk lige så nemt at bestille som alt andet, du køber online – en klar pris, før du beslutter dig, et rigtigt menneske bag hver ordre og en leveringsdato, vi holder.', no: 'Å gjøre profesjonelt trykk like enkelt å bestille som alt annet du kjøper på nett – en tydelig pris før du bestemmer deg, et ekte menneske bak hver ordre og en leveringsdato vi holder.' },
    vision: 'To be the print partner a brand keeps for years — from its first business card to the banner at its biggest trade show.',
    visionI18n: { sv: 'Att vara den tryckpartner ett varumärke behåller i många år – från det första visitkortet till banderollen på dess största mässa.', da: 'At være den trykpartner, et brand beholder i mange år – fra det første visitkort til banneret på dets største messe.', no: 'Å være trykkpartneren en merkevare beholder i mange år – fra det første visittkortet til banneret på den største messen.' },
    bannerImageUrl: 'https://images.pexels.com/photos/6620983/pexels-photo-6620983.jpeg?auto=compress&cs=tinysrgb&w=1600',
    stats: [],
    teamMembers: []
  },

  // Same rule as the About page: no invented facts. The old defaults carried a
  // street address that does not exist, a phone number that reaches a stranger,
  // opening hours and service promises ("24-hour express", "sample boxes")
  // nobody agreed to, and a Maps pin on a random Stockholm block. Empty means
  // the page hides that card until the owner enters the real thing.
  contactPageSettings: {
    heroTitle: 'Get in Touch with Our Print Specialists',
    heroSubtitle: 'Have a custom printing request, large corporate order, or technical question? We are here to assist you.',
    // The print shop, given by the owner on 2026-10-14.
    address: 'Flintyxegatan 9, 213 76 Malmö',
    phone: '',
    email: 'info@reklamx.se',
    workingHours: '',
    googleMapsEmbedUrl: '',
    faqList: []
  },

  // Same rule as the contact page: nothing invented. Empty means the Pickup
  // option keeps its short description and shows no details panel at all —
  // better than sending a customer to an address the shop never gave us.
  pickupLocation: {
    enabled: false,
    companyName: '',
    address: '',
    phone: '',
    mapsUrl: '',
    openingHours: [],
    note: ''
  },

  // Three production days plus the carrier's own transit time, counted in
  // working days. These ARE guesses, but a promise that is a little pessimistic
  // is a working default; the owner changes them in one place.
  deliveryPromise: {
    productionDays: 3,
    shippingDaysZone: 2,
    shippingDaysWeekday: 1,
    shippingDaysPickup: 0,
    skipWeekends: true
  },

  // The stages walk themselves along this schedule, measured from the moment the
  // order was PAID. The numbers add up to the three production days plus two
  // days of transit that deliveryPromise above already promises the customer.
  autoStages: {
    enabled: true,
    hours: {
      in_design: 4,
      in_print: 20,
      finishing: 24,
      shipped: 24,
      completed: 48
    },
    skipWeekends: true
  }
};

/**
 * WHAT "RESET" ON THE UI CUSTOMIZER PUTS BACK: the look of the shop — its name and
 * logo, the colours, the home page's texts, pictures and sections, the footer — and
 * nothing else (code review ADM-05 / DSN-10).
 *
 * It used to write DEFAULT_SITE_SETTINGS over the whole document, without a merge:
 * the SEO and marketing tabs, the company's legal identity, the About, Services and
 * Contact pages, pickup and delivery, the automatic stages, the designer's settings
 * and the order of the design templates — other screens' work — went with it.
 */
const CUSTOMIZER_RESET_KEYS: Array<keyof SiteSettings> = [
  'siteName', 'siteTagline', 'logoType', 'logoUrl',
  'primaryColor', 'accentColor', 'navbarBg', 'customNavbarBgHex',
  'showAnnouncementBar', 'announcementText', 'announcementBg',
  'showHero', 'heroTitle', 'heroSubtitle', 'heroCta1Text', 'heroCta1Link', 'heroCta2Text', 'heroCta2Link',
  'heroImageUrl', 'heroBgOverlay', 'heroSlides', 'bentoCards',
  'showCategoriesSection', 'showEditorPromoSection', 'showStatsSection', 'productSuggestions',
  'editorPromoTitle', 'editorPromoSubtitle', 'editorPromoImageUrl',
  'footerText', 'footerPaymentIcons', 'footerPaymentIconsAuto',
];
/** …with their translations: the owner's Swedish for his own tagline is not the default's. */
const CUSTOMIZER_RESET_TRANSLATIONS: Array<keyof SiteSettings> = [
  'siteTaglineI18n', 'announcementTextI18n', 'heroTitleI18n', 'heroSubtitleI18n', 'heroCta1TextI18n',
  'heroCta2TextI18n', 'editorPromoTitleI18n', 'editorPromoSubtitleI18n', 'footerTextI18n',
];

interface SiteSettingsContextType {
  settings: SiteSettings;
  updateSettings: (newSettings: Partial<SiteSettings>) => Promise<void>;
  resetToDefault: () => Promise<void>;
  loading: boolean;
  /** The dashboard's live listener — see useLiveSiteSettings. Returns its stop. */
  subscribeLive: () => () => void;
}

const SiteSettingsContext = createContext<SiteSettingsContextType | undefined>(undefined);

const LOCAL_COPY_KEY = 'reklamx_site_settings';

/**
 * This browser's copy of the settings, for the next visit. It NEVER throws: two of
 * its writes run inside state updaters, and a full or refused storage threw there;
 * React rethrew it while rendering, outside the error boundary, and the whole shop
 * went blank (code review 2026-10-11, REVIEW-3 #3). The copy is a convenience —
 * without it, the next visit waits for the server's.
 */
function keepLocalCopy(settings: SiteSettings): void {
  try {
    localStorage.setItem(LOCAL_COPY_KEY, JSON.stringify(settings));
  } catch {
    /* full or refused: nothing kept */
  }
}

export const SiteSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<SiteSettings>(() => {
    // The read as well: a browser that refuses storage throws on it, here, in render.
    try {
      const saved = localStorage.getItem(LOCAL_COPY_KEY);
      if (saved) return { ...DEFAULT_SITE_SETTINGS, ...JSON.parse(saved) };
    } catch (e) {
      console.warn('Failed to read site settings from local storage:', e);
    }
    return DEFAULT_SITE_SETTINGS;
  });

  const [loading, setLoading] = useState(true);

  // The dashboard's live listener, shared by every screen that asks for it.
  const liveCount = useRef(0);
  const liveStop = useRef<(() => void) | null>(null);

  // THE SHOP'S SETTINGS COME FROM THE SERVER'S COPY (2026-10-08).
  //
  // Every visitor's browser used to keep a live Firestore listener on
  // settings/siteConfig. The free database counts its daily limit in read units
  // BY SIZE, and that document had grown to ~800 KB (the customizer's pictures):
  // ~209 units a visit, so ~240 visits spent the whole day's 50 000 and the shop
  // went dark each evening. /api/site-settings answers from one copy the server
  // reads once per change from the dashboard — and from its last copy when
  // Firestore refuses, so the shop keeps its own look through an outage. Only the
  // dashboard listens live (useLiveSiteSettings), where the owner edits.
  useEffect(() => {
    let cancelled = false;
    // Not for ever: the host has stalled requests for tens of seconds before, and
    // the page must not wait on it — this browser's last copy stands meanwhile.
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), 8000);
    fetch('/api/site-settings', { signal: abort.signal })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`site settings: ${resp.status}`);
        const body = await resp.json();
        if (cancelled || liveCount.current > 0) return;
        // null: no settings document yet — the defaults stand (the dashboard's
        // live listener is what creates one, for the owner).
        if (body && body.settings && typeof body.settings === 'object') {
          const merged = { ...DEFAULT_SITE_SETTINGS, ...(body.settings as Partial<SiteSettings>) };
          setSettings(merged);
          keepLocalCopy(merged);
        }
      })
      .catch((err) => {
        // The copy in this browser (or the defaults) stays — the same as an
        // offline listener used to leave.
        console.warn('Site settings could not be loaded; keeping the last copy:', err);
      })
      .finally(() => {
        window.clearTimeout(timer);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const subscribeLive = useCallback(() => {
    liveCount.current += 1;
    if (liveCount.current === 1) {
      const docRef = doc(db, 'settings', 'siteConfig');
      liveStop.current = onSnapshot(docRef, (snapshot) => {
        // WHAT metadata IS DOING HERE — this is the whole shop's configuration.
        //
        // Firestore answers offline too, from its own cache, and an empty cache
        // looks exactly like an empty database: exists() === false. The old code
        // took that at face value and wrote DEFAULT_SITE_SETTINGS back, so a
        // visitor whose network was down, whose ad-blocker or corporate proxy
        // stops firestore.googleapis.com, or who arrived while the free-tier read
        // quota was exhausted — which has already taken this shop dark for seven
        // hours once — queued a write of the DEFAULTS over the owner's real
        // settings. The write is latency-compensated, so it also came straight
        // back as a snapshot and replaced the good cached config in this browser
        // with the defaults: no logo, no announcement, no hero. And the moment
        // the network returned, the queued write went to the server, for
        // everyone. Reproduced here by blocking Firestore in Playwright: the
        // settings were wiped within 800ms.
        //
        // fromCache says "this is not the server talking". hasPendingWrites says
        // "this is our own unconfirmed write echoing back". Neither is grounds
        // for deciding the document does not exist.
        // Read both flags before the branch: exists() narrows `snapshot` to never
        // in the else, and the metadata is exactly what the else needs.
        const { fromCache, hasPendingWrites } = snapshot.metadata;
        if (snapshot.exists()) {
          // An echo of our own optimistic write carries no new information, and
          // caching it would persist an unconfirmed state.
          if (hasPendingWrites) return;
          const data = snapshot.data() as Partial<SiteSettings>;
          const merged = { ...DEFAULT_SITE_SETTINGS, ...data };
          setSettings(merged);
          keepLocalCopy(merged);
        } else if (!fromCache) {
          // Genuinely missing, and the SERVER said so. Only then is creating it
          // the right thing to do.
          setDoc(docRef, DEFAULT_SITE_SETTINGS, { merge: true }).catch(err => {
            console.warn('Unable to auto-create settings in Firestore:', err);
          });
        }
        setLoading(false);
      }, (err) => {
        console.warn('Firestore settings subscription warning:', err);
        setLoading(false);
      });
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      liveCount.current -= 1;
      if (liveCount.current === 0) {
        liveStop.current?.();
        liveStop.current = null;
      }
    };
  }, []);

  const updateSettings = async (newSettings: Partial<SiteSettings>) => {
    // What this save changes, as it was — put back if the write is refused.
    let before: Record<string, unknown> = {};
    // From the latest copy, not this render's: two saves in a row kept only the second.
    setSettings((prev) => {
      before = Object.fromEntries(Object.keys(newSettings).map((k) => [k, (prev as any)[k]]));
      const updated = { ...prev, ...newSettings };
      keepLocalCopy(updated); // never throws — see keepLocalCopy
      return updated;
    });

    try {
      const docRef = doc(db, 'settings', 'siteConfig');
      // THE CHANGE ONLY, never this tab's whole copy (code review ADM-05 / DSN-10).
      // The copy can be minutes old — the About, Services and Contact pages hold
      // the one they loaded, and no listener — or the defaults when the server's
      // copy could not be had; written whole, it put back every other screen's
      // settings as they were, or wiped them. Each caller sends its own keys.
      //
      // merge, and it RECURSES into the nested maps — seo, seo.pages['/products'],
      // marketing. A key a caller leaves out of one of those is not cleared, it is
      // kept, which is why every screen that writes here has to send a `null` for
      // an emptied field rather than dropping it. pruneSeoForSave() in
      // src/lib/seoSettings.ts is the worked example.
      await setDoc(docRef, newSettings, { merge: true });
      // Visitors read the server's copy: tell it the settings changed, as every
      // product and category save does — and WAIT for it, so that "saved" means
      // the next page anyone opens shows the change (it never throws).
      await invalidateShopCache();
    } catch (err) {
      // Let the caller know. Swallowing this meant "Save & Apply" reported
      // success on a write that never happened: the change survived in local
      // state until the page reloaded, and every visitor kept seeing the old
      // site. A permission error looked exactly like a successful save.
      console.error('Saving site settings failed:', err);
      // …and the page does not go on showing it as made. The editor said "not
      // saved" while the page behind it (and this browser's copy) kept the new
      // words (final review). Put back only what still holds this save's value: a
      // later save of the same key is not undone.
      setSettings((prev) => {
        const restored: any = { ...prev };
        for (const k of Object.keys(newSettings)) if (restored[k] === (newSettings as any)[k]) restored[k] = before[k];
        keepLocalCopy(restored);
        return restored;
      });
      throw err;
    }
  };

  const resetToDefault = async () => {
    // The customizer's own keys, set to the shipped defaults — every other key in
    // the document is left exactly as it is (CUSTOMIZER_RESET_KEYS above).
    const patch: Record<string, unknown> = {};
    for (const key of CUSTOMIZER_RESET_KEYS) patch[key] = DEFAULT_SITE_SETTINGS[key];
    for (const key of CUSTOMIZER_RESET_TRANSLATIONS) patch[key] = null;
    try {
      // A merge, not updateDoc: an update needs the document to exist, and a shop
      // with no settings document yet could not be reset at all. For these keys the
      // two write the same: each value here is text, a yes/no, a list or null —
      // written whole, null as null. (A MAP among them would be blended into what is
      // stored by a merge; that key would need { mergeFields } to be replaced.)
      await setDoc(doc(db, 'settings', 'siteConfig'), patch, { merge: true });
    } catch (err) {
      // Said to the caller: a failed reset used to warn in the console and leave
      // the defaults on screen as if they had been saved.
      console.error('Resetting the site settings failed:', err);
      throw err;
    }
    setSettings((prev) => {
      const updated = { ...prev, ...patch } as SiteSettings;
      keepLocalCopy(updated); // never throws — see keepLocalCopy
      return updated;
    });
    await invalidateShopCache();
  };

  return (
    <SiteSettingsContext.Provider value={{ settings, updateSettings, resetToDefault, loading, subscribeLive }}>
      {children}
    </SiteSettingsContext.Provider>
  );
};

export const useSiteSettings = () => {
  const context = useContext(SiteSettingsContext);
  if (!context) {
    throw new Error('useSiteSettings must be used within a SiteSettingsProvider');
  }
  return context;
};

/**
 * The live settings, for the DASHBOARD: a Firestore listener on settings/siteConfig
 * while the calling screen is mounted, so an edit shows at once and two open tabs
 * agree. Visitors never open one — they read the server's copy (see above).
 */
export const useLiveSiteSettings = () => {
  const { subscribeLive } = useSiteSettings();
  useEffect(() => subscribeLive(), [subscribeLive]);
};
