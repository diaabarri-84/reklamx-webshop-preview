import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { getAdminDb, getAdminAuth, getAdminBucket } from './src/lib/firebaseAdmin.js';
import {
  buildProductFeed,
  buildRobots,
  esc,
  buildSitemap,
  getCatalogue,
  setCatalogueSource,
  getSeoConfig,
  injectHead,
  invalidateCatalogue,
  invalidateSeoConfig,
  metaForPath,
  originFrom,
  readShell,
  findProduct,
  withDeadline,
} from './server-seo.js';
import {
  getMollie, toMollieAmount, publicBaseUrl, isPubliclyReachable, isMollieLive, verifyMollieKey,
  listMollieMethods, mollieLocale, type PublicMollieMethod,
} from './src/lib/mollie.js';
import { MAX_ARTWORK_BASE64, MAX_FILE_MB, MAX_EMBEDDED_DATA_URL_CHARS, artworkBase64Length } from './src/lib/artworkLimits.js';
import {
  parseSupplierFeed, mapOfferToProduct, categoryHistogram, priceFromSource, type SupplierOffer,
} from './src/lib/supplierFeed.js';
// Value classes, not the SDK itself: the app is initialised in firebaseAdmin.ts
// and these are pure helpers, so importing them here starts nothing.
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import { slugify, uniqueSlug } from './src/lib/slug.js';
import { parseCategoryFilter, normaliseQuery, matchesCatalogueFilters } from './src/lib/catalogueQuery.js';
import { isPrivateAddress } from './src/lib/privateAddress.js';
import { parseEasyGifts } from './src/lib/suppliers/easyGifts.js';
import { supplierProductToShop } from './src/lib/suppliers/toShopProduct.js';
import { planResync, forResync, forReimport } from './src/lib/suppliers/resync.js';
import { offersToSupplierProducts, PRO_MEDIA_PLUS } from './src/lib/suppliers/proMediaPlus.js';
import { parseMidocean, MIDOCEAN, MIDOCEAN_CURRENCY } from './src/lib/suppliers/midocean.js';
import { toIndexEntry } from './src/lib/suppliers/types.js';
import {
  INDEX_BATCH, idForEntry, nextPhase, refuseEmptyFeed, claimable, percentDone,
  type IndexRun,
} from './src/lib/suppliers/indexRun.js';
import { dayKeyInShopTime, shopDayRange, shopDaysBetween } from './src/lib/reportDays.js';
import { buildCostSnapshot } from './src/lib/orderCosts.js';
import { artworkBoxShown, artworkExpected, artworkSourceOf } from './src/lib/artwork.js';
import { cleanDesignPreviews, cleanDesignSides } from './src/lib/designFileSpecs.js';
import { cleanDesignLaterMarker, designLaterMarker } from './src/lib/designLater.js';
import { printSides } from './src/lib/printSides.js';
import { isOnDeliveryOpen } from './src/lib/orderQueue.js';
import { BLEED_MAX_MM } from './src/lib/printSpec.js';
import { onlineDesignOffered } from './src/lib/onlineDesign.js';
import { AI_IMAGE_COUNT, aiImageFailure, cleanAiImageRequest, dailyCap, giveBack, imagesFromResponse, takeBudget } from './src/lib/aiImages.js';
import { decideVatRegime, toCountryCode, normaliseVatNumber } from './src/lib/vatRegime.js';
import {
  normaliseShipping, shippingOptions, countryOf, enabledCountry, methodById, orderTitleOf, feedShippingLines,
  isIsoCountry, SHIPPING_METHOD_IDS, type ShippingCountry, type ShippingSettings,
} from './src/lib/shipping.js';
import { deliveryAddressOf } from './src/lib/deliveryAddress.js';
import { creditNoteAmountDue, creditNoteFigures, formatCreditNoteNumber } from './src/lib/creditNote.js';
import {
  providerForKey, keyMismatchSentence, isAiProvider, verifyRequest, verifyLooksGood, chatRequest, extractText,
  friendlyAiError, supportsWebGrounding, AI_PROVIDER_NAMES, AI_MODELS, AI_IMAGE_MODELS,
  probeRequest, probeLooksAlive, probeIsRefusal, providerErrorSentence,
  type AiProvider, type AiRequest,
} from './src/lib/aiProvider.js';
import {
  checkCouponGates, toAudience, checkMarginFloor, generateCouponCodes, couponLimit,
  cleanCouponHolds, liveCouponHolders, placeCouponHold, releaseCouponHold, couponHolderKeys,
  type CouponAudience, type CouponHolds,
} from './src/lib/couponRules.js';
import {
  LOYALTY_DEFAULTS, loyaltySettingsFrom, pointsEarnedOn, pointsValueSek,
  tierForSpend, pointsExpireAt, planPointsExpiry, type LoyaltySettings,
} from './src/lib/loyalty.js';
import { sendOrderEmails, sendArtworkNotification, sendInquiryNotification, sendCreditNoteEmail, mailSetup, cleanInboxList, sendTestOrderNotice } from './src/lib/email.js';
import {
  buildConsentUrl,
  exchangeCode,
  grantsDrive,
  getAccessToken,
  resetDriveToken,
  ensureFolder,
  uploadFile as driveUpload,
  verifyDrive,
  MAX_DRIVE_BYTES,
  type GoogleCreds,
} from './src/lib/googleDrive.js';
import { orderSheetText, orderFolderName } from './src/lib/orderSheet.js';
import {
  zendrConfigured,
  createOrderDrafts,
  fetchTrackingBatch,
  fetchTracking,
  draftFromOrder,
  senderFromEnv,
  orderShips,
  trackingIsFinal,
  zendrPortalUrl,
  verifyZendrKey,
} from './src/lib/zendr.js';
import {
  calcConfiguredItemPrice,
  calcLinearMeterPrice,
  calcOrderTotals,
  pointsEarnedFor,
  PRICING_DEFAULTS,
  clampDimension,
} from './src/lib/pricing.js';
import { CUSTOM_SIZE_OPTION_ID, resolveSelectionFromIds } from './src/lib/optionTree.js';
import { applyLibraryToProduct, type LibraryApplyMode } from './src/lib/libraryApply.js';
import { orderByIdList, pageStartAfter, rankMap } from './src/lib/ownerOrder.js';
import { buildCategoryTree, flattenTree } from './src/lib/categoryTree.js';
import { withFieldOrder } from './src/lib/pageOrder.js';
import { SUGGESTION_COUNT, pickSuggestions } from './src/lib/suggestions.js';
import { cleanTemplateDoc, summaryOf, type TemplateFull } from './src/lib/designTemplateDoc.js';
import { templateInScope } from './src/lib/designTemplateMatch.js';
import { templateCopies } from './src/lib/templateCopies.js';
import { categoryChips, cleanSort, searchAndSort } from './src/lib/suppliers/supplierSearch.js';
import { isReadRefusal, roleCache, type RoleAnswer } from './src/lib/adminRoleCache.js';
import { nextPacificMidnight } from './src/lib/quotaClock.js';
import {
  SPEED_FIELD_ID,
  orderProductionDays,
  promiseNumbers,
  promisedDay,
  speedDaysOf,
  transitDaysFor,
} from './src/lib/productionSpeed.js';
import {
  AUTO_STAGE_DEFAULTS,
  autoAdvanceBlockedReason,
  buildStagePlan,
  nextAutoStage,
  nextStageAtFor,
  replanFrom,
  sanitizeAutoStageSettings,
  type AutoStageSettings,
} from './src/lib/orderStages.js';

dotenv.config();

const app = express();
// No "X-Powered-By: Express" on every response: it tells a scanner what to try
// and tells a customer nothing (the client's audit, 2026-10-10).
app.disable('x-powered-by');
// Hosts (Hostinger Node.js, Cloud Run, Railway, …) inject the port to bind and
// health-check that port. Binding 3000 unconditionally fails their health check.
//
// cPanel/CloudLinux runs the app under Phusion Passenger, which hands over a
// UNIX SOCKET PATH in the same variable rather than a number. Number() on that
// is NaN, so the old line fell back to 3000, Passenger's request never arrived
// and the site answered 503 with nothing useful in the log. Both shapes are
// kept: a number stays a number, anything else is passed to listen() as the
// address it is.
const RAW_PORT = process.env.PORT?.trim();
const PORT: number | string =
  RAW_PORT && Number.isFinite(Number(RAW_PORT)) ? Number(RAW_PORT) : RAW_PORT || 3000;
/** True when the host asked us to listen on a socket file, not a TCP port. */
const LISTENING_ON_SOCKET = typeof PORT === 'string';

// JSON bodies for the API — but NOT for the Firebase auth handler.
//
// `/__/auth/*` is proxied byte-for-byte to Firebase (see the handler further
// down). Google POSTs back to that handler as `application/x-www-form-urlencoded`
// during the redirect flow, and a body parser here would either consume the
// stream or leave `req.body` as an empty object that the proxy would then
// re-serialise as the literal string "{}" — silently replacing the customer's
// sign-in response with nothing. The proxy reads the raw stream itself, so this
// has to stay out of its way.
app.use((req, res, next) => {
  if (req.path.startsWith('/__/')) return next();
  return express.json({ limit: '10mb' })(req, res, next);
});

// ONE URL PER PAGE: no trailing slash. `/products/` answered 200 with the same
// page as `/products`, so every address had a duplicate Google could index and
// a link checker would flag. A page address with a trailing slash now moves —
// 301, one hop, query kept — to the same address without it. The API, the
// Firebase auth proxy and the root are left alone.
app.use((req, res, next) => {
  const p = req.path;
  if ((req.method !== 'GET' && req.method !== 'HEAD') || p === '/' || !p.endsWith('/') || p.startsWith('/api/') || p.startsWith('/__/')) return next();
  const q = req.originalUrl.indexOf('?');
  // Leading slashes collapsed to one: `//evil.example/` must never become the
  // protocol-relative `//evil.example`, a redirect to another site.
  const target = '/' + p.replace(/\/+$/, '').replace(/^\/+/, '');
  return res.redirect(301, target + (q >= 0 ? req.originalUrl.slice(q) : ''));
});

// Security headers. No dependency, because every one of these is a single line
// and helmet's defaults would need overriding for the CSP anyway.
//
// The CSP is deliberately not enforced yet — Report-Only. The shop inlines
// styles through Tailwind and loads fonts and images from data: URIs, and
// switching straight to enforcement would break the page for every customer.
// Report-Only means violations are visible without anything breaking; turn it
// into Content-Security-Policy once the reports are quiet.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// ---------------------------------------------------------------------------
// Lightweight in-memory rate limiter for the AI endpoints.
// Prevents anonymous abuse of the (paid) Gemini API from a single client.
// For multi-instance production, replace with a shared store (e.g. Redis).
// ---------------------------------------------------------------------------
// Behind a proxy the real client address arrives in X-Forwarded-For; direct from
// the internet, that header is whatever the caller typed. Trusting it
// unconditionally let anyone bypass every limit by sending a new fake IP each
// request. Set TRUST_PROXY=1 only when the app really is behind one.
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

// ---------------------------------------------------------------------------
// DASHBOARD-MANAGED SECRETS.
//
// The Mollie and Zendr keys can be pasted into the back office by the owner
// instead of being carried to every host by hand (or worse, through a chat).
// They live in Firestore at secrets/integrations — a collection with no
// security rule, which under Firestore's default-deny means NO browser can
// read or write it; only this server, through the Admin SDK, ever touches it.
//
// A dashboard key, when present, WINS over the environment. The environment
// stays as the fallback, so a host with only .env configured keeps working and
// an empty dashboard changes nothing.
//
// The cache exists for the same reason every other cache in this file does:
// the read quota has blacked this shop out once already. Five minutes is also
// the ceiling on how long a freshly pasted key takes to reach a host that
// didn't serve the save itself.
// ---------------------------------------------------------------------------
type StoredSecret = { key?: string; last4?: string; updatedAt?: string; updatedBy?: string };
type IntegrationSecrets = {
  mollie?: StoredSecret;
  zendr?: StoredSecret;
  /**
   * The AI assistant's key — from WHICHEVER provider the owner chose.
   *
   * It was readable ONLY from the host's environment, and this host has no SSH —
   * so the one key the owner could actually obtain himself was the one he could
   * not install. The chat has been switched off on production since it shipped
   * for exactly that reason.
   *
   * `provider` is the service he chose for it in the dashboard (round 16) — the
   * only one the key was ever sent to — recorded once that service accepted it,
   * so nothing is guessed on the way to a customer's question. The field name
   * stays `gemini` so a key already saved under it keeps working.
   */
  gemini?: AiSlot;
  /**
   * EVERY AI SERVICE'S KEY, ONE EACH, and which one is in use (client, 2026-10-07:
   * "more than one option, the ability to choose and switch on any of them while
   * keeping the saved keys"). `gemini` above stays a mirror of the ACTIVE one, so an
   * older server reading only it keeps working.
   */
  ai?: { active?: AiProvider; keys?: Partial<Record<AiProvider, AiSlot>> };
  /** Google is not a single key: it is an OAuth client plus the owner's token. */
  google?: GoogleCreds;
  /**
   * The supplier feed's B2B login. A username and a password, not an API key,
   * which is why it does not go through the key panel's single-value shape.
   * Read by the importer only, and never sent back to the browser.
   */
  supplier?: { user?: string; pass?: string; updatedAt?: string; updatedBy?: string };
  /**
   * midocean's gateway key — 3.8. One value, sent as `x-Gateway-APIKey`.
   *
   * It arrived over WhatsApp and MUST BE ROTATED now the integration is built.
   * It lives here and never in a settings document, because the dashboard can
   * read a settings document back.
   */
  midocean?: { apiKey?: string; updatedAt?: string; updatedBy?: string };
  /**
   * Where the shop's "new paid order" e-mail goes — the OWNER's choice, from the
   * dashboard (client, 2026-10-07). Kept here, not in a settings document, because
   * settings documents are readable by the shop's visitors. Empty = the server's
   * SHOP_ORDER_INBOX, as before.
   */
  notify?: { orderEmails?: string[]; updatedAt?: string; updatedBy?: string };
  /** The dashboard's revenue goal, per month, incl. VAT — his to set (2026-10-07). Server-only, like the rest of this document. */
  dashboard?: { monthlyGoal?: number; updatedAt?: string; updatedBy?: string };
};
/** One AI service's saved key — the provider it was proven against, and what answered. */
type AiSlot = StoredSecret & {
  provider?: AiProvider;
  /**
   * DeepSeek only: he confirmed an agreement with DeepSeek that covers the
   * transfer out of the EU. The privacy policy says so only when he has.
   */
  transferConfirmed?: boolean;
  /** The model that actually answered a test question when this key was saved. */
  verifiedModel?: string;
  /** Set when the key was stored WITHOUT a model having answered — an amber state. */
  verifiedWarning?: string | null;
};

// What the environment held at boot. A dashboard key wins while it exists; the
// moment it is deleted from the document, the boot value comes BACK — without
// this, application was set-only and a removed key survived in process.env on
// the long-lived host until a restart, silently diverging from serverless.
const ENV_AT_BOOT = {
  mollie: process.env.MOLLIE_API_KEY?.trim() || '',
  zendr: process.env.ZENDR_API_KEY?.trim() || '',
  gemini: process.env.GEMINI_API_KEY?.trim() || '',
  // Which service an environment key is from, when the host says so — a
  // DeepSeek key there looks exactly like OpenAI's.
  aiProvider: process.env.AI_PROVIDER?.trim() || '',
};

let secretsCache: { at: number; ok: boolean; data: IntegrationSecrets } | null = null;
// Single-flight: concurrent callers share one read instead of each firing
// their own — a burst of requests after a cold start is one Firestore read.
let secretsInflight: Promise<IntegrationSecrets> | null = null;
// A forced refresh (a key was just saved) bumps the generation; an OLDER read
// still in flight then finds itself outdated and applies nothing, so a stale
// snapshot can never overwrite the key that was saved after it started.
let secretsGen = 0;
const SECRETS_CACHE_MS = 5 * 60 * 1000;
// Negative cache: while Firestore is down, retry once a minute — not on every
// request, which under an outage would stall the whole API behind it.
const SECRETS_RETRY_MS = 60 * 1000;

/**
 * WHETHER THE DATABASE IS REFUSING READS FOR ITS DAILY LIMIT — learnt from this
 * server's own reads (gRPC 8, RESOURCE_EXHAUSTED: the free tier database's read
 * quota), cleared by the first read that succeeds. A signed-in owner whose profile
 * could not be read is then told WHY, and when it comes back, instead of being
 * shown a customer's account ("did you lock my account?", 2026-10-07).
 */
let databaseQuotaRefusedAt = 0;
function noteDatabaseRead(err?: unknown): void {
  if (!err) {
    databaseQuotaRefusedAt = 0;
    return;
  }
  const e = err as { code?: unknown; message?: unknown };
  if (e?.code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(e?.message ?? ''))) databaseQuotaRefusedAt = Date.now();
}

/** The owner's "send new-order e-mails to" list (empty = the server's default inbox). */
async function orderInboxes(fresh = false): Promise<string[]> {
  const stored = await loadIntegrationSecrets(fresh);
  return cleanInboxList(stored.notify?.orderEmails ?? []) ?? [];
}

const AI_ORDER: AiProvider[] = ['google', 'openai', 'anthropic', 'deepseek'];

/**
 * Every AI service's saved key (one each) and the one IN USE. A key saved before
 * there were several (the single `gemini` slot) counts as its provider's; the one
 * in use is his choice when it still has a key, else that old one, else the first.
 */
function aiSlots(data: IntegrationSecrets): { active: AiProvider | null; keys: Partial<Record<AiProvider, AiSlot>> } {
  const keys: Partial<Record<AiProvider, AiSlot>> = {};
  for (const [p, slot] of Object.entries(data.ai?.keys ?? {})) {
    if (isAiProvider(p) && slot?.key?.trim()) keys[p] = { ...slot, provider: p };
  }
  const wanted = isAiProvider(data.ai?.active) ? data.ai!.active! : null;
  let active: AiProvider | null = wanted && keys[wanted] ? wanted : null;
  // `gemini` is written TOGETHER with the key in use by this server. One that is not
  // the key in use was written before there were several keys (the live shop's own,
  // saved 2026-09 without a service named) or by an OLDER server after a rollback:
  // either way it is the newest — kept as its service's key, and in use. A key with
  // no service recorded is placed by its shape, as the assistant has always read it.
  const mirror = data.gemini;
  const mirrorKey = mirror?.key?.trim();
  if (mirrorKey) {
    const provider: AiProvider = isAiProvider(mirror!.provider) ? mirror!.provider! : detectProviderFallback(mirrorKey);
    if (!active || keys[active]?.key?.trim() !== mirrorKey) {
      keys[provider] = { ...mirror!, provider };
      active = provider;
    }
  }
  if (!active) active = AI_ORDER.find((p) => keys[p]) ?? null;
  return { active, keys };
}

/**
 * Every saved key, written back whole with each AI write: the old single key (only
 * in `gemini` until now) becomes its service's slot the first time anything is
 * saved or switched, so switching away from it can never lose it.
 */
function allAiSlotsForWrite(keys: Partial<Record<AiProvider, AiSlot>>): Partial<Record<AiProvider, ReturnType<typeof fullAiSlot>>> {
  const out: Partial<Record<AiProvider, ReturnType<typeof fullAiSlot>>> = {};
  for (const p of AI_ORDER) {
    const slot = keys[p];
    if (slot?.key?.trim()) out[p] = fullAiSlot({ ...slot, provider: p });
  }
  return out;
}

/** A slot written whole: a field left out would keep an older value through the merge. */
function fullAiSlot(slot: AiSlot): Required<Pick<AiSlot, 'key' | 'last4' | 'updatedAt' | 'updatedBy'>> & {
  provider: AiProvider | null; verifiedModel: string | null; verifiedWarning: string | null; transferConfirmed: boolean;
} {
  return {
    key: slot.key ?? '',
    last4: slot.last4 ?? (slot.key ? slot.key.slice(-4) : ''),
    updatedAt: slot.updatedAt ?? new Date().toISOString(),
    updatedBy: slot.updatedBy ?? '',
    provider: isAiProvider(slot.provider) ? slot.provider : null,
    verifiedModel: slot.verifiedModel ?? null,
    verifiedWarning: slot.verifiedWarning ?? null,
    transferConfirmed: slot.transferConfirmed === true,
  };
}

function applyIntegrationSecrets(data: IntegrationSecrets): void {
  const mollie = data.mollie?.key?.trim() || ENV_AT_BOOT.mollie;
  if (mollie) process.env.MOLLIE_API_KEY = mollie;
  else delete process.env.MOLLIE_API_KEY;
  const zendr = data.zendr?.key?.trim() || ENV_AT_BOOT.zendr;
  if (zendr) process.env.ZENDR_API_KEY = zendr;
  else delete process.env.ZENDR_API_KEY;
  // The assistant, the translator and the artwork checks all read this one name,
  // so setting it here turns every one of them on at once — and /api/health's
  // `chat` flag flips with it, which is what stops the widget advertising a
  // feature the server cannot perform.
  // The ACTIVE one of his saved keys (aiSlots); an old single key with no named
  // service is still used as before.
  const { active, keys } = aiSlots(data);
  const slot = active ? keys[active] : undefined;
  const legacyKey = data.gemini?.key?.trim();
  const dashboardKey = slot?.key?.trim() || (!slot && legacyKey ? legacyKey : '');
  const gemini = dashboardKey || ENV_AT_BOOT.gemini;
  if (gemini) process.env.GEMINI_API_KEY = gemini;
  else delete process.env.GEMINI_API_KEY;
  // Which provider that key belongs to, proven at save time. A key from the host
  // environment keeps whatever AI_PROVIDER the host gave with it; with neither,
  // it is left to detection at call time rather than claimed here.
  const provider = slot?.key?.trim() ? active : dashboardKey ? data.gemini?.provider : ENV_AT_BOOT.aiProvider;
  if (gemini && provider) process.env.AI_PROVIDER = provider;
  else delete process.env.AI_PROVIDER;
}

async function loadIntegrationSecrets(force = false): Promise<IntegrationSecrets> {
  if (!force && secretsCache) {
    const ttl = secretsCache.ok ? SECRETS_CACHE_MS : SECRETS_RETRY_MS;
    if (Date.now() - secretsCache.at < ttl) return secretsCache.data;
  }
  if (!force && secretsInflight) return secretsInflight;

  const gen = ++secretsGen;
  const read = (async (): Promise<IntegrationSecrets> => {
    try {
      const db = getAdminDb();
      let data: IntegrationSecrets = {};
      if (db) {
        const snap = await db.collection('secrets').doc('integrations').get();
        if (snap.exists) data = (snap.data() ?? {}) as IntegrationSecrets;
        noteDatabaseRead();
      }
      if (gen === secretsGen) {
        applyIntegrationSecrets(data);
        secretsCache = { at: Date.now(), ok: true, data };
      }
      return data;
    } catch (err) {
      // A Firestore hiccup must not take payments down with it: keep whatever
      // is already applied and try again after the retry window.
      console.warn('Could not read dashboard secrets; using what is already applied:', err);
      noteDatabaseRead(err);
      if (gen === secretsGen) {
        secretsCache = { at: Date.now(), ok: false, data: secretsCache?.data ?? {} };
      }
      return secretsCache?.data ?? {};
    } finally {
      if (gen === secretsGen) secretsInflight = null;
    }
  })();
  secretsInflight = read;
  return read;
}

/**
 * The caller's address, for rate limiting.
 *
 * THE LEFT-MOST X-Forwarded-For ENTRY IS THE ONE THE CALLER WROTE.
 *
 * This used to read `[0]`. nginx in front of this app is configured — in this
 * project's own DEPLOY.md — with `proxy_set_header X-Forwarded-For
 * $proxy_add_x_forwarded_for`, which expands to "<whatever the client sent>,
 * <the real address>". The real address is LAST. Taking the first entry meant
 * every rate limit in the shop was keyed on a string the caller chose.
 *
 * Demonstrated against the live shop on 2026-09-01: fifteen POSTs to /api/chat
 * with `X-Forwarded-For: 203.0.113.77` exhausted that bucket (16th and 17th
 * answered 429), and a single further request with `X-Forwarded-For:
 * 198.51.100.9` was served immediately with a full budget. The genuine client
 * bucket was never touched. Rotate the header and there is no limit at all — on
 * /api/checkout/pay, which allocates a real order number and writes an order;
 * on /api/contact, which writes a document and sends mail through the shop's own
 * SMTP account; and on /api/checkout/quote, which spends the Firestore read
 * quota that has already blacked this shop out once.
 *
 * X-Real-IP first, because the documented nginx block sets it to $remote_addr
 * and it carries exactly one value. Falling back to the RIGHT-MOST forwarded
 * entry, which is the one the trusted proxy appended and the only one in that
 * header a client cannot forge.
 */
function clientIp(req: express.Request): string {
  if (TRUST_PROXY) {
    const real = (req.headers['x-real-ip'] as string)?.trim();
    if (real) return real;
    const parts = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const appended = parts[parts.length - 1];
    if (appended) return appended;
  }
  return req.socket.remoteAddress || 'unknown';
}

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 15; // requests per window per IP
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = clientIp(req);
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    // Pruned as the AI maps are: an entry for every address ever seen, never
    // dropped, is a slow leak in a long-lived worker — and a fast one for anyone
    // rotating addresses.
    if (rateBuckets.size > 5000) for (const [k, v] of rateBuckets) if (now > v.resetAt) rateBuckets.delete(k);
    return next();
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  bucket.count += 1;
  return next();
}

// Helper to instantiate Gemini client lazily
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * WHICH AI IS CONFIGURED, if any.
 *
 * The provider is whatever verification proved at save time. A key that came in
 * through the host environment was never verified, so its provider is detected
 * from the prefix — a guess, but the only thing available, and Google is the only
 * one that has ever been set that way on this shop.
 */
function currentAi(): { key: string; provider: AiProvider } | null {
  const key = (process.env.GEMINI_API_KEY ?? '').trim();
  if (!key) return null;
  const stored = (process.env.AI_PROVIDER ?? '').trim();
  if (isAiProvider(stored)) return { key, provider: stored };
  return { key, provider: detectProviderFallback(key) };
}

function detectProviderFallback(key: string): AiProvider {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-')) return 'openai';
  return 'google';
}

/**
 * Ask whichever model is configured, and hand back plain text.
 *
 * Throws an object carrying the HTTP status so the caller can turn it into
 * something a CUSTOMER may read — `friendlyAiError` — while the detail goes to
 * the log, where the owner can find it.
 */
async function askAi(req: AiRequest): Promise<{ text: string; provider: AiProvider; model: string }> {
  const ai = currentAi();
  if (!ai) throw Object.assign(new Error('No AI key is configured.'), { status: 503 });

  const model = AI_MODELS[ai.provider][req.tier === 'complex' ? 'complex' : 'fast'];
  const { url, init } = chatRequest(ai.provider, ai.key, req);

  // ONE RETRY, AND ONLY FOR A BUSY PROVIDER.
  //
  // 7 of 23 probe calls to Google on 2026-09-13 came back 503 "this model is
  // currently experiencing high demand", and every one of them succeeded on a
  // later attempt. Without this, each of those is an empty translation box for
  // the owner or a dead bubble for a customer.
  //
  // A 429 IS RETRIED, and it is the only 4xx that is. Google's per-minute window
  // rolls, so a burst that trips at the end of one clears inside 1.5 seconds; a
  // day-quota 429 does not, and costs one extra call to discover. Nothing else in
  // the 4xx range is retried — a wrong key, a retired model and a malformed
  // request do not improve by being asked twice.
  let resp = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
  let detail = resp.ok ? '' : await resp.text().catch(() => '');
  if (!resp.ok && (resp.status === 503 || resp.status === 429 || /high demand/i.test(detail))) {
    console.warn(`${AI_PROVIDER_NAMES[ai.provider]} answered ${resp.status}; retrying once.`);
    await new Promise((r) => setTimeout(r, 1500));
    resp = await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    detail = resp.ok ? '' : await resp.text().catch(() => '');
  }

  // THE SAME TWENTY-A-DAY CAP, on the path the other providers and the
  // non-Google chat take. Asking the smaller model is better than answering
  // nothing, and the log names the reason so it is not mistaken for a fault.
  let answeredWith = model;
  if (!resp.ok && resp.status === 429 && model !== AI_MODELS[ai.provider].fast) {
    const fast = AI_MODELS[ai.provider].fast;
    console.warn(`${AI_PROVIDER_NAMES[ai.provider]}: ${model} is out of quota (429) — retrying on ${fast}.`);
    const fb = chatRequest(ai.provider, ai.key, { ...req, tier: 'fast' });
    resp = await fetch(fb.url, { ...fb.init, signal: AbortSignal.timeout(120_000) });
    detail = resp.ok ? '' : await resp.text().catch(() => '');
    answeredWith = fast;
  }

  if (!resp.ok) {
    // The provider's own words, for the log only. They name models, quotas and
    // sometimes the key itself, and none of that may reach a shopper.
    console.error(`${AI_PROVIDER_NAMES[ai.provider]} answered ${resp.status} for ${answeredWith}: ${detail.slice(0, 300)}`);
    throw Object.assign(new Error('AI request failed.'), { status: resp.status });
  }
  let body: any = await resp.json().catch(() => null);
  let text = extractText(ai.provider, body);
  // DeepSeek documents that JSON mode "may occasionally return empty content":
  // one more ask before the translator or the analysis reports a failure.
  if (!text && ai.provider === 'deepseek' && req.json) {
    const again = chatRequest(ai.provider, ai.key, { ...req, tier: answeredWith === model ? req.tier : 'fast' });
    const retry = await fetch(again.url, { ...again.init, signal: AbortSignal.timeout(120_000) }).catch(() => null);
    if (retry?.ok) {
      body = await retry.json().catch(() => null);
      text = extractText(ai.provider, body);
    }
  }
  if (!text) {
    // An empty answer from a model that was ASKED to think is a real shape: the
    // thoughts can consume the whole output budget and leave finishReason
    // MAX_TOKENS with no text. Saying so names the fix — a bigger budget.
    const finish = body?.candidates?.[0]?.finishReason ?? body?.choices?.[0]?.finish_reason ?? body?.stop_reason ?? '';
    console.error(`${AI_PROVIDER_NAMES[ai.provider]} returned no text from ${answeredWith}${finish ? ` (finishReason ${finish})` : ''}.`);
    throw Object.assign(new Error('AI returned nothing.'), { status: 502 });
  }
  // The model that actually answered — which is not always the one asked for.
  // This used to return an empty string, so every caller that logged or
  // displayed it said nothing at all.
  return { text, provider: ai.provider, model: answeredWith };
}

// NOTHING under /api may be cached, by anyone, ever.
//
// The cPanel host runs an nginx upstream cache in front of the app and it was
// serving API responses out of it — proven by `x-nginx-upstream-cache-status:
// HIT` on /api/health and by the key panel reporting a key that had already
// been replaced. An API response here is per-request truth: an order's payment
// status that a customer polls after paying, a price quote computed for one
// basket, the admin's view of which keys are live. A cache in front of any of
// those hands one person an answer that belongs to another moment — or to
// another person. Static assets keep their long cache; this is /api only.
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Every API request makes sure the dashboard-managed keys are loaded — but no
// request is ever held hostage to Firestore. Once anything is cached (a
// failure counts, with its shorter retry window) the request proceeds at once
// and the refresh happens behind it. Only a cold start waits, and then for
// three seconds at most: the first request after boot may be the payment
// webhook, which must not run against fallback keys when the dashboard holds
// newer ones — but a hung Firestore must not turn every request into a 504
// either.
app.use('/api', (req, res, next) => {
  if (secretsCache) {
    void loadIntegrationSecrets().catch(() => {});
    return next();
  }
  Promise.race([
    loadIntegrationSecrets(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ])
    .catch(() => {})
    .then(() => next());
});

// API Health route
/**
 * WHICH BUILD THIS SERVER IS SERVING.
 *
 * The browser polls it and reloads when the answer changes, so a deploy reaches
 * people who already have the shop open instead of waiting for them to press
 * refresh. It reports the entry bundle's fingerprinted name, which Vite changes
 * on every build that changes anything — no version number to remember to bump.
 *
 * Re-read at most every ten seconds: a deploy swaps the directory underneath a
 * running process, and a value cached for the process's lifetime would keep
 * announcing the build it booted on.
 */
let buildIdCache: { at: number; id: string | null } = { at: 0, id: null };
function currentBuildId(): string | null {
  if (Date.now() - buildIdCache.at < 10_000) return buildIdCache.id;
  let id: string | null = null;
  try {
    const html = fs.readFileSync(path.join(process.cwd(), 'dist', 'index.html'), 'utf8');
    id = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1] ?? null;
  } catch {
    /* dev server, or no build on disk — the browser simply never sees a change */
  }
  buildIdCache = { at: Date.now(), id };
  return id;
}

app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ build: currentBuildId() });
});

// ---------------------------------------------------------------------------
// THE SHOP'S CATALOGUE, served once for everybody instead of read per visitor.
//
// The storefront used to read `products` straight from Firestore in the
// browser, capped at 60 documents — which was fine for a catalogue of eighteen
// and is wrong twice over for one of six hundred: 575 products would be
// unreachable except by direct link, and the ones that DID load cost one billed
// read each, per visitor, on a project whose free read quota has already taken
// this shop dark for seven hours.
//
// This reads them once, with a FIELD MASK so the base64 images inside older
// product documents never leave Firestore, caches the result in the process for
// five minutes, and hands every visitor the same answer. Six hundred visitors
// now cost what one used to.
//
// The browser keeps its Firestore read as a fallback (see App.tsx), so if this
// endpoint is unavailable the shop degrades to exactly the behaviour it had
// before rather than to an empty page.
type CatalogueEntry = Record<string, any>;

// A LAST-KNOWN-GOOD COPY ON DISK, so an unreachable Firestore is not a dark shop.
//
// On 2026-09-12 the project's free daily read quota ran out. Six of six Admin
// SDK reads were refused, six of six browser reads were refused, and /products
// rendered "0 categories" — an empty shop for every visitor. The same thing took
// the shop dark for seven hours once before. The in-memory cache did not help:
// it is five minutes old at most and dies with the process, and Passenger
// recycles this one constantly.
//
// So every successful read is also written here, and a failed read falls back to
// it. A catalogue a few hours old is not ideal; an empty shop is worse, and the
// prices the customer is CHARGED never come from here — the server re-prices
// every order from the product documents at checkout.
//
// Every filesystem operation is wrapped: a read-only deployment must degrade to
// the old behaviour, never fail to boot.
const DISK_CACHE_DIR = path.join(process.cwd(), '.cache');

function readDiskCache<T>(name: string): { at: number; items: T[] } | null {
  try {
    const raw = fs.readFileSync(path.join(DISK_CACHE_DIR, `${name}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items) && typeof parsed.at === 'number') return parsed;
  } catch { /* no copy yet, or an unreadable one — both mean "nothing to fall back to" */ }
  return null;
}

/**
 * The same last-known-good discipline, for an object rather than a list.
 *
 * writeDiskCache hard-codes `{ at, items }`, and the storefront's catalogue
 * fallback depends on that shape — so the index run's cursor and its parsed plan
 * get a sibling rather than a bent version of it. Same tmp-then-rename, for the
 * same reason: a process reaped mid-write must not leave a half-file that parses
 * as an empty plan.
 */
function readCacheJson<T>(name: string): T | null {
  try {
    const raw = fs.readFileSync(path.join(DISK_CACHE_DIR, `${name}.json`), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as T;
  } catch { /* nothing saved yet, or unreadable — both mean "start over" */ }
  return null;
}

function writeCacheJson(name: string, obj: unknown): boolean {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    const target = path.join(DISK_CACHE_DIR, `${name}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
    fs.renameSync(tmp, target);
    return true;
  } catch {
    // A read-only filesystem must not fail the request; the caller reports that
    // the run could not be saved rather than pretending it was.
    return false;
  }
}

/** A file's identity for "has it changed": a restore that keeps the mtime still changes size or inode. */
function fileSig(file: string): string | null {
  try {
    const st = fs.statSync(file);
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch {
    return null;
  }
}

/**
 * The disk copies this process already holds parsed, by file signature —
 * newestCopyWithoutRead. The writer seeds it with the very object it wrote, so
 * a worker never parses the file it has just written.
 */
const parsedDiskCopies = new Map<string, { sig: string; copy: { at: number; items: CatalogueEntry[] } | null }>();

function writeDiskCache(name: string, items: unknown[], at: number = Date.now()): void {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    // Written to a neighbour and renamed, so a process recycled mid-write cannot
    // leave a half-file that parses as an empty catalogue.
    const target = path.join(DISK_CACHE_DIR, `${name}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    // The SAME `at` as the copy in memory: a second Date.now() made the file a
    // millisecond "newer" than the identical copy, and the worker then parsed
    // its own file and held the catalogue twice.
    fs.writeFileSync(tmp, JSON.stringify({ at, items }));
    fs.renameSync(tmp, target);
    const sig = fileSig(target);
    if (sig) parsedDiskCopies.set(name, { sig, copy: { at, items: items as CatalogueEntry[] } });
  } catch { /* a read-only filesystem is not an error worth failing a request for */ }
}

/**
 * WHEN THE SHOP WAS LAST CHANGED FROM THE DASHBOARD (or by an import), for every
 * worker: a stamp on disk, because an invalidation reaches only the process that
 * received it. A copy older than this is not used where it would be shown as
 * the truth without being reloaded — the suggestions under a product.
 */
const INVALIDATION_STAMP = path.join(DISK_CACHE_DIR, 'invalidated-at.json');
let knownStamp: { sig: string | null; at: number } = { sig: null, at: 0 };
function stampShopInvalidation(): void {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    const tmp = `${INVALIDATION_STAMP}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ at: Date.now() }));
    fs.renameSync(tmp, INVALIDATION_STAMP);
  } catch { /* nothing to stamp on: copies then age out by SUGGESTION_COPY_MAX_AGE_MS */ }
}
function shopInvalidatedAt(): number {
  const sig = fileSig(INVALIDATION_STAMP);
  if (!sig) return 0;
  if (sig === knownStamp.sig) return knownStamp.at;
  try {
    const at = Number(JSON.parse(fs.readFileSync(INVALIDATION_STAMP, 'utf8'))?.at) || 0;
    knownStamp = { sig, at };
    return at;
  } catch {
    return 0;
  }
}
let shopCatalogueCache: { at: number; items: CatalogueEntry[] } | null = null;
let shopCatalogueInflight: Promise<CatalogueEntry[]> | null = null;
/**
 * HOW LONG A COPY OF THE PRODUCTS OR THE CATEGORIES IS USED WHEN NOTHING CHANGED.
 *
 * It was five minutes — ten for the search engines' own copy — each worker on its
 * own, and every reload reads EVERY product document. With visitors and crawlers
 * keeping the copies warm all day that was ~47 000 reads a day for one worker: the
 * free database's whole 50 000. It ran out at 19:58 UTC on 2026-10-06; the shop
 * served its disk copy, orders could not be read, and the owner's own login showed
 * him as a customer, until the quota came back at 07:00 UTC.
 *
 * A change no longer waits for a copy to age: every save from the dashboard (and
 * every import) stamps INVALIDATION_STAMP, and EVERY worker checks the stamp before
 * it uses a copy. This is only the safety net for an edit made outside the
 * dashboard (the Firebase console, a script). And a copy one worker reads is on
 * disk for all the others — the host reads its products about once an hour.
 */
//
// A DAY, NOT AN HOUR (2026-10-09). Measured in Cloud Monitoring: the products had
// grown to ~9 MB (pictures inside the documents), so the hourly safety-net reload of
// the 87 products cost ~2 230 read units — ~53 000 a day on its own, more than the
// free database's whole limit; the shop went dark at ~23:00 UTC with nothing else
// running. Every writer refreshes the copy at once anyway (the dashboard's saves,
// the importer, the picture scripts), so this only bounds an edit made behind their
// back — the Firebase console — which then shows within a day.
const SHOP_COPY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A disk copy as this worker last parsed it — parsed again only when the file changed.
 * `site-settings` and `product-<id>` (2026-10-08) are copies of the same kind.
 */
function diskCopyOf(name: 'catalogue' | 'categories' | 'site-settings' | `product-${string}`): { at: number; items: CatalogueEntry[] } | null {
  const sig = fileSig(path.join(DISK_CACHE_DIR, `${name}.json`));
  if (!sig) return null;
  const known = parsedDiskCopies.get(name);
  if (known && known.sig === sig) return known.copy;
  const copy = readDiskCache<CatalogueEntry>(name);
  parsedDiskCopies.set(name, { sig, copy });
  return copy;
}

/**
 * A copy that may be used WITHOUT a read: made after the last change (the stamp
 * any worker writes) and younger than SHOP_COPY_MAX_AGE_MS — this worker's own, or
 * the one on disk that another worker read.
 */
function freshShopCopy(
  name: 'catalogue' | 'categories' | 'site-settings' | `product-${string}`,
  memory: { at: number; items: CatalogueEntry[] } | null,
): { at: number; items: CatalogueEntry[] } | null {
  const now = Date.now();
  const since = shopInvalidatedAt();
  const fresh = (c: { at: number } | null): boolean => !!c && c.at >= since && now - c.at < SHOP_COPY_MAX_AGE_MS;
  if (fresh(memory)) return memory;
  const disk = diskCopyOf(name);
  return fresh(disk) ? disk : null;
}

/**
 * Read with the catalogue for the search engines' pages (server-seo.ts), which
 * used to read every product again on a ten-minute clock of its own: one read now
 * serves both. Short strings — /api/catalogue leaves them out of what it sends.
 */
const SEO_ONLY_FIELDS = [
  'updatedAt', 'seoTitle', 'seoDescription', 'seoNoindex', 'seoExcludeFromSitemap',
  'brand', 'gtin', 'mpn', 'condition', 'googleProductCategory',
] as const;
/** A product card as a visitor receives it: without the search-engine fields. */
function withoutSeoFields(p: CatalogueEntry): CatalogueEntry {
  const out: CatalogueEntry = { ...p };
  for (const k of SEO_ONLY_FIELDS) delete out[k];
  return out;
}

// A PAGE, not the catalogue.
//
// Serving the whole thing was right for 33 products and is wrong for what is
// coming: midocean alone is 2519 masters, and at the ~925 bytes a card costs
// today that is a 2.3 MB response on every first visit — 14 MB if the variants
// land as products. The cache above stays exactly as it was, because it is what
// keeps the Firestore bill flat (one read set per five minutes, however many
// visitors); what changes is that the RESPONSE is now one page of it.
const CATALOGUE_PAGE_DEFAULT = 60;
const CATALOGUE_PAGE_MAX = 200;

/** Dropped whenever products are written by the importer, so a fresh import shows at once. */
function invalidateShopCatalogue(): void {
  shopCatalogueCache = null;
  // …and every OTHER worker's copy is marked out of date for the suggestions,
  // which come back correct after one reload shortly after the last change.
  stampShopInvalidation();
  scheduleShopCopyRefresh();
}

/**
 * The cached, field-masked, visible catalogue, sorted by name.
 *
 * Both endpoints below go through this, so the counts can never disagree with
 * the pages — they are two views of one array.
 */
async function loadShopCatalogue(): Promise<CatalogueEntry[]> {
  const copy = freshShopCopy('catalogue', shopCatalogueCache);
  if (copy) {
    shopCatalogueCache = copy;
    return copy.items;
  }

  if (!shopCatalogueInflight) {
    shopCatalogueInflight = (async () => {
      const db = getAdminDb();
      if (!db) throw new Error('no-admin-db');
      // The copy is dated when the read STARTED: a change signalled while it was in
      // flight (the stamp) then makes it out of date at once, instead of a pre-change
      // copy passing for fresh for up to SHOP_COPY_MAX_AGE_MS (2026-10-08 review).
      const readAt = Date.now();
      const snap = await db
        .collection('products')
        // Exactly what a product CARD needs, and nothing else. `images` is
        // included because the card shows one — but see the note below.
        .select(
          'name', 'nameI18n', 'description', 'descriptionI18n', 'slug', 'categoryId',
          'basePrice', 'salePrice', 'images', 'isHidden', 'isWeb2Print',
          'minQuantity', 'maxQuantity', 'stock',
          // The card decides whether a product is on offer by running the
          // shop's own pricing function, and that answer depends on the
          // MINIMUM-PRICE FLOOR and the volume tiers. Without these two the
          // card fell back to PRICING_DEFAULTS — a 149 kr floor on a product
          // whose owner had set none — and hid a genuine offer on anything
          // priced below it. They are small config objects; `printingFields`,
          // which is the big one, stays out, and the configurator fetches the
          // whole document when the shopper opens it.
          'customUploadRules', 'pricingRules',
          // 15.6.10 — AND WHETHER THIS PRODUCT TAKES A PRINT FILE. The
          // storefront decides that from `artworkEnabled === true`, so a
          // product served through this masked path looked to the shop like one
          // the owner had never ticked: during a read-quota outage, when the
          // fallback catalogue is what the product page gets, the upload box
          // would vanish from exactly the products he had just switched it on
          // for — and it would have read as the upload work being broken.
          'artworkEnabled', 'artworkRequired',
          // The search engines' fields: the same read serves their pages.
          ...SEO_ONLY_FIELDS,
        )
        .get();
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((p) => p.isHidden !== true)
        .map((p) => ({
          ...p,
          // ONLY THE FIRST IMAGE, and only its reference. A card shows one
          // picture; sending all of them would put a product's entire photo
          // set — which for older products is base64 inline — into a response
          // every visitor downloads.
          images: Array.isArray(p.images) && p.images.length > 0 ? [p.images[0]] : [],
        }))
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
      const at = readAt;
      shopCatalogueCache = { at, items };
      writeDiskCache('catalogue', items, at);
      noteDatabaseRead();
      return items;
    })()
      .catch((err) => {
        noteDatabaseRead(err);
        throw err;
      })
      .finally(() => { shopCatalogueInflight = null; });
  }

  return shopCatalogueInflight;
}

// The search engines' pages (sitemap, feed, the head of every crawled page) read
// THIS copy rather than every product again on a clock of their own.
setCatalogueSource(async () => {
  try {
    return await loadShopCatalogue();
  } catch {
    // An outage: the last good copy, as /api/catalogue serves — an empty sitemap
    // tells Google the shop has no products, and Google acts on it.
    return (shopCatalogueCache ?? diskCopyOf('catalogue'))?.items ?? [];
  }
});

/**
 * An opaque cursor naming the LAST item served, not an offset.
 *
 * An offset silently skips or repeats products when the five-minute cache
 * refreshes between two pages of the same scroll — the array it indexes into is
 * not the array it was built from. Naming the last item survives that: the next
 * page is whatever sorts after it, whether or not the list moved underneath.
 */
function encodeCatalogueCursor(item: CatalogueEntry, rank: number | null = null): string {
  return Buffer.from(
    JSON.stringify({ n: String(item.name ?? ''), i: String(item.id), ...(rank !== null ? { r: rank } : {}) }),
    'utf8',
  ).toString('base64url');
}
/** `r` is the item's place in his arranged order, when the page had one. */
function decodeCatalogueCursor(raw: unknown): { n: string; i: string; r?: number } | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (parsed && typeof parsed.n === 'string' && typeof parsed.i === 'string') {
      return { n: parsed.n, i: parsed.i, ...(Number.isFinite(parsed.r) ? { r: Number(parsed.r) } : {}) };
    }
  } catch { /* a cursor a visitor edited is not an error — it just starts over */ }
  return null;
}

app.get('/api/catalogue', async (req, res) => {
  try {
    const cachedBefore = Boolean(shopCatalogueCache);

    // Where the products come from is decided FIRST, and everything after it is
    // the same code for every source. An earlier version had the stale path
    // return its own hard-coded first 60 with no cursor, which meant that during
    // the very outage this exists for, a category of 200 products showed 60 and
    // offered no way to see the rest.
    let items: CatalogueEntry[];
    let stale = false;
    let asOf: string | null = null;
    try {
      items = await loadShopCatalogue();
    } catch (err: any) {
      const fallback = shopCatalogueCache ?? readDiskCache<CatalogueEntry>('catalogue');
      if (!fallback) {
        if (err?.message === 'no-admin-db') return res.status(503).json({ error: 'Catalogue is unavailable.' });
        throw err;
      }
      console.error('Catalogue read failed, serving the last known good copy:', err?.message ?? err);
      items = fallback.items;
      stale = true;
      asOf = new Date(fallback.at).toISOString();
    }

    // The matching rules live in src/lib/catalogueQuery.ts so the browser's
    // Firestore fallback can use the very same ones, and so they can be unit
    // tested — see the note at the top of that file.
    const categories = parseCategoryFilter(req.query.category);
    const needle = normaliseQuery(req.query.q);
    let filtered = categories || needle
      ? items.filter((p) => matchesCatalogueFilters(p, categories, needle))
      : items;

    // HIS ORDER FOR THIS CATEGORY PAGE (src/lib/ownerOrder.ts). The shop sends
    // `order=<category id>` when it shows one category; a search across the shop
    // keeps the plain name order, because no arrangement was made for it.
    const orderIds = typeof req.query.order === 'string' && !needle
      ? await productOrderFor(req.query.order.slice(0, 200))
      : null;
    const ranks = orderIds ? rankMap(orderIds) : null;
    if (orderIds) filtered = orderByIdList(filtered, orderIds);

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), CATALOGUE_PAGE_MAX)
      : CATALOGUE_PAGE_DEFAULT;

    // After the item the cursor names, or — if that item is gone — after its
    // sort position (src/lib/ownerOrder.ts, tested in test-owner-order.mjs).
    const from = pageStartAfter(filtered, decodeCatalogueCursor(req.query.cursor), ranks);

    const page = filtered.slice(from, from + limit);
    const last = page[page.length - 1];
    return res.json({
      products: page.map(withoutSeoFields),
      total: filtered.length,
      nextCursor: from + page.length < filtered.length && last
        ? encodeCatalogueCursor(last, ranks?.get(String(last.id)) ?? null)
        : null,
      cached: cachedBefore,
      ...(stale ? { stale: true, asOf } : {}),
    });
  } catch (err: any) {
    return publicReadError(res, err, 'Could not load the catalogue.');
  }
});

/**
 * The products' own photos, for order lines that did not freeze one (orders before
 * 2026-10): the job sheet and packing slip show them big. From the catalogue copy
 * the shop keeps — public pictures, at most 50 ids, no per-id read.
 */
app.get('/api/catalogue/images', async (req, res) => {
  try {
    await loadShopCatalogue().catch(() => null);
    const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    const known = productImageMap();
    const images: Record<string, string> = {};
    for (const id of ids) {
      const url = known.get(id);
      if (url) images[id] = url;
    }
    return res.json({ images });
  } catch (err: any) {
    return publicReadError(res, err, 'Could not load the pictures.');
  }
});

/**
 * How many products each category holds — the whole point being that the shop no
 * longer downloads the catalogue in order to count it.
 *
 * Keyed by the RAW `categoryId` stored on the product, so the browser adds up the
 * id form and the name form itself. The server stays ignorant of the categories
 * collection, which is one fewer read and one fewer thing to disagree about.
 */
app.get('/api/catalogue/counts', async (req, res) => {
  try {
    const cachedBefore = Boolean(shopCatalogueCache);
    let items: CatalogueEntry[];
    try {
      items = await loadShopCatalogue();
    } catch (err: any) {
      // The tiles show a count or they show nothing; yesterday's count is far
      // closer to the truth than a zero beside every category.
      const fallback = shopCatalogueCache ?? readDiskCache<CatalogueEntry>('catalogue');
      if (!fallback) {
        if (err?.message === 'no-admin-db') return res.status(503).json({ error: 'Catalogue is unavailable.' });
        throw err;
      }
      items = fallback.items;
    }
    const byCategory: Record<string, number> = {};
    for (const p of items) {
      const key = String(p.categoryId ?? '');
      if (!key) continue;
      byCategory[key] = (byCategory[key] ?? 0) + 1;
    }
    return res.json({ total: items.length, byCategory, cached: cachedBefore });
  } catch (err: any) {
    return publicReadError(res, err, 'Could not load the catalogue counts.');
  }
});

// ---------------------------------------------------------------------------
// THE CATEGORIES, and the product-URL lookup, served the same way.
//
// WHY THIS EXISTS
// Every visitor's browser read `categories` straight out of Firestore — twice,
// because the home page reads them as well as the shop page. On 2026-09-12 the
// project's free daily read quota ran out and 20 of 20 probe reads came back
// refused, so `/products` rendered "0 categories": an empty shop, intermittently,
// for everyone. The catalogue survived it because the server had already been
// caching that for five minutes and serving one answer to everybody. This gives
// the categories the same protection.
//
// It also removes the worst amplifier in the shop. ProductPage fell back to
// `getDocs(collection(db,'products'))` — the WHOLE catalogue, 109 documents and
// climbing — whenever a product URL did not resolve by id or slug. A mistyped
// link or a crawler hitting a stale URL therefore cost a full scan each time.
// /api/catalogue/resolve answers the same question from the cache that is
// already in memory.
let shopCategoriesCache: { at: number; items: CatalogueEntry[] } | null = null;
let shopCategoriesInflight: Promise<CatalogueEntry[]> | null = null;

function invalidateShopCategories(): void {
  shopCategoriesCache = null;
}

async function loadShopCategories(): Promise<CatalogueEntry[]> {
  const copy = freshShopCopy('categories', shopCategoriesCache);
  if (copy) {
    shopCategoriesCache = copy;
    return copy.items;
  }
  if (!shopCategoriesInflight) {
    shopCategoriesInflight = (async () => {
      const db = getAdminDb();
      if (!db) throw new Error('no-admin-db');
      // The copy is dated when the read STARTED: a change signalled while it was in
      // flight (the stamp) then makes it out of date at once, instead of a pre-change
      // copy passing for fresh for up to SHOP_COPY_MAX_AGE_MS (2026-10-08 review).
      const readAt = Date.now();
      const snap = await db
        .collection('categories')
        // The storefront's fields only. `printingFields` in particular is the
        // big one and belongs to the dashboard, which reads its own documents.
        // `sortOrder` and `productOrder` are the owner's arrangement — the
        // categories' order, and the order of one category page's products
        // (src/lib/ownerOrder.ts). productOrder stays on the SERVER: /api/catalogue
        // sorts with it, and /api/categories strips it before answering.
        .select('name', 'nameI18n', 'description', 'descriptionI18n', 'parentId', 'image', 'isHidden', 'hiddenOnHome', 'sortOrder', 'productOrder')
        .get();
      const items = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        // isHidden lets junk or not-yet-ready entries (test categories, broken
        // imports) be taken off the storefront without deleting the data.
        .filter((c) => c.isHidden !== true);
      // TREE order, not one flat sort: `sortOrder` means "place among my
      // siblings" (each level is numbered 10, 20, 30… on its own), so a flat
      // sort put three arranged sub-categories ahead of every main category.
      // Depth-first gives main category, its children, next main category —
      // and an unarranged shop the same A–Ö order as before.
      const ordered = flattenTree(buildCategoryTree(items as any[])).map((n) => n.category);
      const at = readAt;
      shopCategoriesCache = { at, items: ordered };
      writeDiskCache('categories', ordered, at);
      noteDatabaseRead();
      return ordered;
    })()
      .catch((err) => {
        noteDatabaseRead(err);
        throw err;
      })
      .finally(() => { shopCategoriesInflight = null; });
  }
  return shopCategoriesInflight;
}

/**
 * A category as a visitor receives it: without `productOrder`, which is a list
 * of product ids per category that only /api/catalogue needs. Every visitor
 * downloads /api/categories; there is no reason for that to grow with every
 * product he arranges.
 */
function withoutProductOrder(c: CatalogueEntry): CatalogueEntry {
  if (!c || !('productOrder' in c)) return c;
  const { productOrder: _omit, ...rest } = c as any;
  return rest;
}

/**
 * The owner's product order for ONE category page, if he arranged one.
 * Read from the categories cache the shop already holds — no Firestore read of
 * its own — and from the disk copy when Firestore is refusing reads.
 */
async function productOrderFor(categoryId: string): Promise<string[] | null> {
  if (!categoryId) return null;
  let cats: CatalogueEntry[] | null = null;
  try {
    cats = await loadShopCategories();
  } catch {
    cats = (shopCategoriesCache ?? readDiskCache<CatalogueEntry>('categories'))?.items ?? null;
  }
  const cat = cats?.find((c) => String(c.id) === categoryId);
  const order = (cat as any)?.productOrder;
  return Array.isArray(order) && order.length > 0 ? order.map(String) : null;
}

app.get('/api/categories', async (req, res) => {
  try {
    const cachedBefore = Boolean(shopCategoriesCache);
    const items = await loadShopCategories();
    return res.json({ categories: items.map(withoutProductOrder), cached: cachedBefore });
  } catch (err: any) {
    console.error('Categories read failed:', err);
    // The last good copy beats an empty shop. "No Admin SDK" lands here too: a
    // server that cannot talk to Firestore at all is exactly when the copy on
    // disk is worth the most.
    const fallback = shopCategoriesCache ?? readDiskCache<CatalogueEntry>('categories');
    if (fallback) {
      return res.json({
        categories: fallback.items.map(withoutProductOrder), cached: true, stale: true,
        asOf: new Date(fallback.at).toISOString(),
      });
    }
    if (err?.message === 'no-admin-db') return res.status(503).json({ error: 'Categories are unavailable.' });
    return publicReadError(res, err, 'Could not load the categories.');
  }
});

/**
 * THE SITE SETTINGS, AS ONE COPY — for every visitor and every reader on this server.
 *
 * The free database's read limit is counted in READ UNITS BY SIZE (about 4 KB a
 * unit, measured in Cloud Monitoring on 2026-10-08), and settings/siteConfig had
 * grown to ~800 KB: the UI Customizer stored its pictures inside it. One read of it
 * cost ~209 units, and it was read
 *  - by EVERY visitor's browser, which kept a live listener on it — ~240 visits a
 *    day spent the whole 50 000 on their own;
 *  - by this server every 15 minutes (the stage sweep wanted `autoStages`; its
 *    10-minute cache always missed the 15-minute timer), and by the search pages,
 *    the delivery promise and the designer's AI switch — ~40 000 units a day with
 *    no visitor at all. A field mask does not reduce the units.
 * The quota ran out at ~21:00 UTC on 2026-10-07 with the shop otherwise quiet.
 *
 * Now it is read here once per change (the dashboard's save stamps
 * INVALIDATION_STAMP, as products and categories do; 60 minutes at most), shared
 * through the disk copy by every worker, and served to visitors by
 * GET /api/site-settings. Only the dashboard keeps a live listener. When Firestore
 * refuses, the last copy is served marked stale — the shop keeps its own look.
 */
/**
 * How long a visitor waits for a copy's READ before the last copy is served instead.
 * A refusal answers at once; a slow or unreachable database must not hold a page —
 * the read goes on in the background and leaves its copy for the next request.
 */
const COPY_READ_PATIENCE_MS = 4000;
function patience<T>(work: Promise<T>, ms = COPY_READ_PATIENCE_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The database is slow to answer.')), ms);
    timer.unref?.();
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
/** The newer of two copies (this worker's own, or another worker's on disk). */
function newerCopy<T extends { at: number }>(a: T | null, b: T | null): T | null {
  if (!a) return b;
  if (!b) return a;
  return b.at > a.at ? b : a;
}
let siteSettingsCache: { at: number; items: CatalogueEntry[] } | null = null;
let siteSettingsInflight: Promise<{ data: Record<string, any> | null; at: number }> | null = null;
async function loadSiteSettingsCopy(): Promise<{ data: Record<string, any> | null; at: number; stale: boolean }> {
  const copy = freshShopCopy('site-settings', siteSettingsCache);
  if (copy) {
    siteSettingsCache = copy;
    return { data: (copy.items[0] as any)?.data ?? null, at: copy.at, stale: false };
  }
  if (!siteSettingsInflight) {
    siteSettingsInflight = (async () => {
      const db = getAdminDb();
      if (!db) throw new Error('no-admin-db');
      // The copy is dated when the read STARTED: a change signalled while it was in
      // flight (the stamp) then makes it out of date at once, instead of a pre-change
      // copy passing for fresh for up to SHOP_COPY_MAX_AGE_MS (2026-10-08 review).
      const at = Date.now();
      const snap = await db.collection('settings').doc('siteConfig').get();
      const data = snap.exists ? ((snap.data() ?? {}) as Record<string, any>) : null;
      siteSettingsCache = { at, items: [{ id: 'siteConfig', data }] };
      writeDiskCache('site-settings', siteSettingsCache.items, at);
      noteDatabaseRead();
      return { data, at };
    })()
      .catch((err) => {
        noteDatabaseRead(err);
        throw err;
      })
      .finally(() => { siteSettingsInflight = null; });
  }
  try {
    return { ...(await patience(siteSettingsInflight)), stale: false };
  } catch (err) {
    const last = newerCopy(siteSettingsCache, diskCopyOf('site-settings'));
    if (!last) throw err;
    return { data: (last.items[0] as any)?.data ?? null, at: last.at, stale: true };
  }
}

app.get('/api/site-settings', async (_req, res) => {
  try {
    const { data, at, stale } = await loadSiteSettingsCopy();
    // `settings: null` is a database with no settings document: the shop then
    // shows its defaults. Nothing here ever writes one — that is the dashboard's.
    return res.json({ settings: data, ...(stale ? { stale: true, asOf: new Date(at).toISOString() } : {}) });
  } catch (err: any) {
    if (err?.message === 'no-admin-db') return res.status(503).json({ error: 'Settings are unavailable.' });
    return publicReadError(res, err, 'Could not load the site settings.');
  }
});

/**
 * ONE PRODUCT, WHOLE, FROM THE SERVER'S COPY — 2026-10-08.
 *
 * The product page read its product straight from Firestore in the visitor's
 * browser, so while the read limit was out every product page said "We could not
 * find that product — it may have been removed": the client's screenshot of his
 * best seller. The page now asks here first: one read per product per change from
 * the dashboard (the same stamp as the catalogue), kept on disk for every worker,
 * and the last copy when Firestore refuses. Visible products only — a hidden one
 * has no public page, and the owner's own VIEW still reads Firestore directly.
 */
const productCopies = new Map<string, { at: number; items: CatalogueEntry[] }>();
const productInflight = new Map<string, Promise<{ product: Record<string, any> | null; at: number }>>();
async function loadProductCopy(id: string): Promise<{ product: Record<string, any> | null; at: number; stale: boolean }> {
  const name = `product-${id}` as const;
  const copy = freshShopCopy(name, productCopies.get(id) ?? null);
  if (copy) {
    productCopies.set(id, copy);
    return { product: (copy.items[0] as any)?.product ?? null, at: copy.at, stale: false };
  }
  let inflight = productInflight.get(id);
  if (!inflight) {
    inflight = (async () => {
      const db = getAdminDb();
      if (!db) throw new Error('no-admin-db');
      // The copy is dated when the read STARTED: a change signalled while it was in
      // flight (the stamp) then makes it out of date at once, instead of a pre-change
      // copy passing for fresh for up to SHOP_COPY_MAX_AGE_MS (2026-10-08 review).
      const at = Date.now();
      const snap = await db.collection('products').doc(id).get();
      const product = snap.exists ? { id: snap.id, ...(snap.data() as Record<string, any>) } : null;
      const entry = { at, items: [{ id, product }] };
      productCopies.set(id, entry);
      writeDiskCache(name, entry.items, at);
      noteDatabaseRead();
      return { product, at };
    })()
      .catch((err) => {
        noteDatabaseRead(err);
        throw err;
      })
      .finally(() => { productInflight.delete(id); });
    productInflight.set(id, inflight);
  }
  try {
    return { ...(await patience(inflight)), stale: false };
  } catch (err) {
    const last = newerCopy(productCopies.get(id) ?? null, diskCopyOf(name));
    if (!last) throw err;
    return { product: (last.items[0] as any)?.product ?? null, at: last.at, stale: true };
  }
}

app.get('/api/catalogue/product', async (req, res) => {
  try {
    const param = String(req.query.param ?? '').trim();
    if (!param || param.length > 300) return res.status(400).json({ error: 'Nothing to look up.' });
    // The address → the id, from the catalogue copy (as /api/catalogue/resolve).
    let items: CatalogueEntry[];
    try {
      items = await loadShopCatalogue();
    } catch (err: any) {
      const fallback = shopCatalogueCache ?? readDiskCache<CatalogueEntry>('catalogue');
      if (!fallback) throw err;
      items = fallback.items;
    }
    const wanted = param.toLowerCase();
    const hit =
      items.find((p) => String(p.slug ?? '').toLowerCase() === wanted) ??
      items.find((p) => String(p.id) === param) ??
      items.find((p) => slugify(String(p.name ?? '')) === wanted);
    if (!hit || !/^[A-Za-z0-9_-]{1,128}$/.test(String(hit.id))) return res.status(404).json({ error: 'No such product.' });
    const { product, at, stale } = await loadProductCopy(String(hit.id));
    if (!product || product.isHidden === true) return res.status(404).json({ error: 'No such product.' });
    return res.json({ product, ...(stale ? { stale: true, asOf: new Date(at).toISOString() } : {}) });
  } catch (err: any) {
    if (err?.message === 'no-admin-db') return res.status(503).json({ error: 'The product is unavailable.' });
    return publicReadError(res, err, 'Could not load the product.');
  }
});

/**
 * Turn what is in a product URL into a product id, without reading Firestore.
 *
 * ProductPage tries the id, then an indexed slug query, and only then fell back
 * to walking every product because a product saved before slugs existed carries
 * no slug field and has to be matched on its name. That walk is what this
 * replaces: the cached catalogue already holds `slug` and `name`.
 *
 * It answers for VISIBLE products only, which is the same set the fallback could
 * usefully find — a hidden product has no public page.
 */
app.get('/api/catalogue/resolve', async (req, res) => {
  try {
    const param = String(req.query.param ?? req.query.slug ?? '').trim();
    if (!param) return res.status(400).json({ error: 'Nothing to resolve.' });
    // Disk fallback here too: this exists to spare the browser a full-catalogue
    // scan, and the moment it stops answering the browser goes back to doing
    // exactly that — at the worst possible time, when Firestore is already
    // refusing reads.
    let items: CatalogueEntry[];
    try {
      items = await loadShopCatalogue();
    } catch (err: any) {
      const fallback = shopCatalogueCache ?? readDiskCache<CatalogueEntry>('catalogue');
      if (!fallback) throw err;
      items = fallback.items;
    }
    const wanted = param.toLowerCase();
    const hit =
      items.find((p) => String(p.slug ?? '').toLowerCase() === wanted) ??
      items.find((p) => String(p.id) === param) ??
      items.find((p) => slugify(String(p.name ?? '')) === wanted);
    if (!hit) return res.status(404).json({ error: 'No such product.' });
    return res.json({ id: hit.id, slug: hit.slug ?? null });
  } catch (err: any) {
    if (err?.message === 'no-admin-db') return res.status(503).json({ error: 'Lookup is unavailable.' });
    console.error('Catalogue resolve failed:', err);
    return res.status(500).json({ error: 'Could not resolve the product.' });
  }
});

/**
 * The oldest copy the suggestions will show, whatever else is known. The same as
 * the shop's own copy since 2026-10-09: that copy is now reloaded once a day (or at
 * once on a change), and with two hours here the row would vanish two hours after
 * every reload. "Current" is still guaranteed by the stamp, not by the age.
 */
const SUGGESTION_COPY_MAX_AGE_MS = SHOP_COPY_MAX_AGE_MS;

/**
 * The newest copy of a cached list this process can have WITHOUT reading
 * Firestore: its own memory, or the disk copy whichever worker last wrote — the
 * newer of the two; the disk copy parsed once per change of the file.
 *
 * `current`: only a copy made AFTER the last change from the dashboard
 * (shopInvalidatedAt) and younger than SUGGESTION_COPY_MAX_AGE_MS — otherwise
 * nothing. A review found the suggestions showing a product hidden an hour
 * earlier, with an offer that had ended, because nobody had opened the shop
 * grid since; no row is better than a wrong one.
 */
function newestCopyWithoutRead(
  name: 'catalogue' | 'categories',
  memory: { at: number; items: CatalogueEntry[] } | null,
  { current }: { current: boolean },
): { at: number; items: CatalogueEntry[] } | null {
  const now = Date.now();
  const since = current ? shopInvalidatedAt() : 0;
  const usable = (c: { at: number } | null): boolean =>
    !!c && (!current || (c.at >= since && now - c.at < SUGGESTION_COPY_MAX_AGE_MS));
  // This worker's own copy, still within its lifetime, is the newest there is —
  // unless the shop changed since — and no file is looked at.
  if (memory && now - memory.at < SHOP_COPY_MAX_AGE_MS && usable(memory)) return memory;
  const disk = diskCopyOf(name);
  const newest = memory && (!disk || memory.at >= disk.at) ? memory : disk;
  return usable(newest) ? newest : null;
}

/**
 * After a change from the dashboard: ONE reload of the shop's copy, ten seconds
 * after the last of a burst of saves, so the suggestions come back correct
 * without waiting for a visitor to open the shop grid. A read per burst of the
 * owner's saves — the grid's next visit would have made it anyway — never one
 * per product page view.
 */
let shopRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleShopCopyRefresh(): void {
  if (shopRefreshTimer) clearTimeout(shopRefreshTimer);
  shopRefreshTimer = setTimeout(() => {
    shopRefreshTimer = null;
    void loadShopCatalogue().catch((err) => console.warn('Shop copy refresh failed:', err?.message ?? err));
    void loadShopCategories().catch(() => {});
    void loadSiteSettingsCopy().catch(() => {});
  }, 10_000);
  shopRefreshTimer.unref?.();
}

/**
 * SUGGESTED PRODUCTS under a product — round 16, item 10 (src/lib/suggestions.ts).
 *
 * ⚠️ THIS ROUTE STARTS NO CATALOGUE READ. Every product page asks it, Googlebot
 * included, and the free plan's daily read quota has taken the whole shop down
 * three times; loading the catalogue here would make every cold worker read
 * every product document on a product page view. It answers from the copy the
 * shop grid already keeps — in memory or on disk, the newer, and only one made
 * since the last change — and with nothing at all otherwise: the row is a
 * suggestion, not the page. (The /api middleware's settings read, one document
 * per worker per five minutes, applies to every /api route alike.)
 *
 * The page sends his picks (it holds the product) and the product's raw
 * categoryId, so nothing about the product needs reading either.
 */
const SUGGESTION_CARD_FIELDS = [
  'id', 'slug', 'name', 'nameI18n', 'basePrice', 'salePrice', 'minQuantity', 'customUploadRules', 'pricingRules', 'isWeb2Print',
] as const;
app.get('/api/catalogue/suggestions', (req, res) => {
  try {
    const list = (raw: unknown) => String(raw ?? '').split(',').map((v) => v.trim().slice(0, 200)).filter(Boolean);
    const catalogue = newestCopyWithoutRead('catalogue', shopCatalogueCache, { current: true })?.items ?? [];
    // Categories decide only the ORDER of the fill; any copy will do.
    const categories = newestCopyWithoutRead('categories', shopCategoriesCache, { current: false })?.items ?? [];
    const picked = pickSuggestions(catalogue as any[], categories as any[], {
      picks: list(req.query.ids).slice(0, 12),
      categoryId: String(req.query.category ?? '').slice(0, 200),
      exclude: String(req.query.exclude ?? '').slice(0, 200),
      fill: req.query.fill === '1',
      limit: SUGGESTION_COUNT,
    });
    // A card's fields, and the FIRST picture only — never a product's whole set.
    const products = picked.map((p: any) => ({
      ...Object.fromEntries(SUGGESTION_CARD_FIELDS.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])),
      images: Array.isArray(p.images) && p.images.length > 0 ? [p.images[0]] : [],
    }));
    // No Cache-Control of its own: NOTHING under /api may be cached (the /api
    // middleware says why — the host's nginx served cached /api answers).
    return res.json({ products });
  } catch (err) {
    console.error('Suggestions failed:', err);
    return res.json({ products: [] });
  }
});

/**
 * THE OWNER'S DESIGN TEMPLATES — round 16, item 5b (src/lib/designTemplateDoc.ts,
 * src/lib/designTemplateMatch.ts).
 *
 * Every product page that offers the online designer asks for them, so NO page
 * view may read Firestore for them (the free plan's daily read quota has taken
 * the shop down three times). The policy — memory, then the disk copy every
 * worker shares, then ONE read; a copy counts only when taken after the owner's
 * last change; a refused read falls back to the newest copy and is not retried
 * for a minute — is src/lib/templateCopies.ts, tested in scripts/test-design.mjs.
 * With no copy at all the routes answer 503, so the page can say "could not
 * load" and offer a retry, rather than "there are none".
 *
 * Its own stamp file: a template save must not mark the catalogue stale, which
 * would re-read every product ten seconds later (scheduleShopCopyRefresh).
 */
const TEMPLATES_STAMP = path.join(DISK_CACHE_DIR, 'templates-invalidated-at.json');
const TEMPLATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TEMPLATES_RETRY_MS = 60 * 1000;
let templatesStampKnown: { sig: string | null; at: number } = { sig: null, at: 0 };

function templatesInvalidatedAt(): number {
  const sig = fileSig(TEMPLATES_STAMP);
  if (!sig) return 0;
  if (sig === templatesStampKnown.sig) return templatesStampKnown.at;
  try {
    const at = Number(JSON.parse(fs.readFileSync(TEMPLATES_STAMP, 'utf8'))?.at) || 0;
    templatesStampKnown = { sig, at };
    return at;
  } catch {
    return 0;
  }
}

/** False when the stamp could not be written: then no worker learns of the change. */
function stampTemplatesInvalidation(): boolean {
  try {
    // Later than every copy there is, whatever the clock did since: a copy dated
    // after the change would be taken for one that already holds it.
    const at = Math.max(Date.now(), templatesInvalidatedAt() + 1, designTemplateCopies.newestAt() + 1);
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    const tmp = `${TEMPLATES_STAMP}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ at }));
    fs.renameSync(tmp, TEMPLATES_STAMP);
    return true;
  } catch {
    return false;
  }
}

/**
 * The templates' disk copy, parsed once per change of the file — not on every
 * request, which is what a quota outage would otherwise cost: each designer
 * opening parsing every template's design.
 */
function diskTemplates(): { at: number; items: TemplateFull[] } | null {
  const sig = fileSig(path.join(DISK_CACHE_DIR, 'design-templates.json'));
  if (!sig) return null;
  const known = parsedDiskCopies.get('design-templates');
  if (known && known.sig === sig) return known.copy as unknown as { at: number; items: TemplateFull[] } | null;
  const copy = readDiskCache<TemplateFull>('design-templates');
  parsedDiskCopies.set('design-templates', { sig, copy: copy as unknown as { at: number; items: CatalogueEntry[] } | null });
  return copy;
}

/**
 * Is this a picture address a template may use: the shop's own Storage — or,
 * in a local test against the emulators only, the Storage EMULATOR's.
 */
function isTemplateImageUrl(url: string): boolean {
  if (isOurStorageUrl(url)) return true;
  const emu = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (!emu || !FS_BUCKET) return false;
  return url.startsWith(`http://${emu}/v0/b/${FS_BUCKET}/o/`) || url.startsWith(`http://${emu.replace('127.0.0.1', 'localhost')}/v0/b/${FS_BUCKET}/o/`);
}

const designTemplateCopies = templateCopies<TemplateFull>({
  now: () => Date.now(),
  changedAt: templatesInvalidatedAt,
  readDisk: diskTemplates,
  writeDisk: (items, at) => writeDiskCache('design-templates', items, at),
  read: async () => {
    const db = getAdminDb();
    if (!db) throw new Error('no-admin-db');
    const snap = await db.collection('designTemplates').get();
    return snap.docs
      .map((d) => {
        // One document that cannot be cleaned is left out — it must not take
        // every other template down with it (and send each worker back to the
        // database every minute).
        try {
          return cleanTemplateDoc(d.id, d.data() as Record<string, unknown>, isTemplateImageUrl);
        } catch {
          return null;
        }
      })
      .filter((t): t is TemplateFull => !!t && !t.hidden)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  },
  maxAgeMs: TEMPLATES_MAX_AGE_MS,
  retryMs: TEMPLATES_RETRY_MS,
});

/** Every template customers may be offered. Throws only when there is no copy at all. */
function loadDesignTemplates(): Promise<TemplateFull[]> {
  return designTemplateCopies.get();
}

/** The templates offered on one product (its own, its category's or a parent's, or everywhere). */
app.get('/api/design-templates', async (req, res) => {
  let all: TemplateFull[];
  try {
    all = await loadDesignTemplates();
  } catch (err: any) {
    console.warn('Design templates unavailable:', err?.message ?? err);
    return res.status(503).json({ templates: [], unavailable: true });
  }
  try {
    const product = { id: String(req.query.product ?? '').slice(0, 200), categoryId: String(req.query.category ?? '').slice(0, 200) || null };
    // The categories copy the shop already keeps, never a read for this.
    const categories = newestCopyWithoutRead('categories', shopCategoriesCache, { current: false })?.items ?? [];
    const templates = all.filter((t) => templateInScope(t.scope, product, categories as any[])).map(summaryOf);
    return res.json({ templates });
  } catch (err) {
    console.error('Design templates failed:', err);
    return res.status(503).json({ templates: [], unavailable: true });
  }
});

/** One template, whole: the design and its pictures' addresses. */
app.get('/api/design-templates/:id', async (req, res) => {
  let all: TemplateFull[];
  try {
    all = await loadDesignTemplates();
  } catch {
    return res.status(503).json({ error: 'Unavailable.' });
  }
  const t = all.find((x) => x.id === String(req.params.id));
  if (!t) return res.status(404).json({ error: 'Not found.' });
  return res.json({ ...summaryOf(t), json: t.json, images: t.images, lockBackground: t.lockBackground });
});

/** After the owner saves or deletes a template from the dashboard. */
app.post('/api/admin/design-templates/invalidate', async (req, res) => {
  try {
    await requireAdmin(req);
    // The stamp FIRST: from it on, no worker counts an older copy…
    if (!stampTemplatesInvalidation()) {
      return res.status(503).json({ error: 'The shop could not note the change. Try again.' });
    }
    // …then this worker reads the new copy itself, and says ok only once it
    // holds it (and the disk copy the other workers read has it too): the
    // dashboard deletes the files of the version before on that answer.
    if (!(await designTemplateCopies.reload())) {
      return res.status(503).json({ error: 'The shop could not read the templates just now. Try again.' });
    }
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Failed.' });
  }
});

/**
 * Drop the caches now, instead of waiting out the five minutes.
 *
 * Categories and products are edited from the DASHBOARD, straight into Firestore
 * from the browser, so the server never sees those writes and cannot invalidate
 * itself the way the importer does. Without this the owner changes a category,
 * reloads the shop, sees the old one, and concludes the save failed — which is
 * exactly the "press refresh" complaint that round 9 was supposed to end.
 */
app.post('/api/admin/cache/invalidate', async (req, res) => {
  try {
    await requireAdmin(req);
    invalidateShopCatalogue();
    invalidateShopCategories();
    // NOT THE SUPPLIER INDEX (2026-10-09). This runs after EVERY save in the
    // dashboard — a product, a category, the settings — and none of those touch
    // supplierIndex; the build job is its only writer, and it invalidates its own
    // supplier when it finishes (invalidateSupplierIndex(supplier), with the stamp
    // every worker checks). Clearing it here made the next "Browse a supplier"
    // re-read that supplier's whole index — measured in Cloud Monitoring at
    // ~1 800 read units a time on 2026-10-09, after every product he saved while
    // importing. Asked for explicitly (?suppliers=1), it still is: rows written
    // outside the build job — a test, a script.
    if (String(req.query.suppliers ?? '') === '1') invalidateSupplierIndex();
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Failed.' });
  }
});

// ---------------------------------------------------------------------------
// THE MEDIA LIBRARY.
//
// "لازم يكون عندي صفحه ميديا للصور" — a place the owner keeps his pictures, and
// a picker every screen can open instead of asking him for a URL.
//
// Uploading is NOT here: the browser writes straight to the bucket with
// uploadFile({ visibility: 'public' }), which is faster and never puts the bytes
// through this process. What the browser cannot do is LIST a bucket prefix
// cheaply, or delete safely, or fetch somebody else's image — so those are here.
const MEDIA_PREFIX = 'public/media/';
const MEDIA_MAX_BYTES = 15 * 1024 * 1024;

/**
 * A path this endpoint is allowed to touch.
 *
 * Everything the media library does takes a path from the browser, and an
 * unchecked one is a delete on any object in the bucket — customer artwork
 * included. So: it must start with the media prefix, and it must not climb out
 * of it. `..` cannot appear in a GCS object name meaningfully, but it can appear
 * in a string, and the check costs nothing.
 */
function isMediaPath(raw: unknown): raw is string {
  const p = String(raw ?? '');
  return p.startsWith(MEDIA_PREFIX) && !p.includes('..') && p.length > MEDIA_PREFIX.length;
}

/** The public URL for an object, in the form the Firebase SDK produces. */
function mediaPublicUrl(bucketName: string, objectPath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

app.get('/api/admin/media', async (req, res) => {
  try {
    await requireAdmin(req);
    const bucket = await getAdminBucket();
    if (!bucket) return res.status(503).json({ error: 'Storage is not configured.' });

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 60;
    const [files, , apiResponse] = await bucket.getFiles({
      prefix: MEDIA_PREFIX,
      maxResults: limit,
      autoPaginate: false,
      ...(typeof req.query.cursor === 'string' && req.query.cursor ? { pageToken: req.query.cursor } : {}),
    } as any);

    const items = files
      // getFiles returns the prefix itself as a zero-byte entry on some buckets.
      .filter((f) => f.name !== MEDIA_PREFIX)
      .map((f) => {
        const token = String((f.metadata?.metadata as any)?.firebaseStorageDownloadTokens ?? '').split(',')[0];
        return {
          path: f.name,
          name: f.name.slice(MEDIA_PREFIX.length),
          size: Number(f.metadata?.size ?? 0),
          contentType: String(f.metadata?.contentType ?? ''),
          updated: f.metadata?.updated ?? null,
          // No token means the file was put there by something other than the
          // SDK. Say so rather than handing back a URL that 403s.
          url: token ? mediaPublicUrl(bucket.name, f.name, token) : null,
        };
      })
      .sort((a, b) => String(b.updated ?? '').localeCompare(String(a.updated ?? '')));

    return res.json({ items, nextCursor: (apiResponse as any)?.nextPageToken ?? null });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Could not list the media.' });
  }
});

app.post('/api/admin/media/delete', async (req, res) => {
  try {
    await requireAdmin(req);
    const bucket = await getAdminBucket();
    if (!bucket) return res.status(503).json({ error: 'Storage is not configured.' });

    const target = req.body?.path;
    if (!isMediaPath(target)) return res.status(400).json({ error: 'That is not a media file.' });

    // ignoreNotFound: deleting something already gone is the outcome the caller
    // wanted, and reporting it as a failure makes the screen look broken.
    await bucket.file(target).delete({ ignoreNotFound: true });
    return res.json({ ok: true, path: target });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Could not delete the file.' });
  }
});

/**
 * Copy somebody else's image into our own bucket.
 *
 * Supplier products are imported with the supplier's CDN URL on them, so the
 * shop's pictures live on servers we do not control. One of them has already
 * been blocked by Cross-Origin-Resource-Policy on this shop, and a supplier who
 * reorganises their CDN empties the catalogue's images without warning.
 *
 * THIS ENDPOINT FETCHES A URL THE CALLER CHOOSES, which is the definition of
 * SSRF, so admin-only is not sufficient on its own:
 *   - http(s) only. file:, gopher: and friends are refused.
 *   - the hostname is RESOLVED and every address it resolves to is checked
 *     against the private ranges. Checking the hostname text instead is the
 *     classic hole: `localtest.me` and countless others resolve to 127.0.0.1.
 *   - redirects are followed manually, and each hop is re-checked. A public URL
 *     that 302s to 169.254.169.254 is the standard cloud-metadata attack.
 *   - the response must be an image, and it is capped.
 */
async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error('That is not a URL.'), { status: 400 });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Object.assign(new Error('Only http and https can be fetched.'), { status: 400 });
  }
  const { lookup } = await import('node:dns/promises');
  const resolved = await lookup(url.hostname, { all: true }).catch(() => []);
  if (!resolved.length) {
    throw Object.assign(new Error('That host does not resolve.'), { status: 400 });
  }
  for (const { address, family } of resolved) {
    if (isPrivateAddress(address, family)) {
      throw Object.assign(new Error('That address is not reachable from here.'), { status: 400 });
    }
  }
  return url;
}

app.post('/api/admin/media/rehost', async (req, res) => {
  try {
    await requireAdmin(req);
    const bucket = await getAdminBucket();
    if (!bucket) return res.status(503).json({ error: 'Storage is not configured.' });

    let target = await assertPublicUrl(String(req.body?.url ?? ''));

    // Up to five hops, each one checked. fetch() would follow them for us and
    // check nothing.
    let response: Response | null = null;
    for (let hop = 0; hop < 5; hop += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        response = await fetch(target.href, { redirect: 'manual', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        target = await assertPublicUrl(new URL(response.headers.get('location')!, target).href);
        response = null;
        continue;
      }
      break;
    }
    if (!response || !response.ok) {
      return res.status(502).json({ error: `The image could not be fetched (${response?.status ?? 'no answer'}).` });
    }

    const contentType = String(response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!contentType.startsWith('image/')) {
      return res.status(415).json({ error: `That URL returned ${contentType || 'no content type'}, not an image.` });
    }
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MEDIA_MAX_BYTES) {
      return res.status(413).json({ error: 'That image is larger than 15 MB.' });
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    // Checked again: content-length is the sender's claim, not a fact.
    if (buffer.length > MEDIA_MAX_BYTES) {
      return res.status(413).json({ error: 'That image is larger than 15 MB.' });
    }

    const ext = (contentType.split('/')[1] || 'jpg').replace(/[^\w]+/g, '').slice(0, 5);
    const base = String(req.body?.name ?? target.pathname.split('/').pop() ?? 'image')
      .replace(/[^\w.\-]+/g, '_')
      .replace(/\.[^.]*$/, '')
      .slice(0, 60) || 'image';
    const objectPath = `${MEDIA_PREFIX}${Date.now()}_${base}.${ext}`;
    const token = crypto.randomUUID();
    await bucket.file(objectPath).save(buffer, {
      contentType,
      metadata: {
        contentType,
        // Without this the file has no download token and its public URL 403s.
        metadata: { firebaseStorageDownloadTokens: token, rehostedFrom: target.href },
      },
    });

    return res.json({
      ok: true,
      path: objectPath,
      url: mediaPublicUrl(bucket.name, objectPath, token),
      size: buffer.length,
      contentType,
      from: target.href,
    });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Could not re-host the image.' });
  }
});

// ---------------------------------------------------------------------------
// BULK OPERATIONS ON PRODUCTS — one endpoint for every mass write.
//
// "التعديل": select many, then delete, hide, move or edit them. What the
// dashboard does today is a browser loop — read every product document, base64
// images and all, then `await updateDoc` one at a time. Task 0.2 measured that
// loop at SIX SECONDS for two products, with nothing on screen while it ran.
// Scale it to a category of 500 and it is minutes of a screen that looks idle;
// close the tab halfway and half the products are written with nothing
// recording which half.
//
// Here it is batched (400 per commit, the number used everywhere else in this
// project), it reports a count, and two things become possible that the browser
// cannot do at all:
//   * deleting a product also deletes its productCosts document. That collection
//     is `allow read, write: if false` — no browser can touch it — so every bulk
//     delete so far has left the trade price of a deleted product behind.
//   * changing the MARGIN reprices from the stored source figures rather than
//     from the price on screen. Repricing from the current price compounds:
//     apply 40% twice and the second is charged on the first one's markup.
const BULK_MAX_IDS = 2000;

app.post('/api/admin/products/bulk', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);

    const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = [...new Set(rawIds.map((v: unknown) => String(v ?? '').trim()).filter(Boolean))];
    if (ids.length === 0) return res.status(400).json({ error: 'No products were selected.' });
    if (ids.length > BULK_MAX_IDS) {
      return res.status(413).json({ error: `That is ${ids.length} products; the limit for one request is ${BULK_MAX_IDS}.` });
    }

    const op = String(req.body?.op ?? '');
    const nowIso = new Date().toISOString();
    const BATCH = 400;

    /** Only ids that EXIST. A bulk write must never create a product. */
    const existing: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    for (let i = 0; i < ids.length; i += 30) {
      // 30 per `in` query — Firestore's cap is 30 for this operator.
      const chunk = ids.slice(i, i + 30);
      const snap = await db.collection('products')
        .where(FieldPath.documentId(), 'in', chunk)
        .select('basePrice', 'salePrice', 'name')
        .get();
      existing.push(...snap.docs);
    }
    const missing = ids.length - existing.length;
    if (existing.length === 0) {
      return res.status(404).json({ error: 'None of those products exist any more.' });
    }

    const commit = async (write: (batch: FirebaseFirestore.WriteBatch, doc: FirebaseFirestore.QueryDocumentSnapshot) => void) => {
      let done = 0;
      for (let i = 0; i < existing.length; i += BATCH) {
        const batch = db.batch();
        for (const doc of existing.slice(i, i + BATCH)) { write(batch, doc); done += 1; }
        await batch.commit();
      }
      return done;
    };

    let changed = 0;
    let note: string | undefined;

    switch (op) {
      case 'delete': {
        // The product AND its cost record, in the same batch, so a crash cannot
        // leave one without the other.
        changed = await commit((batch, doc) => {
          batch.delete(doc.ref);
          batch.delete(db.collection('productCosts').doc(doc.id));
        });
        note = 'productCosts removed with them';
        break;
      }

      case 'visibility': {
        const hidden = req.body?.hidden === true;
        changed = await commit((batch, doc) => {
          batch.set(doc.ref, { isHidden: hidden, updatedAt: nowIso }, { merge: true });
        });
        break;
      }

      case 'artwork': {
        // 109 PRODUCTS. The upload box defaults to off now, so turning it ON for
        // the ones that really are print jobs is the common case — and doing that
        // from a browser loop is what this endpoint exists to prevent.
        const enabled = req.body?.enabled === true;
        changed = await commit((batch, doc) => {
          batch.set(doc.ref, {
            artworkEnabled: enabled,
            // Switching the box OFF clears "a file is mandatory" with it.
            // Leaving that behind is a trap for whoever switches the box back on
            // later: checkout would start refusing on a file nobody asked for.
            // The product editor already ties the two together the same way.
            ...(enabled ? {} : { artworkRequired: false }),
            updatedAt: nowIso,
          }, { merge: true });
        });
        note = enabled ? undefined : 'a mandatory-file flag was cleared with it';
        break;
      }

      case 'category': {
        const categoryId = String(req.body?.categoryId ?? '').trim();
        if (!categoryId) return res.status(400).json({ error: 'A category is required.' });
        // The category must EXIST. Moving products into one that does not stranded
        // the whole catalogue once already — see the note in CategoryAdmin about
        // writing the destination before remapping.
        const cat = await db.collection('categories').doc(categoryId).get();
        if (!cat.exists) return res.status(400).json({ error: 'That category does not exist.' });
        changed = await commit((batch, doc) => {
          batch.set(doc.ref, { categoryId, updatedAt: nowIso }, { merge: true });
        });
        break;
      }

      case 'price': {
        // Two modes. `set` writes one number to all of them; `percent` moves each
        // product's own price, which is the one he actually reaches for.
        const mode = String(req.body?.mode ?? 'set');
        const value = Number(req.body?.value);
        if (!Number.isFinite(value)) return res.status(400).json({ error: 'A number is required.' });
        if (mode === 'set') {
          if (value < 0) return res.status(400).json({ error: 'A price cannot be negative.' });
          changed = await commit((batch, doc) => {
            batch.set(doc.ref, { basePrice: Math.round(value), updatedAt: nowIso }, { merge: true });
          });
        } else if (mode === 'percent') {
          if (value <= -100) return res.status(400).json({ error: 'That would make every price zero or less.' });
          changed = await commit((batch, doc) => {
            const current = Number(doc.data().basePrice) || 0;
            // Never below 1: a rounding-to-zero product is free, and free is the
            // most expensive bug this shop can ship.
            const next = Math.max(1, Math.round(current * (1 + value / 100)));
            batch.set(doc.ref, { basePrice: next, updatedAt: nowIso }, { merge: true });
          });
        } else {
          return res.status(400).json({ error: 'Unknown price mode.' });
        }
        break;
      }

      case 'salePrice': {
        // null clears the offer. Firestore keeps an omitted key on a merge, so
        // clearing has to be an explicit delete — the most repeated bug here.
        const raw = req.body?.value;
        if (raw === null || raw === '' || raw === undefined) {
          changed = await commit((batch, doc) => {
            batch.set(doc.ref, { salePrice: FieldValue.delete(), updatedAt: nowIso }, { merge: true });
          });
          note = 'offers cleared';
        } else {
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'A price is required.' });
          changed = await commit((batch, doc) => {
            batch.set(doc.ref, { salePrice: Math.round(value), updatedAt: nowIso }, { merge: true });
          });
        }
        break;
      }

      case 'margin': {
        // Repriced from the TRADE price, not from what is on screen. Only
        // products that have a cost record can be, and the rest are reported
        // rather than left to look as if they changed.
        const marginPercent = Number(req.body?.marginPercent);
        if (!Number.isFinite(marginPercent) || marginPercent < 0) {
          return res.status(400).json({ error: 'A margin of 0 or more is required.' });
        }
        const costs = new Map<string, { sourcePrice: number; sourceRate: number }>();
        for (let i = 0; i < existing.length; i += 30) {
          const chunk = existing.slice(i, i + 30).map((d) => d.id);
          const snap = await db.collection('productCosts')
            .where(FieldPath.documentId(), 'in', chunk)
            .select('sourcePrice', 'sourceRate')
            .get();
          for (const d of snap.docs) {
            const v = d.data();
            if (Number.isFinite(Number(v.sourcePrice)) && Number(v.sourceRate) > 0) {
              costs.set(d.id, { sourcePrice: Number(v.sourcePrice), sourceRate: Number(v.sourceRate) });
            }
          }
        }
        const repriceable = existing.filter((d) => costs.has(d.id));
        if (repriceable.length === 0) {
          return res.status(400).json({ error: 'None of those products came from a supplier, so there is no trade price to re-price from.' });
        }
        for (let i = 0; i < repriceable.length; i += BATCH) {
          const batch = db.batch();
          for (const doc of repriceable.slice(i, i + BATCH)) {
            const c = costs.get(doc.id)!;
            batch.set(doc.ref, { basePrice: priceFromSource(c.sourcePrice, c.sourceRate, marginPercent), updatedAt: nowIso }, { merge: true });
            batch.set(db.collection('productCosts').doc(doc.id), { marginPercent, updatedAt: nowIso }, { merge: true });
            changed += 1;
          }
          await batch.commit();
        }
        if (repriceable.length < existing.length) {
          note = `${existing.length - repriceable.length} had no trade price and were left alone`;
        }
        break;
      }

      case 'printingFields': {
        // 1.5 — "اي خصيه اعملها في الكتالوج تضاف تلقائيا لكل المنتجات".
        //
        // The library is sent ONCE, not once per product: it is the same array
        // for all of them, and the only per-product part is the rule that a
        // field the product ALREADY has survives even when it is switched off in
        // the library. That rule needs the product's current fields, so this
        // reads and writes in chunks — otherwise a category of 500 would pull
        // every one of their option trees into memory at the same time.
        const fields = Array.isArray(req.body?.fields) ? req.body.fields : null;
        if (!fields) return res.status(400).json({ error: 'The fields to apply are missing.' });
        const pricing = req.body?.pricing ?? null;

        // HOW to apply — the owner chooses each time (src/lib/libraryApply.ts).
        // A request without a mode is an old dashboard tab still open from before
        // the choice existed: it gets the old replacement, minus the part nobody
        // ever asked for — deleting the properties that exist only on a product.
        const MODES: LibraryApplyMode[] = ['add-new', 'update-selected', 'replace-all'];
        const mode: LibraryApplyMode = MODES.includes(req.body?.mode) ? req.body.mode : 'replace-all';
        const fieldIds: string[] = Array.isArray(req.body?.fieldIds) ? req.body.fieldIds.map(String) : [];
        if (mode === 'update-selected' && fieldIds.length === 0) {
          return res.status(400).json({ error: 'Choose at least one property to update.' });
        }
        const dropProductOnly = mode === 'replace-all' && req.body?.dropProductOnly === true;
        // update-selected only: show or hide the chosen properties everywhere.
        const switchTo = mode === 'update-selected' && (req.body?.switchTo === 'on' || req.body?.switchTo === 'off')
          ? (req.body.switchTo as 'on' | 'off')
          : undefined;

        const enabled = fields.filter((f: any) => f?.enabled);
        let unchanged = 0;
        for (let i = 0; i < existing.length; i += BATCH) {
          const chunk = existing.slice(i, i + BATCH);
          // Read the chunk WHOLE — the field mask has to include what is merged
          // into, or the merge would write a pricing object built from nothing
          // and silently drop the setup fee the owner had set per product.
          const docs = await db.getAll(...chunk.map((d) => d.ref), {
            fieldMask: ['printingFields', 'customUploadRules', 'pricingRules', 'pageOrder'],
          });
          const batch = db.batch();
          let writesInChunk = 0;
          for (const doc of docs) {
            // Deleted between the id check and this read: a merge-write would
            // bring it back as a stub of nothing but printingFields.
            if (!doc.exists) continue;
            const data = doc.data() ?? {};
            const current = Array.isArray(data.printingFields) ? data.printingFields : [];
            const merged = applyLibraryToProduct(current, fields, { mode, fieldIds, dropProductOnly, switchTo });
            // "Replace everything" gives the PROPERTIES the library's order. On a
            // page he arranged (Product.pageOrder) each block keeps its row and
            // the properties are dealt into theirs in the new order — otherwise
            // his stored order would go on showing the old one.
            const nextPageOrder = mode === 'replace-all' && Array.isArray(data.pageOrder)
              ? withFieldOrder(data.pageOrder, merged.map((f: any) => String(f?.id ?? '')))
              : undefined;
            const pageOrderChanged = nextPageOrder !== undefined && JSON.stringify(nextPageOrder) !== JSON.stringify(data.pageOrder);
            // A product this apply does not change is not written, and not
            // counted: "applied to 40 products" must mean 40 products changed.
            if (!pricing && !pageOrderChanged && JSON.stringify(merged) === JSON.stringify(current)) {
              unchanged += 1;
              continue;
            }
            const write: Record<string, any> = { printingFields: merged, updatedAt: nowIso };
            if (pageOrderChanged) write.pageOrder = nextPageOrder;
            if (pricing) {
              write.customUploadRules = {
                ...(data.customUploadRules ?? {}),
                // The same fallback the product editor uses, so a product that
                // never had upload rules does not come out with `enabled`
                // undefined.
                enabled: data.customUploadRules?.enabled ?? true,
                minPrice: Number(pricing.minPrice) || 0,
                pricePerSqm: Number(pricing.pricePerSqm) || 0,
                pricePerLinearMeter: Number(pricing.pricePerLinearMeter) || 0,
              };
              write.pricingRules = {
                ...(data.pricingRules ?? {}),
                baseSetupFee: Number(pricing.baseSetupFee) || 0,
                volumeDiscounts: Array.isArray(pricing.volumeDiscounts) ? pricing.volumeDiscounts : [],
              };
            }
            batch.set(doc.ref, write, { merge: true });
            writesInChunk += 1;
            changed += 1;
          }
          if (writesInChunk > 0) await batch.commit();
        }
        const modeNote = changed === 0
          ? 'nothing to change — every product already matched'
          : mode === 'add-new' ? 'new properties added'
            : mode === 'update-selected' ? `${fieldIds.length} chosen propert${fieldIds.length === 1 ? 'y' : 'ies'} updated`
              : `${enabled.length} enabled field(s) applied${dropProductOnly ? ', product-only properties removed' : ''}`;
        note = [
          modeNote,
          pricing ? 'pricing included' : 'prices untouched',
          unchanged ? `${unchanged} product(s) already matched and were left alone` : '',
        ].filter(Boolean).join(', ');
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown operation "${op}".` });
    }

    // The storefront is served from a cache the server holds; without this the
    // owner would watch a bulk change do nothing for five minutes.
    invalidateShopCatalogue();

    return res.json({
      ok: true,
      op,
      changed,
      requested: ids.length,
      ...(missing > 0 ? { missing } : {}),
      ...(note ? { note } : {}),
    });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'The bulk change failed.' });
  }
});

// ---------------------------------------------------------------------------
// THE SUPPLIER PICKER'S DATA — plan task 3.5.
//
// "انا اقدر اختار المنتج الي اريده": he browses, searches, filters by the
// supplier's own categories, and imports only what he picks.
//
// It reads `supplierIndex`, which the indexing job writes (3.1) and which is
// CLOSED to every client because every row carries a wholesale price. Cached
// here the way the shop catalogue is: 1 330 rows is 0.46 MB, so the whole index
// is held and filtered in memory rather than queried per keystroke. The TTL is
// long — a day (it was half an hour until 2026-10-09) — because the feed changes daily at most and each refresh
// costs one read per row on a project whose daily read quota has already run out
// once.
type SupplierIndexRow = Record<string, any>;

/** Letters, digits, dash and underscore only — because this id becomes a filename. */
const SUPPLIER_ID_OK = /^[a-z0-9_-]{1,40}$/;

/**
 * ⚠️ THIS USED TO READ THE WHOLE COLLECTION, FOR EVERY SUPPLIER, EVERY TIME.
 *
 * `db.collection('supplierIndex').get()` with no `where` — so opening the picker
 * for EasyGifts also paid for Pro Media Plus's rows, and `/api/admin/suppliers`
 * scanned the same collection AGAIN, uncached, to count them. Measured today:
 * roughly 1 330 + 633 rows, so about four thousand billed reads for one press of
 * "Browse a supplier" — and the memory cache does not save it, because Passenger
 * recycles this process constantly and a cold worker pays in full.
 *
 * The free daily read quota is fifty thousand. A dozen visits to that one screen
 * spends all of it, and today it WAS spent: the owner's client photographed the
 * empty grid and the red "daily read limit" banner together.
 *
 * Two changes. The query is filtered to one supplier and cached per supplier, and
 * every successful load is mirrored to disk — the same last-known-good discipline
 * the storefront catalogue has had since 2026-09-12 and this screen never had. A
 * supplier that has been loaded once can then be browsed with ZERO Firestore
 * reads, including straight through a read outage, which is the state the shop is
 * in as this is written.
 */
const supplierIndexCaches = new Map<string, { at: number; rows: SupplierIndexRow[] }>();
const supplierIndexInflight = new Map<string, Promise<SupplierIndexRow[]>>();
// A day, not half an hour (2026-10-09): the index changes only when the build job
// runs, and that job invalidates its supplier itself. Every reload is one read per
// row — ~1 800 read units for the larger supplier.
const SUPPLIER_INDEX_MS = 24 * 60 * 60 * 1000;

function invalidateSupplierIndex(supplier?: string): void {
  if (supplier) supplierIndexCaches.delete(supplier);
  else supplierIndexCaches.clear();
  // …and for every OTHER worker too: a disk copy older than this stamp is not current.
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    const target = path.join(DISK_CACHE_DIR, `supplier-index-changed${supplier && SUPPLIER_ID_OK.test(supplier) ? `-${supplier}` : ''}.json`);
    fs.writeFileSync(`${target}.${process.pid}.tmp`, JSON.stringify({ at: Date.now() }));
    fs.renameSync(`${target}.${process.pid}.tmp`, target);
  } catch { /* no disk: copies then age out in a day */ }
}

/** When this supplier's index last changed (its own stamp or the shop-wide one) — each file read once per change. */
const supplierStamps = new Map<string, { sig: string; at: number }>();
function supplierIndexChangedAt(key: string): number {
  const read = (file: string) => {
    const full = path.join(DISK_CACHE_DIR, file);
    const sig = fileSig(full);
    if (!sig) return 0;
    const known = supplierStamps.get(file);
    if (known && known.sig === sig) return known.at;
    let at = 0;
    try {
      at = Number(JSON.parse(fs.readFileSync(full, 'utf8'))?.at) || 0;
    } catch { /* unreadable: no stamp */ }
    supplierStamps.set(file, { sig, at });
    return at;
  };
  return Math.max(read('supplier-index-changed.json'), read(`supplier-index-changed-${key}.json`));
}

/** The supplier's disk copy, parsed once per change of the file. */
const supplierDiskCopies = new Map<string, { sig: string; copy: { at: number; items: SupplierIndexRow[] } | null }>();
function diskSupplierIndex(key: string): { at: number; items: SupplierIndexRow[] } | null {
  const sig = fileSig(path.join(DISK_CACHE_DIR, `supplier-index-${key}.json`));
  if (!sig) return null;
  const known = supplierDiskCopies.get(key);
  if (known && known.sig === sig) return known.copy;
  const copy = readDiskCache<SupplierIndexRow>(`supplier-index-${key}`);
  supplierDiskCopies.set(key, { sig, copy });
  return copy;
}

/** What a fallback answered with, so the screen can say "as of" instead of implying "now". */
type SupplierIndexLoad = { rows: SupplierIndexRow[]; stale: boolean; asOf: number | null };

async function loadSupplierIndex(supplier: string): Promise<SupplierIndexLoad> {
  const key = String(supplier ?? '').trim().toLowerCase();
  // ⚠️ THIS ID BECOMES A FILENAME, which it did not before the disk mirror.
  // `/api/admin/suppliers/:supplier/catalogue` takes the id straight from the
  // path and checks only that it is non-empty, so `../../x` would have written
  // outside .cache — behind requireAdmin, but a traversal introduced by the very
  // change that added the mirror. Only ids the shop actually knows get a file.
  if (!key || !SUPPLIER_ID_OK.test(key)) return { rows: [], stale: false, asOf: null };

  const hot = supplierIndexCaches.get(key);
  // A rebuild in ANOTHER worker stamps the disk: this worker's copy from before it is not current either.
  if (hot && Date.now() - hot.at < SUPPLIER_INDEX_MS && hot.at >= supplierIndexChangedAt(key)) {
    return { rows: hot.rows, stale: false, asOf: hot.at };
  }
  // ANOTHER WORKER'S COPY of the last half hour counts as current, unless the
  // index changed since: a fresh worker (this host recycles them constantly) used
  // to read all ~1 330 rows again just to show the same screen.
  const shared = diskSupplierIndex(key);
  if (shared && Date.now() - shared.at < SUPPLIER_INDEX_MS && shared.at >= supplierIndexChangedAt(key)) {
    supplierIndexCaches.set(key, { at: shared.at, rows: shared.items });
    return { rows: shared.items, stale: false, asOf: shared.at };
  }

  let inflight = supplierIndexInflight.get(key);
  if (!inflight) {
    inflight = (async () => {
      const db = getAdminDb();
      if (!db) throw new Error('no-admin-db');
      // Dated when the read BEGAN: a read that started before a rebuild's last
      // batch must not pass for one taken after it.
      const startedAt = Date.now();
      const snap = await db.collection('supplierIndex').where('supplier', '==', key).get();
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      supplierIndexCaches.set(key, { at: startedAt, rows });
      // The copy that makes the next outage survivable.
      writeDiskCache(`supplier-index-${key}`, rows, startedAt);
      return rows;
    })().finally(() => { supplierIndexInflight.delete(key); });
    supplierIndexInflight.set(key, inflight);
  }

  try {
    const rows = await inflight;
    return { rows, stale: false, asOf: Date.now() };
  } catch (err) {
    // A REFUSED READ IS NOT AN EMPTY SUPPLIER. The last good copy beats an empty
    // grid, and saying WHEN it is from beats pretending it is live.
    const disk = readDiskCache<SupplierIndexRow>(`supplier-index-${key}`);
    if (disk) {
      console.warn(`Supplier index for ${key}: live read refused, serving the disk copy from ${new Date(disk.at).toISOString()}.`);
      return { rows: disk.items, stale: true, asOf: disk.at };
    }
    throw err;
  }
}

app.get('/api/admin/suppliers/:supplier/catalogue', async (req, res) => {
  try {
    // Read-only, and searched a keystroke at a time: the role answer of the last
    // minute will do — and through a read outage, the last one (adminRoleCache.ts).
    await requireAdmin(req, { staleOk: true });
    const supplier = String(req.params.supplier ?? '').trim().toLowerCase();
    if (!supplier) return res.status(400).json({ error: 'A supplier is required.' });
    // Named, not merely non-empty. The id reaches a query and now a filename.
    if (!SUPPLIER_ID_OK.test(supplier) || !ADAPTER_SUPPLIERS.has(supplier)) {
      return res.status(400).json({ error: `No catalogue for "${supplier}".` });
    }

    let load: SupplierIndexLoad;
    try {
      load = await loadSupplierIndex(supplier);
    } catch (err: any) {
      if (err?.message === 'no-admin-db') return res.status(503).json({ error: 'The index is unavailable.' });
      throw err;
    }
    const all = load.rows;

    // Rows the supplier has dropped stay in the index — an imported product's row
    // is the only record of where it came from — but they are not offered for
    // import unless asked for.
    const includeGone = req.query.gone === '1';
    let rows = all.filter((r) => (includeGone || r.gone !== true));

    // HIS SCREENSHOT: choosing a supplier category filters the list to it and
    // hides the rest. Matched against the whole path, so picking a root shows
    // everything beneath it — the same rule the shop's own categories follow.
    const category = String(req.query.category ?? '').trim();
    if (category) {
      rows = rows.filter((r) => Array.isArray(r.categoryPath) && r.categoryPath.includes(category));
    }

    // EVERY WORD, in any order, over the name, the Swedish name, the product
    // number and the categories — accents folded, plurals tried as their
    // singular, codes matched without their hyphens — name hits first, then the
    // owner's chosen order (src/lib/suppliers/supplierSearch.ts).
    const query = String(req.query.q ?? '').trim().slice(0, 200);
    const sort = cleanSort(req.query.sort);
    rows = searchAndSort(rows, query, sort);

    // Unpriced rows cannot be imported — 74 of EasyGifts' 1 330 carry no usable
    // price — so they are hidden unless asked for. But SAID: a search that found
    // only those looked like a search that found nothing.
    const priced = (r: SupplierIndexRow) => typeof r.sourcePrice === 'number' && r.sourcePrice > 0;
    const showUnpriced = req.query.unpriced === '1';
    const hiddenUnpriced = showUnpriced ? 0 : rows.filter((r) => !priced(r)).length;
    if (!showUnpriced) rows = rows.filter(priced);

    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 60;
    const from = Math.max(0, Math.floor(Number(req.query.offset) || 0));
    const page = rows.slice(from, from + limit);

    // The supplier's own category tree, built from what is actually in the index
    // rather than from a separate file — a filter offering a category with
    // nothing behind it is a dead end the owner has to discover by trying it.
    // Counted like the list: without the unpriced rows unless they are shown, so
    // a chip saying 13 no longer opens a list of 10. Names decoded for the eye
    // ("Eating & drinking"); the raw name stays the filter value.
    const categories = categoryChips(
      all.filter((r) => r.supplier === supplier && r.gone !== true && (showUnpriced || priced(r))),
    );
    // The NEWEST row's time — the first row's could be any build's.
    const indexedAt = all.reduce<string | null>(
      (latest, r) => (typeof r.indexedAt === 'string' && (!latest || r.indexedAt > latest) ? r.indexedAt : latest),
      null,
    );

    return res.json({
      supplier,
      products: page,
      total: rows.length,
      hiddenUnpriced,
      sort,
      offset: from,
      nextOffset: from + page.length < rows.length ? from + page.length : null,
      categories,
      indexedAt,
      // SERVED FROM THE DISK COPY, and saying so. The screen may show the rows
      // with an "as of" line instead of pretending they are live — which is what
      // keeps this screen usable straight through a read outage, the state it was
      // photographed in.
      stale: load.stale,
      asOf: load.asOf ? new Date(load.asOf).toISOString() : null,
    });
  } catch (err: any) {
    return adminError(res, err, 'Could not read the supplier catalogue.');
  }
});

/**
 * Import the products he picked — plan task 3.5.
 *
 * The INDEX is what the picker browses; it is deliberately too slim to import
 * from. So this fetches the feed itself, which takes about seven seconds, and
 * that is fine: it is an admin action, not a request that also serves the
 * storefront — the rule 3.1 exists to protect. Fetching it fresh also means the
 * price written onto a product is the price at the moment of import rather than
 * whenever the index was last built.
 *
 * The parsed feed is held briefly so importing in several batches does not
 * re-download 39 MB each time.
 */
let easyGiftsFeedCache: { at: number; products: any[] } | null = null;
const SUPPLIER_FEED_MS = 10 * 60 * 1000;

async function loadEasyGiftsProducts(): Promise<any[]> {
  if (easyGiftsFeedCache && Date.now() - easyGiftsFeedCache.at < SUPPLIER_FEED_MS) {
    return easyGiftsFeedCache.products;
  }
  const base = 'https://easygifts.com.pl/data/webapi2';
  const grab = async (lang: string, file: string) => {
    const r = await fetch(`${base}/${lang}/json/${file}.json`, { signal: AbortSignal.timeout(300_000) });
    if (!r.ok) throw Object.assign(new Error(`EasyGifts ${lang}/${file} answered ${r.status}.`), { status: 502 });
    return r.json();
  };
  const [en, se, dk, prices, stocks] = await Promise.all([
    grab('en', 'offer'), grab('se', 'offer'), grab('dk', 'offer'),
    grab('se', 'prices'), grab('se', 'stocks'),
  ]);
  const products = parseEasyGifts({ offers: en, prices, stocks, translations: { sv: se, da: dk } });
  easyGiftsFeedCache = { at: Date.now(), products };
  return products;
}

/**
 * ONE LOADER FOR EVERY SUPPLIER — plan task 3.7.
 *
 * Pro Media Plus had its own importer, its own preview, its own re-sync and its
 * own product mapping, none of which the picker (3.5), the per-supplier re-sync
 * (3.10) or the category mapping (3.9) knew anything about. Two of everything
 * means a fix lands in one and not the other.
 *
 * The feed PARSERS are untouched — both are proven against live data — and this
 * only puts their output into the one shape. src/lib/suppliers/proMediaPlus.ts
 * carries the careful part: the ids the 31 already-imported products are stored
 * under, and the fields its old importer wrote that EasyGifts' does not.
 *
 * A supplier with no adapter throws a 400 naming itself, rather than returning an
 * empty list that would read as "the feed has no products".
 */
async function loadSupplierProducts(supplier: string): Promise<any[]> {
  if (supplier === 'easygifts') return loadEasyGiftsProducts();
  if (supplier === PRO_MEDIA_PLUS) {
    const secrets = await loadIntegrationSecrets();
    const { offers } = await fetchSupplierOffers(secrets.supplier ?? {});
    return offersToSupplierProducts(offers);
  }
  if (supplier === MIDOCEAN) return loadMidoceanProducts();
  throw Object.assign(new Error(`No adapter for "${supplier}" yet.`), { status: 400 });
}

/**
 * midocean's catalogue — 3.8.
 *
 * TWO FILES, and the products one is 26 MB. `/gateway/products/2.0` answers a
 * 303 with a pre-signed S3 URL; fetch follows that by default, and the redirect
 * is NOT an error however much it reads like one.
 *
 * The S3 URL is signed and short-lived, so nothing about it may be cached — only
 * the parsed result, and for a long time: 26 MB is not a thing to re-download
 * because somebody typed another letter into a search box.
 */
let midoceanCache: { at: number; products: any[] } | null = null;
let midoceanInflight: Promise<any[]> | null = null;
const MIDOCEAN_CACHE_MS = 6 * 60 * 60 * 1000;

async function loadMidoceanProducts(force = false): Promise<any[]> {
  if (!force && midoceanCache && Date.now() - midoceanCache.at < MIDOCEAN_CACHE_MS) {
    return midoceanCache.products;
  }
  if (midoceanInflight) return midoceanInflight;

  midoceanInflight = (async () => {
    const secrets = await loadIntegrationSecrets();
    const key = (secrets.midocean?.apiKey ?? '').trim();
    if (!key) {
      throw Object.assign(new Error('The midocean API key has not been saved yet.'), { status: 400 });
    }
    const grab = async (path: string) => {
      const resp = await fetch(`https://api.midocean.com${path}`, {
        headers: { 'x-Gateway-APIKey': key, Accept: 'application/json' },
        // 26 MB from a gateway that redirects to S3 first. Bounded, so a wedged
        // supplier cannot hold an admin request open for ever.
        signal: AbortSignal.timeout(300_000),
      });
      if (resp.status === 401 || resp.status === 403) {
        throw Object.assign(new Error('midocean rejected the API key.'), { status: 400 });
      }
      if (!resp.ok) {
        throw Object.assign(new Error(`midocean answered ${resp.status}.`), { status: 502 });
      }
      return resp.json();
    };
    const [products, prices] = await Promise.all([
      grab('/gateway/products/2.0?language=en'),
      grab('/gateway/pricelist/2.0'),
    ]);
    const parsed = parseMidocean({ products, prices });
    if (parsed.length === 0) {
      throw Object.assign(new Error('The midocean feed downloaded but contained no products.'), { status: 502 });
    }
    midoceanCache = { at: Date.now(), products: parsed };
    return parsed;
  })().finally(() => { midoceanInflight = null; });

  return midoceanInflight;
}

/** Which suppliers this server can actually read a catalogue from. */
const ADAPTER_SUPPLIERS = new Set(['easygifts', PRO_MEDIA_PLUS, MIDOCEAN]);

/**
 * Feeds that are ALREADY IN THE SHOP'S CURRENCY — 3.8.
 *
 * Every other supplier here quotes EUR and the importer multiplies by an
 * exchange rate the owner types. midocean quotes SEK. An 11.5 applied to a price
 * that is already in kronor sells an 89 kr bag for 1 024 — the same shape of
 * mistake as the 3 020 → 1 490 underpricing incident, in the other direction —
 * so the rate is FORCED to 1 rather than trusted from the request body.
 */
const NATIVE_SEK_SUPPLIERS = new Set([MIDOCEAN]);

function effectiveRate(supplier: string, requested: number): number {
  return NATIVE_SEK_SUPPLIERS.has(supplier) ? 1 : requested;
}

/**
 * A NUMBER THE CALLER ACTUALLY SENT — 15.1.7. Returns null for anything else.
 *
 * `Number(req.body?.marginPercent)` was the check at all three import endpoints,
 * and `Number('')`, `Number(null)` and `Number([])` are all **0**. So a margin
 * box left empty in the dashboard arrived here as a perfectly valid 0%, passed
 * `marginPercent < 0`, and every ticked product was written at the supplier's
 * own trade price — the shop selling at cost with nothing anywhere saying so.
 * The browser now refuses to send an empty box (SupplierPicker's `decimal`),
 * but a browser guard is not a rule: `JSON.stringify(NaN)` is `null`, which the
 * old check read as 0 as well, and this endpoint is reachable by anyone holding
 * an admin token.
 *
 * An explicit 0 still works — importing at cost is a legitimate thing to want
 * ONCE IT IS TYPED. What is refused is the absence of an answer.
 */
/**
 * The same folding the dashboard's "same as English" badge uses — 15.3.2b.
 * Kept here rather than imported: the dashboard's copy lives in a .tsx control
 * and this file is bundled for the server. Two lines, one rule; if either
 * changes, change both.
 */
function foldForCompare(text: string | undefined): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function sentNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string') {
    const text = raw.trim().replace(',', '.');
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * BUILD THE SUPPLIER INDEX — one bounded step per call.
 *
 * "انا ما قادر اتحكم؟" — the owner's client, looking at an empty picker. Until
 * now the only thing that wrote `supplierIndex` was a command line on a
 * developer's machine, so the answer was no.
 *
 * WHY IT IS STEPPED. The job is thousands of rows and, for midocean, a 26 MB
 * download. This host drops roughly one request in five and has been measured
 * answering 502 after 47 seconds, and Passenger reaps the process between
 * requests. A single long request cannot do it and a background promise cannot
 * be trusted to survive.
 *
 * So each call does ONE unit and writes the cursor to disk. Any caller may take
 * the next one: the browser while his tab is open, and a dropped request simply
 * means the next call repeats a unit whose work was already committed. Nothing
 * is lost because nothing is held in memory between steps.
 *
 * WHAT IT REFUSES. A feed that parsed to zero rows is a broken feed, not an
 * emptied supplier — the laptop script has no such guard and would mark a whole
 * catalogue gone. A run that is already moving is ATTACHED to rather than raced.
 */
async function runIndexStep(supplier: string): Promise<IndexRun & { percent: number; batch: number }> {
  const { db } = { db: getAdminDb() };
  if (!db) throw Object.assign(new Error('The database is unavailable.'), { status: 503 });

  const runKey = `supplier-index-run-${supplier}`;
  const planKey = `supplier-index-plan-${supplier}`;
  const now = new Date();

  let run = readCacheJson<IndexRun>(runKey);
  const verdict = claimable(run, now.getTime());
  if (verdict === 'claim') {
    run = {
      supplier, runId: `${now.getTime()}`, phase: 'fetch', cursor: 0, total: 0,
      startedAt: now.toISOString(), updatedAt: now.toISOString(),
    };
  }
  if (!run) throw Object.assign(new Error('The run could not be started.'), { status: 500 });

  const save = (next: Partial<IndexRun>): IndexRun => {
    const merged = { ...(run as IndexRun), ...next, updatedAt: new Date().toISOString() };
    // A cursor that cannot be saved must not be reported as progress: the next
    // call would repeat the batch for ever and the count on screen would climb
    // past the real total.
    if (!writeCacheJson(runKey, merged)) {
      throw Object.assign(new Error('The progress could not be saved.'), { status: 500 });
    }
    run = merged;
    return merged;
  };

  const phase = nextPhase(run);
  let batch = 0;

  if (phase === 'fetch') {
    const products = await loadSupplierProducts(supplier);
    const entries = products.map((p: any) => toIndexEntry(p));
    if (refuseEmptyFeed(entries.length)) {
      // Zero rows never reaches a write. Reported as a stable slug; the browser
      // owns the sentence and its four languages.
      save({ phase: 'blocked', reason: 'empty_feed', total: 0 });
    } else if (!writeCacheJson(planKey, { entries })) {
      save({ phase: 'blocked', reason: 'plan_not_saved' });
    } else {
      save({ phase: 'write', cursor: 0, total: entries.length });
    }
  } else if (phase === 'write') {
    const plan = readCacheJson<{ entries: any[] }>(planKey);
    if (!plan?.entries?.length) {
      // The plan is gone — a deploy, a cleared cache, another worker. Fetching
      // again is correct and cheap; pretending to resume against nothing is not.
      save({ phase: 'fetch', cursor: 0, total: 0 });
    } else {
      const slice = plan.entries.slice(run.cursor, run.cursor + INDEX_BATCH);
      const stamp = new Date().toISOString();
      const wb = db.batch();
      for (const e of slice) {
        wb.set(db.collection('supplierIndex').doc(idForEntry(e)), { ...e, gone: false, indexedAt: stamp });
      }
      await wb.commit();
      batch = slice.length;
      // Advanced only AFTER the commit returned. The number on screen is what
      // Firestore accepted, never what was attempted.
      save({ cursor: run.cursor + slice.length, phase: 'write' });
    }
  } else if (phase === 'finish') {
    await db.collection('suppliers').doc(supplier).set(
      { lastIndexAt: new Date().toISOString(), indexedRows: run.total },
      { merge: true },
    );
    // The rows just written are the truth now; the day-long cache and the disk
    // mirror both predate them.
    invalidateSupplierIndex(supplier);
    save({ phase: 'done', finishedAt: new Date().toISOString() });
  }

  const current = run as IndexRun;
  return { ...current, percent: percentDone(current), batch };
}

/**
 * One step, and the state that came out of it. The browser calls this in a loop.
 *
 * It answers with the SERVER's counters, never the caller's — a screen that can
 * act on thousands of rows reports what the server did, not what was asked for.
 */
app.post('/api/admin/suppliers/:supplier/index/step', async (req, res) => {
  try {
    await requireAdmin(req);
    const supplier = String(req.params.supplier ?? '').trim().toLowerCase();
    if (!SUPPLIER_ID_OK.test(supplier) || !ADAPTER_SUPPLIERS.has(supplier)) {
      return res.status(400).json({ error: `No adapter for "${supplier}" yet.`, reason: 'unknown_supplier' });
    }
    const state = await runIndexStep(supplier);
    return res.json({ ok: true, ...state });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message, reason: 'step_failed' });
    return adminError(res, err, 'The catalogue build could not continue.');
  }
});

app.post('/api/admin/suppliers/:supplier/import', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const supplier = String(req.params.supplier ?? '').trim().toLowerCase();
    if (!ADAPTER_SUPPLIERS.has(supplier)) {
      return res.status(400).json({ error: `No adapter for "${supplier}" yet.` });
    }

    const keys: string[] = [...new Set<string>(
      (Array.isArray(req.body?.productKeys) ? req.body.productKeys : [])
        .map((k: unknown) => String(k ?? '').trim())
        .filter((k: string) => k.length > 0),
    )];
    if (keys.length === 0) return res.status(400).json({ error: 'Nothing was selected.' });
    if (keys.length > 500) {
      return res.status(413).json({ error: `That is ${keys.length} products; import at most 500 at a time.` });
    }

    // 15.1.7 — sentNumber, not Number: an empty or absent margin is a missing
    // answer, not 0%, and 0% imports the whole selection at trade cost.
    const requestedRate = sentNumber(req.body?.rate);
    const marginPercent = sentNumber(req.body?.marginPercent);
    if (requestedRate === null || requestedRate <= 0) return res.status(400).json({ error: 'An exchange rate is required.' });
    if (marginPercent === null || marginPercent < 0) return res.status(400).json({ error: 'A margin is required. An empty box is not 0%.' });
    // 3.8 — a feed already quoted in kronor is never multiplied by anything.
    const rate = effectiveRate(supplier, requestedRate);

    const categoryId = String(req.body?.categoryId ?? '').trim();
    if (categoryId) {
      // The destination must EXIST. Importing into a category that does not is
      // how a hundred products end up reachable from nowhere.
      const cat = await db.collection('categories').doc(categoryId).get();
      if (!cat.exists) return res.status(400).json({ error: 'That category does not exist.' });
    }

    const all = await loadSupplierProducts(supplier);
    const byKey = new Map(all.map((p: any) => [p.productKey, p]));

    // Slugs already in use, so an import cannot take an address another product
    // answers on — and, from the same read, which of these products the shop
    // already has (DAT-01: a re-import refreshes those, see forReimport).
    const slugSnap = await db.collection('products').select('slug').get();
    const taken = new Set(slugSnap.docs.map((d) => String(d.data().slug ?? '')).filter(Boolean));
    const inShop = new Set(slugSnap.docs.map((d) => d.id));

    const nowIso = new Date().toISOString();
    const writes: { product: any; costs: any }[] = [];
    const skipped: { productKey: string; reason: string }[] = [];

    for (const key of keys) {
      const p = byKey.get(key);
      if (!p) { skipped.push({ productKey: key, reason: 'no longer in the feed' }); continue; }
      const out = supplierProductToShop(
        p,
        { rate, marginPercent, categoryId, takenSlugs: taken, hidden: req.body?.hidden !== false, nowIso },
        slugify,
        uniqueSlug,
      );
      if (!out) { skipped.push({ productKey: key, reason: 'the supplier has not priced it' }); continue; }
      // A product already in the shop keeps its own address — the slug worked out
      // for it here is never written, so it reserves nothing.
      if (!inShop.has(out.product.id)) taken.add(out.product.slug);
      writes.push(out);
    }

    if (writes.length === 0) {
      return res.status(400).json({ error: 'None of those could be imported.', skipped });
    }

    const BATCH = 200; // two documents per product, and Firestore caps a batch at 500
    for (let i = 0; i < writes.length; i += BATCH) {
      const batch = db.batch();
      for (const w of writes.slice(i, i + BATCH)) {
        // A RE-import updates the price, the translations and the supplier's
        // references, and leaves everything the owner has since changed — his
        // category, his visibility, his offer, his options, his pictures, the
        // product's address — alone (forReimport). That is what a deterministic id
        // is for. The comment here promised that while merge:true wrote the whole
        // document; a new product is still written whole.
        batch.set(
          db.collection('products').doc(w.product.id),
          inShop.has(w.product.id) ? forReimport(w.product, nowIso) : w.product,
          { merge: true },
        );
        batch.set(db.collection('productCosts').doc(w.product.id), { ...w.costs, updatedAt: nowIso }, { merge: true });
      }
      await batch.commit();
    }

    invalidateShopCatalogue();
    return res.json({
      ok: true,
      imported: writes.length,
      ...(skipped.length ? { skipped } : {}),
      hidden: req.body?.hidden !== false,
    });
  } catch (err: any) {
    return adminError(res, err, 'The import failed.');
  }
});

// ---------------------------------------------------------------------------
// THE SUPPLIERS — plan task 3.6.
//
// "Generalised from two working adapters, not designed against one." There are
// two: Pro Media Plus (XML over HTTP Basic, EUR, hotlinked images) and EasyGifts
// (static JSON in five languages, EUR, URLs in the feed). midocean is known in
// detail and answers in SEK. They agree on almost nothing, which is exactly why
// this record holds only what is true of all of them.
//
// CREDENTIALS ARE NOT IN IT. They stay in secrets/integrations, which no browser
// may open — a supplier record carrying a password would put it one leaked staff
// account away from the world. This record says WHO, not HOW TO LOG IN.
/**
 * Prove a Gemini key before storing it — and prove a MODEL will run for it.
 *
 * The same rule Mollie's and Zendr's keys follow, and for the same reason: a key
 * saved unchecked fails later, in front of a customer typing into the chat, which
 * is a far worse moment to find out.
 *
 * ⚠️ LISTING THE MODELS IS NOT ENOUGH, and believing it was is what put a green
 * "Connected" badge over a dead assistant. On 2026-09-13 a brand-new Google key
 * listed 55 models — INCLUDING the two this shop asked for — and answered 404 on
 * both when asked to generate: "no longer available to new users". The listing
 * proves the KEY. Only a generation proves the MODEL. So this does both, in that
 * order, because the difference between them is the difference between "wrong
 * key" and "the model we name has been retired", and the owner can only act on
 * the right one.
 *
 * THREE OUTCOMES, not two:
 *   · the model answered          → stored, with the model name it answered under
 *   · the provider said no        → refused, quoting its own sentence (Google's
 *                                   names the replacement model)
 *   · nobody could say either way → STORED with a warning. A 429 or a transient
 *     503 must never red-light a good key: 7 of 23 probe calls that day came back
 *     "experiencing high demand" and every one of them succeeded later. Refusing
 *     on those would lock the owner out of his own shop at random.
 */
type AiVerdict = {
  ok: boolean;
  reason?: string;
  provider?: AiProvider;
  model?: string;
  warning?: string;
};

async function verifyAiKey(key: string, provider: AiProvider): Promise<AiVerdict> {
  // ONLY THE PROVIDER HE NAMED IS ASKED (round 16). This used to try every
  // provider, the prefix's guess first — so a key travelled to up to three
  // companies that had not issued it, and a DeepSeek key (sk-…, like OpenAI's)
  // would have gone to OpenAI first of all. A secret goes to its issuer only.
  const name = AI_PROVIDER_NAMES[provider];
  const noBalance = `${name} says the account behind this key has no balance (402). Top it up on ${name}'s site, then save again — nothing was saved.`;
  {
    let listed = false;
    let status = 0;
    try {
      const { url, init } = verifyRequest(provider, key);
      const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      status = resp.status;
      const body: any = await resp.json().catch(() => null);
      listed = verifyLooksGood(provider, resp.status, body);
    } catch {
      // Unreachable is not a no — but it is not a yes either, and nothing has
      // been proven about this key.
    }
    if (!listed) {
      return {
        ok: false,
        // "Not accepted" only when the service SAID no; busy or broken is not a
        // verdict on the key (the same rule the probe below has always had).
        reason: status === 402
          ? noBalance
          : status && probeIsRefusal(status)
            ? `${name} did not accept that key (${status}). Check that it is a ${name} key and that it is active — or choose the service it is from.`
            : status
              ? `${name} could not check the key just now (${status}), so nothing was saved. Try again in a minute.`
              : `${name} could not be reached to check the key, so nothing was saved. Try again in a minute.`,
      };
    }

    // The key is this provider's. From here the question is only whether the
    // model THIS SHOP NAMES will run for it.
    const model = AI_MODELS[provider].fast;
    try {
      const { url, init } = probeRequest(provider, key, model);
      const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      const body: any = await resp.json().catch(() => null);
      if (probeLooksAlive(provider, resp.status, body)) return { ok: true, provider, model };
      // A key over an empty account lists models and then answers nothing: stored,
      // it lit the chat up on every page and failed every customer's question.
      if (resp.status === 402) return { ok: false, provider, reason: noBalance };
      if (probeIsRefusal(resp.status)) {
        const said = providerErrorSentence(body);
        return {
          ok: false,
          provider,
          reason: `The key is valid, but ${name} will not run the model this shop asks for (${model}). It answered ${resp.status}${said ? `: ${said}` : '.'}`,
        };
      }
      return {
        ok: true,
        provider,
        model,
        warning: `The key was accepted, but ${AI_PROVIDER_NAMES[provider]} did not answer a test question (${resp.status}). It is usually busy, not broken — try the assistant in a minute.`,
      };
    } catch {
      return {
        ok: true,
        provider,
        model,
        warning: `The key was accepted, but ${AI_PROVIDER_NAMES[provider]} could not be reached for a test question. It is stored; try the assistant in a minute.`,
      };
    }
  }
}

/**
 * The answer an admin screen gets when something unexpected fails.
 *
 * Errors this file THROWS ON PURPOSE carry a `status` and a sentence written for
 * the owner — those are passed through. Anything else is a driver error, and
 * returning it verbatim does two bad things: it puts the project number, the
 * quota metric name and a gRPC stack into a browser, and it shows the owner a
 * wall of text he cannot act on. Measured case, 2026-09-12: the picker answered
 * `8 RESOURCE_EXHAUSTED: Quota limit exceeded … for consumer project_number:1662…`.
 *
 * The full error still goes to the server log, where it belongs.
 */
/**
 * The STOREFRONT's answer when a read fails — and why the status matters.
 *
 * These three endpoints answered 500 on any failure, including the one that keeps
 * happening: the Firestore free-tier daily read quota, which has already taken
 * this shop dark for seven hours. A 500 tells a crawler the page is BROKEN, and
 * Google will drop pages that answer 500 for long enough. 503 with a Retry-After
 * says "temporarily unavailable, come back", which is the truth and is the one
 * signal that costs the shop nothing.
 *
 * It also tells the browser apart from a real fault, so the storefront can say
 * "the shop is briefly unavailable" instead of rendering an empty shelf.
 *
 * No detail reaches the visitor: a quota message naming the project number is for
 * the owner's log, not for a customer.
 */
function publicReadError(res: express.Response, err: any, fallback: string) {
  const raw = String(err?.message ?? err);
  console.error(`${fallback}:`, raw);
  if (err?.code === 8 || /RESOURCE_EXHAUSTED|Quota limit exceeded|Quota exceeded/i.test(raw)) {
    // Five minutes: long enough not to be hammered, short enough that a crawler
    // comes back the same day if the quota resets.
    res.setHeader('Retry-After', '300');
    return res.status(503).json({ error: 'The shop is briefly unavailable. Please try again shortly.', reason: 'busy' });
  }
  return res.status(500).json({ error: fallback });
}

function adminError(res: express.Response, err: any, fallback: string) {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  const raw = String(err?.message ?? err);
  console.error(`${fallback}:`, raw);
  // The one case worth naming, because it is the one that keeps happening and
  // the owner CAN act on it.
  if (/RESOURCE_EXHAUSTED|Quota limit exceeded/i.test(raw)) {
    return res.status(503).json({
      error: 'The database has hit its daily read limit. It resets at midnight Pacific time — or upgrade the Firebase project to remove the limit.',
      reason: 'firestore_quota',
    });
  }
  return res.status(500).json({ error: fallback });
}

const KNOWN_SUPPLIERS: Record<string, { name: string; kind: string; currency: string; needsCredentials: boolean }> = {
  easygifts: { name: 'EasyGifts', kind: 'static-json', currency: 'EUR', needsCredentials: false },
  promediaplus: { name: 'Pro Media Plus', kind: 'xml-basic-auth', currency: 'EUR', needsCredentials: true },
  midocean: { name: 'midocean', kind: 'rest-api-key', currency: 'SEK', needsCredentials: true },
  tedgifted: { name: 'TedGifted', kind: 'rest-api-key', currency: 'EUR', needsCredentials: true },
  lshopteam: { name: 'L-SHOP-TEAM', kind: 'unknown', currency: 'EUR', needsCredentials: true },
};

app.get('/api/admin/suppliers', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);

    const [stored, secrets] = await Promise.all([
      db.collection('suppliers').get(),
      db.collection('secrets').doc('integrations').get(),
    ]);
    const byId = new Map(stored.docs.map((d) => [d.id, d.data()]));
    const secretData = secrets.exists ? (secrets.data() ?? {}) : {};

    // HOW MANY ROWS EACH SUPPLIER HAS — counted, not downloaded.
    //
    // This read every document in `supplierIndex` with a field mask and tallied
    // them in a loop: about two thousand billed reads, on EVERY load of this
    // screen, with NO cache at all — on top of the four thousand the unfiltered
    // catalogue loader was spending next door. The free daily quota is fifty
    // thousand, so a dozen visits to one screen spent the lot, and today it was
    // spent: the owner's client photographed the empty grid and the red "daily
    // read limit" banner in the same screenshot.
    //
    // A count() aggregation is billed at ONE read per thousand documents matched.
    // Three suppliers, about two thousand rows: six reads instead of two thousand,
    // and the number on screen is exactly as true.
    //
    // The cost of that is `indexedAt`, which an aggregation cannot return. It
    // comes from the supplier document the indexer already stamps, and when it is
    // absent the screen says so rather than inventing a date.
    let indexed = new Map<string, { count: number | null; indexedAt: string | null }>();
    let countsRefused = false;
    // THE COUNTS ARE KEPT (2026-10-08). Measured in Cloud Monitoring: on this
    // database a count() is NOT one read per thousand rows — each supplier's
    // count cost ~200 read units, so every open of this screen was 1 000–2 000 of
    // the 50 000 a day. The last counts are kept on disk and shown again until an
    // index run makes them old (a supplier's lastIndexAt after them), a day goes
    // by, or the owner asks for a recount (?recount=1).
    const kept = readDiskCache<{ id: string; count: number | null; indexedAt: string | null }>('supplier-index-counts');
    const indexedSinceKept = !!kept && [...byId.values()].some((sup: any) => {
      const t = Date.parse(String(sup?.lastIndexAt ?? ''));
      return Number.isFinite(t) && t > kept.at;
    });
    const useKept = String(req.query.recount ?? '') !== '1' && !!kept && kept.items.length > 0
      && Date.now() - kept.at < 24 * 60 * 60 * 1000 && !indexedSinceKept;
    let countsAt: number | null = useKept && kept ? kept.at : null;
    if (useKept && kept) {
      for (const row of kept.items) {
        indexed.set(row.id, { count: row.count, indexedAt: String((byId.get(row.id) as any)?.lastIndexAt ?? '') || row.indexedAt });
      }
    } else try {
      const ids = Object.keys(KNOWN_SUPPLIERS);
      const counts = await Promise.all(ids.map(async (id) => {
        const agg = await db.collection('supplierIndex').where('supplier', '==', id).count().get();
        return [id, Number(agg.data().count ?? 0)] as const;
      }));
      for (const [id, count] of counts) {
        indexed.set(id, { count, indexedAt: String((byId.get(id) as any)?.lastIndexAt ?? '') || null });
      }
      countsAt = Date.now();
      writeDiskCache('supplier-index-counts', [...indexed].map(([id, v]) => ({ id, ...v })), countsAt);
    } catch (err) {
      // A REFUSED READ IS NOT A COUNT OF ZERO, and this screen used to make
      // exactly that mistake: the catch left the map empty, every supplier
      // reported 0 indexed, and the owner read "nothing has been imported" when
      // the truth was "I was not allowed to look".
      countsRefused = true;
      console.warn('Supplier index counts unavailable:', (err as any)?.message ?? err);
      const disk = readDiskCache<{ id: string; count: number | null; indexedAt: string | null }>('supplier-index-counts');
      if (disk) {
        for (const row of disk.items) indexed.set(row.id, { count: row.count, indexedAt: row.indexedAt });
        countsAt = disk.at;
        console.warn(`Serving supplier counts from the disk copy of ${new Date(disk.at).toISOString()}.`);
      }
    }

    const suppliers = Object.entries(KNOWN_SUPPLIERS).map(([id, meta]) => {
      const saved = byId.get(id) ?? {};
      const idx = indexed.get(id);
      return {
        id,
        ...meta,
        enabled: saved.enabled === true,
        // WHETHER a credential is stored, never the credential. The screen needs
        // to show a tick; it must never be able to show a password.
        hasCredentials: Boolean((secretData as any)[id])
          || (id === 'promediaplus' && Boolean((secretData as any).supplier)),
        // The last four characters, so the screen can tell one key from another
        // without being able to use either. Never the key.
        last4: (secretData as any)[id]?.last4 ?? null,
        // 3.7 — both now run through the same adapter path, not two importers.
        adapterBuilt: ADAPTER_SUPPLIERS.has(id),
        lastIndexedAt: idx?.indexedAt ?? null,
        // NULL MEANS "I COULD NOT LOOK", 0 MEANS "I LOOKED AND THERE IS NOTHING".
        // They were the same value here, so a refused read told the owner his
        // supplier had no catalogue — which is how a quota outage came to look
        // like an empty index. The screen renders the two differently.
        indexedProducts: idx ? idx.count : null,
        lastSyncAt: saved.lastSyncAt ?? null,
        lastSyncStatus: saved.lastSyncStatus ?? null,
        note: saved.note ?? null,
      };
    });

    return res.json({
      suppliers,
      // Said out loud, so the screen never has to guess why a number is missing.
      countsRefused,
      // When the numbers were counted — the screen offers a recount beside it.
      countsAt: countsAt ? new Date(countsAt).toISOString() : null,
    });
  } catch (err: any) {
    return adminError(res, err, 'Could not read the suppliers.');
  }
});

app.post('/api/admin/suppliers/:supplier', async (req, res) => {
  try {
    const { db, uid } = await requireAdmin(req);
    const supplier = String(req.params.supplier ?? '').trim().toLowerCase();
    if (!KNOWN_SUPPLIERS[supplier]) return res.status(404).json({ error: 'No such supplier.' });

    const patch: Record<string, any> = { updatedAt: new Date().toISOString(), updatedBy: uid ?? 'admin' };
    if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled;
    if (typeof req.body?.note === 'string') patch.note = req.body.note.slice(0, 500);
    // Deliberately NOT accepting credentials here. They go through the
    // integrations endpoint, which writes to secrets/integrations with
    // { merge: true } — a supplier record that accepted a password would be one
    // rule change away from publishing it.
    await db.collection('suppliers').doc(supplier).set(patch, { merge: true });
    return res.json({ ok: true, supplier, ...patch });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Could not save the supplier.' });
  }
});

/**
 * Can we actually reach this supplier's data right now?
 *
 * A "connected" badge that means "a password is stored" is worse than no badge:
 * this shop has already shipped a green tick on a dead Google Drive connection.
 * So this FETCHES something small and reports what came back.
 */
/**
 * Save a supplier's API key — 3.8.
 *
 * PROVEN BEFORE IT IS STORED, the same rule verifyMollieKey follows: a wrong key
 * saved unchecked fails later, during an import, which is a far worse moment to
 * find out.
 *
 * It goes to secrets/integrations, which no browser may open, and is NEVER sent
 * back — the screen gets "a key is stored" and its last four characters, which is
 * enough to tell one key from another and not enough to use one.
 *
 * Pro Media Plus is not here: its credential is a username and a password, not a
 * single value, and it has its own endpoint.
 */
app.post('/api/admin/suppliers/:supplier/credentials', async (req, res) => {
  try {
    const { db, uid } = await requireAdmin(req);
    const supplier = String(req.params.supplier ?? '').trim().toLowerCase();
    if (supplier !== MIDOCEAN) {
      return res.status(400).json({ error: `No key panel for "${supplier}".` });
    }
    const apiKey = String(req.body?.apiKey ?? '').trim();
    if (!apiKey) return res.status(400).json({ error: 'The key is empty.' });

    const probe = await fetch('https://api.midocean.com/gateway/pricelist/2.0', {
      headers: { 'x-Gateway-APIKey': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null);
    if (!probe) return res.status(502).json({ error: 'midocean could not be reached.' });
    if (probe.status === 401 || probe.status === 403) {
      return res.status(400).json({ error: 'midocean rejected that key.' });
    }
    if (!probe.ok) return res.status(502).json({ error: `midocean answered ${probe.status}.` });

    await db.collection('secrets').doc('integrations').set(
      {
        [supplier]: {
          apiKey,
          last4: apiKey.slice(-4),
          updatedAt: new Date().toISOString(),
          updatedBy: uid ?? 'admin',
        },
      },
      // MERGE, always. A plain set() here would delete Mollie's key, Zendr's,
      // Google's tokens and the Pro Media Plus login in one stroke.
      { merge: true },
    );
    await loadIntegrationSecrets(true);
    // A new key may open a different account, so nothing parsed under the old
    // one may survive it.
    midoceanCache = null;

    console.log(`Supplier key updated from the dashboard: ${supplier} (…${apiKey.slice(-4)}).`);
    return res.json({ ok: true, last4: apiKey.slice(-4) });
  } catch (err: any) {
    return adminError(res, err, 'Could not save the supplier key.');
  }
});

app.post('/api/admin/suppliers/:supplier/test', async (req, res) => {
  try {
    await requireAdmin(req);
    const supplier = String(req.params.supplier ?? '').trim().toLowerCase();
    if (!ADAPTER_SUPPLIERS.has(supplier)) {
      return res.status(400).json({ error: `No connection test for "${supplier}" yet.` });
    }
    const t0 = Date.now();

    // 3.7 — Pro Media Plus needs its saved login, so the test is the one thing
    // that cannot be shared: it proves the CREDENTIALS as well as the host. It
    // reads from the cache when one is warm, which is the point — the question
    // is whether this server can get the catalogue, not whether it can make the
    // supplier send 1.7 MB again.
    if (supplier === MIDOCEAN) {
      // The cheapest proof that the key works: the price list is 1.3 MB against
      // the products file's 26. If this answers, the gateway and the key are both
      // good and the catalogue is a download away.
      const secrets = await loadIntegrationSecrets();
      const key = (secrets.midocean?.apiKey ?? '').trim();
      if (!key) return res.status(400).json({ error: 'The midocean API key has not been saved yet.' });
      const r = await fetch('https://api.midocean.com/gateway/pricelist/2.0', {
        headers: { 'x-Gateway-APIKey': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(120_000),
      });
      if (r.status === 401 || r.status === 403) {
        return res.status(400).json({ ok: false, error: 'midocean rejected the API key.' });
      }
      if (!r.ok) return res.status(502).json({ ok: false, status: r.status, error: `midocean answered ${r.status}.` });
      const body: any = await r.json();
      const rows = Array.isArray(body?.price) ? body.price.length : Array.isArray(body) ? body.length : 0;
      return res.json({ ok: true, ms: Date.now() - t0, detail: `${rows} price rows, in ${MIDOCEAN_CURRENCY}` });
    }

    if (supplier === PRO_MEDIA_PLUS) {
      const secrets = await loadIntegrationSecrets();
      const { offers, skipped } = await fetchSupplierOffers(secrets.supplier ?? {});
      return res.json({
        ok: true,
        ms: Date.now() - t0,
        detail: `${offers.length} products${skipped ? `, ${skipped} unpriced rows skipped` : ''}`,
      });
    }

    const r = await fetch('https://easygifts.com.pl/data/webapi2/se/json/categories.json', {
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return res.status(502).json({ ok: false, status: r.status, error: `The supplier answered ${r.status}.` });
    const body: any = await r.json();
    const roots = Array.isArray(body?.categories) ? body.categories.length : 0;
    return res.json({ ok: true, ms: Date.now() - t0, detail: `${roots} top-level categories` });
  } catch (err: any) {
    // requireAdmin THROWS a 401/403, and this catch used to turn every error into
    // a 502 — so an unauthenticated caller got "502 Bad Gateway" and, far worse,
    // the fetch above had already run. An outsider could make this server hammer
    // the supplier by hitting the endpoint in a loop. The status the error
    // carries wins; 502 is only for the supplier actually failing.
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return res.status(502).json({ ok: false, error: String(err?.message ?? err).slice(0, 200) });
  }
});

/**
 * Re-sync a supplier's products — plan task 3.10.
 *
 * It refreshes the price and the translations on products ALREADY imported, and
 * it is the most dangerous thing in this file: it runs over hundreds of products
 * the owner has worked on since, unattended.
 *
 * Two guards, both in src/lib/suppliers/resync.ts with tests:
 *   - the write is restricted to a NAMED list of fields. `isHidden` and
 *     `salePrice` are his decisions — what he has published and what he has
 *     promised — and `categoryId` is his filing. None of them are on the list.
 *   - any price moving more than ±X% is REFUSED and reported instead. A 400%
 *     move is almost never a price change; it is a decimal in a different place
 *     or a rate typed with a comma, and this shop has already had one
 *     underpricing incident of exactly that shape.
 *
 * `dryRun` is the default. Nothing is written unless it is explicitly false.
 */
app.post('/api/admin/suppliers/:supplier/resync', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const supplier = String(req.params.supplier ?? '').trim().toLowerCase();
    if (!ADAPTER_SUPPLIERS.has(supplier)) return res.status(400).json({ error: `No adapter for "${supplier}" yet.` });

    // 15.1.7 — see sentNumber: an empty box must not resync the catalogue at cost.
    const requestedRate = sentNumber(req.body?.rate);
    const marginPercent = sentNumber(req.body?.marginPercent);
    if (requestedRate === null || requestedRate <= 0) return res.status(400).json({ error: 'An exchange rate is required.' });
    if (marginPercent === null || marginPercent < 0) return res.status(400).json({ error: 'A margin is required. An empty box is not 0%.' });
    // 3.8 — a feed already quoted in kronor is never multiplied by anything.
    const rate = effectiveRate(supplier, requestedRate);
    const maxMove = Number.isFinite(Number(req.body?.maxPriceMovePercent))
      ? Number(req.body.maxPriceMovePercent)
      : 25;
    const dryRun = req.body?.dryRun !== false;

    // Which products came from this supplier. productCosts is the record of
    // that — the product document carries only the display name.
    const costSnap = await db.collection('productCosts').where('supplier', '==', supplier).select('supplierOfferId').get();
    if (costSnap.empty) return res.json({ ok: true, supplier, candidates: 0, message: 'Nothing has been imported from this supplier.' });

    const keyById = new Map(costSnap.docs.map((d) => [d.id, String(d.data().supplierOfferId ?? '')]));
    const ids = [...keyById.keys()];

    const current = new Map<string, number | null>();
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      const snap = await db.collection('products')
        .where(FieldPath.documentId(), 'in', chunk)
        .select('basePrice')
        .get();
      for (const d of snap.docs) current.set(d.id, Number(d.data().basePrice) || null);
    }

    const feed = await loadSupplierProducts(supplier);
    const byKey = new Map(feed.map((p: any) => [p.productKey, p]));

    const nowIso = new Date().toISOString();
    const fresh = new Map<string, any>();
    const candidates = ids.map((id) => {
      const p = byKey.get(keyById.get(id) ?? '');
      if (!p) return { productId: id, currentPrice: current.get(id) ?? null, nextPrice: null };
      const out = supplierProductToShop(
        p,
        { rate, marginPercent, takenSlugs: [], hidden: true, nowIso },
        slugify,
        uniqueSlug,
      );
      if (out) fresh.set(id, out.product);
      return { productId: id, currentPrice: current.get(id) ?? null, nextPrice: out?.product.basePrice ?? null };
    });

    const plan = planResync(candidates, maxMove);

    if (dryRun) {
      return res.json({
        ok: true, supplier, dryRun: true,
        candidates: candidates.length,
        wouldUpdate: plan.updates.length,
        refused: plan.refused,
        unchanged: plan.outcomes.filter((o) => o.action === 'unchanged').length,
      });
    }

    const BATCH = 400;
    let written = 0;
    for (let i = 0; i < plan.updates.length; i += BATCH) {
      const batch = db.batch();
      for (const u of plan.updates.slice(i, i + BATCH)) {
        const product = fresh.get(u.productId);
        if (!product) continue;
        // Only the named fields. forResync is what makes "never touches isHidden
        // or salePrice" a property of the code rather than a promise in a doc.
        batch.set(db.collection('products').doc(u.productId), { ...forResync(product), updatedAt: nowIso }, { merge: true });
        written += 1;
      }
      await batch.commit();
    }

    await db.collection('suppliers').doc(supplier).set(
      { lastSyncAt: nowIso, lastSyncStatus: `${written} updated, ${plan.refused.length} refused` },
      { merge: true },
    );
    invalidateShopCatalogue();

    return res.json({ ok: true, supplier, dryRun: false, updated: written, refused: plan.refused });
  } catch (err: any) {
    return adminError(res, err, 'The re-sync failed.');
  }
});

/**
 * Turn a supplier's category tree into the shop's — plan task 3.9.
 *
 * EasyGifts files its products under ten roots with sub-categories beneath, and
 * the whole tree arrives ALREADY IN SWEDISH: "Pennor och skrivartiklar ›
 * Metallpennor". Typing that by hand is the work 1.2 and round 13 exist to
 * avoid, so this creates the shop categories with `parentId` set and the Swedish
 * name in `nameI18n`.
 *
 * It CREATES, and it never overwrites. A category the owner has already made —
 * renamed, given a picture, nested somewhere he chose — is left exactly as it
 * is, and reported as existing. An import that quietly re-parented his
 * categories would rearrange the shop's navigation under him.
 */
app.post('/api/admin/suppliers/:supplier/categories', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const supplier = String(req.params.supplier ?? '').trim().toLowerCase();
    if (!ADAPTER_SUPPLIERS.has(supplier)) return res.status(400).json({ error: `No adapter for "${supplier}" yet.` });

    // Which paths to create. Given none, every path in the index — but that is
    // asked for explicitly rather than assumed, because it is 10 roots and
    // ~60 children and he may want three of them.
    const wanted: string[][] = Array.isArray(req.body?.paths)
      ? req.body.paths.map((p: unknown) => (Array.isArray(p) ? p.map(String) : [])).filter((p: string[]) => p.length)
      : [];

    const index = (await loadSupplierIndex(supplier)).rows;
    const paths: string[][] = wanted.length
      ? wanted
      : [...new Map(
          index
            .filter((r) => r.gone !== true && Array.isArray(r.categoryPath) && r.categoryPath.length)
            .map((r) => [r.categoryPath.join(' › '), r.categoryPath as string[]]),
        ).values()];

    if (paths.length === 0) return res.json({ ok: true, created: [], existing: [], message: 'The index has no categories yet.' });

    const existingSnap = await db.collection('categories').select('name').get();
    // Matched on the CANONICAL name, never a translation — the same rule every
    // other join in this shop follows.
    const byName = new Map(existingSnap.docs.map((d) => [String(d.data().name ?? '').toLowerCase(), d.id]));

    const created: { id: string; name: string; parentId: string | null }[] = [];
    const existing: string[] = [];
    const batch = db.batch();
    let writes = 0;

    for (const path of paths) {
      let parentId: string | null = null;
      for (const rawName of path) {
        const name = rawName.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const already = byName.get(key);
        if (already) {
          // Left alone. Re-parenting a category the owner has filed himself
          // would rearrange his navigation without being asked.
          if (!existing.includes(name)) existing.push(name);
          parentId = already;
          continue;
        }
        const id = uniqueSlug(slugify(name), [...byName.values()]);
        const doc: Record<string, any> = {
          name,
          // The feed's Swedish IS the name here — the index carries the Swedish
          // tree — so it goes in both places: the canonical name for joins, and
          // nameI18n.sv for what a Swedish customer reads.
          nameI18n: { sv: name, da: null, no: null },
          description: '',
          image: '',
          isHidden: true,
          ...(parentId ? { parentId } : {}),
        };
        batch.set(db.collection('categories').doc(id), doc);
        writes += 1;
        byName.set(key, id);
        created.push({ id, name, parentId });
        parentId = id;
      }
    }

    if (writes > 0) {
      await batch.commit();
      invalidateShopCategories();
    }
    return res.json({ ok: true, created, existing, hidden: true });
  } catch (err: any) {
    return adminError(res, err, 'The categories could not be created.');
  }
});

/**
 * What the shop owes in points — plan task 4.20.
 *
 * "total liability in SEK at the top — it is a debt". Loyalty points are not a
 * marketing figure: every point outstanding is a discount the shop has already
 * promised and will pay for out of a future margin. A dashboard that shows
 * "1 240 members" and not "18 300 kr of promised discount" is describing the
 * pleasant half.
 *
 * Counted from the user documents rather than the ledger: the balance is what
 * would actually be redeemed, and a ledger sum could disagree with it if an
 * adjustment was ever made outside the ledger.
 */
app.get('/api/admin/loyalty/liability', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const snap = await db.collection('users').select('loyaltyPoints', 'loyaltyTier', 'email').get();

    let totalPoints = 0;
    let holders = 0;
    let largest = { email: null as string | null, points: 0 };
    const byTier: Record<string, { holders: number; points: number }> = {};

    for (const d of snap.docs) {
      const points = Math.max(0, Number(d.data().loyaltyPoints) || 0);
      if (points <= 0) continue;
      totalPoints += points;
      holders += 1;
      if (points > largest.points) largest = { email: String(d.data().email ?? d.id), points };
      const tier = String(d.data().loyaltyTier ?? 'Silver');
      const t = byTier[tier] ?? { holders: 0, points: 0 };
      t.holders += 1; t.points += points;
      byTier[tier] = t;
    }

    // The shop's own rate, not a constant: 4.26 makes it a setting, and this
    // figure has to move with it or it becomes wrong the day he changes it.
    // `pointsPerSek` is the REDEMPTION rate — how many points buy one krona —
    // which is the one this figure needs. `pointsEarnedPerSek` is the other
    // direction and would give an answer 25× wrong.
    const printSettings = await fetchPrintSettings();
    const pointsPerKrona = Number(printSettings?.pointsPerSek) > 0
      ? Number(printSettings.pointsPerSek)
      : PRICING_DEFAULTS.pointsPerSek;

    return res.json({
      totalPoints,
      pointsPerKrona,
      // THE NUMBER THAT MATTERS. Rounded to the krona, because that is the unit
      // the debt is owed in.
      liabilitySek: Math.round(totalPoints / pointsPerKrona),
      holders,
      accounts: snap.size,
      byTier,
      largestHolder: largest.points > 0 ? largest : null,
    });
  } catch (err: any) {
    return adminError(res, err, 'Could not work out the points liability.');
  }
});

/**
 * Adjust a customer's points by hand — plan tasks 4.19 and 4.6.
 *
 * The dashboard used to write `loyaltyPoints` and a 50-entry `pointsHistory`
 * straight to the user document. That worked — an admin may write it — but it
 * bypassed the ledger, so the one permanent record of a customer's points had a
 * hole in it exactly where somebody had intervened by hand. Those are the
 * entries most likely to be asked about.
 *
 * A REASON IS MANDATORY (4.19). "Bonus from Admin" as a default is not a reason;
 * six months later nobody can tell a goodwill credit from a correction from a
 * test, and the customer asking about it gets no answer.
 */
app.post('/api/admin/loyalty/:uid/adjust', async (req, res) => {
  try {
    const { db, uid: actor } = await requireAdmin(req);
    const uid = String(req.params.uid ?? '').trim();
    if (!uid) return res.status(400).json({ error: 'A customer is required.' });

    const delta = Number(req.body?.points);
    if (!Number.isFinite(delta) || delta === 0) {
      return res.status(400).json({ error: 'A number of points is required, positive or negative.' });
    }
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < 3) {
      return res.status(400).json({ error: 'A reason is required — it is the only record of why this happened.' });
    }

    const userRef = db.collection('users').doc(uid);
    const ledger = userRef.collection('pointsLedger');
    const at = new Date().toISOString();
    let after = 0;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw Object.assign(new Error('No such customer.'), { status: 404 });
      const before = Math.max(0, Number(snap.data()?.loyaltyPoints) || 0);
      // Never below zero. A negative balance is not a debt this shop collects;
      // it is a number that breaks every screen that renders it.
      after = Math.max(0, before + delta);
      const applied = after - before;

      const entry = {
        id: `adj-${Date.now()}`,
        date: at,
        points: applied,
        type: 'adjustment',
        description: reason,
        // WHO. An audit trail that does not say who adjusted it answers half the
        // question.
        by: actor ?? 'admin',
        ...(applied !== delta ? { requested: delta, note: 'clamped at zero' } : {}),
      };
      const history = Array.isArray(snap.data()?.pointsHistory) ? snap.data()!.pointsHistory : [];
      tx.set(ledger.doc(entry.id), entry);
      tx.update(userRef, {
        loyaltyPoints: after,
        // 4.25 — THE TIER IS NOT TOUCHED HERE. It follows lifetime spend, and a
        // manual points adjustment is not a purchase. Setting it from the
        // balance, as this did, meant a goodwill gesture of 2 500 points made a
        // customer Platinum and redeeming them demoted him again.
        pointsHistory: [entry, ...history].slice(0, 50),
        updatedAt: at,
      });
    });

    return res.json({ ok: true, uid, balance: after });
  } catch (err: any) {
    return adminError(res, err, 'The adjustment failed.');
  }
});

/**
 * 4.16 — ONE CUSTOMER'S LEDGER.
 *
 * The ledger has existed since 4.6 and nothing in the dashboard could see it.
 * The owner had a balance, a "history" array truncated at fifty, and no way to
 * answer "where did these points come from?" — which is the only question worth
 * asking before adjusting a balance.
 */
app.get('/api/admin/loyalty/:uid/ledger', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const uid = String(req.params.uid ?? '').trim();
    if (!uid) return res.status(400).json({ error: 'A customer is required.' });

    const [userSnap, ledgerSnap] = await Promise.all([
      db.collection('users').doc(uid).get(),
      // OLDEST FIRST, and the same 1 000 the sweep reads.
      //
      // Not a presentation choice. The expiry replay below is FIFO, so it needs
      // the EARLIEST entries — and those are exactly the ones a newest-first
      // window drops. Read the other way round, a customer with a long history
      // would have had his expiry computed from a ledger with its beginning
      // missing, which is the one part that matters.
      db.collection('users').doc(uid).collection('pointsLedger').orderBy('date', 'asc').limit(1000).get(),
    ]);
    if (!userSnap.exists) return res.status(404).json({ error: 'No such customer.' });

    const all = ledgerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) } as Record<string, any>));
    const settings = loyaltySettingsFrom(await fetchPrintSettings());

    // 4.18 — when the customer's oldest live points run out. Computed from the
    // whole ledger, FIFO, in src/lib/loyalty.ts.
    const plan = planPointsExpiry(all, Date.now(), settings);

    // The screen shows the most recent first, which is the order somebody reads
    // a statement in. The arithmetic above used all of it.
    const entries = [...all].reverse().slice(0, 200);

    return res.json({
      uid,
      balance: Math.max(0, Number(userSnap.data()?.loyaltyPoints) || 0),
      lifetimeSpend: Math.max(0, Number(userSnap.data()?.lifetimeSpend) || 0),
      tier: tierForSpend(Number(userSnap.data()?.lifetimeSpend) || 0, settings),
      valueSek: pointsValueSek(Number(userSnap.data()?.loyaltyPoints) || 0, settings),
      entries,
      // The ledger's own arithmetic, so a balance that has drifted from it is
      // visible rather than merely wrong.
      ledgerBalance: plan.ledgerBalance,
      pendingExpiry: plan.expire,
      nextExpiryAt: plan.nextExpiryIso,
      truncated: ledgerSnap.size >= 1000 || all.length > entries.length,
    });
  } catch (err: any) {
    return adminError(res, err, 'The points history could not be read.');
  }
});

/**
 * 4.18 — THE EXPIRY SWEEP.
 *
 * Points are a liability (4.20 counts it in kronor), and a liability with no end
 * never leaves the books. This walks the customers who hold a balance, replays
 * each ledger FIFO, and writes one `expired` entry for whatever has run out.
 *
 * It is safe to run twice: the entry it writes is a spend like any other, so the
 * next replay finds nothing left. And it does NOTHING at all while
 * `pointsExpiryMonths` is 0 — which is where this shop starts, because switching
 * expiry on by default would quietly delete balances customers have already
 * earned. That decision is the owner's, in the dashboard.
 *
 * `dryRun` reports what it WOULD take without taking it. Nobody should have to
 * find out what a first run does by running it.
 */
async function sweepPointsExpiry(dryRun: boolean): Promise<{
  ran: boolean;
  reason?: string;
  customers: number;
  expired: number;
  /** How many balances were looked at, and whether the scan hit its own ceiling. */
  scanned: number;
  capped: boolean;
  details: { uid: string; points: number }[];
}> {
  const db = getAdminDb();
  if (!db) return { ran: false, reason: 'no-database', customers: 0, expired: 0, scanned: 0, capped: false, details: [] };

  const settings = loyaltySettingsFrom(await fetchPrintSettings());
  if (!(settings.pointsExpiryMonths > 0)) {
    return { ran: false, reason: 'expiry-off', customers: 0, expired: 0, scanned: 0, capped: false, details: [] };
  }
  const SCAN_LIMIT = 500;

  // Only customers who actually hold points. A shop with ten thousand accounts
  // and two hundred balances must not read ten thousand documents to find them —
  // the Firestore quota on this project has already taken the shop dark once.
  const holders = await db.collection('users')
    .where('loyaltyPoints', '>', 0)
    .select('loyaltyPoints')
    .limit(SCAN_LIMIT)
    .get();

  const details: { uid: string; points: number }[] = [];
  let expiredTotal = 0;

  for (const holder of holders.docs) {
    const userRef = holder.ref;
    const ledger = userRef.collection('pointsLedger');
    try {
      const entriesSnap = await ledger.orderBy('date', 'asc').limit(1000).get();
      const entries = entriesSnap.docs.map((d) => d.data() as Record<string, any>);
      const plan = planPointsExpiry(entries, Date.now(), settings);
      if (plan.expire <= 0) continue;

      details.push({ uid: holder.id, points: plan.expire });
      expiredTotal += plan.expire;
      if (dryRun) continue;

      // The day's entry id, decided OUTSIDE the transaction so the transaction
      // can read it. One per customer per day.
      const entryId = `exp-${dayKeyInShopTime(new Date().toISOString()) || new Date().toISOString().slice(0, 10)}`;
      const entryRef = ledger.doc(entryId);

      await db.runTransaction(async (tx) => {
        // BOTH, and the marker first in spirit: the id alone did not stop a
        // second deduction. Two sweeps a minute apart each computed the same
        // 40 points to expire, each wrote the SAME ledger document — harmlessly,
        // one overwriting the other — and each then took 40 off the balance, for
        // 80. Firestore serialises them on this very read; what was missing was
        // anything that noticed the work had already been done.
        const [snap, already] = await tx.getAll(userRef, entryRef);
        if (!snap.exists) return;
        if (already.exists) return;
        const balance = Math.max(0, Number(snap.data()?.loyaltyPoints) || 0);
        // Never more than the balance. A ledger that disagrees with the balance
        // must not create a negative one.
        const take = Math.min(balance, plan.expire);
        if (take <= 0) return;
        const at = new Date().toISOString();
        const entry = {
          id: entryId,
          date: at,
          points: -take,
          type: 'expired',
          description: `${take} points expired after ${settings.pointsExpiryMonths} months`,
        };
        const history = Array.isArray(snap.data()?.pointsHistory) ? snap.data()!.pointsHistory : [];
        tx.set(entryRef, entry);
        tx.update(userRef, {
          loyaltyPoints: Math.max(0, balance - take),
          pointsHistory: [...history, entry].slice(-50),
          updatedAt: at,
        });
      });
    } catch (err) {
      // One customer's ledger failing must not stop the sweep for everybody
      // else. Logged, and the count reports what actually happened.
      console.error(`Points expiry failed for ${holder.id}:`, (err as any)?.message ?? err);
    }
  }

  return {
    ran: true,
    customers: details.length,
    expired: expiredTotal,
    // NOT A SILENT CAP. A shop with more than 500 balances would otherwise be
    // told the sweep was complete when it had looked at the first five hundred.
    scanned: holders.size,
    capped: holders.size >= SCAN_LIMIT,
    details,
  };
}

app.post('/api/admin/loyalty/expire', async (req, res) => {
  try {
    await requireAdmin(req);
    // Defaults to a DRY RUN. An endpoint that deletes balances on an empty body
    // is one bad curl away from deleting them.
    const dryRun = req.body?.apply !== true;
    const result = await sweepPointsExpiry(dryRun);
    return res.json({ ok: true, dryRun, ...result });
  } catch (err: any) {
    return adminError(res, err, 'The expiry sweep failed.');
  }
});

// ---------------------------------------------------------------------------
// COUPONS — THE SERVER OWNS THE WRITE. 4.14 and 4.15.
//
// 4.15 asks for an audit log, and an audit log its own subject can edit is not
// one. The coupon screen wrote straight to Firestore from the browser, so every
// entry would have been written by the same hand it was meant to hold to
// account. The deep-discount rules had the same shape of problem: 4.2's
// mandatory ceiling above 50% lived only in the form, and a paste into the
// browser console walked straight past it — while the till honours whatever is
// stored, because the owner is the one allowed to decide discounts.
//
// So the browser POSTs here, this validates as if the body came from a
// stranger, and the coupon and its audit entry are written in ONE batch. The
// rules then close `coupons` to browser writes.
// ---------------------------------------------------------------------------

/** How far back the audit screen looks. Enough to answer "who changed this?". */
const COUPON_AUDIT_LIMIT = 200;

/** The fields whose change is worth recording. `usedCount` is not among them. */
const COUPON_AUDITED_FIELDS = [
  'code', 'percent', 'active', 'minOrderAmount', 'expiresAt', 'startsAt',
  'maxUses', 'oncePerCustomer', 'scope', 'productIds', 'maxDiscountAmount',
  'audience', 'firstOrderOnly', 'noStacking', 'discountIncludesShipping',
  'minMarginPercent',
] as const;

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A number, or null, or a refusal.
 *
 * `''` and undefined both mean "the owner left the box empty", which is null —
 * not 0. The difference decides whether a coupon is uncapped or discounts
 * nothing at all.
 */
function optionalNumber(value: unknown, label: string, min: number, max: number): number | null | { error: string } {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return { error: `${label} must be a number.` };
  if (n < min || n > max) return { error: `${label} must be between ${min} and ${max}.` };
  return n;
}

function parseCouponInput(body: any): { coupon: Record<string, any> } | { error: string } {
  const code = String(body?.code ?? '').toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) {
    return { error: 'A code is 3 to 24 characters, letters and digits only.' };
  }

  const percent = Number(body?.percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
    return { error: 'The discount must be between 1 and 100 per cent.' };
  }

  const minOrderAmount = optionalNumber(body?.minOrderAmount, 'The minimum order', 0, 1_000_000);
  if (minOrderAmount && typeof minOrderAmount === 'object') return { error: minOrderAmount.error };
  const maxUses = optionalNumber(body?.maxUses, 'The usage limit', 1, 1_000_000);
  if (maxUses && typeof maxUses === 'object') return { error: maxUses.error };
  const maxDiscountAmount = optionalNumber(body?.maxDiscountAmount, 'The maximum discount', 0, 1_000_000);
  if (maxDiscountAmount && typeof maxDiscountAmount === 'object') return { error: maxDiscountAmount.error };
  const minMarginPercent = optionalNumber(body?.minMarginPercent, 'The margin floor', 0, 100);
  if (minMarginPercent && typeof minMarginPercent === 'object') return { error: minMarginPercent.error };

  // 4.2 — ANYTHING ABOVE HALF PRICE MUST BE CAPPED. Checked here and not only in
  // the form: TEST100, a live 100% code, sat in this shop's own coupon list.
  //
  // EXCEPT WHEN IT IS BEING SWITCHED OFF, and that exception is the whole point.
  // An inactive code discounts nothing, so there is nothing to cap — and without
  // this, the one uncapped 90% coupon already in the shop could not be turned OFF
  // from the table: the rule that exists to contain the damage would have refused
  // the action that contains it, and the owner would have been left with a live
  // deep discount and an error message.
  const switchingOff = body?.active === false;
  if (percent > 50 && !switchingOff && !(typeof maxDiscountAmount === 'number' && maxDiscountAmount > 0)) {
    return { error: `A ${percent}% code needs a maximum discount in kronor.` };
  }

  const expiresAt = body?.expiresAt ? String(body.expiresAt).slice(0, 10) : null;
  if (expiresAt && !DAY_ONLY.test(expiresAt)) return { error: 'The expiry date is not a date.' };
  const startsAt = body?.startsAt ? String(body.startsAt).slice(0, 10) : null;
  if (startsAt && !DAY_ONLY.test(startsAt)) return { error: 'The start date is not a date.' };
  // A window that closes before it opens is a code that can never be used, and
  // the screen would show it as perfectly healthy.
  if (startsAt && expiresAt && startsAt > expiresAt) {
    return { error: 'The code would expire before it starts.' };
  }

  const scope = body?.scope === 'products' ? 'products' : 'all';
  const productIds = Array.isArray(body?.productIds)
    ? [...new Set(body.productIds.map((v: unknown) => String(v ?? '').trim()).filter(Boolean))].slice(0, 500)
    : [];
  // A code scoped to nothing is accepted by the till and then discounts nothing,
  // which reads to a customer as the code being ignored.
  //
  // Exempt when it is being switched off, for the same reason the ceiling is: a
  // save that only deactivates a code must never be refused, or a legacy document
  // in this state could not be turned off at all.
  if (scope === 'products' && productIds.length === 0 && !switchingOff) {
    return { error: 'Pick at least one product, or set the code to apply to everything.' };
  }

  return {
    coupon: {
      code,
      percent,
      active: body?.active !== false,
      minOrderAmount: minOrderAmount as number | null,
      expiresAt,
      startsAt,
      maxUses: maxUses as number | null,
      oncePerCustomer: body?.oncePerCustomer === true,
      scope,
      // BOTH keys, ALWAYS. The write is a merge, and switching a coupon back to
      // "everything" by omitting productIds would leave the old list in the
      // document for the till to go on scoping by.
      productIds: scope === 'products' ? productIds : [],
      maxDiscountAmount: maxDiscountAmount as number | null,
      audience: toAudience(body?.audience),
      firstOrderOnly: body?.firstOrderOnly === true,
      noStacking: body?.noStacking === true,
      discountIncludesShipping: body?.discountIncludesShipping === true,
      minMarginPercent: minMarginPercent as number | null,
    },
  };
}

/** What changed, field by field, for the log. Empty when nothing did. */
function couponChanges(before: Record<string, any> | null, after: Record<string, any>): Record<string, { from: any; to: any }> {
  const out: Record<string, { from: any; to: any }> = {};
  for (const key of COUPON_AUDITED_FIELDS) {
    const from = before ? before[key] ?? null : null;
    const to = after[key] ?? null;
    // JSON, so productIds arrays compare by content rather than by reference.
    if (JSON.stringify(from) !== JSON.stringify(to)) out[key] = { from: from ?? null, to };
  }
  return out;
}

/**
 * The audit entry. Written in the same batch as the change it describes, so a
 * crash cannot leave a coupon altered with nothing to say who did it.
 *
 * `by` is the verified uid from the token — never a value out of the body.
 */
function couponAuditEntry(
  action: 'create' | 'update' | 'delete' | 'bulk' | 'toggle',
  code: string,
  by: { uid: string; email?: string | null },
  changes: Record<string, any>,
  nowIso: string,
  note?: string,
) {
  return {
    action,
    code,
    by: by.uid,
    byEmail: by.email ?? null,
    at: nowIso,
    changes,
    ...(note ? { note } : {}),
  };
}

/** Coupon documents have always been keyed on the code. Kept, so ids are readable. */
function couponDocId(code: string): string {
  return String(code).toLowerCase().replace(/[^a-z0-9]/g, '_');
}

app.post('/api/admin/coupons/save', async (req, res) => {
  try {
    const { db, uid, email } = await requireAdmin(req);
    const parsed = parseCouponInput(req.body ?? {});
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });
    const coupon = parsed.coupon;

    const editingId = String(req.body?.id ?? '').trim();
    const id = editingId || couponDocId(coupon.code);
    const ref = db.collection('coupons').doc(id);
    const existing = await ref.get();

    // TWO CODES THAT ARE THE SAME CODE. The document id is derived from the
    // code, so a rename onto an existing one would silently overwrite it —
    // taking its usedCount and its history with it.
    if (!editingId && existing.exists) {
      return res.status(409).json({ error: `The code ${coupon.code} already exists.` });
    }
    if (editingId) {
      const clash = await db.collection('coupons').where('code', '==', coupon.code).limit(2).get();
      if (clash.docs.some((d) => d.id !== id)) {
        return res.status(409).json({ error: `Another coupon already uses the code ${coupon.code}.` });
      }
    }

    const before = existing.exists ? (existing.data() as Record<string, any>) : null;
    const changes = couponChanges(before, coupon);
    const nowIso = new Date().toISOString();

    const batch = db.batch();
    batch.set(ref, {
      ...coupon,
      // Never written from here. The order flow owns it, and a form that reset
      // it would hand a spent code back to the shop.
      ...(before ? {} : { usedCount: 0, createdAt: nowIso }),
      updatedAt: nowIso,
      updatedBy: email ?? uid,
    }, { merge: true });
    batch.set(
      db.collection('couponAudit').doc(),
      couponAuditEntry(before ? 'update' : 'create', coupon.code, { uid, email }, changes, nowIso),
    );
    await batch.commit();

    return res.json({ ok: true, id, code: coupon.code, changed: Object.keys(changes) });
  } catch (err: any) {
    return adminError(res, err, 'The coupon could not be saved.');
  }
});

app.post('/api/admin/coupons/delete', async (req, res) => {
  try {
    const { db, uid, email } = await requireAdmin(req);
    const id = String(req.body?.id ?? '').trim();
    if (!id) return res.status(400).json({ error: 'Which coupon?' });

    const ref = db.collection('coupons').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'That coupon no longer exists.' });
    const data = snap.data() as Record<string, any>;
    const nowIso = new Date().toISOString();

    const batch = db.batch();
    batch.delete(ref);
    batch.set(
      db.collection('couponAudit').doc(),
      couponAuditEntry(
        'delete',
        String(data.code ?? id),
        { uid, email },
        // The whole document, because after this there is nothing left to read.
        { deleted: { from: data, to: null } },
        nowIso,
        `redeemed ${Number(data.usedCount) || 0} time(s) before deletion`,
      ),
    );
    await batch.commit();

    return res.json({ ok: true, id });
  } catch (err: any) {
    return adminError(res, err, 'The coupon could not be deleted.');
  }
});

/**
 * 4.14 — A BATCH OF UNIQUE CODES.
 *
 * One rule set, many codes: what a print run of cards or a mailing needs. Each
 * is its own document with its own usedCount, so "one per customer" is really
 * one per code and a leaked code costs one redemption rather than the campaign.
 */
app.post('/api/admin/coupons/bulk', async (req, res) => {
  try {
    const { db, uid, email } = await requireAdmin(req);

    const parsed = parseCouponInput({ ...(req.body ?? {}), code: 'BULKPLACEHOLDER' });
    if ('error' in parsed) return res.status(400).json({ error: parsed.error });

    const count = Math.floor(Number(req.body?.count) || 0);
    if (!(count > 0)) return res.status(400).json({ error: 'How many codes?' });
    if (count > 200) return res.status(413).json({ error: `That is ${count} codes; the limit for one batch is 200.` });
    const prefix = String(req.body?.prefix ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (prefix.length < 2) return res.status(400).json({ error: 'A batch needs a prefix of at least two letters.' });
    const length = Math.floor(Number(req.body?.length) || 6);

    // The codes must not collide with anything already in the shop. Read the
    // existing codes once rather than checking each generated one: 200 lookups
    // against a quota that has already taken this shop down for a day is not a
    // trade worth making.
    const taken = new Set<string>();
    const all = await db.collection('coupons').select('code').get();
    for (const d of all.docs) taken.add(String(d.data()?.code ?? '').toUpperCase());

    const codes = generateCouponCodes(
      prefix,
      count,
      length,
      // crypto, not Math.random: these are money, and a guessable code is a
      // discount anybody can help themselves to.
      (max) => crypto.randomInt(max),
      taken,
    );
    if (codes.length < count) {
      return res.status(409).json({
        error: `Only ${codes.length} of ${count} codes could be made unique. Try a longer code or a different prefix.`,
      });
    }

    const nowIso = new Date().toISOString();
    const batch = db.batch();
    for (const code of codes) {
      batch.set(db.collection('coupons').doc(couponDocId(code)), {
        ...parsed.coupon,
        code,
        usedCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
        updatedBy: email ?? uid,
        // Which batch these belong to, so a run can be found again later.
        batchPrefix: prefix,
      });
    }
    // ONE audit entry for the batch, naming every code. Two hundred entries
    // would bury the one change anybody is ever looking for.
    batch.set(
      db.collection('couponAudit').doc(),
      couponAuditEntry('bulk', prefix, { uid, email }, {
        count: codes.length,
        percent: parsed.coupon.percent,
        codes,
      }, nowIso, `${codes.length} codes generated`),
    );
    await batch.commit();

    return res.json({ ok: true, count: codes.length, codes });
  } catch (err: any) {
    return adminError(res, err, 'The batch could not be created.');
  }
});

/**
 * 4.24 — HOW EACH CODE ACTUALLY PERFORMED.
 *
 * Frozen at redemption time by the webhook, because none of it can be recovered
 * afterwards: the cost of the goods moves, the percentage can be edited, and an
 * order deleted for GDPR takes its row with it.
 *
 * The margin is computed here rather than stored, so a change to how it is
 * defined applies to the whole history at once. It says how many of the orders
 * behind it had a complete cost record — a margin that quietly counts an unknown
 * cost as free profit is worse than no margin at all.
 */
app.get('/api/admin/coupons/stats', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const snap = await db.collection('couponStats').limit(500).get();
    const stats = snap.docs.map((d) => {
      const s = d.data() as Record<string, any>;
      // Goods only, excluding the delivery fee — see the webhook that wrote it.
      const netRevenue = Number(s.netRevenue) || 0;
      const goodsCost = Number(s.goodsCost) || 0;
      const uses = Number(s.uses) || 0;
      return {
        id: d.id,
        code: String(s.code ?? d.id).toUpperCase(),
        uses,
        discountGiven: Number(s.discountGiven) || 0,
        netRevenue,
        goodsCost,
        // After the discount, because netRevenue is already net of it.
        marginSek: Math.round((netRevenue - goodsCost) * 100) / 100,
        marginPercent: netRevenue > 0 ? Math.round(((netRevenue - goodsCost) / netRevenue) * 1000) / 10 : null,
        ordersWithFullCost: Number(s.ordersWithFullCost) || 0,
        // The number that says whether a campaign recruited anybody.
        newCustomers: Number(s.newCustomers) || 0,
        newCustomerShare: uses > 0 ? Math.round(((Number(s.newCustomers) || 0) / uses) * 1000) / 10 : null,
        firstUsedAt: s.firstUsedAt ?? null,
        lastUsedAt: s.lastUsedAt ?? null,
      };
    }).sort((a, b) => b.uses - a.uses);

    return res.json({ stats });
  } catch (err: any) {
    return adminError(res, err, 'The coupon figures could not be read.');
  }
});

/** 4.15 — who changed what, newest first. */
app.get('/api/admin/coupons/audit', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const snap = await db.collection('couponAudit')
      .orderBy('at', 'desc')
      .limit(COUPON_AUDIT_LIMIT)
      .get();

    // Filtered here rather than in the query: a where() beside the orderBy needs
    // a composite index, and an index that has not been deployed throws.
    const code = String(req.query.code ?? '').toUpperCase().trim();
    const entries = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) } as Record<string, any>))
      .filter((e) => !code || String(e.code ?? '').toUpperCase() === code);

    return res.json({ entries, truncated: snap.size >= COUPON_AUDIT_LIMIT });
  } catch (err: any) {
    return adminError(res, err, 'The coupon history could not be read.');
  }
});

// ---------------------------------------------------------------------------
// ABANDONED BASKETS — plan task 5.7c.
//
// The owner cannot see how much money walks away, because the basket has only
// ever lived in the customer's browser. This records a SUMMARY of it so the
// question can be answered — the same reasoning as 4.24: the figure cannot be
// recovered later, so it has to be written as it happens.
//
// WHAT IS AND IS NOT STORED. Product id, name, quantity, line value, and whether
// a line is still waiting for artwork. Never the artwork itself, never a file
// name, never a storage path — see src/lib/cartSnapshot.ts, which does the
// reduction and is where the reasoning is written down.
//
// SIGNED-IN CUSTOMERS ONLY. This shop sets no cookie of its own and has no
// anonymous visitor identifier. Inventing one to follow people who have not
// identified themselves is a different decision with a different lawful basis,
// and it is not this one.
//
// ONE DOCUMENT PER CUSTOMER, keyed on the uid. A customer has one basket; a row
// per visit would be a browsing history, which is not what was asked for and is
// more data than the question needs.
// ---------------------------------------------------------------------------

/** How long a recorded basket is kept before the sweep deletes it. */
const ABANDONED_CART_TTL_DAYS = 30;
/** The most baskets one read of the report or the sweep takes (REL-01); a batch holds 500. */
const ABANDONED_CART_PAGE = 400;

app.post('/api/cart/snapshot', quoteRateLimit, async (req, res) => {
  try {
    const caller = await callerIdentity(req);
    // No account, no record. Not an error: the shop works exactly the same for a
    // guest, and the beacon simply says nothing.
    if (!caller?.uid) return res.status(204).end();
    // AND AN ANONYMOUS SIGN-IN IS NOT AN ACCOUNT. Firebase hands those out for
    // free and without limit, so "signed-in customers only" would otherwise mean
    // "anybody who asks", both for the quota and for the sentence in the privacy
    // policy that says whose basket this is.
    if (caller.anonymous === true) return res.status(204).end();

    const db = getAdminDb();
    if (!db) return res.status(204).end();

    const body = req.body ?? {};
    const value = Number(body.value);
    const lineCount = Math.floor(Number(body.lineCount) || 0);
    const converted = body.converted === true;

    // A basket that became an order is DELETED, not flagged.
    //
    // The privacy policy says, in four languages, that it is "deleted as soon as
    // you place the order". Marking it `converted: true` and leaving the row
    // there would have made the report right and the policy WRONG — and a false
    // sentence in a privacy policy is the one kind of bug that cannot be
    // apologised for afterwards. The report filters converted rows out anyway,
    // so nothing is lost by keeping the promise literally.
    if (converted) {
      await db.collection('abandonedCarts').doc(caller.uid).delete().catch(() => {});
      return res.status(204).end();
    }

    // Nothing worth recording. An empty basket is not an abandoned one, and a
    // basket worth nothing is a pricing bug to fix rather than a lost sale.
    if (!(lineCount > 0) || !(value > 0)) return res.status(204).end();

    // RE-DERIVED HERE, never trusted from the body. The browser sends what it
    // believes; this is the same rule the whole shop runs on — see priceCart.
    // A caller could otherwise post a 900 kB "basket" or a million-krona one and
    // poison a report the owner makes decisions from.
    const lines = Array.isArray(body.lines) ? body.lines.slice(0, 20) : [];
    const safeLines = lines.map((l: any) => ({
      productId: String(l?.productId ?? '').slice(0, 120) || null,
      name: String(l?.name ?? '').slice(0, 120),
      quantity: Math.max(0, Math.floor(Number(l?.quantity) || 0)),
      totalPrice: Math.max(0, Math.round((Number(l?.totalPrice) || 0) * 100) / 100),
      artworkPending: l?.artworkPending === true,
    }));

    const now = new Date().toISOString();
    const ref = db.collection('abandonedCarts').doc(caller.uid);

    // A CLIENT-SIDE THROTTLE PROTECTS NOTHING. cartBeacon.ts waits twenty
    // seconds and writes at most once in five minutes — and an attacker does not
    // run cartBeacon.ts. `quoteRateLimit` above is keyed on the IP at 120/min,
    // and each of these costs two reads and a write on a project whose free
    // Firestore quota has taken this shop dark THREE times. One signed-in
    // account, one loop, and the shop is dark in hours.
    //
    // So the throttle that matters is DURABLE and per-customer: the document
    // itself remembers when it was last written. It survives the Passenger
    // recycles that make an in-memory Map useless on this host, and it is read
    // inside the transaction that was already reading the document.

    // `firstSeenAt` IS WRITTEN ONCE, and that needs a read.
    //
    // A merge with `firstSeenAt: now` in it rewrites the field on every update,
    // so a basket that had been sitting there for a week would report itself as
    // minutes old — and "how long has this been abandoned" is most of what the
    // report is for. The transaction is what makes "set it only if it is
    // missing" true even when two tabs send at once.
    const MIN_WRITE_GAP_MS = 5 * 60 * 1000;
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      const before = existing.exists ? existing.data() ?? {} : {};

      // Too soon, and nothing has changed: say nothing. The fingerprint lets a
      // customer who really did change their basket be recorded at once, which
      // is the case the report cares about, while a loop sending the same body
      // over and over writes exactly once.
      const lastWrite = Date.parse(String(before.updatedAt ?? ''));
      const sameBasket = String(before.fingerprint ?? '') === String(body.fingerprint ?? '');
      if (Number.isFinite(lastWrite) && Date.now() - lastWrite < MIN_WRITE_GAP_MS && sameBasket) return;

      tx.set(ref, {
        uid: caller.uid,
        email: caller.email ?? null,
        lines: safeLines,
        lineCount: Math.min(lineCount, 9999),
        itemCount: Math.max(0, Math.floor(Number(body.itemCount) || 0)),
        // Capped: a report is read by a person, and a number with eleven digits
        // in it is a bug reading as a fortune.
        value: Math.min(10_000_000, Math.max(0, Math.round(value * 100) / 100)),
        anyArtworkPending: body.anyArtworkPending === true,
        fingerprint: String(body.fingerprint ?? '').slice(0, 32),
        updatedAt: now,
        // Kept if it is already there. A basket that became an order was DELETED
        // at that moment, so anything found here is genuinely the same basket
        // still sitting unbought — which is what "first seen" has to mean for
        // "how long has this been abandoned" to be worth reading.
        firstSeenAt: before.firstSeenAt ?? now,
      }, { merge: true });
    });

    return res.status(204).end();
  } catch (err) {
    // The customer is shopping. Nothing here is worth an error on their screen.
    console.error('Cart snapshot failed:', (err as any)?.message ?? err);
    return res.status(204).end();
  }
});

/**
 * 5.7c — WHAT WALKED AWAY.
 *
 * Baskets that have not been touched for `hours`, belong to a signed-in customer,
 * and never became an order. Read as ONE query on a collection that only this
 * server can see.
 */
app.get('/api/admin/carts/abandoned', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const hours = Math.min(24 * 90, Math.max(1, Number(req.query.hours) || 24));
    const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();

    // ONE where(), on purpose. A second one beside it needs a composite index,
    // and an index that has not been deployed THROWS — which on this project has
    // meant a screen that works locally and 500s on the host. `converted` is
    // applied in memory.
    //
    // THE CUTOFF IS THAT where() (REL-01). This read the whole collection, up to a
    // thousand baskets, to keep the ones older than the cutoff; the range on the
    // one field it filters needs only the single-field index every field has.
    const snap = await db.collection('abandonedCarts')
      .where('updatedAt', '<', cutoff)
      .limit(ABANDONED_CART_PAGE)
      .get();

    const rows = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, any>) } as Record<string, any>))
      // Belt and braces: a converted basket is deleted the moment the order is
      // placed, so this should never match. It stays because a row written by an
      // older build could still carry the flag.
      .filter((r) => r.converted !== true)
      .filter((r) => String(r.updatedAt ?? '') < cutoff)
      .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

    const totalValue = rows.reduce((sum, r) => sum + (Number(r.value) || 0), 0);
    // The most useful single number after the total: a basket stalls most often
    // because the customer never sent their print file.
    const waitingForArtwork = rows.filter((r) => r.anyArtworkPending === true).length;

    return res.json({
      hours,
      carts: rows.slice(0, 200).map((r) => ({
        uid: r.id,
        email: r.email ?? null,
        value: Number(r.value) || 0,
        itemCount: Number(r.itemCount) || 0,
        lineCount: Number(r.lineCount) || 0,
        anyArtworkPending: r.anyArtworkPending === true,
        firstSeenAt: r.firstSeenAt ?? null,
        updatedAt: r.updatedAt ?? null,
        lines: Array.isArray(r.lines) ? r.lines.slice(0, 20) : [],
      })),
      count: rows.length,
      totalValue: Math.round(totalValue * 100) / 100,
      waitingForArtwork,
      // NOT A SILENT CAP.
      truncated: snap.size >= ABANDONED_CART_PAGE || rows.length > 200,
      retentionDays: ABANDONED_CART_TTL_DAYS,
    });
  } catch (err: any) {
    return adminError(res, err, 'The abandoned baskets could not be read.');
  }
});

/**
 * Retention. A recorded basket is deleted after ABANDONED_CART_TTL_DAYS.
 *
 * THE POLICY PROMISES THIS IN FOUR LANGUAGES, so something has to do it. The
 * first version of this shipped the endpoint and nothing that called it — a
 * retention period nothing enforces is not a policy, it is a sentence, and a
 * false one in a legal document is worse than no sentence at all. It now runs on
 * the same quarter-hourly tick as the order stages; the endpoint stays, for a dry
 * run and for a scheduler to poke.
 */
async function sweepAbandonedCarts(dryRun: boolean): Promise<{
  ran: boolean; reason?: string; deleted: number; wouldDelete: number; scanned: number; capped: boolean;
}> {
  const db = getAdminDb();
  if (!db) return { ran: false, reason: 'no-database', deleted: 0, wouldDelete: 0, scanned: 0, capped: false };
  const cutoff = new Date(Date.now() - ABANDONED_CART_TTL_DAYS * 24 * 3600_000).toISOString();
  // ONLY WHAT IS DUE (REL-01). This read up to a thousand baskets every quarter of
  // an hour IN EVERY WORKER, and on the cron as well, to delete the few past their
  // time — reads enough on their own to run out the free daily quota — and never
  // reached a basket past the thousandth. The range picks the due ones; more
  // than a page of them are taken on the next tick.
  const snap = await db.collection('abandonedCarts')
    .where('updatedAt', '<', cutoff)
    .limit(ABANDONED_CART_PAGE)
    .get();
  const stale = snap.docs;
  if (!dryRun && stale.length) {
    for (let i = 0; i < stale.length; i += 400) {
      const batch = db.batch();
      for (const d of stale.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
  }
  return {
    ran: true,
    deleted: dryRun ? 0 : stale.length,
    wouldDelete: stale.length,
    scanned: snap.size,
    capped: snap.size >= ABANDONED_CART_PAGE,
  };
}

app.post('/api/admin/carts/sweep', async (req, res) => {
  try {
    await requireAdmin(req);
    const dryRun = req.body?.apply !== true;
    const out = await sweepAbandonedCarts(dryRun);
    return res.json({ ok: true, dryRun, retentionDays: ABANDONED_CART_TTL_DAYS, ...out });
  } catch (err: any) {
    return adminError(res, err, 'The basket sweep failed.');
  }
});

app.get('/api/health', async (req, res) => {
  // `chat` tells the browser whether the assistant can actually answer.
  //
  // The launcher used to float on every page of the live shop whatever the
  // server could do. Production has no GEMINI_API_KEY, so opening it showed a
  // panel offering pickup-hub lookups, GSM guides and pre-press checks, and
  // then answered every single question with "the chat assistant is
  // unavailable right now" — an advertisement for a feature that had been
  // switched off. A boolean is enough for the widget to keep itself off the
  // page instead. It says only yes/no; the key is never named or exposed.
  // `chatProvider` names the COMPANY that answers the chat — the privacy policy
  // says who receives what a customer types, and that has to be the one in use
  // (round 16: the owner may switch to DeepSeek). A company name, never the key.
  //
  // `?database=1` — asked by a signed-in page whose profile could not be read: is
  // the database refusing for its daily limit, and when does it come back? One read
  // of the dashboard secrets at most (cached five minutes; once a minute while the
  // database refuses, and a refused read is not billed).
  let database: { database: 'ok' | 'quota'; databaseBackAt?: string } | null = null;
  if (req.query.database) {
    await loadIntegrationSecrets().catch(() => undefined);
    database = databaseQuotaRefusedAt && Date.now() - databaseQuotaRefusedAt < 15 * 60_000
      ? { database: 'quota', databaseBackAt: nextPacificMidnight().toISOString() }
      : { database: 'ok' };
  }
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    chat: Boolean(process.env.GEMINI_API_KEY),
    chatProvider: currentAi()?.provider ?? null,
    ...(database ?? {}),
  });
});

// ---------------------------------------------------------------------------
// Authoritative price quoting.
//
// The browser used to decide what an order cost: it computed the price, stored it
// in localStorage and sent that number straight to Firestore. Anyone could edit it.
// From here on the browser sends only WHAT was ordered — product ids, quantities,
// chosen options, sizes — and the server recomputes the price from the product
// documents using the shared formula in src/lib/pricing.ts.
//
// Reads go through the Firestore REST API with the project's public web key.
// `products`, `settings` and `coupons` are world-readable by design (see
// firestore.rules), so no service-account credential is needed to PRICE an order.
// Writing the order still needs one — that lands with the payment gateway.
// ---------------------------------------------------------------------------

const firebaseConfig: {
  projectId?: string;
  firestoreDatabaseId?: string;
  apiKey?: string;
  storageBucket?: string;
} = (() => {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
})();

const FS_PROJECT = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId || '';
const FS_DATABASE = process.env.FIREBASE_DATABASE_ID || firebaseConfig.firestoreDatabaseId || '(default)';
const FS_KEY = process.env.FIREBASE_API_KEY || firebaseConfig.apiKey || '';
// LOCAL TEST MODE: the Firestore emulator speaks the same REST API on its own
// host. Set only by the local test runner (with a demo project id); the live
// host never has FIRESTORE_EMULATOR_HOST, so it always reads the real database.
const FS_BASE = process.env.FIRESTORE_EMULATOR_HOST
  ? `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${FS_PROJECT}/databases/${FS_DATABASE}/documents`
  : `https://firestore.googleapis.com/v1/projects/${FS_PROJECT}/databases/${FS_DATABASE}/documents`;
const FS_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || firebaseConfig.storageBucket || '';

/**
 * Is this a download URL from OUR bucket?
 *
 * A print file arrives as a link, not as bytes — the browser puts it in object
 * storage first — so the link is the thing that has to be checked. Without this
 * the field would accept any URL at all, and it is staff who click it: an order
 * line reading "logo.pdf" that points somewhere else entirely is a phishing
 * page with the shop's own order number on it.
 */
function isOurStorageUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !value || value.length > 2048 || !FS_BUCKET) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === 'firebasestorage.googleapis.com' &&
    url.pathname.startsWith(`/v0/b/${FS_BUCKET}/o/`)
  );
}

/**
 * The customer's file description, cleaned before it is stored on an order.
 *
 * THE ALLOWLIST WAS ON ONE OF THE TWO DOORS.
 *
 * /api/orders/:id/artwork checks every file it is given — `isOurStorageUrl`, the
 * name capped at 200 characters, the type at 40. createOrder took the SAME shape
 * from the same customers and wrote `body.items[i].fileSpecs` into the order
 * document verbatim, whatever it contained. So the checkout was the unguarded
 * way in: an arbitrary `fileUrl` pointing anywhere on the internet, a megabyte
 * of `fileName`, any extra keys the sender felt like adding — all of it landing
 * in a document that the staff dashboard, the work order and the packing slip
 * then render, and that production is expected to act on.
 *
 * Same rules as the artwork endpoint, plus two more:
 *  · a `data:` URL is allowed, because the design editor legitimately produces
 *    one for a small preview, but it is capped — a Firestore document dies at
 *    1 MiB and an oversized one would fail the whole order at the last step;
 *  · only known fields survive. Anything else the request carried is dropped
 *    rather than stored and rendered.
 *
 * Returns null when there is nothing usable, which is exactly what a line with
 * no artwork yet already stores.
 */
function sanitizeFileSpecs(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;

  const url = src.fileUrl;
  // The same ceiling the product page embeds up to (src/lib/artworkLimits.ts).
  const isData = typeof url === 'string' && url.startsWith('data:') && url.length <= MAX_EMBEDDED_DATA_URL_CHARS;
  const fileUrl = isOurStorageUrl(url) || isData ? String(url) : null;
  if (!fileUrl) return null;

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : null;
  };
  // No control characters: the name goes on the plain-text order sheet, line by line.
  const name = String(src.fileName ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || 'print-file';

  return {
    fileUrl,
    fileName: name,
    fileType:
      String(src.fileType ?? '').trim().slice(0, 40) ||
      (name.includes('.') ? name.split('.').pop()!.toUpperCase().slice(0, 10) : 'FILE'),
    widthCm: num(src.widthCm),
    heightCm: num(src.heightCm),
    // THE LENGTH THE UPLOAD PAGE READ OFF A CUSTOM UPLOAD'S FILE, when it could.
    // Kept apart from heightCm — the length the customer typed and paid for — so
    // the two can be compared at the press. Never priced; absent on every other line.
    ...(num(src.calculatedHeightCm) ? { calculatedHeightCm: num(src.calculatedHeightCm) } : {}),
    dpi: num(src.dpi),
    // Round 16: a file may now be the trim size OR the trim size with the 3 mm
    // bleed the shop asks for (src/lib/artworkFit.ts), and production has to
    // know which, or the bleed is printed as part of the product.
    bleedMm: (() => {
      const b = Number(src.bleedMm);
      // The bound the owner's editor uses (src/lib/printSpec.ts): his 25 mm roll-up
      // bleed was dropped here, and production printed the bleed as part of the job.
      return Number.isFinite(b) && b > 0 && b <= BLEED_MAX_MM ? b : null;
    })(),
    // The owner's design template a designed file started from (round 16, 5b),
    // by id only. Its NAME is put in by the order from the shop's own copy
    // (nameDesignTemplates): words the browser sent are not what production reads.
    templateId: TEMPLATE_ID_SHAPE.test(String(src.templateId ?? '')) ? String(src.templateId) : null,
    // A PDF/X with crop marks, accepted by its own box (src/lib/pdfBoxes.ts):
    // production places it by that box — and sees the page size the marks make.
    placeBy: src.placeBy === 'trimbox' || src.placeBy === 'bleedbox' ? src.placeBy : null,
    pageWidthMm: src.placeBy === 'trimbox' || src.placeBy === 'bleedbox' ? num(src.pageWidthMm) : null,
    pageHeightMm: src.placeBy === 'trimbox' || src.placeBy === 'bleedbox' ? num(src.pageHeightMm) : null,
    // Designer v2 (src/lib/designFileSpecs.ts): a small picture of every page — what
    // the basket, the order pages and production show, never the print file itself —
    // and the pages the file holds, in print order ("Page 1 Front / Page 2 Back").
    previews: cleanDesignPreviews(src.previews, isOurStorageUrl),
    ...(() => {
      const sides = cleanDesignSides(src.sides);
      return { sides, pages: sides ? sides.length : null };
    })(),
  };
}

/** A Firestore document id, as the dashboard makes them. */
const TEMPLATE_ID_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The job sheet's "Template: …" — the owner's own name for it, from the shop's
 * copy: the same in every customer's language, and nothing a tampered basket can
 * write. An id the shop does not know (deleted, hidden since, or made up) is
 * dropped; so is every one when the copy cannot be had.
 */
async function nameDesignTemplates(specs: (Record<string, unknown> | null)[]): Promise<void> {
  if (!specs.some((sp) => sp?.templateId)) return;
  let byId: Map<string, string> | null = null;
  try {
    // WITH patience() (DSN-17): this runs inside placing an order, and a database
    // that is slow to answer must not hold the checkout. Out of time, it is the
    // case below — the names are left off, the order goes through — and the read
    // goes on to leave its copy for the next one.
    byId = new Map((await patience(loadDesignTemplates())).map((t) => [t.id, t.name]));
  } catch {
    byId = null;
  }
  for (const sp of specs) {
    if (!sp?.templateId) continue;
    const name = byId?.get(String(sp.templateId));
    if (name) sp.template = name;
    else sp.templateId = null;
  }
}

/** Unwrap one Firestore REST typed value into a plain JS value. */
function fsValue(v: any): any {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue?.values ?? []).map(fsValue);
  if ('mapValue' in v) return fsFields(v.mapValue?.fields ?? {});
  return null;
}

/** Unwrap a Firestore REST `fields` object into a plain JS object. */
function fsFields(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = fsValue(v);
  return out;
}

/**
 * Fetch one product, asking for only the pricing-relevant fields. Product
 * documents currently carry base64 images inline, so an unmasked read would pull
 * megabytes per product for numbers we do not need.
 */
const PRODUCT_PRICING_FIELDS = [
  // A FIELD MISSING FROM THIS LIST DOES NOT EXIST TO THE PRICING CODE.
  // This is a REST read with a field mask, so an unlisted field comes back
  // undefined and `Number(undefined) || 0` quietly makes it zero. That failure
  // has no error and no log: the product page advertises one price and the
  // customer is charged another at Mollie. `salePrice` in particular must stay
  // here for as long as offers exist.
  'name', 'basePrice', 'salePrice', 'minQuantity', 'pricingRules', 'customUploadRules', 'printingFields',
  // Not pricing, but they must reach the order document: the SKU is printed on
  // the work order and the flag decides whether a missing file is a defect or a
  // deliberate "send it later".
  // `artworkEnabled` decides whether a missing file means "we are waiting for
  // one" or "none was ever asked for". Unlisted, it reads undefined here, every
  // product looks switched off, and — since the default is now off — every order
  // would be stamped "waiting for artwork" with no way for anyone to clear it.
  'sku', 'artworkRequired', 'artworkEnabled',
  // His translations of the name: a basket refused for an option he has since
  // hidden names the product in the shopper's language (src/lib/optionUnavailable.ts).
  // A read is billed per document, not per field.
  'nameI18n',
  // Designer v2, design later (src/lib/designLater.ts): a line bought as "Design
  // online" without its design is designed from the order page, away from the
  // product — so the order keeps the owner's print values for the product and its
  // category (his templates scoped to one). Neither is priced.
  'printSpec', 'categoryId', 'onlineDesign',
];

/**
 * One product, for pricing.
 *
 * ⚠️ "I WAS REFUSED" IS NOT "IT DOES NOT EXIST", and this returned null for both.
 *
 * The caller turns null into `404 Product not found`, so on the day the daily
 * read quota ran out every customer who tried to check out was told the product
 * did not exist — measured on the live shop, 2026-09-13. That is the worst
 * possible sentence: it is not true, it is on the path that takes money, and a
 * shopper reads it as "this shop is broken" and leaves. A 503 says "come back in
 * a moment", which is what is actually happening.
 *
 * 404 from Firestore's REST API means the document is genuinely absent. Anything
 * else — 429 for the quota, 5xx, a network failure — is the shop's problem, not
 * the customer's, and must not be dressed up as a missing product.
 */
async function fetchProduct(productId: string): Promise<Record<string, any> | null> {
  const mask = PRODUCT_PRICING_FIELDS.map((f) => `mask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${FS_BASE}/products/${encodeURIComponent(productId)}?key=${FS_KEY}&${mask}`;
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (err) {
    throw Object.assign(new Error('The shop is briefly unavailable. Please try again in a moment.'), { status: 503 });
  }
  if (resp.status === 404) return null;
  if (!resp.ok) {
    console.error(`fetchProduct(${productId}): Firestore answered ${resp.status} — reporting unavailable, not missing.`);
    throw Object.assign(new Error('The shop is briefly unavailable. Please try again in a moment.'), { status: 503 });
  }
  const doc: any = await resp.json().catch(() => null);
  if (!doc?.fields) return null;
  return fsFields(doc.fields);
}

/**
 * Roll-printing settings. Custom uploads are not catalogue products — they are
 * priced per linear metre from this single settings document.
 */
/** Site settings — the shop's own name and legal identity. */
async function fetchSiteConfig(): Promise<Record<string, any>> {
  // From the shared copy (loadSiteSettingsCopy). This was a REST read with a field
  // mask — siteName, companyLegalName, contactEmail, pickupLocation (told to a
  // Pickup customer), logoUrl (the order e-mails' logo) and seo (the Google tab) —
  // and a mask does not reduce the read units: each read cost the whole ~800 KB
  // document, ~209 units, several times an hour.
  let data: Record<string, any> | null = null;
  try {
    data = (await loadSiteSettingsCopy()).data;
  } catch {
    return {};
  }
  if (!data) return {};
  const out: Record<string, any> = {};
  for (const k of ['siteName', 'companyLegalName', 'contactEmail', 'pickupLocation', 'logoUrl', 'seo']) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  // The e-mails embed the logo, and parseLogo (src/lib/email.ts) takes only a
  // data URL. Unless the owner has uploaded one of his own as such, they carry
  // the shop's wordmark — the same logo.png the site shows (src/lib/brandLogo.ts).
  const own = data.logoType === 'image' && typeof data.logoUrl === 'string' && data.logoUrl.trim().startsWith('data:');
  if (!own) out.logoUrl = defaultLogoDataUrl() ?? out.logoUrl;
  return out;
}

/** public/logo.png as a data URL, read once. In production only dist/ is shipped, and Vite copies public/ into it. */
let defaultLogoCache: string | null | undefined;
function defaultLogoDataUrl(): string | null {
  if (defaultLogoCache !== undefined) return defaultLogoCache;
  for (const dir of ['dist', 'public']) {
    const file = path.join(process.cwd(), dir, 'logo.png');
    try {
      if (fs.existsSync(file)) return (defaultLogoCache = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`);
    } catch { /* try the next place */ }
  }
  return (defaultLogoCache = null);
}

/**
 * The shop's VAT rate, at most once every ten minutes.
 *
 * ⚠️ `fetchPrintSettings` IS NOT CACHED. It is a raw Firestore REST read, and it
 * was written for the quote path where it runs once per checkout. I put it on the
 * HTML head route — which answers EVERY page view on the site — to build the
 * structured price, and that is one billed read per visitor on a shop whose free
 * daily quota has already taken it dark three times. The same mistake the
 * siteConfig cache next door exists to prevent, made again, one file away from
 * the comment describing it.
 *
 * Ten minutes matches getSeoConfig, which the same route already calls, so the
 * head costs at most two reads per ten minutes however much traffic arrives.
 */
let vatRateCache: { at: number; rate: number } | null = null;
const VAT_RATE_TTL_MS = 10 * 60 * 1000;

async function getVatRate(): Promise<number> {
  try {
    const ps = await getPrintSettingsCached();
    const pct = Number(ps?.vatRatePercent);
    const rate = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct / 100 : PRICING_DEFAULTS.vatRate;
    vatRateCache = { at: Date.now(), rate };
    return rate;
  } catch {
    // The last good rate beats a guess; the default beats no page.
    return vatRateCache?.rate ?? PRICING_DEFAULTS.vatRate;
  }
}

/**
 * `strict` — for pricing an order. A missing document is fine (defaults); a read
 * that FAILED (quota, 5xx, network) is not, because the defaults include prices:
 * it used to answer `{}` and the shop would have charged the compiled shipping
 * fees, and reopened every country he had switched off, the moment Firestore
 * hiccuped. Same rule as fetchProduct beside it: unavailable, not "nothing".
 */
async function fetchPrintSettings(opts: { strict?: boolean } = {}): Promise<Record<string, any>> {
  const url = `${FS_BASE}/settings/printSettings?key=${FS_KEY}` +
    '&mask.fieldPaths=pricePerLinearMeter&mask.fieldPaths=minPrice&mask.fieldPaths=maxWidthCm' +
    '&mask.fieldPaths=vatRatePercent' +
    // 4.26 — "انا بحدد النقاط واقدر اعدل متى اريد". The earn and redemption
    // rates are his to set, so they are read from settings rather than compiled
    // in. Absent, LOYALTY_DEFAULTS still apply.
    '&mask.fieldPaths=pointsPerSek&mask.fieldPaths=pointsEarnedPerSek' +
    // 4.21 the minimum redemption, 4.18 expiry, 4.25 the tier thresholds — on
    // LIFETIME SPEND, because on the balance a customer was demoted the moment
    // he spent his points.
    '&mask.fieldPaths=minRedeemPoints&mask.fieldPaths=pointsExpiryMonths' +
    '&mask.fieldPaths=tierGoldSpend&mask.fieldPaths=tierPlatinumSpend' +
    // Whether the VAT regimes computed on every order are actually APPLIED. Off
    // until his accountant says otherwise — see src/lib/vatRegime.ts.
    '&mask.fieldPaths=applyVatRegimes' +
    // 4.7 — the shop-wide margin floor a discount code may not sell below, as a
    // percentage of the selling price. A coupon may set a stricter one of its
    // own. Absent means 0: never below cost.
    '&mask.fieldPaths=couponMinMarginPercent' +
    // Round 16, item 2 — his shipping prices and countries (src/lib/shipping.ts).
    // In this document because it is already read once per quote here and once
    // per visit by the browser: no new reads.
    '&mask.fieldPaths=shipping';
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (err) {
    if (opts.strict) throw Object.assign(new Error('The shop is briefly unavailable. Please try again in a moment.'), { status: 503 });
    throw err;
  }
  if (resp.status === 404) return {};
  if (!resp.ok) {
    if (opts.strict) {
      console.error(`fetchPrintSettings: Firestore answered ${resp.status} — refusing to price on defaults.`);
      throw Object.assign(new Error('The shop is briefly unavailable. Please try again in a moment.'), { status: 503 });
    }
    return {};
  }
  const doc: any = await resp.json();
  return doc?.fields ? fsFields(doc.fields) : {};
}

/**
 * The print settings at most once every ten minutes — the VAT rate for every
 * page head, and the shipping lines for the Google feed. A failed read keeps the
 * last good copy; with none, it fails (the caller decides what that means).
 */
let printSettingsCache: { at: number; doc: Record<string, any> } | null = null;
// After a failed read, the next attempt waits a minute: this answers every page
// head, and during a quota outage it would otherwise ask Firestore — and log —
// once per page view.
let printSettingsFailedAt = 0;
const PRINT_SETTINGS_RETRY_MS = 60 * 1000;
async function getPrintSettingsCached(): Promise<Record<string, any>> {
  const now = Date.now();
  if (printSettingsCache && now - printSettingsCache.at < VAT_RATE_TTL_MS) return printSettingsCache.doc;
  if (now - printSettingsFailedAt < PRINT_SETTINGS_RETRY_MS) {
    if (printSettingsCache) return printSettingsCache.doc;
    throw Object.assign(new Error('The shop settings are briefly unavailable.'), { status: 503 });
  }
  try {
    const doc = await fetchPrintSettings({ strict: true });
    printSettingsCache = { at: Date.now(), doc };
    return doc;
  } catch (err) {
    printSettingsFailedAt = Date.now();
    if (printSettingsCache) return printSettingsCache.doc;
    throw err;
  }
}

/**
 * Which country the parcel goes to, in his settings.
 *
 * Placing an order: from the address the customer typed — the separate delivery
 * address when there is one (deliveryAddressOf's rule, the same one the slip,
 * the job sheet and Zendr use), else the billing address — and NEVER from a
 * body field, or a Norwegian address could claim the Swedish price. Quoting:
 * the country the form has selected, which only decides what is SHOWN; the
 * order is priced again from the address.
 */
function deliveryCountryFor(
  settings: ShippingSettings,
  opts: { customer?: any; deliveryCode?: unknown },
): { code: string | null; name: string | null } {
  if (opts.customer) {
    // The CODE the page sends with each address first: the name it also sends
    // comes from the browser's copy of his settings, which a rename since the
    // page opened would have made stale — and a name can collide with another
    // country's code. Both come from the same page; the code is just exact.
    const dest = deliveryAddressOf({ customerDetails: opts.customer });
    const fromCode = countryByCode(settings, dest.separate ? opts.customer?.shippingAddressDetails?.countryCode : opts.customer?.countryCode);
    const c = fromCode ?? countryOf(settings, dest.country);
    return { code: c?.code ?? null, name: c?.name ?? (String(dest.country ?? '').trim() || null) };
  }
  // The country the form shows, as it is — even one he does not deliver to, so
  // the menu says "pickup only" for it instead of quietly showing Sweden's. Only
  // a quote that names no country (the cart drawer) is the home country's. A
  // code he does not have is echoed (it is a real country, just not his); a
  // name nobody knows is nothing — not its first two letters ('Atlantis' → AT).
  const requested = String(opts.deliveryCode ?? '').trim();
  if (!requested) {
    const home = enabledCountry(settings, settings.homeCountry);
    return { code: home?.code ?? null, name: home?.name ?? null };
  }
  const c = countryOf(settings, requested);
  const upper = requested.toUpperCase();
  return { code: c?.code ?? (isIsoCountry(upper) ? upper : null), name: c?.name ?? null };
}

/** A country he has, by its exact code only. */
function countryByCode(settings: ShippingSettings, code: unknown): ShippingCountry | null {
  const upper = String(code ?? '').trim().toUpperCase();
  return upper ? settings.countries.find((c) => c.code === upper) ?? null : null;
}

type CouponRules = {
  percent: number;
  minOrderAmount: number;
  /** Total redemptions allowed. 0 = unlimited. */
  maxUses: number;
  usedCount: number;
  oncePerCustomer: boolean;
  /**
   * 'all'      — every line in the basket, which is what every coupon written
   *              before 2026-09-08 means and what a missing value falls back to.
   * 'products' — only the products in `productIds`.
   */
  scope: 'all' | 'products';
  productIds: string[];
  /** The ceiling in kronor, or null. Required above 50% — see CouponsLoyaltyAdmin. */
  maxDiscountAmount: number | null;
  /** 4.10 — the day it starts working. */
  startsAt: string | null;
  /** 4.11 — 'all', 'business' or 'individual'. */
  audience: CouponAudience;
  /** 4.12 — only on a customer's first paid order. */
  firstOrderOnly: boolean;
  /** 4.13 — may not be combined with loyalty points. */
  noStacking: boolean;
  /** 4.9 — whether the percentage also comes off the delivery fee. */
  discountIncludesShipping: boolean;
  /**
   * 4.7 — the margin this code may not sell below, as a percentage of the
   * selling price. Absent falls back to the shop-wide setting.
   */
  minMarginPercent: number | null;
  /** PAY-02 — the uses unpaid orders hold (src/lib/couponRules.ts). Read with the rest, no extra read. */
  holds: CouponHolds;
};

/**
 * The instant a coupon's `expiresAt` actually runs out.
 *
 * THE COUPON THAT DIED THE MORNING OF ITS OWN EXPIRY DATE.
 *
 * The admin screen stores a date and nothing else — "2026-09-06" — and this was
 * handed straight to `new Date()`, which reads a bare date as UTC MIDNIGHT. In
 * Swedish summer time that is 02:00 on the 6th, so a code the owner set to
 * expire "6 September" stopped discounting anything at two in the morning and
 * was dead for the whole of the day it was still supposed to work. A date-only
 * expiry means the END of that day, here, in Stockholm.
 *
 * A stored full timestamp already names an instant and is left exactly as it is.
 */
const DATE_ONLY_EXPIRY = /^\d{4}-\d{2}-\d{2}$/;

function couponExpiresAtMs(expiresAt: unknown): number | null {
  const raw = String(expiresAt ?? '').trim();
  if (!raw) return null;
  if (!DATE_ONLY_EXPIRY.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // The last millisecond of that date, read as if Stockholm were UTC, then
  // pushed back by whatever Stockholm's offset actually is at that moment — +1
  // in winter, +2 in summer. Node carries no timezone arithmetic, but Intl can
  // format an instant into a zone's wall clock, and the gap between that and the
  // same instant read as UTC IS the offset. One pass is enough: the clocks
  // change at 03:00 local, never within an hour of midnight, so the offset at
  // the naive instant is the offset at the true one.
  const naiveEnd = Date.parse(`${raw}T23:59:59.999Z`);
  if (!Number.isFinite(naiveEnd)) return null;
  // 'en-CA' is named for the date-locale gate's benefit and because this parses
  // the numbers back out with Number(): a locale on Arabic-Indic digits would
  // return NaN and quietly expire every coupon in the shop.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(naiveEnd));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    // Some ICU builds report midnight as hour 24 rather than 0. It cannot happen
    // for the 23:59 this formats, but a NaN here would expire the coupon.
    part('hour') % 24,
    part('minute'),
    part('second'),
  );
  if (!Number.isFinite(wallClock)) return naiveEnd;
  const offsetMs = wallClock - Math.floor(naiveEnd / 1000) * 1000;
  return naiveEnd - offsetMs;
}

/** Look a coupon up by its `code` field. Returns null when it is missing or not usable. */
async function fetchCoupon(code: string): Promise<CouponRules | null> {
  // THROUGH THE ADMIN SDK, not the public REST endpoint.
  //
  // This used to run an unauthenticated runQuery with the browser's Firebase web
  // API key, which worked only because the coupons collection was world-readable
  // — the very thing the security rules were changed to stop, since a visitor
  // could otherwise list every unannounced discount code and take the largest.
  // The moment those rules were released, Firestore answered 403, fetchCoupon
  // returned null, and EVERY discount code in the shop was rejected with "This
  // discount code is not valid" — with nothing in the logs to say why.
  //
  // The Admin SDK is not subject to rules, which is the correct way for the
  // server to read a collection the browser must not. couponAlreadyUsedBy has
  // always done it this way.
  const db = getAdminDb();
  if (!db) {
    console.error('No Firebase Admin credentials — discount codes cannot be checked.');
    return null;
  }

  let data: Record<string, any>;
  try {
    const snap = await db
      .collection('coupons')
      .where('code', '==', code.toUpperCase())
      .limit(1)
      .get();
    if (snap.empty) return null;
    data = snap.docs[0].data() as Record<string, any>;
  } catch (err) {
    console.error('Could not read the discount code:', err);
    return null;
  }
  if (data.active === false) return null;
  const expiresAtMs = couponExpiresAtMs(data.expiresAt);
  if (expiresAtMs !== null && expiresAtMs < Date.now()) return null;

  const percent = Number(data.percent);
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
  // 4.2 AT THE TILL AS WELL: above half price, a code needs its ceiling in kronor.
  // The coupon screen has refused to save one without it since 4.2, but a code
  // stored before that (TEST100, a live 100% code, sat in this list) has a null
  // cap — which read as a 0 kr cap until the reader below was corrected (PAY-01)
  // and would now take the whole basket off. Refused instead, and said in the log.
  if (percent > 50 && couponLimit(data.maxDiscountAmount) === null) {
    console.warn(`Discount code ${String(data.code ?? code)} is ${percent}% with no maximum in kronor; refused until one is set.`);
    return null;
  }

  // Defensive on both: these come from a document the admin screen writes, and
  // an older coupon has neither field. A missing scope MUST read as 'all', or
  // every code created before scoping existed would stop discounting anything.
  const scope: 'all' | 'products' = data.scope === 'products' ? 'products' : 'all';
  const productIds = Array.isArray(data.productIds) ? data.productIds.map(String).filter(Boolean) : [];

  return {
    percent,
    minOrderAmount: Number(data.minOrderAmount) || 0,
    maxUses: Number(data.maxUses) || 0,
    usedCount: Number(data.usedCount) || 0,
    oncePerCustomer: data.oncePerCustomer === true,
    scope,
    productIds,
    // Nothing above zero is NO ceiling (couponLimit). This read `Number.isFinite`,
    // and an empty box is stored as null — Number(null) is 0 — so every code saved
    // without a cap discounted 0 kr: accepted at the till, worth nothing.
    maxDiscountAmount: couponLimit(data.maxDiscountAmount),
    // Every one of these is absent on a coupon written before round 14, and the
    // fallbacks are chosen so such a coupon behaves exactly as it always did.
    startsAt: typeof data.startsAt === 'string' && data.startsAt ? data.startsAt : null,
    audience: toAudience(data.audience),
    firstOrderOnly: data.firstOrderOnly === true,
    noStacking: data.noStacking === true,
    discountIncludesShipping: data.discountIncludesShipping === true,
    // The same reading: an empty box was a 0% floor that replaced the shop's own.
    minMarginPercent: couponLimit(data.minMarginPercent),
    holds: cleanCouponHolds(data.holds),
  };
}

/**
 * Whose hold on a limited code this is (PAY-02): every key the customer is known
 * by — the account, and each e-mail (couponHolderKeys, src/lib/couponRules.ts) —
 * the e-mails HASHED with this, because the coupon document is the owner's
 * screen, not a list of customers' addresses. The same hash the holds were
 * written with from the start, so a hold already on a coupon still matches.
 */
const couponHolderHash = (text: string): string => crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);

// Checkout quoting is a normal part of browsing a cart, so it gets its own,
// looser budget than the paid AI endpoints.
const QUOTE_RATE_MAX = 120;
const quoteBuckets = new Map<string, { count: number; resetAt: number }>();

function quoteRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = clientIp(req);
  const now = Date.now();
  const bucket = quoteBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    quoteBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    // Pruned like rateBuckets above.
    if (quoteBuckets.size > 5000) for (const [k, v] of quoteBuckets) if (now > v.resetAt) quoteBuckets.delete(k);
    return next();
  }
  if (bucket.count >= QUOTE_RATE_MAX) {
    res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  bucket.count += 1;
  return next();
}

/**
 * Who is calling, established from their Firebase ID token — never from the
 * request body.
 *
 * Returns null for a guest. Sending `userId` in the body used to be enough to
 * attach an order to somebody else's account and spend THEIR loyalty points.
 */
async function callerIdentity(req: express.Request): Promise<{ uid: string; email?: string; emailVerified?: boolean; anonymous?: boolean } | null> {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    // getAdminAuth, never a bare getAuth(): the admin app is NAMED, and the
    // no-argument form throws app/no-app — which this try/catch would swallow,
    // silently demoting every signed-in buyer to a guest. That happened.
    const auth = await getAdminAuth();
    if (!auth) return null;
    const decoded = await auth.verifyIdToken(token);

    // Suspension was enforced only by the browser hiding things. A suspended
    // customer whose tab was still open — or anyone replaying their token —
    // could go on placing orders and spending loyalty points. Treat them as a
    // guest: the order is refused a customer account rather than the request
    // being torn down mid-checkout.
    const db = getAdminDb();
    if (db) {
      const snap = await db.collection('users').doc(decoded.uid).get();
      if (snap.exists && snap.data()?.status === 'suspended') {
        console.warn(`Suspended account ${decoded.uid} attempted an authenticated request.`);
        return null;
      }
    }

    return {
      uid: decoded.uid,
      email: decoded.email,
      // Only a VERIFIED address may stand for the customer where it decides whose
      // coupon hold is whose: anyone can open an account under an address they do
      // not own.
      emailVerified: decoded.email_verified === true,
      // Firebase hands out anonymous sign-ins for free and without limit, so a
      // caller holding one is not a customer in any sense a report or a privacy
      // policy means. Reported rather than refused here: an order placed by an
      // anonymous session is still an order, and this function is the checkout's
      // identity too.
      anonymous: (decoded.firebase as any)?.sign_in_provider === 'anonymous',
    };
  } catch {
    return null;
  }
}

/**
 * The customer's real loyalty balance, read from their user document.
 *
 * The browser used to send this. A request claiming 100 000 points bought the
 * whole cart for the price of shipping, because calcOrderTotals caps redemption
 * against the CLAIMED balance.
 */
async function realPointsBalance(uid: string | null): Promise<number> {
  if (!uid) return 0; // a guest has no points
  const db = getAdminDb();
  if (!db) return 0;
  const snap = await db.collection('users').doc(uid).get();
  return Math.max(0, Number(snap.data()?.loyaltyPoints) || 0);
}

/**
 * 4.7 — WOULD THIS CODE SELL THE BASKET BELOW THE FLOOR HE SET?
 *
 * This shop has already sold a 3 020 kr banner for 1 490. A percentage code is
 * the easiest way to do it again: 40% off a product carrying a 30% margin sells
 * it below what it cost to buy, and nothing on the screen says so.
 *
 * Only the lines whose cost is actually RECORDED count — a product the owner
 * priced by hand has no cost document, and reading that as a cost of zero would
 * wave every code through as pure profit. The arithmetic, and the rule about
 * apportioning the discount across those lines, are in src/lib/couponRules.ts.
 *
 * FAILS OPEN, deliberately. A cost lookup that times out must not refuse a
 * legitimate discount code at the till; the refusal it would have made is worth
 * less than the sale it would have lost, and the attempt is logged either way.
 *
 * The message the customer sees says nothing about cost or margin. It is the
 * trade price of the goods, and the whole reason productCosts is closed.
 */
async function couponMarginRefusal(
  lines: { productId: unknown; quantity: unknown; totalPrice: unknown }[],
  eligibleSubtotal: number,
  discountAmount: number,
  minMarginPercent: number,
  code: string,
): Promise<string | null> {
  const db = getAdminDb();
  if (!db) return null;
  try {
    const ids = [...new Set(lines.map((l) => String(l?.productId ?? '').trim()).filter(Boolean))];
    if (ids.length === 0) return null;   // a basket of custom uploads has no recorded cost
    const snaps = await db.getAll(
      ...ids.map((id) => db.collection('productCosts').doc(id)),
      { fieldMask: ['sourcePrice', 'sourceCurrency', 'sourceRate', 'supplier'] },
    );
    const costById = new Map<string, any>();
    for (const snap of snaps) if (snap.exists) costById.set(snap.id, snap.data());

    const snapshot = buildCostSnapshot(lines as any[], costById);
    const verdict = checkMarginFloor(
      lines.map((l, i) => ({
        revenue: Number(l?.totalPrice) || 0,
        cost: snapshot.lines[i]?.lineCost ?? null,
      })),
      eligibleSubtotal,
      discountAmount,
      minMarginPercent,
    );
    if (!verdict.breached) return null;

    // The owner needs the number; the customer must never see it.
    console.warn(
      `Coupon ${code} refused by the margin guard: ${verdict.marginPercent}% against a floor of ${minMarginPercent}%.`,
    );
    return 'This discount code cannot be used on this basket.';
  } catch (err) {
    console.error('The coupon margin guard could not read the costs:', (err as any)?.message ?? err);
    return null;
  }
}

/**
 * The two facts about a customer that a coupon's gates need — 4.11 and 4.12.
 *
 * Read together, once, rather than one lookup per gate: this runs on every
 * keystroke-driven re-quote of the checkout, and the Firestore read quota on
 * this project is a real limit that has already taken the shop down for a day.
 *
 * `priorPaidOrders: null` means it could not be read, and every caller treats
 * that as "do not refuse" — see the note on CouponGateContext.
 */
async function customerFacts(uid: string | null): Promise<{ accountType: string | null; priorPaidOrders: number | null }> {
  if (!uid || uid.startsWith('guest-')) return { accountType: null, priorPaidOrders: null };
  const db = getAdminDb();
  if (!db) return { accountType: null, priorPaidOrders: null };
  try {
    const [profile, orders] = await Promise.all([
      db.collection('users').doc(uid).get(),
      // Deliberately ONE where(). Adding where('paymentStatus','==','paid')
      // beside it needs a composite index, and an undeployed index throws —
      // which would fail this gate open for every customer, silently. Fifty is
      // far more than the one paid order the question actually asks about.
      db.collection('orders').where('userId', '==', uid).select('paymentStatus').limit(50).get(),
    ]);
    const paid = orders.docs.filter((d) => String(d.data()?.paymentStatus ?? '') === 'paid').length;
    return {
      accountType: typeof profile.data()?.accountType === 'string' ? String(profile.data()!.accountType) : null,
      priorPaidOrders: paid,
    };
  } catch (err) {
    console.error('Could not read the customer facts a coupon needs:', (err as any)?.message ?? err);
    return { accountType: null, priorPaidOrders: null };
  }
}

/**
 * Price a cart from what was ordered. The single place the shop decides what
 * anything costs — both the live quote the customer sees and the order that
 * actually gets written go through this, so they cannot disagree.
 */
/**
 * Has this customer already redeemed this code on a paid order?
 *
 * The webhook writes one document per (code, customer) when the money arrives,
 * so a code is only spent once it has actually been paid for — an abandoned
 * checkout does not burn the customer's single use.
 */
async function couponAlreadyUsedBy(code: string, uid: string): Promise<boolean> {
  const db = getAdminDb();
  if (!db) return false;
  try {
    const snap = await db.collection('couponRedemptions').doc(`${String(code).toUpperCase()}__${uid}`).get();
    return snap.exists;
  } catch (err) {
    // Fail OPEN on an infrastructure problem: refusing every discount code
    // because a lookup timed out would be worse than the occasional second use.
    console.error('Could not check the coupon redemption history:', err);
    return false;
  }
}

/**
 * The roll a custom upload prints on, in cm, when his settings name none — the
 * upload page's own default (CustomFileUploadPage), so the two say the same width.
 */
const CUSTOM_UPLOAD_ROLL_WIDTH_CM = 28;

/**
 * The delivery methods the shop currently sells. Module scope because two places
 * need the same list — the quote below, and createOrder, which learned the hard
 * way that it could not rely on the quote having checked (see the comment there).
 */
async function priceCart(
  body: any,
  trustedPointsBalance = 0,
  callerUid: string | null = null,
  facts: { accountType: string | null; priorPaidOrders: number | null } = { accountType: null, priorPaidOrders: null },
  // Where the parcel goes (see deliveryCountryFor), and whether an unavailable
  // method may be swapped for the first available one — yes for a QUOTE (the
  // customer changed country and express is not sold there: show what is),
  // never for an order.
  shipOpts: { customer?: any; deliveryCode?: unknown; substitute?: boolean } = {},
  // The e-mail on the caller's VERIFIED token — an account's, never an anonymous
  // session's (callerIdentity read it anyway; no extra read). One more key his own
  // coupon holds are known by: a hold he placed as a guest is his when he comes
  // back signed in (code review F).
  callerEmail: string | null = null,
) {
  // `pointsBalance` in the body is deliberately ignored — see realPointsBalance.
  const { items, shippingMethod, couponCode, pointsToRedeem } = body ?? {};

  if (!Array.isArray(items) || items.length === 0) throw Object.assign(new Error('items array is required.'), { status: 400 });
  if (items.length > 50) throw Object.assign(new Error('Too many items in one order.'), { status: 400 });

  const priced: any[] = [];
  const printSettings = await fetchPrintSettings({ strict: true });
  // His shipping settings, from the read above (src/lib/shipping.ts). Read here,
  // before the VAT decision, because the BILLING country is resolved through
  // them too: by the code the page sends, else by name — a country he added
  // ('Portugal') is not in the tax module's own table of names.
  const shippingSettings = normaliseShipping(printSettings?.shipping);
  const billingCountry =
    countryByCode(shippingSettings, body?.customer?.countryCode) ?? countryOf(shippingSettings, body?.customer?.country);
  const settingsVat = Number(printSettings?.vatRatePercent);
  const standardVatRate =
    Number.isFinite(settingsVat) && settingsVat >= 0 && settingsVat <= 100
      ? settingsVat / 100
      : PRICING_DEFAULTS.vatRate;

  // WHO IS BUYING, AND THEREFORE WHICH VAT — recorded always, applied only when
  // the owner has said so.
  //
  // The shop has charged one rate to everyone since it opened. Two ordinary
  // cases are wrong under Swedish rules: an EU business with a VAT number
  // (reverse charge, 0%) and a buyer outside the EU (export, 0%). The decision
  // is src/lib/vatRegime.ts, with 48 unit tests, and it never zero-rates on a
  // guess — an address it cannot read is charged the home rate.
  //
  // APPLYING it changes what customers are charged, and whether that is right
  // for this business is a question for his accountant, not for this code. So
  // `applyVatRegimes` is off unless he turns it on: until then every order
  // RECORDS the regime it would have had — which is the whole point of "capture
  // it or lose it" — and still charges the standard rate.
  const vatDecision = decideVatRegime({
    country: billingCountry?.code ?? body?.customer?.country,
    buyerType: body?.customer?.buyerType,
    vatNumber: body?.customer?.vatNumber ?? body?.customer?.taxId,
    standardRate: standardVatRate,
  });
  const vatRegimesApplied = printSettings?.applyVatRegimes === true;
  const vatRate = vatRegimesApplied ? vatDecision.rate : standardVatRate;

  for (const item of items) {
    const productId = String(item?.productId ?? '').trim();
    const quantity = Math.max(1, Math.floor(Number(item?.quantity) || 1));
    if (quantity > 1_000_000) throw Object.assign(new Error('Quantity is out of range.'), { status: 400 });

    if (item?.kind === 'linear') {
      // A LINEAR LINE MAY NOT NAME A CATALOGUE PRODUCT.
      //
      // This branch prices by the metre out of settings/printSettings and never
      // opens the product document, so without this guard a customer could put
      // any product in the basket, add `kind: 'linear'` to the request, and be
      // charged the custom-upload floor instead of the product's own price —
      // 149 kr for a 302 kr door sign, proven against the live server — while
      // the order still recorded the real product id and the real artwork. The
      // line reads "Custom upload" on the work order, so it looks like an
      // ordinary custom job and nothing flags it.
      //
      // It also restores the invariant the coupon code below depends on:
      // `eligibilityFor` states that custom-upload lines carry a null productId
      // and therefore cannot match a product-scoped coupon. A spoofed line
      // carried a real one and did match, discounting the floored price again.
      //
      // Every honest client already complies — the design editor and the custom
      // upload page send no productId at all.
      if (productId) {
        throw Object.assign(
          new Error('A custom upload cannot name a catalogue product.'),
          { status: 400 },
        );
      }
      // A LENGTH, OR NO LINE. `Number(x) || 0` priced a missing, unreadable or zero
      // length as the minimum charge; the upload page always sends one of 1 cm or more.
      const typedHeightCm = Number(item?.heightCm);
      if (!Number.isFinite(typedHeightCm) || typedHeightCm <= 0) {
        throw Object.assign(new Error('A custom upload needs the length of the print.'), { status: 400 });
      }
      const line = calcLinearMeterPrice({
        heightCm: typedHeightCm,
        quantity,
        pricePerLinearMeter: Number(printSettings?.pricePerLinearMeter) || undefined,
        minPrice: Number(printSettings?.minPrice) || undefined,
      });
      // The customer's own file IS this product. A file is always expected.
      priced.push({
        productId: null, kind: 'linear', name: 'Custom upload', quantity, artworkExpected: true,
        // THE SIZE THE MONEY WAS FOR, carried to the order as a configured line's is:
        // the roll's width from his settings (it does not move the price) and the
        // length, clamped exactly as calcLinearMeterPrice clamps it. A custom upload
        // stored no size at all, so a 3 m file sold as 50 cm left production only the
        // browser's own words to check the job against.
        pricedWidthCm: clampDimension(printSettings?.maxWidthCm, CUSTOM_UPLOAD_ROLL_WIDTH_CM),
        pricedHeightCm: clampDimension(typedHeightCm, 0),
        ...line,
      });
      continue;
    }

    if (!productId) throw Object.assign(new Error('Every catalogue item needs a productId.'), { status: 400 });

    const product = await fetchProduct(productId);
    if (!product) throw Object.assign(new Error(`Product not found: ${productId}`), { status: 404 });

    const requestedOptionIds: string[] = Array.isArray(item?.optionIds) ? item.optionIds.map(String) : [];
    let optionsSurcharge = 0;
    // One-off option charges — a die, a proof, a designer's fee. Kept apart from
    // optionsSurcharge because the quantity must not multiply them; see
    // src/lib/chargeOnce.ts. Both come out of the same resolveSelectionFromIds
    // the browser's arithmetic is tested against.
    let onceCharges = 0;
    const matchedOptions: {
      fieldId: string; fieldLabel: string; optionId: string; optionLabel: string;
      // The option's own value: what the artwork rule and the speed reader match on.
      value?: string; priceModifier: number; chargeOnce: boolean;
    }[] = [];

    /**
     * What did the customer choose, and what does it cost?
     *
     * One implementation, shared with the browser (src/lib/optionTree.ts), so the
     * price on screen and the price charged cannot drift. It walks the option
     * tree — including options that carry options of their own — and descends
     * ONLY into the option that was actually chosen, which is what stops a
     * surcharge behind an unpicked option from reaching a price and a `required`
     * field inside an unchosen branch from rejecting the basket.
     */
    const resolution = resolveSelectionFromIds(
      (product.printingFields ?? []) as any[],
      requestedOptionIds,
    );
    optionsSurcharge = resolution.surcharge;
    onceCharges = resolution.onceCharges;
    matchedOptions.push(...resolution.matched);

    // A required field — paper, lamination, finishing — was only enforced by the
    // modal's own disabled button. Posting straight to this endpoint left it out,
    // and production received an order with no paper stock chosen and no
    // surcharge paid for it.
    // An option the owner has since hidden, still in a basket saved before:
    // refused BY NAME. Dropped quietly, the order would have gone to the cutter
    // with no shape — and, for a shape carrying its own size question, no size.
    if (resolution.hiddenChosen.length) {
      const first = resolution.hiddenChosen[0];
      // His translations go with the English words, so the page can name the
      // option and the product in the shopper's language (src/lib/optionUnavailable.ts).
      throw Object.assign(
        new Error(`"${first.optionLabel}" is no longer offered for ${String(product.name ?? 'this product')}. Please remove it from your basket and choose again.`),
        {
          status: 409,
          code: 'option_unavailable',
          detail: {
            optionLabel: first.optionLabel,
            optionLabelI18n: first.optionLabelI18n ?? null,
            productName: String(product.name ?? ''),
            productNameI18n: (product as any).nameI18n ?? null,
            productId,
            fieldId: first.fieldId,
            optionId: first.optionId,
          },
        },
      );
    }

    if (resolution.unansweredRequired.length) {
      const first = resolution.unansweredRequired[0];
      throw Object.assign(
        new Error(`Please choose a ${first.fieldName || 'printing option'} for ${String(product.name ?? 'this product')}.`),
        { status: 400 },
      );
    }

    // "Custom size" is not a stored option: it means the customer typed their own
    // width × height on a field the owner opened for it. It carries no surcharge —
    // the money comes from the area pricing on widthCm/heightCm — but the owner's
    // bounds are enforced HERE, not just in the browser, or a hand-crafted request
    // orders a 40-metre banner the machines cannot print.
    for (const field of resolution.customSizeFields as any[]) {
      const w = Number(item?.widthCm) || 0;
      const h = Number(item?.heightCm) || 0;
      const bad =
        w <= 0 || h <= 0 ||
        (Number(field?.minWidthCm) > 0 && w < Number(field.minWidthCm)) ||
        (Number(field?.maxWidthCm) > 0 && w > Number(field.maxWidthCm)) ||
        (Number(field?.minHeightCm) > 0 && h < Number(field.minHeightCm)) ||
        (Number(field?.maxHeightCm) > 0 && h > Number(field.maxHeightCm));
      if (bad) {
        throw Object.assign(
          new Error(`The custom size for ${String(product.name ?? 'this product')} is outside the allowed range.`),
          { status: 400 },
        );
      }
      matchedOptions.push({
        fieldId: String(field?.id ?? ''),
        fieldLabel: String(field?.name ?? field?.id ?? ''),
        optionId: CUSTOM_SIZE_OPTION_ID,
        optionLabel: `Custom size ${w} × ${h} cm`,
        priceModifier: 0,
        chargeOnce: false,
      });
    }

    // Did this line come with a size at all? The same test clampDimension uses
    // to decide whether it has anything to clamp, asked here so the answer can
    // be recorded on the line further down instead of silently becoming 50 × 70.
    const askedWidthCm = Number(item?.widthCm);
    const askedHeightCm = Number(item?.heightCm);
    const sizeWasGiven =
      Number.isFinite(askedWidthCm) && askedWidthCm > 0 &&
      Number.isFinite(askedHeightCm) && askedHeightCm > 0;

    const line = calcConfiguredItemPrice({
      basePrice: Number(product.basePrice) || 0,
      // The offer price the owner set on the product. `salePrice` must stay in
      // PRODUCT_PRICING_FIELDS above or this reads undefined and the customer is
      // charged the list price the page did not show them.
      salePrice: product.salePrice,
      optionsSurcharge,
      onceCharges,
      widthCm: Number(item?.widthCm) || undefined,
      heightCm: Number(item?.heightCm) || undefined,
      quantity,
      uploadRules: product.customUploadRules,
      pricingRules: product.pricingRules,
    });

    priced.push({
      productId,
      name: product.name ?? '',
      sku: typeof product.sku === 'string' ? product.sku : null,
      // Whether this shop ever asked the customer for a file on this product.
      // Decided here, where the product document is in scope, and carried out so
      // the order can be stamped from the same answer the product page gave.
      artworkExpected: artworkExpected(false, product as any, matchedOptions),
      // A FILE HE MADE REQUIRED on this product (its upload box on, "required"
      // ticked). Such a line is never left to be designed later (DSN-15): it waits
      // for its file like any other.
      fileRequired: artworkBoxShown(product as any) && (product as any).artworkRequired === true,
      // A reprint or the shop's studio provides this line's artwork — not the
      // customer (src/lib/artwork.ts). null otherwise.
      artworkSource: artworkSourceOf(matchedOptions),
      // Designer v2, design later: what the designer needs to open on this line from
      // the order page (PRODUCT_PRICING_FIELDS above). Not priced, not secret.
      printSpec: product.printSpec && typeof product.printSpec === 'object' ? product.printSpec : null,
      categoryId: typeof product.categoryId === 'string' ? product.categoryId : null,
      // …and whether the product offers the designer right now (src/lib/onlineDesign.ts).
      designerOffered: onlineDesignOffered(product as any),
      // The production speed he chose, as working days until dispatch — null
      // without one (src/lib/productionSpeed.ts). The order's promise and the
      // checkout's "≈ N working days" are both made from it.
      speedDays: (() => {
        const speed = matchedOptions.find((o: any) => o.fieldId === SPEED_FIELD_ID);
        return speed ? speedDaysOf({ optionId: speed.optionId, value: speed.value, label: speed.optionLabel }) : null;
      })(),
      quantity,
      options: matchedOptions,
      // THE SIZE THIS LINE WAS PRICED ON, carried out of the quote.
      //
      // It was computed here, charged for, and then thrown away: nothing on the
      // order said what width and height the money was for. Area pricing is
      // `areaSqm × pricePerSqm`, so the size IS the price on most of what this
      // shop sells — and the only record of it was whatever the customer's
      // fileSpecs happened to say, which is a different field, supplied by the
      // browser, and not what the server priced. Production had no way to check
      // that the job on the bench is the job that was paid for.
      //
      // The same two numbers `line` was calculated from, clamped exactly as
      // calcConfiguredItemPrice clamps them, so what is stored is what was
      // charged rather than what was asked for.
      //
      // ONLY WHEN THE CUSTOMER ACTUALLY NAMED A SIZE. clampDimension's job is to
      // hand the price calculation something usable, and what it hands it when
      // there is nothing to clamp is 50 × 70 cm — which was then written onto
      // the line as if it were a fact about the job. Every one of the six live
      // orders records 50 cm × 70 cm, for products that were never sized at all:
      // the work order and the customer's PDF proof both print it, and one of
      // them is a 180 × 70 MM door sign. A size nobody gave is not a size, so
      // the keys are simply left off; everything that renders them already
      // guards on truthiness. Both or neither — a pair where one half is the
      // fallback describes nothing.
      ...(sizeWasGiven
        ? {
            pricedWidthCm: clampDimension(askedWidthCm, PRICING_DEFAULTS.defaultWidthCm),
            pricedHeightCm: clampDimension(askedHeightCm, PRICING_DEFAULTS.defaultHeightCm),
          }
        : {}),
      /**
       * AND THE SIZE HIS ARTWORK HAS TO BE — 15.6.3.
       *
       * A DIFFERENT NUMBER from the pair above, and it is never priced. The
       * pair above exists only when the customer typed a size or the product is
       * area-priced; on a product whose sizes are preset options — "Rollup
       * 85x200 cm" — the shop charges a flat price and asks for no size at all,
       * so nothing on the order said how big the job is. The browser reads it
       * off the option he chose and sends it here.
       *
       * Clamped to a sane positive range because it reaches paperwork and an
       * upload box, and dropped entirely when it is not a real measurement: a
       * size nobody gave is not a size, exactly as above.
       */
      ...(() => {
        const w = Number(item?.printWidthCm);
        const h = Number(item?.printHeightCm);
        const sane = (n: number) => Number.isFinite(n) && n > 0 && n <= 10000;
        return sane(w) && sane(h)
          ? { printWidthCm: Math.round(w * 10) / 10, printHeightCm: Math.round(h * 10) / 10 }
          : {};
      })(),
      ...line,
    });
  }

  // An unknown shipping method used to fall through to a cost of 0 — so posting
  // shippingMethod: 'free' shipped the order at no charge while the shop's own
  // records showed a method it had never heard of. There are three; nothing else
  // is acceptable.
  //
  // AND THE FEE TABLE IS NOT THE MENU. It still carries `dsv_zone` (63.20) and
  // `dsv_weekday` (149.00) from when the shop named DSV as the carrier — the
  // checkout has offered standard/express/pickup for months, but this check
  // accepted anything the table knew, so `shippingMethod: 'dsv_zone'` bought
  // delivery for 36 kr under the standard price. The table stays as it is, so
  // an OLD order still reprices against the fee it was actually sold at; a NEW
  // one has to name something the shop currently sells.
  //
  // The method may still be ABSENT here, and that exemption is load-bearing: the
  // cart drawer quotes a basket long before the customer has reached the
  // delivery step, and demanding one would blank every basket panel in the shop.
  // An order being CREATED is a different question, and createOrder asks it.
  //
  // AND THE MENU IS HIS (round 16, item 2): which methods, at what price, to
  // which country — src/lib/shipping.ts, from the settings document read above.
  // A method he does not offer to this country is refused like an unknown one.
  const delivery = deliveryCountryFor(shippingSettings, shipOpts);
  const shippingMenu = shippingOptions(shippingSettings, delivery.code);
  let chosenShipping: string | undefined =
    typeof shippingMethod === 'string' && shippingMethod !== '' ? shippingMethod : undefined;
  if (shippingMethod !== undefined && shippingMethod !== null && shippingMethod !== '') {
    // Not one of the three at all ('__proto__', 'free', 'dsv_zone'): refused,
    // quote or order, as it always has been.
    if (typeof shippingMethod !== 'string' || !SHIPPING_METHOD_IDS.includes(shippingMethod as never)) {
      throw Object.assign(new Error('Please choose one of the delivery options offered.'), { status: 400 });
    }
    if (!shippingMenu.some((o) => o.id === shippingMethod)) {
      if (shipOpts.substitute) {
        chosenShipping = shippingMenu[0]?.id;
      } else if (shippingMethod !== 'pickup' && !enabledCountry(shippingSettings, delivery.code)) {
        throw Object.assign(
          new Error(`We do not deliver to ${delivery.name || 'that country'}. Please choose another delivery country, or pickup.`),
          { status: 400 },
        );
      } else {
        throw Object.assign(new Error('Please choose one of the delivery options offered.'), { status: 400 });
      }
    }
  }
  const chosenFee = shippingMenu.find((o) => o.id === chosenShipping)?.fee;
  const shippingFees: Record<string, number> = chosenShipping && chosenFee !== undefined ? { [chosenShipping]: chosenFee } : {};

  // 4.7 — the shop-wide floor, unless the coupon carries a stricter one.
  // Clamped: a floor above 100% is unsatisfiable and would refuse every code in
  // the shop, and a negative one is an instruction to sell below cost.
  const settingsMargin = Number(printSettings?.couponMinMarginPercent);
  const shopMinMarginPercent = Number.isFinite(settingsMargin)
    ? Math.min(100, Math.max(0, settingsMargin))
    : 0;

  let coupon: {
    code: string;
    percent: number;
    maxDiscountAmount: number | null;
    includesShipping: boolean;
  } | null = null;
  let couponError: string | null = null;
  // A CODE as well as the sentence. The sentence is a fallback for anything that
  // predates this and for logs; the browser translates the code, because a
  // Swedish customer typing a Swedish coupon into a Swedish shop should not be
  // answered in English.
  let couponErrorCode: string | null = null;
  // A number for the minimum-order gate, a date for the start-date one. Both
  // reach the browser's `{0}` slot unchanged.
  let couponErrorValue: number | string | null = null;
  let couponPerCustomerPending = false;
  // PAY-02 — a code with a usage limit: createOrder holds one use for the order.
  // False for every other code, which therefore costs nothing extra.
  let couponLimited = false;

  // WHICH LINES A CODE MAY DISCOUNT.
  //
  // Two rules, both decided here and only here, because this is the only place
  // that knows both what the coupon says and what the basket really costs:
  //
  //   1. A coupon scoped to particular products only touches those products.
  //   2. A line already sold at a special offer is never discounted again. The
  //      owner asked for this explicitly: an offer IS the discount, and stacking
  //      a code on top of it sells below the price he set.
  //
  // `isOnSale` comes off calcConfiguredItemPrice and is true only when the offer
  // actually made the line cheaper — an offer the minimum-price floor erased is
  // not an offer and does not block a code.
  //
  // Custom-upload lines have productId null (see the linear branch above), so a
  // scoped coupon can never match one. That is deliberate: those lines are not a
  // catalogue product and the owner cannot pick them in the coupon screen.
  const eligibilityFor = (rules: CouponRules) =>
    priced.map((p) => {
      if (p.isOnSale === true) return false;
      if (rules.scope !== 'products') return true;
      return p.productId != null && rules.productIds.includes(String(p.productId));
    });

  if (couponCode) {
    const found = await fetchCoupon(String(couponCode));
    // The minimum-order gate is checked against the ELIGIBLE subtotal, not the
    // basket. Against the basket, a "500 kr minimum" code would pass on 500 kr
    // of offer items and then discount nothing, which reads to the customer as
    // the code being accepted and ignored.
    const eligible = found ? eligibilityFor(found) : [];
    const eligibleSubtotal = priced.reduce((sum, p, i) => sum + (eligible[i] ? p.totalPrice : 0), 0);
    const anyEligible = eligibleSubtotal > 0;

    // 4.10 to 4.13, decided in src/lib/couponRules.ts and merely reported here.
    const gate = found ? checkCouponGates(found, {
      nowMs: Date.now(),
      signedIn: Boolean(callerUid),
      accountType: facts.accountType,
      priorPaidOrders: facts.priorPaidOrders,
      pointsToRedeem: Number(pointsToRedeem) || 0,
    }) : null;

    // 4.7 — checked on what the code WOULD take off, before it is granted. The
    // shipping share is left out on purpose: discounting delivery cannot sell
    // goods below their cost, and counting it would refuse safe codes.
    const wouldDiscount = found
      ? Math.min(
          found.maxDiscountAmount ?? Number.POSITIVE_INFINITY,
          Math.round(((eligibleSubtotal * found.percent) / 100) * 100) / 100,
        )
      : 0;
    const marginFloor = found?.minMarginPercent ?? shopMinMarginPercent;
    const marginFailure = found && anyEligible && !gate && wouldDiscount > 0
      ? await couponMarginRefusal(
          priced.filter((_, i) => eligible[i]),
          eligibleSubtotal,
          wouldDiscount,
          marginFloor,
          String(couponCode).toUpperCase(),
        )
      : null;

    if (!found) { couponError = 'This discount code is not valid.'; couponErrorCode = 'invalid'; }
    else if (!anyEligible && priced.some((p) => p.isOnSale === true)) {
      couponError = 'This code cannot be used on products that are already on special offer.';
      couponErrorCode = 'onSale';
    }
    else if (!anyEligible) { couponError = 'This discount code does not apply to anything in your basket.'; couponErrorCode = 'noMatch'; }
    else if (eligibleSubtotal < found.minOrderAmount) { couponError = `This code requires a minimum order of ${found.minOrderAmount} SEK.`; couponErrorCode = 'minOrder'; couponErrorValue = found.minOrderAmount; }
    // The uses already PAID for, and the customers whose unpaid orders HOLD one
    // (PAY-02) — from the document fetchCoupon read anyway, never counting the
    // asking customer's own: his next order is a retry, not a rival. "His own" by
    // every key he is known by — his account, the e-mail on the order, the one on
    // his account — so a hold he placed as a guest is his once signed in (review
    // F). A caller the quote cannot tell apart (a guest: the checkout's quote
    // carries no e-mail) counts only what was paid, as before — counting the holds
    // would refuse him his own code after one abandoned payment. Placing the order
    // decides: it knows the e-mail, and refuses (409) when others hold the last use.
    else if (found.maxUses > 0 && found.usedCount + (() => {
      // A signed-in customer is his account and its verified address, never an address
      // typed on the order: a shared company mailbox typed by two accounts made them one
      // holder, and each excused the other's hold (final review). A guest is his order's.
      const mine = couponHolderKeys(callerUid, callerUid ? [callerEmail] : [body?.customer?.email], couponHolderHash);
      return mine.length ? liveCouponHolders(found.holds, Date.now(), mine) : 0;
    })() >= found.maxUses) { couponError = 'This discount code has already been fully redeemed.'; couponErrorCode = 'usedUp'; }
    else if (found.oncePerCustomer && !callerUid) {
      // The shop cannot tell one guest from the next, so a code restricted to
      // one use per customer is meaningless without an account.
      couponError = 'Please sign in to use this discount code.';
      couponErrorCode = 'signIn';
    }
    else if (found.oncePerCustomer && (await couponAlreadyUsedBy(String(couponCode), callerUid!))) {
      couponError = 'You have already used this discount code.';
      couponErrorCode = 'alreadyUsed';
    }
    else if (gate) {
      // Start date, who it is for, first order only, and stacking with points.
      couponError = gate.message;
      couponErrorCode = gate.code;
      if (gate.value != null) couponErrorValue = gate.value;
    }
    else if (marginFailure) {
      couponError = marginFailure;
      couponErrorCode = 'margin';
    }
    else {
      coupon = {
        code: String(couponCode).toUpperCase(),
        percent: found.percent,
        // The ceiling, carried through to the totals. A cap the form writes and
        // the pricing ignores is worse than no cap: the screen says one thing
        // and the till does another.
        maxDiscountAmount: found.maxDiscountAmount,
        // 4.9 — so the checkout's local preview reaches the same total the
        // server does rather than flickering to a different one.
        includesShipping: found.discountIncludesShipping,
      };
      // The flag used to be computed here, returned in the quote and read by
      // nobody: a code marked "one use per customer" could be used on every
      // order the same customer ever placed.
      couponPerCustomerPending = Boolean(found.oncePerCustomer);
      // A USAGE LIMIT only (review E). A code that is just "once per customer"
      // holds nothing: with no count to protect, the hold could never refuse it,
      // and it cost two reads and a write per order. The till's check above (on
      // every quote and every order) and the redemption the payment records still
      // keep it to one use each.
      couponLimited = found.maxUses > 0;
      // Tell the browser which lines the code actually reached, so the checkout
      // can say "not on offer items" beside the ones it skipped instead of
      // leaving the customer to work out why the saving is smaller than the
      // percentage promised.
      priced.forEach((p, i) => { p.couponApplied = eligible[i] === true; });
    }
  }

  // 4.26 — the owner's rates, read once and handed to the shared formula. The
  // browser reads the same document (see App.tsx), which is what keeps the quote
  // and the preview on the same number.
  const loyaltySettings = loyaltySettingsFrom(printSettings);

  const totals = calcOrderTotals({
    lineTotals: priced.map((p) => p.totalPrice),
    couponEligible: coupon ? priced.map((p) => p.couponApplied === true) : undefined,
    discountPercent: coupon?.percent ?? 0,
    maxDiscountAmount: coupon?.maxDiscountAmount ?? null,
    discountIncludesShipping: coupon?.includesShipping === true,
    pointsToRedeem: Number(pointsToRedeem) || 0,
    pointsBalance: trustedPointsBalance,
    loyalty: loyaltySettings,
    shippingMethod: chosenShipping,
    shippingFees,
    vatRate,
  });

  return {
    currency: 'SEK',
    vatRate,
    // Frozen onto the order by createOrder. `applied` is the difference between
    // "this is what we charged" and "this is what we would have charged" —
    // without it, a historical order cannot be read at all once the switch moves.
    vat: {
      regime: vatDecision.regime,
      rate: vatDecision.rate,
      standardRate: standardVatRate,
      applied: vatRegimesApplied,
      requiresVerification: vatDecision.requiresVerification,
      invoiceNote: vatDecision.invoiceNote,
      reason: vatDecision.reason,
    },
    items: priced,
    coupon,
    couponError,
    couponErrorCode,
    couponErrorValue,
    couponPerCustomerPending,
    couponLimited,
    totals,
    // 4.22 — ON THE NET GOODS. It was the GROSS total, so the shop paid loyalty
    // points on the VAT it collects for the state and on the freight it pays a
    // carrier. `pointsQualifyingNet` is the goods after the discount and after
    // any points already spent — the cash the customer actually hands over for
    // what the shop sells.
    pointsEarned: pointsEarnedOn(totals.pointsQualifyingNet, loyaltySettings),
    // So the checkout can show the rule rather than a number with no basis.
    loyalty: {
      pointsPerSek: loyaltySettings.pointsPerSek,
      pointsEarnedPerSek: loyaltySettings.pointsEarnedPerSek,
      minRedeemPoints: loyaltySettings.minRedeemPoints,
    },
    // The delivery menu checkout DRAWS — from this read, so the cards show the
    // fee the server charges, not the browser's copy of the settings from when
    // the page was opened.
    shipping: {
      countryCode: delivery.code,
      options: shippingMenu,
      selected: chosenShipping ?? null,
      title: chosenShipping ? orderTitleOf(methodById(shippingSettings, chosenShipping)!) : null,
      // The names the order is filed under, as he spelled them in the settings,
      // and the billing country's code (the tax decision above used it).
      billingCountryName: shipOpts.customer ? (billingCountry?.name ?? null) : null,
      billingCountryCode: billingCountry?.code ?? null,
      deliveryCountryName: shipOpts.customer ? (countryByCode(shippingSettings, delivery.code)?.name ?? null) : null,
    },
  };
}

app.post('/api/checkout/quote', quoteRateLimit, async (req, res) => {
  try {
    if (!FS_PROJECT || !FS_KEY) {
      return res.status(503).json({ error: 'Pricing is unavailable: Firebase project is not configured on the server.' });
    }
    const caller = await callerIdentity(req);
    // The customer's account type and order history are only read when a code
    // was actually typed — this endpoint re-quotes on every change in the
    // checkout, and the Firestore read quota on this project has already taken
    // the shop down for a day once.
    //
    // AN ANONYMOUS SESSION PRICES AS A GUEST. Firebase hands those out free and
    // without limit, and priced as a customer one passed "sign in to use this
    // code", "once per customer" (a fresh uid has never redeemed anything) and
    // "first order only" — a new session per order, the same code every time.
    const uid = caller && !caller.anonymous ? caller.uid : null;
    const [points, facts] = await Promise.all([
      realPointsBalance(uid),
      req.body?.couponCode ? customerFacts(uid) : Promise.resolve({ accountType: null, priorPaidOrders: null }),
    ]);
    return res.json(await priceCart(
      req.body, points, uid, facts, { deliveryCode: req.body?.deliveryCountry, substitute: true },
      // His account's e-mail, from the token already verified above (review F) —
      // and only one the sign-in provider verified.
      uid && caller?.emailVerified ? caller.email ?? null : null,
    ));
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.detail ? { detail: err.detail } : {}) });
    console.error('Quote error:', err);
    return res.status(500).json({ error: 'Could not calculate the price. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// WHAT THE SHOP CAN BE PAID WITH — asked of Mollie, not hard-coded.
//
// The owner enables and disables methods in his own Mollie dashboard. Switch on
// PayPal there and it appears at this checkout on the next cache miss, with
// Mollie's own logo and Mollie's own name for it, in the shopper's language.
//
// CACHING. Every /api response carries `Cache-Control: no-store` (see the
// header middleware and the nginx-cache incident it documents), so there is no
// edge cache to lean on and this has to live in the process.
//
// The cache key includes THE API KEY ITSELF. The key can change while the
// process runs — the owner pastes a new one in the dashboard and
// applyIntegrationSecrets rewrites process.env — and a cache keyed only on
// locale would go on serving the previous account's methods until a restart.
// getMollie() guards its client the same way, for the same reason.
type MethodsCacheEntry = { at: number; methods: PublicMollieMethod[] };
const methodsCache = new Map<string, MethodsCacheEntry>();
const methodsInflight = new Map<string, Promise<PublicMollieMethod[]>>();
const METHODS_CACHE_MS = 10 * 60 * 1000;
// Shorter on failure: an outage should be retried in a minute, not in ten.
const METHODS_RETRY_MS = 60 * 1000;

/** Dropped when a new Mollie key is saved, so the next checkout asks the new account. */
function invalidateMollieMethods(): void {
  methodsCache.clear();
  methodsInflight.clear();
}

// Amounts are bucketed rather than used verbatim. Keying on the exact basket
// total would miss the cache on every quantity change; Mollie only uses the
// amount to decide which methods can handle it, and the response carries the
// real minimum and maximum so the fine filtering happens below, on our side.
function amountBucket(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.max(1, Math.ceil(amount / 500) * 500);
}

app.get('/api/payment-methods', quoteRateLimit, async (req, res) => {
  try {
    const amount = Number(req.query.amount) || 0;
    const locale = mollieLocale(typeof req.query.locale === 'string' ? req.query.locale : undefined);
    const country = typeof req.query.country === 'string' && /^[A-Za-z]{2}$/.test(req.query.country)
      ? req.query.country.toUpperCase()
      : undefined;

    // No key configured is not an error: the shop is meant to keep working and
    // simply not promise online payment. A 503 here would light up the checkout
    // with a failure for something that is only ever decoration.
    const apiKey = process.env.MOLLIE_API_KEY ?? '';
    if (!apiKey) return res.json({ methods: [], mode: 'none' });

    const bucket = amountBucket(amount);
    const key = `${apiKey}|${bucket}|${locale ?? ''}|${country ?? ''}`;
    const now = Date.now();
    const hit = methodsCache.get(key);
    let methods = hit && now - hit.at < (hit.methods.length ? METHODS_CACHE_MS : METHODS_RETRY_MS)
      ? hit.methods
      : null;

    if (!methods) {
      // Single-flight, like secretsCache: ten shoppers reaching checkout at once
      // make one call to Mollie between them, not ten.
      let flight = methodsInflight.get(key);
      if (!flight) {
        flight = listMollieMethods({ amount: bucket, currency: 'SEK', locale, billingCountry: country })
          .then((list) => {
            methodsCache.set(key, { at: Date.now(), methods: list });
            return list;
          })
          .catch((err) => {
            console.error('Could not list Mollie payment methods:', err?.message ?? err);
            // Remember the failure briefly so an outage does not mean a call to
            // Mollie on every single checkout render.
            methodsCache.set(key, { at: Date.now(), methods: [] });
            return [];
          })
          .finally(() => { methodsInflight.delete(key); });
        methodsInflight.set(key, flight);
      }
      methods = await flight;
    }

    // Mollie was asked about a bucketed amount; filter to the real basket here.
    // A method whose minimum is 200 kr must not be offered on a 149 kr order —
    // the shopper would pick it and be refused on the next page.
    const usable = amount > 0
      ? methods.filter((m) => (m.minimumAmount == null || amount >= m.minimumAmount)
        && (m.maximumAmount == null || amount <= m.maximumAmount))
      : methods;

    return res.json({ methods: usable, mode: isMollieLive() ? 'live' : 'test' });
  } catch (err: any) {
    console.error('Payment methods error:', err);
    // Still a 200: the checkout treats an empty list as "we cannot say", and
    // shows its generic card. Payment itself is unaffected either way.
    return res.json({ methods: [], mode: 'unknown' });
  }
});

// ---------------------------------------------------------------------------
// Order creation.
//
// The browser used to write the order document itself, with the price it had
// calculated. It now sends what was ordered and who is buying; the server prices
// it again and writes the result. Firestore rules reject order writes from the
// browser entirely, so this is the only way an order can be created.
// ---------------------------------------------------------------------------

/**
 * Next order number, allocated inside a transaction on a single counter document.
 * The browser used to read the whole orders collection and add one, which gives
 * two simultaneous customers the same number — and the second overwrites the first.
 */
async function nextOrderNumber(db: FirebaseFirestore.Firestore): Promise<string> {
  const year = new Date().getFullYear();
  const ref = db.collection('counters').doc(`orders-${year}`);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.value) || 0 : 0;
    const value = current + 1;
    tx.set(ref, { value, updatedAt: new Date().toISOString() }, { merge: true });
    return value;
  });
  return `${year}${String(next).padStart(5, '0')}`;
}

/**
 * Take back the points a refunded order earned — plan task 4.17.
 *
 * Points are earned when money arrives. When some of it goes back, the points
 * earned on that part were never earned: without this, a customer can buy,
 * collect the points, refund, and keep them — repeatedly, and the shop pays for
 * it in discounts on the next order.
 *
 * PROPORTIONAL, because a partial refund is the common case and deliberately
 * leaves the order at `paid`. Refund half and half the points go back.
 *
 * IT NEVER DRIVES A BALANCE NEGATIVE. The customer may already have spent them,
 * and a negative balance is not a debt this shop collects — it is a number that
 * breaks every screen that renders it. What can be taken is taken; the rest is
 * recorded in the entry so the gap is visible rather than silently absorbed.
 *
 * Keyed on the order and the amount, so a repeated webhook cannot claw twice.
 */
async function clawBackPointsForRefund(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  order: Record<string, any>,
  refundedTotal: number,
): Promise<void> {
  try {
    const uid = String(order?.userId ?? '');
    if (!uid || uid.startsWith('guest-')) return;   // a guest earned nothing
    const earned = Number(order?.pointsEarned) || 0;
    if (earned <= 0) return;
    const gross = Number(order?.grossTotal ?? order?.totalAmount) || 0;
    if (gross <= 0) return;

    const share = Math.min(1, Math.max(0, refundedTotal / gross));
    const shouldReverse = Math.round(earned * share);
    if (shouldReverse <= 0) return;

    const userRef = db.collection('users').doc(uid);
    const ledger = userRef.collection('pointsLedger');

    await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) return;

      // How much of this order's points has already been taken back, from the
      // LEDGER rather than from a flag — a partial refund followed by another
      // must reverse only the difference.
      const priorSnap = await ledger
        .where('orderId', '==', orderId)
        .where('type', '==', 'refund-reversal')
        .get();
      const alreadyReversed = priorSnap.docs.reduce((sum, d) => sum + Math.abs(Number(d.data().points) || 0), 0);
      const toReverse = shouldReverse - alreadyReversed;
      if (toReverse <= 0) return;

      const balance = Number(userSnap.data()?.loyaltyPoints) || 0;
      const taken = Math.min(balance, toReverse);
      const unrecoverable = toReverse - taken;

      const at = new Date().toISOString();
      const entry = {
        id: `${orderId}-x${alreadyReversed + toReverse}`,
        date: at,
        points: -taken,
        type: 'refund-reversal',
        orderId,
        description: `Reversed on refund of order #${orderId}`,
        // Stated, not hidden: the customer had already spent them, so the shop
        // absorbed the difference. A report that cannot see this cannot explain
        // the liability.
        ...(unrecoverable > 0 ? { unrecoverablePoints: unrecoverable } : {}),
      };

      const history = Array.isArray(userSnap.data()?.pointsHistory) ? userSnap.data()!.pointsHistory : [];
      tx.set(ledger.doc(entry.id), entry);
      tx.update(userRef, {
        loyaltyPoints: Math.max(0, balance - taken),
        pointsHistory: [...history, entry].slice(-50),
      });
    });
  } catch (err) {
    // The refund has happened. This must not undo it.
    console.error(`Points claw-back failed for order ${orderId}:`, (err as any)?.message ?? err);
  }
}

/**
 * 4.25 — WHAT THE CUSTOMER HAS SPENT, AND THEREFORE WHICH TIER.
 *
 * The tier used to be computed from the current BALANCE, so a customer reached
 * Gold on one order and was demoted the moment he redeemed his points — the
 * programme punishing him for using it. It follows spend, which only goes up.
 *
 * IDEMPOTENT via a marker on the order: Mollie's webhooks repeat, and adding the
 * same order's money twice would promote a customer on one purchase.
 */
async function addLifetimeSpendForOrder(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  order: Record<string, any>,
  paid: number,
  settings: LoyaltySettings,
): Promise<void> {
  try {
    const uid = String(order?.userId ?? '');
    if (!uid || uid.startsWith('guest-')) return;   // a guest has no account to credit
    const amount = Math.max(0, Number(paid) || 0);
    if (amount <= 0) return;

    const orderRef = db.collection('orders').doc(orderId);
    const userRef = db.collection('users').doc(uid);

    await db.runTransaction(async (tx) => {
      const [orderSnap, userSnap] = await tx.getAll(orderRef, userRef);
      // Both must EXIST: tx.update on a deleted order throws, and the throw would
      // be logged as a failure when the truth is that there is nothing to do.
      if (!orderSnap.exists || !userSnap.exists) return;
      if (orderSnap.data()?.lifetimeSpendAdded === true) return;

      const before = Number(userSnap.data()?.lifetimeSpend) || 0;
      const after = Math.max(0, before + amount);
      tx.update(userRef, {
        lifetimeSpend: after,
        loyaltyTier: tierForSpend(after, settings),
      });
      tx.update(orderRef, { lifetimeSpendAdded: true });
    });
  } catch (err) {
    // The money has arrived and the order is paid. A tier that is one order
    // behind is not worth failing a webhook over.
    console.error(`Lifetime-spend update failed for order ${orderId}:`, (err as any)?.message ?? err);
  }
}

/**
 * 4.25 — REFUNDED MONEY IS NOT SPEND.
 *
 * The tier follows lifetime spend, so without this a customer could reach
 * Platinum by ordering and returning. Kept apart from the points claw-back on
 * purpose: an order that earned no points still has its refund taken off the
 * spend, and the claw-back returns early on such an order.
 *
 * IDEMPOTENT, because `refundedTotal` is the CUMULATIVE amount refunded and the
 * webhook can deliver the same figure twice. The order records how much has
 * already been removed and only the difference is applied.
 *
 * The tier itself is left where it is. A demotion on a refund is an argument
 * with a customer over a badge, and the next paid order recomputes it from the
 * corrected spend anyway.
 */
async function reduceLifetimeSpendForRefund(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  order: Record<string, any>,
  refundedTotal: number,
): Promise<void> {
  try {
    const uid = String(order?.userId ?? '');
    if (!uid || uid.startsWith('guest-')) return;
    const refunded = Math.max(0, Number(refundedTotal) || 0);
    if (refunded <= 0) return;

    const orderRef = db.collection('orders').doc(orderId);
    const userRef = db.collection('users').doc(uid);

    await db.runTransaction(async (tx) => {
      const [orderSnap, userSnap] = await tx.getAll(orderRef, userRef);
      if (!orderSnap.exists || !userSnap.exists) return;
      const already = Math.max(0, Number(orderSnap.data()?.lifetimeSpendRemoved) || 0);
      const removeNow = refunded - already;
      if (removeNow <= 0) return;

      const before = Number(userSnap.data()?.lifetimeSpend) || 0;
      tx.update(userRef, { lifetimeSpend: Math.max(0, before - removeNow) });
      tx.update(orderRef, { lifetimeSpendRemoved: refunded });
    });
  } catch (err) {
    // The refund has happened. This must not undo it.
    console.error(`Lifetime-spend adjustment failed for order ${orderId}:`, (err as any)?.message ?? err);
  }
}

/**
 * The next credit-note number — its OWN series.
 *
 * It must never reuse or continue the order series. Two documents sharing a
 * number is the thing an accountant cannot work around, and `K` in front means
 * the two can never collide even by accident.
 *
 * The same transaction shape as nextOrderNumber: a counter read and written in
 * one transaction, so two refunds landing together cannot take the same number.
 */
async function nextCreditNoteNumber(db: FirebaseFirestore.Firestore): Promise<string> {
  const year = new Date().getFullYear();
  const ref = db.collection('counters').doc(`credit-notes-${year}`);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data()?.value) || 0 : 0;
    const value = current + 1;
    tx.set(ref, { value, updatedAt: new Date().toISOString() }, { merge: true });
    return value;
  });
  return formatCreditNoteNumber(year, next);
}

/**
 * Issue a kreditnota for a refund that has just been recorded.
 *
 * HOW IT KNOWS WHAT IS ALREADY CREDITED: by reading the credit notes THEMSELVES,
 * not the order. Mollie reports refunds cumulatively and its webhooks repeat, so
 * the amount to credit is the increment — but taking the baseline from the
 * order's own `refundedAmount` has a hole in it. The webhook writes that field
 * first; if the process dies between that write and this one, the retry sees a
 * refundedAmount that already matches and issues nothing, and the document is
 * lost for good with no sign that it ever should have existed.
 *
 * Summing the notes already issued closes it: a retry credits exactly what is
 * missing, and a repeat credits nothing. It also means a refund recorded by hand
 * — outside Mollie entirely — is picked up by the same code.
 *
 * A partial refund deliberately leaves the order at `paid`, so a partial credit
 * note is the normal case and not an edge one.
 *
 * IT MUST NOT BREAK THE REFUND. The money has already moved. If this throws, the
 * webhook would answer non-2xx, Mollie would retry, and the retry would take the
 * same path — so a failure here is logged and reported, never thrown.
 */
async function issueCreditNoteForRefund(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  order: Record<string, any>,
  nowRefunded: number,
  reason: string,
): Promise<string | null> {
  try {
    const gross = Number(order?.grossTotal ?? order?.totalAmount) || 0;
    const existing = await db.collection('creditNotes').where('orderId', '==', orderId).select('gross').get();
    const previouslyRefunded = existing.docs.reduce((sum, d) => sum + (Number(d.data().gross) || 0), 0);
    const amount = creditNoteAmountDue(previouslyRefunded, nowRefunded, gross);
    if (amount === null) return null;

    const figures = creditNoteFigures(order, amount, PRICING_DEFAULTS.vatRate);
    const number = await nextCreditNoteNumber(db);
    const nowIso = new Date().toISOString();

    await db.collection('creditNotes').doc(number).set({
      creditNoteNumber: number,
      // The invoice this credits. A credit note that does not name one is not a
      // credit note.
      orderId,
      orderNumber: order?.orderNumber ?? orderId,
      issuedAt: nowIso,
      reason,
      // POSITIVE magnitudes, printed negative. Storing them negative means every
      // future sum has to remember the sign, and one that forgets adds a refund
      // to revenue.
      gross: figures.gross,
      net: figures.net,
      vat: figures.vat,
      vatShare: figures.vatShare,
      currency: order?.currency ?? 'SEK',
      // Carried from the order so the document can be rendered years later
      // without reading anything else, and so it still says what it said.
      vatRate: Number(order?.vatRate) || 0,
      vatRegime: order?.vatRegime ?? null,
      vatInvoiceNote: order?.vatInvoiceNote ?? null,
      customerName: order?.customerName ?? null,
      customerEmail: order?.customerEmail ?? null,
      customerDetails: order?.customerDetails ?? null,
      buyerVatNumber: order?.buyerVatNumber ?? null,
      // Which account may see it. Same field the order uses, so the rule for
      // reading one is the rule for reading the other.
      userId: order?.userId ?? null,
      customerAccountId: order?.customerAccountId ?? null,
      // The running total at the moment it was issued, so a sequence of partial
      // refunds can be reconstructed from the notes alone.
      refundedBefore: Math.max(0, Number(previouslyRefunded) || 0),
      refundedAfter: Math.max(0, Number(nowRefunded) || 0),
    });

    await db.collection('orders').doc(orderId).set({
      creditNoteNumbers: FieldValue.arrayUnion(number),
      updatedAt: nowIso,
    }, { merge: true });

    console.log(`Credit note ${number} issued for order ${orderId}: ${figures.gross} ${order?.currency ?? 'SEK'}`);

    // The customer is told, and given the number. A refund they only discover
    // from a bank statement is a support call, and their bookkeeping needs the
    // document. Its own try/catch: the note is WRITTEN — losing the e-mail must
    // not lose that, and the dashboard still has it.
    try {
      const site = await fetchSiteConfig();
      await sendCreditNoteEmail(
        {
          creditNoteNumber: number,
          orderNumber: order?.orderNumber ?? orderId,
          orderId,
          gross: figures.gross,
          net: figures.net,
          vat: figures.vat,
          currency: order?.currency ?? 'SEK',
          reason,
          customerEmail: order?.customerEmail ?? null,
          customerName: order?.customerName ?? null,
        },
        String(site?.siteName ?? 'ReklamX'),
        // PUBLIC_URL only. publicBaseUrl() derives a host from request headers
        // when it is unset, and its own comment explains why that is a trap: the
        // headers are supplied by whoever made the request. A credit-note e-mail
        // is exactly the wrong place to send a customer to a host a stranger
        // chose, so with no configured URL the mail simply carries no link.
        `${String(process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '')}/dashboard`,
        site?.logoUrl,
      );
    } catch (mailErr) {
      console.error(`Credit note ${number} was issued but the e-mail failed:`, (mailErr as any)?.message ?? mailErr);
    }

    return number;
  } catch (err) {
    // The money has already moved. Logged loudly; never thrown.
    console.error(`Credit note failed for order ${orderId}:`, (err as any)?.message ?? err);
    return null;
  }
}

/*
 * Working days are added in src/lib/productionSpeed.ts (promisedDay) — the product
 * page and the checkout count with the same function, on the SHOP'S calendar
 * (Stockholm), not this host's: at 01:00 CEST a UTC host is still on yesterday,
 * and promised the customer a date one day earlier than the page had shown him.
 */

/**
 * The date this order is promised for: the owner's production days plus the
 * transit days of the method the customer chose.
 *
 * The numbers live in settings/siteConfig.deliveryPromise, where the owner sets
 * them once. Before this, the only delivery date in the shop was a "+3 days"
 * hardcoded inside the production work order component, which no one could
 * change and which the customer never saw.
 */
async function readDeliveryPromise(db: FirebaseFirestore.Firestore, { orThrow = false }: { orThrow?: boolean } = {}) {
  let promise: any = null;
  try {
    // The shared copy (loadSiteSettingsCopy): the whole settings document is
    // ~200 read units, and this runs on every order.
    void db;
    promise = (await loadSiteSettingsCopy()).data?.deliveryPromise ?? null;
  } catch (err) {
    // A RE-count must not run on the factory defaults: a shop whose transit is
    // four days would be re-promised on two, and the date stamped as its own.
    if (orThrow) throw err;
    console.warn('Could not read the delivery promise settings; using defaults:', err);
  }
  return promiseNumbers(promise);
}

/**
 * The promised date from the numbers: production days (the settings', or the
 * order's production speed — src/lib/productionSpeed.ts) plus the transit days of
 * the chosen method, counted in working days from `from`. Express reuses the
 * owner's "weekday" transit setting and standard his "zone" one.
 */
function dueDateFrom(
  p: ReturnType<typeof promiseNumbers>,
  shippingMethod: unknown,
  productionDays: number | null,
  from: Date = new Date(),
): string {
  const production = productionDays ?? p.productionDays;
  return promisedDay(from, production + transitDaysFor(shippingMethod, p), p.skipWeekends);
}

/**
 * A SPEED ORDER'S PROMISE, COUNTED AGAIN from `from` — the money, or the last
 * file ("counted from the moment your artwork is approved", the speed's own
 * words). Only while the date is still the one this shop computed (staff may have
 * set one by hand), only ever LATER (a promise made is not taken back by a
 * settings change), and never on default numbers when the settings cannot be
 * read. The new date, or null to leave it. Never throws: the payment path calls it
 * before the one update that records the money.
 */
async function recountedDueDate(db: FirebaseFirestore.Firestore, order: any, from: Date): Promise<string | null> {
  const speedDays =
    typeof order?.productionDays === 'number' && Number.isFinite(order.productionDays) && order.productionDays >= 1
      ? order.productionDays
      : null;
  if (speedDays === null || !order.dueDateAuto || order.dueDate !== order.dueDateAuto || Number.isNaN(from.getTime())) {
    return null;
  }
  try {
    const recount = dueDateFrom(await readDeliveryPromise(db, { orThrow: true }), order.shippingMethod, speedDays, from);
    return /^\d{4}-\d{2}-\d{2}$/.test(recount) && recount > String(order.dueDate) ? recount : null;
  } catch (err) {
    console.warn('The promised date could not be re-counted; it stays as it was:', err);
    return null;
  }
}


/**
 * The signed-in account an order belongs to, matched by email.
 *
 * `userId` stays exactly what the verified token said — it drives loyalty points
 * and the once-per-customer coupon rule, and neither may be steered by typing
 * somebody's address into a form. This is a SEPARATE field, read by one thing
 * only: the customer's "My orders" list.
 *
 * Why it is needed: order 202600002 was placed by a registered customer whose
 * browser sent no ID token, so it was stored as `guest-202600002` and never
 * appeared in their dashboard — the shop had taken their money and could show
 * them nothing.
 */
async function resolveCustomerAccountId(email: string): Promise<string | null> {
  try {
    const auth = await getAdminAuth();
    if (!auth) return null;
    const account = await auth.getUserByEmail(email);

    // A VERIFIED address, or no match. This is the whole security of the
    // feature, so it is worth being explicit about the attack it closes.
    //
    // The first cut of this looked the address up in the `users` COLLECTION.
    // That collection is written by the customers themselves — the create rule
    // deliberately does not compare the document's email against the token,
    // because not every sign-in provider puts one there — so anyone could write
    // `{ email: 'victim@example.com' }` into their own profile, wait for the
    // victim to check out as a guest, and have the order stamped with THEIR
    // account id. The read rule would then hand them the victim's name, postal
    // address, phone number, line items, totals and the publicToken that opens
    // the guest order page.
    //
    // Firebase Auth's own record cannot be written that way, and an address
    // already registered to somebody else cannot be claimed. Signing up with a
    // stranger's address without proving it still leaves emailVerified false,
    // which is why that check is the condition and not a nicety. An unverified
    // account simply does not get the link: the order stays exactly as visible
    // as it was before this feature existed.
    if (!account?.emailVerified) return null;
    return account.uid;
  } catch (err: any) {
    // auth/user-not-found is the ordinary case — a genuine guest.
    if (err?.code && err.code !== 'auth/user-not-found') {
      console.warn('Could not match the order to a customer account:', err);
    }
    return null;
  }
}

/**
 * The owner's automatic-stage settings, cached for ten minutes.
 *
 * The sweep below runs every quarter of an hour and would otherwise read this
 * document every time. Firestore is on the free plan and its daily read quota
 * has already blacked this shop out once — a background job must not be the
 * thing that spends it.
 */
let autoStageCache: { at: number; settings: AutoStageSettings } | null = null;
const AUTO_STAGE_CACHE_MS = 10 * 60 * 1000;

async function fetchAutoStageSettings(db: FirebaseFirestore.Firestore): Promise<AutoStageSettings> {
  if (autoStageCache && Date.now() - autoStageCache.at < AUTO_STAGE_CACHE_MS) {
    return autoStageCache.settings;
  }
  let raw: any = null;
  try {
    // The shared copy (loadSiteSettingsCopy). This read of the WHOLE settings
    // document, every 15 minutes for the sweep, was ~20 000 read units a day.
    void db;
    raw = (await loadSiteSettingsCopy()).data?.autoStages ?? null;
  } catch (err) {
    console.warn('Could not read the automatic-stage settings; using defaults:', err);
  }
  const settings = raw ? sanitizeAutoStageSettings(raw) : AUTO_STAGE_DEFAULTS;
  autoStageCache = { at: Date.now(), settings };
  return settings;
}

/**
 * Create the order. Prices the cart here; nothing about money in the request is
 * read. Returns the stored document plus a token the buyer can use to check on
 * their own order afterwards without signing in.
 */
async function createOrder(
  body: any,
  caller: { uid: string; email?: string; emailVerified?: boolean; anonymous?: boolean } | null,
  /**
   * Written WITH the order, in the one create: pay on delivery's flag, so an order
   * can never exist half-placed — titled "pay on delivery" but not marked as one.
   */
  bornWith?: Record<string, unknown>,
) {
  const db = getAdminDb();
  if (!db) throw Object.assign(new Error('Orders cannot be placed right now. Please contact us and we will take your order directly.'), { status: 503 });

  const { customer, comments, paymentMethod, shippingMethod } = body ?? {};

  // The shop may not take an order the buyer did not agree to. Checked here as
  // well as in the form, because the form is not the only way to reach this.
  if (body?.termsAccepted !== true) {
    throw Object.assign(new Error('The terms and privacy policy must be accepted before ordering.'), { status: 400 });
  }
  if (!customer?.email || !customer?.firstName) throw Object.assign(new Error('A name and email address are required.'), { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(customer.email).trim())) {
    throw Object.assign(new Error('The email address is not valid. Please check it and try again.'), { status: 400 });
  }

  // AN ORDER HAS TO NAME A DELIVERY METHOD.
  //
  // priceCart validates the method only when one is present, deliberately — the
  // cart drawer has to be able to quote a basket before the customer has chosen
  // — and nothing here re-asked. So a POST to /api/checkout/pay with the key
  // simply LEFT OUT sailed past both: shippingCost 0, shippingMethod null, and
  // an order the shop still treats as a delivery in every other respect. The
  // invoice still prints a delivery line — shippingMethodTitle is null, so
  // InvoiceModal falls back to docShippingMethodFallback and the customer is
  // promised a delivery nobody was paid for. The work order tells staff to
  // dispatch it, and the stage sweep marches it all the way to "shipped". Free
  // carriage for anyone who can leave a field out. Quoting may be method-less;
  // ordering may not.
  if (typeof shippingMethod !== 'string' || !SHIPPING_METHOD_IDS.includes(shippingMethod as never)) {
    throw Object.assign(new Error('Please choose one of the delivery options offered.'), { status: 400 });
  }

  // A SEPARATE DELIVERY ADDRESS, IF TICKED, IS A WHOLE ADDRESS. It decides the
  // shipping price now, and the slip, the job sheet and the Zendr draft all read
  // it — a ticked box with an empty street used to be priced as one country by
  // the browser and another by the server. A real boolean first: the address
  // rules elsewhere test it for truth, so `1` would have been "ticked" there and
  // "not ticked" here, and skipped this check.
  customer.differentShippingAddress = customer.differentShippingAddress === true;
  if (customer.differentShippingAddress) {
    const ship = customer?.shippingAddressDetails ?? {};
    if (![ship.address1, ship.postcode, ship.city].every((v: unknown) => String(v ?? '').trim())) {
      throw Object.assign(new Error('Please fill in the delivery address — street, postcode and city.'), { status: 400 });
    }
  }

  // Priced as a guest when the session is anonymous — the quote's rule, for the
  // same reason (an anonymous uid is not a customer a coupon's gates can mean).
  // `userId` below still records it: that is what lets the same session send
  // the file after payment.
  const orderUid = caller && !caller.anonymous ? caller.uid : null;
  const [orderPoints, orderFacts] = await Promise.all([
    realPointsBalance(orderUid),
    body?.couponCode ? customerFacts(orderUid) : Promise.resolve({ accountType: null, priorPaidOrders: null }),
  ]);
  const accountEmail = orderUid && caller?.emailVerified ? caller.email ?? null : null;
  const quote = await priceCart(body, orderPoints, orderUid, orderFacts, { customer }, accountEmail);

  // A CODE THE TILL TOOK BACK BECAUSE OF WHO IS BUYING IT — its last use held by
  // another customer's unpaid order, or a once-per-customer code he has already
  // paid with — is said as that, before the total is compared (review A). A
  // guest's quote carries no e-mail, so it cannot see whose hold it is and accepts
  // the code; this pricing knows the e-mail, drops it, and the total then differs
  // from the one shown. Refused as "the price changed", the page re-quoted the
  // same code, showed the same total and was refused again — for as long as the
  // hold lasted (up to 14 days). The checkout reads 409 usedUp/alreadyUsed: it
  // says why, takes the code off, and the next Pay goes without it.
  if (
    body?.couponCode &&
    !quote.coupon &&
    (quote.couponErrorCode === 'usedUp' || quote.couponErrorCode === 'alreadyUsed')
  ) {
    throw Object.assign(
      new Error(quote.couponError ?? 'This discount code cannot be used.'),
      { status: 409, code: quote.couponErrorCode },
    );
  }
  if (quote.totals.grossTotal <= 0) throw Object.assign(new Error('This order has no value.'), { status: 400 });

  // NO DISCOUNT ON AN ORDER PAID ON DELIVERY — checked on what was PRICED, not on
  // what was sent. placeOnDelivery refuses a couponCode that is a non-empty
  // string; `["PODTEST10"]` is not one, and priceCart String()s it into a working
  // code. Points the same way. The same answer as the early check, which stays.
  if (bornWith?.payOnDelivery === true && (quote.coupon || quote.totals.pointsRedeemed > 0)) {
    throw Object.assign(
      new Error('Loyalty points and discount codes are used when paying online.'),
      { status: 400, code: 'on_delivery_no_discounts' },
    );
  }

  // THE TOTAL THE CUSTOMER WAS SHOWN. When the owner changes a price — shipping
  // or a product — while a checkout is open, the order would be charged a total
  // the customer never saw. The page sends what it showed; a different total is
  // refused, and the page fetches and shows the new one. Absent (an older page),
  // not checked.
  const expectedGross = Number(body?.expectedGrossTotal);
  if (body?.expectedGrossTotal != null && Number.isFinite(expectedGross) && Math.abs(expectedGross - quote.totals.grossTotal) > 0.005) {
    throw Object.assign(new Error('The price has changed since it was shown. Please check the new total and pay again.'), { status: 409, code: 'price_changed' });
  }

  // Filed under the names he uses in the settings ('Sverige'), whatever the
  // browser sent — the documents, the e-mails and the reports read these.
  const storedCustomer = {
    ...customer,
    country: quote.shipping.billingCountryName ?? customer?.country,
    ...(customer?.differentShippingAddress === true && customer?.shippingAddressDetails
      ? {
          shippingAddressDetails: {
            ...customer.shippingAddressDetails,
            country: quote.shipping.deliveryCountryName ?? customer.shippingAddressDetails.country,
          },
        }
      : {}),
  };

  // Artwork is still carried as base64 inside the order document, and Firestore
  // rejects any document over 1 MiB. Left unchecked the write simply fails and the
  // customer sees a generic error after paying attention to a long form. Check it
  // here and say something useful instead.
  //
  // The real fix is object storage — src/lib/uploadFile.ts and storage.rules are
  // ready and wired to nothing, because Firebase Storage is not enabled on the
  // project yet.
  // Same budget the upload page enforces, from the same module, so the two can
  // never drift apart again — they had, by a factor of four and a half.
  const artworkBytes = artworkBase64Length(body?.items ?? []);
  if (artworkBytes > MAX_ARTWORK_BASE64) {
    throw Object.assign(
      new Error(
        `Your artwork is too large to submit with the order. The most one order can carry is ${MAX_FILE_MB} MB. Please compress it, or contact us and we will take the file directly.`,
      ),
      { status: 413 },
    );
  }

  const orderId = await nextOrderNumber(db);
  const now = new Date().toISOString();
  const customerEmail = String(customer.email).toLowerCase().trim();
  // THE PRODUCTION SPEED HE PAID FOR (src/lib/productionSpeed.ts): the slowest
  // line sets the order's production days. With no speed on any line, exactly
  // the promise every order had before.
  const promiseNumbersNow = await readDeliveryPromise(db);
  const production = orderProductionDays(
    (quote.items ?? []).map((line: any) => (typeof line?.speedDays === 'number' ? line.speedDays : null)),
    promiseNumbersNow.productionDays,
  );
  const dueDate = dueDateFrom(promiseNumbersNow, shippingMethod, production.fromSpeed ? production.days : null);
  // Only worth asking when the token was missing — a signed-in buyer already
  // has the real thing.
  //
  // AN ANONYMOUS TOKEN IS NOT AN ACCOUNT. The product page signs a guest in
  // anonymously to upload a file to Storage, and the checkout then sends THAT
  // token. Taking its uid filed a registered customer's order (signed out,
  // file attached) under a throwaway identity: missing from "My orders", and
  // nobody's loyalty points. The online designer makes that the normal path, so
  // an anonymous caller is matched by verified email like any guest. `userId`
  // below still records the anonymous uid, which is what lets that same
  // session send the file after payment.
  const customerAccountId =
    (caller && caller.anonymous !== true ? caller.uid : null) ?? (await resolveCustomerAccountId(customerEmail));
  // Lets a guest check their own order after returning from the payment page,
  // without making order ids guessable-and-readable by anyone.
  const publicToken = crypto.randomUUID();

  // Cleaned once, per line: what gets stored and what `artworkPending` is
  // decided from have to be the same thing, or an order whose file was rejected
  // is filed as having one.
  const cleanSpecs: (Record<string, unknown> | null)[] = (body?.items ?? []).map((it: any) =>
    sanitizeFileSpecs(it?.fileSpecs),
  );
  await nameDesignTemplates(cleanSpecs);
  // THE PAGES A DESIGN SAYS IT HAS are the browser's word; the options the server
  // PRICED say how many the job has (src/lib/printSides.ts). Where they disagree — a
  // crafted basket, or a design kept from before its options changed — the file
  // stays, but not a page list production would trust: "Page 2 Back" on a job that
  // was sold single-sided (DSN-11).
  cleanSpecs.forEach((spec, i) => {
    const sent = spec?.sides;
    if (!spec || !Array.isArray(sent)) return;
    const priced = printSides(
      ((quote.items[i]?.options ?? []) as any[]).map((o) => ({ fieldId: o.fieldId, optionId: o.optionId, value: o.value })),
    ).sides;
    if (sent.join() === priced.join()) return;
    console.warn(`Order ${orderId}, line ${i + 1}: the design's pages (${sent.join(', ')}) are not the ${priced.join(', ')} that were priced; not recorded.`);
    spec.sides = null;
    spec.pages = null;
  });

  // The products' own photos, frozen on the lines below — the catalogue copy read once.
  const lineImages = productImageMap();
  const order = {
    id: orderId,
    publicToken,
    // From the verified token only. A body-supplied userId is ignored.
    userId: caller?.uid ?? `guest-${orderId}`,
    // Which signed-in account may SEE this order. Same as userId for a customer
    // who was signed in; matched by email for a guest checkout that turns out to
    // belong to a registered customer. Never used for money — see
    // resolveCustomerAccountId.
    customerAccountId,
    customerName: [customer.firstName, customer.lastName].filter(Boolean).join(' '),
    customerEmail,
    customerDetails: storedCustomer,
    status: 'pending',
    paymentStatus: 'unpaid',
    paymentMethod: typeof paymentMethod === 'string' ? paymentMethod : null,
    shippingMethod: typeof shippingMethod === 'string' ? shippingMethod : null,
    // Four screens print these — invoice, receipt, work order and the customer's
    // dashboard — and nothing wrote them, so all four showed an empty space.
    shippingMethodTitle: quote.shipping.title ?? SHIPPING_TITLES[String(shippingMethod)] ?? null,
    // Where the parcel goes, as a code — what Zendr is given, rather than a
    // country name it may not know.
    deliveryCountryCode: shippingMethod === 'pickup' ? null : quote.shipping.countryCode,
    paymentMethodTitle: PAYMENT_TITLES[String(paymentMethod)] ?? null,
    shippingCost: quote.totals.shippingCost,
    currency: quote.currency,
    vatRate: quote.vatRate,
    // WHO THIS WAS SOLD TO, FOR TAX, frozen at the moment of sale.
    //
    // "مطلوب محاسبياً في السويد". None of this existed: one global rate, no
    // buyer VAT number, no B2B flag and a country stored as whatever the
    // customer typed. An order that does not record these cannot be reported on
    // later, and the rules can change under it — which is why the DECISION is
    // frozen here rather than recomputed from the customer record at report time.
    //
    // `applied` says whether the shop actually charged this way. Until the owner
    // switches applyVatRegimes on, every order records the regime and charges the
    // standard rate, so the two must be readable apart.
    buyerType: String(customer?.buyerType ?? '').toLowerCase() === 'company' ? 'company' : 'private',
    // By his settings' code where the country is his (so a country he added,
    // which the tax module's own name table does not know, is still recorded),
    // else as before. Zendr reads it for the customer's phone prefix too.
    buyerCountryCode: quote.shipping.billingCountryCode ?? toCountryCode(storedCustomer.country),
    buyerVatNumber: normaliseVatNumber(customer?.vatNumber ?? customer?.taxId) || null,
    vatRegime: quote.vat.regime,
    vatRegimeApplied: quote.vat.applied === true,
    vatStandardRate: quote.vat.standardRate,
    vatRegimeRate: quote.vat.rate,
    // A reverse charge rests on a VAT number nobody has checked against VIES.
    // Under Swedish practice an unverified number that turns out to be invalid
    // leaves the VAT with the SELLER, so the flag travels with the order and is
    // a job for a human rather than a technicality.
    vatRequiresVerification: quote.vat.requiresVerification === true,
    vatInvoiceNote: quote.vat.invoiceNote,
    vatRegimeReason: quote.vat.reason,
    goodsNet: Math.max(0, quote.totals.netTotal - quote.totals.shippingCost),
    netTotal: quote.totals.netTotal,
    vatAmount: quote.totals.vatAmount,
    grossTotal: quote.totals.grossTotal,
    totalAmount: quote.totals.grossTotal,
    taxAmount: quote.totals.vatAmount,
    subtotal: quote.totals.rawSubtotal,
    discountCode: quote.coupon?.code ?? null,
    discountAmount: quote.totals.discountAmount,
    pointsRedeemed: quote.totals.pointsRedeemed,
    // 4.24 - how many paid orders this customer had BEFORE this one, as the till
    // knew it. Frozen here because it cannot be recovered later: by the time a
    // report is run, every order is a prior order. It is what makes the share of
    // new customers answerable at all. `null` means it could not be read.
    priorPaidOrders: orderFacts.priorPaidOrders,
    pointsDiscountAmount: quote.totals.pointsDiscountAmount,
    pointsEarned: quote.pointsEarned,
    priceVerified: true,
    // The date the shop is promising, from the owner's own lead times. Staff can
    // move it afterwards; this is where it starts.
    dueDate,
    // Only for an order a production speed shaped: its days (the stage plan and a
    // later re-count use them), and the date as computed — so a re-count at
    // payment can tell it from one staff have since changed by hand.
    ...(production.fromSpeed ? { productionDays: production.days, dueDateAuto: dueDate } : {}),
    // At least one line has no artwork yet. Production reads this before it reads
    // anything else.
    // WAITING FOR A FILE WE ASKED FOR — not merely "no file here". A product
    // whose upload box the owner never switched on has nothing pending, and
    // stamping it otherwise sends the customer an email demanding artwork for
    // something the shop never offered to print.
    artworkPending: quote.items.some(
      (line: any, i: number) => line?.artworkExpected === true && !cleanSpecs[i]?.fileUrl,
    ),
    // THE AUTOMATIC STAGES START AT PAYMENT, NOT HERE.
    //
    // An order is created the moment the customer presses Pay and stays unpaid
    // until Mollie says otherwise — most never become anything else. Scheduling
    // an unpaid order would walk abandoned baskets into production, and would
    // put every one of them in the sweep's query forever. `nextStageAt` stays
    // null, so the sweep never sees this document until money arrives.
    stagePlan: null,
    nextStageAt: null,
    stageSource: 'auto',
    stageHold: null,
    stageHistory: [],
    items: quote.items.map((line: any, i: number) => ({
      productId: line.productId,
      productName: line.name,
      sku: line.sku ?? null,
      // Frozen with the line — the product may be moved, renamed or deleted later:
      // its category (the dashboard's charts) and its picture (the job sheet and
      // packing slip).
      ...(typeof line.categoryId === 'string' && line.categoryId ? { categoryId: line.categoryId } : {}),
      ...(() => {
        const image = lineImages.get(String(line.productId ?? ''));
        return image ? { productImage: image } : {};
      })(),
      // Frozen per line: a job can go to press with the file still to come, and
      // the press operator must be able to see which one that is.
      artworkPending: line?.artworkExpected === true && !cleanSpecs[i]?.fileUrl,
      // Where the artwork comes from when it is not his to send: production
      // reuses the previous order's file, or the studio makes it. Only when so.
      ...(line?.artworkSource ? { artworkSource: line.artworkSource } : {}),
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      price: line.totalPrice,
      // WHAT THE LINE COST BEYOND unitPrice × quantity, so a document can say so.
      //
      // `price` has always included the per-line setup fee, and since 2026-10 it
      // also includes the options charged once per line (a die, a proof, a
      // designer — src/lib/chargeOnce.ts). Without these an invoice reads
      // "100 × 12 kr = 2 044 kr" and nobody can see where the 844 came from.
      setupFee: Number(line.setupFee) || 0,
      onceCharges: Number(line.onceCharges) || 0,
      onceOptions: (line.options ?? [])
        .filter((o: any) => o?.chargeOnce === true && Number(o?.priceModifier) > 0)
        .map((o: any) => ({
          label: String(o.optionLabel || o.optionId || ''),
          amount: Number(o.priceModifier) || 0,
        })),
      // WHY THIS LINE COST WHAT IT COST, frozen at order time.
      //
      // Without these the invoice can only print one order-level discount
      // figure and no document can explain it — the customer sees "-300 kr" and
      // no line saying which item it came off, and the shop cannot answer a
      // query about a price six months later. The list price is the one the
      // shop would have charged; onSale says an offer was live at the moment of
      // sale, which is not recoverable from the product afterwards because the
      // owner can end an offer at any time.
      listUnitPrice: line.listUnitPrice ?? line.unitPrice,
      onSale: line.isOnSale === true,
      couponApplied: line.couponApplied === true,
      // A LABEL MAP: every reader does Object.entries(item.options) and prints
      // key: value. An array of ids rendered as raw JSON on the invoice, the work
      // order and the customer's dashboard.
      options: Object.fromEntries(
        (line.options ?? []).map((o: any) => [o.fieldLabel || o.fieldId || 'Option', o.optionLabel || o.optionId]),
      ),
      // THE CUT SHAPES chosen on this line (src/lib/shapes.ts) — the outline the
      // job sheet draws beside the item. Only when there is one: Firestore
      // rejects an undefined field.
      ...(() => {
        const shapes = (line.options ?? [])
          .filter((o: any) => o.outline)
          .map((o: any) => ({ outline: o.outline, label: String(o.optionLabel || o.optionId) }));
        return shapes.length ? { shapes } : {};
      })(),
      // The size the SERVER priced this line on. Production compares the job on
      // the bench against this, not against fileSpecs, which the browser sends.
      //
      // Absent when the customer was never asked for a size — priceCart leaves
      // the pair off the line in that case, and the keys have to stay off here
      // too. Writing them anyway would be `undefined`, which Firestore rejects
      // outright; writing a default would put 50 × 70 cm back on the paperwork
      // of every unsized job, which is the bug this is fixing.
      ...(typeof line.pricedWidthCm === 'number' && typeof line.pricedHeightCm === 'number'
        ? { widthCm: line.pricedWidthCm, heightCm: line.pricedHeightCm }
        : {}),
      // 15.6.3 — the print size, when the line carries one. Kept under its own
      // name so nothing can mistake it for the size the money was calculated
      // from; the work order, the upload box and the customer's order page all
      // fall back to it when there is no priced size.
      ...(typeof line.printWidthCm === 'number' && typeof line.printHeightCm === 'number'
        ? { printWidthCm: line.printWidthCm, printHeightCm: line.printHeightCm }
        : {}),
      fileSpecs: cleanSpecs[i] ?? null,
      // DESIGN LATER (designer v2; the owner's decision of 2026-10-07): a line bought
      // as "Design online" before it was designed carries what the designer needs to
      // open on it from the order page — the size, the cut, the pages and their ink,
      // the kind of product. Worked out HERE from the options and the size the server
      // priced, never the browser's word (src/lib/designLater.ts). Absent otherwise.
      //
      // Only on a line that WAITS for its artwork (not one the studio or a reprint
      // provides), and only while the product offers the designer at all — a basket
      // kept from before the owner switched it off waits for a file instead. The size
      // is the one the server PRICED when there is one (area-priced: what the money was
      // for), else the print size on the line.
      ...(() => {
        if (cleanSpecs[i]?.fileUrl || line.artworkExpected !== true || line.designerOffered !== true) return {};
        // Not where he made the file REQUIRED (DSN-15): no refusal, the line simply
        // waits for its file instead of offering the designer from the order page.
        if (line.fileRequired === true) return {};
        const priced = typeof line.pricedWidthCm === 'number' && typeof line.pricedHeightCm === 'number';
        const marker = designLaterMarker({
          options: line.options,
          printWidthCm: priced ? line.pricedWidthCm : line.printWidthCm,
          printHeightCm: priced ? line.pricedHeightCm : line.printHeightCm,
          printSpec: line.printSpec,
          categoryId: line.categoryId,
        });
        return marker ? { designLater: marker } : {};
      })(),
    })),
    // Written as `comments`, but StaffDashboard and the work order both read
    // `notes` — so the customer's printing instructions never reached the people
    // printing the job. Stored under both names.
    comments: typeof comments === 'string' ? comments.slice(0, 2000) : '',
    notes: typeof comments === 'string' ? comments.slice(0, 2000) : '',
    termsAccepted: true,
    termsAcceptedAt: typeof body?.termsAcceptedAt === 'string' ? body.termsAcceptedAt : now,
    createdAt: now,
    updatedAt: now,
  };

  if (bornWith) Object.assign(order, bornWith);

  // PAY-02 — A LIMITED CODE HOLDS ONE USE FOR THIS ORDER, from now until its
  // payment settles (src/lib/couponRules.ts). Last, so that nothing between the
  // hold and the write below can leave one behind; refused here (409) when the
  // uses paid for and the uses other orders hold leave none. The hold keeps every
  // key the server knows the customer by — his account, the order's e-mail and
  // his account's — so that, however he comes back, it is his (review F).
  const couponHeld = quote.coupon && quote.couponLimited
    ? await holdCouponUse(
        db,
        quote.coupon.code,
        couponHolderKeys(orderUid, orderUid ? [accountEmail] : [customerEmail], couponHolderHash),
        orderId,
        orderUid,
      )
    : false;
  if (couponHeld) Object.assign(order, { couponHeld: true });
  try {
    await db.collection('orders').doc(orderId).create(order);
  } catch (err) {
    // No order, so nothing for the hold to wait for.
    if (couponHeld) await releaseCouponUse(db, quote.coupon!.code, orderId);
    throw err;
  }
  // AFTER the order exists, and never in a way that can stop it existing.
  await snapshotOrderCosts(db, orderId, order.items, now);
  return { db, orderId, order, quote };
}

/**
 * PAY-02 — hold one use of a limited code for `orderId`, on the coupon document,
 * in a transaction: refused with the till's own codes, `usedUp` (the uses paid
 * for plus the customers holding the rest leave none) or `alreadyUsed` (once per
 * customer, and his money for it arrived after the price was worked out). The
 * customer's own holds — by any of `holderKeys` — never count against him. True
 * when the order holds a use — or MAY (an error whose outcome is unknown): the
 * order is then marked so its failure still gives one back. False only when there
 * is certainly none.
 */
async function holdCouponUse(
  db: FirebaseFirestore.Firestore,
  code: string,
  holderKeys: string[],
  orderId: string,
  uid: string | null,
): Promise<boolean> {
  const byCode = db.collection('coupons').where('code', '==', code).limit(1);
  const redemption = uid ? db.collection('couponRedemptions').doc(`${String(code).toUpperCase()}__${uid}`) : null;
  try {
    return await db.runTransaction(async (tx) => {
      const found = await tx.get(byCode);
      if (found.empty) return false;
      const coupon = found.docs[0];
      const data = coupon.data() ?? {};
      if (data.oncePerCustomer === true && redemption && (await tx.get(redemption)).exists) {
        throw Object.assign(new Error('You have already used this discount code.'), { status: 409, code: 'alreadyUsed' });
      }
      const verdict = placeCouponHold({
        holds: data.holds, usedCount: data.usedCount, maxUses: data.maxUses, holderKeys, orderId, nowMs: Date.now(),
      });
      if (!verdict.ok) {
        throw Object.assign(new Error('This discount code has already been fully redeemed.'), { status: 409, code: 'usedUp' });
      }
      tx.update(coupon.ref, { holds: verdict.holds });
      return true;
    });
  } catch (err) {
    if ((err as any)?.status === 409) throw err;
    // FAILS OPEN, as the redemption lookup does: a database hiccup must not refuse
    // a code the till has just accepted. The payment step still says so if the
    // count then passes the limit (couponOverLimit). Reported as "may hold": the
    // write may have landed, and a release that finds nothing costs one read.
    console.error(`Could not hold a use of ${code} for order ${orderId}; it goes ahead without one:`, (err as any)?.message ?? err);
    return true;
  }
}

/**
 * Give back the use `orderId` held: the order was never written, or its payment
 * can no longer happen. Never throws: false when it could not (the caller may try
 * again; otherwise the hold runs out by itself, COUPON_HOLD_MS), true when it is
 * done or there was nothing to give back. Called only for an order that held one.
 */
async function releaseCouponUse(db: FirebaseFirestore.Firestore, code: unknown, orderId: string): Promise<boolean> {
  if (typeof code !== 'string' || !code) return true;
  try {
    const byCode = db.collection('coupons').where('code', '==', code).limit(1);
    await db.runTransaction(async (tx) => {
      const found = await tx.get(byCode);
      if (found.empty) return;
      const { holds, released } = releaseCouponHold(found.docs[0].data()?.holds, orderId, Date.now());
      if (released) tx.update(found.docs[0].ref, { holds });
    });
    return true;
  } catch (err) {
    console.warn(`Could not give back order ${orderId}'s hold on ${code}:`, (err as any)?.message ?? err);
    return false;
  }
}

/**
 * What this order cost us, frozen at the moment it was sold.
 *
 * WHY IT IS NOT ON THE ORDER
 * The buyer can read their own order document (firestore.rules), so a unitCost
 * on an order line would hand every customer the trade price and the exact
 * markup on what they had just bought. That is the leak productCosts was created
 * to close, pointed at a different document. It goes to orderCosts/<orderId>,
 * which is `allow read, write: if false` — Admin SDK only.
 *
 * WHY IT IS FROZEN
 * A cost looked up later is the cost TODAY. The owner changes margins, the
 * exchange rate moves, a supplier re-prices; the margin on a six-month-old order
 * computed from today's figures is fiction. Accounting needs what it cost when
 * it was sold.
 *
 * WHY A FAILURE HERE IS SILENT
 * The customer has paid, or is about to. An order must never fail because a cost
 * record could not be read — a missing cost is a gap in a report, a failed order
 * is a lost sale and a charge to refund.
 */
async function snapshotOrderCosts(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  items: any[],
  nowIso: string,
): Promise<void> {
  try {
    const ids = [...new Set(
      (items ?? []).map((l) => String(l?.productId ?? '').trim()).filter(Boolean),
    )];
    if (ids.length === 0) return;   // a basket of custom uploads has no catalogue cost

    const snaps = await db.getAll(
      ...ids.map((id) => db.collection('productCosts').doc(id)),
      { fieldMask: ['sourcePrice', 'sourceCurrency', 'sourceRate', 'supplier'] },
    );
    const costById = new Map<string, any>();
    for (const snap of snaps) if (snap.exists) costById.set(snap.id, snap.data());

    // The arithmetic and the "is this cost actually known?" rule live in
    // src/lib/orderCosts.ts, with unit tests, because they are money.
    const snapshot = buildCostSnapshot(items ?? [], costById);

    // `complete` and the two counts come with it: a goodsCost that silently
    // excludes half the lines is worse than no figure at all, so every reader
    // can see the difference.
    await db.collection('orderCosts').doc(orderId).set({
      orderId,
      ...snapshot,
      capturedAt: nowIso,
    });
  } catch (err) {
    // Deliberately swallowed — see the note above. Logged so a systematic
    // failure is visible rather than merely absent.
    console.error(`orderCosts snapshot failed for ${orderId}:`, (err as any)?.message ?? err);
  }
}

// ---------------------------------------------------------------------------
// Payment.
//
// The flow, and why each step exists:
//   1. The server creates the order, priced by the server, marked unpaid.
//   2. The server asks Mollie for a payment of that exact amount and hands the
//      customer Mollie's checkout URL. The browser never states an amount.
//   3. The customer pays on Mollie's own page — card details never touch us.
//   4. Mollie POSTs the payment id to our webhook. It is NOT signed and carries
//      no status, so we call Mollie back and ask. A forged webhook can therefore
//      only make us re-check a real payment of our own.
//   5. Only that check may set paymentStatus to 'paid'.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PAY ON DELIVERY — for the customers the owner chooses (client, 2026-10-07: "make
// an option that the customer can pay on delivery, but do not switch it on for the
// customers — an option where I can pick the customer if I want").
//
// THE SWITCH IS NOT ON THE CUSTOMER'S OWN PROFILE. The profile rule lets a customer
// write any field it does not pin, and one who could switch this on could order
// without paying. customerTerms/{uid} has no rule at all, so no browser reads or
// writes it — only this server: for the owner (below) and at the checkout.
// ---------------------------------------------------------------------------
async function mayPayOnDelivery(db: FirebaseFirestore.Firestore, uid: string): Promise<boolean> {
  const snap = await db.collection('customerTerms').doc(uid).get();
  return snap.exists && snap.data()?.payOnDelivery === true;
}

/** The customers he lets pay on delivery — for the switches on the Users screen. */
app.get('/api/admin/customer-terms', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const snap = await db.collection('customerTerms').where('payOnDelivery', '==', true).get();
    return res.json({ payOnDelivery: snap.docs.map((d) => d.id) });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Reading the customer terms failed:', err);
    return res.status(500).json({ error: 'Could not read who may pay on delivery.' });
  }
});

/** His switch, for one customer. */
app.post('/api/admin/customer-terms/:uid', async (req, res) => {
  try {
    const { db, uid: adminUid } = await requireAdmin(req);
    const uid = String(req.params.uid ?? '').trim();
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) return res.status(400).json({ error: 'No such customer.' });
    if (!(await db.collection('users').doc(uid).get()).exists) return res.status(404).json({ error: 'No such customer.' });
    const on = req.body?.payOnDelivery === true;
    const who = await (await getAdminAuth())?.getUser(adminUid).then((u) => u.email ?? adminUid).catch(() => adminUid);
    await db.collection('customerTerms').doc(uid).set(
      { payOnDelivery: on, updatedAt: new Date().toISOString(), updatedBy: who ?? adminUid },
      { merge: true },
    );
    return res.json({ ok: true, uid, payOnDelivery: on });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Saving the customer terms failed:', err);
    return res.status(500).json({ error: 'Could not save that.' });
  }
});

/**
 * What THIS signed-in customer may choose at the checkout. A guest, or no token:
 * paying online only — the checkout looks exactly as it always has.
 */
app.get('/api/checkout/options', quoteRateLimit, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const caller = await callerIdentity(req);
    const db = getAdminDb();
    const payOnDelivery = !!caller && !caller.anonymous && !!db && (await mayPayOnDelivery(db, caller.uid));
    return res.json({ payOnDelivery });
  } catch {
    return res.json({ payOnDelivery: false });
  }
});

/**
 * How old an attempt's marker must be, with no order on it, before it stops
 * meaning "being placed" — well past the slowest placing seen on this host, where
 * a request has taken close to a minute.
 */
const POD_ATTEMPT_STALE_MS = 5 * 60 * 1000;

/**
 * An order placed to PAY ON DELIVERY: priced and written exactly like any other
 * (createOrder), then put into production at once — the stage plan from now, both
 * e-mails, the shipping draft, the filing — while it stays UNPAID until the owner
 * records the payment (/record-payment), when the points and the coupon follow.
 */
async function placeOnDelivery(req: express.Request, res: express.Response) {
  const db = getAdminDb();
  if (!db) return res.status(503).json({ error: 'Orders cannot be placed right now. Please contact us and we will take your order directly.' });
  const caller = await callerIdentity(req);
  if (!caller || caller.anonymous || !(await mayPayOnDelivery(db, caller.uid))) {
    return res.status(403).json({ error: 'Paying on delivery is not available on this account. Please pay online.', code: 'no_pay_on_delivery' });
  }
  // NO POINTS AND NO DISCOUNT CODE WHEN PAYING ON DELIVERY. Both are spent when the
  // money arrives — for this order, days later — and until then the same points or a
  // once-only code would buy a second order as well (review, 2026-10-07).
  if (Number(req.body?.pointsToRedeem) > 0 || (typeof req.body?.couponCode === 'string' && req.body.couponCode.trim() !== '')) {
    return res.status(400).json({ error: 'Loyalty points and discount codes are used when paying online.', code: 'on_delivery_no_discounts' });
  }

  // ONE ORDER PER ATTEMPT. An order to pay on delivery goes straight into
  // production, so a press repeated after a timeout must not print a second one:
  // the checkout names its attempt, and the same attempt is answered with the order
  // it already made — or, while that one is still being placed, refused.
  const attempt = typeof req.body?.attemptId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(req.body.attemptId)
    ? req.body.attemptId
    : null;
  const marker = attempt ? db.collection('checkoutAttempts').doc(`${caller.uid}_${attempt}`) : null;
  if (marker) {
    let tookOver = false;
    const earlier = await db.runTransaction(async (tx) => {
      tookOver = false;
      const snap = await tx.get(marker);
      if (snap.exists) {
        const seen = (snap.data() ?? {}) as { orderId?: string; publicToken?: string; at?: string };
        if (seen.orderId) return seen;
        // A MARKER WITH NO ORDER, LEFT LONG AGO, IS NOT A PLACING IN PROGRESS. A
        // crash between the marker and the order, or a swallowed write of the
        // order's id onto it (below), left it like this — and the same attempt was
        // then refused "already being placed" for ever. Older than a placing can
        // take on this host: the order is looked for by the attempt it carries
        // (one read, only here); found, it is the answer; not found, nothing was
        // placed and this request takes the attempt over. Inside the transaction,
        // so two presses cannot both take it over.
        if (Date.now() - (Date.parse(String(seen.at ?? '')) || 0) < POD_ATTEMPT_STALE_MS) return seen;
        let placed: FirebaseFirestore.QuerySnapshot;
        try {
          placed = await tx.get(db.collection('orders').where('checkoutAttemptId', '==', attempt).limit(5));
        } catch (err) {
          // Could not look: the answer it always gave, rather than a second order.
          console.warn(`Pay on delivery: could not look for attempt ${attempt}'s order:`, (err as any)?.message ?? err);
          return seen;
        }
        // The attempt id is the customer's own; another account's order is never his answer.
        const mine = placed.docs.find((d) => d.data()?.userId === caller.uid);
        if (mine) {
          const found = { orderId: mine.id, publicToken: (mine.data()?.publicToken as string | undefined) ?? undefined };
          tx.set(marker, { orderId: found.orderId, publicToken: found.publicToken ?? null }, { merge: true });
          return found;
        }
        tookOver = true;
      }
      tx.set(marker, { uid: caller.uid, at: new Date().toISOString() });
      return null;
    });
    if (tookOver && !earlier) console.warn(`Pay on delivery: attempt ${attempt} had been left without an order; placing it now.`);
    if (earlier?.orderId) return res.json({ orderId: earlier.orderId, publicToken: earlier.publicToken ?? null, payOnDelivery: true, again: true });
    if (earlier) return res.status(409).json({ error: 'This order is already being placed.', code: 'placing' });
  }
  const bornAt = new Date().toISOString();
  let created: Awaited<ReturnType<typeof createOrder>>;
  try {
    created = await createOrder(req.body, caller, {
      payOnDelivery: true,
      paymentProvider: 'on_delivery',
      paymentMethodTitle: PAYMENT_TITLES.on_delivery,
      confirmedAt: bornAt,
      ...(attempt ? { checkoutAttemptId: attempt } : {}),
    });
  } catch (err) {
    // Nothing was placed: the same attempt may try again (a changed price, a typo).
    if (marker) await marker.delete().catch(() => {});
    throw err;
  }
  const { orderId, order } = created;
  if (marker) await marker.set({ orderId, publicToken: order.publicToken }, { merge: true }).catch(() => {});
  const ref = db.collection('orders').doc(orderId);
  // Production starts now. Should this one write fail, the order is still a marked
  // order to pay on delivery: staff moving it by hand plans its stages. CAUGHT, so
  // that is what happens — it used to throw past the answer below, the customer
  // was told it failed for an order that exists, and the e-mails, the shipping
  // draft and the filing never started.
  try {
    const plan = await stagePlanFields(db, order, bornAt);
    await ref.update({ updatedAt: new Date().toISOString(), ...plan });
  } catch (err) {
    console.error(`Order ${orderId}: the stage plan (pay on delivery) could not be written — moving the order by hand plans it.`, err);
  }
  invalidateReports();
  console.log(`Order ${orderId} placed to pay on delivery.`);
  // ANSWER FIRST. The e-mails, the shipping draft and the filing (which uploads every
  // print file) can take long on this host, and a customer whose page timed out would
  // press again. Each step is flag-guarded, and the order panel shows its state.
  res.json({ orderId, publicToken: order.publicToken, payOnDelivery: true });
  const placed = (await ref.get().catch(() => null))?.data() as any;
  void runConfirmedOrderSteps(db, ref, orderId, (placed?.sideEffects ?? {}) as Record<string, boolean>).catch((err) =>
    console.error(`Order ${orderId}: the steps after placing it (pay on delivery) failed:`, err),
  );
}

/** How an order paid on delivery was paid — the words the invoice and receipt print. */
const RECORDED_PAYMENT_METHODS: Record<string, string> = {
  cash: 'cash', card: 'card', swish: 'Swish', bank: 'bank transfer', invoice: 'invoice',
};

/**
 * The money for an order paid on delivery, recorded by the owner: the order is paid
 * from now, and the customer's points and the coupon's count follow — exactly the
 * steps an online payment runs (runMoneySteps). Again for the same order: only what
 * is still outstanding is done.
 */
app.post('/api/admin/orders/:orderId/record-payment', async (req, res) => {
  try {
    const { db, uid } = await requireAdmin(req);
    const orderId = String(req.params.orderId ?? '').trim();
    if (!orderId) return res.status(400).json({ error: 'An order id is required.' });
    const ref = db.collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'No such order.' });
    const order = snap.data() as any;
    if (order.payOnDelivery !== true) {
      return res.status(409).json({ error: 'Only an order paid on delivery is recorded here — an online payment is recorded by Mollie.' });
    }
    if (String(order.status ?? '') === 'cancelled') {
      return res.status(409).json({ error: 'This order is cancelled. Reopen it before recording a payment.' });
    }
    // Already recorded: the press finishes whatever money step did not (no method needed).
    if (order.paymentStatus !== 'paid') {
      const method = String(req.body?.method ?? '');
      const word = RECORDED_PAYMENT_METHODS[method];
      if (!word) return res.status(400).json({ error: 'Choose how it was paid.' });
      const who = await (await getAdminAuth())?.getUser(uid).then((u) => u.email ?? uid).catch(() => uid);
      const now = new Date().toISOString();
      await ref.update({
        paymentStatus: 'paid',
        paidAt: now,
        // The words for the bookkeeping and the method's code, which the documents
        // turn into the reader's language.
        paymentMethodTitle: `Paid on delivery (${word})`,
        paymentRecordedMethod: method,
        paymentRecordedBy: who ?? uid,
        // The order sheet in Drive was filed when it was placed ("TOTAL DUE ON
        // DELIVERY"): filed again, as paid.
        'sideEffects.driveSynced': false,
        updatedAt: now,
      });
    }
    const fresh = (await ref.get()).data() as any;
    const failures = await runMoneySteps(db, ref, orderId, fresh, (fresh?.sideEffects ?? {}) as Record<string, boolean>);
    await runConfirmedOrderSteps(db, ref, orderId, (((await ref.get()).data() as any)?.sideEffects ?? {}) as Record<string, boolean>).catch(() => {});
    invalidateReports();
    const after = (await ref.get()).data() as any;
    const answer = { orderId, paymentStatus: 'paid', paymentMethodTitle: after?.paymentMethodTitle ?? null, sideEffects: after?.sideEffects ?? {} };
    if (failures.length) {
      return res.status(500).json({ ...answer, error: `Recorded as paid, but these did not finish: ${failures.join(', ')}. Press again to finish them.`, failures });
    }
    return res.json({ ok: true, ...answer });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Recording a payment failed:', err);
    return res.status(500).json({ error: 'Could not record the payment.' });
  }
});

app.post('/api/checkout/pay', quoteRateLimit, async (req, res) => {
  try {
    // PAY ON DELIVERY: no payment page — the order goes into production now and is
    // paid when it arrives. Only for a customer the owner chose (customerTerms),
    // checked from the caller's own token, never from what the browser says.
    if (req.body?.paymentMethod === 'on_delivery') return await placeOnDelivery(req, res);
    const mollie = getMollie();
    if (!mollie) {
      return res.status(503).json({
        error: 'Online payment is not available yet. Please contact us to complete your order.',
        reason: 'no_api_key',
      });
    }

    let baseUrl: string;
    try {
      baseUrl = publicBaseUrl(req);
    } catch (err: any) {
      // Deliberate: without a trustworthy address of our own we would be handing
      // Mollie a return link built from a header a stranger controls. Refusing
      // is the safe outcome, and the message tells the operator exactly what to set.
      console.error(err?.message);
      return res.status(503).json({
        error: 'Online payment is not configured on this server yet. Please contact us to complete your order.',
        reason: 'no_public_url',
      });
    }

    const { orderId, order, db } = await createOrder(req.body, await callerIdentity(req));

    try {
      // The mode is decided by the key THIS client was built with. Reading the
      // environment again at write time raced a concurrent rotation and could
      // stamp a live payment as test (or the reverse).
      const mollieKeyWasLive = isMollieLive();
      const payment = await mollie.payments.create({
        amount: toMollieAmount(order.grossTotal, order.currency),
        description: `Order ${orderId}`,
        redirectUrl: `${baseUrl}/order/${orderId}?t=${order.publicToken}`,
        // Mollie must be able to reach this. On localhost it cannot, so we leave
        // it off rather than register an address that will never be called — the
        // return page still polls, so a local test is not left hanging.
        ...(isPubliclyReachable(baseUrl) ? { webhookUrl: `${baseUrl}/api/webhooks/mollie` } : {}),
        metadata: { orderId },
        // MAPPED, not passed through. This read req.body.locale raw and no caller
        // ever sent one, so the hosted page has always opened in whatever
        // language the shopper's browser suggested rather than the one they
        // chose in the shop. The checkout now sends 'sv' | 'da' | 'no' | 'en',
        // which are OUR codes; Mollie wants sv_SE / da_DK / nb_NO / en_GB and
        // rejects anything else outright, so an unmapped value becomes undefined
        // and Mollie decides — which is exactly today's behaviour.
        locale: mollieLocale(typeof req.body?.locale === 'string' ? req.body.locale : undefined),
      });

      await db.collection('orders').doc(orderId).update({
        molliePaymentId: payment.id,
        paymentProvider: 'mollie',
        paymentMode: mollieKeyWasLive ? 'live' : 'test',
        updatedAt: new Date().toISOString(),
      });

      const checkoutUrl = payment.getCheckoutUrl();
      if (!checkoutUrl) throw new Error('Mollie returned no checkout URL.');

      return res.json({
        orderId,
        publicToken: order.publicToken,
        checkoutUrl,
        webhookRegistered: isPubliclyReachable(baseUrl),
      });
    } catch (payErr: any) {
      // The order exists but cannot be paid for. Say so on the order itself
      // instead of leaving a silent orphan the shop never hears about.
      console.error('Mollie payment creation failed:', payErr?.message ?? payErr);
      // …and a use of a limited code it held goes back (PAY-02): there is no
      // payment for it to wait for.
      const givenBack = (order as any).couponHeld === true && (await releaseCouponUse(db, order.discountCode, orderId));
      await db.collection('orders').doc(orderId).update({
        paymentError: String(payErr?.message ?? payErr).slice(0, 300),
        ...(givenBack ? { couponHeld: false } : {}),
        updatedAt: new Date().toISOString(),
      });
      return res.status(502).json({
        orderId,
        error: 'We could not start the payment. Your order is saved — please contact us and we will help you complete it.',
      });
    }
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.detail ? { detail: err.detail } : {}) });
    console.error('Payment start failed:', err);
    return res.status(500).json({ error: 'We could not start the payment. Please try again.' });
  }
});

/**
 * THE AUTOMATIC STAGES, planned from `startIso` — the payment (settlePayment), or the
 * placing of an order the customer pays on delivery: production starts then. The
 * fields to write with it; the due date of a speed order recounted from the same
 * moment.
 */
async function stagePlanFields(db: FirebaseFirestore.Firestore, order: any, startIso: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const settings = await fetchAutoStageSettings(db);
  // A production speed's days, when one shaped this order (src/lib/productionSpeed.ts).
  const speedDays = typeof order.productionDays === 'number' ? order.productionDays : null;
  // shippingMethod: a collected order is never planned past `finishing`,
  // so the sweep can never tell a customer their pickup was couriered.
  //
  // NOTHING IN HERE MAY THROW. For a payment this runs before the one update that
  // records it; a throw is retried for ever and leaves a PAID order unpaid.
  // Any failure falls back to the plan every order had before speeds existed.
  let plan;
  try {
    plan = buildStagePlan(startIso, settings, order.shippingMethod, speedDays);
  } catch (err) {
    console.warn('The speed plan failed; planning as before:', err);
    plan = buildStagePlan(startIso, settings, order.shippingMethod);
  }
  out.stagePlan = Object.keys(plan).length ? plan : null;
  out.stageSource = 'auto';
  out.nextStageAt = nextStageAtFor(order.status ?? 'pending', plan);
  // A SPEED ORDER'S PROMISE COUNTS FROM THE MONEY, not from the click on Pay:
  // a bank payment two days later must not keep a Next-day date that has
  // already passed. In the same update, before the confirmation e-mail reads
  // the order.
  const recount = await recountedDueDate(db, order, new Date(startIso));
  if (recount) {
    out.dueDate = recount;
    out.dueDateAuto = recount;
  }
  return out;
}

/**
 * THE MONEY STEPS — the customer's points and the coupon's count, each guarded on its
 * own flag so a retry resumes where it stopped. Against money that ARRIVED: a Mollie
 * payment (settlePayment), or one the owner records for an order paid on delivery.
 * What failed, for the caller to retry.
 */
async function runMoneySteps(
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  orderId: string,
  order: any,
  done: Record<string, boolean>,
): Promise<string[]> {
  const failures: string[] = [];

  // 1. Loyalty points, against money that actually arrived rather than against
  //    an attempt. Doing this in the browser at checkout meant an abandoned
  //    payment still spent the customer's points and still credited them.
  if (!done.pointsApplied) {
    try {
      if (!String(order.userId).startsWith('guest-')) {
        const userRef = db.collection('users').doc(order.userId);
        const spent = Number(order.pointsRedeemed) || 0;
        const earned = Number(order.pointsEarned) || 0;
        // 4.25 — the tier follows LIFETIME SPEND, so the spend has to be
        // recorded somewhere. What the customer actually paid, this order.
        const paidNow = Number(order.grossTotal ?? order.totalAmount) || 0;
        // The rates, for the tier thresholds. Read here rather than inside the
        // transaction: a settings fetch inside a transaction lengthens the
        // window for no reason.
        const loyaltyNow = loyaltySettingsFrom(await fetchPrintSettings());

        // 4.25 — the spend and the tier, ALWAYS, and not inside the points
        // transaction. An order too small to earn a single point is still money
        // the customer spent, and guarding it on `spent > 0 || earned > 0`
        // would lose it.
        await addLifetimeSpendForOrder(db, orderId, order, paidNow, loyaltyNow);

        if (spent > 0 || earned > 0) {
          // THE LEDGER IS A SUBCOLLECTION NOW, and the array is a view of it.
          //
          // It used to be `pointsHistory: [...history, ...entries].slice(-50)`,
          // which lost the oldest entries — and that was the smaller problem.
          // The guard against crediting twice was `history.some(h => h.orderId
          // === orderId)`, searching THAT SAME TRUNCATED ARRAY. Once an order's
          // entry aged past the fiftieth, a replayed webhook for it — and
          // Mollie's webhooks do repeat — would credit the customer again, with
          // nothing anywhere recording that it had happened before.
          //
          // The ledger document's ID is the order's, so the guard is now the
          // existence of a specific document: exact, permanent, and cheaper
          // than scanning an array. A customer's points can be audited years
          // later, which is what a ledger is for.
          //
          // `pointsHistory` stays on the user document as a RECENT view — the
          // dashboard reads it without a second query — and is explicitly the
          // last 50, not the record.
          const ledger = userRef.collection('pointsLedger');
          let shortfallSeen = 0;
          await db.runTransaction(async (tx) => {
            shortfallSeen = 0;
            const userSnap = await tx.get(userRef);
            if (!userSnap.exists) return;
            // The order's own ledger entries. Reading the two ids directly is
            // the whole dedupe; no scan, no window, no ageing out.
            const marks = await tx.getAll(ledger.doc(`${orderId}-r`), ledger.doc(`${orderId}-e`));
            if (marks.some((m) => m.exists)) return;

            const data = userSnap.data() ?? {};
            const balance = Number(data.loyaltyPoints) || 0;
            const history = Array.isArray(data.pointsHistory) ? data.pointsHistory : [];

            // WHAT THE BALANCE CAN STILL PAY. The points were checked against the
            // balance when the order was PRICED, not set aside: two orders priced
            // on the same points and both paid spend them twice. `Math.max(0, …)`
            // below absorbed the second spend in silence while the ledger recorded
            // it in full. Only what is there is taken (this order's own earn counts,
            // as it always did); the rest is recorded as unrecoverable, the refund
            // claw-back's rule, and the order says so.
            const shortfall = Math.max(0, spent - balance - earned);
            const taken = spent - shortfall;
            shortfallSeen = shortfall;

            const at = new Date().toISOString();
            const entries: any[] = [];
            if (spent > 0) entries.push({
              id: `${orderId}-r`, date: at, points: -taken || 0, type: 'redeemed', orderId,
              description: `Redeemed on order #${orderId}`,
              ...(shortfall > 0 ? { unrecoverablePoints: shortfall } : {}),
            });
            // 4.18 — an earn carries the day it runs out. Null when expiry is
            // switched off, which is where this shop starts: turning it on by
            // default would quietly delete balances already earned.
            if (earned > 0) entries.push({
              id: `${orderId}-e`, date: at, points: earned, type: 'earned', orderId,
              description: `Earned on order #${orderId}`,
              expiresAt: pointsExpireAt(at, loyaltyNow),
            });

            for (const e of entries) tx.set(ledger.doc(e.id), e);
            tx.update(userRef, {
              loyaltyPoints: Math.max(0, balance - taken + earned),
              // The view. The record is the subcollection above.
              pointsHistory: [...history, ...entries].slice(-50),
            });
            if (shortfall > 0) tx.update(ref, { pointsShortfall: shortfall });
          });
          if (shortfallSeen > 0) {
            console.warn(`Order ${orderId}: ${spent} points were redeemed, but only ${spent - shortfallSeen} could be taken at payment (the balance and this order's earn); ${shortfallSeen} recorded as unrecoverable (pointsShortfall).`);
          }
        }
      }
      await ref.update({ 'sideEffects.pointsApplied': true });
    } catch (err) {
      console.error(`Order ${orderId}: loyalty points failed.`, err);
      failures.push('points');
    }
  }

  // 2. The coupon counts only against money that actually arrived.
  if (!done.couponCounted) {
    try {
      if (order.discountCode) {
        const coupons = await db.collection('coupons').where('code', '==', order.discountCode).limit(1).get();
        if (!coupons.empty) {
          const couponRef = coupons.docs[0].ref;
          // The increment is guarded INSIDE the transaction by a per-order
          // marker, like the points' pointsHistory dedupe. The outer
          // done.couponCounted flag alone was not enough: it is written
          // AFTER the transaction, so a crash between the two — or two
          // concurrent deliveries of the same webhook — incremented
          // usedCount twice and exhausted limited coupons early.
          const marker = db.collection('couponRedemptions').doc(`order-${orderId}`);
          // 4.24 — PER-CODE STATISTICS, RECORDED AT REDEMPTION TIME.
          //
          // "at redemption time" is the whole requirement, and it is not a
          // convenience. Computed later from the orders, these numbers cannot
          // be had: the cost of the goods moves, the coupon's percentage can be
          // edited, and an order deleted for GDPR takes its row with it. Frozen
          // here, the campaign can still be judged in a year.
          //
          // The cost comes from orderCosts, which snapshotOrderCosts has
          // already written for this order and which no browser may read. A
          // missing cost is recorded as missing rather than as zero — a margin
          // that silently counts an unknown cost as free profit is worse than
          // no margin at all.
          const costSnap = await db.collection('orderCosts').doc(orderId).get()
            .catch(() => null);
          const goodsCost = Number(costSnap?.data()?.goodsCost) || 0;
          const costComplete = costSnap?.data()?.complete === true;
          const statsRef = db.collection('couponStats').doc(couponDocId(String(order.discountCode)));

          let overLimit: { used: number; max: number } | null = null;
          await db.runTransaction(async (tx) => {
            overLimit = null;
            const already = await tx.get(marker);
            if (already.exists) return;
            const [snap, stats] = await tx.getAll(couponRef, statsRef);
            const usedBefore = Number(snap.data()?.usedCount) || 0;
            // The use this order HELD becomes a use (PAY-02): one write, the hold
            // and the count together, so the two can never both count it — and the
            // customer's other open tries with the code give theirs back with it.
            const { holds, released } = releaseCouponHold(snap.data()?.holds, orderId, Date.now(), { paid: true });
            tx.update(couponRef, { usedCount: usedBefore + 1, ...(released ? { holds } : {}) });
            // Money that arrived is never refused — but a use past the limit (a hold
            // that ran out, a payment that came after it) is said, not hidden.
            const maxUses = Number(snap.data()?.maxUses) || 0;
            if (maxUses > 0 && usedBefore >= maxUses) {
              overLimit = { used: usedBefore + 1, max: maxUses };
              tx.update(ref, { couponOverLimit: true });
            }
            tx.set(marker, { code: order.discountCode, orderId, userId: order.userId ?? null, at: new Date().toISOString() });

            const prior = stats.data() ?? {};
            // THE GOODS, EXCLUDING THE DELIVERY FEE.
            //
            // `netTotal` includes shipping, and `goodsCost` is the cost of the
            // goods alone. Comparing the two would add the freight the customer
            // paid to the margin on what was sold and flatter it by the whole
            // delivery fee — on a small order that is most of the "profit".
            const netTotal = Number(order.netTotal ?? order.totalAmount) || 0;
            const shipping = Number(order.shippingCost) || 0;
            const netRevenue = Math.max(0, Math.round((netTotal - shipping) * 100) / 100);
            const discountGiven = Number(order.discountAmount) || 0;
            // A customer's first order, as the till knew it at the time. The
            // share of NEW customers is the number that says whether a campaign
            // recruited anybody or merely discounted the regulars.
            //
            // STRICTLY A NUMBER equal to zero. `priorPaidOrders` is null when
            // the count could not be read and on a guest checkout, and
            // `Number(null)` is 0 — which would have counted every unreadable
            // order as a recruited customer and inflated the one figure this
            // statistic exists to answer.
            const isNewCustomer = typeof order.priorPaidOrders === 'number' && order.priorPaidOrders === 0;
            tx.set(statsRef, {
              code: String(order.discountCode).toUpperCase(),
              uses: (Number(prior.uses) || 0) + 1,
              discountGiven: Math.round(((Number(prior.discountGiven) || 0) + discountGiven) * 100) / 100,
              netRevenue: Math.round(((Number(prior.netRevenue) || 0) + netRevenue) * 100) / 100,
              goodsCost: Math.round(((Number(prior.goodsCost) || 0) + goodsCost) * 100) / 100,
              // How many of the orders behind these totals had a complete cost
              // record, so a margin computed from them can say how much of
              // itself it actually knows.
              ordersWithFullCost: (Number(prior.ordersWithFullCost) || 0) + (costComplete ? 1 : 0),
              newCustomers: (Number(prior.newCustomers) || 0) + (isNewCustomer ? 1 : 0),
              firstUsedAt: prior.firstUsedAt ?? new Date().toISOString(),
              lastUsedAt: new Date().toISOString(),
            }, { merge: true });
          });
          const past = overLimit as { used: number; max: number } | null;
          if (past) {
            console.warn(`Order ${orderId}: coupon ${order.discountCode} is now used ${past.used} times against a limit of ${past.max} (couponOverLimit).`);
          }
          // Lets 'one use per customer' be enforced on the next order.
          if (!String(order.userId).startsWith('guest-')) {
            await db.collection('couponRedemptions').doc(`${String(order.discountCode).toUpperCase()}__${order.userId}`).set(
              { code: order.discountCode, userId: order.userId, orderId, at: new Date().toISOString() },
              { merge: true },
            );
          }
        }
      }
      await ref.update({ 'sideEffects.couponCounted': true });
    } catch (err) {
      console.error(`Order ${orderId}: counting the coupon failed.`, err);
      failures.push('coupon');
    }
  }

  return failures;
}

/**
 * THE CONFIRMED ORDER'S STEPS — both e-mails, the shipping draft and the filing — for
 * an order going into production: paid (settlePayment), or placed by a customer who
 * pays on delivery. Each guarded on its own flag; none asks Mollie for a retry.
 */
async function runConfirmedOrderSteps(
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.DocumentReference,
  orderId: string,
  done: Record<string, boolean>,
): Promise<void> {
  // 3. Tell both sides. sendOrderEmails never throws; it reports. A mail
  //    problem is recorded but does not make Mollie retry the whole webhook,
  //    because retrying would not fix an SMTP password.
  // `!wasPaid` IS GONE FROM THIS CONDITION, and that is the fix, not an
  // oversight.
  //
  // Steps 1, 2, 4 and 5 are each guarded on their OWN completion flag, and the
  // comment above this block explains why: guarding on the order's previous
  // status meant that once it read 'paid', every remaining step was skipped
  // forever. Step 3 was left carrying exactly that guard. So if the process
  // died between the `paid` write and the send — a restart, a deploy, the
  // memory ceiling — Mollie's retry and the /status reconcile both found
  // wasPaid true and skipped the emails for good. The customer who paid got
  // nothing, the shop was never told the order existed, and nothing was
  // logged, because a guard that skips is silent.
  //
  // `!done.emailsSent` already prevents a duplicate send, which is the only
  // thing `!wasPaid` was contributing.
  if (!done.emailsSent) {
    // Two deliveries of the same webhook arriving together both saw
    // emailsSent unset (it comes from the snapshot read at the top) and both
    // sent — customer and shop each got everything twice. The claim below is
    // transactional: exactly one delivery wins the right to send.
    //
    // A claim also EXPIRES. It used to be permanent: a process that claimed
    // the send and then died left `emailClaimed` set with `emailsSent` unset,
    // and every later attempt refused to claim — the same silent, permanent
    // loss by another route. A claim older than CLAIM_STALE_MS is treated as
    // abandoned and may be taken again.
    const CLAIM_STALE_MS = 5 * 60_000;
    const claimed = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const data = s.data() ?? {};
      const se = (data.sideEffects ?? {}) as Record<string, boolean>;
      if (se.emailsSent) return false;
      if (se.emailClaimed) {
        const at = Date.parse(String(data.emailClaimedAt ?? ''));
        const fresh = Number.isFinite(at) && Date.now() - at < CLAIM_STALE_MS;
        if (fresh) return false;
      }
      tx.update(ref, {
        'sideEffects.emailClaimed': true,
        emailClaimedAt: new Date().toISOString(),
      });
      return true;
    });
    // Not an early return: a lost claim must not swallow the failures
    // handling below, which is what asks Mollie to retry the money steps.
    if (claimed) {
      const fresh = (await ref.get()).data() as any;
      const settings = await fetchSiteConfig();
      const shopName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';
      const base = (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');
      const orderUrl = `${base}/order/${orderId}?t=${fresh.publicToken}`;
      const mail = await sendOrderEmails(fresh, shopName, orderUrl, settings.pickupLocation, settings.logoUrl, {
        shopInbox: await orderInboxes(),
      });
      // `emailsSent` RECORDS WHAT HAPPENED, not that it was attempted.
      //
      // This flag was written `true` unconditionally, whatever the send
      // reported. It is the flag every later attempt checks, so a failure was
      // permanent AND invisible: order 202600001 on the live shop — 23 957.50
      // SEK, paid — carries emailStatus "failed" and was never retried by
      // anything. It is worse for a guest: the emailed link carries the only
      // copy of their publicToken, and without it /api/orders/:id/status
      // refuses them, so they can never see the order or upload their print
      // file again.
      //
      // Leaving it false when the send failed means the next webhook delivery,
      // the /status reconcile, or a manual replay tries again — which is what
      // finally fixes it once the SMTP password is working.
      const emailUpdate: Record<string, unknown> = {
        emailStatus: mail.sent ? 'sent' : (mail.reason ?? 'failed'),
        emailDetail: mail.results ?? null,
        updatedAt: new Date().toISOString(),
      };
      if (mail.sent) {
        emailUpdate['sideEffects.emailsSent'] = true;
      } else {
        // Release the claim too, or the retry cannot get past it.
        emailUpdate['sideEffects.emailClaimed'] = false;
      }
      await ref.update(emailUpdate);
      if (!mail.sent) console.error(`Order ${orderId}: no email went out (${mail.reason}). It will be retried.`);
    }
  }

  // 4. The shipment. A paid order that is being delivered goes into Zendr as
  //    a draft for staff to book. Guarded on its own flag like the steps
  //    above, so a replay resumes it — but a Zendr failure is NOT added to
  //    `failures`: money has already changed hands and asking Mollie to
  //    redeliver the payment webhook cannot fix a freight API. The error is
  //    recorded on the order and the back office offers a retry button.
  if (!done.zendrDraft && zendrConfigured()) {
    const fresh = (await ref.get()).data() as any;
    const outcome = await createZendrDraftFor(db, orderId, fresh);
    if (outcome.ok || outcome.reason === 'This order is collected, not shipped.') {
      await ref.update({ 'sideEffects.zendrDraft': true });
    }
  }

  // 5. The paperwork, filed. Same shape as the Zendr step above and for the
  //    same reason: a Drive outage must not make Mollie redeliver a payment.
  if (!done.driveSynced) {
    const fresh = (await ref.get()).data() as any;
    const outcome = await pushOrderToDrive(db, orderId, { id: orderId, ...fresh });
    if (outcome.ok || outcome.reason === 'Google Drive is not connected.') {
      await ref.update({ 'sideEffects.driveSynced': true });
    }
  }
}

// Throttles the webhook's forced key refresh — see inside the handler.
let lastWebhookKeyRefresh = 0;

/**
 * Settle one Mollie payment: ask Mollie what actually happened to it, write that
 * onto the order, and run the side effects the money is supposed to trigger. It
 * re-reads the truth from Mollie every time and every side effect is
 * flag-guarded, so calling it again for the same payment is safe.
 *
 * THIS USED TO BE THE WEBHOOK ROUTE ITSELF, and the /status reconcile below
 * reached it by POSTing to `http://127.0.0.1:${PORT}/api/webhooks/mollie`. On
 * the live cPanel host Passenger hands us a UNIX SOCKET PATH in PORT rather than
 * a number — see LISTENING_ON_SOCKET — so that string interpolated into a URL
 * parsed as plain `http://127.0.0.1:80/...`: the POST went to Apache, which
 * answered 404. A 404 is a RESOLVED fetch, so the `.catch` never fired and not
 * one line was logged. The reconcile has been running in production all along
 * and doing nothing at all — in exactly the case it exists for, a customer who
 * really paid and a webhook that never arrived. It is a plain function call now
 * and the hop is gone.
 *
 * It returns an outcome instead of touching `res`; the route below maps that
 * onto the same status codes it has always answered with.
 */
async function settlePayment(paymentId: string): Promise<{ ok: boolean; retry?: boolean; reason?: string }> {
  try {
    const mollie = getMollie();
    const db = getAdminDb();
    if (!mollie || !db) {
      // A RETRY, not a 200. This answered "received" and Mollie never called again,
      // so a payment that arrived while a key or the database credentials were
      // missing (a deploy without its .env, a key being replaced) stayed unpaid for
      // good. Mollie keeps retrying for about a day; by then the server has them.
      console.error('Mollie webhook received but the server is not configured to handle it — asking Mollie to retry.');
      return { ok: false, retry: true, reason: 'not configured' };
    }

    // The key can rotate at runtime now, and this process may hold a client
    // built from the OLD key for up to the cache window. If the fetch fails,
    // force-refresh the keys once and retry with a fresh client — and if it
    // STILL fails, answer 500 so Mollie retries later. The outer catch's
    // always-200 must never swallow this particular failure: a swallowed
    // payment fetch is a customer who paid and an order that stays unpaid,
    // with nobody told.
    let payment: import('@mollie/api-client').Payment;
    try {
      payment = await mollie.payments.get(paymentId);
    } catch (fetchErr) {
      console.warn(`Webhook could not fetch payment ${paymentId}; refreshing keys and retrying once.`, fetchErr);
      // The webhook is unauthenticated by design, so this retry path can be
      // reached with junk ids. The FORCED read is throttled so a stranger
      // hammering the endpoint spends their own time, not the read quota that
      // has blacked this shop out before.
      if (Date.now() - lastWebhookKeyRefresh > 30_000) {
        lastWebhookKeyRefresh = Date.now();
        await loadIntegrationSecrets(true).catch(() => {});
      }
      const fresh = getMollie();
      if (!fresh) return { ok: false, retry: true, reason: 'no Mollie key' };
      try {
        payment = await fresh.payments.get(paymentId);
      } catch (secondErr) {
        console.error(
          `Webhook STILL cannot fetch payment ${paymentId} after a key refresh — asking Mollie to retry. ` +
            'If the Mollie ACCOUNT was just switched, payments created under the old account need manual review.',
          secondErr,
        );
        return { ok: false, retry: true, reason: 'could not fetch the payment' };
      }
    }
    const metadata = (payment.metadata ?? {}) as { orderId?: string };
    const orderId = String(metadata.orderId ?? '');
    if (!orderId) {
      console.warn(`Mollie payment ${paymentId} carries no orderId.`);
      return { ok: true, reason: 'no order id on the payment' };
    }

    const ref = db.collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.warn(`Mollie webhook for unknown order ${orderId}.`);
      return { ok: true, reason: 'unknown order' };
    }

    const order = snap.data() as any;

    // Guard against a payment being pointed at someone else's order, and against
    // an amount that is not the one we asked for.
    const expected = toMollieAmount(order.grossTotal, order.currency);
    const actual = payment.amount;
    if (actual.currency !== expected.currency || actual.value !== expected.value) {
      console.error(
        `Mollie payment ${paymentId} is ${actual.value} ${actual.currency}, but order ${orderId} is ${expected.value} ${expected.currency}. Not marking as paid.`,
      );
      await ref.update({ paymentMismatch: true, updatedAt: new Date().toISOString() });
      return { ok: true, reason: 'amount mismatch' };
    }

    const status = payment.status;
    // Mollie's payment status never becomes "refunded" — a refund is a separate
    // resource, reported through amountRefunded on the payment. A chargeback is
    // sneakier still: the money is clawed back but payment.status STAYS 'paid'
    // and amountRefunded stays 0, only amountChargedBack moves. Checking refunds
    // alone kept a charged-back order marked paid — and the shop would print and
    // ship against money it had already lost.
    const chargedBack = Number(payment.amountChargedBack?.value ?? 0) > 0;
    // A PARTIAL refund used to flip the whole order to 'refunded' — staff saw a
    // mostly-paid order labelled refunded and held a job the customer had paid
    // for. Only a refund covering the full amount changes the status; a partial
    // one keeps 'paid' and is recorded in refundedAmount for the dashboards.
    const refundedValue = Number(payment.amountRefunded?.value ?? 0);
    const fullyRefunded = refundedValue > 0 && refundedValue >= Number(payment.amount?.value ?? 0);
    // 'unpaid' used to cover everything that was not 'paid', so an order the
    // customer cancelled and one still waiting at the bank looked identical in
    // the dashboard, and staff had no way to tell a dead order from a live one.
    // Mollie's terminal states are kept distinct; 'open' and 'pending' stay
    // 'unpaid' because they may still become paid.
    const paymentStatus = chargedBack
      ? 'chargeback'
      : fullyRefunded
        ? 'refunded'
        : status === 'paid'
          ? 'paid'
          : status === 'failed' || status === 'canceled' || status === 'expired'
            ? String(status)
            : 'unpaid';

    // WHY THIS IS NOT ONE STRAIGHT LINE
    //
    // It used to be: flip the order to 'paid', then move loyalty points, then
    // count the coupon, then send the emails — with one try/catch around the lot
    // that logged and returned 200. So if the points write failed, Mollie was
    // told "received, thank you" and never called again; the order was paid, the
    // customer was credited nothing, no confirmation went out and the shop never
    // heard about the order. Worse, each step was guarded on the ORDER's previous
    // status, which by then was already 'paid' — so even a manual replay skipped
    // every remaining step forever.
    //
    // Each side effect now records its own completion flag and is guarded on
    // that flag, so a retry resumes exactly where it stopped. If a money-related
    // step fails we answer non-2xx and let Mollie call again.

    const done = (order.sideEffects ?? {}) as Record<string, boolean>;
    // A payment that can no longer happen, on an order still holding a use of a
    // limited code (PAY-02): giving it back is outstanding until it is done.
    const holdToGiveBack =
      (paymentStatus === 'failed' || paymentStatus === 'canceled' || paymentStatus === 'expired') && order.couponHeld === true;

    // Nothing changed and everything already happened — the common case, since
    // webhooks repeat. refundedAmount is part of "changed": a NEW partial
    // refund arrives with paymentStatus still 'paid', and must be recorded.
    if (
      order.paymentStatus === paymentStatus &&
      order.molliePaymentId === paymentId &&
      (Number(order.refundedAmount) || 0) === refundedValue &&
      (paymentStatus !== 'paid' || (done.pointsApplied && done.couponCounted && done.emailsSent)) &&
      !holdToGiveBack
    ) {
      return { ok: true, reason: 'already settled' };
    }

    const wasPaid = order.paymentStatus === 'paid';
    const paidAt = status === 'paid' ? payment.paidAt ?? new Date().toISOString() : null;

    // THE AUTOMATIC STAGES BEGIN HERE, on the first confirmed payment.
    //
    // Money is the only event that may start production, so the schedule is
    // measured from paidAt and written in the same update that records it — one
    // write, and an order can never end up paid with no plan. A replayed webhook
    // (they repeat) must not re-plan a job that is already halfway through the
    // shop, so this is guarded on the order not having been paid before.
    const stageFields: Record<string, unknown> = paidAt && !wasPaid ? await stagePlanFields(db, order, paidAt) : {};

    await ref.update({
      paymentStatus,
      molliePaymentId: paymentId,
      molliePaymentStatus: status,
      // WHY IT FAILED, not just that it did — plan task 5.7b.
      //
      // Mollie has always sent this and the webhook has always dropped it, so
      // the shop could see that six payments failed and never that five of them
      // were "insufficient_funds" — which is a different problem from five
      // "invalid_card_number", and only one of the two is worth doing anything
      // about. Present only on failures, so it is written only when it is there:
      // an `undefined` is rejected by Firestore outright.
      ...((payment as any)?.details?.failureReason
        ? { mollieFailureReason: String((payment as any).details.failureReason).slice(0, 120) }
        : {}),
      ...((payment as any)?.details?.failureMessage
        ? { mollieFailureMessage: String((payment as any).details.failureMessage).slice(0, 300) }
        : {}),
      // HOW THEY ACTUALLY PAID — 'swish', 'creditcard', 'applepay', 'paypal'.
      //
      // Mollie has always told us this and the webhook has always thrown it
      // away, so every invoice, receipt and work order this shop has ever
      // printed says the constant "Card, Swish or bank (Mollie)". Bookkeeping
      // cannot reconcile a Swish payment against a line that says "or".
      // Recorded alongside the id; nothing reads it yet, and it costs one field.
      mollieMethod: typeof (payment as any).method === 'string' ? (payment as any).method : null,
      // And the human name, onto the field every printed document reads.
      // paymentMethodTitle was set at ORDER time, before anyone could know how
      // the customer would pay, so every invoice this shop has ever produced
      // says "Card, Swish or bank (Mollie)" — including the ones paid by Swish.
      ...(mollieMethodTitle(payment) ? { paymentMethodTitle: mollieMethodTitle(payment) } : {}),
      refundedAmount: refundedValue,
      paidAt,
      updatedAt: new Date().toISOString(),
      ...stageFields,
    });

    // A PAYMENT THAT CAN NO LONGER HAPPEN gives back the use of a limited code its
    // order held (PAY-02) — at once, rather than when the hold runs out. Only an
    // order that held one costs the read. Mollie calls once for an expiry, so a
    // give-back that fails asks it to call again (the check above lets the repeat
    // through until the order says it is done).
    if (holdToGiveBack) {
      if (!(await releaseCouponUse(db, order.discountCode, orderId))) {
        return { ok: false, retry: true, reason: 'the coupon hold could not be given back' };
      }
      await ref.update({ couponHeld: false });
    }

    // A REFUND MEANS A DOCUMENT, not just the money back.
    //
    // He confirmed on 2026-09-12 that he issues a kreditnota. Swedish rules do
    // not allow an issued invoice to be edited or deleted, so the refund becomes
    // a second document referencing the first. This runs on the increase, reads
    // the amount BEFORE this update as the baseline, and is a no-op on the
    // repeats — which is most webhooks.
    if (refundedValue > 0) {
      await issueCreditNoteForRefund(db, orderId, order, refundedValue, 'Refund via Mollie');
      await clawBackPointsForRefund(db, orderId, order, refundedValue);
      await reduceLifetimeSpendForRefund(db, orderId, order, refundedValue);
    }

    const failures: string[] = paymentStatus === 'paid' ? await runMoneySteps(db, ref, orderId, order, done) : [];
    if (paymentStatus === 'paid') await runConfirmedOrderSteps(db, ref, orderId, done);

    if (failures.length) {
      // Non-2xx asks Mollie to call again. The flags above mean the retry picks
      // up only what is still outstanding.
      console.error(`Order ${orderId}: asking Mollie to retry (${failures.join(', ')}).`);
      return { ok: false, retry: true, reason: failures.join(', ') };
    }

    console.log(`Order ${orderId} → ${paymentStatus} (Mollie ${status}).`);
    return { ok: true };
  } catch (err) {
    // 500, NOT 200.
    //
    // Mollie treats any 2xx as delivered and never sends the payment again. So
    // one unexpected throw in here — a Firestore read that fails, a write that
    // hits the read quota this shop has already been dark for seven hours on —
    // left a customer who really paid marked unpaid for ever: no confirmation
    // e-mail, no shipping draft, no Drive filing, and invisible to the
    // auto-stage sweep, which only looks at orders that already have a stage
    // plan. Nothing anywhere else sets a payment to paid, so there was no way
    // back and nothing to notice it by.
    //
    // Asking for a retry is safe: every side effect in the try above is
    // flag-guarded (pointsApplied / couponCounted / emailsSent / zendrDraft /
    // driveSynced) with transactional dedupe, so a redelivery resumes only what
    // is still outstanding. The deliberate early-out 200s above — a malformed
    // or unknown call, which no amount of retrying can help — are untouched.
    console.error('Mollie webhook failed:', err);
    return { ok: false, retry: true, reason: 'settlement threw' };
  }
}

/**
 * Mollie's callback. It sends only `id`, is not signed, and can arrive more than
 * once for the same payment — so this asks Mollie for the truth and is safe to
 * run repeatedly.
 */
app.post('/api/webhooks/mollie', express.urlencoded({ extended: false }), async (req, res) => {
  // Always 200: a non-2xx makes Mollie retry, and retrying will not fix a
  // malformed call. Problems are logged, not bounced back.
  // A string or nothing. The shop's JSON parser runs on this path too, and String() on
  // a crafted object ({"id":{"toString":1}}) throws — outside any try, in an async
  // handler, which ended the server process. Mollie itself only ever sends a form field.
  const paymentId = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
  if (!paymentId) {
    console.warn('Mollie webhook called with no payment id.');
    return res.status(200).send('ok');
  }

  // Only a settlement that ASKED to be retried answers non-2xx. Everything else
  // — including the deliberate early-outs above, where retrying could not
  // possibly help — is 200, exactly as it was before the settlement moved into
  // a function of its own.
  const outcome = await settlePayment(paymentId);
  if (outcome.retry) return res.status(500).send('retry');
  return res.status(200).send('ok');
});

/**
 * Lets the buyer — including a guest — see what happened to their own order after
 * being sent back from the payment page. The token is what makes it theirs.
 */
app.get('/api/orders/:orderId/status', async (req, res) => {
  try {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: 'Order lookup is unavailable.' });

    const snap = await db.collection('orders').doc(String(req.params.orderId)).get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found.' });

    const order = snap.data() as any;
    if (!req.query.t || req.query.t !== order.publicToken) {
      return res.status(403).json({ error: 'Not allowed.' });
    }

    // Reconciliation. The webhook is the only thing that ever marks an order
    // paid — so a lost webhook (or localhost, where none is registered) left a
    // customer who HAD paid staring at "payment not completed" forever. While
    // the customer polls, ask Mollie ourselves: settlePayment already fetches
    // the truth, verifies the amount, and is idempotent. Fire-and-forget with a
    // one-minute throttle; the next poll reads whatever the settlement wrote.
    //
    // IN PROCESS, not over the loopback. This used to POST to
    // `http://127.0.0.1:${PORT}/api/webhooks/mollie`, which is dead on the live
    // host: Passenger puts a socket path in PORT, the URL collapsed to port 80,
    // Apache answered 404, and a 404 resolves — so nothing settled and nothing
    // was even logged. See the comment on settlePayment.
    const sinceUpdate = Date.now() - new Date(order.updatedAt ?? order.createdAt ?? 0).getTime();
    const sinceReconcile = order.lastReconcileAt ? Date.now() - new Date(order.lastReconcileAt).getTime() : Infinity;
    if (order.paymentStatus === 'unpaid' && order.molliePaymentId && sinceUpdate > 60_000 && sinceReconcile > 60_000) {
      snap.ref.update({ lastReconcileAt: new Date().toISOString() }).catch(() => {});
      settlePayment(String(order.molliePaymentId))
        .then((outcome) => {
          if (!outcome.ok) console.warn(`Reconcile of order ${order.id} did not settle: ${outcome.reason ?? 'no reason given'}.`);
        })
        .catch((err) => console.warn(`Reconcile of order ${order.id} failed:`, err?.message));
    }

    return res.json({
      id: order.id,
      status: order.status,
      paymentStatus: order.paymentStatus,
      // Placed to pay on delivery: in production, paid when it arrives.
      payOnDelivery: order.payOnDelivery === true,
      grossTotal: order.grossTotal,
      currency: order.currency,
      customerName: order.customerName,
      createdAt: order.createdAt,
      artworkPending: order.artworkPending === true,
      // Where the parcel is, when Zendr has said. Null until a shipment has
      // been booked, which is a human pressing book in the Zendr portal.
      shipment: order.shipment
        ? {
            trackingNumber: order.shipment.trackingNumber ?? null,
            status: order.shipment.status ?? null,
            carrier: order.shipment.carrier ?? null,
            lastUpdated: order.shipment.lastUpdated ?? null,
          }
        : null,
      items: (order.items ?? []).map((i: any) => ({
        productName: i.productName,
        quantity: i.quantity,
        price: i.price,
        // So the page can offer an upload box against exactly the lines that
        // are waiting, and show the file name once one has arrived.
        artworkPending: i.artworkPending === true,
        fileName: i.fileSpecs?.fileName ?? null,
        // A studio design's first page, small (designer v2): what the customer's
        // own order page shows of it. Only an address the order already holds.
        preview: Array.isArray(i.fileSpecs?.previews) && typeof i.fileSpecs.previews[0]?.url === 'string' ? i.fileSpecs.previews[0].url : null,
        // DESIGN LATER (designer v2): what the designer needs to open on a line bought
        // as "Design online" — only while it still waits for its design.
        designLater: i.artworkPending === true ? cleanDesignLaterMarker(i.designLater) : null,
        // …and the product it is designed for: the owner's templates for it, and the
        // device's draft of it (studio:<product id>). An id, nothing more.
        productId: typeof i.productId === 'string' ? i.productId : null,
        /**
         * AND HOW BIG THE FILE HAS TO BE — 15.6.4b.
         *
         * This projection listed five keys and none of them was a size, so the
         * upload box on the GUEST order page — the screen the confirmation
         * email now sends people to, the one a customer opens days later with
         * his designer asking how big to make it — had nothing to say. The same
         * upload from My Orders showed "85 × 200 cm", because that page reads
         * the order document directly. One number, two screens, two answers.
         *
         * Resolved here rather than on the page: the browser cannot see the
         * fields it is not sent, and the endpoint is the only thing that knows
         * which of the three the line actually carries.
         */
        ...(() => {
          const positive = (...vals: unknown[]) => {
            for (const v of vals) {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) return n;
            }
            return undefined;
          };
          const w = positive(i.fileSpecs?.widthCm, i.widthCm, i.printWidthCm);
          const h = positive(i.fileSpecs?.heightCm, i.heightCm, i.printHeightCm);
          return w && h ? { widthCm: w, heightCm: h } : {};
        })(),
      })),
    });
  } catch (err) {
    console.error('Order status lookup failed:', err);
    return res.status(500).json({ error: 'Could not load that order.' });
  }
});


/**
 * The print file, arriving after the order.
 *
 * The shop has always let a customer buy before the artwork exists — a phone
 * order, a repeat job, a designer still finishing — and the confirmation email
 * asks them to reply with the file. A mailbox is not a queue: the file lands
 * next to everything else and a human has to carry it to the job.
 *
 * This is the same promise with a button behind it. The bytes never come
 * through here; the browser puts them in object storage under its own identity,
 * because the bucket rules only ever let someone write under their own uid.
 * What arrives is the resulting download URL, which is checked to be one of
 * ours before it is written onto the order.
 */
/** A design-later line on an order that is neither paid nor an open pay-on-delivery one (DSN-15). */
function designLaterUnpaid(order: any, line: any): boolean {
  if (!cleanDesignLaterMarker(line?.designLater)) return false;
  return String(order?.paymentStatus ?? '') !== 'paid' && !isOnDeliveryOpen(order);
}

app.post('/api/orders/:orderId/artwork', async (req, res) => {
  try {
    const db = getAdminDb();
    if (!db) return res.status(503).json({ error: 'Print files cannot be attached right now. Please email it to us.' });

    const ref = db.collection('orders').doc(String(req.params.orderId));
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found.' });
    const order = snap.data() as any;

    // Two ways to prove the order is yours: the token from the confirmation
    // link, or being signed in as the account it belongs to. A guest only ever
    // has the first, which is why the link carries one.
    const token = String(req.body?.t ?? req.query.t ?? '');
    const caller = await callerIdentity(req);
    const byToken = !!order.publicToken && token === order.publicToken;
    const byAccount =
      !!caller &&
      ((!!order.userId && caller.uid === order.userId) ||
        (!!order.customerAccountId && caller.uid === order.customerAccountId));
    if (!byToken && !byAccount) return res.status(403).json({ error: 'Not allowed.' });

    const status = String(order.status ?? '').toLowerCase().trim();
    if (status === 'completed' || status === 'cancelled') {
      return res.status(409).json({
        error: 'This order is closed. Please contact us and we will take the file directly.',
        // The page says it in the customer's language, by this code (DesignLater.tsx).
        code: 'closed',
      });
    }

    const items: any[] = Array.isArray(order.items) ? order.items : [];
    const index = Number(req.body?.itemIndex);
    if (!Number.isInteger(index) || index < 0 || index >= items.length) {
      return res.status(400).json({ error: 'That order line does not exist.' });
    }
    // Only the lines that are actually waiting. Replacing the file on a job
    // that already has one is a change to work in progress, and that is a
    // conversation with the shop, not a silent overwrite.
    if (items[index]?.artworkPending !== true) {
      return res.status(409).json({ error: 'That line already has its print file.', code: 'has-file' });
    }
    // A LINE BOUGHT TO BE DESIGNED LATER IS DESIGNED ONCE IT IS PAID FOR — the
    // owner's decision of 2026-10-07 ("he designs it from the order page", after
    // paying). An order that is not (an abandoned checkout, money still at the bank)
    // is not designed on, unless it is one he lets this customer pay on delivery
    // (DSN-15). The page says it in the customer's language by this code.
    if (designLaterUnpaid(order, items[index])) {
      return res.status(409).json({ error: 'This order is not paid yet. The design can be added once it is.', code: 'unpaid' });
    }

    if (!isOurStorageUrl(req.body?.fileUrl)) {
      return res.status(400).json({ error: 'That file could not be accepted. Please upload it again.' });
    }
    const fileUrl = String(req.body.fileUrl);
    // No control characters: the name goes on the plain-text order sheet, line by line.
    const fileName = String(req.body?.fileName ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200) || 'print-file';
    const fileType =
      String(req.body?.fileType ?? '').trim().slice(0, 40) ||
      (fileName.includes('.') ? fileName.split('.').pop()!.toUpperCase().slice(0, 10) : 'FILE');
    // A DESIGN MADE IN THE STUDIO (designer v2, design later) brings what the product
    // page's would have brought: a picture of every page, its pages in print order,
    // its bleed and resolution, the owner's template it started from — made safe
    // exactly as at checkout, and the template named from the shop's own copy. A
    // plain file brings none of them, and nothing of an earlier file is kept.
    const designed = sanitizeFileSpecs({ ...(req.body ?? {}), fileUrl });
    if (designed) await nameDesignTemplates([designed]);
    // …and its pages only when they are the line's own: the design-later marker the
    // server worked out from the options it priced (DSN-11). Anything else is the
    // browser's word for a page list production would print from.
    if (Array.isArray(designed?.sides)) {
      const sent = designed.sides as string[];
      const own = cleanDesignLaterMarker(items[index]?.designLater)?.sides ?? null;
      if (!own || own.join() !== sent.join()) {
        console.warn(`Order ${req.params.orderId}, line ${index + 1}: a design's pages (${sent.join(', ')}) are not the line's (${own?.join(', ') ?? 'none'}); not recorded.`);
        designed.sides = null;
        designed.pages = null;
      }
    }

    // ONE LINE AT A TIME, IN A TRANSACTION. Two lines finished close together (two
    // tabs; a design on one line and a file on another) each read the order, set
    // their own line and wrote the WHOLE items array back — the later write put the
    // earlier line back to "waiting" after the customer had been told it was done.
    // The order is read again inside, checked again, and written only if unchanged.
    const outcome = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) return { refused: 404, error: 'Order not found.' } as const;
      const order = fresh.data() as any;
      const freshStatus = String(order.status ?? '').toLowerCase().trim();
      if (freshStatus === 'completed' || freshStatus === 'cancelled') {
        return { refused: 409, error: 'This order is closed. Please contact us and we will take the file directly.', code: 'closed' } as const;
      }
      const items: any[] = Array.isArray(order.items) ? order.items : [];
      if (index >= items.length) return { refused: 400, error: 'That order line does not exist.' } as const;
      if (items[index]?.artworkPending !== true) return { refused: 409, error: 'That line already has its print file.', code: 'has-file' } as const;
      if (designLaterUnpaid(order, items[index])) return { refused: 409, error: 'This order is not paid yet. The design can be added once it is.', code: 'unpaid' } as const;
      const at = new Date().toISOString();
      const nextItems = items.map((item, i) =>
        i === index
          ? {
              ...item,
              artworkPending: false,
              artworkReceivedAt: at,
              fileSpecs: {
                ...(item.fileSpecs ?? {}),
                // A new file: whatever described another one goes.
                previews: designed?.previews ?? null,
                sides: designed?.sides ?? null,
                pages: designed?.pages ?? null,
                bleedMm: designed?.bleedMm ?? null,
                dpi: designed?.dpi ?? null,
                templateId: designed?.templateId ?? null,
                template: typeof designed?.template === 'string' ? designed.template : null,
                placeBy: null,
                pageWidthMm: null,
                pageHeightMm: null,
                fileName,
                fileUrl,
                fileType,
                /**
                 * THE SIZE THE SHOP ALREADY KNOWS — 15.6.5.
                 *
                 * This was `Number(item.fileSpecs?.widthCm) || 0`, and on a line
                 * whose file arrives AFTER payment there is no fileSpecs yet — so
                 * every one of them was recorded as 0 × 0. The customer's own
                 * order page then printed "0×0 cm" beside his file, and the
                 * preview beside it fell through `|| 28` / `|| 35` to a fabricated
                 * 28 × 35 cm.
                 *
                 * The size is not unknown. The server priced this line and wrote
                 * `widthCm`/`heightCm` onto it whenever the customer was asked for
                 * a size, and the browser sends the print size it showed him on
                 * the upload box. Both are clamped to a positive number; when
                 * there is genuinely no size the key is left off the object
                 * entirely rather than written as 0 — absent reads as "not
                 * recorded", 0 reads as a measurement, and every screen that
                 * prints this pair guards on presence.
                 */
                ...(() => {
                  const positive = (...candidates: unknown[]) => {
                    for (const c of candidates) {
                      const n = Number(c);
                      if (Number.isFinite(n) && n > 0) return n;
                    }
                    return undefined;
                  };
                  // printWidthCm included — 15.6.4b. It is what a preset-size
                  // line carries, and leaving it out of this chain meant the
                  // recorded size depended on the browser sending it back: the
                  // guest page could not, because the projection above did not
                  // send it there in the first place.
                  const w = positive(item.fileSpecs?.widthCm, item.widthCm, item.printWidthCm, req.body?.widthCm);
                  const h = positive(item.fileSpecs?.heightCm, item.heightCm, item.printHeightCm, req.body?.heightCm);
                  return w && h ? { widthCm: w, heightCm: h } : {};
                })(),
              },
            }
          : item,
      );
      const stillPending = nextItems.some((i: any) => i?.artworkPending === true);

      const update: Record<string, unknown> = {
        items: nextItems,
        artworkPending: stillPending,
        updatedAt: at,
      };
      // The sweep parks a file-less order with stageHold 'artwork_pending' and
      // CLEARS its schedule, so nothing ever looks at it again. Now that the last
      // file is here, put it back on the clock.
      //
      // RE-MEASURED FROM NOW, NOT RESTORED FROM THE OLD PLAN.
      //
      // This used to hand back `order.stagePlan` — the schedule drawn when the
      // order was PAID. An order waits on hold precisely because the customer did
      // not have their artwork yet, which is days or weeks, and by the time the
      // file lands every timestamp in that plan is in the past. The sweep reads a
      // due date that has already gone by, advances the order, finds the next one
      // also in the past, and marches the job through in_print → finishing →
      // shipped → completed inside a single hour. `deliveredAt` gets stamped, the
      // order leaves the production queue as Completed, and NOTHING WAS EVER
      // PRINTED — the customer is told their job is delivered an hour after
      // uploading the file for it.
      //
      // replanFrom is what StaffDashboard already uses when a human moves a job by
      // hand, for the same reason: the clock starts when the work can actually
      // start.
      if (!stillPending && order.stageHold === 'artwork_pending') {
        const stageSettings = await fetchAutoStageSettings(db);
        const status = String(order.status ?? 'pending');
        const speedDays = typeof order.productionDays === 'number' ? order.productionDays : null;
        let plan;
        try {
          plan = replanFrom(status, at, stageSettings, order.shippingMethod, speedDays);
        } catch {
          plan = replanFrom(status, at, stageSettings, order.shippingMethod);
        }
        update.stageHold = null;
        update.stagePlan = Object.keys(plan).length ? plan : null;
        update.nextStageAt = nextStageAtFor(status, plan);
      }
      // "Counted from the moment your artwork is approved" — the speed's own words.
      // A speed order whose LAST file came after the money is promised from the file:
      // held by the sweep or not — with the automatic stages off, nothing is ever held.
      // Only while production has not started: a job staff already moved on to print
      // (the file came by e-mail) keeps its date when the upload arrives after.
      const waitingForFile =
        order.stageHold === 'artwork_pending' || ['pending', 'in_design'].includes(String(order.status ?? 'pending').toLowerCase());
      const cleared = order.paymentStatus === 'paid' || (order.payOnDelivery === true && String(order.status ?? '') !== 'cancelled');
      if (!stillPending && cleared && waitingForFile) {
        const recount = await recountedDueDate(db, order, new Date(at));
        if (recount) {
          update.dueDate = recount;
          update.dueDateAuto = recount;
        }
      }
      tx.update(ref, update);
      return { ok: true as const, order, items, nextItems, stillPending };
    });
    if ('refused' in outcome) {
      return res.status(outcome.refused).json({ error: outcome.error, ...('code' in outcome ? { code: outcome.code } : {}) });
    }
    const { nextItems, stillPending } = outcome;
    const savedOrder = outcome.order;
    const savedItems = outcome.items;

    // The press has no reason to reopen an order until something changes, so it
    // is told. Never blocks the answer: the file is stored either way.
    void (async () => {
      try {
        const settings = await fetchSiteConfig();
        const shopName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';
        const base = (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');
        const orderUrl = `${base}/order/${savedOrder.id}?t=${savedOrder.publicToken}`;
        await sendArtworkNotification(
          { ...savedOrder, items: nextItems, artworkPending: stillPending },
          shopName,
          [{ productName: savedItems[index]?.productName ?? 'item', fileName, fileUrl }],
          orderUrl,
          settings.logoUrl,
        );
      } catch (err) {
        console.error(`Order ${savedOrder.id}: the artwork notification did not go out.`, err);
      }
    })();

    console.log(`Order ${savedOrder.id}: print file received for line ${index} (${fileName}).`);
    return res.json({ ok: true, artworkPending: stillPending, fileName });
  } catch (err) {
    console.error('Attaching a print file failed:', err);
    return res.status(500).json({ error: 'The file could not be attached. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// Staff accounts.
//
// Creating a user in the dashboard used to write a Firestore profile under an
// invented id — `usr_` + a timestamp — with no Firebase Auth account behind it.
// The password field was decorative: the person could never sign in, and the
// document did not correspond to any real identity. Only the Admin SDK can create
// an auth account, so it happens here.
// ---------------------------------------------------------------------------

// Human labels for the stored method ids, beside the order writer so a new
// shipping option cannot be added without a label to print.
const SHIPPING_TITLES: Record<string, string> = {
  standard: 'Standard delivery (DHL / DSV / UPS)',
  express: 'Express delivery (DHL / DSV / UPS)',
  pickup: 'Pick up at the print shop',
  // Retired 2026-08-30. Orders placed before it still carry these ids.
  dsv_zone: 'Zone based shipping (DSV / Schenker)',
  dsv_weekday: 'Weekday delivery within Sweden',
};
// Mollie is the only payment provider connected to this shop. The checkout page
// used to offer "Stripe Checkout" and "Billogram (Invoice)" as well; both went
// to Mollie and charged the card immediately, and the order was then filed under
// the name of a provider that had never been used. The old ids are kept only so
// that orders already in the database still print something truthful.
const PAYMENT_TITLES: Record<string, string> = {
  mollie: 'Card, Swish or bank (Mollie)',
  // Placed by a customer the owner lets pay on delivery (placeOnDelivery).
  on_delivery: 'Pay on delivery',
  swish: 'Card, Swish or bank (Mollie)',
  stripe: 'Card, Swish or bank (Mollie)',
  billogram: 'Card, Swish or bank (Mollie)',
};

/**
 * How the customer ACTUALLY paid, for the invoice.
 *
 * Mollie names the method on the payment; the webhook has always had this and
 * has always thrown it away. Only a method we can name is used — an unknown id
 * leaves the order's existing title alone rather than printing a raw slug like
 * "bancontact" on a Swedish invoice.
 */
const MOLLIE_METHOD_NAMES: Record<string, string> = {
  creditcard: 'Card (Mollie)',
  swish: 'Swish (Mollie)',
  applepay: 'Apple Pay (Mollie)',
  googlepay: 'Google Pay (Mollie)',
  paypal: 'PayPal (Mollie)',
  klarna: 'Klarna (Mollie)',
  billie: 'Invoice — Billie (Mollie)',
  banktransfer: 'Bank transfer (Mollie)',
  ideal: 'iDEAL (Mollie)',
};
function mollieMethodTitle(payment: any): string | null {
  const id = typeof payment?.method === 'string' ? payment.method : '';
  return MOLLIE_METHOD_NAMES[id] ?? null;
}

const STAFF_ROLES = ['admin', 'staff', 'production', 'client'];

// ---------------------------------------------------------------------------
// GOOGLE DRIVE — the customer's artwork and their order, in the owner's Drive.
//
// The owner asked not to have to press Download. So every paid order pushes
// itself: a folder named for the order, the artwork the customer uploaded, and
// a readable sheet of everything they chose — size, material, finishing,
// quantity, address, totals — plus the same thing as JSON.
//
// Nothing here throws into a caller. A Drive outage must never cost an order.
// ---------------------------------------------------------------------------

async function googleCreds(): Promise<GoogleCreds | null> {
  const stored = (await loadIntegrationSecrets()).google;
  if (!stored?.clientId || !stored?.clientSecret || !stored?.refreshToken) return null;
  return stored;
}

/** Fetch the customer's artwork bytes, whatever shape they were stored in. */
async function artworkBytes(spec: any): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
  const name = String(spec?.fileName ?? 'artwork');
  const url = String(spec?.fileUrl ?? '');
  if (!url) return null;

  // The design editor and the upload fallback store a data: URL inside the
  // order rather than a Storage link.
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const mime = url.slice(5, url.indexOf(';')) || 'application/octet-stream';
    return { name, mime, bytes: Buffer.from(url.slice(comma + 1), 'base64') };
  }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Could not fetch the artwork (${resp.status})`);
  const size = Number(resp.headers.get('content-length') ?? 0);
  if (size > MAX_DRIVE_BYTES) {
    throw new Error(`The artwork is ${(size / 1048576).toFixed(0)} MB — larger than this relay handles.`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > MAX_DRIVE_BYTES) throw new Error('The artwork is larger than this relay handles.');
  return { name, mime: resp.headers.get('content-type') ?? 'application/octet-stream', bytes: buf };
}

type DriveOutcome = { ok: boolean; reason?: string; folderUrl?: string; files?: number };

async function pushOrderToDrive(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  order: any,
): Promise<DriveOutcome> {
  const creds = await googleCreds();
  if (!creds) return { ok: false, reason: 'Google Drive is not connected.' };

  const at = new Date().toISOString();
  try {
    const token = await getAccessToken(creds);
    // The connect step makes this folder, but that call can fail — the Drive API
    // may still be propagating minutes after it was switched on. When it does,
    // the id was found again on every single push and never written down, so the
    // dashboard's "Open the orders folder" button stayed missing for good.
    let rootId = creds.rootFolderId;
    if (!rootId) {
      rootId = await ensureFolder(token, 'ReklamX Orders');
      await db.collection('secrets').doc('integrations')
        .set({ google: { ...creds, rootFolderId: rootId } }, { merge: true })
        .catch((err: any) => console.warn('Filed the order but could not remember the folder id:', err));
      await loadIntegrationSecrets(true);
    }
    const folderId = await ensureFolder(token, orderFolderName(order), rootId);

    let files = 0;
    // The readable sheet first: it is the thing the owner opens.
    await driveUpload(token, folderId, `order-${order.id}.txt`, 'text/plain; charset=utf-8',
      Buffer.from(orderSheetText(order), 'utf8'));
    files += 1;
    await driveUpload(token, folderId, `order-${order.id}.json`, 'application/json',
      Buffer.from(JSON.stringify(order, null, 2), 'utf8'));
    files += 1;

    const problems: string[] = [];
    const items: any[] = Array.isArray(order.items) ? order.items : [];
    for (let i = 0; i < items.length; i += 1) {
      const spec = items[i]?.fileSpecs;
      if (!spec?.fileUrl) continue;
      try {
        const art = await artworkBytes(spec);
        if (!art) continue;
        // Numbered, so three files from three lines never collide and the
        // order of the lines survives in the folder listing.
        await driveUpload(token, folderId, `${String(i + 1).padStart(2, '0')}-${art.name}`, art.mime, art.bytes);
        files += 1;
      } catch (err: any) {
        problems.push(`line ${i + 1}: ${String(err?.message ?? err).slice(0, 120)}`);
      }
    }

    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    await db.collection('orders').doc(orderId).update({
      drive: {
        folderId,
        folderUrl,
        files,
        syncedAt: at,
        error: problems.length ? problems.join(' · ').slice(0, 300) : null,
      },
      updatedAt: at,
    });
    return { ok: true, folderUrl, files, reason: problems.length ? problems.join(' · ') : undefined };
  } catch (err: any) {
    const reason = String(err?.message ?? err).slice(0, 300);
    console.error(`Order ${orderId}: Drive push failed — ${reason}`);
    await db.collection('orders').doc(orderId)
      .update({ 'drive.error': reason, 'drive.failedAt': at, updatedAt: at })
      .catch(() => {});
    return { ok: false, reason };
  }
}

// ---------------------------------------------------------------------------
// ZENDR — the shipping platform.
//
// A paid order that is being delivered is pushed into Zendr as a DRAFT: both
// addresses, the parcel and our order number, ready for a human to open in the
// portal and book. Zendr's API cannot book and cannot price (see src/lib/zendr.ts),
// so this is the whole of what can be automated — and it is the part that was
// being retyped by hand.
//
// Nothing here may ever throw into a caller. An order that is paid but whose
// draft failed is a shipping label to make by hand; an order whose PAYMENT
// handling was aborted by a shipping outage is money in limbo.
// ---------------------------------------------------------------------------

type ZendrOutcome = { ok: boolean; reason?: string; importedOrderId?: number };

async function createZendrDraftFor(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  order: any,
): Promise<ZendrOutcome> {
  if (!zendrConfigured()) return { ok: false, reason: 'Zendr is not configured (ZENDR_API_KEY).' };
  if (!orderShips(order)) return { ok: false, reason: 'This order is collected, not shipped.' };

  const sender = senderFromEnv();
  if (!sender) {
    return {
      ok: false,
      reason: 'The shop’s own pickup address is not configured (ZENDR_SENDER_ADDRESS1 / _POSTAL_CODE / _POSTAL_TOWN).',
    };
  }

  const at = new Date().toISOString();
  try {
    const created = await createOrderDrafts([draftFromOrder(order, sender)]);
    // The endpoint returns only the drafts it accepted, so a 200 with an empty
    // array is a failure wearing a success's clothes.
    const draft = created[0];
    if (!draft) throw new Error('Zendr accepted the request but created no draft.');

    await db.collection('orders').doc(orderId).update({
      zendr: {
        importedOrderId: draft.importedOrderId,
        portalUrl: zendrPortalUrl(draft.importedOrderId),
        createdAt: at,
        error: null,
      },
      // Flat, because the tracking sweep queries on it and a query wants a
      // top-level field.
      zendrDrafted: true,
      shipmentOpen: true,
      updatedAt: at,
    });
    return { ok: true, importedOrderId: draft.importedOrderId };
  } catch (err: any) {
    const reason = String(err?.message ?? err).slice(0, 300);
    console.error(`Order ${orderId}: Zendr draft failed — ${reason}`);
    await db
      .collection('orders')
      .doc(orderId)
      .update({ 'zendr.error': reason, 'zendr.failedAt': at, updatedAt: at })
      .catch(() => {});
    return { ok: false, reason };
  }
}

/**
 * Write what Zendr says about a shipment onto the order.
 *
 * `shipmentOpen` is cleared once the parcel is delivered, rejected or cancelled,
 * which is what keeps a finished order out of every later sweep — the read quota
 * on this project's free plan has blacked the shop out once already.
 */
async function applyTracking(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  tracking: any,
): Promise<void> {
  const at = new Date().toISOString();
  await db.collection('orders').doc(orderId).update({
    shipment: {
      trackingNumber: tracking?.trackingNumber ?? null,
      status: tracking?.status ?? null,
      carrier: tracking?.carrier ?? null,
      pickupDate: tracking?.pickupDate ?? null,
      lastUpdated: tracking?.lastUpdated ?? null,
      checkedAt: at,
    },
    shipmentOpen: !trackingIsFinal(tracking?.status),
    updatedAt: at,
  });
}

/** One pass over the shipments that have not arrived yet. */
async function sweepZendrTracking(): Promise<{ checked: number; updated: number; reason?: string }> {
  if (!zendrConfigured()) return { checked: 0, updated: 0, reason: 'not-configured' };
  const db = getAdminDb();
  if (!db) return { checked: 0, updated: 0, reason: 'no-database' };

  try {
    const open = await db.collection('orders').where('shipmentOpen', '==', true).limit(50).get();
    if (open.empty) return { checked: 0, updated: 0 };

    const ids = open.docs.map((d) => String(d.data().id ?? d.id));
    // One call for the lot — asking per order would be fifty round trips.
    const rows = await fetchTrackingBatch(ids);
    const byId = new Map(rows.map((r) => [String(r.orderId), r]));

    let updated = 0;
    for (const doc of open.docs) {
      const order = doc.data() as any;
      const row = byId.get(String(order.id ?? doc.id));
      if (!row) continue;
      const current = order.shipment ?? {};
      // Only write when something actually moved: a write costs quota and an
      // unchanged status is the common case.
      if (current.status === row.status && current.trackingNumber === (row.trackingNumber ?? null)) continue;
      await applyTracking(db, doc.id, row);
      updated += 1;
    }
    return { checked: open.size, updated };
  } catch (err: any) {
    console.error('Zendr tracking sweep failed:', err?.message ?? err);
    return { checked: 0, updated: 0, reason: 'failed' };
  }
}

/** Confirms the caller is a signed-in admin, from their ID token. */
// The role answers requireAdmin has read (src/lib/adminRoleCache.ts) — reused only
// by callers that ask, i.e. the supplier picker's read-only catalogue.
const adminRoles = roleCache({ freshMs: 60 * 1000, staleMs: 24 * 60 * 60 * 1000, max: 200 });
const ADMIN_ROLES_COPY = 'admin-roles';
const adminRolesWrittenAt = new Map<string, number>();

/** The disk copy of admins' last positive answers: their emails are in it, so only this process may read it. */
function writeAdminRoles(items: Array<RoleAnswer & { uid: string }>): void {
  try {
    fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    const target = path.join(DISK_CACHE_DIR, `${ADMIN_ROLES_COPY}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), items }), { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch { /* no disk: a fresh worker in an outage then has no answer, and refuses */ }
}

/** The last positive answers, on disk: a fresh worker during a read outage has no memory of its own. */
function diskAdminRole(uid: string): RoleAnswer | null {
  const copy = readDiskCache<RoleAnswer & { uid: string }>(ADMIN_ROLES_COPY);
  const hit = copy?.items.find((r) => r?.uid === uid);
  return hit && hit.admin === true && hit.suspended !== true && Date.now() - Number(hit.at) < 24 * 60 * 60 * 1000 ? hit : null;
}

function rememberAdminRole(uid: string, answer: RoleAnswer): void {
  adminRoles.remember(uid, answer);
  const others = () => (readDiskCache<RoleAnswer & { uid: string }>(ADMIN_ROLES_COPY)?.items ?? []).filter((r) => r?.uid !== uid);
  if (!answer.admin || answer.suspended) {
    // A "no" — demoted or suspended: OUT of the disk copy at once, or a refused
    // read later would let him back in on the old "yes".
    if (diskAdminRole(uid)) writeAdminRoles(others());
    return;
  }
  // A "yes": written at most every ten minutes per person, per worker.
  if (Date.now() - (adminRolesWrittenAt.get(uid) ?? 0) < 10 * 60 * 1000) return;
  adminRolesWrittenAt.set(uid, Date.now());
  writeAdminRoles([...others().slice(-49), { uid, ...answer }]);
}

async function requireAdmin(req: express.Request, { staleOk = false }: { staleOk?: boolean } = {}) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw Object.assign(new Error('Not signed in.'), { status: 401 });

  const db = getAdminDb();
  if (!db) throw Object.assign(new Error('Server is not configured.'), { status: 503 });

  const auth = await getAdminAuth();
  if (!auth) throw Object.assign(new Error('Server is not configured.'), { status: 503 });
  const decoded = await auth.verifyIdToken(token).catch(() => null);
  if (!decoded) throw Object.assign(new Error('Session expired. Please sign in again.'), { status: 401 });

  const judge = (answer: RoleAnswer) => {
    if (!answer.admin) throw Object.assign(new Error('Administrators only.'), { status: 403 });
    // A suspended administrator is still an administrator to this check otherwise.
    if (answer.suspended) throw Object.assign(new Error('This account is suspended.'), { status: 403 });
    // The email as well: the coupon audit log records a person, and a uid is not
    // one to anybody reading it later.
    return { db, uid: decoded.uid, email: decoded.email ?? answer.email ?? null };
  };

  // Only a caller that asks (a read-only screen) reuses an answer from the last minute.
  const recent = staleOk ? adminRoles.fresh(decoded.uid, Date.now()) : null;
  if (recent) return judge(recent);

  let snap: FirebaseFirestore.DocumentSnapshot;
  try {
    snap = await db.collection('users').doc(decoded.uid).get();
  } catch (err) {
    // THE READ WAS REFUSED (the daily quota): such a caller may go on the last
    // answer that let this person in, from memory or from disk, up to a day old.
    if (staleOk && isReadRefusal(err)) {
      // This worker's own answer decides when it has one — a "no" it saw must not
      // be overruled by an older "yes" on disk; the disk only when it has none.
      const last = adminRoles.has(decoded.uid) ? adminRoles.stale(decoded.uid, Date.now()) : diskAdminRole(decoded.uid);
      if (last) return judge(last);
    }
    throw err;
  }
  const data = snap.exists ? snap.data() : null;
  const answer: RoleAnswer = {
    admin: data?.role === 'admin',
    suspended: data?.status === 'suspended',
    email: data?.email ?? null,
    at: Date.now(),
  };
  rememberAdminRole(decoded.uid, answer);
  return judge(answer);
}

/**
 * "I saved it, why does the page still say the old thing?"
 *
 * The head, robots.txt, the sitemap and the feed are all built from two caches
 * that hold for ten minutes — deliberately, because the alternative is a
 * Firestore read on every crawler hit and this shop has already been dark for
 * seven hours over the free-tier quota. Ten minutes is nothing to a crawler and
 * an eternity to someone checking his own change, so the dashboard drops both
 * caches the moment he presses Save and the next request rebuilds from Firestore.
 *
 * Admin-only: it is a free cache flush, and an open one is a free way to make
 * every request pay for a Firestore read.
 */
app.post('/api/admin/seo/refresh', async (req, res) => {
  try {
    await requireAdmin(req);
    invalidateSeoConfig();
    invalidateCatalogue();
    const origin = originFrom(req as never);
    return res.json({
      ok: true,
      robots: `${origin}/robots.txt`,
      sitemap: `${origin}/sitemap.xml`,
      feed: `${origin}/feed.xml`,
    });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Could not refresh.' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    const { db, uid: callerUid } = await requireAdmin(req);
    const { email, displayName, password, role, ...profile } = req.body ?? {};

    if (!email || !displayName) return res.status(400).json({ error: 'A name and email address are required.' });
    if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role.' });

    const auth = await getAdminAuth();
    if (!auth) return res.status(503).json({ error: 'Server is not configured.' });
    const cleanEmail = String(email).toLowerCase().trim();
    const now = new Date().toISOString();
    const status = profile?.status === 'suspended' ? 'suspended' : 'active';
    const permissions =
      profile?.permissions && typeof profile.permissions === 'object' && !Array.isArray(profile.permissions)
        ? profile.permissions
        : null;

    // AN ADDRESS THAT ALREADY HAS AN ACCOUNT — the admin is usually giving a role
    // to an existing customer — CHANGES ONLY THE ROLE, THE PERMISSIONS AND THE
    // STATUS. This used to set the password the form had typed (a customer's own
    // replaced; a Google-only account given one) and write the whole form over
    // the profile: loyalty points to 0 (spendable at the next checkout, while the
    // ledger said otherwise), company and VAT number blanked, createdAt reset.
    const existing = await auth.getUserByEmail(cleanEmail).catch(() => null);
    if (existing) {
      // The DELETE route's rule: locking yourself out is not a recoverable mistake.
      if (existing.uid === callerUid) {
        return res.status(400).json({ error: 'You cannot change your own account here.' });
      }
      // Storage rules read this claim; a Firestore role alone would not let an
      // admin upload.
      if (role === 'admin') {
        await auth.setCustomUserClaims(existing.uid, { ...(existing.customClaims ?? {}), admin: true });
      }
      const ref = db.collection('users').doc(existing.uid);
      const before = await ref.get();
      const patch = {
        role,
        permissions,
        status,
        updatedAt: now,
        // A sign-in that never made a profile gets one with who it is — from the
        // account itself, not the form.
        ...(before.exists
          ? {}
          : { uid: existing.uid, email: cleanEmail, displayName: existing.displayName || String(displayName), createdAt: now }),
      };
      await ref.set(patch, { merge: true });
      return res.json({ uid: existing.uid, user: { ...(before.data() ?? {}), ...patch, uid: existing.uid }, existed: true });
    }

    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'Set a password of at least 8 characters so this person can sign in.' });
    }
    const user = await auth.createUser({ email: cleanEmail, displayName, password: String(password), emailVerified: false });

    // Storage rules read this claim; a Firestore role alone would not let an
    // admin upload.
    if (role === 'admin') {
      await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: true });
    }

    const doc = {
      ...profile,
      uid: user.uid,
      email: cleanEmail,
      displayName,
      role,
      permissions,
      status,
      createdAt: now,
      updatedAt: now,
    };
    // The password is never stored — it lives in Firebase Auth.
    delete (doc as any).password;

    await db.collection('users').doc(user.uid).set(doc, { merge: true });
    return res.json({ uid: user.uid, user: doc, existed: false });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Staff account creation failed:', err);
    return res.status(500).json({ error: 'Could not create that account.' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:uid — remove someone properly.
//
// The dashboard deleted the Firestore profile and stopped there. The Firebase
// Auth account survived, so the "deleted" person could still sign in; the app
// then found no profile and created a fresh one with the default customer role.
// A dismissed member of staff therefore reappeared in the user list after their
// next login. The auth account is the identity, and only the Admin SDK can
// remove it.
// ---------------------------------------------------------------------------
app.delete('/api/admin/users/:uid', async (req, res) => {
  try {
    const { db, uid: callerUid } = await requireAdmin(req);
    const target = String(req.params.uid ?? '').trim();
    if (!target) return res.status(400).json({ error: 'Which user?' });

    // Locking yourself out of your own shop is not a recoverable mistake.
    if (target === callerUid) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    // A shop with zero admins cannot appoint a new one from inside the app.
    const targetDoc = await db.collection('users').doc(target).get();
    if (targetDoc.exists && targetDoc.data()?.role === 'admin') {
      const admins = await db.collection('users').where('role', '==', 'admin').limit(2).get();
      if (!admins.docs.some((d) => d.id !== target)) {
        return res.status(400).json({ error: 'The last remaining admin cannot be deleted.' });
      }
    }

    const adminAuth = await getAdminAuth();
    if (!adminAuth) return res.status(503).json({ error: 'Server is not configured.' });
    // Auth first: if this fails we have deleted nothing, rather than having
    // deleted the profile and left a working login behind.
    await adminAuth
      .deleteUser(target)
      .catch((err: any) => {
        // Already gone is the outcome we want; anything else is a real failure.
        if (err?.code !== 'auth/user-not-found') throw err;
      });

    await db.collection('users').doc(target).delete();

    // Orders are kept. Swedish bookkeeping law (bokföringslagen) requires the
    // records for seven years, and an order with no customer row still prints.
    return res.json({ deleted: target });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Deleting the user failed:', err);
    return res.status(500).json({ error: 'That account could not be deleted.' });
  }
});

/**
 * Create an order WITHOUT taking payment. Administrators only.
 *
 * The shop itself never calls this: the checkout goes to /api/checkout/pay,
 * which creates the order and the Mollie payment together (CheckoutPage.tsx:515
 * is the only caller of either). This route was left open to the internet, and
 * on a public domain that is a stranger writing real, fully-priced orders
 * straight into Firestore at the rate limiter's 120 a minute — arriving in the
 * production queue as unpaid jobs indistinguishable from abandoned real ones,
 * and burning the Firestore quota that has already taken this shop offline once.
 *
 * It is kept rather than deleted because taking an order over the phone and
 * invoicing it later is a real thing a print shop does — but only the shop may
 * do it.
 */
// ---------------------------------------------------------------------------
// GOOGLE — connecting the shop to the owner's own Google account.
//
// He pastes the OAuth client his Google Cloud project gives him, presses
// Connect, approves on Google's own screen, and the refresh token that comes
// back is stored server-side. Nothing about his Google password ever reaches
// the shop, and the scope asked for (drive.file) can only see files this app
// itself creates.
// ---------------------------------------------------------------------------

/** One-time states for the consent round trip, so a stray callback is refused. */
const googleStates = new Map<string, { uid: string; at: number }>();

function googleRedirectUri(): string {
  const base = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  return `${base}/api/google/callback`;
}

app.get('/api/admin/google', async (req, res) => {
  try {
    await requireAdmin(req);
    const g = (await loadIntegrationSecrets(true)).google ?? {};
    const connected = !!(g.clientId && g.clientSecret && g.refreshToken);
    // A STORED TOKEN IS NOT A WORKING ONE. Drive is a tick-box on Google's
    // consent screen, and a token minted without it is valid, refreshable, and
    // completely unable to touch Drive. Reporting `connected` off the token
    // alone is how this panel came to show a healthy green badge for a
    // connection that could not file anything.
    const health = connected ? await verifyDrive(g) : { ok: false, reason: 'Not connected.' };
    return res.json({
      hasClient: !!(g.clientId && g.clientSecret),
      connected,
      healthy: health.ok,
      healthReason: health.ok ? null : health.reason ?? null,
      account: g.account ?? null,
      connectedAt: g.connectedAt ?? null,
      clientIdTail: g.clientId ? g.clientId.slice(0, 12) + '…' : null,
      redirectUri: googleRedirectUri(),
      driveFolder: g.rootFolderId
        ? `https://drive.google.com/drive/folders/${g.rootFolderId}`
        : null,
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Could not load the Google status.' });
  }
});

/** Save the OAuth client the owner created in Google Cloud Console. */
app.post('/api/admin/google', async (req, res) => {
  try {
    const { db, uid } = await requireAdmin(req);
    const clientId = String(req.body?.clientId ?? '').trim();
    const clientSecret = String(req.body?.clientSecret ?? '').trim();
    if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
      return res.status(400).json({ error: 'That does not look like a Google client ID (it ends in .apps.googleusercontent.com).' });
    }
    if (clientSecret.length < 10) return res.status(400).json({ error: 'The client secret looks too short.' });

    const who = (await getAdminAuth())?.getUser(uid).then((u) => u.email ?? uid).catch(() => uid);
    // Changing the client invalidates any token minted by the old one.
    await db.collection('secrets').doc('integrations').set(
      { google: { clientId, clientSecret, refreshToken: null, account: null, connectedAt: null, updatedBy: await who } },
      { merge: true },
    );
    resetDriveToken();
    await loadIntegrationSecrets(true);
    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Saving the Google client failed:', err);
    return res.status(500).json({ error: 'Could not save the Google client.' });
  }
});

/** Hand the panel the consent URL to send the owner to. */
app.post('/api/admin/google/connect', async (req, res) => {
  try {
    const { uid } = await requireAdmin(req);
    const g = (await loadIntegrationSecrets(true)).google ?? {};
    if (!g.clientId || !g.clientSecret) {
      return res.status(400).json({ error: 'Save the OAuth client ID and secret first.' });
    }
    if (!(process.env.PUBLIC_URL ?? '').trim()) {
      return res.status(400).json({ error: 'PUBLIC_URL is not set on this server, so the redirect address cannot be built.' });
    }
    const state = crypto.randomUUID();
    googleStates.set(state, { uid, at: Date.now() });
    // Ten minutes is longer than any consent screen takes and short enough
    // that an abandoned attempt does not linger.
    for (const [k, v] of googleStates) if (Date.now() - v.at > 600_000) googleStates.delete(k);
    return res.json({ url: buildConsentUrl(g.clientId, googleRedirectUri(), state) });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Could not start the Google connection.' });
  }
});

/**
 * Where Google sends the owner back. Public by necessity — Google calls it in
 * the owner's browser — so the `state` we issued is what makes it ours.
 */
app.get('/api/google/callback', async (req, res) => {
  // ESCAPED, both of them.
  //
  // `body` carried `req.query.error` straight out of the URL on the branch
  // below, and that branch runs BEFORE the state check — so no session, no
  // sign-in and no valid state were needed. Anyone who could get the owner to
  // click a link ran their own script on shop.reklamx.se: the origin that holds
  // his admin Firebase token in IndexedDB and the origin checkout runs on.
  // There is no CSP behind this to soften it. `title` is a literal at every
  // call site today; it is escaped anyway, because the next person to add a
  // call site will not check.
  const done = (title: string, body: string, ok: boolean) =>
    res.status(ok ? 200 : 400).type('html').send(
      `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>` +
      `<div style="font-family:system-ui;max-width:34rem;margin:14vh auto;padding:0 1.5rem;text-align:center">` +
      `<div style="font-size:3rem">${ok ? '✅' : '⚠️'}</div>` +
      `<h1 style="font-size:1.4rem;margin:.6rem 0">${esc(title)}</h1>` +
      `<p style="color:#4b5563;line-height:1.6">${esc(body)}</p>` +
      `<p style="color:#9ca3af;font-size:.85rem;margin-top:2rem">You can close this tab and go back to the dashboard.</p></div>`,
    );
  try {
    const state = String(req.query.state ?? '');
    const code = String(req.query.code ?? '');
    if (req.query.error) return done('Google was not connected', `Google said: ${String(req.query.error).slice(0, 200)}`, false);
    if (!state || !googleStates.has(state)) {
      return done('That link has expired', 'Start the connection again from the dashboard.', false);
    }
    googleStates.delete(state);
    if (!code) return done('Google was not connected', 'No authorisation code came back.', false);

    const db = getAdminDb();
    if (!db) return done('Not connected', 'The server is not configured.', false);
    const g = (await loadIntegrationSecrets(true)).google ?? {};
    if (!g.clientId || !g.clientSecret) return done('Not connected', 'The OAuth client is missing.', false);

    const { refreshToken, accessToken, email, scope } = await exchangeCode(
      g.clientId, g.clientSecret, code, googleRedirectUri(),
    );

    // A TOKEN WITHOUT THE DRIVE BOX TICKED IS NOT A CONNECTION.
    //
    // Drive is a granular permission on Google's screen: a tick-box next to the
    // app name that "Continue" alone does not tick. Google answers with a valid
    // refresh token either way, and this used to store it and report success —
    // so the dashboard showed CONNECTED, the orders folder silently failed to be
    // created, and every paid order afterwards would have failed to file with
    // nobody told. Refuse it here, and say exactly which box to tick.
    if (!grantsDrive(scope)) {
      return done(
        'Google Drive was not connected',
        'The Drive permission was not granted. On Google\u2019s screen, tick the box that says ' +
        '\u201cSee, edit, create and delete only the specific Google Drive files you use with this app\u201d ' +
        'before pressing Continue, then start the connection again from the dashboard.',
        false,
      );
    }
    // Make the destination folder now, so the first order does not have to.
    let rootFolderId: string | undefined;
    try {
      rootFolderId = await ensureFolder(accessToken, 'ReklamX Orders');
    } catch (err) {
      console.warn('Connected to Google but could not create the orders folder yet:', err);
    }

    await db.collection('secrets').doc('integrations').set(
      { google: { ...g, refreshToken, account: email ?? null, rootFolderId: rootFolderId ?? null, connectedAt: new Date().toISOString() } },
      { merge: true },
    );
    resetDriveToken();
    await loadIntegrationSecrets(true);
    console.log(`Google Drive connected${email ? ` as ${email}` : ''}.`);
    return done(
      'Google Drive is connected',
      `Orders will now be filed automatically${email ? ` in ${email}'s Drive` : ''}, under the folder “ReklamX Orders”.`,
      true,
    );
  } catch (err: any) {
    console.error('Google callback failed:', err);
    return done('Google was not connected', String(err?.message ?? err).slice(0, 200), false);
  }
});

/** Disconnect — the token is dropped; the OAuth client stays for re-connecting. */
app.post('/api/admin/google/disconnect', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const g = (await loadIntegrationSecrets(true)).google ?? {};
    await db.collection('secrets').doc('integrations').set(
      { google: { ...g, refreshToken: null, account: null, connectedAt: null } }, { merge: true },
    );
    resetDriveToken();
    await loadIntegrationSecrets(true);
    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Could not disconnect.' });
  }
});

/** Push one order to Drive by hand — for a retry, or an order from before. */
app.post('/api/admin/orders/:orderId/drive', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const orderId = String(req.params.orderId);
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found.' });
    const outcome = await pushOrderToDrive(db, orderId, { id: orderId, ...(snap.data() as any) });
    if (!outcome.ok) return res.status(502).json({ error: outcome.reason });
    return res.json(outcome);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Manual Drive push failed:', err);
    return res.status(500).json({ error: 'Could not send this order to Drive.' });
  }
});

/**
 * A message from the contact form.
 *
 * The browser used to write straight into Firestore and that was the end of
 * it: nothing in the back office read that collection, so a real enquiry —
 * there is one from 2026-08-31 — sat unseen. It comes through here now so the
 * shop is actually told, and so the message is validated and rate-limited
 * before anything is stored.
 */
app.post('/api/contact', rateLimit, async (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim().slice(0, 120);
    const email = String(req.body?.email ?? '').trim().slice(0, 160);
    const phone = String(req.body?.phone ?? '').trim().slice(0, 60);
    const subject = String(req.body?.subject ?? '').trim().slice(0, 160);
    const message = String(req.body?.message ?? '').trim().slice(0, 5000);

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, e-mail and message are required.' });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'That e-mail address does not look right.' });
    }

    const db = getAdminDb();
    const inquiry = { name, email, phone, subject, message };
    let stored = false;
    if (db) {
      await db.collection('contact_inquiries').add({
        ...inquiry,
        userId: 'guest',
        createdAt: new Date().toISOString(),
        status: 'new',
        source: 'website',
      });
      stored = true;
    }

    // The e-mail is what actually reaches a human. A failure here is reported
    // but does not fail the request — the message is already saved, and telling
    // the sender "it did not go through" when it did is worse than a silent
    // retry by the shop.
    const settings = await fetchSiteConfig();
    const shopName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';
    const mail = await sendInquiryNotification(inquiry, shopName, settings.logoUrl);
    if (!mail.sent) console.error(`Contact enquiry from ${email}: no e-mail went out (${mail.reason}).`);

    return res.json({ ok: true, stored, notified: mail.sent });
  } catch (err) {
    console.error('Contact enquiry failed:', err);
    return res.status(500).json({ error: 'The message could not be sent. Please e-mail us directly.' });
  }
});

/** The enquiries themselves, for the back office. */
// ---------------------------------------------------------------------------
// REPORTS. Sales, products and invoices, as finished aggregates.
//
// The dashboard could read the orders collection itself — the rules let an admin
// do it — but that is the wrong trade twice over. One billed Firestore read per
// order document, on a project whose free read quota has already taken this shop
// dark for seven hours; and order documents carry fileSpecs and can run to
// hundreds of KB each, so a year of sales would be megabytes crossing the wire
// to draw a line chart. This returns numbers.
//
// WHICH MONEY FIELD. `totalAmount` and `grossTotal` are the same figure, both
// INCLUDING VAT; `netTotal` is ex-VAT including shipping; `goodsNet` excludes
// shipping too. Swedish "omsättning" is ex-VAT, so both are returned and the
// screen labels them — rather than one ambiguous "revenue" the owner has to
// guess at.
//
// WHAT COUNTS. Paid, live-mode, minus refunds. A PARTIAL refund leaves
// paymentStatus at 'paid' and moves only refundedAmount, so filtering on status
// alone overstates income; and every order in this database at the time of
// writing was paymentMode 'test'.
// ---------------------------------------------------------------------------

type ReportsPayload = Record<string, any>;
/**
 * A FEW SLOTS, not one.
 *
 * The reports screen asks TWO questions on every load — this period and the one
 * before it, for the "vs previous 30 days" figures — and fires them together.
 * Against a single slot they evicted each other every single time, so the cache
 * never once hit and each load walked the orders collection twice. The overview
 * tab then asks a third, all-time question and evicts whatever survived.
 *
 * Bounded so it cannot grow without limit: a handful of ranges is all any
 * dashboard asks for, and the oldest entry is dropped past the cap.
 */
const reportsCache = new Map<string, { at: number; data: ReportsPayload }>();
const reportsInflight = new Map<string, Promise<ReportsPayload>>();
const REPORTS_CACHE_MS = 5 * 60 * 1000;
const REPORTS_CACHE_MAX = 12;

/** Dropped by the refresh button, so "I just marked it paid" is answerable. */
function invalidateReports(): void {
  reportsCache.clear();
}

/** YYYY-MM-DD in UTC. Orders store ISO-8601 with a Z, so UTC keeps buckets stable. */
/**
 * The DAY an order belongs to, in the shop's own time — plan task 5.1.
 *
 * This was `String(iso).slice(0, 10)`: the UTC date. Sweden is one or two hours
 * ahead, so every order placed between local midnight and 01:00 or 02:00 was
 * counted on the PREVIOUS day — and at a month boundary that moves revenue
 * between months, so the report and the shop's books disagreed.
 *
 * src/lib/reportDays.ts, with 30 tests including both daylight-saving switch
 * days: a fixed +01:00 is wrong for half the year and a fixed +02:00 for the
 * other half.
 */
const dayKey = dayKeyInShopTime;

/**
 * The product's own picture for an order line: its first image, as an http(s)
 * address from the catalogue copy the shop already holds — never base64, never a
 * read. Frozen on the line so the job sheet and packing slip can show it even after
 * the product is changed or deleted (client, 2026-10-07: "the product's picture
 * must be visible and very big").
 */
function productImageMap(): Map<string, string> {
  // The copy in memory, else the one on disk — read ONCE per request or order.
  const items = (shopCatalogueCache ?? readDiskCache<CatalogueEntry>('catalogue'))?.items ?? [];
  const out = new Map<string, string>();
  for (const p of items) {
    const img = p?.images?.[0];
    const url = typeof img === 'string' ? img : typeof img?.url === 'string' ? img.url : '';
    if (/^https?:\/\//i.test(url) && url.length < 2000) out.set(String(p.id), url);
  }
  return out;
}

/**
 * WHICH CATEGORY EACH PRODUCT IS IN, and the categories' names — for the dashboard's
 * "orders and revenue by category" (client, 2026-10-07: the dashboard is
 * incomplete). From the copies the shop already keeps (no extra read when they
 * are warm); an order line also carries its own categoryId from now on, which wins.
 */
async function categoryLookups(): Promise<{ ofProduct: Map<string, string>; canon: (key: string) => string; name: (key: string) => string }> {
  const products: CatalogueEntry[] = await loadShopCatalogue().catch(
    () => (shopCatalogueCache ?? readDiskCache<CatalogueEntry>('catalogue'))?.items ?? [],
  );
  const categories: CatalogueEntry[] = await loadShopCategories().catch(
    () => (shopCategoriesCache ?? readDiskCache<CatalogueEntry>('categories'))?.items ?? [],
  );
  const ofProduct = new Map(products.map((p) => [String(p.id), String(p.categoryId ?? '')]));
  // A product's categoryId may hold the category's id OR its name (types/index.ts) —
  // both are in the live data. ONE key per category (its id), or the charts would
  // show "Roll-ups" twice and count an order holding both twice.
  const idOf = new Map<string, string>();
  const names = new Map<string, string>();
  for (const c of categories) {
    const id = String(c.id ?? '').trim();
    const label = String(c.name ?? c.id ?? '').trim();
    if (!id) continue;
    idOf.set(id, id);
    if (label) idOf.set(label.toLowerCase(), id);
    names.set(id, label || id);
  }
  const canon = (key: string) => idOf.get(key) ?? idOf.get(key.toLowerCase()) ?? key;
  return { ofProduct, canon, name: (key) => names.get(canon(key)) ?? key };
}

async function buildReports(db: FirebaseFirestore.Firestore, fromIso: string, toIso: string, slim = false): Promise<ReportsPayload> {
  // A single-field range on createdAt needs NO composite index. Adding
  // where('paymentStatus','==','paid') next to it WOULD, and an undeployed index
  // does not degrade — the query throws and the screen shows nothing. So the
  // status filtering happens in memory, below.
  //
  // createdAt is an ISO string ending in Z on every order, so a string range
  // sorts correctly. paidAt is NOT usable this way: Mollie returns it as
  // "…+00:00" while createdAt is "….085Z", and '+' < '.' < 'Z' by code point, so
  // mixing the two formats in a range would silently drop rows.
  const snap = await db
    .collection('orders')
    .where('createdAt', '>=', fromIso)
    .where('createdAt', '<', toIso)
    .orderBy('createdAt', 'asc')
    .select(
      // A field mask. It keeps the artwork base64 out — that lives on the order
      // under its own keys — but note it CANNOT keep fileSpecs out: those sit
      // inside each element of `items`, and Firestore masks whole fields, not
      // paths inside an array. `items` is needed for the per-product report, so
      // it comes with its fileSpecs attached. Nothing derived from it reaches
      // the browser: only the aggregates below are returned.
      'createdAt', 'paidAt', 'paymentStatus', 'paymentMode', 'status', 'currency',
      'grossTotal', 'totalAmount', 'netTotal', 'goodsNet', 'vatAmount', 'shippingCost',
      'refundedAmount', 'discountCode', 'discountAmount', 'shippingMethod',
      'customerEmail', 'customerName', 'items', 'mollieMethod',
      // 2.3's fields, for the VAT split in 5.6. `vatRate` is what was actually
      // charged; `vatRegime` is why.
      'vatRate', 'vatRegime', 'vatRegimeApplied', 'buyerType', 'buyerCountryCode',
      // 5.13 — how long a job actually takes. `stageHistory` records each move
      // with the time it happened.
      'stageHistory',
      // 5.7b — why a payment failed, and 5.11 — how old an unpaid order is.
      'molliePaymentStatus', 'mollieFailureReason',
      // Pay on delivery: owed, not failed (2026-10-07).
      'payOnDelivery',
    )
    .get();

  const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  // The dashboard's category charts — the full payload only.
  const cats = slim ? null : await categoryLookups();
  const byCategory = new Map<string, { orders: number; revenue: number }>();
  const byMonthCategory = new Map<string, Map<string, number>>();

  const byDay = new Map<string, { gross: number; net: number; orders: number }>();
  const byProduct = new Map<string, { name: string; units: number; revenue: number; orders: number }>();
  const byStatus = new Map<string, number>();
  const byShipping = new Map<string, number>();
  const byMethod = new Map<string, number>();
  const byCustomer = new Map<string, { name: string; orders: number; revenue: number }>();
  const invoices: any[] = [];

  let paidOrders = 0, grossRevenue = 0, netRevenue = 0, vatCollected = 0,
    refunded = 0, shippingCharged = 0, discountGiven = 0, unitsSold = 0,
    testOrders = 0, unpaidOrders = 0, reversedOrders = 0, onDeliveryOrders = 0,
    // Counted in the totals, absent from the daily chart, and said out loud
    // rather than leaving the two to disagree in silence.
    undatedOrders = 0;

  // 5.4 — cost of goods, and therefore margin. The costs live in orderCosts,
  // which is closed to every client and is read here with the Admin SDK.
  let goodsCost = 0, shippingPaid = 0;
  let ordersWithCost = 0, ordersMissingCost = 0;
  // 5.8 — what each product COST over the range, so profit per product can be
  // stated rather than guessed from revenue.
  const costByProduct = new Map<string, number>();
  // 5.6 — the VAT split, BY RATE and separately BY REGIME. An accountant needs
  // 25/6/0 for the return; the shop needs to know which of the zeroes were
  // reverse charge and which were exports, because they are reported
  // differently and one of them rests on a VAT number nobody verified.
  const vatByRate = new Map<string, { net: number; vat: number; orders: number }>();
  const vatByRegime = new Map<string, { net: number; vat: number; orders: number }>();

  // 5.13 — production time, measured from the money arriving to the job being
  // finished. Counted only where BOTH ends are known; an average built from the
  // orders that happen to carry a timestamp is not the shop's lead time.
  const productionHours: number[] = [];
  let ordersWithProductionTime = 0;

  // 5.7b — why payments failed. Keyed on Mollie's own status, with its reason
  // where it gave one.
  const failuresByReason = new Map<string, { count: number; value: number }>();
  // 5.11 — how old the unpaid orders are, and how much money is sitting in them.
  const aging = { d0_7: { count: 0, value: 0 }, d8_30: { count: 0, value: 0 }, d31_60: { count: 0, value: 0 }, d61plus: { count: 0, value: 0 } };
  // 5.14 — how many lines are reprints of a previous job. The option catalogue
  // has carried `reprint_previous` since round 9; nothing has ever counted it.
  let reprintLines = 0, artworkLines = 0;

  for (const doc of snap.docs) {
    const o = doc.data() as any;
    const isTest = o.paymentMode === 'test';
    if (isTest) { testOrders += 1; continue; }

    const status = String(o.paymentStatus ?? '');
    const paid = status === 'paid';
    // 'refunded' and 'chargeback' are REVERSED SALES, not abandoned checkouts.
    // Lumping them in with the people who never paid both inflated that tile and
    // made the money disappear from the report entirely — a bookkeeper looking
    // for a credited order would not find it anywhere.
    const reversed = status === 'refunded' || status === 'chargeback';
    // Placed to pay on delivery and not paid yet (nor cancelled): money OWED, not a
    // payment that failed — in the outstanding money and in the work in production,
    // never in the revenue or among the failures.
    const onDeliveryOpen = o.payOnDelivery === true && !paid && !reversed && String(o.status ?? '') !== 'cancelled';
    if (reversed) reversedOrders += 1;
    else if (!paid) {
      if (onDeliveryOpen) onDeliveryOrders += 1;
      else unpaidOrders += 1;

      // 5.7b — WHY. Mollie's own status is the coarse answer ('failed',
      // 'canceled', 'expired'); its failureReason is the useful one where the
      // payment reached the card at all. Six failures that are all
      // "insufficient_funds" is a different problem from six
      // "invalid_card_number", and only one is worth acting on.
      if (!onDeliveryOpen) {
        const why = String(o.mollieFailureReason ?? o.molliePaymentStatus ?? 'no attempt');
        const f = failuresByReason.get(why) ?? { count: 0, value: 0 };
        f.count += 1;
        f.value += num(o.grossTotal ?? o.totalAmount);
        failuresByReason.set(why, f);
      }

      // 5.11 — an unpaid order is an invoice nobody has settled, and its age is
      // the whole point: 40 000 kr outstanding reads very differently when it is
      // all from this week than when half of it is two months old.
      const placed = new Date(String(o.createdAt ?? ''));
      if (Number.isFinite(placed.getTime())) {
        const days = Math.floor((Date.now() - placed.getTime()) / 86_400_000);
        const value = num(o.grossTotal ?? o.totalAmount);
        const bucket = days <= 7 ? aging.d0_7 : days <= 30 ? aging.d8_30 : days <= 60 ? aging.d31_60 : aging.d61plus;
        bucket.count += 1;
        bucket.value += value;
      }
    }

    // Every money figure below counts PAID orders only. Counts of attempts are
    // reported separately so the two can never be confused. An order to pay on
    // delivery is in production all the same: its stage counts.
    if (!paid) {
      if (onDeliveryOpen) byStatus.set(o.status ?? 'unknown', (byStatus.get(o.status ?? 'unknown') ?? 0) + 1);
      continue;
    }

    const gross = num(o.grossTotal ?? o.totalAmount);
    const refund = num(o.refundedAmount);
    // Orders written before the net/VAT breakdown existed carry neither field.
    // Reading net as 0 while gross is 23,957 made net revenue collapse and
    // net + VAT stop reconciling to gross. Derive them from the shop's rate
    // instead, and say so by deriving rather than inventing: gross = net × (1+r).
    const storedNet = num(o.netTotal);
    const storedVat = num(o.vatAmount);
    const hasBreakdown = storedNet > 0 || storedVat > 0;
    const fallbackRate = Number.isFinite(Number(o.vatRate)) && Number(o.vatRate) > 0
      ? Number(o.vatRate)
      : PRICING_DEFAULTS.vatRate;
    const net = hasBreakdown ? storedNet : Math.round((gross / (1 + fallbackRate)) * 100) / 100;
    const vat = hasBreakdown ? storedVat : Math.round((gross - net) * 100) / 100;
    const day = dayKey(o.createdAt);

    // A REFUND IS A GROSS AMOUNT. Subtracting it whole from the ex-VAT figure
    // was wrong twice: "Omsättning (exkl. moms)" came out low by the VAT share
    // of every refund, and "Moms" stayed at the full VAT as though none had been
    // given back. Split it in the same proportion the order itself carries.
    const vatShare = gross > 0 ? vat / gross : 0;
    const refundVat = Math.round(refund * vatShare * 100) / 100;

    // 5.6 — recorded before the refund is netted off, then corrected with it,
    // so a partly refunded order appears once in the right bucket rather than
    // twice or not at all.
    const ratePercent = `${Math.round((Number(o.vatRate) || 0) * 100)}%`;
    const rateBucket = vatByRate.get(ratePercent) ?? { net: 0, vat: 0, orders: 0 };
    rateBucket.net += net - (refund - refundVat);
    rateBucket.vat += vat - refundVat;
    rateBucket.orders += 1;
    vatByRate.set(ratePercent, rateBucket);

    // `vatRegimeApplied` is the difference between "this is what we charged" and
    // "this is what we would have charged" — until the owner turns the regimes
    // on, every order records one and still pays the standard rate, and a report
    // that ignored the flag would claim reverse charges that never happened.
    const regime = o.vatRegimeApplied === true
      ? String(o.vatRegime ?? 'domestic')
      : 'domestic-charged';
    const regimeBucket = vatByRegime.get(regime) ?? { net: 0, vat: 0, orders: 0 };
    regimeBucket.net += net - (refund - refundVat);
    regimeBucket.vat += vat - refundVat;
    regimeBucket.orders += 1;
    vatByRegime.set(regime, regimeBucket);

    paidOrders += 1;
    grossRevenue += gross - refund;
    netRevenue += net - (refund - refundVat);
    vatCollected += vat - refundVat;
    refunded += refund;
    shippingCharged += num(o.shippingCost);
    discountGiven += num(o.discountAmount);

    // An order whose timestamp cannot be read still counts in the TOTALS — the
    // money is real — but it cannot be placed on a chart. dayKey returns '' for
    // those, and writing a '' bucket would create a day that the zero-filled
    // series never renders: the revenue would be in the tiles and missing from
    // the graph, with nothing to say why. Counted separately instead.
    if (day) {
      const d = byDay.get(day) ?? { gross: 0, net: 0, orders: 0 };
      d.gross += gross - refund; d.net += net - (refund - refundVat); d.orders += 1;
      byDay.set(day, d);
    } else {
      undatedOrders += 1;
    }

    // 5.13 — paid → finished, in hours. stageHistory is written by the stage
    // sweep and by staff, so it is the only record of when work actually moved.
    const history = Array.isArray(o.stageHistory) ? o.stageHistory : [];
    const finishedAt = history
      .filter((h: any) => ['completed', 'delivered', 'shipped'].includes(String(h?.stage ?? '')))
      .map((h: any) => String(h?.at ?? ''))
      .filter(Boolean)
      .sort()[0];
    const startedAt = String(o.paidAt ?? '');
    if (startedAt && finishedAt) {
      const hours = (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 3_600_000;
      // A negative span means the two timestamps disagree — a manual stage move
      // backdated, or a clock. Counting it would drag the average below zero.
      if (Number.isFinite(hours) && hours >= 0 && hours < 24 * 365) {
        productionHours.push(hours);
        ordersWithProductionTime += 1;
      }
    }

    byStatus.set(o.status ?? 'unknown', (byStatus.get(o.status ?? 'unknown') ?? 0) + 1);
    byShipping.set(o.shippingMethod ?? 'unknown', (byShipping.get(o.shippingMethod ?? 'unknown') ?? 0) + 1);
    if (o.mollieMethod) byMethod.set(o.mollieMethod, (byMethod.get(o.mollieMethod) ?? 0) + 1);

    const email = String(o.customerEmail ?? 'unknown');
    const c = byCustomer.get(email) ?? { name: String(o.customerName ?? email), orders: 0, revenue: 0 };
    c.orders += 1; c.revenue += gross - refund;
    byCustomer.set(email, c);

    // 5.14 — reprints. Counted per LINE, not per order: an order can be one new
    // job and one reprint, and counting it as either would be wrong.
    for (const item of Array.isArray(o.items) ? o.items : []) {
      const options = (item as any)?.options;
      if (options && typeof options === 'object') {
        const values = Object.values(options).map((v) => String(v ?? '').toLowerCase());
        if (values.length) {
          artworkLines += 1;
          if (values.some((v) => v.includes('reprint') || v.includes('omtryck') || v.includes('genoptryk') || v.includes('opptrykk'))) {
            reprintLines += 1;
          }
        }
      }
    }

    // BY CATEGORY — the order's paid amount (gross, less refunds, as the tiles count
    // it) shared over its lines in proportion to their prices, so the categories
    // add up to the revenue tile. An order counts once in each category it holds.
    if (cats) {
      const lines = Array.isArray(o.items) ? o.items : [];
      const priced = lines.reduce((s: number, it: any) => s + Math.max(0, num(it?.price)), 0);
      const seen = new Set<string>();
      const month = day ? day.slice(0, 7) : '';
      for (const item of lines) {
        const key = cats.canon(String(item?.categoryId || cats.ofProduct.get(String(item?.productId ?? '')) || 'other'));
        const share = priced > 0 ? Math.max(0, num(item?.price)) / priced : 1 / Math.max(1, lines.length);
        const amount = (gross - refund) * share;
        const c = byCategory.get(key) ?? { orders: 0, revenue: 0 };
        c.revenue += amount;
        if (!seen.has(key)) {
          c.orders += 1;
          seen.add(key);
        }
        byCategory.set(key, c);
        if (month) {
          const m = byMonthCategory.get(month) ?? new Map<string, number>();
          m.set(key, (m.get(key) ?? 0) + amount);
          byMonthCategory.set(month, m);
        }
      }
    }

    for (const item of Array.isArray(o.items) ? o.items : []) {
      // Custom-upload lines carry productId null, so they would all collapse into
      // one bucket. Key on the frozen NAME in that case — and never join back to
      // products/ for a label: the catalogue was deliberately emptied once, and
      // half the historical ids no longer resolve to anything.
      const key = item?.productId ? String(item.productId) : `name:${item?.productName ?? 'Custom'}`;
      const p = byProduct.get(key) ?? { name: String(item?.productName ?? 'Custom'), units: 0, revenue: 0, orders: 0 };
      p.units += num(item?.quantity);
      // `price` is the line total; unitPrice × quantity would omit the setup fee.
      p.revenue += num(item?.price);
      p.orders += 1;
      byProduct.set(key, p);
      unitsSold += num(item?.quantity);
    }

    invoices.push({
      id: doc.id,
      // Derived exactly as InvoiceModal derives it, so the list and the printed
      // sheet can never disagree about an invoice number.
      number: `INV-${new Date(o.createdAt).getFullYear()}-${doc.id}`,
      createdAt: o.createdAt,
      paidAt: o.paidAt ?? null,
      customerName: o.customerName ?? null,
      customerEmail: o.customerEmail ?? null,
      status: o.status ?? null,
      currency: o.currency ?? 'SEK',
      // The VAT derived beside the net — an order saved without a breakdown listed a
      // derived net beside a VAT of 0, and the row did not add up.
      net, vat, gross, refunded: refund,
      discountCode: o.discountCode ?? null,
      method: o.mollieMethod ?? null,
    });
  }

  const sortDesc = (m: Map<string, any>, field: string) =>
    [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b[field] - a[field]);

  // SLIM: the four dashboard tiles, and nothing else.
  //
  // The overview asks over ALL TIME so its revenue figure is genuinely total.
  // Answering that with the full payload meant shipping every invoice the shop
  // has ever issued, and a daily series zero-filled from the year 2000, to the
  // browser on every admin page load — for four numbers.
  if (slim) {
    return {
      range: { from: fromIso, to: toIso },
      totals: {
        paidOrders, unpaidOrders, testOrders, reversedOrders, onDeliveryOrders,
        grossRevenue: Math.round(grossRevenue * 100) / 100,
        netRevenue: Math.round(netRevenue * 100) / 100,
        vatCollected: Math.round(vatCollected * 100) / 100,
        refunded: Math.round(refunded * 100) / 100,
        shippingCharged: Math.round(shippingCharged * 100) / 100,
        discountGiven: Math.round(discountGiven * 100) / 100,
        unitsSold,
        averageOrderValue: paidOrders ? Math.round((grossRevenue / paidOrders) * 100) / 100 : 0,
        customers: byCustomer.size,
      },
      byStatus: [...byStatus.entries()].map(([key, count]) => ({ key, count })),
      slim: true,
    };
  }

  // ── 5.4 and 5.5 — WHAT THE ORDERS COST US ─────────────────────────────────
  //
  // Read in a second pass rather than per order: orderCosts is keyed on the
  // order id, so the whole range comes back in chunks of thirty instead of one
  // round trip each.
  //
  // The costs are DELIBERATELY not on the order document — the buyer can read
  // that, and a unit cost there hands every customer our margin (see 2.1) — so
  // this is the only place a margin figure can be built at all.
  const paidIds = snap.docs
    .filter((d) => (d.data() as any).paymentStatus === 'paid' && (d.data() as any).paymentMode !== 'test')
    .map((d) => d.id);
  for (let i = 0; i < paidIds.length; i += 30) {
    const chunk = paidIds.slice(i, i + 30);
    try {
      const costs = await db.collection('orderCosts')
        .where(FieldPath.documentId(), 'in', chunk)
        // `lines` as well, for 5.8: the most PROFITABLE product is not the
        // best-selling one, and without per-line cost there is no way to tell.
        .select('goodsCost', 'complete', 'actualShippingCost', 'lines')
        .get();
      const found = new Set<string>();
      for (const c of costs.docs) {
        const data = c.data();
        goodsCost += num(data.goodsCost);
        shippingPaid += num(data.actualShippingCost);
        // `complete` is false when some line had no trade price. Counting that
        // order as costed would make the margin look better than it is, and the
        // gap would be invisible.
        if (data.complete === true) { ordersWithCost += 1; found.add(c.id); }
        for (const line of Array.isArray(data.lines) ? data.lines : []) {
          const pid = String((line as any)?.productId ?? '');
          if (!pid) continue;
          const cost = num((line as any)?.lineCost);
          // Only lines whose cost is actually known. A missing one recorded as
          // zero would make that product look like pure profit — the lie
          // src/lib/orderCosts.ts exists to prevent, and it must not creep back
          // in through the report.
          if (typeof (line as any)?.lineCost !== 'number') continue;
          costByProduct.set(pid, (costByProduct.get(pid) ?? 0) + cost);
        }
      }
      ordersMissingCost += chunk.filter((id) => !found.has(id)).length;
    } catch (err) {
      // A refused read (the daily quota) must not empty the whole report. The
      // margin tiles say they are incomplete; everything else still stands.
      console.warn('Order costs unavailable for part of the range:', (err as any)?.message ?? err);
      ordersMissingCost += chunk.length;
    }
  }

  // Only over the orders we actually know the cost of. A margin computed from
  // total revenue and partial costs is not a conservative estimate — it is a
  // flattering one, and it is the kind of number a shop makes decisions on.
  const costCoverage = paidIds.length > 0 ? ordersWithCost / paidIds.length : 0;
  const grossProfit = netRevenue - goodsCost;

  return {
    range: { from: fromIso, to: toIso },
    // 5.4 · 5.5 · 5.6. Every figure here carries how much of the period it
    // actually covers, because a margin that silently excludes half the orders
    // is worse than no margin at all.
    money: {
      goodsCost: Math.round(goodsCost * 100) / 100,
      grossProfit: Math.round(grossProfit * 100) / 100,
      // Against NET revenue, ex VAT — VAT was never the shop's money.
      marginPercent: netRevenue > 0 ? Math.round((grossProfit / netRevenue) * 1000) / 10 : null,
      shippingCharged: Math.round(shippingCharged * 100) / 100,
      shippingPaid: Math.round(shippingPaid * 100) / 100,
      shippingResult: Math.round((shippingCharged - shippingPaid) * 100) / 100,
      ordersWithCost,
      ordersMissingCost,
      costCoverage: Math.round(costCoverage * 1000) / 10,
      // Said plainly, so no screen has to work it out from the two counts.
      complete: ordersMissingCost === 0 && paidIds.length > 0,
    },
    // ── 5.13 — how long a job takes ───────────────────────────────────────
    //
    // The MEDIAN as well as the mean, and they are not the same story: one
    // reprint that sat for three weeks pulls an average of two days up to four,
    // and the shop then quotes a lead time nobody meets. The median is what most
    // jobs actually take.
    production: (() => {
      if (productionHours.length === 0) {
        return { orders: 0, averageHours: null, medianHours: null, slowestHours: null };
      }
      const sorted = [...productionHours].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      const round1 = (n: number) => Math.round(n * 10) / 10;
      return {
        orders: ordersWithProductionTime,
        averageHours: round1(sorted.reduce((a, b) => a + b, 0) / sorted.length),
        medianHours: round1(median),
        slowestHours: round1(sorted[sorted.length - 1]),
      };
    })(),

    // ── 5.9 — new against returning ───────────────────────────────────────
    //
    // "New" means new TO THE SHOP, not new to this date range: a customer's
    // second order in September is a repeat even if their first was in March.
    // Deciding it from the range alone would report every customer as new on any
    // report that starts after they first bought, which is most of them.
    customers: (() => {
      const spenders = [...byCustomer.values()];
      const repeat = spenders.filter((c) => c.orders > 1).length;
      const revenueFromRepeat = spenders.filter((c) => c.orders > 1).reduce((sum, c) => sum + c.revenue, 0);
      return {
        total: spenders.length,
        repeat,
        // Within this range. A shop-lifetime figure needs every order ever
        // placed, which is a different query and a different cost; saying which
        // one this is beats a number nobody can interpret.
        repeatRatePercent: spenders.length ? Math.round((repeat / spenders.length) * 1000) / 10 : 0,
        averageOrdersPerCustomer: spenders.length
          ? Math.round((spenders.reduce((s, c) => s + c.orders, 0) / spenders.length) * 100) / 100
          : 0,
        averageRevenuePerCustomer: spenders.length
          ? Math.round((spenders.reduce((s, c) => s + c.revenue, 0) / spenders.length) * 100) / 100
          : 0,
        revenueFromRepeat: Math.round(revenueFromRepeat * 100) / 100,
        scope: 'range' as const,
      };
    })(),

    // ── 5.7b — why the money did not arrive ─────────────────────────────────
    paymentFailures: [...failuresByReason.entries()]
      .map(([reason, v]) => ({ reason, count: v.count, value: Math.round(v.value * 100) / 100 }))
      .sort((a, b) => b.count - a.count),

    // ── 5.11 — what is outstanding, and how old ─────────────────────────────
    //
    // The buckets are what make it useful: 40 000 kr outstanding reads very
    // differently when it is all from this week than when half is two months old.
    aging: {
      buckets: [
        { label: '0-7', ...aging.d0_7 },
        { label: '8-30', ...aging.d8_30 },
        { label: '31-60', ...aging.d31_60 },
        { label: '61+', ...aging.d61plus },
      ].map((b) => ({ ...b, value: Math.round(b.value * 100) / 100 })),
      totalValue: Math.round(
        (aging.d0_7.value + aging.d8_30.value + aging.d31_60.value + aging.d61plus.value) * 100,
      ) / 100,
    },

    // ── 5.14 — reprints ─────────────────────────────────────────────────────
    //
    // Half the task. A reprint is recorded — it is an option the shopper picks —
    // so it can be counted. An artwork REJECTION is not recorded anywhere: there
    // is no field and no staff action that sets one, so it cannot be reported
    // until that workflow exists. Saying so beats inventing a zero.
    reprints: {
      lines: reprintLines,
      artworkLines,
      percent: artworkLines > 0 ? Math.round((reprintLines / artworkLines) * 1000) / 10 : null,
      rejectionsRecorded: false,
    },

    vat: {
      byRate: [...vatByRate.entries()]
        .map(([rate, v]) => ({ rate, net: Math.round(v.net * 100) / 100, vat: Math.round(v.vat * 100) / 100, orders: v.orders }))
        .sort((a, b) => a.rate.localeCompare(b.rate)),
      byRegime: [...vatByRegime.entries()]
        .map(([regime, v]) => ({ regime, net: Math.round(v.net * 100) / 100, vat: Math.round(v.vat * 100) / 100, orders: v.orders }))
        .sort((a, b) => b.net - a.net),
    },
    totals: {
      paidOrders, unpaidOrders, testOrders, reversedOrders, onDeliveryOrders,
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      netRevenue: Math.round(netRevenue * 100) / 100,
      vatCollected: Math.round(vatCollected * 100) / 100,
      refunded: Math.round(refunded * 100) / 100,
      shippingCharged: Math.round(shippingCharged * 100) / 100,
      discountGiven: Math.round(discountGiven * 100) / 100,
      unitsSold,
      averageOrderValue: paidOrders ? Math.round((grossRevenue / paidOrders) * 100) / 100 : 0,
      customers: byCustomer.size,
      // Almost always 0. When it is not, the daily chart and these tiles will
      // not add up, and this is the reason.
      undatedOrders,
    },
    // EVERY day in the range, including the ones with no sales.
    //
    // byDay only has days that had a paid order, and a line chart fed only those
    // plots three evenly-spaced points for three sales a month apart and draws a
    // straight rising line between them — which reads as steady growth. The zeros
    // are the truth and they have to be in the series.
    daily: (() => {
      // Walked as SWEDISH calendar days, not by adding 86 400 000 ms. On the two
      // days a year the clocks change, one day is 23 hours and another is 25, so
      // fixed-millisecond stepping drifts across the boundary and produces either
      // a repeated day or a missing one — in a series whose whole purpose is to
      // show the gaps honestly.
      const days = shopDaysBetween(
        dayKeyInShopTime(fromIso),
        dayKeyInShopTime(new Date(new Date(toIso).getTime() - 1).toISOString()),
      );
      return days
        .slice(0, 400)   // a year is 365 points; beyond that is a runaway range
        .map((day) => ({ day, ...(byDay.get(day) ?? { gross: 0, net: 0, orders: 0 }) }));
    })(),
    topProducts: sortDesc(byProduct, 'revenue').slice(0, 20),
    // The dashboard's category charts: orders and revenue per category, and the
    // revenue per category month by month (every month in the range, zero-filled).
    categories: cats
      ? (() => {
          const round = (v: number) => Math.round(v * 100) / 100;
          const keys = [...byCategory.entries()].sort((a, b) => b[1].revenue - a[1].revenue).map(([k]) => k);
          const months = [
            ...new Set(
              shopDaysBetween(dayKeyInShopTime(fromIso), dayKeyInShopTime(new Date(new Date(toIso).getTime() - 1).toISOString()))
                .slice(0, 800)
                .map((d) => d.slice(0, 7)),
            ),
          ];
          return {
            totals: keys.map((k) => ({
              key: k,
              name: k === 'other' ? 'Other' : cats.name(k),
              orders: byCategory.get(k)!.orders,
              revenue: round(byCategory.get(k)!.revenue),
            })),
            monthly: months.map((month) => ({
              month,
              values: Object.fromEntries(keys.map((k) => [k, round(byMonthCategory.get(month)?.get(k) ?? 0)])),
            })),
          };
        })()
      : null,

    // ── 5.8 — the most PROFITABLE product, which is rarely the best-selling ──
    //
    // A product can top the revenue table and earn less than one a tenth its
    // size: revenue is what the customer paid, and profit is what is left. This
    // is the table that answers "what should we push", and it is deliberately
    // separate from topProducts so nobody reads one as the other.
    //
    // Only products whose cost is known appear. A product with an unknown cost
    // would show its full revenue as profit and top the table by being
    // unmeasured.
    topProfitable: [...byProduct.entries()]
      .filter(([key]) => costByProduct.has(key))
      .map(([key, p]) => {
        const cost = costByProduct.get(key) ?? 0;
        // A line's `price` is ALREADY ex VAT (the invoice's "Goods excl. VAT" is
        // their sum), like the cost. Dividing it by 1.25 again — as this did —
        // made every product's revenue and profit read a fifth low.
        const netRevenue2 = p.revenue;
        const profit = netRevenue2 - cost;
        return {
          key,
          name: p.name,
          units: p.units,
          revenue: Math.round(p.revenue * 100) / 100,
          cost: Math.round(cost * 100) / 100,
          profit: Math.round(profit * 100) / 100,
          marginPercent: netRevenue2 > 0 ? Math.round((profit / netRevenue2) * 1000) / 10 : null,
        };
      })
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 20),
    // How much of the catalogue that table can actually speak for.
    profitableCoverage: {
      productsWithCost: costByProduct.size,
      productsSold: byProduct.size,
    },

    // ── 5.8, the other half — WHAT DID NOT SELL ──────────────────────────────
    //
    // The products on the shop floor that took no money in this period. A
    // best-sellers table cannot show this by construction — it lists what sold —
    // and this is the list that costs the shop shelf space and photography.
    //
    // VISIBLE products only. A hidden one is not stagnant, it is withdrawn, and
    // reporting the 76 the owner has deliberately hidden as "not selling" would
    // bury the handful that matter.
    stagnant: await (async () => {
      try {
        const catalogue = await loadShopCatalogue();
        return catalogue
          .filter((p: any) => !byProduct.has(String(p.id)))
          .map((p: any) => ({ key: String(p.id), name: String(p.name ?? p.id), price: num(p.basePrice) }))
          .sort((a, b) => b.price - a.price)
          .slice(0, 30);
      } catch {
        // The catalogue cache can be cold and Firestore can refuse it. An empty
        // list is honest; a partial one presented as complete is not.
        return [];
      }
    })(),
    byStatus: [...byStatus.entries()].map(([key, count]) => ({ key, count })),
    byShipping: [...byShipping.entries()].map(([key, count]) => ({ key, count })),
    byMethod: [...byMethod.entries()].map(([key, count]) => ({ key, count })),
    topCustomers: sortDesc(byCustomer, 'revenue').slice(0, 20),
    invoices: invoices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

app.get('/api/admin/reports', async (req, res) => {
  // Declared out here so the catch below can tell whether the cached copy it is
  // about to serve actually answers THIS request.
  let wantedKey = '';
  try {
    const { db } = await requireAdmin(req);

    // Dates in, dates out. Anything unparseable falls back to the last 30 days
    // rather than erroring: a report screen that shows nothing because a query
    // string was malformed is worse than one that shows the default period.
    const parse = (v: unknown, fallback: Date) => {
      const d = new Date(String(v ?? ''));
      return Number.isNaN(d.getTime()) ? fallback : d;
    };
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const from = parse(req.query.from, defaultFrom);
    const to = parse(req.query.to, now);

    // SNAPPED TO WHOLE DAYS, and that is what makes the cache work at all.
    //
    // The range used to be built from `new Date()` when no dates were given, so
    // two calls a millisecond apart produced two different cache keys and the
    // cache never once hit on the default range — every dashboard load walked
    // the orders collection again. Days are also the right granularity for the
    // question: nobody asks for revenue between 09:41:22 and 09:41:23.
    // Snapped to whole SWEDISH days. Snapping to UTC ones asked the database for
    // a window two hours out of step with the days the report then bucketed
    // into: the first two hours of the range were never fetched, and the first
    // two hours of the day AFTER it were.
    const range = shopDayRange(
      dayKeyInShopTime(from.toISOString()),
      dayKeyInShopTime(to.toISOString()),
    );
    const fromIso = range.startIso;
    // Half-open and inclusive of the whole `to` day, so an order placed at
    // 23:59 local time today is in today's figures.
    const toIso = range.endIso;
    const slim = req.query.slim === '1';
    // The mode is part of the key. Without it the overview's all-time request and
    // the reports screen's 30-day request evicted each other on every page load,
    // and this single-slot cache never once hit.
    const key = `${fromIso}|${toIso}|${slim ? 'slim' : 'full'}`;
    wantedKey = key;
    const nowMs = Date.now();

    if (req.query.refresh === '1') invalidateReports();

    const hit = reportsCache.get(key);
    if (hit && nowMs - hit.at < REPORTS_CACHE_MS) {
      return res.json({ ...hit.data, cached: true });
    }

    // Single-flight PER KEY: several dashboards opening at once make one pass
    // over the orders collection between them, not one each.
    let flight = reportsInflight.get(key);
    if (!flight) {
      flight = buildReports(db, fromIso, toIso, slim)
        .then((data) => {
          reportsCache.set(key, { at: Date.now(), data });
          // Oldest out, so a dashboard left open on many ranges cannot grow this
          // without bound.
          while (reportsCache.size > REPORTS_CACHE_MAX) {
            const oldest = [...reportsCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
            if (!oldest) break;
            reportsCache.delete(oldest[0]);
          }
          return data;
        })
        .finally(() => { reportsInflight.delete(key); });
      reportsInflight.set(key, flight);
    }
    const data = await flight;
    return res.json({ ...data, cached: false });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Building the reports failed:', err);
    // A stale report beats an error page — but only a stale report OF THE SAME
    // REQUEST. This used to return whatever was in the single cache slot,
    // whatever range or shape it held: the overview's slim payload handed to the
    // reports screen, which then reads data.daily.length on undefined and shows
    // a blank page instead of the error it was trying to avoid.
    const stale = reportsCache.get(wantedKey);
    if (stale) return res.json({ ...stale.data, cached: true, stale: true });
    return res.status(500).json({ error: 'Could not build the reports.' });
  }
});

// ---------------------------------------------------------------------------
// SUPPLIER IMPORT — six hundred products from a B2B feed, in one screen.
//
// The owner is a trade customer of promediaplus.pl and was given integration
// credentials. Adding their catalogue by hand is 635 forms; this reads the feed,
// shows him what is in it, lets him map their categories onto his and set a
// margin, and writes the products.
//
// WHY THE SERVER DOES ALL OF IT
//  - CORS. b2b.promediaplus.pl sends no Access-Control-Allow-Origin, so the
//    dashboard cannot fetch the feed at all. A proxy is needed, and this is it.
//  - Cost. 635 writes from the browser would each evaluate firestore.rules'
//    isAdmin(), which is a document READ, on a project whose free read quota has
//    already taken this shop dark for seven hours. The Admin SDK bypasses rules
//    and batches 500 writes at a time.
//  - Secrecy. The B2B password stays on the server.
//
// WHY IMPORT IS CHUNKED. The live feed is 1.7 MB and takes ~40 s to arrive, the
// cPanel host has a documented 502 problem and a ~29 s app spawn, and 635
// products in one request would be cut off by the proxy half-written. The
// browser drives it in batches and shows progress.
// ---------------------------------------------------------------------------

const SUPPLIER_FEED_URL = 'https://b2b.promediaplus.pl/en/xml/shop_integration.xml';
// The feed changes when the supplier changes it — daily at most. Re-fetching
// 1.7 MB for every page of a preview would be absurd.
const SUPPLIER_CACHE_MS = 30 * 60 * 1000;
let supplierCache: { at: number; offers: SupplierOffer[]; skipped: number } | null = null;
let supplierInflight: Promise<{ offers: SupplierOffer[]; skipped: number }> | null = null;

async function fetchSupplierOffers(
  creds: { user?: string; pass?: string },
  force = false,
): Promise<{ offers: SupplierOffer[]; skipped: number }> {
  const now = Date.now();
  if (!force && supplierCache && now - supplierCache.at < SUPPLIER_CACHE_MS) return supplierCache;
  if (supplierInflight) return supplierInflight;

  supplierInflight = (async () => {
    const user = (creds.user ?? '').trim();
    const pass = creds.pass ?? '';
    if (!user || !pass) {
      throw Object.assign(new Error('The supplier login has not been saved yet.'), { status: 400 });
    }
    // HTTP Basic. Verified against the live feed: without it the server answers
    // 401 "No access"; the CSV endpoint answers 403 whatever you send, so only
    // the XML is usable — which is also the richer of the two.
    const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    const resp = await fetch(SUPPLIER_FEED_URL, {
      headers: { Authorization: auth },
      // Generous: 1.7 MB from a host that has been slow. Still bounded, so a
      // wedged supplier cannot hold an admin request open indefinitely.
      signal: AbortSignal.timeout(120_000),
    });
    if (resp.status === 401 || resp.status === 403) {
      throw Object.assign(new Error('The supplier rejected the login. Check the username and password.'), { status: 400 });
    }
    if (!resp.ok) {
      throw Object.assign(new Error(`The supplier feed answered ${resp.status}.`), { status: 502 });
    }
    const xml = await resp.text();
    const parsed = parseSupplierFeed(xml);
    if (parsed.offers.length === 0) {
      throw Object.assign(new Error('The feed downloaded but contained no products.'), { status: 502 });
    }
    supplierCache = { at: Date.now(), ...parsed };
    return parsed;
  })().finally(() => { supplierInflight = null; });

  return supplierInflight;
}

/** Save the B2B login. Verified against the real feed BEFORE it is stored. */
app.post('/api/admin/supplier/credentials', async (req, res) => {
  try {
    const { db, uid } = await requireAdmin(req);
    const user = String(req.body?.user ?? '').trim();
    const pass = String(req.body?.pass ?? '');
    if (!user || !pass) return res.status(400).json({ error: 'Both the username and the password are required.' });

    // Prove it works before saving it. A wrong password saved unchecked fails
    // later, during an import, which is a much worse moment to find out — the
    // same reasoning as verifyMollieKey.
    const probe = await fetch(SUPPLIER_FEED_URL, {
      method: 'HEAD',
      headers: { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` },
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!probe || probe.status === 401 || probe.status === 403) {
      return res.status(400).json({ error: 'The supplier rejected that login.' });
    }

    await db.collection('secrets').doc('integrations').set(
      { supplier: { user, pass, updatedAt: new Date().toISOString(), updatedBy: uid ?? 'admin' } },
      { merge: true },
    );
    await loadIntegrationSecrets(true);
    supplierCache = null;
    return res.json({ ok: true, user });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Saving the supplier login failed:', err);
    return res.status(500).json({ error: 'Could not save the supplier login.' });
  }
});

/** Is a login stored? The password itself is never returned. */
app.get('/api/admin/supplier/status', async (req, res) => {
  try {
    await requireAdmin(req);
    const secrets = await loadIntegrationSecrets();
    const user = secrets.supplier?.user ?? '';
    return res.json({
      configured: Boolean(user && secrets.supplier?.pass),
      user,
      cachedOffers: supplierCache ? supplierCache.offers.length : 0,
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Could not read the supplier status.' });
  }
});

/**
 * Download, parse, and report what is in the feed — WITHOUT writing anything.
 *
 * Returns the offers in a trimmed shape plus a category histogram and a
 * duplicate report, so the owner sees exactly what he is about to create and
 * what would be updated rather than added.
 */
app.post('/api/admin/supplier/preview', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const secrets = await loadIntegrationSecrets();
    const { offers, skipped } = await fetchSupplierOffers(secrets.supplier ?? {}, req.body?.refresh === true);

    // Which of these already exist here, by the deterministic id the importer
    // uses. An EMPTY field mask: this only wants the ids, and a product document
    // can carry base64 images. (It used to mask on `supplierOfferId`, which has
    // since moved to productCosts — a mask naming a field a document does not
    // have still returns the document, so it went on working by accident.)
    const existing = new Set<string>();
    const snap = await db.collection('products').select().get();
    snap.docs.forEach((d) => existing.add(d.id));

    return res.json({
      total: offers.length,
      skipped,
      fetchedAt: supplierCache?.at ?? Date.now(),
      categories: categoryHistogram(offers),
      // The shop's own categories, so the mapping UI can offer real ids.
      shopCategories: (await db.collection('categories').select('name').get()).docs
        .map((d) => ({ id: d.id, name: String((d.data() as any)?.name ?? d.id) })),
      offers: offers.map((o) => ({
        id: o.id,
        name: o.name,
        price: o.price,
        stock: o.stock,
        category: o.categoryPath[0] ?? '',
        subCategory: o.categoryPath[1] ?? '',
        image: o.images[0] ?? null,
        images: o.images.length,
        hasDescription: o.description.length > 0,
        exists: existing.has(`prod-pmp-${o.id}`),
      })),
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Supplier preview failed:', err);
    return res.status(500).json({ error: 'Could not read the supplier feed.' });
  }
});

/**
 * Write one CHUNK of products. The browser calls this repeatedly with progress.
 *
 * Deliberately not "import everything": see the header note about the host's
 * 502s and the 29-second spawn. A chunk of fifty is comfortably inside any
 * proxy timeout and leaves a half-finished import resumable rather than lost.
 */
app.post('/api/admin/supplier/import', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const secrets = await loadIntegrationSecrets();

    const ids: string[] = Array.isArray(req.body?.offerIds) ? req.body.offerIds.map(String) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'No products were selected.' });
    if (ids.length > 50) return res.status(400).json({ error: 'Import in chunks of 50 or fewer.' });

    // 15.1.7 — see sentNumber.
    const rate = sentNumber(req.body?.rate);
    const marginPercent = sentNumber(req.body?.marginPercent);
    if (rate === null || rate <= 0) return res.status(400).json({ error: 'A EUR to SEK rate is required.' });
    if (marginPercent === null || marginPercent < 0) return res.status(400).json({ error: 'A margin is required. An empty box is not 0%.' });

    const categoryMap: Record<string, string> = (req.body?.categoryMap && typeof req.body.categoryMap === 'object')
      ? req.body.categoryMap : {};
    const maxImages = Math.max(1, Math.min(Number(req.body?.maxImages) || 4, 10));
    const hidden = req.body?.hidden !== false;

    const { offers } = await fetchSupplierOffers(secrets.supplier ?? {});
    const wanted = new Set(ids);
    const chosen = offers.filter((o) => wanted.has(o.id));
    if (chosen.length === 0) return res.status(400).json({ error: 'None of those products are in the feed.' });

    // EVERY slug already in the shop, seeded once. Without this, an imported
    // product can take the address of one the owner created himself; and
    // without adding each new slug back as we go (mapOfferToProduct does), the
    // nineteen products whose names start "LUNIX™" would all claim one address.
    const slugSnap = await db.collection('products').select('slug', 'name', 'isHidden', 'salePrice').get();
    const takenSlugs = new Set<string>();
    // WHAT THE OWNER HAS ALREADY DECIDED ABOUT THESE PRODUCTS.
    //
    // A re-import is the obvious second use of this screen — refresh the prices
    // next month. merge:true keeps fields the payload does not mention, but the
    // payload DOES mention isHidden and salePrice, so a plain re-import would
    // un-publish everything he had published and wipe every special offer he had
    // set, silently, on all 635 rows. Those two are his, not the feed's.
    const ownerState = new Map<string, { isHidden?: boolean; salePrice?: number | null }>();
    slugSnap.docs.forEach((d) => {
      const v = d.data() as any;
      ownerState.set(d.id, { isHidden: v?.isHidden, salePrice: v?.salePrice });
    });
    slugSnap.docs.forEach((d) => {
      const v = d.data() as any;
      // Not the ones being (re)written by this chunk: a re-import must be able
      // to keep its own slug rather than being pushed to "-2".
      if (wanted.has(String(d.id).replace(/^prod-pmp-/, '')) && d.id.startsWith('prod-pmp-')) return;
      const slug = String(v?.slug ?? '').trim();
      if (slug) takenSlugs.add(slug);
    });

    const nowIso = new Date().toISOString();
    const batch = db.batch();
    const written: string[] = [];
    const unmapped: string[] = [];

    for (const offer of chosen) {
      // Two documents, not one. The trade price, the margin and the supplier's
      // own B2B link used to sit inside the product — which every browser reads
      // whole, and which the Firestore rules let anyone read at all. They are
      // still kept, because a re-import cannot otherwise tell a price the owner
      // set by hand from one it wrote itself; they are kept in
      // productCosts/<id>, which no client can open.
      const { product, costs } = mapOfferToProduct(
        offer,
        { rate, marginPercent, categoryMap, takenSlugs, hidden, maxImages, nowIso },
        slugify,
        uniqueSlug,
      );
      if (!product.categoryId) {
        // Refuse rather than file it under nothing. A product with no category
        // is invisible in the shop's own navigation and the owner would have to
        // find it to fix it.
        unmapped.push(offer.name);
        continue;
      }
      // On a RE-import, leave the two fields that belong to the owner alone.
      // Everything else — name, price, stock, description, images — is the
      // supplier's and is supposed to be refreshed.
      const already = ownerState.get(product.id);
      if (already) {
        if (already.isHidden !== undefined) product.isHidden = already.isHidden;
        // undefined means the field is absent; null means he cleared the offer.
        // Both are his answer, and neither should be replaced by the importer's.
        if (already.salePrice !== undefined) product.salePrice = already.salePrice;
      }
      batch.set(db.collection('products').doc(product.id), product, { merge: true });
      batch.set(db.collection('productCosts').doc(product.id), { ...costs, updatedAt: nowIso }, { merge: true });
      written.push(product.id);
    }

    if (written.length > 0) await batch.commit();

    // The sitemap, the Merchant feed and the crawler-visible head are built from
    // a ten-minute cache. Without this the owner imports six hundred products
    // and Google is told about them a quarter of an hour later.
    if (written.length > 0) {
      invalidateCatalogue();
      // And the storefront's own catalogue, or the owner imports six hundred
      // products and cannot see one of them for five minutes.
      invalidateShopCatalogue();
    }

    return res.json({ ok: true, written: written.length, ids: written, unmapped });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Supplier import failed:', err);
    return res.status(500).json({ error: 'Could not import those products.' });
  }
});

/**
 * Publish or hide every imported product in one call.
 *
 * The import deliberately lands products HIDDEN so the owner can look before
 * six hundred rows appear in his shop. That is only reasonable if he can then
 * publish them together — otherwise "add many products at once" ends at a
 * hidden shelf he has to unpack one form at a time.
 *
 * Scoped to products this importer created (`supplier == 'promediaplus'`), so it
 * can never touch a product he built himself.
 */
app.post('/api/admin/supplier/publish', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const hidden = req.body?.hidden === true;
    const onlyIds: string[] | null = Array.isArray(req.body?.ids) && req.body.ids.length
      ? req.body.ids.map(String)
      : null;

    // WHICH products came from the supplier now lives in productCosts, because
    // `supplier` sat beside the trade price and the margin and all three were
    // world-readable inside the product document. Asking `products` for
    // where('supplier','==','promediaplus') would match nothing at all and this
    // endpoint would answer `{ ok: true, changed: 0 }` — a silent success that
    // publishes none of the 635 products the owner just imported.
    const costSnap = await db.collection('productCosts').where('supplier', '==', 'promediaplus').select().get();
    const supplierIds = new Set(costSnap.docs.map((d) => d.id));
    const snap = await db.collection('products').select('isHidden').get();
    const targets = snap.docs.filter((d) => supplierIds.has(d.id) && (!onlyIds || onlyIds.includes(d.id)));
    if (targets.length === 0) return res.json({ ok: true, changed: 0 });

    // Firestore caps a batch at 500 operations.
    let changed = 0;
    for (let i = 0; i < targets.length; i += 400) {
      const batch = db.batch();
      targets.slice(i, i + 400).forEach((d) => {
        batch.set(d.ref, { isHidden: hidden, updatedAt: new Date().toISOString() }, { merge: true });
        changed += 1;
      });
      await batch.commit();
    }

    invalidateCatalogue();
    invalidateShopCatalogue();
    return res.json({ ok: true, changed, hidden });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Bulk publish failed:', err);
    return res.status(500).json({ error: 'Could not change those products.' });
  }
});

app.get('/api/admin/inquiries', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const snap = await db.collection('contact_inquiries').limit(200).get();
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    return res.json({ inquiries: rows });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Loading enquiries failed:', err);
    return res.status(500).json({ error: 'Could not load the messages.' });
  }
});

/** Mark one as handled, so the list means something after the first week. */
app.post('/api/admin/inquiries/:id', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const status = String(req.body?.status ?? '');
    if (status !== 'new' && status !== 'handled') {
      return res.status(400).json({ error: 'Unknown status.' });
    }
    await db.collection('contact_inquiries').doc(String(req.params.id)).update({
      status,
      handledAt: status === 'handled' ? new Date().toISOString() : null,
    });
    return res.json({ ok: true });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Updating an enquiry failed:', err);
    return res.status(500).json({ error: 'Could not update the message.' });
  }
});

/**
 * What the key panel shows: which integrations are configured, from where, and
 * the last four characters — never the key itself. Reading a saved key back
 * out is deliberately impossible, the same stance every payment provider takes.
 */
app.get('/api/admin/integrations', async (req, res) => {
  try {
    await requireAdmin(req);
    const stored = await loadIntegrationSecrets(true);

    const status = (name: 'mollie' | 'zendr' | 'gemini', envValue: string | undefined) => {
      const fromDash = stored[name]?.key?.trim();
      const value = fromDash || envValue?.trim() || '';
      return {
        configured: !!value,
        source: fromDash ? 'dashboard' : value ? 'server' : 'none',
        last4: value ? value.slice(-4) : null,
        updatedAt: stored[name]?.updatedAt ?? null,
        updatedBy: stored[name]?.updatedBy ?? null,
        ...(name === 'mollie' ? { mode: value.startsWith('live_') ? 'live' : value ? 'test' : null } : {}),
      };
    };

    return res.json({
      mollie: status('mollie', process.env.MOLLIE_API_KEY),
      zendr: status('zendr', process.env.ZENDR_API_KEY),
      // Reported like the others, so the screen can show a tick rather than the
      // owner having to guess whether the assistant is on.
      // WRITE-ONLY IS NOT A STATE. verifyAiKey stores verifiedModel and
      // verifiedWarning when a key is accepted without a model having answered,
      // and nothing read them back — so one reload turned an amber "the provider
      // did not answer" into the plain emerald "Connected" pill. That is the
      // green-badge-over-a-dead-connection this panel was fixed to stop.
      gemini: (() => {
        // The ACTIVE one of his saved AI keys (aiSlots), reported like the others.
        const { active, keys } = aiSlots(stored);
        const slot = active ? keys[active] : undefined;
        const base = status('gemini', process.env.GEMINI_API_KEY);
        return {
          ...base,
          ...(slot ? { source: 'dashboard', last4: slot.last4 ?? slot.key?.slice(-4) ?? null, updatedAt: slot.updatedAt ?? null, updatedBy: slot.updatedBy ?? null } : {}),
          verifiedModel: slot?.verifiedModel ?? stored.gemini?.verifiedModel ?? null,
          verifiedWarning: slot?.verifiedWarning ?? stored.gemini?.verifiedWarning ?? null,
          // Which service the key in use is from.
          provider: active ?? (isAiProvider(stored.gemini?.provider) ? stored.gemini.provider : currentAi()?.provider ?? null),
        };
      })(),
      // EVERY service's saved key — the panel's one row each — and which is in use.
      ai: (() => {
        const { active, keys } = aiSlots(stored);
        return {
          active,
          providers: Object.fromEntries(
            AI_ORDER.map((p) => {
              const slot = keys[p];
              return [p, slot
                ? { configured: true, last4: slot.last4 ?? slot.key?.slice(-4) ?? null, updatedAt: slot.updatedAt ?? null, updatedBy: slot.updatedBy ?? null,
                    verifiedModel: slot.verifiedModel ?? null, verifiedWarning: slot.verifiedWarning ?? null, transferConfirmed: slot.transferConfirmed === true }
                : { configured: false }];
            }),
          ),
          // A key set on the host itself (.env) — used only while no dashboard key is.
          server: ENV_AT_BOOT.gemini ? { provider: isAiProvider(ENV_AT_BOOT.aiProvider) ? ENV_AT_BOOT.aiProvider : null, last4: ENV_AT_BOOT.gemini.slice(-4) } : null,
        };
      })(),
      // The new-order e-mail: where it goes, and whether the mail server can send at all.
      notify: {
        orderEmails: cleanInboxList(stored.notify?.orderEmails ?? []) ?? [],
        updatedAt: stored.notify?.updatedAt ?? null,
        updatedBy: stored.notify?.updatedBy ?? null,
        mail: mailSetup(),
      },
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Integrations status failed:', err);
    return res.status(500).json({ error: 'Could not load the integration status.' });
  }
});

/**
 * Save a key from the dashboard — but only one that its provider has just
 * accepted. A typo'd key saved unchecked would surface at the next customer's
 * payment; verified here, it surfaces to the admin who pasted it, now.
 */
app.post('/api/admin/integrations', async (req, res) => {
  try {
    const { db, uid } = await requireAdmin(req);
    const name = String(req.body?.name ?? '');
    const value = String(req.body?.value ?? '').trim();
    if (name !== 'mollie' && name !== 'zendr' && name !== 'gemini') {
      return res.status(400).json({ error: 'Unknown integration.' });
    }
    if (!value) return res.status(400).json({ error: 'The key is empty.' });

    // The AI key goes to the ONE service he chose — and never to a company whose
    // key it recognisably is not (providerForKey). Refused HERE, before anything
    // is sent anywhere.
    let aiProvider: AiProvider | null = null;
    if (name === 'gemini') {
      const choice = providerForKey(req.body?.provider, value);
      if (choice.kind === 'mismatch' && isAiProvider(req.body?.provider)) {
        return res.status(400).json({ error: keyMismatchSentence(req.body.provider, choice.looksLike) });
      }
      if (choice.kind !== 'ok') return res.status(400).json({ error: 'Choose which AI service this key is from.' });
      aiProvider = choice.provider;
    }

    const verdict: AiVerdict = name === 'mollie'
      ? await verifyMollieKey(value)
      : name === 'zendr'
        ? await verifyZendrKey(value)
        : await verifyAiKey(value, aiProvider!);
    if (!verdict.ok) return res.status(400).json({ error: verdict.reason });

    // Who changed the payment key, and when, survives on the document itself.
    const who = (await getAdminAuth())?.getUser(uid).then((u) => u.email ?? uid).catch(() => uid);

    // AN AI KEY GOES INTO ITS OWN SERVICE'S SLOT, beside the others (2026-10-07):
    // it is put in use when nothing is, when it replaces the key in use, or when he
    // asks (activate). The one in use is mirrored into `gemini` for older servers.
    if (name === 'gemini' && aiProvider) {
      const before = aiSlots(await loadIntegrationSecrets(true));
      const slot = fullAiSlot({
        key: value,
        last4: value.slice(-4),
        updatedAt: new Date().toISOString(),
        updatedBy: await who,
        provider: aiProvider,
        verifiedModel: verdict.model,
        verifiedWarning: verdict.warning ?? null,
        transferConfirmed: aiProvider === 'deepseek' && req.body?.transferConfirmed === true,
      });
      const activate = req.body?.activate === true || !before.active || before.active === aiProvider;
      await db.collection('secrets').doc('integrations').set(
        {
          ai: { keys: { ...allAiSlotsForWrite(before.keys), [aiProvider]: slot }, active: activate ? aiProvider : before.active },
          ...(activate ? { gemini: slot } : {}),
        },
        { merge: true },
      );
      if (activate) {
        await db.collection('settings').doc('legalPages').set(
          { aiProcessor: { provider: aiProvider, transferConfirmed: slot.transferConfirmed, updatedAt: new Date().toISOString() } },
          { merge: true },
        );
      }
      await loadIntegrationSecrets(true);
      console.log(`AI key saved from the dashboard: ${aiProvider} (…${value.slice(-4)})${activate ? ', in use' : ''}.`);
      return res.json({
        ok: true,
        last4: value.slice(-4),
        provider: aiProvider,
        active: activate ? aiProvider : before.active,
        ...(verdict.model ? { model: verdict.model } : {}),
        ...(verdict.warning ? { warning: verdict.warning } : {}),
      });
    }

    await db.collection('secrets').doc('integrations').set(
      {
        [name]: {
          key: value,
          last4: value.slice(-4),
          updatedAt: new Date().toISOString(),
          updatedBy: await who,
          // Proven, not guessed. See verifyAiKey.
          ...(verdict.provider ? { provider: verdict.provider } : {}),
          // WHICH MODEL ANSWERED, and when. Informational — the shop always asks
          // for AI_MODELS[provider], never for this — but it is the record that
          // says what was true at save time, which is exactly what nobody had
          // when the 2.5 ids went quiet.
          ...(verdict.model ? { verifiedModel: verdict.model } : {}),
          ...(verdict.warning ? { verifiedWarning: verdict.warning } : { verifiedWarning: null }),
          // DeepSeek: his word that an agreement covers the transfer out of the EU.
          ...(name === 'gemini' ? { transferConfirmed: aiProvider === 'deepseek' && req.body?.transferConfirmed === true } : {}),
        },
      },
      { merge: true },
    );

    // THE PRIVACY POLICY'S ANSWER TO "WHO GETS WHAT I TYPE INTO THE CHAT" —
    // public, in the document the policy page already reads, so it never waits
    // on (or loses to) a second request. A company name and a yes/no; never the key.
    if (name === 'gemini' && aiProvider) {
      await db.collection('settings').doc('legalPages').set(
        {
          aiProcessor: {
            provider: aiProvider,
            transferConfirmed: aiProvider === 'deepseek' && req.body?.transferConfirmed === true,
            updatedAt: new Date().toISOString(),
          },
        },
        { merge: true },
      );
    }

    // Take effect NOW on this host; others follow within the cache window.
    await loadIntegrationSecrets(true);
    // The payment-method list belongs to the ACCOUNT the key opens, so a new key
    // means a different list. Without this the checkout would go on advertising
    // the old account's methods for up to ten minutes after the switch.
    invalidateMollieMethods();

    console.log(`Integration key updated from the dashboard: ${name} (…${value.slice(-4)}).`);
    return res.json({
      ok: true,
      last4: value.slice(-4),
      ...(verdict.provider ? { provider: verdict.provider } : {}),
      ...(verdict.model ? { model: verdict.model } : {}),
      // An amber state, not a green one. The panel must not read "connected" over
      // a provider that never actually answered.
      ...(verdict.warning ? { warning: verdict.warning } : {}),
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Saving an integration key failed:', err);
    return res.status(500).json({ error: 'Could not save the key.' });
  }
});

/**
 * "Use this one": put one of his SAVED AI keys in use, keeping every other (client,
 * 2026-10-07). Refused for a service with no saved key. The privacy policy names
 * the service in use, so it follows.
 */
app.post('/api/admin/integrations/ai-active', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const provider = req.body?.provider;
    if (!isAiProvider(provider)) return res.status(400).json({ error: 'Choose an AI service.' });
    const { keys } = aiSlots(await loadIntegrationSecrets(true));
    const slot = keys[provider];
    if (!slot?.key?.trim()) return res.status(400).json({ error: `Save a ${AI_PROVIDER_NAMES[provider]} key first.` });
    const full = fullAiSlot({ ...slot, provider });
    await db.collection('secrets').doc('integrations').set({ ai: { keys: allAiSlotsForWrite(keys), active: provider }, gemini: full }, { merge: true });
    await db.collection('settings').doc('legalPages').set(
      { aiProcessor: { provider, transferConfirmed: provider === 'deepseek' && full.transferConfirmed, updatedAt: new Date().toISOString() } },
      { merge: true },
    );
    await loadIntegrationSecrets(true);
    console.log(`AI service switched from the dashboard: ${provider}.`);
    return res.json({ ok: true, active: provider, model: full.verifiedModel });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Switching the AI service failed:', err);
    return res.status(500).json({ error: 'Could not switch the AI service.' });
  }
});

/**
 * DeepSeek's transfer agreement, ticked or unticked for the key ALREADY saved — the
 * tick used to travel only with a pasted key, so on a saved one it did nothing. The
 * privacy policy follows while DeepSeek is the service in use.
 */
app.post('/api/admin/integrations/ai-transfer', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const confirmed = req.body?.confirmed === true;
    const { active, keys } = aiSlots(await loadIntegrationSecrets(true));
    const slot = keys.deepseek;
    if (!slot?.key?.trim()) return res.status(400).json({ error: `Save a ${AI_PROVIDER_NAMES.deepseek} key first.` });
    const full = fullAiSlot({ ...slot, provider: 'deepseek', transferConfirmed: confirmed });
    await db.collection('secrets').doc('integrations').set(
      { ai: { keys: { ...allAiSlotsForWrite(keys), deepseek: full }, active }, ...(active === 'deepseek' ? { gemini: full } : {}) },
      { merge: true },
    );
    if (active === 'deepseek') {
      await db.collection('settings').doc('legalPages').set(
        { aiProcessor: { provider: 'deepseek', transferConfirmed: confirmed, updatedAt: new Date().toISOString() } },
        { merge: true },
      );
    }
    await loadIntegrationSecrets(true);
    return res.json({ ok: true, transferConfirmed: confirmed });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Saving the DeepSeek agreement failed:', err);
    return res.status(500).json({ error: 'Could not save that.' });
  }
});

/**
 * "Send new-order e-mails to" — the owner's own addresses (client, 2026-10-07: "when
 * an order is created I must get an e-mail"). An empty list is valid: the server's
 * SHOP_ORDER_INBOX then receives them, as before.
 */
app.post('/api/admin/notifications', async (req, res) => {
  try {
    const { db, uid } = await requireAdmin(req);
    const list = cleanInboxList(req.body?.orderEmails);
    if (!list) return res.status(400).json({ error: 'Write e-mail addresses separated by commas — at most five.' });
    const who = await (await getAdminAuth())?.getUser(uid).then((u) => u.email ?? uid).catch(() => uid);
    await db.collection('secrets').doc('integrations').set(
      { notify: { orderEmails: list, updatedAt: new Date().toISOString(), updatedBy: who ?? uid } },
      { merge: true },
    );
    await loadIntegrationSecrets(true);
    return res.json({ ok: true, orderEmails: list });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Saving the order e-mail addresses failed:', err);
    return res.status(500).json({ error: 'Could not save the addresses.' });
  }
});

/**
 * THE DASHBOARD'S REVENUE GOAL (client, 2026-10-07, the reference dashboard's "revenue
 * goal for this quarter"): one amount per month, incl. VAT like the revenue tile;
 * the dashboard compares this month and this quarter against it. 0 = no goal.
 */
app.get('/api/admin/dashboard-goal', async (req, res) => {
  try {
    await requireAdmin(req);
    // Fresh (one read, admin-only): a goal saved through another process must show.
    const stored = await loadIntegrationSecrets(true);
    return res.json({ monthlyGoal: Number(stored.dashboard?.monthlyGoal) || 0 });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    return res.status(500).json({ error: 'Could not load the goal.' });
  }
});
app.post('/api/admin/dashboard-goal', async (req, res) => {
  try {
    const { db, uid } = await requireAdmin(req);
    const goal = Number(req.body?.monthlyGoal);
    if (!Number.isFinite(goal) || goal < 0 || goal > 1e9) return res.status(400).json({ error: 'Write the goal as an amount, 0 or more.' });
    const who = await (await getAdminAuth())?.getUser(uid).then((u) => u.email ?? uid).catch(() => uid);
    const monthlyGoal = Math.round(goal);
    await db.collection('secrets').doc('integrations').set(
      { dashboard: { monthlyGoal, updatedAt: new Date().toISOString(), updatedBy: who ?? uid } },
      { merge: true },
    );
    await loadIntegrationSecrets(true);
    return res.json({ ok: true, monthlyGoal });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Saving the dashboard goal failed:', err);
    return res.status(500).json({ error: 'Could not save the goal.' });
  }
});

/** "Send a test e-mail": the new-order notice's own road, and what the mail server said. */
app.post('/api/admin/notifications/test', async (req, res) => {
  try {
    await requireAdmin(req);
    const settings = await fetchSiteConfig();
    const shopName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';
    // Fresh: the addresses he saved a moment ago may have been saved by another process.
    const result = await sendTestOrderNotice(await orderInboxes(true), shopName);
    return res.json(result);
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('The test e-mail failed:', err);
    return res.status(500).json({ error: 'Could not send the test e-mail.' });
  }
});

/**
 * "Send again" on an order: the confirmation and/or the shop's notice, once more —
 * for a paid order whose mail failed (the old SMTP password), or one he wants in a
 * new inbox. Records what happened on the order, like the first send.
 */
app.post('/api/admin/orders/:orderId/resend-emails', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const orderId = String(req.params.orderId);
    const ref = db.collection('orders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found.' });
    const order = snap.data() as any;
    if (order.paymentStatus !== 'paid' && order.payOnDelivery !== true) {
      return res.status(409).json({ error: 'Only a paid order is e-mailed — this one is not paid.' });
    }
    // What did not go out — the customer is never sent the same confirmation twice by
    // this button; with both delivered, it is the shop's notice (a new inbox) again.
    const already = (order.emailDetail ?? {}) as Record<string, string>;
    const only: 'customer' | 'shop' | undefined =
      req.body?.who === 'customer' || req.body?.who === 'shop'
        ? req.body.who
        : already.customer === 'sent'
          ? 'shop'
          : already.shop === 'sent'
            ? 'customer'
            : undefined;
    const settings = await fetchSiteConfig();
    const shopName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';
    const base = (process.env.PUBLIC_URL ?? '').replace(/\/+$/, '');
    const orderUrl = `${base}/order/${orderId}?t=${order.publicToken}`;
    const mail = await sendOrderEmails(order, shopName, orderUrl, settings.pickupLocation, settings.logoUrl, {
      shopInbox: await orderInboxes(),
      ...(only ? { only } : {}),
    });
    const detail = { ...(order.emailDetail ?? {}), ...((mail as any).results ?? {}) } as Record<string, string>;
    const done = ['customer', 'shop'].every((k) => detail[k] === 'sent' || detail[k] === 'no address');
    await ref.update({
      emailStatus: done ? 'sent' : ((mail as any).reason ?? 'failed'),
      emailDetail: detail,
      ...(done ? { 'sideEffects.emailsSent': true } : {}),
      updatedAt: new Date().toISOString(),
    });
    return res.json({ sent: mail.sent, results: (mail as any).results ?? null, reason: (mail as any).reason ?? null, emailDetail: detail });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Re-sending the order e-mails failed:', err);
    return res.status(500).json({ error: 'Could not send the e-mails.' });
  }
});

/**
 * Put an order into Zendr by hand.
 *
 * The draft is normally made the moment the payment lands. This is for the two
 * cases that leaves: the automatic attempt failed (Zendr down, an address the
 * carrier would not take), and an order the shop took some other way and now
 * wants shipped.
 */
app.post('/api/admin/orders/:orderId/zendr-draft', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const orderId = String(req.params.orderId);
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found.' });

    const order = snap.data() as any;
    if (order.zendr?.importedOrderId && req.body?.force !== true) {
      // Re-sending the same order id would either collide inside Zendr or leave
      // two drafts for one shipment; asking is cheaper than either.
      return res.status(409).json({
        error: 'This order is already in Zendr.',
        importedOrderId: order.zendr.importedOrderId,
        portalUrl: order.zendr.portalUrl ?? zendrPortalUrl(order.zendr.importedOrderId),
      });
    }

    const outcome = await createZendrDraftFor(db, orderId, order);
    if (!outcome.ok) return res.status(502).json({ error: outcome.reason });
    await db.collection('orders').doc(orderId).update({ 'sideEffects.zendrDraft': true });
    return res.json({
      ok: true,
      importedOrderId: outcome.importedOrderId,
      portalUrl: zendrPortalUrl(outcome.importedOrderId!),
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Zendr draft request failed:', err);
    return res.status(500).json({ error: 'Could not send this order to Zendr.' });
  }
});

/** Ask Zendr where one parcel is, now, rather than waiting for the sweep. */
/**
 * What an order cost us — the only door to orderCosts.
 *
 * The collection is closed to every client (firestore.rules), because the buyer
 * can read their own ORDER and these figures must never travel with it. The
 * dashboard asks here instead.
 */
/**
 * Record a refund made outside Mollie, and issue its kreditnota.
 *
 * Cash back, a bank transfer, a card refund taken in Mollie's own dashboard —
 * none of those reach our webhook, so the order still reads as fully paid and no
 * document exists. This is the door for them.
 *
 * The AMOUNT here is the new cumulative total refunded, not an increment: it is
 * the same number Mollie reports, so both paths speak one language and
 * issueCreditNoteForRefund works out the difference from the notes already
 * issued either way.
 */
app.post('/api/admin/orders/:orderId/refund', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const orderId = String(req.params.orderId ?? '').trim();
    if (!orderId) return res.status(400).json({ error: 'An order id is required.' });

    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) return res.status(404).json({ error: 'No such order.' });
    const order = snap.data() as Record<string, any>;

    // Money that never arrived cannot be refunded (an order still to be paid on
    // delivery): a kreditnota and a points claw-back for it would both be wrong.
    if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'refunded') {
      return res.status(409).json({ error: 'This order is not paid — there is nothing to refund.' });
    }
    const total = Number(req.body?.refundedTotal);
    if (!Number.isFinite(total) || total < 0) {
      return res.status(400).json({ error: 'The refunded total must be a number, 0 or more.' });
    }
    const gross = Number(order.grossTotal ?? order.totalAmount) || 0;
    if (total > gross) {
      return res.status(400).json({ error: `That is more than the order (${gross}).` });
    }
    // Never DOWNWARDS. Money that has been given back cannot be un-given, and a
    // lower figure here would silently make the next refund look larger than it
    // is — the credit notes already issued are the record.
    const current = Number(order.refundedAmount) || 0;
    if (total < current) {
      return res.status(400).json({ error: `Already refunded ${current}. A refund cannot be reduced.` });
    }

    const reason = String(req.body?.reason ?? '').trim().slice(0, 300) || 'Refund recorded by staff';
    await db.collection('orders').doc(orderId).set(
      { refundedAmount: total, updatedAt: new Date().toISOString() },
      { merge: true },
    );
    const number = await issueCreditNoteForRefund(db, orderId, order, total, reason);
    // The same claw-back the webhook does. A refund taken in Mollie's dashboard
    // and one recorded here must have the same consequences, or the points a
    // customer keeps depends on which door the refund came through.
    await clawBackPointsForRefund(db, orderId, order, total);
    await reduceLifetimeSpendForRefund(db, orderId, order, total);
    return res.json({ ok: true, orderId, refundedTotal: total, creditNote: number });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'The refund could not be recorded.' });
  }
});

/** The credit notes issued against one order, for the dashboard and the invoice. */
app.get('/api/admin/orders/:orderId/credit-notes', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const orderId = String(req.params.orderId ?? '').trim();
    if (!orderId) return res.status(400).json({ error: 'An order id is required.' });
    const snap = await db.collection('creditNotes').where('orderId', '==', orderId).get();
    const notes = snap.docs
      .map((d) => d.data())
      .sort((a: any, b: any) => String(a.issuedAt).localeCompare(String(b.issuedAt)));
    return res.json({ orderId, notes, totalCredited: notes.reduce((s: number, n: any) => s + (Number(n.gross) || 0), 0) });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Could not read the credit notes.' });
  }
});

app.get('/api/admin/orders/:orderId/costs', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    const orderId = String(req.params.orderId ?? '').trim();
    if (!orderId) return res.status(400).json({ error: 'An order id is required.' });
    const snap = await db.collection('orderCosts').doc(orderId).get();
    if (!snap.exists) {
      // Not an error. Orders placed before this existed have no record, and so
      // does an order of nothing but custom uploads. Saying so beats a 404 the
      // screen has to guess the meaning of.
      return res.json({ orderId, exists: false, lines: [], goodsCost: null });
    }
    return res.json({ orderId, exists: true, ...snap.data() });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Could not read the costs.' });
  }
});

/**
 * The shipping the shop ACTUALLY paid, entered by hand.
 *
 * Zendr can neither book nor price from here yet, so the carrier's real charge
 * arrives on an invoice days later and exists nowhere in the system. Until that
 * integration lands, this is where it goes — and it belongs in orderCosts rather
 * than on the order, for the same reason the goods cost does: the buyer can read
 * their order, and what we paid to ship it is ours.
 *
 * `shippingCost` on the order is a different number and stays untouched: that is
 * what the CUSTOMER was charged, it is on their invoice, and nothing may quietly
 * edit a figure a customer has already paid.
 */
app.post('/api/admin/orders/:orderId/costs', async (req, res) => {
  try {
    const { db, uid } = await requireAdmin(req);
    const orderId = String(req.params.orderId ?? '').trim();
    if (!orderId) return res.status(400).json({ error: 'An order id is required.' });

    // The order has to exist. Without this a typo creates a cost record for an
    // order that never was, and it would sit in every report from then on.
    const order = await db.collection('orders').doc(orderId).get();
    if (!order.exists) return res.status(404).json({ error: 'No such order.' });

    const raw = req.body?.actualShippingCost;
    const patch: Record<string, any> = { orderId, updatedAt: new Date().toISOString(), updatedBy: uid ?? 'admin' };

    if (raw === null || raw === '') {
      // Clearing has to DELETE the key. A merge that omits it keeps the old
      // value, which is the most repeated bug in this codebase.
      patch.actualShippingCost = FieldValue.delete();
    } else if (raw !== undefined) {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        return res.status(400).json({ error: 'The shipping cost must be a number, 0 or more.' });
      }
      patch.actualShippingCost = Math.round(value * 100) / 100;
    }

    if (typeof req.body?.note === 'string') patch.costNote = req.body.note.slice(0, 500);

    await db.collection('orderCosts').doc(orderId).set(patch, { merge: true });
    const after = await db.collection('orderCosts').doc(orderId).get();
    return res.json({ ok: true, orderId, ...after.data() });
  } catch (err: any) {
    return res.status(err?.status ?? 500).json({ error: err?.message ?? 'Could not save the cost.' });
  }
});

app.post('/api/admin/orders/:orderId/tracking', async (req, res) => {
  try {
    const { db } = await requireAdmin(req);
    if (!zendrConfigured()) return res.status(503).json({ error: 'Zendr is not configured.' });

    const orderId = String(req.params.orderId);
    const snap = await db.collection('orders').doc(orderId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Order not found.' });

    const tracking = await fetchTracking(String(snap.data()?.id ?? orderId));
    if (!tracking) {
      return res.json({ ok: true, tracking: null, note: 'Zendr has no tracking for this order yet.' });
    }
    await applyTracking(db, orderId, tracking);
    return res.json({ ok: true, tracking });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Tracking lookup failed:', err);
    return res.status(502).json({ error: String(err?.message ?? err).slice(0, 200) });
  }
});

app.post('/api/checkout/order', quoteRateLimit, async (req, res) => {
  try {
    await requireAdmin(req);
    const { orderId, order } = await createOrder(req.body, await callerIdentity(req));
    return res.json({ orderId, order });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.detail ? { detail: err.detail } : {}) });
    console.error('Order creation failed:', err);
    return res.status(500).json({ error: 'We could not place your order. Please try again.' });
  }
});

// Gemini Multi-turn Chat API Endpoint
/**
 * AI PICTURES FOR THE DESIGNER (designer v2's AI Studio) — src/lib/aiImages.ts.
 *
 * Off until the owner switches it on (settings `designerAiImages`): Google's image
 * models need billing on his project, and every picture costs him. A shop-wide cap
 * per day (his `designerAiDailyCap`) is counted on this server's disk, so a restart
 * does not hand out a second day's worth; and a visitor gets a few requests per
 * ten minutes on top. The settings are read at most every five minutes — never once
 * per request on a shop whose free read quota has run out before.
 */
let designerAiCache: { at: number; on: boolean; cap: number } | null = null;
async function designerAiSettings(): Promise<{ on: boolean; cap: number }> {
  if (designerAiCache && Date.now() - designerAiCache.at < 5 * 60 * 1000) return designerAiCache;
  try {
    // The shared copy (loadSiteSettingsCopy) — a masked read still costs the
    // whole document's units.
    const f = (await loadSiteSettingsCopy()).data ?? {};
    designerAiCache = { at: Date.now(), on: f.designerAiImages === true, cap: dailyCap(f.designerAiDailyCap) };
  } catch {
    designerAiCache = { at: Date.now(), on: designerAiCache?.on ?? false, cap: designerAiCache?.cap ?? dailyCap(undefined) };
  }
  return designerAiCache;
}
const aiImageBuckets = new Map<string, { count: number; resetAt: number }>();
const AI_IMAGE_WINDOW_MS = 10 * 60 * 1000;
const AI_IMAGE_PER_WINDOW = 6;
// A VISITOR'S SHARE OF THE DAY. The shop-wide cap limits what the owner pays, not who
// spends it: at 6 requests per 10 minutes one visitor drained the default 80 pictures
// in about 35 minutes, every day, and real customers then got "limit".
const AI_IMAGE_PER_VISITOR_DAY = 5;
const aiImageDaily = new Map<string, { day: string; count: number }>();

app.post('/api/designer/ai-images', async (req, res) => {
  // The WHOLE handler, not only the call to Google: Express 4 ignores a rejected async
  // handler, and Node then ends the process on the unhandled rejection. One crafted
  // body was enough to take the shop down, payments in flight with it.
  try {
    const ip = clientIp(req);
    const now = Date.now();
    const bucket = aiImageBuckets.get(ip);
    if (bucket && now < bucket.resetAt && bucket.count >= AI_IMAGE_PER_WINDOW) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'limit' });
    }
    if (!bucket || now >= bucket.resetAt) aiImageBuckets.set(ip, { count: 1, resetAt: now + AI_IMAGE_WINDOW_MS });
    else bucket.count += 1;
    if (aiImageBuckets.size > 5000) for (const [k, v] of aiImageBuckets) if (now >= v.resetAt) aiImageBuckets.delete(k);

    const settings = await designerAiSettings();
    await loadIntegrationSecrets();
    // The provider the rest of the shop uses (currentAi: the stored choice, else told by
    // the key): an OpenAI or Anthropic key must never be sent to Google's picture model.
    const configured = currentAi();
    const model = configured?.provider === 'google' ? AI_IMAGE_MODELS.google : undefined;
    const ai = model ? getGeminiClient() : null;
    if (!settings.on || !ai || !model) return res.status(503).json({ error: 'off' });
    const ask = cleanAiImageRequest(req.body);
    if (!ask) return res.status(400).json({ error: 'failed' });

    const today = dayKeyInShopTime(new Date().toISOString()) || new Date().toISOString().slice(0, 10);
    const mine = aiImageDaily.get(ip);
    const usedByVisitor = mine && mine.day === today ? mine.count : 0;
    if (usedByVisitor >= AI_IMAGE_PER_VISITOR_DAY) return res.status(429).json({ error: 'limit' });
    const budget = takeBudget(readCacheJson<{ day?: string; used?: number }>('ai-images'), today, settings.cap, AI_IMAGE_COUNT);
    if (!budget.ok) return res.status(429).json({ error: 'limit' });
    // FAILS CLOSED: a count that cannot be saved (a full disk, a read-only folder) is a
    // cap that does not exist — every request would read "none used yet".
    if (!writeCacheJson('ai-images', budget.next)) {
      console.warn('AI pictures: the daily count could not be saved — refusing rather than spending without a cap.');
      return res.status(503).json({ error: 'off' });
    }
    aiImageDaily.set(ip, { day: today, count: usedByVisitor + 1 });
    if (aiImageDaily.size > 5000) for (const [k, v] of aiImageDaily) if (v.day !== today) aiImageDaily.delete(k);
    // WHEN GOOGLE MADE NOTHING, the day is given back (DSN-02): the shop's count and
    // this visitor's share. Read again rather than undone from `budget` — other
    // requests may have counted since. Only for an answer that says nothing was
    // made: no pictures, or an HTTP error. A timeout or a dropped connection may
    // still have been made and billed, so that try stays spent.
    const giveBackToday = () => {
      const back = giveBack(readCacheJson<{ day?: string; used?: number }>('ai-images'), today, AI_IMAGE_COUNT);
      if (back) writeCacheJson('ai-images', back);
      const visitor = aiImageDaily.get(ip);
      if (visitor && visitor.day === today && visitor.count > 0) visitor.count -= 1;
    };
    try {
      const answer = await ai.models.generateImages({
        model,
        prompt: ask.prompt,
        config: {
          numberOfImages: AI_IMAGE_COUNT,
          aspectRatio: ask.aspectRatio,
          // A MINUTE, NOT FOR EVER (DSN-17). Google's client waits as long as the
          // socket does, and on this host a request held open is a worker held with
          // it. A timeout is not given back (above): the call may still be billed.
          httpOptions: { timeout: 60_000 },
        },
      });
      const images = imagesFromResponse(answer);
      if (images.length === 0) {
        giveBackToday();
        return res.status(502).json({ error: 'failed' });
      }
      return res.json({ images: images.map((x) => `data:${x.mime};base64,${x.data}`) });
    } catch (err: any) {
      const why = aiImageFailure(Number(err?.status ?? err?.code) || undefined, String(err?.message ?? ''));
      console.warn(`AI pictures failed (${why}):`, String(err?.message ?? err).slice(0, 300));
      // `status` only: Google's own answer carries one (ApiError). An abort carries a
      // DOMException `code` instead, and is not an answer.
      const httpStatus = Number(err?.status);
      if (Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599) giveBackToday();
      return res.status(why === 'limit' ? 429 : why === 'off' ? 503 : 502).json({ error: why });
    }
  } catch (err: any) {
    console.warn('AI pictures: the request failed:', String(err?.message ?? err).slice(0, 300));
    if (!res.headersSent) res.status(500).json({ error: 'failed' });
  }
});

/**
 * The most text one chat request may carry, all its messages together (SRV-02).
 *
 * The widget sends the WHOLE conversation every time, the assistant's own replies
 * included, and those are the long half: at 30 000 characters an ordinary chat
 * about paper and finishes ran into the cap and ended in "unavailable" (review
 * 2026-10-11, R). Twice that holds the forty messages allowed below at a
 * generous length each, and is still a bound on what one request can send on to
 * a paid model — where the 10 MB body limit was none.
 */
const CHAT_MAX_CHARS = 60_000;

app.post('/api/chat', rateLimit, async (req, res) => {
  try {
    const configured = currentAi();
    if (!configured) {
      // The chat widget prints whatever comes back here straight into the
      // conversation, so this text is read by CUSTOMERS. It used to name the
      // missing environment variable and tell them to open a settings screen
      // they have never heard of and cannot reach.
      console.error('The chat assistant is enabled but no AI key is configured.');
      return res.status(503).json({
        error: 'The chat assistant is unavailable right now. Please use the contact page and we will answer you directly.',
      });
    }
    // Google's own client is still used for Google keys, because it is what
    // carries the Search and Maps grounding the assistant answers location
    // questions with. The other providers go through the shared HTTP path.
    const ai = configured.provider === 'google' ? getGeminiClient() : null;

    const { messages, mode } = req.body;
    // NOTE: a client-supplied systemInstructionOverride is intentionally ignored.
    // Allowing the browser to replace the system prompt is a prompt-injection /
    // jailbreak vector and turns the endpoint into a free general-purpose LLM proxy.

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }
    if (messages.length > 40) {
      return res.status(400).json({ error: 'Conversation too long.' });
    }
    // AND NOT TOO MUCH TEXT. Forty messages of any length passed — anything up to
    // the 10 MB body limit, sent on to a paid model, fifteen times a minute per
    // address. Counted without String(): a crafted `content` must not throw here.
    const chatChars = messages.reduce(
      (n: number, m: any) => n + (typeof m?.content === 'string' ? m.content.length : JSON.stringify(m?.content ?? '').length),
      0,
    );
    if (chatChars > CHAT_MAX_CHARS) {
      return res.status(400).json({ error: 'Conversation too long.' });
    }

    // ONE PLACE NAMES THE MODEL, and it is not this file.
    //
    // This line used to name the two 2.5-era ids itself — a second, independent
    // copy of what already lives in src/lib/aiProvider.ts. Google retired both for
    // new projects; the translator and the analyser were fixed in aiProvider.ts,
    // and the CUSTOMER-facing widget went on asking for a model that answers 404.
    // scripts/check-ai-models.mjs now fails the build if a model id is written as
    // a string literal anywhere in this file again.
    const modelName = AI_MODELS.google[mode === 'complex' ? 'complex' : 'fast'];
    // What ACTUALLY answered. It can differ from modelName: the deeper model runs
    // out of its twenty-a-day and the fast one takes over. Reporting the model we
    // asked for rather than the one that spoke is a small lie in the one field
    // whose entire job is to say what ran.
    let usedModel = modelName;

    // System instruction
    // "Powered by LaboPrint Web2Print Hub" was here. That name appears nowhere in
    // this shop — not on the site, not on an invoice, not in the legal pages — and
    // a customer only has to ask the assistant who it is to be told it.
    const defaultSystemInstruction = `You are the ReklamX AI Assistant.
Your goals:
1. Provide expert guidance on custom printing products: Roll Banners, Rigid Packaging, Gift Boxes, Custom Labels, Exhibition Stands, Doypacks, Paper Cups, Beachflags, Textiles, Illuminated Signs, and Sun Sails.
2. Advise on paper weights (GSM: e.g. 90g, 130g, 170g, 250g, 300g, 350g, 400g), finishes (Matte Lamination, Gloss Lamination, Soft-Touch, Spot UV, Foil Stamping), and binding styles.
3. Assist with file preparation: 300 DPI resolution, CMYK color space, bleed lines (3mm), embedding fonts, vector PDF export.
4. Answer questions about collection and delivery from what the shop tells you. You have NO live map or web access: never invent an address, an opening time or a branch. If you are asked for one and do not know it, say so and point the customer at the contact page.
5. The shop sells in English, Swedish, Danish and Norwegian. ALWAYS answer in the language the customer wrote in. Never answer in Arabic — it is not one of this shop's languages.
6. Keep a polite, professional, helpful tone.`;

    const systemInstruction = defaultSystemInstruction;

    // Convert messages to Gemini format
    const contents = messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.content || '' }],
    }));

    // GROUNDING IS ASKED FOR, NOT ASSUMED — and this is the trap that killed the
    // assistant outright.
    //
    // Every single question used to travel with a tool attached: `googleMaps` if a
    // substring matched, `googleSearch` otherwise. There was no branch that sent
    // none. On a free Google project grounded search has ZERO quota, so Google
    // answered 429 in about a third of a second while the identical question
    // WITHOUT the tool answered 200 in the same second — measured 2026-09-13.
    // Every customer, every question, no answer.
    //
    // The substring test went with it. `/near|…|find|where|shop|…/` on a PRINT
    // SHOP's own widget sent "where do I find a soft-touch finish?" to Maps, and
    // the word "shop" alone matched most of what anyone types into a shop.
    //
    // Maps survives behind the explicit toggle only, because a grounded lookup is
    // the one thing the other providers cannot do at all. It must never fall back
    // to answering ungrounded: an invented branch address in a chat bubble is
    // worse than no answer.
    const wantsMaps = mode === 'maps';

    const config: any = {
      systemInstruction,
    };

    if (wantsMaps) {
      config.tools = [{ googleMaps: {} }];
    }

    if (ai) {
      // A DEADLINE, which this path never had. The translator races a 25-second
      // timer for exactly this reason — the SDK exposes no abort, and a hung call
      // sits until Apache serves the shop's 502 page, which this host has a long
      // history of. The customer-facing call is the one that most needed it.
      //
      // ONE deadline around the whole thing, not one per attempt. A retry inside
      // its own race would let a single question run for twice the timeout on a
      // host with this one's 502 history.
      const response: any = await Promise.race([
        (async () => {
          try {
            return await ai.models.generateContent({ model: modelName, contents, config });
          } catch (e: any) {
            const status = Number(e?.status ?? e?.response?.status ?? 0);
            // A REFUSED LOOKUP IS NOT AN ANSWER. If Maps grounding is not on this
            // key, say so — never re-ask without the tool, which would answer the
            // address question out of the model's imagination.
            if (wantsMaps && (status === 429 || status === 400 || status === 403)) {
              console.error(`Chat: Google refused the Maps lookup (${status}). This key has no grounding quota.`);
              throw Object.assign(new Error('maps-unavailable'), { status: 503 });
            }
            // 503 "experiencing high demand" is transient and common: 7 of 23
            // probe calls hit it and every one succeeded later. One retry, inside
            // this same deadline.
            if (status === 503 || /high demand/i.test(String(e?.message ?? ''))) {
              await new Promise((r) => setTimeout(r, 1500));
              return await ai.models.generateContent({ model: modelName, contents, config });
            }
            // THE DEEPER MODEL IS CAPPED AT TWENTY REQUESTS A DAY on a free
            // project — Google's own quotaId says PerDay, not per minute. After
            // the twentieth question the Pro mode would simply stop answering for
            // the rest of the day. A smaller model's answer is worth more to a
            // shopper than a refusal, so it falls back once and the log says so,
            // where the owner can see it and decide about billing.
            if (status === 429 && modelName !== AI_MODELS.google.fast) {
              console.warn(
                `Chat: ${modelName} is out of quota (429) — answering on ${AI_MODELS.google.fast} instead. `
                + 'The free tier allows 20 requests a day for the deeper model; billing on the project removes the cap.',
              );
              usedModel = AI_MODELS.google.fast;
              return await ai.models.generateContent({ model: AI_MODELS.google.fast, contents, config });
            }
            throw e;
          }
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('chat-timeout'), { status: 504 })), 60_000),
        ),
      ]);

      // An empty reply is a failure, not a message. It used to be papered over
      // with an English sentence returned as HTTP 200, which the widget then
      // showed to a Swedish customer as if the assistant had spoken.
      const replyText = String(response.text ?? '').trim();
      if (!replyText) {
        console.error('Chat: the model returned no text.');
        throw Object.assign(new Error('empty-reply'), { status: 503 });
      }

      // Extract Grounding Metadata (Maps or Search chunks)
      const groundingChunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];

      return res.json({
        text: replyText,
        groundingChunks,
        modelUsed: usedModel,
        provider: 'google',
      });
    }

    // The Maps lookup is Google's own. Any other provider would answer the
    // address question ungrounded — out of its imagination — which the rule
    // above forbids; the widget hides the toggle for them too.
    if (wantsMaps) throw Object.assign(new Error('maps-unavailable'), { status: 503 });

    const answer = await askAi({
      system: systemInstruction,
      // The same turns, minus Google's shape. A client-supplied system prompt is
      // still ignored — see the note above; this path must not become the hole
      // that one was closed against.
      messages: messages.map((m: any) => ({
        role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
        content: String(m.content ?? ''),
      })),
      tier: mode === 'complex' ? 'complex' : 'fast',
    });

    return res.json({
      text: answer.text,
      // Nothing to ground against without Google's tools. An empty list is the
      // honest answer; the widget already renders none.
      groundingChunks: [],
      // THE MODEL THAT ANSWERED, which on this branch is never Google's. This
      // returned `modelName` — the Google id chosen at the top of the handler —
      // next to `provider: 'openai'`, so the one field naming what ran was wrong
      // for every non-Google key.
      modelUsed: answer.model,
      provider: answer.provider,
    });
  } catch (err: any) {
    // FOUR ENGLISH LEAFLETS USED TO LIVE HERE, and they were returned as HTTP 200.
    //
    // A keyword match on the customer's own words picked one of four hard-coded
    // markdown pages — paper weights, pre-press, "location lookup unavailable",
    // or a general blurb — and sent it back with a success status. Three things
    // were wrong with that, and they compounded:
    //   · The shop sells in four languages. A Swedish customer asking about GSM
    //     got a page of English markdown.
    //   · 200 meant the widget's `if (!res.ok)` never fired, so the translated
    //     "the assistant is unavailable" bubble it already owns was unreachable.
    //   · Two of the four gave no hint the assistant had never run. A customer
    //     read canned text as the shop's considered answer.
    // A 503 with no body text lets the widget say, in the customer's own
    // language, the one true thing: it could not answer just now.
    const status = Number(err?.status ?? 0);
    console.error(`Chat failed (upstream ${status || 'unknown'}):`, err?.message ?? err);
    return res.status(503).json({
      error: friendlyAiError(status),
      code: err?.message === 'maps-unavailable' ? 'maps-unavailable' : 'ai-failed',
      // Never a fabricated source. An invented address presented as verified is
      // the one failure mode worse than silence.
      groundingChunks: [],
    });
  }
});

// Competitor Product AI Analyzer Endpoint
/**
 * Translate one piece of the owner's own text into the shop's other languages.
 *
 * WHY THIS EXISTS
 * Round 13 gave products, categories and the site's own copy a per-language map
 * and left the owner to type every translation by hand — three boxes under every
 * name, every description, every hero slide. He asked for this directly:
 * "عايز اضيف Ai بحيث يترجم هنا بباقي اللغات بدون ادخل انا الترجمه".
 *
 * WHAT IT IS NOT. It does not save anything. It answers with a draft, the
 * dashboard drops it into the boxes, and the owner reads it and presses Save
 * like any other edit. A machine translation written straight into the live shop
 * without a human seeing it is how "tryckrullar" — printing-press ROLLERS —
 * was nearly advertised to someone buying labels.
 *
 * The shop sells in en, sv, da and no. It does NOT sell in Arabic, and this must
 * never invent an Arabic string: scripts/check-i18n.mjs treats Arabic in the UI
 * as a defect, and the rule holds for owner-typed text too.
 */
app.post('/api/admin/translate', rateLimit, async (req, res) => {
  try {
    await requireAdmin(req);
    const ai = getGeminiClient();
    if (!ai) {
      // Say which key is missing and where it goes. The old message for this
      // said only "unavailable", and it cost an afternoon of looking in the
      // wrong place.
      return res.status(503).json({
        error: 'Translation needs an AI key. Add one under Payments & API keys — Google, OpenAI, Anthropic or DeepSeek. Nothing was translated.',
        code: 'no-key',
      });
    }

    /**
     * MANY STRINGS IN ONE CALL — 15.4.5.
     *
     * The dashboard used to send one request per box, which was fine while this
     * control was on two fields. It is now on every property name, every help
     * text and every option label, so one attribute with fourteen options is
     * sixteen requests — and this shop's own limiter is fifteen per minute per
     * IP, shared with /api/chat, /api/contact and /api/analyze-product. He would
     * meet a 429 halfway through, surfacing as the bare "the translation
     * failed": his original complaint, produced by the fix for it.
     *
     * So the property card sends its whole list at once. One upstream call, one
     * limiter slot, and the model sees the option labels together, which is how
     * it can keep "Small / Medium / Large" consistent with each other.
     *
     * The single-`text` form is unchanged and still the common case.
     */
    const rawItems: unknown = req.body?.items;
    const items: { id: string; text: string }[] = Array.isArray(rawItems)
      ? rawItems
          .slice(0, 25)
          .map((row: any) => ({ id: String(row?.id ?? '').slice(0, 80), text: String(row?.text ?? '').trim() }))
          .filter((row) => row.id && row.text)
      : [];
    const batch = items.length > 0;

    const text = String(req.body?.text ?? '').trim();
    const kind = String(req.body?.kind ?? 'text').slice(0, 40);
    const requested: string[] = Array.isArray(req.body?.languages)
      ? req.body.languages.map(String)
      : ['sv', 'da', 'no'];
    // Deduplicated, and only the shop's own languages. The text is capped at
    // 4000 characters but the LIST was not, so ["sv","sv","sv", …] made the
    // prompt as long as the caller liked.
    const languages = [...new Set(requested.filter((l) => ['sv', 'da', 'no'].includes(l)))];

    if (!batch && !text) return res.status(400).json({ error: 'There is nothing to translate.' });
    if (text.length > 4000) return res.status(400).json({ error: 'That text is too long to translate in one go.' });
    if (languages.length === 0) return res.status(400).json({ error: 'No shop language was asked for.' });
    // The whole batch shares the single-string budget: 25 labels of 160
    // characters is already a long prompt, and a long prompt is what the
    // deadline below exists for.
    const batchChars = items.reduce((sum, row) => sum + row.text.length, 0);
    if (batch && batchChars > 6000) {
      return res.status(400).json({ error: 'That is too much text for one go. Translate the options in two passes.' });
    }

    const LANG_NAMES: Record<string, string> = { sv: 'Swedish', da: 'Danish', no: 'Norwegian (bokmål)' };

    const prompt = [
      'You translate copy for a Swedish web-to-print shop. It sells printing:',
      'business cards, banners, roll-ups, exhibition stands, labels and stickers,',
      'gift boxes, paper cups, garments to print on.',
      '',
      batch
        ? `These are ${items.length} ${kind}s from one product option, to be read side by side. Translate each from English into: ${languages.map((l) => LANG_NAMES[l]).join(', ')}.`
        : `This is a ${kind}. Translate it from English into: ${languages.map((l) => LANG_NAMES[l]).join(', ')}.`,
      '',
      'Rules:',
      '- Translate as a print buyer in that country would say it, not word by word.',
      '  Trade terms have conventional forms: banderoll/banner, rollup, mässmonter/',
      '  messestand, etikett, dekal/klistermærke/klistremerke, folieprägling.',
      '- Keep the same length class. A short heading stays a short heading; an',
      '  ALL-CAPS badge stays ALL-CAPS and stays short, or it breaks the layout.',
      '- Do NOT translate: brand names, product codes, discount codes, sizes,',
      '  units, or anything that looks like an identifier.',
      // 15.3.5 — THE RULE ABOVE WAS EATING PRODUCT NAMES. "Roll UP Standard
      // 85x200 Small" is a trade term, a word that exists in all four
      // languages, a measurement and a size word, so a fast model read the
      // whole string as an identifier and handed it back unchanged in all
      // three languages. The owner saw three identical boxes and reported the
      // translator as broken. It was obeying this instruction.
      '- A product NAME is copy, not an identifier. Translate its descriptive',
      '  words — Small, Large, Standard, Double-sided, Matt, Glossy, Roll-up —',
      '  and keep ONLY the measurements, unit symbols and SKU codes unchanged.',
      '  "Roll UP Standard 85x200 Small" is "Rollup Standard 85x200 Liten" in',
      '  Swedish, not the English line repeated.',
      ...(String(req.body?.overwrite) === 'true'
        // He has pressed "translate again" on text that came back unchanged.
        // Saying so is the whole reason the flag travels: asking the same
        // question the same way would return the same answer.
        ? ['- An earlier attempt returned the English unchanged. Do not repeat it:',
           '  render the descriptive words in the target language.']
        : []),
      '- Do not add, remove or explain anything. Same meaning, same punctuation style.',
      '- Never answer in any language other than the ones asked for. Never Arabic.',
      '',
      ...(batch
        ? [
            // They arrive together so that "Small / Medium / Large" comes back
            // as one consistent set rather than three unrelated answers.
            '- These belong to ONE question the customer is asked. Keep them',
            '  consistent with each other and distinct from each other.',
            '',
            'Return ONLY a JSON object keyed by the id of each text, e.g.',
            `{"<id>": {${languages.map((l) => `"${l}": "…"`).join(', ')}}}`,
            '',
            'The texts:',
            ...items.map((row) => `${row.id}: ${row.text}`),
          ]
        : [
            'Return ONLY a JSON object keyed by language code, e.g.',
            `{${languages.map((l) => `"${l}": "…"`).join(', ')}}`,
            '',
            'The text:',
            text,
          ]),
    ].join('\n');

    let parsed: Record<string, unknown> | null = null;
    let timedOut = false;
    // The provider's HTTP status, carried out to the dashboard as a number.
    let upstream: number | undefined;
    try {
      // A DEADLINE. A thinking model deliberates before it answers and the SDK
      // exposes no abort, so a hung call would sit here until Apache gave up and
      // served the shop's 502 page — which this host has a long history of.
      const response = await Promise.race([
        // Whichever provider is configured. The prompt already ENDS by demanding
        // JSON, which is what makes this work on Anthropic too — it has no JSON
        // mode, and the parser below already coped with a model that wrapped its
        // object in prose.
        askAi({
          system: 'You translate copy for a Swedish web-to-print shop. Answer with JSON and nothing else.',
          messages: [{ role: 'user', content: prompt }],
          tier: 'fast',
          json: true,
          // THE INPUT CAP IS 4000 CHARACTERS AND THE ANSWER IS THREE LANGUAGES.
          // Without this it took chatRequest's 2048 default, which is roughly
          // half what sv + da + no plus JSON escaping needs for a long product
          // description. A truncated object fails JSON.parse AND the {...} regex
          // that rescues it — the regex needs the closing brace — and surfaces as
          // the same opaque "did not answer", intermittently, on long text only.
          // 8192 is the ceiling on purpose: claude-3-5-haiku's own max_tokens IS
          // 8192 and asking for more makes an Anthropic key answer 400.
          maxTokens: 8192,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => { timedOut = true; reject(new Error('translate-timeout')); }, 25_000),
        ),
      ]);
      const raw = response.text || '';
      try {
        parsed = JSON.parse(raw);
      } catch {
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) parsed = JSON.parse(m[0]);
      }
    } catch (err: any) {
      // The status travels with the error (askAi attaches it). A NUMBER survives
      // every locale and is quotable over WhatsApp; the provider's own sentence
      // does not leave the log, because it names quotas, models and sometimes
      // the key.
      upstream = Number(err?.status ?? 0) || undefined;
      console.warn(`Translate: the AI call failed (upstream ${upstream ?? 'none'}) —`, err?.message ?? err);
    }

    if (!parsed || typeof parsed !== 'object') {
      // No invented text. An empty box the owner can fill is honest; a fabricated
      // Swedish product name that nobody reviewed is not.
      return res.status(502).json({
        error: timedOut
          ? 'The translation took too long and was stopped. Nothing was changed.'
          : 'The translation service did not answer. Nothing was changed.',
        // ONE SENTENCE used to cover a missing key, a wrong key, a quota, a 502,
        // a deadline and a retired model. The number tells them apart, and the
        // dashboard can show it in any language.
        code: timedOut ? 'ai-timeout' : 'ai-error',
        ...(upstream ? { upstream } : {}),
      });
    }

    const ARABIC = /[\u0600-\u06FF]/;

    /**
     * THE BATCH ANSWER \u2014 15.4.5.
     *
     * One object per id, each holding the languages asked for. Every guard the
     * single-string path applies is applied per language here too: a
     * non-string is dropped, an empty string is dropped, and an answer that
     * comes back in Arabic is dropped with a line in the log. An id the model
     * forgot is simply absent, and the dashboard leaves that box alone rather
     * than filling it with something else's translation.
     */
    if (batch) {
      const results: Record<string, Record<string, string>> = {};
      const echoedByItem: Record<string, string[]> = {};
      for (const row of items) {
        const answer = parsed[row.id];
        if (!answer || typeof answer !== 'object') continue;
        const perLang: Record<string, string> = {};
        const asked = foldForCompare(row.text);
        const echoedHere: string[] = [];
        for (const l of languages) {
          const v = (answer as Record<string, unknown>)[l];
          if (typeof v !== 'string') continue;
          const cleaned = v.trim();
          if (!cleaned) continue;
          if (ARABIC.test(cleaned)) {
            console.warn(`Translate: dropped the ${l} answer for "${row.id}", it came back in Arabic.`);
            continue;
          }
          perLang[l] = cleaned.slice(0, 4000);
          if (foldForCompare(perLang[l]) === asked) echoedHere.push(l);
        }
        if (Object.keys(perLang).length === 0) continue;
        results[row.id] = perLang;
        if (echoedHere.length) echoedByItem[row.id] = echoedHere;
      }
      if (Object.keys(results).length === 0) {
        return res.status(502).json({ error: 'The translation came back empty. Nothing was changed.' });
      }
      const missed = items.filter((row) => !results[row.id]).map((row) => row.id);
      if (missed.length) console.info(`Translate: the model skipped ${missed.length} of ${items.length} items`);
      return res.json({
        results,
        ...(Object.keys(echoedByItem).length ? { echoed: echoedByItem } : {}),
        ...(missed.length ? { missed } : {}),
      });
    }

    const out: Record<string, string> = {};
    for (const l of languages) {
      const v = parsed[l];
      if (typeof v !== 'string') continue;
      const cleaned = v.trim();
      if (!cleaned) continue;
      // The shop has four languages and Arabic is not one of them. If the model
      // answers in it, drop that language rather than putting it on a product.
      if (ARABIC.test(cleaned)) {
        console.warn(`Translate: dropped the ${l} answer, it came back in Arabic.`);
        continue;
      }
      out[l] = cleaned.slice(0, 4000);
    }

    if (Object.keys(out).length === 0) {
      return res.status(502).json({ error: 'The translation came back empty. Nothing was changed.' });
    }

    // Say which languages did NOT come back, so a partial answer cannot read as
    // a complete one.
    const skipped = languages.filter((l) => !(l in out));
    /**
     * AND WHICH ONES CAME BACK AS THE QUESTION — 15.3.6.
     *
     * An answer identical to the text it was given used to be stored in
     * silence. The dashboard then showed three boxes of the same words with a
     * counter saying they were translated, and the owner reported the feature
     * as broken — "الترجمه ما شغاله تظهر نفس المعلومات". It was not broken; it
     * had been told not to translate anything that looks like a product code,
     * and his product name looks exactly like one.
     *
     * These are NOT dropped. "Banner", "Design", "Standard" and plenty of
     * printing trade terms really are the same word in Swedish, Danish and
     * Norwegian, so the identical answer is frequently the correct one. The
     * shop cannot tell those apart from a name the model refused to touch —
     * the owner can, and now he is told there is something to look at.
     */
    // 15.3.2b — folded, not exact: the model answers "Roll-up Standard 85x200
    // Small" to "Roll UP Standard 85×200 Small" and an exact compare calls that
    // a translation. Punctuation and spacing are not the difference between a
    // translation and an echo.
    const asked = foldForCompare(text);
    const echoed = languages.filter((l) => out[l] && foldForCompare(out[l]) === asked);
    if (echoed.length) console.info(`Translate: ${echoed.join(', ')} came back unchanged for "${text.slice(0, 60)}"`);
    return res.json({
      translations: out,
      ...(skipped.length ? { skipped } : {}),
      ...(echoed.length ? { echoed } : {}),
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Translate failed:', err);
    return res.status(500).json({ error: 'The translation failed. Nothing was changed.' });
  }
});

app.post('/api/analyze-product', rateLimit, async (req, res) => {
  try {
    await requireAdmin(req);
    const ai = getGeminiClient();
    const { url, images, notes } = req.body;

    if (!url && (!images || images.length === 0)) {
      return res.status(400).json({ error: 'Please provide either a product URL or at least one image.' });
    }

    const promptText = `
You are an expert Web2Print E-Commerce & Print Production Specialist AI.
Your job is to analyze competitor product details from the provided URL, images, or notes, and construct a complete structured product specification for a custom printing/e-commerce store.

Details provided:
- Product Webpage URL: ${url || 'None provided'}
- Admin Notes/Instructions: ${notes || 'None'}

Please extract and structure the following fields in JSON:
1. "name": A concise, clear product title IN ENGLISH, e.g. "Custom Luxury Box Packaging". This shop sells in Swedish, Danish, Norwegian and English only — never answer in any other language, and never in Arabic.
2. "description": A comprehensive sales description highlighting print quality, materials, and usage.
3. "suggestedCategory": One of ["cards", "banners", "packaging", "stickers", "exhibitions", "cups", "signs", "general"].
4. "basePrice": A realistic base starting price (number e.g. 150).
5. "minQuantity": Minimum order quantity (number e.g. 25).
6. "maxQuantity": Maximum order quantity (number e.g. 10000).
7. "stock": Initial stock number (number e.g. 5000).
8. "isWeb2Print": boolean (true if file upload / custom print design is expected).
9. "features": An array of 3 to 6 key bullet points IN ENGLISH (e.g. ["Sharp 300 DPI printing", "Premium 350 gsm board", "Matt or gloss lamination", "Precision die-cutting"]).
10. "options": An array of customizable print options. Each option must have:
    - "name": Option label IN ENGLISH (e.g. "Paper & material", "Finish & lamination", "Available sizes")
    - "type": "select"
    - "values": Array of choice objects: { "label": string, "priceModifier": number }

Return ONLY valid JSON matching this schema.
`;

    // Prepare contents for Gemini generateContent
    const parts: any[] = [];
    
    // Add image inline data if attached
    if (images && Array.isArray(images)) {
      for (const imgDataUrl of images) {
        if (typeof imgDataUrl === 'string' && imgDataUrl.includes('base64,')) {
          const match = imgDataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2]
              }
            });
          }
        }
      }
    }

    parts.push({ text: promptText });

    let responseData: any = null;

    if (currentAi()) {
      try {
        // Whichever provider is configured. The pictures travel with it: all
        // three read base64 images, they just want them in different shapes —
        // src/lib/aiProvider.ts holds the three.
        const response = await askAi({
          system: 'You are a print-production specialist. Answer with JSON and nothing else.',
          messages: [{ role: 'user', content: promptText }],
          images: (Array.isArray(images) ? images : []).filter((i: unknown) => typeof i === 'string'),
          tier: 'fast',
          json: true,
          maxTokens: 4096,
        });

        const rawText = response.text || '';
        try {
          responseData = JSON.parse(rawText);
        } catch {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            responseData = JSON.parse(jsonMatch[0]);
          }
        }
      } catch (aiErr: any) {
        // THERE IS NO FALLBACK ANALYSER. This line used to say "using intelligent
        // analyzer fallback", and the block below returns 503 having generated
        // nothing — so whoever chased this went looking for code that does not
        // exist. The upstream body is NOT repeated here: askAi already logged it,
        // and it can contain the key.
        console.warn(`analyze-product: no usable answer from the AI (status ${aiErr?.status ?? 'none'}) — returning 503, nothing was generated.`);
      }
    } else {
      // This path logged nothing at all, so "the analyser does nothing" and "no
      // key is configured" looked identical in the log.
      console.warn('analyze-product: no AI key is configured — returning 503.');
    }

    // If the AI produced no result (no key configured or the call failed), return an
    // honest error instead of fabricating a product. Inventing specs/prices and
    // presenting them as a real "competitor analysis" would mislead the admin into
    // saving made-up data.
    if (!responseData) {
      return res.status(503).json({
        success: false,
        // Not "Gemini": this path serves a Google, an OpenAI or an Anthropic key
        // and naming one of the three is wrong two times in three.
        error: 'AI analysis is currently unavailable — no AI key is configured, or the request failed. No data was generated; please try again or enter the product details manually.',
      });
    }

    return res.json({
      success: true,
      product: responseData
    });
  } catch (err: any) {
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error('Error analyzing product:', err);
    return res.status(500).json({ error: 'Failed to analyze competitor product' });
  }
});

// ---------------------------------------------------------------------------
// The automatic stage sweep.
//
// Every quarter of an hour: pick up the orders whose next stage is due, move
// them one step, and write down when the step after that falls. See
// src/lib/orderStages.ts for the schedule itself.
//
// WHAT THIS COSTS, because it matters here more than in most shops:
// ONE query per sweep, on a single indexed field, capped at 50 documents, and
// only orders that are actually due are ever read. Idle, that is 96 reads a day.
// Firestore is still on the FREE plan and its daily read quota has already taken
// this shop offline for seven hours; a background job that quietly spends that
// quota would be worse than no automation at all. AUTO_STAGE_SWEEP=off turns it
// off completely.
//
// WHY `nextStageAt: null` COSTS NOTHING — this is load-bearing, and it is not
// obvious. Every order is created with `nextStageAt: null`, and most orders in a
// shop are abandoned baskets that stay that way forever. A range filter in
// Firestore only compares values of the BOUND's own type, so `<= '2026-…'`
// (a string) matches string values and nothing else: null does not fall inside
// the range, and a document without the field is not considered at all. Measured
// against this database, not assumed. If anyone ever changes `nextStageAt` to a
// Timestamp, or writes 0 or '' instead of null, this query starts reading every
// dead basket in the shop on every sweep.
// ---------------------------------------------------------------------------

const AUTO_STAGE_SWEEP_ENABLED = process.env.AUTO_STAGE_SWEEP !== 'off';
const AUTO_STAGE_SWEEP_MINUTES = Math.max(1, Number(process.env.AUTO_STAGE_SWEEP_MINUTES) || 15);
/** One sweep at a time: a slow one must not overlap the next tick. */
let sweepRunning = false;

/**
 * What one sweep did, so a caller that is asked "did it work?" can answer.
 *
 * The timer does not care, but the cron endpoint does: it used to wrap this in
 * try/catch and report {ok:true,swept:true} unconditionally, because the sweep
 * swallows its own errors and returns silently when there is no database handle
 * — so a monitor watching that endpoint would have reported a healthy shop
 * through a completely dead sweep.
 */
// One flat shape rather than a discriminated union: this project compiles
// without `strict`, and TypeScript will not narrow a union by its discriminant
// there, so every read of `reason` after an `if (result.ran)` was an error.
type SweepResult = {
  ran: boolean;
  advanced: number;
  reason: 'ok' | 'already-running' | 'no-database' | 'disabled' | 'failed';
};

async function sweepAutoStages(): Promise<SweepResult> {
  if (sweepRunning) return { ran: false, advanced: 0, reason: 'already-running' };
  const db = getAdminDb();
  if (!db) return { ran: false, advanced: 0, reason: 'no-database' };

  sweepRunning = true;
  let advanced = 0;
  try {
    const settings = await fetchAutoStageSettings(db);
    if (!settings.enabled) return { ran: false, advanced: 0, reason: 'disabled' };

    const now = new Date().toISOString();
    const due = await db
      .collection('orders')
      .where('nextStageAt', '<=', now)
      .orderBy('nextStageAt')
      .limit(50)
      .get();

    for (const doc of due.docs) {
      const order = doc.data() as any;

      // Money first, artwork second, and never out of a finished order. A
      // blocked order has its schedule CLEARED rather than pushed back an hour:
      // re-reading it every hour for days would spend the read quota on a job
      // that needs a human, not a clock. Staff moving it by hand re-plans it.
      const blocked = autoAdvanceBlockedReason(order);
      if (blocked) {
        await doc.ref.update({
          nextStageAt: null,
          stageHold: blocked,
          updatedAt: new Date().toISOString(),
        });
        continue;
      }

      const next = nextAutoStage(order.status ?? 'pending');
      if (!next) {
        await doc.ref.update({ nextStageAt: null, updatedAt: new Date().toISOString() });
        continue;
      }

      const at = new Date().toISOString();
      const history = Array.isArray(order.stageHistory) ? order.stageHistory : [];
      await doc.ref.update({
        status: next,
        stageSource: 'auto',
        stageChangedAt: at,
        stageHold: null,
        // The schedule is not recomputed here: it was set from the payment and
        // stays the promise. An order that missed three stages while the server
        // was off catches all three up, one per sweep, in order.
        nextStageAt: nextStageAtFor(next, order.stagePlan ?? null),
        // Capped, because this document already carries artwork and Firestore
        // stops at 1 MiB.
        stageHistory: [...history, { stage: next, at, by: 'auto' }].slice(-20),
        ...(next === 'completed' ? { deliveredAt: at } : {}),
        updatedAt: at,
      });
      advanced += 1;
      console.log(`Order ${doc.id} advanced to ${next} automatically.`);
    }
    return { ran: true, advanced, reason: 'ok' };
  } catch (err) {
    // A failed sweep is not a failed shop. Log it, tell the caller, try again
    // next tick.
    console.warn('The automatic stage sweep did not complete:', err);
    return { ran: false, advanced, reason: 'failed' };
  } finally {
    sweepRunning = false;
  }
}

// ---------------------------------------------------------------------------
// The stage sweep, as an endpoint.
//
// The sweep also runs as a setInterval inside this process (see the bottom of
// this file). This endpoint is the belt to that braces: the cPanel host calls it
// every 15 minutes, so orders keep advancing across a Passenger restart, and the
// sweep is still driven if the in-process timer is ever turned off.
//
//     */15 * * * *  curl -s -H "Authorization: Bearer $CRON_SECRET" \
//                        https://shop.reklamx.se/api/cron/auto-stages
//
// The secret is not optional. This endpoint moves customers' orders forward;
// left open, anyone could advance every due order in the shop at will, and could
// spend the Firestore read quota by calling it in a loop. If CRON_SECRET is not
// configured the endpoint refuses to run rather than running unprotected.
// ---------------------------------------------------------------------------
app.get('/api/cron/auto-stages', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'CRON_SECRET is not configured; the sweep endpoint is disabled.' });
  }
  // timingSafeEqual needs equal lengths, so compare digests rather than the
  // raw strings — and never leak the answer through how long the reply took.
  const offered = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(offered).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (process.env.AUTO_STAGE_SWEEP === 'off') {
    return res.json({ ok: true, swept: false, reason: 'AUTO_STAGE_SWEEP=off' });
  }

  // The result is reported as it actually happened. A sweep that could not run
  // must not answer 200 OK — that is precisely what a scheduler is watching for.
  const result = await sweepAutoStages();
  // Shipping rides along on the same schedule rather than on a cron of its own:
  // the platform allows a limited number of scheduled jobs, and a parcel's
  // status changes on the same sort of timescale as a production stage. A
  // failure here is reported, never fatal — the stages must still advance.
  const tracking = await sweepZendrTracking();
  // 5.7c — the retention the privacy policy promises. Rides the same schedule for
  // the same reason shipping does: the platform allows few scheduled jobs, and a
  // 30-day deletion does not need its own clock. Never fatal.
  const carts = await sweepAbandonedCarts(false).catch((err) => {
    console.error('Abandoned-cart retention sweep failed:', (err as any)?.message ?? err);
    return null;
  });
  if (result.ran) {
    return res.json({ ok: true, swept: true, advanced: result.advanced, tracking, carts });
  }
  // A sweep that could not run must not answer 200 OK — a scheduler watching
  // this endpoint would otherwise report a healthy shop through a dead sweep.
  if (result.reason === 'failed') {
    return res.status(500).json({ ok: false, swept: false, reason: 'failed' });
  }
  if (result.reason === 'no-database') {
    return res.status(503).json({ ok: false, swept: false, reason: 'no-database' });
  }
  return res.json({ ok: true, swept: false, reason: result.reason });
});

// ---------------------------------------------------------------------------
// GOOGLE SIGN-IN, ON OUR OWN DOMAIN.
//
// THE PROBLEM. Clicking "Sign in with Google" opened Google's account chooser
// reading "continue to gen-lang-client-0018052971.firebaseapp.com". The client
// saw that in front of his own customers and asked, reasonably, for it never to
// appear. It is not a label we can edit: Google shows the host of the OAuth
// redirect_uri, and @firebase/auth builds that as
// `https://<authDomain>/__/auth/handler`. The project id is immutable — an
// AI-Studio-generated id cannot be renamed — so the only way to change the
// string is to change the domain the handler is served from.
//
// THE FIX, which is Firebase's own documented pattern. `authDomain` in
// firebase-applet-config.json now says `shop.reklamx.se`, and this proxy serves
// the handler from there by passing the request through to the real one. Google
// then shows OUR domain, the popup's address bar shows our domain, and the
// hidden iframe every page of the shop loads is same-origin.
//
// It has to sit HERE, above startServer's two catch-alls: `/__/auth/handler` is
// extensionless and would be answered with index.html, and `/__/auth/iframe.js`
// has an extension and would get a text/plain 404.
//
// A SIDE BENEFIT worth knowing: with the handler first-party, its storage is
// first-party too, which is what repairs signInWithRedirect under Safari's ITP
// and Chrome's third-party-cookie partitioning.
//
// ⚠️ ORDER OF OPERATIONS ON DEPLOY. Google validates redirect_uri against the
// OAuth client's registered list. `https://shop.reklamx.se/__/auth/handler` must
// be added there BEFORE this ships, or every Google sign-in fails with
// redirect_uri_mismatch. Keep the old firebaseapp.com URI registered too.
// Overridable so the proxy can be pointed at a local echo and its behaviour
// asserted byte-for-byte by an end-to-end check. Nothing sets
// this in production; the default is the project's own Firebase handler.
const AUTH_UPSTREAM = process.env.AUTH_PROXY_UPSTREAM?.trim()
  || `https://${firebaseConfig.projectId}.firebaseapp.com`;

/**
 * The request body as it arrived, unparsed.
 *
 * Capped at 1 MB: an auth handler POST is a few kilobytes of form fields, and
 * an unbounded read here would be a way to make the server hold memory.
 */
function rawBody(req: express.Request): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > 1_000_000) {
        // PAUSE, do not destroy. Destroying the socket first meant the 502 the
        // caller then tried to send had no connection left to travel on, and the
        // browser saw a dropped request instead of an explanation.
        done = true;
        req.pause();
        reject(Object.assign(new Error('Auth request body too large.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('error', reject);
  });
}

app.all(['/__/auth', '/__/auth/*', '/__/firebase/*'], async (req, res) => {
  try {
    // Built through the URL parser, not by concatenation. `AUTH_UPSTREAM +
    // req.originalUrl` would let a raw request line like
    // "GET /__/auth/../../anything" address any path on the upstream origin
    // through our domain. new URL() normalises the dot segments, and the result
    // is then re-checked against the prefixes this route is allowed to proxy.
    const upstream = new URL(req.originalUrl, AUTH_UPSTREAM);
    if (upstream.origin !== new URL(AUTH_UPSTREAM).origin
      || !(upstream.pathname.startsWith('/__/auth') || upstream.pathname.startsWith('/__/firebase'))) {
      return res.status(404).type('text/plain').send('Not found');
    }

    // A deliberately small allowlist. Never forward the shop's own Host or
    // cookies: the upstream is a different origin, Firebase Hosting's edge
    // routes on Host, and our session cookies are none of its business.
    const headers: Record<string, string> = {};
    for (const name of ['accept', 'accept-language', 'content-type', 'user-agent']) {
      const v = req.get(name);
      if (v) headers[name] = v;
    }

    const upstreamRes = await fetch(upstream.toString(), {
      method: req.method,
      headers,
      // GET and HEAD may not carry a body.
      // THE RAW BYTES, exactly as the browser sent them.
      //
      // This used to send JSON.stringify(req.body). For the redirect flow that
      // is not merely lossy, it is wrong twice: Google POSTs back as
      // application/x-www-form-urlencoded, so the parser above leaves req.body
      // an empty object, and the proxy would forward the two characters "{}"
      // under a form content-type — the sign-in response replaced by nothing,
      // with no error to say so. The body parser is now skipped for these
      // routes and the stream is read verbatim.
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : await rawBody(req),
      // 'manual', so a 302 is RELAYED to the browser rather than followed here —
      // following it would return the destination's body under our URL and break
      // the OAuth dance.
      redirect: 'manual',
      // Bounded. The live host runs a handful of Passenger workers; a slow
      // upstream with no timeout ties one up per stalled sign-in.
      signal: AbortSignal.timeout(20_000),
    });

    // X-Frame-Options is stamped on every response by the middleware at the top
    // of this file. The auth iframe is framed by our own page, so SAMEORIGIN
    // happens to pass — but that is luck, not design. Take ours off and let the
    // upstream's own framing headers stand.
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    // And Cross-Origin-Opener-Policy. The middleware stamps
    // same-origin-allow-popups on every response, which is right for OUR pages —
    // they are the opener — and is not ours to impose on a document Firebase
    // serves inside the sign-in flow. Once authDomain points here this response
    // IS the popup, and its opener relationship is the whole mechanism.
    res.removeHeader('Cross-Origin-Opener-Policy');

    const type = upstreamRes.headers.get('content-type');
    if (type) res.setHeader('Content-Type', type);
    const location = upstreamRes.headers.get('location');
    if (location) res.setHeader('Location', location);
    for (const h of ['cache-control', 'x-frame-options', 'content-security-policy']) {
      const v = upstreamRes.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    // Set-Cookie, through getSetCookie() — headers.get('set-cookie') JOINS
    // multiple cookies into one comma-separated string that no browser will
    // parse, so a flow setting two cookies would lose both. The Domain
    // attribute is stripped: it names the upstream's own host, and a browser
    // silently discards a cookie scoped to a domain it is not on.
    const cookies = typeof (upstreamRes.headers as any).getSetCookie === 'function'
      ? (upstreamRes.headers as any).getSetCookie()
      : [];
    if (Array.isArray(cookies) && cookies.length) {
      res.setHeader('Set-Cookie', cookies.map((c: string) => c.replace(/;\s*Domain=[^;]*/i, '')));
    }
    // content-encoding and content-length are deliberately NOT copied: fetch has
    // already decompressed the body, so echoing them yields a response the
    // browser cannot decode or truncates.

    const buf = Buffer.from(await upstreamRes.arrayBuffer());
    return res.status(upstreamRes.status).send(buf);
  } catch (err: any) {
    // Sign-in failing is bad; sign-in failing SILENTLY is worse. Log it, and say
    // plainly that it is the proxy rather than the customer's credentials.
    console.error('Auth handler proxy failed:', err?.message ?? err);
    return res.status(502).type('text/plain').send('Sign-in is temporarily unavailable.');
  }
});

async function startServer() {
  // An unknown /api/ path used to fall through to the SPA and answer with a
  // 200 and a page of HTML. Anything calling the API then tried to parse
  // "<!doctype html…" as JSON and reported a confusing parse error instead of
  // "that endpoint does not exist". Registered here, before the SPA handlers,
  // so it guards the dev (Vite middleware) branch as well — it used to sit in
  // the production branch only, and dev answered 200 text/html.
  // '/api' as well as '/api/*': the bare path would otherwise fall through to
  // Express's own handler and answer a page of HTML.
  app.all(['/api', '/api/*'], (_req, res) => {
    res.status(404).json({ error: 'No such endpoint.' });
  });

  // A request for a FILE that does not exist must say so.
  //
  // Same bug as the /api/* one above, one layer down: every unmatched path fell
  // through to the SPA and answered 200 with a page of HTML. A missing script
  // chunk came back as HTML and the browser failed on the MIME type instead of a
  // clean 404; a missing image came back as HTML and rendered as a broken tile;
  // and every monitor, crawler and test that asked "does this asset exist?" was
  // told yes. A verification suite here reported "24 illustrations all serve 200"
  // for a directory it could not actually have checked.
  //
  // In DEV, Vite's spa middleware owns the fallback and never calls next(), so the
  // guard has to run first — and it must only speak for paths that belong to
  // `public/`, or it would swallow /src/*.tsx and Vite's own dependency chunks.
  const PUBLIC_DIR = path.join(process.cwd(), 'public');
  const publicEntries = new Set<string>(
    fs.existsSync(PUBLIC_DIR) ? fs.readdirSync(PUBLIC_DIR) : [],
  );
  app.get('*', (req, res, next) => {
    if (!path.extname(req.path)) return next();
    const [firstSegment] = req.path.slice(1).split('/');
    if (!publicEntries.has(firstSegment)) return next();
    const onDisk = path.join(PUBLIC_DIR, ...req.path.slice(1).split('/'));
    // path.resolve, not string concatenation: '/product-art/../../.env' must not
    // be answerable, and must not be reported as "found" either.
    if (!path.resolve(onDisk).startsWith(path.resolve(PUBLIC_DIR))) {
      return res.status(404).type('text/plain').send('Not found');
    }
    if (fs.existsSync(onDisk)) return next();
    return res.status(404).type('text/plain').send('Not found');
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    // Imported through a variable, not a literal, so that bundlers cannot
    // follow it: esbuild would otherwise drag the whole Vite toolchain into
    // dist/server.cjs, which never executes a line of it in production.
    const viteModuleId = 'vite';
    const { createServer: createViteServer } = await import(viteModuleId);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');

    // THE SERVER'S OWN SOURCE LIVES IN THE DIRECTORY IT SERVES TO THE PUBLIC.
    //
    // The build writes dist/server.cjs (Passenger's startup file) and
    // dist/server.cjs.map alongside index.html and assets/, and express.static
    // handed both to anyone who asked. Measured against the live shop on
    // 2026-09-01: GET /server.cjs answered 200 with 138 116 bytes and
    // /server.cjs.map answered 200 with 330 933 bytes — the second one is the
    // complete original TypeScript of this file.
    //
    // No literal secret is in either: every key is read from process.env at
    // runtime. What it hands over is every defensive decision in the shop — the
    // admin check, the price formula the quote endpoint will accept, how
    // CRON_SECRET is compared, which endpoints are unauthenticated, and the
    // exact rate-limit constants — which turns guesswork into reading.
    //
    // Registered BEFORE express.static so it wins, and it covers the map even
    // when the map is not shipped, so a stray build output can never re-open
    // this. Passenger still reads the file off disk; only the HTTP route is shut.
    //
    // BY THE NAME AS THE FILE SERVER WILL READ IT (SRV-01). This was a route on
    // the two literal paths, and a route matches the path as SENT, while
    // express.static decodes and normalises it before it opens anything: so
    // `/server%2ecjs`, `/server.cjs%2emap`, `//server.cjs`, `/./server.cjs` and
    // `/assets/../server.cjs` all answered 200 with the file. Every method, any
    // folder, any case (a case-blind disk would serve SERVER.CJS too).
    //
    // ANY SEGMENT, NOT THE LAST (review 2026-10-11, B). The name was judged by the
    // last segment, and `/server.cjs/.`, `/server.cjs/%2e`, `/server.cjs%2f.` and
    // `/server.cjs/x/..` end in a dot segment that the file server resolves away —
    // so it opened server.cjs although the last segment was `.` or `..`. A path
    // that names the file anywhere in it, by either slash, is refused.
    app.use((req, res, next) => {
      let asRead = req.path;
      try {
        asRead = decodeURIComponent(req.path);
      } catch {
        // A malformed escape: judged as sent — the file server refuses it as well.
      }
      if (asRead.split(/[\\/]/).some((segment) => /^server\.cjs(\.map)?$/i.test(segment))) {
        return res.status(404).type('text/plain').send('Not found');
      }
      return next();
    });

    // express.static will happily serve dist/index.html to anyone who asks for
    // it BY NAME — the same bytes as `/`, at a second address, carrying the
    // generic fallback head rather than the front page's own. One canonical
    // address, one page.
    app.get('/index.html', (_req, res) => res.redirect(301, '/'));

    // ------------------------------------------------------------------
    // WHAT A CRAWLER SEES. robots.txt, a sitemap that rebuilds itself from the
    // catalogue, and the picture route the share cards need. Registered before
    // express.static so they cannot be shadowed by a stray file in dist/.
    // ------------------------------------------------------------------
    app.get('/robots.txt', async (req, res) => {
      // The owner's own rules, if he wrote any. Cached the same ten minutes as
      // the rest of the settings, so this stays one read per ten minutes however
      // many crawlers ask for it.
      const { seo } = await getSeoConfig(fetchSiteConfig);
      res.type('text/plain');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buildRobots(originFrom(req as never), seo));
    });

    app.get('/sitemap.xml', async (req, res) => {
      const products = await getCatalogue(getAdminDb()).catch(() => []);
      const { seo } = await getSeoConfig(fetchSiteConfig);
      res.type('application/xml');
      // An hour: long enough that a crawl storm costs one Firestore read,
      // short enough that a product added this morning is listed by lunch.
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buildSitemap(originFrom(req as never), products, seo));
    });

    // THE GOOGLE SHOPPING FEED.
    //
    // 404 until the owner switches it on, and that is deliberate: Merchant
    // Center polls whatever address it is given, and an empty or half-built feed
    // becomes a stream of policy warnings against the account rather than a
    // quiet nothing. A 404 it simply reports as "could not fetch".
    app.get(['/feed.xml', '/merchant-feed.xml'], async (req, res) => {
      try {
        const { seo, siteName } = await getSeoConfig(fetchSiteConfig);
        if (!seo.merchant?.enabled) {
          return res.status(404).type('text/plain').send('The product feed is switched off.');
        }
        const products = await getCatalogue(getAdminDb()).catch(() => []);
        // The same cached rate the product pages use, so the feed and the page
        // cannot disagree even for the ten minutes a cache could drift.
        const vatRate = await getVatRate();
        // The delivery prices checkout charges, per country (src/lib/shipping.ts)
        // — not a separate number typed into the Google tab, which said "free
        // delivery" in the ads while checkout charged 99 kr. From the same
        // ten-minute copy as the VAT rate; if there is none, this throws and the
        // feed answers 503 rather than advertising a guess.
        const shippingLines = feedShippingLines(normaliseShipping((await getPrintSettingsCached())?.shipping), vatRate);

        res.type('application/xml');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.send(
          buildProductFeed(products, { origin: originFrom(req as never), siteName, seo, vatRate, shippingLines }),
        );
      } catch (err) {
        console.warn('feed.xml failed —', (err as Error).message);
        if (!res.headersSent) res.status(503).type('text/plain').send('The feed is not available right now.');
        return undefined;
      }
    });

    // A product photo, as an ordinary image URL.
    //
    // The photos are stored as data: URLs inside the product document, which no
    // crawler and no chat app can render — so a link to a product pasted into
    // WhatsApp showed the generic site icon, or nothing. This decodes one and
    // serves it as the image it is. Immutable for a year: the address contains
    // the product id and the index, and editing a photo changes neither, so the
    // cache is deliberately short-circuited by ?v= on the share tag if that is
    // ever needed. Only the FIRST few images are exposed; this is a share card,
    // not a file server.
    app.get('/media/product/:productId/:index', async (req, res) => {
      try {
        return await serveProductImage(req, res);
      } catch (err) {
        // Express 4 does not observe a rejected promise from an async handler,
        // and Node 22 kills the process on an unhandled rejection. One
        // malformed URL would have taken the whole shop offline.
        console.warn('media/product failed —', (err as Error).message);
        if (!res.headersSent) res.status(404).type('text/plain').send('Not found');
        return undefined;
      }
    });

    const serveProductImage = async (req: express.Request, res: express.Response) => {
      const index = Number.parseInt(String(req.params.index), 10);
      if (!Number.isInteger(index) || index < 0 || index > 9) {
        return res.status(404).type('text/plain').send('Not found');
      }
      const products = await getCatalogue(getAdminDb());
      const product = findProduct(products, String(req.params.productId));
      const src = product?.images?.[index];
      if (!src) return res.status(404).type('text/plain').send('Not found');
      // The URL comes from a product document, so it is only as trustworthy as
      // the dashboard. Redirecting to whatever it says would turn this route
      // into an open redirect wearing the shop's own domain — and a `javascript:`
      // or `data:text/html` value would be worse than that. Only http(s) is
      // followed; anything else is simply not an image we can serve.
      if (!src.startsWith('data:')) {
        return /^https?:\/\//i.test(src)
          ? res.redirect(302, src)
          : res.status(404).type('text/plain').send('Not found');
      }

      const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(src);
      if (!match) return res.status(404).type('text/plain').send('Not found');
      const buffer = Buffer.from(match[2], 'base64');
      res.setHeader('Content-Type', match[1]);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Length', String(buffer.length));
      return res.send(buffer);
    };

    app.use(
      express.static(distPath, {
        // index: false so that `/` falls through to the SPA handler below and
        // gets its head written like every other address. With the default,
        // express.static answered the front page itself — the one page most
        // likely to be shared — with the generic shell.
        index: false,
        // Vite fingerprints these filenames, so a year is safe and saves the
        // whole bundle being re-fetched on every visit.
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );

    app.get('*', (req, res) => {
      // In production everything servable has already been tried by
      // express.static above, so anything left that names a file is missing.
      // Extensionless paths are app routes and still get the SPA shell.
      if (path.extname(req.path)) {
        return res.status(404).type('text/plain').send('Not found');
      }
      // THE SHELL IS NEVER CACHED WITHOUT ASKING.
      //
      // express.static sets `no-cache` on index.html, but only `/` reaches it.
      // Every deep link — /products/rollup-standard, /checkout, /admin — is an
      // extensionless app route that lands here instead, and sendFile sets no
      // Cache-Control at all. Browsers then apply their own heuristic and hold a
      // shell that points at last week's bundle, so a customer who had visited
      // before kept seeing the old shop until they hit reload by hand.
      //
      // The hashed assets it references stay immutable for a year; this one file
      // is what has to be re-read to learn their new names.
      res.setHeader('Cache-Control', 'no-cache');

      // THE HEAD IS WRITTEN HERE, not by React.
      //
      // Helmet still rewrites the title in a real browser; this is what
      // everything that does not run JavaScript receives — and what Google
      // indexes on its first pass. If anything at all goes wrong we fall back
      // to sending the file untouched: a page with a generic title is a
      // nuisance, a page that fails to render is a lost customer.
      void (async () => {
        try {
          const html = readShell(distPath);
          const origin = originFrom(req as never);
          // A DEADLINE, because the head is a nice-to-have and the page is not.
          // This used to await Firestore with no timeout on every HTML
          // response: a degraded firestore.googleapis.com meant the shop served
          // nothing at all, where before this feature existed it served the
          // shell off local disk regardless. 700ms is far longer than a warm
          // cache needs (both values are cached for ten minutes) and far
          // shorter than a customer will wait.
          const meta = await withDeadline(
            (async () => {
              const products = await getCatalogue(getAdminDb());
              const { siteName, seo } = await getSeoConfig(fetchSiteConfig);
              // The rate the structured price is built with — the same one the
              // feed uses, read from the same setting, so the two can never
              // disagree about what a consumer pays. CACHED: see getVatRate.
              const metaVatRate = await getVatRate();
              return metaForPath(req.path, {
                origin,
                siteName,
                products,
                // A category page's canonical names its category.
                category: typeof req.query.category === 'string' ? req.query.category : undefined,
                vatRate: metaVatRate,
                defaultImage: `${origin}/og-image.png`,
                // The owner's titles, descriptions, share image and verification
                // tokens. Absent until he writes one, and then this is where they
                // reach the page — no deploy in between.
                seo,
              });
            })(),
            700,
          );
          // An address that is no page of the shop's is sent as a 404 — the app
          // still draws its own "not found" screen, but a crawler is no longer
          // told it found a page. Only when we could look: a timed-out head
          // sends the plain shell with a 200, as before.
          if (meta?.status) res.status(meta.status);
          res.send(meta ? injectHead(html, meta) : html);
        } catch (err) {
          console.warn('SEO: serving the plain shell —', (err as Error).message);
          // If the failure happened after res.send() had already started, a
          // second write would throw ERR_HTTP_HEADERS_SENT and take the request
          // down with it — a blank page instead of a shop.
          if (!res.headersSent) res.sendFile(path.join(distPath, 'index.html'));
        }
      })();
    });
  }

  // Railway needs 0.0.0.0. Set HOST=127.0.0.1 (local .env) to keep the shop
  // on this machine only — nothing else on the Wi-Fi can then reach it.
  const HOST = process.env.HOST || '0.0.0.0';
  // A socket has no host to bind to — passing one makes listen() ignore the
  // socket and open a TCP port instead, which is how this fails silently.
  const started = () => {
    console.log(
      LISTENING_ON_SOCKET
        ? `ReklamX full-stack server listening on socket ${PORT}`
        : `ReklamX full-stack server running on http://localhost:${PORT} (bound to ${HOST})`,
    );

    // Fill the SEO caches now, in the background. Otherwise the first request
    // after a restart is the one that waits for Firestore, and on a crawler
    // that is the request that decides what the page looks like in the index.
    void getCatalogue(getAdminDb()).catch(() => undefined);
    void getSeoConfig(fetchSiteConfig).catch(() => undefined);

    if (AUTO_STAGE_SWEEP_ENABLED) {
      // unref(), so the sweep timer never keeps the process alive on its own —
      // a shutdown must be a shutdown.
      const timer = setInterval(() => {
        void sweepAutoStages();
        // 5.7c — and the retention the policy promises, on the same clock. In
        // this process as well as on the cron endpoint, so a host whose cron is
        // not wired still keeps the promise.
        void sweepAbandonedCarts(false).catch(() => undefined);
      }, AUTO_STAGE_SWEEP_MINUTES * 60 * 1000);
      timer.unref?.();
      // One at boot, so a server that has been off catches up immediately
      // instead of after the first quarter of an hour.
      void sweepAutoStages();
      console.log(`Automatic order stages: on, sweeping every ${AUTO_STAGE_SWEEP_MINUTES} min.`);
    } else {
      console.log('Automatic order stages: off (AUTO_STAGE_SWEEP=off).');
    }
  };

  if (LISTENING_ON_SOCKET) {
    app.listen(PORT as string, started);
  } else {
    app.listen(PORT as number, HOST, started);
  }
}

// THE SAFETY NET. Express 4 does not catch a rejected async route, and Node 22 ends the
// process on any unhandled rejection: one request that throws outside its try took
// the whole shop down, every other customer's request and payment with it. Logged,
// and the server keeps serving; the routes themselves still answer their own errors.
// A start-up that fails is different — that one must still stop the process.
process.on('unhandledRejection', (reason: any) => {
  console.error('Unhandled rejection (the server keeps running):', reason?.stack ?? reason);
});

startServer().catch((err) => {
  console.error('The server could not start:', err);
  process.exit(1);
});

// Exported so a test or a script can mount the app without starting a listener.
export default app;
export { app };
