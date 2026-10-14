#!/usr/bin/env node
// Let the shop's own dashboard upload a file to its own storage bucket.
//
// WHY THIS EXISTS — a bug the client already reported once, back again
// On 2026-08-24 he reported "Download opens the file instead of saving it". The
// cause was the bucket having no CORS config at all, and the fix was to set one:
// GET/HEAD for reklamx-tau.vercel.app, reklamx.se, www.reklamx.se and localhost.
// The note written that day ended "when the real domain changes, extend that
// origin list". The domain then changed to shop.reklamx.se and nobody extended it.
//
// So the same bug is live again, and this was measured, not assumed. Fetching a
// real artwork file (uploads/.../1789175068473_swish.png) on 2026-09-12:
//   Origin: https://shop.reklamx.se  → 200, NO Access-Control-Allow-Origin
//   Origin: https://reklamx.se       → 200, Access-Control-Allow-Origin: reklamx.se
//   Origin: https://www.reklamx.se   → 200, Access-Control-Allow-Origin: www.reklamx.se
// shop.reklamx.se is the ONLY live host. In the browser that missing header makes
// fetch() throw, and src/lib/downloadHelper.ts catches it and falls back to an
// anchor with target="_blank" — where the `download` attribute is ignored across
// origins. The file opens in a tab. Exactly what he described.
//
// UPLOADS ARE NOT AFFECTED, and an earlier draft of this file wrongly said they
// were. The Firebase JS SDK uploads through firebasestorage.googleapis.com, which
// answers CORS on its own, and the bucket holds 25 uploaded files — the newest
// from 2026-09-12. The PUT/POST/DELETE below are for the media library that is
// coming, not a fix for something broken.
//
// This ADDS what is missing and keeps every origin already there. The Vercel one
// is dead, but removing it is a separate decision and a CORS policy is replaced
// whole — dropping an entry by accident is easy, so this does not.
//
//   node scripts/fix-storage-cors.mjs             # show what would change
//   node scripts/fix-storage-cors.mjs --apply     # write it
//   node scripts/fix-storage-cors.mjs --revert --apply   # put the saved policy back

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
const BUCKET = cfg.storageBucket;
const APPLY = process.argv.includes('--apply');
const REVERT = process.argv.includes('--revert');

const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const token = (await app.options.credential.getAccessToken()).access_token;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const BUCKET_URL = `https://storage.googleapis.com/storage/v1/b/${BUCKET}`;

const WANT_ORIGINS = [
  'https://shop.reklamx.se', // the live shop — the one that was missing
  'https://reklamx.se',
  'https://www.reklamx.se',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
// HEAD and GET to read, PUT and POST for a resumable upload, DELETE so a replaced
// file can be removed. OPTIONS is the preflight itself.
const WANT_METHODS = ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS'];

// Exposed response headers. The live policy already lists three, and
// Content-Disposition is the one that carries the file's name into the download —
// an earlier draft of this script replaced the list with ['*'], which would have
// traded a header that demonstrably works for a wildcard GCS may store as a header
// literally named "*". So: union, never replace. The rest are what a resumable
// upload reads back.
const WANT_HEADERS = [
  'Content-Type',
  'Content-Disposition',
  'Content-Length',
  'Content-Range',
  'ETag',
  'Location',
  'Range',
  'X-Goog-Upload-Status',
  'X-Goog-Upload-URL',
  'X-Goog-Upload-Chunk-Granularity',
];

const cur = await (await fetch(`${BUCKET_URL}?fields=cors`, { headers: H })).json();
console.log(`bucket: ${BUCKET}\n`);
console.log('CORS NOW:');
if (!cur.cors || !cur.cors.length) {
  console.log('  (empty — every browser upload is refused)');
} else {
  for (const c of cur.cors) {
    console.log(`  origins ${JSON.stringify(c.origin)}`);
    console.log(`  methods ${JSON.stringify(c.method)}  maxAge ${c.maxAgeSeconds}`);
    console.log(`  headers ${JSON.stringify(c.responseHeader || [])}`);
  }
}

const dir = join(ROOT, '.backups');

if (REVERT) {
  // Exit 2, not 1, when there is simply nothing to undo. The launcher reads the
  // code to tell "you never applied it" apart from "the undo failed" — on
  // 2026-09-12 the owner opened the revert launcher by mistake and the only clue
  // that nothing had happened was one line of English among the output.
  const saved = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.startsWith('storage-cors-')).sort().pop()
    : null;
  if (!saved) {
    console.log('\nNo saved CORS policy in .backups/ — the fix was never applied,');
    console.log('so there is nothing to undo and nothing was changed.');
    process.exit(2);
  }
  const old = JSON.parse(readFileSync(join(dir, saved), 'utf8'));
  console.log(`\nwould restore ${saved}`);
  if (!APPLY) { console.log('Add --apply to write it.'); process.exit(0); }
  const r = await fetch(BUCKET_URL, { method: 'PATCH', headers: H, body: JSON.stringify({ cors: old }) });
  console.log(r.ok ? '\n✅ restored' : `\n❌ ${r.status} ${(await r.text()).slice(0, 300)}`);
  process.exit(r.ok ? 0 : 1);
}

const existing = (cur.cors || []).flatMap((c) => c.origin || []);
const existingMethods = (cur.cors || []).flatMap((c) => c.method || []);
const existingHeaders = (cur.cors || []).flatMap((c) => c.responseHeader || []);
const origins = [...new Set([...WANT_ORIGINS, ...existing])];
const methods = [...new Set([...WANT_METHODS, ...existingMethods])];
// Case-insensitively, so "content-type" already there does not become a duplicate.
const headers = [...WANT_HEADERS];
for (const h of existingHeaders) {
  if (!headers.some((k) => k.toLowerCase() === h.toLowerCase())) headers.push(h);
}

console.log('\nCORS AFTER:');
console.log(`  origins ${JSON.stringify(origins)}`);
console.log(`  methods ${JSON.stringify(methods)}  maxAge 3600`);
console.log(`  headers ${JSON.stringify(headers)}`);

const addedOrigins = WANT_ORIGINS.filter((o) => !existing.includes(o));
const addedMethods = WANT_METHODS.filter((m) => !existingMethods.includes(m));
const addedHeaders = WANT_HEADERS.filter((h) => !existingHeaders.some((k) => k.toLowerCase() === h.toLowerCase()));
const lost = existingHeaders.filter((h) => !headers.some((k) => k.toLowerCase() === h.toLowerCase()));
if (addedOrigins.length) console.log(`\n  adding origin(s): ${addedOrigins.join(', ')}`);
if (addedMethods.length) console.log(`  adding method(s): ${addedMethods.join(', ')}`);
if (addedHeaders.length) console.log(`  adding header(s): ${addedHeaders.join(', ')}`);
console.log(`  removing: ${lost.length ? lost.join(', ') : 'nothing — this only adds'}`);

if (!APPLY) { console.log('\nDry run. Add --apply to write it.'); process.exit(0); }

mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(dir, `storage-cors-${stamp}.json`);
writeFileSync(backup, JSON.stringify(cur.cors || [], null, 2));
console.log(`\nSaved the old policy to ${backup}`);

const res = await fetch(BUCKET_URL, {
  method: 'PATCH',
  headers: H,
  body: JSON.stringify({
    cors: [{ origin: origins, method: methods, responseHeader: headers, maxAgeSeconds: 3600 }],
  }),
});
if (!res.ok) { console.error(`\n❌ ${res.status} ${(await res.text()).slice(0, 400)}`); process.exit(1); }
console.log('\n✅ CORS updated');
console.log('\nTo undo:\n  node scripts/fix-storage-cors.mjs --revert --apply');
