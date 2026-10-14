#!/usr/bin/env node
// Date-and-number locale gate for ReklamX.
//
// THE BUG THIS EXISTS TO PREVENT
// The owner reported Arabic all over the dashboard: `20 ص8:14:19 ،2026/8/` on
// the order card, `الجمعة، 21 أغسطس` on the customer's tracker, and — worst —
// Arabic-Indic digits available to appear in PRICES. Nothing in this shop is
// written in Arabic. The cause was nineteen calls that formatted a date or a
// number without saying which locale to format for:
//
//     new Date(x).toLocaleString()                 // ← the machine's locale
//     d.toLocaleTimeString([], { hour: '2-digit' })// ← the machine's locale
//     n.toLocaleString(undefined, { … })           // ← the machine's locale
//
// On a Swedish laptop those produce Swedish and look perfect. On the owner's
// Mac, set to Arabic, they produce Arabic. The code is identical; only the
// machine differs, which is exactly why it survived every review and every test
// run — including the browser regression suite, which runs on a machine set to
// English.
//
// So it is checked mechanically instead. Every formatter must state its locale.
// src/lib/dateFormat.ts is the place they all go through.
//
// Usage:  node scripts/check-date-locales.mjs
// Exit:   0 = clean, 1 = a locale-less formatter is back

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not url.pathname — this project lives under a directory with
// non-ASCII characters, which .pathname returns percent-encoded.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const EXTRA_FILES = ['server.ts'];

// dateFormat.ts is the ONE file allowed to talk about this, because it is where
// every locale is decided. Its own calls always pass a locale variable.
const EXEMPT = new Set([join('src', 'lib', 'dateFormat.ts')]);

const OFFENDERS = [
  {
    // .toLocaleString() / .toLocaleDateString() / .toLocaleTimeString() with no
    // argument at all, or with the empty-array or undefined placeholder.
    pattern: /\.toLocale(?:Date|Time)?String\(\s*(?:\)|\[\s*\]|undefined\b)/g,
    what: 'a date/number formatted with no locale',
    fix: "pass a locale — for staff screens formatDate/formatDateTime from src/lib/dateFormat.ts, for customer text localeFor(language)",
  },
  {
    pattern: /new\s+Intl\.(?:DateTimeFormat|NumberFormat)\(\s*(?:\)|undefined\b|\[\s*\])/g,
    what: 'an Intl formatter built with no locale',
    fix: "name the locale explicitly (OPERATIONS_LOCALE, or localeFor(language))",
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = [
  ...walk(SRC),
  ...EXTRA_FILES.map((f) => join(ROOT, f)).filter((f) => existsSync(f)),
];

const hits = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  if (EXEMPT.has(rel)) continue;
  const source = readFileSync(file, 'utf-8');
  const lines = source.split('\n');

  for (const { pattern, what, fix } of OFFENDERS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      hits.push({ rel, line, what, fix, text: (lines[line - 1] ?? '').trim() });
    }
  }
}

console.log(`\nScanned ${files.length} files for locale-less date and number formatting\n`);

if (hits.length) {
  console.error(`✗ ${hits.length} formatter(s) inherit the machine's locale:\n`);
  for (const hit of hits) {
    console.error(`   ${hit.rel}:${hit.line} — ${hit.what}`);
    console.error(`      ${hit.text}`);
    console.error(`      fix: ${hit.fix}\n`);
  }
  console.error('These render in Arabic on the shop owner\'s own machine. See src/lib/dateFormat.ts.\n');
  process.exit(1);
}

console.log('✓ Every date and number formatter states its locale');
console.log('✓ No screen can inherit the operating system\'s language\n');
process.exit(0);
