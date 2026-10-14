#!/usr/bin/env node
// Administrative tasks that security rules deliberately block from the browser.
//
// The shop's Firestore rules stop a signed-in user from changing their own role,
// which is exactly what makes the client-side "admin" hollow — and also why the
// first admin has to be granted from outside the app. That is what this is for.
//
// Requires service-account.json in the project root (gitignored, never leaves
// this machine). Run with: node scripts/admin-tool.mjs <command>
//
//   list                    show every auth account and whether it has a user doc
//   grant <email> [role]    give an account a role (default: admin) and activate it
//   claim <email>           set the {admin:true} custom claim used by storage.rules
//
// Every write prints exactly what it changed.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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
const auth = getAuth();
const db = getFirestore(DATABASE_ID);

const VALID_ROLES = ['admin', 'staff', 'production', 'client'];

async function list() {
  const { users } = await auth.listUsers(1000);
  if (!users.length) {
    console.log('No auth accounts exist yet.');
    return;
  }

  console.log(`Project: ${serviceAccount.project_id}`);
  console.log(`Database: ${DATABASE_ID}\n`);
  console.log(`${'EMAIL'.padEnd(34)} ${'ROLE'.padEnd(11)} ${'STATUS'.padEnd(10)} PROVIDER`);
  console.log('-'.repeat(80));

  for (const u of users) {
    const snap = await db.collection('users').doc(u.uid).get();
    const data = snap.exists ? snap.data() : null;
    const role = data?.role ?? '— no doc —';
    const status = data?.status ?? '—';
    const providers = u.providerData.map((p) => p.providerId.replace('.com', '')).join(',') || 'none';
    console.log(`${(u.email ?? u.uid).padEnd(34)} ${String(role).padEnd(11)} ${String(status).padEnd(10)} ${providers}`);
  }

  const admins = [];
  for (const u of users) {
    const snap = await db.collection('users').doc(u.uid).get();
    if (snap.exists && snap.data()?.role === 'admin') admins.push(u.email ?? u.uid);
  }
  console.log(`\n${users.length} account(s) · admins: ${admins.length ? admins.join(', ') : 'none'}`);
}

async function grant(email, role = 'admin') {
  if (!VALID_ROLES.includes(role)) {
    console.error(`Role must be one of: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    console.error(`No auth account for ${email}. They must sign in to the app once first.`);
    process.exit(1);
  }

  const ref = db.collection('users').doc(user.uid);
  const before = await ref.get();
  const previous = before.exists ? before.data() : null;

  // Written to match what the app's own security rules call a valid user, so the
  // account behaves exactly like one created through the normal sign-up path.
  const payload = {
    uid: user.uid,
    email: user.email,
    displayName: previous?.displayName || user.displayName || (user.email ?? '').split('@')[0],
    role,
    accountType: previous?.accountType || 'individual',
    status: 'active',
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await ref.set(payload, { merge: true });

  console.log(previous ? 'Updated existing user document.' : 'Created a new user document.');
  console.log(`  email  : ${payload.email}`);
  console.log(`  uid    : ${user.uid}`);
  console.log(`  role   : ${previous?.role ?? '(none)'} -> ${role}`);
  console.log(`  status : ${previous?.status ?? '(none)'} -> active`);
}

async function claim(email) {
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), admin: true });
  console.log(`Set {admin:true} on ${email}.`);
  console.log('They must sign out and back in for the new token to take effect.');
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'list') await list();
  else if (command === 'grant') await grant(args[0], args[1]);
  else if (command === 'claim') await claim(args[0]);
  else {
    console.log('Usage:');
    console.log('  node scripts/admin-tool.mjs list');
    console.log('  node scripts/admin-tool.mjs grant <email> [admin|staff|production|client]');
    console.log('  node scripts/admin-tool.mjs claim <email>');
  }
  process.exit(0);
} catch (err) {
  console.error('Failed:', err?.message ?? err);
  process.exit(1);
}
