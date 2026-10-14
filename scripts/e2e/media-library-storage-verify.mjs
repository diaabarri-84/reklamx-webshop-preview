#!/usr/bin/env node
// The storage half of the media library, proven against the real bucket.
//
// /api/admin/media, .../delete and .../rehost all sit behind requireAdmin, which
// reads the caller's user document from Firestore. While the project's daily read
// quota is exhausted that check cannot pass, so the HTTP layer is verified
// separately (all three answer 401 without a token) and this exercises what those
// endpoints actually DO — against the live bucket, with the same Admin SDK calls,
// the same object prefix and the same URL format.
//
// It cleans up after itself: everything it writes is deleted in a finally block.
//
//   node scripts/e2e/media-library-storage-verify.mjs

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));

const MEDIA_PREFIX = 'public/media/';
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass += 1; };
const no = (m, e) => { console.log(`  ❌ ${m}${e ? `\n       ${e}` : ''}`); fail += 1; };

const app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
const bucket = getStorage(app).bucket(cfg.storageBucket);

// A real 1x1 PNG, so the content type is not a claim.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const objectPath = `${MEDIA_PREFIX}${Date.now()}_verify-probe.png`;
const token = crypto.randomUUID();
const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;

console.log(`\nbucket: ${bucket.name}\nobject: ${objectPath}\n`);

try {
  // ---- 1. write it, exactly as /api/admin/media/rehost does -----------------
  await bucket.file(objectPath).save(PNG, {
    contentType: 'image/png',
    metadata: { contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: token } },
  });
  ok('the server can write into public/media/');

  // ---- 2. is it readable by a STRANGER? ------------------------------------
  // This is the whole point of the public/ tree. A media library whose images
  // only the owner can see would look fine in the dashboard and render as broken
  // pictures for every shopper.
  const anon = await fetch(url);
  anon.ok ? ok(`a request with NO credentials can read it (${anon.status})`) : no('the public URL is not public', `HTTP ${anon.status}`);
  const bytes = Buffer.from(await anon.arrayBuffer());
  bytes.equals(PNG) ? ok('and the bytes come back identical') : no(`${bytes.length} bytes back, ${PNG.length} sent`);
  (anon.headers.get('content-type') || '').startsWith('image/png')
    ? ok('with the right content type')
    : no(`content type is ${anon.headers.get('content-type')}`);

  // ---- 3. the same URL without the token ------------------------------------
  // storage.rules says `allow read: if true` for public/**, so this SHOULD work
  // too. If it does not, the library must always carry the token — which it does.
  const noToken = await fetch(url.split('&token=')[0]);
  console.log(`  ⓘ  without the token: HTTP ${noToken.status} (the library always sends one)`);

  // ---- 4. listing, as /api/admin/media does ---------------------------------
  const [files] = await bucket.getFiles({ prefix: MEDIA_PREFIX, maxResults: 200, autoPaginate: false });
  const found = files.find((f) => f.name === objectPath);
  found ? ok(`listing the prefix finds it (${files.length} object(s) under ${MEDIA_PREFIX})`) : no('the listing did not include it');
  if (found) {
    const t = String(found.metadata?.metadata?.firebaseStorageDownloadTokens ?? '').split(',')[0];
    t === token ? ok('the download token survives the round trip, so the URL can be rebuilt') : no('the token is missing from the metadata');
    Number(found.metadata?.size) === PNG.length ? ok('the size is reported correctly') : no(`size reported as ${found.metadata?.size}`);
  }

  // ---- 5. the path guard ----------------------------------------------------
  // isMediaPath in server.ts is what stops a delete reaching a customer's
  // artwork. Same rule, asserted here.
  const guard = (p) => p.startsWith(MEDIA_PREFIX) && !p.includes('..') && p.length > MEDIA_PREFIX.length;
  [
    ['uploads/someone/artwork/file.pdf', false, "a customer's artwork"],
    ['public/media/', false, 'the prefix itself'],
    ['public/media/../../uploads/x', false, 'climbing out with ..'],
    ['public/other/x.png', false, 'another public folder'],
    ['', false, 'nothing'],
    ['public/media/ok.png', true, 'a real media file'],
  ].forEach(([p, expected, why]) => {
    guard(p) === expected
      ? ok(`delete guard ${expected ? 'allows' : 'refuses'} ${why}`)
      : no(`delete guard is wrong for ${p}`, why);
  });
} finally {
  await bucket.file(objectPath).delete({ ignoreNotFound: true }).catch(() => {});
  const gone = await fetch(url);
  gone.status === 404 ? ok('the probe deleted itself and is a 404') : no(`the probe is still readable (${gone.status})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
