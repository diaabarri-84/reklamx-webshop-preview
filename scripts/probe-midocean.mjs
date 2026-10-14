#!/usr/bin/env node
// What the midocean feed ACTUALLY contains — a read-only shape probe.
//
// src/lib/suppliers/midocean.ts was written against a probe of the live API and
// the vendor's public documentation, not against a schema anyone guarantees, so
// its field lookups try more than one plausible name per concept. This prints
// what the live feed really sends, so that list can be narrowed to the truth.
//
// It PRINTS FIELD NAMES AND COUNTS, never values: the price list is the trade
// price of fifteen thousand products and has no business in a terminal
// scrollback or a screenshot. The API key is read from secrets/integrations and
// is never printed.
//
//   node scripts/probe-midocean.mjs
//
// Read-only. It writes nothing, anywhere.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(join(ROOT, 'service-account.json'))) {
  console.error('service-account.json not found in the project root.');
  process.exit(1);
}
const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore(cfg.firestoreDatabaseId || '(default)');

const snap = await db.collection('secrets').doc('integrations').get();
const key = String(snap.exists ? (snap.data()?.midocean?.apiKey ?? '') : '').trim();
if (!key) {
  console.error('No midocean API key is stored. Save it in the supplier screen first.');
  process.exit(1);
}

const grab = async (path) => {
  const t0 = Date.now();
  // /gateway/products/2.0 answers 303 with a pre-signed S3 URL. fetch follows it
  // by default; the redirect is not an error however much it reads like one.
  const res = await fetch(`https://api.midocean.com${path}`, {
    headers: { 'x-Gateway-APIKey': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    console.error(`${path} answered ${res.status}.`);
    process.exit(1);
  }
  const text = await res.text();
  console.log(`  ${path} · ${res.status} · ${(text.length / 1024 / 1024).toFixed(1)} MB · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return JSON.parse(text);
};

console.log('\nfetching…');
const products = await grab('/gateway/products/2.0?language=en');
const prices = await grab('/gateway/pricelist/2.0');

const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o) : []);
const arrayIn = (o) => (Array.isArray(o) ? o : keysOf(o).map((k) => o[k]).find(Array.isArray) ?? []);

const masters = arrayIn(products);
const priceRows = arrayIn(prices);

console.log(`\n${masters.length} masters · ${priceRows.length} price rows`);
console.log(`\nthe products file is wrapped as: ${Array.isArray(products) ? 'a bare array' : keysOf(products).join(', ')}`);
console.log(`the price list is wrapped as:     ${Array.isArray(prices) ? 'a bare array' : keysOf(prices).join(', ')}`);

console.log('\nMASTER fields');
console.log(`  ${keysOf(masters[0]).join('\n  ')}`);

const variants = arrayIn(masters[0]?.variants ?? masters[0]?.variant ?? []);
console.log(`\nVARIANT fields (${variants.length} on the first master)`);
console.log(`  ${keysOf(variants[0]).join('\n  ')}`);

const assets = arrayIn(variants[0]?.digital_assets ?? masters[0]?.digital_assets ?? []);
console.log('\nDIGITAL ASSET fields');
console.log(`  ${keysOf(assets[0]).join('\n  ')}`);

console.log('\nPRICE ROW fields');
console.log(`  ${keysOf(priceRows[0]).join('\n  ')}`);

// The one value worth printing, because the whole adapter turns on it.
const currencies = new Set(priceRows.map((r) => String(r?.currency ?? '').toUpperCase()).filter(Boolean));
console.log(`\ncurrencies in the price list: ${[...currencies].join(', ') || '(none stated)'}`);

const totalVariants = masters.reduce((n, m) => n + arrayIn(m?.variants ?? []).length, 0);
console.log(`variants across every master: ${totalVariants}`);
console.log('\nNothing was written. Field names only — no prices were printed.\n');
process.exit(0);
