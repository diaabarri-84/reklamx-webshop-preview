// firestore.rules, as code — who may read and write what from a BROWSER.
//
// On Firebase the database enforced firestore.rules itself. On MySQL the browser
// reaches the data only through /api/data (localRoutes.ts), and every document
// it reads or writes is judged here first, by the same rules, rule for rule.
// The comments in firestore.rules explain each one; they are not repeated.
// The server's own writes (server.ts through getAdminDb) bypass this exactly as
// the Admin SDK bypassed the rules.
//
// Writes are judged on the document as it WILL BE, computed by actually applying
// the write inside a transaction that is rolled back on refusal — so merge, dot
// paths and deleteField() mean precisely what the data layer makes them mean.

export type Doc = Record<string, any>;
export interface Caller {
  uid: string;
  anonymous: boolean;
  claims: Record<string, unknown>;
}
/** The caller's own users document, read once per request. */
export type ProfileOf = (uid: string) => Promise<Doc | null>;

export interface DocPath {
  collection: string;           // 'users', or 'users/pointsLedger' for the subcollection
  id: string;
  parentId: string | null;
}

const STAFF = ['admin', 'staff', 'production'];

async function role(caller: Caller | null, profile: ProfileOf): Promise<string> {
  if (!caller) return '';
  const p = await profile(caller.uid);
  return typeof p?.role === 'string' ? p.role : '';
}
const isAdmin = async (c: Caller | null, p: ProfileOf) => (await role(c, p)) === 'admin';
const isStaff = async (c: Caller | null, p: ProfileOf) => STAFF.includes(await role(c, p));
async function canManageOrders(c: Caller | null, p: ProfileOf): Promise<boolean> {
  if (!c) return false;
  const u = await p(c.uid);
  const r = typeof u?.role === 'string' ? u.role : '';
  const perms = u?.permissions;
  return r === 'admin' || (['staff', 'production'].includes(r) && !!perms && typeof perms === 'object' && !Array.isArray(perms) && perms.canManageOrders === true);
}

function isValidUser(d: Doc | null): boolean {
  return !!d && ['uid', 'email', 'role', 'status'].every((k) => k in d) &&
    ['admin', 'staff', 'production', 'client'].includes(d.role) && ['active', 'suspended'].includes(d.status);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const get = (d: Doc | null, k: string, fallback: unknown) => (d && k in d ? d[k] : fallback);

/** firestore.rules' diff().affectedKeys(): top-level keys added, removed or changed. */
function affectedKeys(before: Doc, after: Doc): Set<string> {
  const out = new Set<string>();
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(k in before) || !(k in after) || !same(before[k], after[k])) out.add(k);
  }
  return out;
}
const ORDER_SERVER_FIELDS = [
  'paymentStatus', 'paymentMode', 'molliePaymentId', 'paidAt',
  'grossTotal', 'netTotal', 'vatAmount', 'vatRate', 'goodsNet', 'shippingCost',
  'discountAmount', 'discountCode', 'pointsDiscountAmount', 'pointsRedeemed',
  'refundedAmount', 'creditNoteNumbers', 'currency', 'items',
  'userId', 'customerAccountId', 'customerEmail',
  'payOnDelivery', 'paymentProvider', 'paymentMethodTitle',
  'paymentRecordedBy', 'paymentRecordedMethod', 'confirmedAt', 'checkoutAttemptId',
  'pointsEarned', 'sideEffects', 'lifetimeSpendAdded',
  'couponHeld', 'couponOverLimit', 'pointsShortfall',
];

export async function canRead(path: DocPath, data: Doc | null, caller: Caller | null, profile: ProfileOf): Promise<boolean> {
  const uid = caller?.uid ?? null;
  switch (path.collection) {
    case 'users':
      return (!!uid && uid === path.id) || isAdmin(caller, profile);
    case 'users/pointsLedger':
      return (!!uid && uid === path.parentId) || isStaff(caller, profile);
    case 'categories': case 'products': case 'templates': case 'settings':
      return true;
    case 'designTemplates':
    case 'coupons':
    case 'contact_inquiries':
      return isAdmin(caller, profile);
    case 'suppliers':
      return isStaff(caller, profile);
    case 'creditNotes':
    case 'orders':
      if (!caller) return false;
      if (await isStaff(caller, profile)) return true;
      // A document that does not exist is readable by whoever could read it if it
      // did — a get() of a missing order answers "not there", not "forbidden".
      if (!data) return true;
      return get(data, 'userId', '') === uid || get(data, 'customerAccountId', '') === uid;
    case 'designs':
      if (!caller) return false;
      if (!data) return true;
      return data.userId === uid || isStaff(caller, profile);
    default:
      return false;   // productCosts, orderCosts, supplierIndex, counters, abandonedCarts,
                      // couponStats, couponAudit, couponRedemptions, secrets — server only
  }
}

export async function canWrite(
  kind: 'create' | 'update' | 'delete',
  path: DocPath,
  before: Doc | null,
  after: Doc | null,
  caller: Caller | null,
  profile: ProfileOf,
): Promise<boolean> {
  const uid = caller?.uid ?? null;
  switch (path.collection) {
    case 'users': {
      const owner = !!uid && uid === path.id;
      if (kind === 'delete') return isAdmin(caller, profile);
      if (!isValidUser(after)) return false;
      if (kind === 'create') {
        if (await isAdmin(caller, profile)) return true;
        return owner && after!.role === 'client' && after!.status === 'active' && after!.uid === path.id &&
          get(after, 'loyaltyPoints', 0) === 0 &&
          (get(after, 'pointsHistory', []) as unknown[]).length === 0 &&
          Object.keys(get(after, 'permissions', {}) as object ?? {}).length === 0;
      }
      if (await isAdmin(caller, profile)) return true;
      return owner &&
        after!.role === before!.role && after!.status === before!.status &&
        after!.uid === before!.uid && after!.email === before!.email &&
        same(get(after, 'loyaltyPoints', 0), get(before, 'loyaltyPoints', 0)) &&
        same(get(after, 'permissions', {}), get(before, 'permissions', {})) &&
        same(get(after, 'pointsHistory', []), get(before, 'pointsHistory', [])) &&
        same(get(after, 'lifetimeSpend', 0), get(before, 'lifetimeSpend', 0)) &&
        same(get(after, 'loyaltyTier', ''), get(before, 'loyaltyTier', ''));
    }
    case 'categories': case 'products': case 'templates': case 'settings':
      return isAdmin(caller, profile);
    case 'designTemplates':
      if (!(await isAdmin(caller, profile))) return false;
      if (kind === 'delete') return true;
      return typeof after?.json === 'string' && after.json.length <= 200_000;
    case 'orders':
      if (kind === 'create') return false;
      if (kind === 'delete') return isAdmin(caller, profile);
      if (!caller || !(await canManageOrders(caller, profile))) return false;
      {
        const changed = affectedKeys(before ?? {}, after ?? {});
        return !ORDER_SERVER_FIELDS.some((k) => changed.has(k));
      }
    case 'designs':
      if (!caller) return false;
      if (kind === 'create') return after?.userId === uid;
      if (kind === 'update') return before?.userId === uid && after?.userId === before?.userId;
      return before?.userId === uid;
    case 'contact_inquiries':
      return kind !== 'create' && isAdmin(caller, profile);
    default:
      return false;
  }
}
