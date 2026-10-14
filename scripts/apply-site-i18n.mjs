#!/usr/bin/env node
// Put the shop's own copy into the four languages.
//
// Every string the OWNER typed — the announcement bar, the hero slides, the
// home tiles, the footer, and the About / Services / Contact pages — lives in
// `settings/siteConfig`, and until now it had one value each. The storefront
// showed a Swedish customer a Swedish product name under an English headline,
// an English announcement and an English footer: the first line on the page was
// in the wrong language. This writes the sv/da/no map beside each one.
//
// The English string is never touched. It stays canonical and stays the
// fallback, so anything not translated still renders exactly as it does today.
//
//   node scripts/apply-site-i18n.mjs            # show what would change
//   node scripts/apply-site-i18n.mjs --apply    # write it
//
// The translations live in a JSON file keyed by path, e.g.
//   "heroSlides[0].badge": { "sv": "...", "da": "...", "no": "..." }
// Pass a different one with --file=<path>.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const fileArg = process.argv.find((a) => a.startsWith('--file='));
const FILE = fileArg ? fileArg.slice('--file='.length) : '/tmp/site-i18n-final.json';

const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
initializeApp({ credential: cert(sa), projectId: sa.project_id });
const db = getFirestore(cfg.firestoreDatabaseId || '(default)');

const translations = JSON.parse(readFileSync(FILE, 'utf8'));
const LANGS = ['sv', 'da', 'no'];

/** "servicesPageSettings.servicesList[2].title" -> ['servicesPageSettings','servicesList',2,'title'] */
const parsePath = (key) =>
  key
    .split('.')
    .flatMap((part) => {
      const m = part.match(/^([^[\]]+)((\[\d+\])*)$/);
      if (!m) throw new Error(`Cannot parse path segment: ${part} (in ${key})`);
      const idx = [...m[2].matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));
      return [m[1], ...idx];
    });

const ref = db.collection('settings').doc('siteConfig');
const snap = await ref.get();
if (!snap.exists) {
  console.error('settings/siteConfig does not exist. Nothing to do.');
  process.exit(1);
}
// A deep copy, so the document is only ever replaced by something built from
// exactly what was read — no field this script does not know about is dropped.
const config = JSON.parse(JSON.stringify(snap.data()));

let planned = 0, missing = 0, unchanged = 0;
const lines = [];

for (const [key, map] of Object.entries(translations)) {
  const path = parsePath(key);
  const leaf = path[path.length - 1];
  let node = config;
  let ok = true;
  for (const step of path.slice(0, -1)) {
    if (node == null || typeof node !== 'object' || !(step in node)) { ok = false; break; }
    node = node[step];
  }
  if (!ok || node == null || typeof node !== 'object' || typeof node[leaf] !== 'string') {
    lines.push(`  ⚠ ${key} — not present in the live document, skipped`);
    missing++;
    continue;
  }

  const target = `${leaf}I18n`;
  const next = {};
  for (const l of LANGS) if (map[l] && String(map[l]).trim()) next[l] = String(map[l]).trim();
  const before = JSON.stringify(node[target] ?? null);
  const after = JSON.stringify(Object.keys(next).length ? next : null);
  if (before === after) { unchanged++; continue; }

  node[target] = Object.keys(next).length ? next : null;
  planned++;
  lines.push(`  ${key}\n      en: ${node[leaf]}\n      sv: ${next.sv || '—'}\n      da: ${next.da || '—'}\n      no: ${next.no || '—'}`);
}

console.log(`\n${lines.join('\n')}\n`);
console.log(`${planned} field(s) to write · ${unchanged} already correct · ${missing} not found in the document`);

if (!APPLY) {
  console.log('\nDry run. Nothing was written. Re-run with --apply to write it.\n');
  process.exit(0);
}
if (planned === 0) {
  console.log('\nNothing to write.\n');
  process.exit(0);
}

// MERGE, not replace: several screens write this document and a whole-document
// write is how the site logo was lost once before. `config` is the document as
// it was read plus the new keys, so a merge changes only what changed.
await ref.set(config, { merge: true });
console.log(`\n✅ wrote ${planned} field(s) to settings/siteConfig\n`);
