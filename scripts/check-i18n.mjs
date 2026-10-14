#!/usr/bin/env node
// Translation gate for ReklamX.
//
// Two failures are invisible until a customer hits them, so they are checked here
// instead of by eye:
//   1. Arabic left in the UI. The shop sells in English, Swedish, Danish and
//      Norwegian; Arabic is not a shop language, so any Arabic literal that
//      reaches the screen is a defect.
//   2. A t('key') whose key is missing from a locale. The resolver falls back to
//      the raw key, so the customer sees `cfgAddToCart` instead of a button label
//      — and nothing throws, so no test would catch it.
//
// Usage:  node scripts/check-i18n.mjs
// Exit:   0 = clean, 1 = problems found (suitable for a pre-deploy gate)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not url.pathname — this project lives under a directory with
// non-ASCII characters, which .pathname returns percent-encoded.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const TRANSLATIONS = join(SRC, 'lib', 'translations.ts');
const LOCALES = ['en', 'sv', 'da', 'no'];

const ARABIC = /[؀-ۿ]/;
// Matches t('key'), t("key") and (t as any)('key').
//
// The cast form was invisible to the old pattern, and six of them on the home
// page referenced keys that had never been written. t() returns the key itself
// when it cannot resolve one, and the `|| 'Gift Boxes'` fallback beside each
// call never fired because a returned key is a truthy string — so the shop's
// front page was capable of printing "giftBoxes" at a customer.
const T_CALL = /(?:\bt\b|\(\s*t\s+as\s+any\s*\))\(\s*['"]([A-Za-z0-9_.]+)['"]\s*\)/g;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Strip comments so Arabic notes to ourselves are not reported as UI text. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Pull the key names defined under each locale object in translations.ts. */
function localeKeys(source) {
  const result = {};
  for (const locale of LOCALES) {
    const start = source.indexOf(`\n  ${locale}: {`);
    if (start === -1) {
      result[locale] = null; // locale missing entirely
      continue;
    }
    // Read forward to the line that closes this locale at the same indent.
    const body = source.slice(start);
    const endRel = body.indexOf('\n  },');
    const block = endRel === -1 ? body : body.slice(0, endRel);
    const keys = new Set();
    for (const m of block.matchAll(/^\s{4}([A-Za-z0-9_]+)\s*:/gm)) keys.add(m[1]);
    result[locale] = keys;
  }
  return result;
}

const files = walk(SRC);
const translationsSource = readFileSync(TRANSLATIONS, 'utf8');
const keysByLocale = localeKeys(translationsSource);

for (const locale of LOCALES) {
  if (!keysByLocale[locale]) {
    console.error(`✗ locale "${locale}" not found in translations.ts`);
    process.exit(1);
  }
}

const arabicHits = [];
const usedKeys = new Map(); // key -> first "file:line" that uses it

for (const file of files) {
  const rel = relative(ROOT, file);
  const raw = readFileSync(file, 'utf8');

  // translations.ts is allowed to contain anything; it is the dictionary itself.
  if (rel !== relative(ROOT, TRANSLATIONS)) {
    const lines = stripComments(raw).split('\n');
    lines.forEach((line, i) => {
      if (ARABIC.test(line)) arabicHits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 90) });
    });
  }

  for (const m of raw.matchAll(T_CALL)) {
    if (!usedKeys.has(m[1])) {
      const line = raw.slice(0, m.index).split('\n').length;
      usedKeys.set(m[1], `${rel}:${line}`);
    }
  }
}

const missing = [];
for (const [key, where] of usedKeys) {
  const absent = LOCALES.filter((l) => !keysByLocale[l].has(key));
  if (absent.length) missing.push({ key, where, absent });
}

let failed = false;

console.log(`\nScanned ${files.length} files · ${usedKeys.size} translation keys in use\n`);

if (arabicHits.length) {
  failed = true;
  console.error(`✗ Arabic still present in ${new Set(arabicHits.map((h) => h.file)).size} file(s), ${arabicHits.length} line(s):\n`);
  const byFile = new Map();
  for (const h of arabicHits) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  for (const [file, hits] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.error(`   ${String(hits.length).padStart(4)}  ${file}`);
    for (const h of hits.slice(0, 2)) console.error(`         L${h.line}: ${h.text}`);
    if (hits.length > 2) console.error(`         … and ${hits.length - 2} more`);
  }
  console.error('');
} else {
  console.log('✓ No Arabic in the UI source');
}

if (missing.length) {
  failed = true;
  console.error(`✗ ${missing.length} translation key(s) used but not defined — these render as the raw key:\n`);
  for (const m of missing) console.error(`   ${m.key}  (missing in: ${m.absent.join(', ')})  used at ${m.where}`);
  console.error('');
} else {
  console.log('✓ Every t() key is defined in all four locales');
}

const counts = LOCALES.map((l) => `${l}:${keysByLocale[l].size}`).join('  ');
console.log(`\nKeys per locale — ${counts}`);

const mismatch = LOCALES.filter((l) => keysByLocale[l].size !== keysByLocale.en.size);
if (mismatch.length) {
  console.log(`⚠ locale size differs from en: ${mismatch.join(', ')} (not fatal, but usually means a key was missed)`);
}

process.exit(failed ? 1 : 0);
