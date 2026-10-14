#!/usr/bin/env node
// Give historical guest orders back to the accounts that placed them.
//
// WHY THIS EXISTS
// An order's `userId` is set from a verified Firebase ID token. When the browser
// sends no token — the customer was signed out, the session had expired, the
// token fetch failed — the order is stored as `guest-<orderid>`. The customer's
// dashboard lists orders by uid, so a registered customer who was paid up and
// waiting saw "No orders yet". Order 202600002 is exactly that case.
//
// The fix in the shop is `customerAccountId`, written at order time. This script
// backfills the same field on orders placed before it existed, by matching the
// email on the order against the `users` collection.
//
// WHAT IT DOES NOT DO
// It never touches `userId`. That field drives loyalty points and the
// once-per-customer coupon rule, and rewriting it retroactively would award
// points for orders already closed. `customerAccountId` is read by one thing:
// which orders a signed-in customer may see.
//
// Requires service-account.json in the project root (gitignored).
//
//   node scripts/link-guest-orders.mjs            # dry run — prints, changes nothing
//   node scripts/link-guest-orders.mjs --apply    # writes

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY_PATH = join(ROOT, 'service-account.json');
const CONFIG_PATH = join(ROOT, 'firebase-applet-config.json');

if (!existsSync(KEY_PATH)) {
  console.error('service-account.json not found in the project root.');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
const appConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const DATABASE_ID = appConfig.firestoreDatabaseId || '(default)';

initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id });
const db = getFirestore(DATABASE_ID);

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(`Project:  ${serviceAccount.project_id}`);
  console.log(`Database: ${DATABASE_ID}`);
  console.log(APPLY ? 'Mode:     APPLY (writing)\n' : 'Mode:     dry run (nothing is written)\n');

  // FIREBASE AUTH, not the `users` collection — and only VERIFIED addresses.
  //
  // The users collection is written by the customers themselves and its email
  // is not pinned to the sign-in token, so matching on it would let anyone
  // claim a stranger's orders by putting the stranger's address in their own
  // profile document. An auth record cannot be forged that way, and an address
  // registered without being proved leaves emailVerified false. Same rule as
  // resolveCustomerAccountId in server.ts; the two must not diverge.
  const { users } = await getAuth().listUsers(1000);
  const byEmail = new Map();
  const ambiguous = new Set();
  let unverified = 0;
  for (const user of users) {
    const email = String(user.email ?? '').toLowerCase().trim();
    if (!email) continue;
    if (!user.emailVerified) {
      unverified += 1;
      continue;
    }
    if (byEmail.has(email)) ambiguous.add(email);
    byEmail.set(email, user.uid);
  }
  console.log(`${users.length} auth accounts, ${byEmail.size} with a verified email` +
    (unverified ? `, ${unverified} unverified (skipped)` : '') +
    (ambiguous.size ? `, ${ambiguous.size} duplicated (skipped)` : '') + '\n');

  const orders = await db.collection('orders').get();
  let linked = 0;
  let already = 0;
  let noMatch = 0;

  for (const doc of orders.docs) {
    const order = doc.data();
    if (order.customerAccountId) {
      already += 1;
      continue;
    }

    const email = String(order.customerEmail ?? '').toLowerCase().trim();
    const uid = byEmail.get(email);

    // An email on two accounts is not a match, it is a guess. An unverified one
    // is not a match either — it is whoever typed it.
    if (!uid || ambiguous.has(email)) {
      noMatch += 1;
      console.log(`  –  ${doc.id.padEnd(12)} ${email || '(no email)'} → no single verified account`);
      continue;
    }

    console.log(`  ✓  ${doc.id.padEnd(12)} ${email} → ${uid}`);
    if (APPLY) {
      await doc.ref.update({ customerAccountId: uid, updatedAt: new Date().toISOString() });
    }
    linked += 1;
  }

  console.log(`\n${orders.size} orders — ${linked} ${APPLY ? 'linked' : 'would be linked'}, ` +
    `${already} already linked, ${noMatch} without a matching verified account.`);
  if (!APPLY && linked > 0) console.log('\nRe-run with --apply to write these.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('Failed:', err?.message ?? err);
    process.exit(1);
  },
);
