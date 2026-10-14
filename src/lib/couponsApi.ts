// The dashboard's calls into the coupon endpoints.
//
// Coupons used to be written straight to Firestore from the browser. They are
// not any more, and the reason is 4.15: an audit log its own subject can write
// is not an audit log. The validation moved with it — 4.2's mandatory ceiling
// above 50% is enforced by the server now, not only asked for by the form.

import { auth } from '../firebase';

export interface CouponInput {
  /** Present when editing. Absent creates. */
  id?: string;
  code: string;
  percent: number;
  active: boolean;
  minOrderAmount: number | null;
  maxDiscountAmount: number | null;
  expiresAt: string | null;
  /** 4.10 */
  startsAt: string | null;
  maxUses: number | null;
  oncePerCustomer: boolean;
  scope: 'all' | 'products';
  productIds: string[];
  /** 4.11 */
  audience: 'all' | 'business' | 'individual';
  /** 4.12 */
  firstOrderOnly: boolean;
  /** 4.13 */
  noStacking: boolean;
  /** 4.9 */
  discountIncludesShipping: boolean;
  /** 4.7 — null means "use the shop-wide floor". */
  minMarginPercent: number | null;
}

export interface CouponAuditEntry {
  id: string;
  action: 'create' | 'update' | 'delete' | 'bulk' | 'toggle';
  code: string;
  by: string;
  byEmail: string | null;
  at: string;
  changes: Record<string, any>;
  note?: string;
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
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

export function saveCoupon(input: CouponInput) {
  return call<{ ok: true; id: string; code: string; changed: string[] }>(
    '/api/admin/coupons/save',
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function deleteCoupon(id: string) {
  return call<{ ok: true; id: string }>(
    '/api/admin/coupons/delete',
    { method: 'POST', body: JSON.stringify({ id }) },
  );
}

/** 4.14 — one rule set, many codes. */
export function bulkCoupons(input: Omit<CouponInput, 'id' | 'code'> & { prefix: string; count: number; length: number }) {
  return call<{ ok: true; count: number; codes: string[] }>(
    '/api/admin/coupons/bulk',
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/** 4.15 — newest first. `code` narrows it to one coupon's history. */
export function couponAudit(code?: string) {
  const q = code ? `?code=${encodeURIComponent(code)}` : '';
  return call<{ entries: CouponAuditEntry[]; truncated: boolean }>(
    `/api/admin/coupons/audit${q}`,
    { method: 'GET' },
  );
}

export interface CouponStatRow {
  id: string;
  code: string;
  uses: number;
  discountGiven: number;
  netRevenue: number;
  goodsCost: number;
  marginSek: number;
  marginPercent: number | null;
  ordersWithFullCost: number;
  newCustomers: number;
  newCustomerShare: number | null;
  firstUsedAt: string | null;
  lastUsedAt: string | null;
}

/** 4.24 — how each code actually performed, frozen at redemption time. */
export function couponStats() {
  return call<{ stats: CouponStatRow[] }>('/api/admin/coupons/stats', { method: 'GET' });
}

/**
 * The generated codes as a CSV, for the print shop that is going to put them on
 * cards. One column, so a spreadsheet cannot reinterpret anything as a date.
 */
export function codesToCsv(codes: string[]): string {
  return ['code', ...codes].join('\n');
}
