#!/usr/bin/env node
// The check before attaching — src/components/product/designer/studio/proofChecks.ts
// (designer v2): what it warns the customer about on a printed side, read from the
// side's own JSON in board units (10 per mm).
//
//   node scripts/test-proof-checks.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(ROOT, 'package.json'));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-proof-'));
await build({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(join(ROOT, 'src/components/product/designer/studio/proofChecks.ts'))};`,
      `export { qrPath } from ${JSON.stringify(join(ROOT, 'src/lib/designQr.ts'))};`,
      `export { qrPayload } from ${JSON.stringify(join(ROOT, 'src/lib/qrPayload.ts'))};`,
      `export { buildStarter, startersFor } from ${JSON.stringify(join(ROOT, 'src/lib/starterTemplates.ts'))};`,
      `export { kindOfProduct, printSpecFor } from ${JSON.stringify(join(ROOT, 'src/lib/printSpec.ts'))};`,
      `export { parseDimensionsMm } from ${JSON.stringify(join(ROOT, 'src/lib/printSize.ts'))};`,
      `export { studioCanMake } from ${JSON.stringify(join(ROOT, 'src/lib/onlineDesign.ts'))};`,
      `export { OPTION_CATALOGUE } from ${JSON.stringify(join(ROOT, 'src/components/Admin/optionCatalogue.ts'))};`,
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  // Anything that reaches fabric uses the repo's node build of it, as one instance.
  alias: { fabric: 'fabric/node' },
  external: ['fabric/node', 'canvas', 'jsdom'],
  outfile: join(dir, 'p.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
// The bundle may import 'fabric/node' — resolved from the repo, not from the temp folder.
const file = join(dir, 'p.mjs');
writeFileSync(file, readFileSync(file, 'utf8').replaceAll('"fabric/node"', JSON.stringify(pathToFileURL(require.resolve('fabric/node')).href)));
const P = await import(pathToFileURL(file).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

const U = 10;
console.log('\n== a QR code a phone may not read (code review DSN-14) ==\n');
const link = { text: 'https://shop.reklamx.se', ecc: 'M' };
const card = {
  text: P.qrPayload('vcard', { first: 'Åsa', last: 'Öberg', org: 'Reklam X AB', title: 'Försäljningschef', phone: '+46 70 123 45 67', email: 'asa.oberg@reklamx.se', web: 'shop.reklamx.se', street: 'Storgatan 1', zip: '111 22', city: 'Stockholm', country: 'Sverige' }),
  ecc: 'M',
};
const qr = (spec, mm, more = {}) => ({ type: 'RxQr', left: 300, top: 300, originX: 'center', originY: 'center', width: mm * U, height: mm * U, fill: '#000000', rxQrBg: '#ffffff', rxQr: spec, ...more });
const cardModules = P.qrPath(card).size;
check(`a link at 15 mm: squares of ${(15 / P.qrPath(link).size).toFixed(2)} mm — it reads`, P.weakQrCodes([qr(link, 15)], '#ffffff', U), 0);
check(`a contact card at 15 mm: ${cardModules} squares across, ${(15 / cardModules).toFixed(2)} mm each — too small`, P.weakQrCodes([qr(card, 15)], '#ffffff', U), 1);
check('…at 0.3 mm a square it reads', P.weakQrCodes([qr(card, cardModules * 0.3)], '#ffffff', U), 0);
check('…and drawn half size by a scale, it does not', P.weakQrCodes([qr(card, cardModules * 0.3, { scaleX: 0.5, scaleY: 0.5 })], '#ffffff', U), 1);
check('a yellow code on its own white background: too little contrast', P.weakQrCodes([qr(link, 30, { fill: '#ffed00' })], '#ffffff', U), 1);
check('a white code with no background on a navy page: it reads (white codes are not refused)', P.weakQrCodes([qr(link, 30, { fill: '#ffffff', rxQrBg: '' })], '#2d2e83', U), 0);
check('…on a white page: it cannot be seen', P.weakQrCodes([qr(link, 30, { fill: '#ffffff', rxQrBg: '' })], '#ffffff', U), 1);
const navy = { type: 'Rect', left: 0, top: 0, originX: 'left', originY: 'top', width: 600, height: 600, fill: '#2d2e83' };
check('…on a white page but over a navy shape: it reads', P.weakQrCodes([navy, qr(link, 30, { fill: '#ffffff', rxQrBg: '' })], '#ffffff', U), 0);
check('…a navy shape beside it, not under it: judged on the white page', P.weakQrCodes([{ ...navy, left: 700 }, qr(link, 30, { fill: '#ffffff', rxQrBg: '' })], '#ffffff', U), 1);
check('…a picture under it: nothing can be said, nothing is claimed', P.weakQrCodes([{ ...navy, type: 'Image', fill: 'rgb(0,0,0)' }, qr(link, 30, { fill: '#ffffff', rxQrBg: '' })], '#ffffff', U), 0);
check('two weak codes on one side are both counted, a hidden one is not', P.weakQrCodes([qr(card, 15), qr(card, 15, { left: 100 }), qr(card, 15, { visible: false })], '#ffffff', U), 2);

console.log('\n== something that ends right at the cut line (code review DSN-07) ==\n');
// An 85 × 55 mm card with 3 mm bleed: the board is 910 × 610 units, the trim starts at 30.
const trim = { x: 30, y: 30, w: 850, h: 550 };
const box = (x, y, w, h, more = {}) => ({ type: 'Rect', originX: 'left', originY: 'top', left: x, top: y, width: w, height: h, fill: '#2d2e83', ...more });
const atCut = (objects, outline = null) => P.edgesAtCut(objects, trim, U, outline);
check('a background drawn exactly to the trim: warned', atCut([box(30, 30, 850, 550)]), 1);
check('…the same run 3 mm into the bleed: not', atCut([box(0, 0, 910, 610)]), 0);
check('…stopping 0.8 mm short of the cut, or 0.8 mm past it: warned', [atCut([box(38, 100, 300, 100)]), atCut([box(22, 100, 300, 100)])], [1, 1]);
check('…well inside the page (2 mm in): not', atCut([box(50, 100, 300, 100)]), 0);
check('a band along the foot, its bottom edge on the cut: warned', atCut([box(0, 400, 910, 180)]), 1);
check('…out in the bleed 1.5 mm past the cut: not, nor its side edge, which runs beside the page, not along it', atCut([box(30, 0, 300, 15)]), 0);
check('a turned square whose corner reaches the cut: warned', atCut([{ ...box(0, 0, 200, 200), originX: 'center', originY: 'center', angle: 45, left: 600, top: 438.6 }]), 1);
check('not words (the safe area has its warning), an empty photo frame, anything locked, nothing inked, a hidden one',
  atCut([
    { type: 'Textbox', text: 'Hej', originX: 'left', originY: 'top', left: 30, top: 30, width: 400, height: 60, fill: '#000000' },
    box(30, 30, 850, 550, { rxSlot: true }),
    box(30, 30, 850, 550, { rxLock: 'locked' }),
    box(30, 30, 850, 550, { rxLock: 'unlockable' }),
    box(30, 30, 850, 550, { rxLock: 'words' }),
    box(30, 30, 850, 550, { fill: '#ffffff' }),
    box(30, 30, 850, 550, { visible: false }),
  ]), 0);
check('…a shop shape the customer has unlocked is his, and judged', atCut([box(30, 30, 850, 550, { rxLock: undefined })]), 1);
check('…and one the CUSTOMER locked himself is still his, and still judged (final review)',
  atCut([box(30, 30, 850, 550, { rxLock: 'unlockable', rxOwnLock: true })]), 1);
check('a picture or a QR code at the cut: warned', atCut([box(30, 100, 200, 200, { type: 'Image' }), { ...box(680, 380, 200, 200), type: 'RxQr', rxQr: link }]), 2);
check('a round or oval cut is not judged by its box', [atCut([box(30, 30, 850, 550)], 'circle'), atCut([box(30, 30, 850, 550)], 'ellipse')], [0, 0]);

// The shop's own designs never trip it — at EVERY size they are offered at: each size
// in the option catalogue the designer can open at, as the kind its question makes the
// product (src/lib/printSpec.ts), every starter offered on that kind, in every colour,
// front and back, on a straight cut (a round one is never judged). Six sizes were tried
// at first; the second pass found 36 sides flagged at sizes they missed (A2 and 50 × 70
// posters, a DL flyer, small badges) — the shop's starbursts and corner circles, which
// meet the cut on purpose. They come held ('unlockable'), and held is not judged.
const WORDS = {
  name: 'Åsa Öberg-Lindqvist', title: 'Grafisk formgivare', company: 'Reklamhuset Norr AB', phone: '+46 70 123 45 67',
  email: 'asa@reklamhuset.se', web: 'www.reklamhuset.se', address: 'Storgatan 1, 111 22 Stockholm', headline: 'Stor nyöppning i helgen',
  sub: 'Välkommen till oss', body: 'Fika, musik och erbjudanden hela dagen.', day: '12', month: 'oktober',
  place: 'Storgatan 1, Stockholm', offer: '-20 %', sale: 'REA', cta: 'Boka i dag', slogan: 'Tryckt med omsorg', photoHere: 'Din bild här',
};
const sizes = new Map();
const addSize = (kind, w, h) => sizes.set(`${kind} ${w}×${h}`, { kind, w, h });
for (const field of P.OPTION_CATALOGUE) {
  const kind = P.kindOfProduct([field.id]);
  for (const option of field.options ?? []) {
    const mm = P.parseDimensionsMm(option);
    if (mm && P.studioCanMake(mm)) addSize(kind, mm.wMm, mm.hMm);
  }
}
// …and a few it might sell: a sign (no catalogue question makes one), a strip of a badge.
for (const [kind, w, h] of [['sign', 180, 70], ['sticker', 40, 20], ['sticker', 70, 50], ['banner', 3000, 1000]]) addSize(kind, w, h);
const flagged = [];
let starterSides = 0;
let unlockedFlagged = 0;
for (const size of sizes.values()) {
  const spec = P.printSpecFor({ kind: size.kind, trimMm: { wMm: size.w, hMm: size.h } });
  const t = { x: spec.bleedMm * U, y: spec.bleedMm * U, w: size.w * U, h: size.h * U };
  for (const def of P.startersFor(size.kind)) {
    for (const pal of def.palettes) {
      const r = P.buildStarter(def.id, pal.id, { trimMm: { wMm: size.w, hMm: size.h }, bleedMm: spec.bleedMm, outline: null, safeMm: spec.safeMm, hiddenMm: spec.hiddenMm, sides: ['front', 'back'], words: WORDS });
      for (const side of r?.sides ?? []) {
        starterSides += 1;
        const objects = JSON.parse(side.json).objects ?? [];
        if (P.edgesAtCut(objects, t, U, null) > 0) flagged.push(`${def.id}/${pal.id} ${size.kind} ${size.w}×${size.h} ${side.id}`);
        const unlocked = objects.map((o) => (o.rxLock === 'unlockable' ? { ...o, rxLock: undefined } : o));
        if (P.edgesAtCut(unlocked, t, U, null) > 0) unlockedFlagged += 1;
      }
    }
  }
}
check(`the sizes include every one the second pass found flagged, and more than its 44 (${sizes.size})`,
  sizes.size > 44 && ['poster 420×594', 'poster 500×700', 'poster 594×841', 'poster 700×1000', 'print 210×297', 'print 99×210', 'sticker 30×30', 'sticker 40×20'].every((k) => sizes.has(k)), true);
check(`the shop's own designs never trip it: ${starterSides} sides at ${sizes.size} sizes`, flagged, []);
check('…because what the shop placed is held: unlocked, its starbursts and corner circles would be flagged on some sides', unlockedFlagged > 0, true);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ the checks before attaching hold\n');
process.exit(failed ? 1 : 0);
