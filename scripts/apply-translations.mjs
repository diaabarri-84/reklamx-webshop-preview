#!/usr/bin/env node
// Apply a batch of translations to one source file.
//
// Takes a JSON map of { "<exact Arabic text>": { key, en, sv, da, no } }, adds
// every key to all four locales in translations.ts, and rewrites the file so the
// literal becomes t('key').
//
//   node scripts/apply-translations.mjs <target-file> <map.json>
//
// Refuses to guess. A string it cannot place exactly is reported and left alone,
// so a partial run is visible rather than silent.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'sv', 'da', 'no'];
const TRANSLATIONS = join(ROOT, 'src', 'lib', 'translations.ts');

const [targetRel, mapRel] = process.argv.slice(2);
if (!targetRel || !mapRel) {
  console.error('usage: apply-translations.mjs <target-file> <map.json>');
  process.exit(1);
}

const target = join(ROOT, targetRel);
const map = JSON.parse(readFileSync(join(ROOT, mapRel), 'utf8'));
const entries = Object.entries(map);

// ---- 1. add the keys, once, to every locale ----
let tsrc = readFileSync(TRANSLATIONS, 'utf8');
const existingKeys = new Set([...tsrc.matchAll(/^\s{4}([A-Za-z0-9_]+)\s*:/gm)].map((m) => m[1]));

const fresh = entries.filter(([, v]) => !existingKeys.has(v.key));
if (fresh.length) {
  for (const locale of LOCALES) {
    const anchor = `\n  ${locale}: {\n`;
    const at = tsrc.indexOf(anchor);
    if (at === -1) {
      console.error(`locale ${locale} not found`);
      process.exit(1);
    }
    const block =
      `    // ${targetRel}\n` +
      fresh
        // Single-quoted TS literal, escaped properly. Naively swapping the outer
        // double quotes for single ones breaks on any value containing an
        // apostrophe — "customers' points" ended a string mid-sentence.
        .map(([, v]) => `    ${v.key}: '${String(v[locale]).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',\n`)
        .join('');
    tsrc = tsrc.slice(0, at + anchor.length) + block + tsrc.slice(at + anchor.length);
  }
  writeFileSync(TRANSLATIONS, tsrc);
}

// ---- 2. swap the literals in the target ----
let src = readFileSync(target, 'utf8');
const applied = [];
const missed = [];

for (const [arabic, v] of entries) {
  // Quoted string literal → t('key')
  let hit = false;
  for (const q of ["'", '"', '`']) {
    const lit = q + arabic + q;
    if (src.includes(lit)) {
      src = src.split(lit).join(`t('${v.key}')`);
      hit = true;
    }
  }
  // Bare JSX text node → {t('key')}
  if (!hit) {
    const jsx = new RegExp(`>(\\s*)${arabic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*)<`, 'g');
    if (jsx.test(src)) {
      src = src.replace(jsx, `>$1{t('${v.key}')}$2<`);
      hit = true;
    }
  }
  (hit ? applied : missed).push(v.key);
}

// A JSX attribute needs braces: placeholder={t('x')}, not placeholder=t('x').
// Without this the file parses as garbage from that line on.
src = src.replace(/=(t\('[A-Za-z0-9_]+'\))/g, '={$1}');

writeFileSync(target, src);

console.log(`${targetRel}`);
console.log(`  keys added to translations.ts : ${fresh.length}`);
console.log(`  literals replaced             : ${applied.length}`);
if (missed.length) {
  console.log(`  NOT FOUND (left alone)        : ${missed.length}`);
  missed.forEach((k) => console.log(`      - ${k}`));
}
