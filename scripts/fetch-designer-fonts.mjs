#!/usr/bin/env node
// The online designer's font library — downloaded once, served by the shop itself.
//
// Every family here is open-licence (SIL OFL 1.1, or Apache 2.0) and may be
// redistributed with its licence. Only the LATIN subset is taken: it covers
// Swedish, Danish and Norwegian (å ä ö æ ø) and the euro sign, at ~20–40 KB a face.
// Faces that share one variable-font file (Roboto 400 and 700) are stored once.
//
// Writes:
//   src/components/product/designer/fonts/<slug>-latin-<weight>-<normal|italic>.woff2
//     (Vite assets: served from /assets/ under a content hash, cached for good — the
//     host revalidates everything outside /assets/ on every request)
//   src/components/product/designer/fontUrls.ts        (file name → that URL)
//   public/fonts/designer/LICENSE-<slug>.txt            (published beside the shop)
//   src/components/product/designer/fontLibrary.json   (what fonts.ts loads)
//
//   node scripts/fetch-designer-fonts.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'src/components/product/designer/fonts');
const LICENCES = join(ROOT, 'public/fonts/designer');
const URLS = join(ROOT, 'src/components/product/designer/fontUrls.ts');
const MANIFEST = join(ROOT, 'src/components/product/designer/fontLibrary.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/** [Google family name, category] — order is the order of the picker within a category. */
const FAMILIES = [
  ['Inter', 'sans'], ['Montserrat', 'sans'], ['Roboto', 'sans'], ['Open Sans', 'sans'], ['Lato', 'sans'],
  ['Poppins', 'sans'], ['Raleway', 'sans'], ['Nunito', 'sans'], ['Work Sans', 'sans'], ['Source Sans 3', 'sans'],
  ['Oswald', 'sans'], ['Archivo', 'sans'],
  ['Bebas Neue', 'display'], ['Anton', 'display'], ['Archivo Black', 'display'], ['Righteous', 'display'],
  ['Fredoka', 'display'], ['Abril Fatface', 'display'], ['Alfa Slab One', 'display'],
  ['Playfair Display', 'serif'], ['Merriweather', 'serif'], ['Lora', 'serif'], ['Libre Baskerville', 'serif'],
  ['EB Garamond', 'serif'], ['DM Serif Display', 'serif'], ['Cormorant Garamond', 'serif'], ['Roboto Slab', 'serif'],
  ['Dancing Script', 'script'], ['Pacifico', 'script'], ['Great Vibes', 'script'], ['Caveat', 'script'],
  ['Satisfy', 'script'], ['Lobster', 'script'], ['Shadows Into Light', 'script'],
  ['Space Mono', 'mono'],
];
/** The styles asked for: regular, bold, italic. A family without one simply lacks it. */
const STYLES = [
  { weight: 400, style: 'normal', axis: 'wght@400' },
  { weight: 700, style: 'normal', axis: 'wght@700' },
  { weight: 400, style: 'italic', axis: 'ital,wght@1,400' },
];

const slugOf = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The latin @font-face's URL in a css2 answer, or null when the style does not exist. */
async function latinUrl(family, axis) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:${axis}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 400) return null; // "this family has no such style"
  if (!res.ok) throw new Error(`${family} ${axis}: HTTP ${res.status}`);
  const css = await res.text();
  const block = css.split('/* latin */')[1]?.split('}')[0] ?? '';
  return /url\((https:[^)]+\.woff2)\)/.exec(block)?.[1] ?? null;
}

async function licenceText(family) {
  const dir = family.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const path of [`ofl/${dir}/OFL.txt`, `apache/${dir}/LICENSE.txt`, `ufl/${dir}/UFL.txt`]) {
    const res = await fetch(`https://raw.githubusercontent.com/google/fonts/main/${path}`);
    if (res.ok) return { kind: path.split('/')[0], text: await res.text() };
  }
  throw new Error(`${family}: licence not found`);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(LICENCES, { recursive: true });
const manifest = [];
for (const [family, category] of FAMILIES) {
  const slug = slugOf(family);
  const files = new Map(); // google URL → our file name
  const faces = [];
  for (const s of STYLES) {
    const src = await latinUrl(family, s.axis);
    if (!src) continue;
    let file = files.get(src);
    if (!file) {
      file = `${slug}-latin-${s.weight}-${s.style}.woff2`;
      const bytes = new Uint8Array(await (await fetch(src, { headers: { 'User-Agent': UA } })).arrayBuffer());
      if (bytes.length < 1000 || String.fromCharCode(...bytes.slice(0, 4)) !== 'wOF2') throw new Error(`${family}: not a woff2 file`);
      writeFileSync(join(OUT, file), bytes);
      files.set(src, file);
    }
    faces.push({ weight: s.weight, style: s.style, file, src });
  }
  if (!faces.some((f) => f.weight === 400 && f.style === 'normal')) throw new Error(`${family}: no regular face`);
  // A variable file that serves 400 AND 700 is registered once, as a weight range.
  const byFile = new Map();
  for (const f of faces) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  const out = [...byFile.entries()].map(([file, fs]) => {
    const weights = fs.map((f) => f.weight);
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    return { file, style: fs[0].style, weight: min === max ? String(min) : `${min} ${max}` };
  });
  const lic = await licenceText(family);
  writeFileSync(join(LICENCES, `LICENSE-${slug}.txt`), lic.text);
  manifest.push({
    family: `RX ${family}`,
    label: family,
    slug,
    category,
    licence: lic.kind === 'apache' ? 'Apache-2.0' : 'OFL-1.1',
    bold: faces.some((f) => f.weight === 700),
    italic: faces.some((f) => f.style === 'italic'),
    faces: out,
  });
  console.log(`${family.padEnd(20)} ${faces.map((f) => `${f.weight}${f.style === 'italic' ? 'i' : ''}`).join(' ').padEnd(12)} → ${out.map((f) => f.file).join(', ')}`);
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
writeUrlModule(manifest);
console.log(`\n${manifest.length} families, ${manifest.reduce((n, m) => n + m.faces.length, 0)} files → ${OUT}`);

/** One `?url` import per file: Vite emits each as a hashed asset and gives back its address. */
function writeUrlModule(families) {
  const files = [...new Set(families.flatMap((f) => f.faces.map((face) => face.file)))].sort();
  const lines = [
    '// GENERATED by scripts/fetch-designer-fonts.mjs — do not edit by hand.',
    '// Each font file as a hashed Vite asset (served from /assets/, cached for good).',
    ...files.map((f, i) => `import f${i} from './fonts/${f}?url';`),
    '',
    'export const FONT_URLS: Readonly<Record<string, string>> = {',
    ...files.map((f, i) => `  '${f}': f${i},`),
    '};',
    '',
  ];
  writeFileSync(URLS, lines.join('\n'));
}
