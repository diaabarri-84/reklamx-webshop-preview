// The dashboard's calls into the loyalty endpoints.
//
// 4.16 and 4.20 both existed on the server and nothing in the dashboard called
// them: a ledger nobody could read and a liability figure nobody could see.

import { auth } from '../firebase';

export interface LoyaltyLiability {
  totalPoints: number;
  pointsPerKrona: number;
  /** The debt, in kronor. */
  liabilitySek: number;
  holders: number;
  accounts: number;
  byTier: Record<string, { holders: number; points: number }>;
  largestHolder: { email: string | null; points: number } | null;
}

export interface LedgerEntryView {
  id: string;
  date?: string;
  points?: number;
  type?: string;
  description?: string;
  orderId?: string;
  by?: string;
  expiresAt?: string | null;
  unrecoverablePoints?: number;
}

export interface LoyaltyLedger {
  uid: string;
  balance: number;
  lifetimeSpend: number;
  tier: string;
  valueSek: number;
  entries: LedgerEntryView[];
  /** What the ledger itself adds up to — a drift from `balance` is visible, not hidden. */
  ledgerBalance: number;
  /** 4.18 — points the next sweep would take. */
  pendingExpiry: number;
  nextExpiryAt: string | null;
  truncated: boolean;
}

export interface ExpirySweepResult {
  ok: true;
  dryRun: boolean;
  ran: boolean;
  reason?: string;
  customers: number;
  expired: number;
  /** How many balances were looked at, and whether the scan hit its own ceiling. */
  scanned: number;
  capped: boolean;
  details: { uid: string; points: number }[];
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) throw new Error('Not signed in.');
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || 'The request failed.');
  return body as T;
}

/** 4.20 — the debt, in kronor. */
export function loyaltyLiability() {
  return call<LoyaltyLiability>('/api/admin/loyalty/liability');
}

/** 4.16 — one customer's ledger. */
export function loyaltyLedger(uid: string) {
  return call<LoyaltyLedger>(`/api/admin/loyalty/${encodeURIComponent(uid)}/ledger`);
}

/**
 * 4.18 — the expiry sweep. `apply: false` reports what it WOULD take.
 *
 * Default false on purpose: nobody should find out what a first run does by
 * running it.
 */
export function expirePoints(apply = false) {
  return call<ExpirySweepResult>('/api/admin/loyalty/expire', {
    method: 'POST',
    body: JSON.stringify({ apply }),
  });
}

// ---------------------------------------------------------------------------
// 5.7c — abandoned baskets. Here rather than in a file of its own because it is
// the same one-call-per-endpoint shape and the same admin token.
// ---------------------------------------------------------------------------

export interface AbandonedCartRow {
  uid: string;
  email: string | null;
  value: number;
  itemCount: number;
  lineCount: number;
  /** The most common reason a basket stalls: the customer never sent the file. */
  anyArtworkPending: boolean;
  firstSeenAt: string | null;
  updatedAt: string | null;
  lines: { productId: string | null; name: string; quantity: number; totalPrice: number; artworkPending: boolean }[];
}

export interface AbandonedCarts {
  hours: number;
  carts: AbandonedCartRow[];
  count: number;
  totalValue: number;
  waitingForArtwork: number;
  truncated: boolean;
  retentionDays: number;
}

export function abandonedCarts(hours = 24) {
  return call<AbandonedCarts>(`/api/admin/carts/abandoned?hours=${encodeURIComponent(String(hours))}`);
}
