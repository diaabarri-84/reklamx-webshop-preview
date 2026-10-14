// Who may change an order, and which fields — firestore.rules, `match /orders`,
// asserted by signing in as the emulator's real staff and admin accounts and
// writing through the same client SDK the dashboard uses. No browser.
//
// The review of round 16 found the old rule (1) refused EVERY staff edit on an
// order that predates netTotal — reading a missing field is an error, and an
// error denies — and (2) let any staff login write paymentMode 'test' (the
// order drops out of revenue), refundedAmount, or userId (who may read it), with
// or without the "manage orders" permission.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { db, check, summary } from './lib.mjs';

const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(`${REPO}/package.json`);
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, setDoc, setLogLevel } = require('firebase/firestore');
// The refusals below are the point; the SDK logging each one is noise.
setLogLevel('silent');

const OLD = '202692001'; // an order from before the money breakdown: no netTotal, grossTotal, paymentStatus
const NEW = '202692002';
await db.collection('orders').doc(OLD).set({ id: OLD, userId: 'guest', createdAt: '2025-01-10T10:00:00Z', status: 'pending', totalAmount: 500, items: [] });
await db.collection('orders').doc(NEW).set({
  id: NEW, userId: 'guest', createdAt: new Date().toISOString(), status: 'in_print', paymentStatus: 'paid', paymentMode: 'live',
  grossTotal: 1250, netTotal: 1000, vatAmount: 250, items: [],
});
const staffDoc = (await db.collection('users').where('email', '==', 'staff@emulator.test').get()).docs[0];
const staffPermsBefore = staffDoc.data().permissions ?? null;

/** Sign in as one of the emulator accounts and return a write function. */
async function as(email, password, name) {
  const app = initializeApp({ projectId: 'demo-reklamx', apiKey: 'demo-api-key', authDomain: 'demo-reklamx.firebaseapp.com' }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const fs = getFirestore(app);
  connectFirestoreEmulator(fs, '127.0.0.1', 8085);
  await signInWithEmailAndPassword(auth, email, password);
  const write = async (id, patch) => {
    try {
      await setDoc(doc(fs, 'orders', id), { id, ...patch, updatedAt: new Date().toISOString() }, { merge: true });
      return 'allowed';
    } catch (e) {
      return String(e?.code || e).includes('permission-denied') ? 'denied' : `error: ${e?.code || e}`;
    }
  };
  return { write, close: () => deleteApp(app) };
}

const staff = await as('staff@emulator.test', 'emulator-staff-1', 'rules-staff');
const admin = await as('admin@emulator.test', 'emulator-admin-1', 'rules-admin');

// ---- staff WITH "manage orders" ----
await staffDoc.ref.set({ permissions: { canManageOrders: true } }, { merge: true });
check('staff may set the priority of an order that predates netTotal (was refused)', (await staff.write(OLD, { priority: 'urgent' })) === 'allowed');
check('…and its print date, and move its stage', (await staff.write(OLD, { printDate: '2026-10-20', status: 'in_design' })) === 'allowed');
check('staff may set priority / dates / stage on a current order', (await staff.write(NEW, { priority: 'high', dueDate: '2026-10-22', status: 'finishing' })) === 'allowed');
for (const [field, value] of [
  // Each a CHANGE — writing the value a field already has is no change, and allowed.
  ['paymentStatus', 'refunded'], ['paymentMode', 'test'], ['refundedAmount', 500], ['grossTotal', 1],
  ['netTotal', 1], ['vatAmount', 0], ['userId', 'someone-else'], ['customerAccountId', 'someone-else'],
  ['items', [{ productName: 'Free banner', price: 0 }]],
  // Pay on delivery (2026-10-07): an abandoned checkout flagged by a staff login
  // would go into production unpaid.
  ['payOnDelivery', true], ['paymentMethodTitle', 'Pay on delivery'], ['paymentRecordedMethod', 'cash'], ['confirmedAt', '2026-10-07T10:00:00Z'],
  // What the money steps read back (review 2026-10-11, RUL-01): the points a
  // payment credits, the flags that say a step ran, the lifetime-spend marker.
  ['pointsEarned', 100000], ['sideEffects', { pointsApplied: false }], ['lifetimeSpendAdded', false],
  // …and the coupon and points records (review 2026-10-11, C): whether the order
  // holds a code's use (what gives it back), and the over-limit and shortfall stamps.
  ['couponHeld', true], ['couponOverLimit', false], ['pointsShortfall', 0],
]) {
  const r = await staff.write(NEW, { [field]: value });
  check(`staff may NOT write ${field}`, r === 'denied', r);
}
check('staff may NOT ADD a money field an old order lacks (grossTotal)', (await staff.write(OLD, { grossTotal: 1 })) === 'denied');

// ---- staff WITHOUT it ----
await staffDoc.ref.set({ permissions: { canManageOrders: false } }, { merge: true });
const without = await staff.write(NEW, { priority: 'urgent' });
check('staff WITHOUT "manage orders" may not change an order at all', without === 'denied', without);
await staffDoc.ref.update({ permissions: null });
check('…nor an account promoted with no permissions map', (await staff.write(NEW, { priority: 'urgent' })) === 'denied');

// ---- admin ----
check('the admin may set the priority of an old order', (await admin.write(OLD, { priority: 'high' })) === 'allowed');
check('the admin may NOT write paymentStatus from a browser either (the webhook does)', (await admin.write(NEW, { paymentStatus: 'refunded' })) === 'denied');

const stored = (await db.collection('orders').doc(NEW).get()).data();
check('what was refused was not stored', stored.paymentMode === 'live' && stored.grossTotal === 1250 && stored.userId === 'guest' && stored.priority === 'high');

// Leave the emulator as it was found.
await staffDoc.ref.set({ permissions: staffPermsBefore }, { merge: true });
await db.collection('orders').doc(OLD).delete();
await db.collection('orders').doc(NEW).delete();
await staff.close();
await admin.close();
process.exit(summary() ? 1 : 0);
