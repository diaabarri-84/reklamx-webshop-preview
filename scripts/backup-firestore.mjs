#!/usr/bin/env node
// Take a complete, portable copy of the shop's data.
//
// WHY THIS EXISTS
// The owner asked whether the data could ever move off Firebase — to Supabase,
// to Postgres, to anywhere. The honest answer to "could it?" starts with "is
// there a copy that belongs to us?", and before this script the only copy was
// Firebase's own. Now one command writes every collection (and subcollection)
// as plain JSON that any other system can read, plus the Auth account list.
//
// It is a BACKUP, not a migration: passwords stay in Firebase (they are
// one-way hashes; `firebase auth:export` can carry them if a real migration
// ever happens), and files in Storage are listed, not downloaded.
//
// Output lands in .backups/firestore-<date>/ — gitignored, this machine only.
//
//   node scripts/backup-firestore.mjs
//
// Cost: one read per document. The whole shop is ~50 documents, so running
// this daily would use ~0.1% of the free quota.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = join(ROOT, 'service-account.json');
if (!existsSync(KEY)) {
  console.error('service-account.json not found in the project root.');
  process.exit(1);
}
const sa = JSON.parse(readFileSync(KEY, 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore(app, cfg.firestoreDatabaseId || '(default)');

const stamp = new Date().toISOString().slice(0, 10);
const DIR = join(ROOT, '.backups', `firestore-${stamp}`);
mkdirSync(DIR, { recursive: true });

let docs = 0;
for (const col of await db.listCollections()) {
  const snap = await col.get();
  const rows = {};
  for (const d of snap.docs) {
    rows[d.id] = d.data();
    for (const sub of await d.ref.listCollections()) {
      const s = await sub.get();
      rows[d.id][`__subcollection_${sub.id}`] = Object.fromEntries(s.docs.map((x) => [x.id, x.data()]));
      docs += s.size;
    }
  }
  writeFileSync(join(DIR, `${col.id}.json`), JSON.stringify(rows, null, 2));
  docs += snap.size;
  console.log(`  ${col.id.padEnd(22)} ${String(snap.size).padStart(4)} docs`);
}

// The Auth accounts — who can sign in, and how. No secrets: password hashes
// are not readable this way, which is exactly why this is a backup and not an
// account migration.
const users = [];
let token;
do {
  const page = await getAuth(app).listUsers(1000, token);
  users.push(...page.users.map((u) => ({
    uid: u.uid, email: u.email ?? null, displayName: u.displayName ?? null,
    emailVerified: u.emailVerified, disabled: u.disabled,
    providers: u.providerData.map((p) => p.providerId),
    created: u.metadata.creationTime, lastSignIn: u.metadata.lastSignInTime ?? null,
  })));
  token = page.pageToken;
} while (token);
writeFileSync(join(DIR, '_auth-accounts.json'), JSON.stringify(users, null, 2));
console.log(`  ${'_auth-accounts'.padEnd(22)} ${String(users.length).padStart(4)} accounts`);
console.log(`\n✅ ${docs} documents + ${users.length} auth accounts → ${DIR.replace(ROOT + '/', '')}/`);
process.exit(0);
