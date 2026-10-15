// Firestore collection -> MySQL table, and the index copies each row carries.
//
// THE ONE PLACE this mapping lives. The data layer (docStore.ts) and the
// Firebase import both turn a document into a row through toRow(), so a row
// written by the shop and a row written by the import can never differ.
// The tables themselves are in migration/schema.sql.
//
// Every row stores the WHOLE document as JSON text in `data`; that is the only
// thing ever read back. The other columns are index copies, used to find rows.
// A copy follows Firestore's own typing: `where('shipmentOpen','==',true)`
// matches the boolean true and nothing else, `where('slug','==','x')` matches
// the string 'x' and not a number. So a copy is filled only when the field has
// the column's type, and is NULL otherwise — NULL rows drop out of `=`, `<`,
// `>` exactly the way Firestore skips documents of the wrong type or without
// the field.

export type CopyType = 'string' | 'number' | 'bool';
export interface Copy { field: string; type: CopyType; max?: number }
export interface TableSpec {
  table: string;
  copies?: Record<string, Copy>;
  /** The document is stored encrypted, in `ciphertext` instead of `data`. */
  encrypted?: boolean;
  /** Subcollections only: the column holding the parent document's id. */
  parentColumn?: string;
}

/** Keyed by Firestore collection name. */
export const TABLES: Record<string, TableSpec> = {
  users:             { table: 'users', copies: { role: { field: 'role', type: 'string' }, loyalty_points: { field: 'loyaltyPoints', type: 'number' } } },
  customerTerms:     { table: 'customer_terms', copies: { pay_on_delivery: { field: 'payOnDelivery', type: 'bool' } } },
  categories:        { table: 'categories' },
  products:          { table: 'products', copies: { slug: { field: 'slug', type: 'string' }, category_id: { field: 'categoryId', type: 'string' } } },
  productCosts:      { table: 'product_costs', copies: { supplier: { field: 'supplier', type: 'string' } } },
  suppliers:         { table: 'suppliers' },
  supplierIndex:     { table: 'supplier_index', copies: { supplier: { field: 'supplier', type: 'string' } } },
  designTemplates:   { table: 'design_templates' },
  designs:           { table: 'designs', copies: { user_id: { field: 'userId', type: 'string' } } },
  settings:          { table: 'settings' },
  orders:            { table: 'orders', copies: {
    user_id:             { field: 'userId', type: 'string' },
    customer_account_id: { field: 'customerAccountId', type: 'string' },
    created_at:          { field: 'createdAt', type: 'string', max: 64 },
    next_stage_at:       { field: 'nextStageAt', type: 'string', max: 64 },
    shipment_open:       { field: 'shipmentOpen', type: 'bool' },
    checkout_attempt_id: { field: 'checkoutAttemptId', type: 'string' },
    payment_mode:        { field: 'paymentMode', type: 'string', max: 64 },
    order_no:            { field: 'id', type: 'string' },
  } },
  orderCosts:        { table: 'order_costs' },
  creditNotes:       { table: 'credit_notes', copies: {
    order_id:            { field: 'orderId', type: 'string' },
    user_id:             { field: 'userId', type: 'string' },
    customer_account_id: { field: 'customerAccountId', type: 'string' },
  } },
  counters:          { table: 'counters' },
  checkoutAttempts:  { table: 'checkout_attempts' },
  abandonedCarts:    { table: 'abandoned_carts', copies: { updated_at: { field: 'updatedAt', type: 'string', max: 64 } } },
  coupons:           { table: 'coupons', copies: { code: { field: 'code', type: 'string' } } },
  couponStats:       { table: 'coupon_stats' },
  couponAudit:       { table: 'coupon_audit', copies: { at: { field: 'at', type: 'string', max: 64 } } },
  couponRedemptions: { table: 'coupon_redemptions' },
  contact_inquiries: { table: 'contact_inquiries' },
  secrets:           { table: 'secrets', encrypted: true },
};

/** Keyed by `parentCollection/subcollection` — users/{uid}/pointsLedger is the only one. */
export const SUBCOLLECTIONS: Record<string, TableSpec> = {
  'users/pointsLedger': { table: 'points_ledger', parentColumn: 'user_id', copies: {
    date:     { field: 'date', type: 'string', max: 64 },
    order_id: { field: 'orderId', type: 'string' },
    type:     { field: 'type', type: 'string', max: 64 },
  } },
};

const DEFAULT_MAX = 255;   // VARCHAR(255) for every string copy unless set lower
const ID_MAX = 255;        // every id column is VARCHAR(255)

const codePoints = (s: string) => [...s].length;

/**
 * The JSON text stored in `data`. Refuses anything JSON would silently change,
 * so the import reports it instead of quietly storing something different:
 * NaN / Infinity (JSON writes null), undefined (Firestore refuses it too) and
 * non-plain objects (a Firestore Timestamp, GeoPoint or reference the export
 * failed to convert, a Date).
 */
export function serializeDoc(doc: unknown): string {
  const problems: string[] = [];
  (function walk(v: unknown, path: string) {
    if (v === undefined) problems.push(`${path || '(document)'}: undefined`);
    else if (typeof v === 'number' && !Number.isFinite(v)) problems.push(`${path}: ${v} is not a finite number`);
    else if (typeof v === 'bigint' || typeof v === 'function' || typeof v === 'symbol') problems.push(`${path}: ${typeof v}`);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') {
      const proto = Object.getPrototypeOf(v);
      if (proto !== Object.prototype && proto !== null) problems.push(`${path}: ${proto?.constructor?.name ?? 'unknown'} object, not plain data`);
      else for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    }
  })(doc, '');
  if (problems.length) throw new Error(`Document cannot be stored verbatim:\n  ${problems.join('\n  ')}`);
  return JSON.stringify(doc);
}

function copyValue(value: unknown, copy: Copy, warnings: string[], column: string): string | number | null {
  switch (copy.type) {
    case 'bool':   return value === true ? 1 : value === false ? 0 : null;
    case 'number': return typeof value === 'number' && Number.isFinite(value) ? value : null;
    case 'string': {
      if (typeof value !== 'string') return null;
      // A lone UTF-16 surrogate (left by cutting a string mid-emoji) cannot be
      // stored in a utf8mb4 column at all — MySQL would refuse the whole row.
      // `data` is safe: JSON.stringify escapes it as \udXXX.
      if (!isWellFormed(value)) {
        warnings.push(`${column}: contains a broken character, not indexed`);
        return null;
      }
      const max = copy.max ?? DEFAULT_MAX;
      if (codePoints(value) > max) {
        // Too long to index. The row is still stored whole; only lookups by this
        // field would miss it, so the report must say so.
        warnings.push(`${column}: value longer than ${max} characters, not indexed`);
        return null;
      }
      return value;
    }
  }
}

/** A UTF-16 surrogate half with no partner — what makes a string not well-formed. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * String.prototype.isWellFormed — which exists only from Node 20, and the
 * shop's cPanel host runs Node 18 (2026-10-15): without the fallback every
 * write would throw. Same answer either way.
 */
export function isWellFormed(s: string): boolean {
  const native = (s as any).isWellFormed;
  return typeof native === 'function' ? native.call(s) : !LONE_SURROGATE.test(s);
}

/** The table spec for a collection path key ('orders', or 'users/pointsLedger'). */
export function specFor(collectionKey: string): TableSpec {
  const spec = TABLES[collectionKey] ?? SUBCOLLECTIONS[collectionKey];
  if (!spec) throw new Error(`No MySQL table for Firestore collection "${collectionKey}"`);
  return spec;
}

export interface RowResult { table: string; row: Record<string, unknown>; warnings: string[] }

/**
 * Document -> row for its table. For a subcollection pass the parent's id.
 * The secrets row comes back with the PLAIN JSON in `ciphertext`; the caller
 * encrypts it before writing.
 */
export function toRow(collectionKey: string, id: string, doc: unknown, parentId?: string): RowResult {
  const spec = specFor(collectionKey);
  const storableId = (x: unknown) => typeof x === 'string' && x !== '' && isWellFormed(x) && codePoints(x) <= ID_MAX;
  if (!storableId(id)) throw new Error(`Document id not storable: ${JSON.stringify(id)}`);
  if (spec.parentColumn && !storableId(parentId)) throw new Error(`Parent id not storable: ${JSON.stringify(parentId)}`);
  const warnings: string[] = [];
  const json = serializeDoc(doc);
  const row: Record<string, unknown> = { id };
  if (spec.parentColumn) row[spec.parentColumn] = parentId;
  row[spec.encrypted ? 'ciphertext' : 'data'] = json;
  const fields = (doc ?? {}) as Record<string, unknown>;
  for (const [column, copy] of Object.entries(spec.copies ?? {})) row[column] = copyValue(fields[copy.field], copy, warnings, column);
  return { table: spec.table, row, warnings };
}
