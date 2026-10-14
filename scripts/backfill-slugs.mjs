#!/usr/bin/env node
// Give every existing product the web address its name earned.
//
// Products are addressed by name now (/products/premium-card, not
// /products/prod-1787944572548). New saves derive the slug in the admin; this
// writes one onto the products that were saved before that existed.
//
// The product page can already find those products by matching their name, so
// this is an optimisation, not a repair: with a stored slug the lookup is one
// indexed read instead of a walk over the whole catalogue.
//
//   node scripts/backfill-slugs.mjs           # show what would change
//   node scripts/backfill-slugs.mjs --apply   # write it
//
// Cost: one read per product, and one write per product that needs a slug.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
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

// The same rules as src/lib/slug.ts. Kept in step by the test below it —
// scripts run on plain node and cannot import the TypeScript module.
const FOLD = [[/ø/g, 'o'], [/æ/g, 'ae'], [/ß/g, 'ss'], [/đ/g, 'd'], [/ł/g, 'l']];
function slugify(input) {
  let text = String(input || '').toLowerCase();
  for (const [pattern, replacement] of FOLD) text = text.replace(pattern, replacement);
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

const apply = process.argv.includes('--apply');
const snap = await db.collection('products').get();

const taken = new Set();
for (const d of snap.docs) {
  const stored = String(d.data().slug || '').trim();
  if (stored) taken.add(stored);
}

let changed = 0;
for (const d of snap.docs) {
  const data = d.data();
  const stored = String(data.slug || '').trim();
  const base = slugify(data.name);
  if (!base) {
    console.log(`  ${d.id.padEnd(24)} name yields no address — stays on its id`);
    continue;
  }
  if (stored === base) continue;
  if (stored) {
    console.log(`  ${d.id.padEnd(24)} keeps its address (${stored})`);
    continue;
  }
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  taken.add(slug);
  changed += 1;
  console.log(`  ${d.id.padEnd(24)} → /products/${slug}`);
  if (apply) await d.ref.update({ slug });
}

console.log(
  changed === 0
    ? '\nEvery product already has its address.'
    : apply
      ? `\n${changed} product(s) updated.`
      : `\n${changed} product(s) would be updated. Re-run with --apply to write it.`,
);
process.exit(0);
