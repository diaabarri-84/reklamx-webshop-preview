#!/usr/bin/env node
// The shop's own ready-made designs — src/lib/starterTemplates.ts (designer v2).
// Every starter, in every colour, at the sizes the shop sells (and a few it might):
// every side passes the design allowlist, loads in fabric object for object, keeps
// every word inside the product's safe area (out of a roll-up's hidden foot), and
// holds no NaN.
//
//   node scripts/test-starter-templates.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(ROOT, 'package.json'));
const fabric = require('fabric/node');

const dir = mkdtempSync(join(tmpdir(), 'reklamx-starters-'));
await build({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(join(ROOT, 'src/lib/starterTemplates.ts'))};`,
      `export { cleanDesignSide } from ${JSON.stringify(join(ROOT, 'src/lib/designSchema.ts'))};`,
      `export { printSpecFor } from ${JSON.stringify(join(ROOT, 'src/lib/printSpec.ts'))};`,
      `export { isDesignerFontFamily } from ${JSON.stringify(join(ROOT, 'src/lib/designFonts.ts'))};`,
      `export * as RX from ${JSON.stringify(join(ROOT, 'src/components/product/designer/rxObjects.ts'))};`,
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  alias: { fabric: 'fabric/node' },
  external: ['fabric/node', 'canvas', 'jsdom'],
  loader: { '.json': 'json' },
  outfile: join(dir, 's.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const p = join(dir, 's.mjs');
writeFileSync(p, readFileSync(p, 'utf8').replaceAll('"fabric/node"', JSON.stringify(require.resolve('fabric/node'))));
const S = await import(pathToFileURL(p).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}${detail ? `\n       ${detail}` : ''}`); }
};

const WORDS = {
  name: 'Åsa Öberg-Lindqvist', title: 'Grafisk formgivare', company: 'Reklamhuset Norr AB', phone: '+46 70 123 45 67',
  email: 'asa@reklamhuset.se', web: 'www.reklamhuset.se', address: 'Storgatan 1, 111 22 Stockholm', headline: 'Stor nyöppning i helgen',
  sub: 'Välkommen till oss', body: 'Fika, musik och erbjudanden hela dagen. Alla är välkomna!', day: '12', month: 'oktober',
  place: 'Storgatan 1, Stockholm', offer: '-20 %', sale: 'REA', cta: 'Boka i dag', slogan: 'Tryckt med omsorg', photoHere: 'Din bild här',
};
const SIZES = [
  { kind: 'card', w: 85, h: 55 }, { kind: 'card', w: 55, h: 85 }, { kind: 'card', w: 90, h: 50 },
  { kind: 'print', w: 148, h: 210 }, { kind: 'poster', w: 297, h: 420 }, { kind: 'print', w: 210, h: 99 },
  { kind: 'rollup', w: 850, h: 2000 }, { kind: 'banner', w: 3000, h: 1000 }, { kind: 'sign', w: 180, h: 70 },
  { kind: 'sticker', w: 50, h: 50, outline: 'circle' }, { kind: 'sticker', w: 70, h: 50 },
];

console.log('\n== every starter, every colour, every size ==\n');
let built = 0;
const problems = [];
for (const size of SIZES) {
  const spec = S.printSpecFor({ kind: size.kind, trimMm: { wMm: size.w, hMm: size.h } });
  const starters = S.startersFor(size.kind);
  if (starters.length === 0) problems.push(`no starters for ${size.kind}`);
  for (const def of starters) {
    for (const pal of def.palettes) {
      for (const sides of [['front'], ['front', 'back']]) {
        const r = S.buildStarter(def.id, pal.id, {
          trimMm: { wMm: size.w, hMm: size.h }, bleedMm: spec.bleedMm, outline: size.outline ?? null, safeMm: spec.safeMm, hiddenMm: spec.hiddenMm, sides, words: WORDS,
        });
        built += 1;
        const where = `${def.id}/${pal.id} ${size.w}×${size.h} ${sides.join('+')}`;
        if (!r || r.sides.length !== sides.length) { problems.push(`${where}: not built`); continue; }
        for (const side of r.sides) {
          if (/NaN|Infinity/.test(side.json)) problems.push(`${where} ${side.id}: NaN/Infinity in the JSON`);
          const clean = S.cleanDesignSide(JSON.parse(side.json), { fontFamilyOk: S.isDesignerFontFamily, defaultFont: 'RX Inter' });
          if (!clean) { problems.push(`${where} ${side.id}: refused by the allowlist`); continue; }
          const c = new fabric.StaticCanvas(null, { width: 10, height: 10 });
          await c.loadFromJSON(clean.side);
          const count = (objs) => objs.reduce((n, o) => n + 1 + (o.objects ? count(o.objects) : 0), 0);
          const loaded = (objs) => objs.reduce((n, o) => n + 1 + (typeof o.getObjects === 'function' ? loaded(o.getObjects()) : 0), 0);
          if (loaded(c.getObjects()) !== count(clean.side.objects)) problems.push(`${where} ${side.id}: ${count(clean.side.objects)} objects in, ${loaded(c.getObjects())} loaded`);
          // Words stay inside the safe area (±0.6 mm: fabric's line box is a little taller than the letters).
          const b = spec.bleedMm * 10;
          for (const o of c.getObjects()) {
            if (o.type !== 'textbox' && o.type !== 'Textbox') continue;
            const r2 = o.getBoundingRect();
            const tol = 6;
            const trimW = size.w * 10;
            const trimH = size.h * 10;
            const hid = spec.hiddenMm;
            if (r2.left < b + hid.left * 10 - tol || r2.top < b + hid.top * 10 - tol || r2.left + r2.width > b + trimW - hid.right * 10 + tol || r2.top + r2.height > b + trimH - hid.bottom * 10 + tol) {
              problems.push(`${where} ${side.id}: "${String(o.text).slice(0, 24)}" outside the visible trim (${Math.round(r2.left)},${Math.round(r2.top)} ${Math.round(r2.width)}×${Math.round(r2.height)} in ${trimW}×${trimH} + bleed ${b})`);
            }
          }
          void c.dispose();
        }
      }
    }
  }
}
check(`${built} designs built: every side passes the allowlist, loads object for object, keeps its words on the visible product, holds no NaN`, problems.length === 0, problems.slice(0, 12).join('\n       '));
check('a starter is never a database id', S.isStarterId('starter-classic') && !S.isStarterId('abc123'));
check('unknown starter: null', S.buildStarter('starter-nope', null, { trimMm: { wMm: 85, hMm: 55 }, bleedMm: 3, outline: null, safeMm: 3, hiddenMm: { top: 0, right: 0, bottom: 0, left: 0 }, sides: ['front'], words: WORDS }) === null);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ the starters hold\n');
process.exit(failed ? 1 : 0);
