#!/usr/bin/env node
// Stop advertising a discount code that has never existed.
//
// `settings/siteConfig.announcementText` reads "🎉 Special 15% discount on all
// card and banner printing with code: PRINT15", it renders above every route in
// the shop, and the live server answers "This discount code is not valid." to
// PRINT15 — in all four languages, at the moment of highest intent.
//
// It is NOT the owner's promotion. It is the shipped default in
// src/context/SiteSettingsContext.tsx, written to pair with the four demo
// coupons the coupon screen used to auto-seed — PRINT10, WELCOME15, VIP20,
// SUMMER25. PRINT15 is not among them: the template's own copy names a code its
// own demo data never created. So there is nothing here to honour.
//
// Creating a real 15%-off code to make the sentence true would invent a
// promotion the owner never asked for, on every order. Rewriting the sentence
// would invent a marketing claim nobody has verified. So this turns the bar OFF
// and leaves the text in place: he switches it back on in the dashboard the
// moment he writes his own line, and the sv/da/no boxes are now sitting under it.
//
//   node scripts/fix-announcement-bar.mjs           # show what would change
//   node scripts/fix-announcement-bar.mjs --apply   # write it
//   node scripts/fix-announcement-bar.mjs --on      # put it back, unchanged
//
// Only `showAnnouncementBar` is touched, with a field update — never a
// whole-document write. Several screens own parts of siteConfig, and a full
// overwrite is how the site logo was lost once before.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const TURN_ON = process.argv.includes('--on');

const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore(cfg.firestoreDatabaseId || '(default)');

const ref = db.collection('settings').doc('siteConfig');
const snap = await ref.get();
const cur = snap.data() || {};
const want = TURN_ON;

console.log(`\n  announcementText   ${JSON.stringify(cur.announcementText ?? null)}`);
for (const l of ['sv', 'da', 'no']) {
  console.log(`    ${l}               ${JSON.stringify(cur.announcementTextI18n?.[l] ?? null)}`);
}
console.log(`  showAnnouncementBar ${cur.showAnnouncementBar} → ${want}\n`);

const codes = await db.collection('coupons').get();
const live = codes.docs
  .map((d) => ({ id: d.id, ...d.data() }))
  .filter((c) => c.active !== false && (!c.expiresAt || String(c.expiresAt) >= new Date().toISOString().slice(0, 10)));
console.log(`  usable discount codes right now: ${live.length ? live.map((c) => `${c.code} (${c.percent}%)`).join(', ') : 'NONE'}\n`);

if (cur.showAnnouncementBar === want) {
  console.log('  Already in that state. Nothing to do.\n');
  process.exit(0);
}
if (!APPLY) {
  console.log('  Dry run. Nothing was written. Re-run with --apply.\n');
  process.exit(0);
}

await ref.update({ showAnnouncementBar: want });
console.log(`  ✅ showAnnouncementBar = ${want}\n`);
