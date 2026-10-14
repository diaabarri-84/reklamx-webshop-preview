#!/usr/bin/env node
// Clearing a Google-tab language must CLEAR it — src/lib/seoSettings.ts.
//
// settings/siteConfig is written with { merge: true }, and a merge recurses into
// nested maps. `pruneSeoText` returns only the languages that still have text in
// them, which is right for reading and wrong for saving: a title of
// { sv, da, no } does not replace the stored title, it merges into it, so an
// English title the owner has just deleted stays exactly where it was and goes
// on being served to Google — with an empty box on screen and a success toast
// over it.
//
// It became reachable when the translate button arrived. Before that the
// crawler-language box was usually the only one filled, so clearing it left an
// empty map and the `?? null` cleared the whole field. One press of the button
// fills the other three, and from then on the main box cannot be emptied at all.
//
// The rule this pins: EVERY language is assigned on the way out — a string when
// it has text, an explicit null when it does not — and the whole field becomes
// null only when all four are empty.
//
//   node scripts/test-seo-clear.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-seo-clear-'));
const out = join(outDir, 'seo.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'seoSettings.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const { pruneSeoForSave, normalizeSeo, DEFAULT_SEO_SETTINGS } = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

const withPage = (title) => ({
  ...DEFAULT_SEO_SETTINGS,
  pages: { '/products': { title, description: {}, noindex: false, excludeFromSitemap: false, priority: '', changefreq: '' } },
});

console.log('\na cleared language leaves an explicit null behind');
// THE ONE THAT MATTERS. English emptied, the three the AI filled still there.
check(
  'English cleared, sv/da/no kept → en is null, not absent',
  pruneSeoForSave(withPage({ en: '', sv: 'Trycksaker', da: 'Tryksager', no: 'Trykksaker' })).pages['/products'].title,
  { en: null, sv: 'Trycksaker', da: 'Tryksager', no: 'Trykksaker' },
);
check(
  'one language filled → the other three are null',
  pruneSeoForSave(withPage({ en: 'Print products' })).pages['/products'].title,
  { en: 'Print products', sv: null, da: null, no: null },
);
check(
  'whitespace is empty',
  pruneSeoForSave(withPage({ en: '   ', sv: 'Trycksaker' })).pages['/products'].title,
  { en: null, sv: 'Trycksaker', da: null, no: null },
);
check(
  'all four empty → the whole field is null, which clears it outright',
  pruneSeoForSave(withPage({ en: '', sv: '', da: '', no: '' })).pages['/products'].title,
  null,
);
check(
  'no map at all → null',
  pruneSeoForSave(withPage(undefined)).pages['/products'].title,
  null,
);

console.log('\nthe same rule on the site-wide description');
check(
  'defaultDescription clears one language the same way',
  pruneSeoForSave({ ...DEFAULT_SEO_SETTINGS, defaultDescription: { en: '', sv: 'Tryckeri i Stockholm' } }).defaultDescription,
  { en: null, sv: 'Tryckeri i Stockholm', da: null, no: null },
);

console.log('\nand the read path turns every null back into an absent key');
// normalizeSeo is what the dashboard and server-seo both read through: a null
// must never reach a <title> as the string "null".
const stored = pruneSeoForSave(withPage({ en: '', sv: 'Trycksaker' }));
const readBack = normalizeSeo(stored);
check('a null language reads as absent', readBack.pages['/products'].title, { sv: 'Trycksaker' });
check('nothing became the literal "null"', JSON.stringify(readBack).includes('"null"'), false);

console.log(failed === 0 ? '\n✅ a cleared Google-tab language really clears\n' : `\n❌ ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
