#!/usr/bin/env node
// Build the supplier index — plan task 3.1.
//
// "An indexing job, not a request-time cache." EasyGifts' Swedish offer file is
// 13 MB and 2 792 rows; no request that also serves the storefront may parse one,
// and no screen may download one. This runs on its own, streams the feed, and
// writes a SLIM row per product — 364 bytes, measured — into `supplierIndex`,
// which the picker then reads a page at a time.
//
// The index is CLOSED (firestore.rules): every row carries the wholesale price,
// and a world-readable index would publish the trade price of the whole
// catalogue. The dashboard reads it through an admin endpoint.
//
//   node scripts/index-supplier.mjs easygifts            # show what would change
//   node scripts/index-supplier.mjs easygifts --apply    # write it
//   node scripts/index-supplier.mjs promediaplus --apply
//
// Pro Media Plus joined this job in 3.7, when it was moved onto the shared
// supplier model. Its feed needs the B2B login, which lives in
// secrets/integrations and is read from there rather than typed on a command
// line where it would end up in a shell history.
//
// Safe to re-run: entries are keyed on supplier + product, so a second run
// updates rather than duplicates. Products that have LEFT the feed are marked
// `gone` rather than deleted — a product the owner has already imported must not
// lose the row that explains where it came from.

import { build } from 'esbuild';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const supplier = (process.argv[2] ?? '').trim().toLowerCase();
const APPLY = process.argv.includes('--apply');

const ADAPTERS = ['easygifts', 'promediaplus', 'midocean'];
if (!ADAPTERS.includes(supplier)) {
  console.error(`Usage: node scripts/index-supplier.mjs <${ADAPTERS.join('|')}> [--apply]`);
  process.exit(1);
}
if (!existsSync(join(ROOT, 'service-account.json'))) {
  console.error('service-account.json not found in the project root.');
  process.exit(1);
}

// The adapter is TypeScript and this is a plain script, so it is bundled the way
// the unit tests bundle it — one implementation, never a second copy that drifts.
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-index-'));
const mods = {};
for (const [mod, rel] of [
  ['easyGifts', ['src', 'lib', 'suppliers', 'easyGifts.ts']],
  ['types', ['src', 'lib', 'suppliers', 'types.ts']],
  ['proMediaPlus', ['src', 'lib', 'suppliers', 'proMediaPlus.ts']],
  ['supplierFeed', ['src', 'lib', 'supplierFeed.ts']],
  ['midocean', ['src', 'lib', 'suppliers', 'midocean.ts']],
]) {
  const out = join(outDir, `${mod}.mjs`);
  await build({
    entryPoints: [join(ROOT, ...rel)],
    outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
  });
  mods[mod] = await import(pathToFileURL(out).href);
}
rmSync(outDir, { recursive: true, force: true });
const { parseEasyGifts } = mods.easyGifts;
const { toIndexEntry } = mods.types;
const { offersToSupplierProducts } = mods.proMediaPlus;
const { parseSupplierFeed } = mods.supplierFeed;
const { parseMidocean } = mods.midocean;

const BASE = 'https://easygifts.com.pl/data/webapi2';
async function grab(lang, file) {
  const res = await fetch(`${BASE}/${lang}/json/${file}.json`, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`${lang}/${file}: HTTP ${res.status}`);
  return res.json();
}

// The credentials for a feed that needs them, read from the same place the
// server reads them. Firebase is initialised below for the write; this needs it
// first, so the init is hoisted here rather than duplicated.
const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore(cfg.firestoreDatabaseId || '(default)');

async function loadProducts() {
  if (supplier === 'easygifts') {
    console.log(`\nfetching the EasyGifts feed…`);
    const t0 = Date.now();
    const [en, se, dk, prices, stocks] = await Promise.all([
      grab('en', 'offer'), grab('se', 'offer'), grab('dk', 'offer'),
      grab('se', 'prices'), grab('se', 'stocks'),
    ]);
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s · en ${en.length} · se ${se.length} · dk ${dk.length} rows`);
    return parseEasyGifts({ offers: en, prices, stocks, translations: { sv: se, da: dk } });
  }

  if (supplier === 'midocean') {
    // 26 MB of products and 1.3 MB of prices, and the products endpoint answers
    // 303 with a signed S3 URL — fetch follows that; the redirect is not an
    // error. Prices come back in SEK already, so nothing is converted.
    console.log(`\nfetching the midocean feed…`);
    const secrets = await db.collection('secrets').doc('integrations').get();
    const key = String(secrets.exists ? (secrets.data()?.midocean?.apiKey ?? '') : '').trim();
    if (!key) {
      console.error('The midocean API key has not been saved in the dashboard yet.');
      process.exit(1);
    }
    const t0 = Date.now();
    const grab = async (path) => {
      const res = await fetch(`https://api.midocean.com${path}`, {
        headers: { 'x-Gateway-APIKey': key, Accept: 'application/json' },
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) {
        console.error(`midocean ${path} answered ${res.status}.`);
        process.exit(1);
      }
      return res.json();
    };
    const [mproducts, mprices] = await Promise.all([
      grab('/gateway/products/2.0?language=en'),
      grab('/gateway/pricelist/2.0'),
    ]);
    const parsed = parseMidocean({ products: mproducts, prices: mprices });
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s · ${parsed.length} masters`);
    return parsed;
  }

  // Pro Media Plus: XML over HTTP Basic, and the login is in secrets/integrations.
  console.log(`\nfetching the Pro Media Plus feed…`);
  const secrets = await db.collection('secrets').doc('integrations').get();
  const creds = secrets.exists ? (secrets.data()?.supplier ?? {}) : {};
  if (!creds.user || !creds.pass) {
    console.error('The Pro Media Plus login has not been saved in the dashboard yet.');
    process.exit(1);
  }
  const t0 = Date.now();
  const auth = `Basic ${Buffer.from(`${creds.user}:${creds.pass}`).toString('base64')}`;
  const res = await fetch('https://b2b.promediaplus.pl/en/xml/shop_integration.xml', {
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    console.error(`The supplier feed answered ${res.status}.`);
    process.exit(1);
  }
  const { offers, skipped } = parseSupplierFeed(await res.text());
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s · ${offers.length} offers · ${skipped} unpriced rows skipped`);
  return offersToSupplierProducts(offers);
}

const products = await loadProducts();
const entries = products.map(toIndexEntry);
const priced = entries.filter((e) => typeof e.sourcePrice === 'number').length;

console.log(`\n${products.length} products · ${entries.length} index rows`);
console.log(`  ${priced} priced, ${entries.length - priced} with no usable price`);
console.log(`  ${(JSON.stringify(entries).length / 1024 / 1024).toFixed(2)} MB in total`);
console.log(`  ${entries.filter((e) => e.nameSv).length} carry a Swedish name`);

// A document id may not contain '/'. Supplier keys are alphanumeric in every
// feed seen, but the id is built rather than trusted.
const idFor = (e) => `${e.supplier}__${String(e.productKey).replace(/[^\w.-]+/g, '_')}`;

// Reading what is already indexed is a CONVENIENCE — it says how many rows have
// left the feed. Firestore can refuse it (the read quota ran out on 2026-09-12
// and this is exactly the kind of job that meets that wall), and when it does
// the feed analysis above is still the useful half. So the failure is reported
// and the run continues in a mode that adds and updates but marks nothing gone:
// marking rows gone from an EMPTY comparison would mark nothing, which is safe,
// but pretending the comparison happened would not be.
let had = null;
try {
  const existing = await db.collection('supplierIndex').where('supplier', '==', supplier).select('productKey').get();
  had = new Set(existing.docs.map((d) => d.id));
} catch (err) {
  console.log(`\n⚠️  Could not read the existing index: ${String(err?.message ?? err).slice(0, 120)}`);
  console.log('   Continuing — new rows can still be written; nothing will be marked as gone.');
}

const willHave = new Set(entries.map(idFor));
const gone = had ? [...had].filter((id) => !willHave.has(id)) : [];

if (had) {
  console.log(`\nalready indexed: ${had.size}`);
  console.log(`  new or updated: ${entries.length}`);
  console.log(`  no longer in the feed: ${gone.length}${gone.length ? ' — marked `gone`, not deleted' : ''}`);
} else {
  console.log(`\n  ${entries.length} rows would be written; the comparison with what is there is unavailable.`);
}

if (!APPLY) {
  console.log('\nNothing written. Re-run with --apply.');
  process.exit(0);
}

const nowIso = new Date().toISOString();
const BATCH = 400;
let written = 0;
for (let i = 0; i < entries.length; i += BATCH) {
  const batch = db.batch();
  for (const e of entries.slice(i, i + BATCH)) {
    batch.set(db.collection('supplierIndex').doc(idFor(e)), { ...e, gone: false, indexedAt: nowIso });
    written += 1;
  }
  await batch.commit();
  process.stdout.write(`\r  writing… ${written}/${entries.length}`);
}
// Marked, never deleted: an imported product's row is the only record of where
// it came from, and a supplier dropping a line must not erase that.
for (let i = 0; i < gone.length; i += BATCH) {
  const batch = db.batch();
  for (const id of gone.slice(i, i + BATCH)) {
    batch.set(db.collection('supplierIndex').doc(id), { gone: true, indexedAt: nowIso }, { merge: true });
  }
  await batch.commit();
}
console.log(`\n\n✅ ${written} indexed${gone.length ? `, ${gone.length} marked gone` : ''}.`);
