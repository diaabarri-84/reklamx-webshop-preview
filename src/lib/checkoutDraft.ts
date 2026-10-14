// The half-typed checkout form, and when it must be forgotten.
//
// WHAT WAS WRONG, and it was live.
//
// CheckoutPage saved the form to localStorage on every keystroke — company, org
// number, first and last name, both address lines, postcode, city, country,
// e-mail, billing e-mail, telephone and the free-text comments — under
// `reklamx_checkout_form`. It was deleted in exactly ONE place: OrderStatusPage,
// after a payment is CONFIRMED.
//
// So a customer who filled the form in and did not pay left their full name,
// address, telephone and e-mail sitting in that browser INDEFINITELY. On a shared
// machine — a shop floor, a library, a family laptop — the next person to open
// the checkout had it typed in for them. And the cookie policy did not disclose
// the key at all: it lists the basket, the language, the currency and the VAT
// setting, and stops there.
//
// The recall itself is worth keeping: a customer whose payment failed should not
// have to type their address again. What it must not do is keep it for ever.
//
// Below it, the tab's pay-on-delivery attempt: the other piece of checkout state
// this browser keeps, and when it ends. The storage is passed in, so all of it is
// tested in scripts/test-checkout-draft.mjs.

export const CHECKOUT_DRAFT_KEY = 'reklamx_checkout_form';

/**
 * How long a half-finished checkout is remembered.
 *
 * Long enough to be the feature it is meant to be — a failed card, a lost
 * connection, a customer who goes to find their organisation number and comes
 * back — and short enough that it is not a record of who used this machine.
 */
export const DRAFT_TTL_HOURS = 24;

export interface StoredDraft {
  /** When it was last typed into. Absent on drafts written before this existed. */
  savedAt?: string;
  [field: string]: unknown;
}

/**
 * Is this draft still the customer's, or is it a stranger's leftovers?
 *
 * A draft with NO timestamp is one written before this shipped. It is refused:
 * there is no way to tell a five-minute-old one from a five-month-old one, and
 * the safe reading of "I do not know how old this personal data is" is to drop
 * it. The cost is one customer retyping an address once.
 */
export function draftIsFresh(draft: StoredDraft | null | undefined, nowMs: number, ttlHours = DRAFT_TTL_HOURS): boolean {
  if (!draft || typeof draft !== 'object') return false;
  const savedAt = Date.parse(String(draft.savedAt ?? ''));
  if (!Number.isFinite(savedAt)) return false;
  // A timestamp in the future is a clock that has been changed, not a fresh
  // draft. Treated as stale rather than trusted.
  if (savedAt > nowMs) return false;
  return nowMs - savedAt < ttlHours * 60 * 60 * 1000;
}

/** True when the draft holds anything that identifies a person. */
export function draftHasPersonalData(draft: StoredDraft | null | undefined): boolean {
  if (!draft || typeof draft !== 'object') return false;
  for (const field of ['firstName', 'lastName', 'email', 'billingEmail', 'phone', 'address1', 'company', 'taxId']) {
    if (String(draft[field] ?? '').trim()) return true;
  }
  return false;
}

/** Stamp a draft on its way to storage. */
export function stampDraft<T extends Record<string, unknown>>(fields: T, nowIso: string): T & { savedAt: string } {
  return { ...fields, savedAt: nowIso };
}

/**
 * Forget the half-typed checkout NOW — at sign-out (code review 2026-10-11, M). A day
 * is right for a customer whose card failed; on a shared computer, the next person to
 * open the checkout found the last one's name, address and telephone typed in.
 */
export function clearCheckoutDraft(
  storage: Pick<Storage, 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
  try {
    storage?.removeItem(CHECKOUT_DRAFT_KEY);
  } catch {
    /* a storage that refuses keeps nothing either */
  }
}

// ---------------------------------------------------------------------------
// THE PAY-ON-DELIVERY ATTEMPT — one per basket, kept for this tab.
//
// An order paid on delivery goes straight into production, so pressing again
// must name the same attempt: the server then answers with the order it already
// made. The attempt lives as long as the basket that made it. It used to be
// forgotten at the checkout's answer (PAY-22), but the basket is only emptied
// once the order page has the order: Back, or an order page too slow to load,
// and Place order again made a SECOND order (code review 2026-10-11, REVIEW-3
// #1). Now the answer only notes the order on the attempt, and the order page
// ends that attempt when it empties the basket.

export const POD_ATTEMPT_KEY = 'reklamx_pod_attempt';

type AttemptStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface PodAttempt {
  /** The basket it was made for, as CheckoutPage writes it. */
  basket: string;
  id: string;
  /** The order the server answered it with. */
  orderId?: string;
}

/** This tab's storage, or null where the browser refuses it (some private modes throw). */
export function tabStorage(): AttemptStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function readPodAttempt(storage: AttemptStorage): PodAttempt | null {
  try {
    const kept = JSON.parse(storage.getItem(POD_ATTEMPT_KEY) || 'null');
    return kept && typeof kept.id === 'string' && typeof kept.basket === 'string' ? kept : null;
  } catch {
    return null;
  }
}

/** The attempt for this basket: the one kept for it, else a new one, kept. */
export function podAttemptIdFor(storage: AttemptStorage | null, basket: string, newId: () => string): string {
  const kept = storage ? readPodAttempt(storage) : null;
  if (kept && kept.basket === basket) return kept.id;
  const id = newId();
  try {
    storage?.setItem(POD_ATTEMPT_KEY, JSON.stringify({ basket, id }));
  } catch {
    /* private mode: the server still refuses a second order while the first is placing */
  }
  return id;
}

/** The server named the attempt's order: noted on it, so the order page can end this attempt and no other. */
export function notePodAttemptOrder(storage: AttemptStorage | null, id: string, orderId: string): void {
  const kept = storage ? readPodAttempt(storage) : null;
  if (!kept || kept.id !== id) return;
  try {
    storage?.setItem(POD_ATTEMPT_KEY, JSON.stringify({ ...kept, orderId: String(orderId) }));
  } catch {
    /* unnoted, the attempt stays: pressing again still answers with this order */
  }
}

/**
 * The order page has this order and is done with its basket: its attempt ends, so
 * the same basket ordered again is a new order. An attempt that names another
 * order, or none yet, is a newer basket's and stays.
 */
export function forgetPodAttemptOf(storage: AttemptStorage | null, orderId: string): void {
  const kept = storage ? readPodAttempt(storage) : null;
  if (!kept || kept.orderId !== String(orderId)) return;
  try {
    storage?.removeItem(POD_ATTEMPT_KEY);
  } catch {
    /* nothing to forget */
  }
}
