#!/usr/bin/env node
// The designer's elements in the customer's language — elementLibrary.json (built by
// scripts/build-designer-elements.mjs) and studio/elementNames.ts (designer v2): every
// element named in Swedish, Danish and Norwegian, and found by a search in them
// (code review DSN-20: "hjärta" found nothing in a Swedish shop).
//
//   node scripts/test-element-names.mjs
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-elnames-'));
await build({
  stdin: {
    contents: `export * from ${JSON.stringify(join(ROOT, 'src/components/product/designer/studio/elementNames.ts'))};`,
    resolveDir: ROOT,
    loader: 'ts',
  },
  outfile: join(dir, 'n.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const N = await import(pathToFileURL(join(dir, 'n.mjs')).href);
rmSync(dir, { recursive: true, force: true });
const ELEMENTS = JSON.parse(readFileSync(join(ROOT, 'src/components/product/designer/elementLibrary.json'), 'utf8'));

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const find = (query, language, category = () => '') => ELEMENTS.filter((e) => N.elementMatches(e, query, language, category(e))).map((e) => e.id);
const byId = (id) => ELEMENTS.find((e) => e.id === id);

console.log('\n== every element has its names ==\n');
const unnamed = ELEMENTS.filter((e) => ['sv', 'da', 'no'].some((l) => !e.i18n?.[l]?.label || !Array.isArray(e.i18n[l].keywords))).map((e) => e.id);
check(`all ${ELEMENTS.length} elements are named in Swedish, Danish and Norwegian`, unnamed, []);
const untranslated = ELEMENTS.filter((e) => e.lib !== 'social' && e.lib !== 'emoji' && ['sv', 'da', 'no'].every((l) => e.i18n[l].label === e.label)).map((e) => e.id);
check('…in their own words: no shape or icon left in English in all three (but Person, Oval and Wi-Fi, which are the same)', untranslated, ['icon-user', 'icon-wifi', 'shape-ellipse']);
check('the heart in each language, English where there is no other', ['en', 'sv', 'da', 'no'].map((l) => N.elementLabel(byId('shape-heart'), l)), ['Heart', 'Hjärta', 'Hjerte', 'Hjerte']);
check('a brand keeps its name', ['sv', 'da', 'no'].map((l) => N.elementLabel(byId('social-instagram'), l)), ['Instagram', 'Instagram', 'Instagram']);

console.log('\n== a search in his own language finds them ==\n');
// The hearts, and the face with heart eyes ("Hjerteøjne") where its name has the word.
const hearts = (ids) => ids.filter((id) => /heart|2764|1f49[9abc]|1f9e1|1f60d/.test(id)).length === ids.length && ids.length > 0;
check('Swedish "hjärta": the hearts', hearts(find('hjärta', 'sv')) && find('hjärta', 'sv').includes('shape-heart') && find('hjärta', 'sv').includes('icon-heart'), true);
check('…typed without the dots ("hjarta"), the same', find('hjarta', 'sv'), find('hjärta', 'sv'));
check('Danish "hjerte" and Norwegian "kjærlighet": the hearts', [hearts(find('hjerte', 'da')), hearts(find('kjærlighet', 'no'))], [true, true]);
check('two words narrow it: Swedish "rött hjärta" is the red heart only', find('rött hjärta', 'sv'), ['emoji-2764']);
check('the English words still work in a Swedish shop', find('heart', 'sv').includes('shape-heart'), true);
check('Swedish "pil": the arrows', ['shape-arrow', 'shape-arrow-double', 'shape-arrow-thin'].every((id) => find('pil', 'sv').includes(id)), true);
check('Norwegian "telefon": the phone icon and the telephone emoji', ['icon-phone', 'emoji-1f4de'].every((id) => find('telefon', 'no').includes(id)), true);
check('its category\'s words count too ("ikoner" finds the icons)', find('ikoner', 'sv', (e) => (e.category === 'contacts' ? 'Ikoner' : '')).length, ELEMENTS.filter((e) => e.category === 'contacts').length);
check('another language\'s words do not: Danish "hjerte" in a Swedish shop finds nothing', find('hjerte', 'sv'), []);
check('nothing typed, nothing found', find('   ', 'sv'), []);

console.log('\n== Danish and Norwegian letters, and the words fixed in the second pass (Q) ==\n');
// Ø and æ are letters of their own, which taking accents off leaves alone.
check('ø, æ and å — and oe, ae, aa typed for them — fold to one form; ä and ö lose their marks',
  N.foldText('Hjerteøjne Kærlighed ÆBLE ØL Åsa Äpple Öl Hjerteoejne Kaerlighed Paa'), 'hjerteojne karlighed able ol asa apple ol hjerteojne karlighed pa');
check('…so Danish "hjerteoejne" (ø typed as oe) and "karlighed" (æ typed as a) find their elements too',
  [find('hjerteoejne', 'da').includes('emoji-1f60d'), hearts(find('karlighed', 'da'))], [true, true]);
check('Danish "hjerteojne", typed without ø: the face with heart eyes ("Hjerteøjne")', find('hjerteojne', 'da').includes('emoji-1f60d'), true);
check('…typed with it: the same', find('hjerteøjne', 'da'), find('hjerteojne', 'da'));
check('Norwegian "kjaerlighet", æ typed as ae: the hearts', hearts(find('kjaerlighet', 'no')), true);
check('Danish "varm" and "hed": the fire', [find('varm', 'da').includes('emoji-1f525'), find('hed', 'da').includes('emoji-1f525')], [true, true]);
check('Norwegian "dokumentmappe": the briefcase — and "koffert" still finds it', [find('dokumentmappe', 'no'), find('koffert', 'no').includes('icon-briefcase')], [['icon-briefcase'], true]);
check('the Danish map is a "Landkort", not a "Kort" (a card); its pin a "Kortnål", not a sewing pin',
  [N.elementLabel(byId('icon-map'), 'da'), N.elementLabel(byId('emoji-1f4cd'), 'da')], ['Landkort', 'Kortnål']);
check('the tag icon: Etikett, Etiket, Etikett — and still found by its old name, Swedish "märke"',
  [...['sv', 'da', 'no'].map((l) => N.elementLabel(byId('icon-tag'), l)), find('märke', 'sv').includes('icon-tag')], ['Etikett', 'Etiket', 'Etikett', true]);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ the elements speak the shop\'s languages\n');
process.exit(failed ? 1 : 0);
