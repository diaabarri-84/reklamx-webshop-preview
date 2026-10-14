// Google Ads conversion tracking and Google Analytics 4 — and the consent gate
// in front of them.
//
// WHY IT IS BUILT THIS WAY
// The shop owner asked, more than once, to be able to connect Google Ads
// HIMSELF: "I want to enter the information in the dashboard". So nothing here
// is configured in code. The ids live in the ordinary site settings document
// that the dashboard already writes, and this module does nothing at all until
// one of them is filled in.
//
// NOTHING LOADS BEFORE CONSENT. Not the tag, not a cookieless ping, nothing.
// Google's own Consent Mode allows loading the tag with storage denied, and it
// is defensible — but this shop's cookie policy has always said, in four
// languages, that it does not track anyone, and the honest way to keep that
// promise for a visitor who says no is to send Google nothing whatsoever. So
// the script element is only created after an explicit accept, and a refusal
// leaves the page exactly as it is today.
//
// The ids themselves are PUBLIC — they are visible in the page source of every
// site that runs them. They are settings, not secrets, and they must not go
// anywhere near the server's secret store.

export interface MarketingSettings {
  /** Google Ads conversion id, e.g. AW-123456789. */
  adsId?: string;
  /** The conversion action's label, the half after the slash in Google's snippet. */
  purchaseLabel?: string;
  /** Google Analytics 4 measurement id, e.g. G-ABCD1234. */
  ga4Id?: string;
  /**
   * Google Tag Manager container, e.g. GTM-ABC1234.
   *
   * The owner asked to be able to add Google things himself without coming back
   * to us. A container is exactly that: once it is here he can add a remarketing
   * tag, a Meta pixel or a heatmap from inside GTM's own screen, and this shop
   * never needs another deploy for it. It obeys the same consent gate as
   * everything else — no container is loaded until a visitor says yes.
   */
  gtmId?: string;
  /**
   * Strip the ad-click identifier from the URLs Google receives.
   *
   * A Google Ads setting, not a legal one: with it on, Ads still counts the
   * conversion but does not receive the full landing-page URL. Costs a little
   * attribution accuracy, gives away less.
   */
  adsDataRedaction?: boolean;
  /**
   * Pass the ad-click id between pages in the address bar instead of a cookie.
   *
   * Recovers conversions from browsers that drop third-party cookies — Safari's
   * default, and a large share of this shop's Swedish traffic.
   */
  urlPassthrough?: boolean;
  /**
   * Which shopping events to report, beyond the purchase.
   *
   * The purchase alone tells Google Ads what worked; these tell it what nearly
   * worked, which is what dynamic remarketing and Smart Bidding need to be worth
   * anything. All three are off until the owner switches them on, and none of
   * them fire before consent.
   */
  trackViewItem?: boolean;
  trackAddToCart?: boolean;
  trackBeginCheckout?: boolean;
}

export type ConsentChoice = 'granted' | 'denied';

/** Deliberately not the key the old information-only notice used: a visitor who
 *  dismissed THAT has not consented to anything, and must be asked properly. */
const CONSENT_KEY = 'reklamx_consent_v1';
/** One key per order, so a refresh of the thank-you page cannot bill a second
 *  conversion to the campaign that earned one. */
const REPORTED_PREFIX = 'reklamx_conv_';

export const ADS_ID_RE = /^AW-\d{6,15}$/;
export const GA4_ID_RE = /^G-[A-Z0-9]{4,20}$/;
export const GTM_ID_RE = /^GTM-[A-Z0-9]{4,12}$/;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/** True when the owner has actually configured something worth loading. */
export function hasMarketing(m?: MarketingSettings | null): boolean {
  if (!m) return false;
  return (
    ADS_ID_RE.test((m.adsId || '').trim()) ||
    GA4_ID_RE.test((m.ga4Id || '').trim()) ||
    GTM_ID_RE.test((m.gtmId || '').trim())
  );
}

export function readConsent(): ConsentChoice | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    // Storage blocked. We cannot remember a choice, so we can never treat the
    // visitor as having given one: null means "ask", and asking every time is
    // the safe end of that trade.
    return null;
  }
}

export function writeConsent(choice: ConsentChoice): void {
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    /* nothing to do */
  }
}

let loadedFor = '';
let gtmLoadedFor = '';

/** The shim Google's own snippet uses, created once. */
function ensureGtag(): void {
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    // It pushes the `arguments` OBJECT, not an array of the arguments — the tag
    // reads it back by position and a spread-into-array version silently records
    // nothing.
    const shim = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    window.gtag = shim as unknown as Window['gtag'];
  }
}

/**
 * Inject gtag.js and configure whichever ids are present. Safe to call twice;
 * the second call with the same ids does nothing.
 */
export function loadTags(m: MarketingSettings): void {
  if (typeof document === 'undefined') return;
  const adsId = (m.adsId || '').trim();
  const ga4Id = (m.ga4Id || '').trim();
  const ids = [ADS_ID_RE.test(adsId) ? adsId : '', GA4_ID_RE.test(ga4Id) ? ga4Id : ''].filter(Boolean);

  loadContainer(m);
  if (ids.length === 0) return;

  const signature = ids.join('|');
  if (loadedFor === signature) return;

  ensureGtag();

  if (loadedFor === '') {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids[0])}`;
    document.head.appendChild(s);
    window.gtag!('js', new Date());
    // We only get here after an explicit accept, so storage is granted — but
    // stating it keeps the tag's own behaviour explicit rather than default.
    window.gtag!('consent', 'default', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
      analytics_storage: 'granted',
    });
    // Two Google Ads settings the owner can now reach without us. Both are set
    // before the first config so the very first hit already obeys them.
    if (m.adsDataRedaction) window.gtag!('set', 'ads_data_redaction', true);
    if (m.urlPassthrough) window.gtag!('set', 'url_passthrough', true);
  }

  for (const id of ids) {
    // send_page_view stays on for GA4 and is harmless for Ads.
    window.gtag!('config', id);
  }
  loadedFor = signature;
}

/**
 * Google Tag Manager, if the owner set a container.
 *
 * Held to the same rule as everything else here: the container script is only
 * created after an explicit accept, so a visitor who refuses gets no request to
 * googletagmanager.com at all. GTM is a loader for other people's tags, which
 * makes gating it more important than gating gtag.js, not less.
 */
function loadContainer(m: MarketingSettings): void {
  const gtmId = (m.gtmId || '').trim();
  if (!GTM_ID_RE.test(gtmId)) return;
  if (gtmLoadedFor === gtmId) return;

  ensureGtag();
  // GTM reads this event to start its own timers; without it the container
  // loads but reports a page view of zero milliseconds.
  window.dataLayer!.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
  document.head.appendChild(s);
  gtmLoadedFor = gtmId;
}

/** Called when the visitor presses Accept. */
export function grantConsent(m: MarketingSettings): void {
  writeConsent('granted');
  loadTags(m);
}

/** Called when the visitor presses Reject. Nothing was loaded, nothing to undo. */
export function denyConsent(): void {
  writeConsent('denied');
}

/**
 * Forget the answer and ask again.
 *
 * "It shall be as easy to withdraw consent as to give it" (GDPR art. 7(3)), and
 * the only route out used to be clearing site data — which also empties the
 * basket and signs the customer out. This is the footer link's job.
 *
 * A tag already injected stays injected for this page view; the reload the
 * banner's next answer triggers is not forced, but nothing further is sent once
 * the answer is 'denied', and no tag is loaded on the next page.
 */
export function resetConsent(): void {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* nothing to do */
  }
  try {
    window.dispatchEvent(new Event('reklamx:consent'));
  } catch {
    /* not a browser */
  }
}

/**
 * Report a completed purchase, once per order.
 *
 * Fired from the order page rather than from the checkout button, because the
 * checkout button only means the customer LEFT for their bank — this shop has
 * been burned before by treating "arrived back" as "paid". The caller must only
 * call this when the server says paymentStatus === 'paid'.
 */
export function trackPurchase(
  m: MarketingSettings,
  order: { id: string; value: number; currency: string },
): void {
  if (typeof window === 'undefined' || !window.gtag) return;
  if (readConsent() !== 'granted') return;
  if (!order.id || !Number.isFinite(order.value)) return;

  const key = REPORTED_PREFIX + order.id;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
  } catch {
    // Without storage we cannot deduplicate. Reporting once per page load is
    // still far better than not reporting at all, and Google deduplicates on
    // transaction_id at its end for GA4.
  }

  const adsId = (m.adsId || '').trim();
  const label = (m.purchaseLabel || '').trim();
  if (ADS_ID_RE.test(adsId)) {
    window.gtag('event', 'conversion', {
      // Without a label Google Ads records the conversion against the account
      // but not against a specific action, which is still better than silence.
      send_to: label ? `${adsId}/${label}` : adsId,
      value: order.value,
      currency: order.currency,
      transaction_id: order.id,
    });
  }
  if (GA4_ID_RE.test((m.ga4Id || '').trim())) {
    window.gtag('event', 'purchase', {
      transaction_id: order.id,
      value: order.value,
      currency: order.currency,
    });
  }
}

// ------------------------------------------------------- the shopping events
//
// Everything below is OFF unless the owner switched it on in the dashboard, and
// silent unless the visitor accepted. `purchase` above is the one that proves an
// ad paid for itself; these three are what Google needs to find more people like
// the ones who nearly bought — dynamic remarketing and Smart Bidding are both
// blind without them.

/** One line, in the shape Google's ecommerce events expect. */
export interface TrackedItem {
  id: string;
  name: string;
  price?: number;
  quantity?: number;
  /**
   * The line's real total, when the caller has it. price × quantity leaves out
   * the setup fee and the one-off option charges (a die, a proof), which can be
   * most of a small line — 100 stickers + an 850 kr die reported 840 kr.
   */
  lineTotal?: number;
}

const CURRENCY = 'SEK';

/** Nothing is ever sent unless a tag is loaded, consent is granted, and the
 *  owner asked for this particular event. */
function readyFor(m: MarketingSettings, enabled: boolean | undefined): boolean {
  if (!enabled) return false;
  if (typeof window === 'undefined' || !window.gtag) return false;
  if (readConsent() !== 'granted') return false;
  return hasMarketing(m);
}

function itemPayload(items: TrackedItem[]) {
  return items.map((i) => ({
    item_id: i.id,
    item_name: i.name,
    price: typeof i.price === 'number' ? i.price : undefined,
    quantity: typeof i.quantity === 'number' ? i.quantity : 1,
  }));
}

function sum(items: TrackedItem[]): number {
  return items.reduce((total, i) => total + (i.price ?? 0) * (i.quantity ?? 1), 0);
}

/**
 * Send one ecommerce event to whichever products are configured.
 *
 * GA4 picks the event up from the plain call. Google Ads does NOT — an Ads
 * conversion id only receives what is addressed to it — so the same event is
 * repeated with send_to when an AW- id is present. That is what fills the
 * remarketing audience; without the second call the Ads account sees nothing but
 * purchases.
 */
function sendEvent(m: MarketingSettings, name: string, payload: Record<string, unknown>): void {
  window.gtag!('event', name, payload);
  const adsId = (m.adsId || '').trim();
  if (ADS_ID_RE.test(adsId)) {
    window.gtag!('event', name, { ...payload, send_to: adsId });
  }
}

/** A shopper opened a product page. */
export function trackViewItem(m: MarketingSettings, item: TrackedItem): void {
  if (!readyFor(m, m.trackViewItem)) return;
  if (!item?.id) return;
  sendEvent(m, 'view_item', {
    currency: CURRENCY,
    value: (item.price ?? 0) * (item.quantity ?? 1),
    items: itemPayload([item]),
  });
}

/** A configured line went into the basket. */
export function trackAddToCart(m: MarketingSettings, item: TrackedItem): void {
  if (!readyFor(m, m.trackAddToCart)) return;
  if (!item?.id) return;
  sendEvent(m, 'add_to_cart', {
    currency: CURRENCY,
    value: Number.isFinite(item.lineTotal) ? Number(item.lineTotal) : (item.price ?? 0) * (item.quantity ?? 1),
    items: itemPayload([item]),
  });
}

/**
 * The shopper pressed Pay.
 *
 * This is NOT a purchase and must never be counted as one — it means the
 * customer left for their bank, which this shop has been burned by treating as
 * "paid" before. The conversion still comes from trackPurchase, on the order
 * page, only once the server says the money arrived.
 */
export function trackBeginCheckout(m: MarketingSettings, items: TrackedItem[], value?: number): void {
  if (!readyFor(m, m.trackBeginCheckout)) return;
  if (!items?.length) return;
  sendEvent(m, 'begin_checkout', {
    currency: CURRENCY,
    value: typeof value === 'number' && Number.isFinite(value) ? value : sum(items),
    items: itemPayload(items),
  });
}
