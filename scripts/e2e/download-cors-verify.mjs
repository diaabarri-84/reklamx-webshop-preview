#!/usr/bin/env node
// Prove — or disprove — that a staff member can DOWNLOAD a customer's artwork.
//
// This is the acceptance test for plan task 0.1, and it is written to be run both
// before and after the fix so the difference is visible rather than asserted.
//
// WHAT IT ACTUALLY TESTS
// src/lib/downloadHelper.ts fetches the artwork URL and saves the blob. A
// cross-origin fetch without an Access-Control-Allow-Origin header throws, and the
// helper then falls back to <a download target="_blank"> — where the download
// attribute is ignored across origins, so the file opens in a tab instead of
// saving. That is the bug the client reported on 2026-08-24. It came back when the
// site moved to shop.reklamx.se and the bucket's origin list was not extended.
//
// So: take a REAL object out of the bucket, build the REAL download URL the
// dashboard uses, and ask for it once per origin. The header is the whole answer.
//
//   node scripts/e2e/download-cors-verify.mjs
//
// Exit 0 = the live host can download. Exit 1 = it cannot, and the customer-facing
// symptom is back.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
const BUCKET = cfg.storageBucket;

// The one that must pass. Everything else is context.
const LIVE_ORIGIN = 'https://shop.reklamx.se';
const ALSO_CHECK = ['https://reklamx.se', 'https://www.reklamx.se', 'http://localhost:3000'];

const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const token = (await app.options.credential.getAccessToken()).access_token;
const AUTH = { Authorization: `Bearer ${token}` };

// A real customer file, not one this script uploads: the point is to test what is
// already in there. Newest first, so the sample stays representative.
const listed = await (await fetch(
  `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o?prefix=uploads/&maxResults=1000&fields=items(name,timeCreated)`,
  { headers: AUTH },
)).json();
const objects = (listed.items || []).sort((a, b) => String(b.timeCreated).localeCompare(String(a.timeCreated)));
if (!objects.length) {
  console.error('No uploaded files in the bucket — nothing to test against.');
  process.exit(1);
}

// getDownloadURL() hands out a tokenised URL, and that token is what the browser
// uses. Reading it from the object's metadata is the only way to build the exact
// URL the dashboard would have.
let target = null;
for (const o of objects) {
  const meta = await (await fetch(
    `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(o.name)}`,
    { headers: AUTH },
  )).json();
  const dl = meta.metadata?.firebaseStorageDownloadTokens?.split(',')[0];
  if (dl) { target = { name: o.name, url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(o.name)}?alt=media&token=${dl}` }; break; }
}
if (!target) {
  console.error('No object carries a download token — the dashboard could not build a URL either.');
  process.exit(1);
}

console.log(`bucket:  ${BUCKET}`);
console.log(`file:    ${target.name}`);
console.log(`objects: ${objects.length} under uploads/\n`);

async function check(origin) {
  const res = await fetch(target.url, { headers: { Origin: origin } });
  const acao = res.headers.get('access-control-allow-origin');
  const ok = acao === origin || acao === '*';
  console.log(`  ${ok ? '✅' : '❌'}  ${origin.padEnd(30)} ${res.status}  ACAO: ${acao ?? '(none)'}`);
  return ok;
}

console.log('GET the artwork as the browser would:');
const livePassed = await check(LIVE_ORIGIN);
for (const o of ALSO_CHECK) await check(o);

// The media library will PUT through this same policy. Not required for the
// download fix, so it is reported and not enforced.
const pre = await fetch(target.url, {
  method: 'OPTIONS',
  headers: { Origin: LIVE_ORIGIN, 'Access-Control-Request-Method': 'PUT' },
});
const allowed = pre.headers.get('access-control-allow-methods');
console.log(`\nPreflight PUT from ${LIVE_ORIGIN}: ${pre.status}  allow-methods: ${allowed ?? '(none)'}`);
console.log(`  ${/PUT/i.test(allowed || '') ? '✅ the media library will be able to upload' : 'ℹ️  no PUT yet — only matters once the media library ships'}`);

if (!livePassed) {
  console.error(`\n❌ FAILED. ${LIVE_ORIGIN} gets no Access-Control-Allow-Origin, so downloadHelper's`);
  console.error('   fetch() throws and the file opens in a tab instead of saving.');
  console.error('   Fix: double-click اضغط-هنا-لإصلاح-تحميل-الملفات.command');
  process.exit(1);
}
console.log(`\n✅ PASSED. ${LIVE_ORIGIN} can fetch the artwork, so Download saves the file.`);
process.exit(0);
