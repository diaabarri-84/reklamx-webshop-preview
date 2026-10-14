// Telling the server a basket exists — plan task 5.7c.
//
// THE POINT, and the limit of it. The owner cannot see how much money walks
// away, because the basket lives in the customer's browser and nothing else has
// ever known about it. This sends a SUMMARY — never the artwork, never a file
// name; see src/lib/cartSnapshot.ts — so an "abandoned baskets" report can
// exist. It is the same reasoning as 4.24: the figure cannot be recovered later,
// so it has to be recorded as it happens.
//
// WHERE IT HOOKS, and why that is the whole design.
//
// src/lib/cart.ts says writeCart() is "THE ONLY WAY THE BASKET IS WRITTEN". It is
// not: addConfiguredLineToCart() calls localStorage.setItem itself (cart.ts:182),
// and that is the path the configurator and the product page use — most baskets.
// Hooking writeCart would have missed them and produced a report that looked
// like it worked.
//
// All three paths call announceCartChange(), which dispatches CART_CHANGED_EVENT.
// So this listens to the EVENT, not to any function.
//
// FOUR RULES IT NEVER BREAKS:
//   1. SIGNED-IN CUSTOMERS ONLY. The shop sets no cookie of its own and has no
//      anonymous visitor id; inventing one to follow people who have not
//      identified themselves is a different decision, and not this one.
//   2. It can never break or slow a purchase. Every path is fire-and-forget
//      inside try/catch, it runs after a delay, and nothing waits on it.
//   3. It writes only when the basket's CONTENT changed — the fingerprint — and
//      at most once in QUIET_MS. A shop on a free Firestore tier that has gone
//      dark three times cannot afford a write per keystroke.
//   4. It sends nothing for an empty or worthless basket.

import { CART_CHANGED_EVENT, CART_STORAGE_KEY } from './cartKeys';
import { snapshotCart, worthRecording, type CartSnapshot } from './cartSnapshot';

/** Wait for the customer to stop fiddling before saying anything. */
const QUIET_MS = 20_000;
/** And never more often than this, however much they fiddle. */
const MIN_GAP_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSentFingerprint: string | null = null;
let lastSentAt = 0;
let getToken: (() => Promise<string | null>) | null = null;

/** Read the basket without letting a corrupt one throw into the shop. */
function readCart(): unknown[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function send(snapshot: CartSnapshot, converted = false): Promise<void> {
  try {
    const token = getToken ? await getToken() : null;
    // No token, no send. This is the rule that keeps the feature to customers
    // who have identified themselves.
    if (!token) return;
    await fetch('/api/cart/snapshot', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...snapshot, converted }),
      // The basket is the customer's; this is bookkeeping. If the tab closes
      // mid-flight, losing it costs a row in a report and nothing else.
      keepalive: true,
    });
    lastSentFingerprint = snapshot.fingerprint;
    lastSentAt = Date.now();
  } catch {
    /* A report must never be able to interrupt a purchase. */
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      const snapshot = snapshotCart(readCart());
      if (!worthRecording(snapshot)) return;
      if (snapshot.fingerprint === lastSentFingerprint) return;
      if (Date.now() - lastSentAt < MIN_GAP_MS) return;
      void send(snapshot);
    } catch {
      /* nothing here may throw into the shop */
    }
  }, QUIET_MS);
}

/**
 * Start listening. Call once, from the app shell.
 *
 * @param tokenProvider returns the signed-in customer's token, or null. Passed in
 *   rather than imported so this module never reaches into Firebase itself — it
 *   has to be safe to load on a page that has no auth at all.
 */
let stopPrevious: (() => void) | null = null;

export function startCartBeacon(tokenProvider: () => Promise<string | null>): () => void {
  if (typeof window === 'undefined') return () => {};
  // STARTED TWICE, LISTENING ONCE. React runs an effect twice on mount in
  // StrictMode, and a second listener would mean a second write for every basket
  // change — on a project whose Firestore quota has taken the shop dark three
  // times. The cleanup makes that safe on its own; this makes it safe even if a
  // caller forgets to run it.
  if (stopPrevious) stopPrevious();
  getToken = tokenProvider;
  const onChange = () => schedule();
  window.addEventListener(CART_CHANGED_EVENT, onChange);
  const stop = () => {
    window.removeEventListener(CART_CHANGED_EVENT, onChange);
    if (timer) clearTimeout(timer);
    timer = null;
    if (stopPrevious === stop) stopPrevious = null;
  };
  stopPrevious = stop;
  return stop;
}

/**
 * The basket became an order — stop counting it as abandoned.
 *
 * Called at checkout, and deliberately NOT left to the server to infer: an order
 * is placed before it is paid, and the customer may pay minutes later on a page
 * this code never runs on.
 */
export function markCartConverted(): void {
  try {
    const snapshot = snapshotCart(readCart());
    void send(snapshot, true);
  } catch {
    /* see above */
  }
}

/** For the tests: forget what has been sent. */
/**
 * Forget what has been sent. It does NOT remove the listener — that is what the
 * function `startCartBeacon` returns is for, and having reset do it silently
 * made half a test file vacuous: every block after the first reset fired a cart
 * change at nothing, passed its "nothing was sent" assertion for the wrong
 * reason, and left a primed network failure behind for a later test to trip on.
 */
export function resetCartBeaconForTests(): void {
  lastSentFingerprint = null;
  lastSentAt = 0;
  if (timer) clearTimeout(timer);
  timer = null;
}
