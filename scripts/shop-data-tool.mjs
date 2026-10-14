#!/usr/bin/env node
// Data housekeeping the dashboard cannot safely do from a browser.
//
// WHY THIS EXISTS
// Two jobs came out of the 2026-09-08 review, and both are the kind of thing you
// want to see printed in full before it happens:
//
//   1. A coupon can be switched off from the dashboard, but only if you already
//      know it is there. TEST100 was a live, unlimited, 100 %-off code sitting in
//      a shop that had been taking real money for a week. `coupons` is one of the
//      collections a browser cannot even read without an admin round-trip, so a
//      command that lists them all is worth having on its own.
//
//   2. Orders cannot be created from a browser (firestore.rules:150) and deleting
//      one is irreversible. The revenue tile the owner circled was the sum of five
//      test-mode orders; he asked for them gone. Deleting an order does NOT undo
//      the loyalty points already credited to the buyer or the couponRedemptions
//      markers written by the webhook, so this prints what it is about to break.
//
// Nothing writes without --apply. Run scripts/backup-firestore.mjs first.
//
//   node scripts/shop-data-tool.mjs coupons                     # list every coupon
//   node scripts/shop-data-tool.mjs coupon-off <CODE> [--apply] # deactivate one
//   node scripts/shop-data-tool.mjs orders                      # list every order
//   node scripts/shop-data-tool.mjs delete-test-orders [--apply]

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_PATH = join(ROOT, 'service-account.json');
const CONFIG_PATH = join(ROOT, 'firebase-applet-config.json');

if (!existsSync(KEY_PATH)) {
  console.error('service-account.json not found in the project root.');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
const appConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

// The shop's data lives in a NAMED database, not (default). Omitting this is the
// classic way to read an empty database and conclude the data is gone.
const DATABASE_ID = appConfig.firestoreDatabaseId || '(default)';

initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
const db = getFirestore(DATABASE_ID);

const APPLY = process.argv.includes('--apply');

const money = (n) => Number(n || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2 });

async function listCoupons() {
  const snap = await db.collection('coupons').get();
  if (snap.empty) {
    console.log('No coupons.');
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  console.log(`${'CODE'.padEnd(14)} ${'%'.padStart(4)} ${'ACTIVE'.padEnd(7)} ${'EXPIRES'.padEnd(11)} ${'MAX'.padEnd(5)} ${'USED'.padEnd(5)} MIN ORDER`);
  console.log('-'.repeat(78));
  for (const doc of snap.docs) {
    const c = doc.data();
    // A coupon is only dangerous if it is active AND unexpired; fetchCoupon
    // (server.ts) rejects both, so an expired 100% code is noise, not a hole.
    const expired = c.expiresAt && String(c.expiresAt) < today;
    const live = c.active !== false && !expired;
    const flag = live && Number(c.percent) >= 50 ? '  <-- LIVE, large discount' : '';
    console.log(
      `${String(c.code ?? doc.id).padEnd(14)} ${String(c.percent ?? '?').padStart(4)} ` +
      `${(c.active === false ? 'no' : 'yes').padEnd(7)} ${String(c.expiresAt ?? '—').padEnd(11)} ` +
      `${String(c.maxUses ?? '∞').padEnd(5)} ${String(c.usedCount ?? 0).padEnd(5)} ` +
      `${c.minOrderAmount ?? '—'}${expired ? '   (expired)' : ''}${flag}`,
    );
  }
}

async function couponOff(code) {
  if (!code) throw new Error('Give the coupon code, e.g. coupon-off TEST100');
  const wanted = String(code).trim().toUpperCase();
  const snap = await db.collection('coupons').where('code', '==', wanted).limit(1).get();
  if (snap.empty) throw new Error(`No coupon with code ${wanted}.`);

  const doc = snap.docs[0];
  const c = doc.data();
  console.log(`${wanted} — ${c.percent}% off, active: ${c.active !== false}, expires ${c.expiresAt ?? 'never'}, used ${c.usedCount ?? 0}×`);

  if (c.active === false) {
    console.log('Already inactive. Nothing to do.');
    return;
  }
  if (!APPLY) {
    console.log('\nWould set active: false. Re-run with --apply to write it.');
    return;
  }
  // merge:true, and only this one field — usedCount is owned by a transaction in
  // the Mollie webhook and must never be clobbered from outside it.
  await doc.ref.set({ active: false, updatedAt: new Date().toISOString(), updatedBy: 'shop-data-tool' }, { merge: true });
  console.log(`\nDeactivated ${wanted}. It can be switched back on in Coupons & Loyalty.`);
}

async function listOrders() {
  const snap = await db.collection('orders').orderBy('createdAt', 'asc').get();
  if (snap.empty) {
    console.log('No orders.');
    return;
  }
  console.log(`${'ID'.padEnd(11)} ${'MODE'.padEnd(6)} ${'PAYMENT'.padEnd(9)} ${'STATUS'.padEnd(12)} ${'GROSS'.padStart(12)}  CUSTOMER`);
  console.log('-'.repeat(84));
  let paidLive = 0;
  let paidTest = 0;
  for (const doc of snap.docs) {
    const o = doc.data();
    const gross = Number(o.grossTotal ?? o.totalAmount) || 0;
    if (o.paymentStatus === 'paid') {
      if (o.paymentMode === 'test') paidTest += gross;
      else paidLive += gross;
    }
    console.log(
      `${doc.id.padEnd(11)} ${String(o.paymentMode ?? '—').padEnd(6)} ${String(o.paymentStatus ?? '—').padEnd(9)} ` +
      `${String(o.status ?? '—').padEnd(12)} ${money(gross).padStart(12)}  ${o.customerEmail ?? '—'}`,
    );
  }
  console.log(`\n${snap.size} order(s) · paid (live): ${money(paidLive)} SEK · paid (test): ${money(paidTest)} SEK`);
}

async function deleteTestOrders() {
  const snap = await db.collection('orders').where('paymentMode', '==', 'test').get();
  if (snap.empty) {
    console.log('No test-mode orders.');
    return;
  }

  console.log(`${snap.size} test-mode order(s):\n`);
  let total = 0;
  const sideEffects = [];
  for (const doc of snap.docs) {
    const o = doc.data();
    const gross = Number(o.grossTotal ?? o.totalAmount) || 0;
    total += gross;
    console.log(`  ${doc.id}  ${String(o.paymentStatus ?? '—').padEnd(9)} ${money(gross).padStart(12)} SEK  ${o.customerEmail ?? '—'}`);
    // Deleting the order does not unwind what the webhook did when it was paid.
    if (o.pointsEarned) sideEffects.push(`    ${doc.id}: ${o.pointsEarned} loyalty points stay credited to ${o.customerEmail}`);
    if (o.discountCode) sideEffects.push(`    ${doc.id}: couponRedemptions/order-${doc.id} stays, and keeps counting against ${o.discountCode}`);
  }
  console.log(`\n  ${money(total)} SEK of test revenue will stop being counted.`);
  if (sideEffects.length) {
    console.log('\n  Not undone by this delete:');
    sideEffects.forEach((s) => console.log(s));
  }
  // The order counter is deliberately left alone: numbering is an audit trail,
  // and counters/ is unreachable from a browser anyway (firestore.rules).
  console.log('\n  counters/orders-2026 is NOT reset — the next order stays 202600012.');

  if (!APPLY) {
    console.log('\nRe-run with --apply to delete them. Take a backup first.');
    return;
  }
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  console.log(`\nDeleted ${snap.size} test-mode order(s).`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'coupons') await listCoupons();
  else if (command === 'coupon-off') await couponOff(args[0]);
  else if (command === 'orders') await listOrders();
  else if (command === 'delete-test-orders') await deleteTestOrders();
  else {
    console.log('Usage:');
    console.log('  node scripts/shop-data-tool.mjs coupons');
    console.log('  node scripts/shop-data-tool.mjs coupon-off <CODE> [--apply]');
    console.log('  node scripts/shop-data-tool.mjs orders');
    console.log('  node scripts/shop-data-tool.mjs delete-test-orders [--apply]');
  }
  process.exit(0);
} catch (err) {
  console.error('Failed:', err?.message ?? err);
  process.exit(1);
}
