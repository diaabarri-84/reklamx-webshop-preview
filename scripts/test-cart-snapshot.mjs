#!/usr/bin/env node
// A basket reduced to what a report may keep — src/lib/cartSnapshot.ts.
//
// WHY IT EXISTS — plan task 5.7c. The cart carries the customer's ARTWORK, and on
// the fallback path that artwork is the FILE ITSELF as base64, in two fields at
// once, up to 85% of a megabyte per basket. Copying a cart verbatim into
// Firestore would put a customer's print file somewhere nobody asked for it,
// push the document against the 1 MiB limit so the write fails on exactly the
// baskets worth the most, and spend the free tier on bytes no report reads.
//
// So the tests below are mostly about what must NOT come through.
//
// Usage:  node scripts/test-cart-snapshot.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-snap-'));
const out = join(outDir, 'cartSnapshot.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'cartSnapshot.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { snapshotCart, worthRecording, fingerprintCart, MAX_SNAPSHOT_LINES } =
  await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond) => check(name, Boolean(cond), true);

// A realistic line, including the fallback path where the FILE is in the cart.
const bigBase64 = 'data:application/pdf;base64,' + 'A'.repeat(400_000);
const bigThumb = 'data:image/png;base64,' + 'B'.repeat(290_119);   // a real one, measured
const cart = [
  {
    id: 'l1', productId: 'prod-rollup', productName: 'Roll Up 85x200', image: bigThumb, quantity: 2,
    totalUnitPrice: 745, totalPrice: 1490,
    fileName: 'customer-logo.pdf',
    fileUrl: bigBase64,                    // ← the whole file, in the cart
    storagePath: 'orders/abc/customer-logo.pdf',
    artworkPending: false,
    selectedOptions: { Finish: { label: 'Matte' } },
    fileSpecs: { fileName: 'customer-logo.pdf', fileUrl: bigBase64, fileType: 'PDF' },
  },
  {
    id: 'l2', productId: 'prod-card', productName: 'Business cards', image: bigThumb, quantity: 500,
    totalPrice: 890, artworkPending: true, fileUrl: null, fileSpecs: null,
  },
  {
    id: 'l3', isCustomUpload: true, title: 'Your own file', quantity: 1,
    totalPrice: 149, fileUrl: bigBase64, fileSpecs: { fileUrl: bigBase64 },
  },
];

const snap = snapshotCart(cart);

console.log('\nwhat the snapshot KEEPS');
check('one entry per line', snap.lines.length, 3);
check('the product id, so he can see WHAT people abandon', snap.lines[0].productId, 'prod-rollup');
check('the name', snap.lines[0].name, 'Roll Up 85x200');
check('the quantity', [snap.lines[0].quantity, snap.lines[1].quantity], [2, 500]);
// Three shapes share this key and name themselves differently — a configured
// product has `productName`, a custom upload has `title`.
check('a custom upload names itself `title`, and is still named', snap.lines[2].name, 'Your own file');
check('the value of the basket, ex VAT', snap.value, 2529);
check('how many items in total', snap.itemCount, 503);
// "He never sent the file" is one of the most useful reasons a basket stalls —
// and it is a boolean, not a file.
check('and that a line is still waiting for artwork', snap.anyArtworkPending, true);

console.log('\nwhat it must NEVER keep');
const asText = JSON.stringify(snap);
ok('not the base64 artwork', !asText.includes('AAAA'));
ok('not the file name', !/customer-logo/.test(asText));
ok('not the storage path', !/orders\/abc/.test(asText));
// THE BIGGEST ONE BY BYTES, and the one the shop's own artwork guard does not
// count: the product thumbnail, which is base64 whenever it was uploaded rather
// than linked. Four such lines are 1.11 MB — over the Firestore document limit,
// with no artwork in the basket at all.
ok('and NOT the product thumbnail', !asText.includes('BBBB'));
ok('not the option labels', !/Matte/.test(asText));
// The whole point: the snapshot is small enough that a write can never fail
// because of the artwork.
ok(`and the whole snapshot is tiny (${asText.length} bytes, from a ${Math.round(JSON.stringify(cart).length / 1024)} KB cart)`,
  asText.length < 2000);

console.log('\nthe fingerprint — so an unchanged basket is not written again');
check('the same basket hashes the same twice', snapshotCart(cart).fingerprint, snap.fingerprint);
ok('a changed quantity changes it',
  snapshotCart([{ ...cart[0], quantity: 3 }, cart[1], cart[2]]).fingerprint !== snap.fingerprint);
ok('a changed price changes it',
  snapshotCart([{ ...cart[0], totalPrice: 1500 }, cart[1], cart[2]]).fingerprint !== snap.fingerprint);
ok('a removed line changes it', snapshotCart([cart[0], cart[1]]).fingerprint !== snap.fingerprint);
// The artwork is not part of the identity of a basket — uploading the file must
// not look like a different basket.
// EVERY line, or this compares a two-line basket with a three-line one and
// "the artwork changed nothing" passes or fails for the wrong reason.
check('but attaching artwork does NOT, because the snapshot never saw it',
  snapshotCart([{ ...cart[0], fileUrl: 'https://x/other.pdf' }, cart[1], cart[2]]).fingerprint,
  snap.fingerprint);
check('and neither does swapping the product thumbnail',
  snapshotCart([{ ...cart[0], image: 'https://cdn/other.png' }, cart[1], cart[2]]).fingerprint,
  snap.fingerprint);

console.log('\nworthRecording — an empty basket is not an abandoned one');
check('a real basket is worth recording', worthRecording(snap), true);
check('an empty one is not', worthRecording(snapshotCart([])), false);
// A line whose price never resolved is a bug to fix, not a sale that was lost.
check('and neither is one worth nothing',
  worthRecording(snapshotCart([{ productId: 'x', quantity: 1, totalPrice: 0 }])), false);

console.log('\nit never throws, whatever it is handed');
for (const junk of [null, undefined, 'nope', 42, {}, [null], [undefined], [{ totalPrice: NaN }], [{ quantity: -5, totalPrice: -10 }]]) {
  try {
    const s = snapshotCart(junk);
    if (!Number.isFinite(s.value) || s.value < 0) { failed += 1; console.error(`  ❌ ${JSON.stringify(junk)} → value ${s.value}`); }
  } catch (e) { failed += 1; console.error(`  ❌ threw on ${JSON.stringify(junk)}: ${e.message}`); }
}
ok('every hostile input gives a finite, non-negative basket', true);
// A negative price would make "money that walked away" read as money earned.
check('a negative price counts as nothing, never as a credit',
  snapshotCart([{ productId: 'x', quantity: 1, totalPrice: -500 }]).value, 0);

console.log('\na very long basket is described, not dumped');
const long = Array.from({ length: 60 }, (_, i) => ({ productId: `p${i}`, productName: `Item ${i}`, quantity: 1, totalPrice: 10 }));
const big = snapshotCart(long);
check(`at most ${MAX_SNAPSHOT_LINES} lines are described`, big.lines.length, MAX_SNAPSHOT_LINES);
check('but the COUNT is honest', big.lineCount, 60);
// The value must cover the whole basket, or the report understates the loss.
check('and the value covers every line, not just the described ones', big.value, 600);

console.log(`\n${failed === 0 ? 'A basket can be reported on without keeping the customer’s file.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
