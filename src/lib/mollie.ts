// Mollie, server-side only.
//
// The API key is a secret: anyone holding it can create and refund payments on
// the shop's account. It is read from the environment and never reaches the
// bundle — this module is imported by server.ts alone.
//
// When no key is configured the shop still works: it quotes prices and takes
// orders, and says plainly that online payment is unavailable rather than
// pretending an order was paid. That is also how it behaves before the client
// has sent us their key.

// The named import, not the default: the package ships CJS, and under an ESM
// runtime (tsx in dev) the default import binds to the whole exports object —
// createMollieClient({...}) then crashes at the first real payment. The named
// export is the same function and resolves correctly under both tsx and the
// esbuild CJS production bundle.
import { createMollieClient, type MollieClient, type Locale } from '@mollie/api-client';

let client: MollieClient | null = null;
// The key the cached client was built with. The key can now CHANGE while the
// process runs — the owner pastes a new one into the dashboard and the loader
// in server.ts updates the environment — so caching on "have I built one?"
// would keep charging through the old key until a restart. Cache on the key.
let builtWith: string | null = null;

export function getMollie(): MollieClient | null {
  const apiKey = process.env.MOLLIE_API_KEY?.trim() ?? '';
  if (client && builtWith === apiKey) return client;

  client = null;
  const firstLook = builtWith === null;
  builtWith = apiKey;

  if (!apiKey) {
    if (firstLook) console.warn('MOLLIE_API_KEY is not set — online payment is disabled.');
    return null;
  }
  if (!/^(test|live)_/.test(apiKey)) {
    console.error('MOLLIE_API_KEY does not look like a Mollie key (it should start with test_ or live_).');
    return null;
  }

  client = createMollieClient({ apiKey });
  console.log(`Mollie ready — ${apiKey.startsWith('live_') ? 'LIVE' : 'test'} mode.`);
  return client;
}

/**
 * Ask Mollie whether a key is real before anything is saved.
 *
 * The dashboard's key panel calls this with whatever the owner pasted. A typo'd
 * key that was saved unchecked would not fail here and now — it would fail at
 * the next customer's payment, which is the worst possible moment to learn
 * about it. methods.list() is free, read-only and works for test and live keys.
 */
export async function verifyMollieKey(apiKey: string): Promise<{ ok: boolean; reason?: string }> {
  const key = apiKey.trim();
  if (!/^(test|live)_[A-Za-z0-9]{10,}$/.test(key)) {
    return { ok: false, reason: 'That does not look like a Mollie key — it should start with test_ or live_.' };
  }
  try {
    const probe = createMollieClient({ apiKey: key });
    // The client has no abort signal of its own; without this cap a wedged
    // network turns "Verify & save" into a button that never answers.
    await Promise.race([
      probe.methods.list(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Mollie did not answer within 15s — try again.')), 15_000)),
    ]);
    return { ok: true };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/401|invalid|authentication/i.test(msg)) {
      return { ok: false, reason: 'Mollie rejected this key. Copy it again from my.mollie.com → Developers → API keys.' };
    }
    return { ok: false, reason: `Could not reach Mollie to verify the key: ${msg.slice(0, 120)}` };
  }
}

export function isMollieLive(): boolean {
  return (process.env.MOLLIE_API_KEY ?? '').startsWith('live_');
}

/** One payment method, trimmed to what the checkout may see. */
export type PublicMollieMethod = {
  id: string;
  /** Mollie's own name for it, translated when a locale was passed. */
  description: string;
  /** Mollie's brand mark. Their SVG, so the shop does not have to draw one per brand. */
  imageSvg: string | null;
  image2x: string | null;
  minimumAmount: number | null;
  maximumAmount: number | null;
};

/**
 * OUR language codes to Mollie's. There is no `no_NO`; Norwegian bokmål is nb_NO,
 * and Mollie rejects an unknown locale rather than ignoring it.
 */
const MOLLIE_LOCALES: Record<string, string> = {
  en: 'en_GB', sv: 'sv_SE', da: 'da_DK', no: 'nb_NO',
};
export function mollieLocale(language?: string): Locale | undefined {
  // The values in MOLLIE_LOCALES are enum members spelled out; Mollie's own
  // Locale enum is a string enum over exactly these strings.
  return MOLLIE_LOCALES[String(language ?? '').toLowerCase()] as Locale | undefined;
}

/**
 * WHAT THIS SHOP CAN ACTUALLY BE PAID WITH, asked of Mollie rather than guessed.
 *
 * The owner switches methods on and off in his own Mollie dashboard — turn on
 * PayPal there and it should appear at this checkout without anybody editing
 * code. Until now the shop showed one flat "Card, Swish or bank" card and left
 * the real list to Mollie's hosted page, so the customer only discovered what
 * was on offer after committing to pay.
 *
 * Three parameters decide whether this works at all:
 *
 *  - `amount` is effectively MANDATORY here. Mollie returns Euro-only methods by
 *    default; this shop charges SEK, so without it Swish is missing from a list
 *    that shows it live on the hosted page.
 *  - `includeWallets` — without it Apple Pay and Google Pay are not returned at
 *    all, even though they are the first two buttons the owner sees today.
 *  - `locale` both sorts the list into the country's preferred order and
 *    translates the names ("Kort", "Banköverföring").
 *
 * `resource` is deliberately left at its default of 'payments': /api/checkout/pay
 * uses payments.create, and asking for 'orders' would return Orders-API-only
 * methods (Klarna Pay later, meal vouchers) that this checkout could not honour.
 */
export async function listMollieMethods(params: {
  amount?: number;
  currency?: string;
  locale?: Locale;
  billingCountry?: string;
}): Promise<PublicMollieMethod[]> {
  const mollie = getMollie();
  if (!mollie) return [];

  const query: Record<string, unknown> = { includeWallets: 'applepay,googlepay' };
  if (Number.isFinite(params.amount) && (params.amount as number) > 0) {
    query.amount = toMollieAmount(params.amount as number, params.currency ?? 'SEK');
  }
  if (params.locale) query.locale = params.locale as Locale;
  if (params.billingCountry) query.billingCountry = params.billingCountry;

  // Same 15s cap as verifyMollieKey, for the same reason: the SDK has no abort
  // signal, and a wedged network must not hold a checkout render open.
  const list: any = await Promise.race([
    (mollie.methods as any).list(query),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Mollie did not answer within 15s.')), 15_000)),
  ]);

  const amountOf = (a: any): number | null => {
    const n = Number(a?.value);
    return Number.isFinite(n) ? n : null;
  };

  return (Array.isArray(list) ? list : [])
    // `status` is null on some responses and 'activated' | 'pending-boarding' |
    // 'pending-review' | 'pending-external' | 'rejected' on others. Only a method
    // that is actually activated may be shown: a half-onboarded PayPal offered at
    // checkout is a promise the payment page cannot keep.
    .filter((m: any) => m && m.id && (m.status == null || m.status === 'activated'))
    .map((m: any) => ({
      id: String(m.id),
      description: String(m.description ?? m.id),
      // Mollie's own artwork, never `pricing` or `_links` — pricing is the
      // shop's private fee agreement and has no business in a public response.
      imageSvg: typeof m.image?.svg === 'string' ? m.image.svg : null,
      image2x: typeof m.image?.size2x === 'string' ? m.image.size2x : null,
      minimumAmount: amountOf(m.minimumAmount),
      maximumAmount: amountOf(m.maximumAmount),
    }));
}

/**
 * Mollie wants the amount as a STRING with exactly two decimals — 12 is rejected,
 * "12.00" is accepted — and a float would eventually send "12.299999999999999".
 */
export function toMollieAmount(value: number, currency = 'SEK') {
  return { currency, value: (Math.round(Number(value) * 100) / 100).toFixed(2) };
}

/**
 * Where the customer comes back to, and where Mollie tells us what happened.
 *
 * Mollie must be able to REACH the webhook, so it has to be a public address.
 * On localhost there is none, which is why the final end-to-end test only works
 * once the site is deployed (or behind a tunnel). PUBLIC_URL is how a host tells
 * us its own address.
 */
export function publicBaseUrl(req: { protocol: string; get(name: string): string | undefined }): string {
  const configured = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;

  // Falling back to the request headers is a development convenience and nothing
  // more. Host and X-Forwarded-Host are supplied by whoever made the request, so
  // in production they let a stranger point the customer's "return from payment"
  // link — and Mollie's webhook — at a site of their choosing. Off localhost we
  // refuse rather than build a URL we cannot vouch for.
  const host = req.get('x-forwarded-host') || req.get('host') || '';
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i.test(host);

  if (!isLocal) {
    throw new Error(
      'PUBLIC_URL is not set. Set it to the shop\'s own address (for example https://reklamx.se) before taking payments.',
    );
  }
  return `${proto}://${host}`;
}

/** True when Mollie could actually call us back at this address. */
export function isPubliclyReachable(baseUrl: string): boolean {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/i.test(baseUrl);
}
