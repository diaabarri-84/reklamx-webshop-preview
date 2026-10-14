#!/usr/bin/env node
// What a design may contain — src/lib/designSchema.ts (designer v2).
//
// The design cleaner became an ALLOWLIST per kind of object: fabric's
// loadFromJSON sets every key it is given on a live object, and the review found
// unknown keys and "__proto__" reaching fabric instances. These checks pin it from
// four sides: REAL fabric 7.4 output of every kind (and every element of the
// library) passes and reloads to the same geometry; the shop's own pattern and QR
// parameters pass and nothing else does; known attacks are dropped or refused; and
// a fuzzer throws thousands of mutated designs at it — it must never throw, and
// what it returns must be clean again (idempotent) and hold no address.
//
//   node scripts/test-design-schema.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(ROOT, 'package.json'));
const fabric = require('fabric/node');
const { StaticCanvas, Path, Polygon, Polyline, Ellipse, Triangle, Line, Rect, Circle, Textbox, FabricImage, Group } = fabric;
const { createCanvas } = require('canvas');

const dir = mkdtempSync(join(tmpdir(), 'reklamx-schema-'));
await build({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(join(ROOT, 'src/lib/designSchema.ts'))};`,
      `export { cleanDesignJson } from ${JSON.stringify(join(ROOT, 'src/lib/designTemplateDoc.ts'))};`,
      `export { isDesignerFontFamily, DEFAULT_DESIGNER_FONT } from ${JSON.stringify(join(ROOT, 'src/lib/designFonts.ts'))};`,
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  outfile: join(dir, 's.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const S = await import(pathToFileURL(join(dir, 's.mjs')).href);
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ctx = { fontFamilyOk: S.isDesignerFontFamily, defaultFont: S.DEFAULT_DESIGNER_FONT };
const side = (objects, extra = {}) => ({ version: '7.4.0', background: '#ffffff', objects, ...extra });
const clean = (s) => S.cleanDesignSide(JSON.parse(JSON.stringify(s)), ctx);

console.log('\n== real fabric 7.4 output of every kind passes, and reloads to the same geometry ==\n');
const src = createCanvas(40, 30);
src.getContext('2d').fillRect(0, 0, 40, 30);
const img = await FabricImage.fromURL(src.toDataURL('image/png'));
img.set({ left: 300, top: 300, cropX: 4, cropY: 3, width: 30, height: 20, flipX: true, opacity: 0.8 });
img.rxImageId = 'img-abc-def12';
img.clipPath = new Circle({ radius: 10, originX: 'center', originY: 'center' });
const kinds = [
  new Textbox('Hej på dig — åäö æø €', { left: 20, top: 30, width: 160, fontSize: 18, fontFamily: 'RX Lora', fontStyle: 'italic', fontWeight: 'bold', underline: true, charSpacing: 80, lineHeight: 1.3, textAlign: 'justify', fill: 'rgb(12,34,56)' }),
  img,
  new Rect({ left: 10, top: 10, width: 50, height: 30, rx: 6, ry: 6, fill: '#ABC', stroke: '#000000', strokeWidth: 2, strokeDashArray: [6, 3] }),
  new Circle({ left: 100, top: 40, radius: 12, fill: '#ea580c' }),
  new Ellipse({ left: 140, top: 40, rx: 20, ry: 8, fill: '#112233' }),
  new Triangle({ left: 180, top: 40, width: 20, height: 18, fill: '#445566' }),
  new Polygon([{ x: 0, y: 0 }, { x: 30, y: 4 }, { x: 22, y: 30 }], { left: 220, top: 40, fill: '#778899' }),
  new Polyline([{ x: 0, y: 0 }, { x: 20, y: 10 }, { x: 40, y: 0 }], { left: 260, top: 40, fill: '', stroke: '#123456', strokeWidth: 3 }),
  new Line([0, 0, 60, 20], { left: 20, top: 120, stroke: '#000', strokeWidth: 4, strokeLineCap: 'round' }),
  new Path('M 0 0 L 40 0 Q 50 20 40 40 C 30 50 10 50 0 40 Z', { left: 100, top: 120, fill: '#aa0000' }),
  new Group([new Rect({ width: 30, height: 20, fill: '#eeeeee', stroke: '#999999', strokeDashArray: [4, 4] }), new Textbox('Your photo here', { width: 28, fontSize: 4 })], { left: 200, top: 140 }),
];
kinds[10].rxSlot = true;
const canvas = new StaticCanvas(null, { width: 500, height: 500 });
canvas.add(...kinds);
const PROPS = ['rxImageId', 'rxSlot', 'rxFill', 'rxLock', 'rxBox', 'rxOrigId', 'rxAdjust', 'rxElement', 'rxCaps', 'rxList'];
const real = canvas.toObject(PROPS);
const cleaned = clean(real);
check('every kind fabric writes passes the allowlist (Textbox, Image + round clip, Rect, Circle, Ellipse, Triangle, Polygon, Polyline, Line, Path, Group)',
  cleaned?.side.objects.map((o) => o.type), ['Textbox', 'Image', 'Rect', 'Circle', 'Ellipse', 'Triangle', 'Polygon', 'Polyline', 'Line', 'Path', 'Group']);
check('…colours come out as #rrggbb ("rgb(12,34,56)" → #0c2238, "#ABC" → #aabbcc)', [cleaned?.side.objects[0].fill, cleaned?.side.objects[2].fill], ['#0c2238', '#aabbcc']);
check('…the picture is found by its id, its address blanked', [cleaned?.imageIds, cleaned?.side.objects[1].src], [['img-abc-def12'], '']);
const reloaded = new StaticCanvas(null, { width: 500, height: 500 });
const withSrc = JSON.parse(JSON.stringify(cleaned.side));
withSrc.objects[1].src = src.toDataURL('image/png');
await reloaded.loadFromJSON(withSrc);
const box = (o) => { const b = o.getBoundingRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 1000) / 1000); };
check('…and the cleaned design reloads to exactly the same geometry, object by object',
  reloaded.getObjects().map(box), canvas.getObjects().map(box));
check('…the italic, bold, underline, spacing and justify of the text survive', (({ fontStyle, fontWeight, underline, charSpacing, lineHeight, textAlign }) => ({ fontStyle, fontWeight, underline, charSpacing, lineHeight, textAlign }))(reloaded.getObjects()[0]),
  { fontStyle: 'italic', fontWeight: 'bold', underline: true, charSpacing: 80, lineHeight: 1.3, textAlign: 'justify' });

console.log('\n== the element library: every one of them passes ==\n');
const elements = JSON.parse(readFileSync(join(ROOT, 'src/components/product/designer/elementLibrary.json'), 'utf8'));
let elementFailures = [];
for (const el of elements) {
  const { objects } = await fabric.loadSVGFromString(el.svg);
  const parts = objects.filter(Boolean);
  const o = parts.length === 1 ? parts[0] : new Group(parts);
  o.rxElement = { lib: el.lib, id: el.id.replace(/^[a-z]+-/, '') };
  const r = clean(side([o.toObject(PROPS)]));
  if (!r) elementFailures.push(el.id);
}
check(`all ${elements.length} elements (shapes, icons, socials, emojis) pass`, elementFailures, []);

console.log('\n== the shop\'s own pattern and QR objects: parameters only ==\n');
const pattern = { type: 'RxPattern', left: 0, top: 0, width: 910, height: 610, originX: 'left', originY: 'top', fill: '#ffffff', rxPattern: { id: 'dots', colours: ['#f4efe6', '#d9572b'], scaleMm: 10 } };
const qr = { type: 'RxQr', left: 100, top: 100, width: 200, height: 200, fill: '#000000', rxQrBg: '#ffffff', rxQr: { text: 'https://shop.reklamx.se', ecc: 'M' } };
check('a pattern background and a QR code pass with their parameters', clean(side([pattern, qr]))?.side.objects.map((o) => [o.type, o.rxPattern?.id ?? o.rxQr?.text]), [['RxPattern', 'dots'], ['RxQr', 'https://shop.reklamx.se']]);
check('…an unknown pattern, a colour that is not a colour, an empty QR: refused',
  [clean(side([{ ...pattern, rxPattern: { ...pattern.rxPattern, id: 'nope' } }])), clean(side([{ ...pattern, rxPattern: { ...pattern.rxPattern, colours: ['url(x)', '#fff'] } }])), clean(side([{ ...qr, rxQr: { text: '' } }]))],
  [null, null, null]);
check('…a fabric Pattern FILL (it would carry a picture address in every snapshot) is refused', clean(side([{ type: 'Rect', width: 10, height: 10, fill: { type: 'pattern', source: 'data:image/png;base64,AAAA' } }])), null);

console.log('\n== known attacks: dropped or refused ==\n');
const evil = JSON.parse('{"type":"Rect","width":10,"height":10,"fill":"#ff0000","__proto__":{"polluted":1},"constructor":{"prototype":{"x":1}},"onload":"alert(1)","src":"https://evil.example/x.png","foo":{"bar":{"baz":{"src":"https://evil.example"}}}}');
const r1 = clean(side([evil]));
check('"__proto__", "constructor", unknown keys and an address on a shape: dropped, the shape kept', r1 && Object.keys(r1.side.objects[0]).sort(), ['fill', 'height', 'type', 'width']);
check('…and nothing polluted any prototype', [({}).polluted, Object.prototype.x], [undefined, undefined]);
check('a shadow, a composite mode, a background box, text on a path, per-character styles: pinned to harmless values',
  (({ shadow, globalCompositeOperation, backgroundColor, path, styles }) => ({ shadow, globalCompositeOperation, backgroundColor, path, styles }))(
    clean(side([{ type: 'Textbox', text: 'x', shadow: { color: 'red', blur: 999 }, globalCompositeOperation: 'xor', backgroundColor: '#000', path: { type: 'Path', path: [['M', 0, 0]] }, styles: [{ start: 0, end: 1, style: { src: 'x' } }] }]))?.side.objects[0] ?? {}),
  { shadow: null, globalCompositeOperation: 'source-over', backgroundColor: '', path: null, styles: [] });
check('refused: a gradient fill, a dash of 0.001 (renders for minutes), an arc or NaN in a path, a picture inside a group, a clip on a shape, a picture without its id',
  [clean(side([{ type: 'Rect', fill: { type: 'linear', colorStops: [] } }])),
    clean(side([{ type: 'Rect', stroke: '#000', strokeDashArray: [0.001, 0.001] }])),
    clean(side([{ type: 'Path', path: [['M', 0, 0], ['A', 1, 1, 0, 0, 1, 5, 5]] }])),
    clean(side([{ type: 'Path', path: [['M', 0, NaN]] }])),
    clean(side([{ type: 'Group', objects: [{ type: 'Image', rxImageId: 'img-a-b' }] }])),
    clean(side([{ type: 'Rect', clipPath: { type: 'Circle', radius: 5 } }])),
    clean(side([{ type: 'Image', src: 'https://evil.example/x.png' }]))],
  [null, null, null, null, null, null, null]);
check('a font the designer does not have is replaced by its default, not refused', clean(side([{ type: 'Textbox', text: 'x', fontFamily: 'Comic Sans MS' }]))?.side.objects[0].fontFamily, 'RX Inter');
check('more objects than any design needs: refused', clean(side(Array.from({ length: 1501 }, () => ({ type: 'Rect' })))), null);

console.log('\n== a fuzzer: thousands of mutated designs ==\n');
let seed = 20261007;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const VALUES = [null, undefined, true, false, 0, -1, 1e308, -1e308, NaN, Infinity, 0.5, 42, '', 'x', '#fff', 'rgb(1,2,3)', 'url(https://evil.example)', 'javascript:alert(1)',
  'https://evil.example/a.png', 'data:image/png;base64,AAAA', [], [1, 2], [['M', 0, 0]], {}, { src: 'https://evil.example' }, { type: 'pattern', source: 'x' }, { __proto__: { a: 1 } }];
const KEYS = ['type', 'src', 'source', 'fill', 'stroke', 'left', 'top', 'width', 'path', 'points', 'objects', 'clipPath', 'filters', 'shadow', 'styles', 'text',
  'fontFamily', 'rxImageId', 'rxPattern', 'rxQr', 'rxLock', 'rxBox', 'strokeDashArray', '__proto__', 'constructor', 'prototype', 'foo', 'radius', 'x1', 'scaleX'];
const TYPES = ['Rect', 'Textbox', 'Image', 'Group', 'Path', 'Polygon', 'Circle', 'RxPattern', 'RxQr', 'Script', 'iframe', '', 'rect', 'IMAGE'];
const mutate = (design) => {
  const objs = design.objects;
  for (let m = 0, n = 1 + Math.floor(rnd() * 4); m < n; m += 1) {
    const r = rnd();
    const target = objs.length && rnd() < 0.95 ? pick(objs) : design;
    if (r < 0.45) target[pick(KEYS)] = pick(VALUES);
    else if (r < 0.6) target.type = pick(TYPES);
    else if (r < 0.75) delete target[pick(Object.keys(target))];
    else if (r < 0.85) objs.push(JSON.parse(JSON.stringify(pick(objs.length ? objs : [{ type: 'Rect' }]))));
    else if (r < 0.95 && Array.isArray(target.objects)) target.objects.push({ type: pick(TYPES), [pick(KEYS)]: pick(VALUES) });
    else design.objects = pick([objs, [], null, 'x', [null], [[]]]);
  }
  return design;
};
const baseJson = JSON.stringify(cleaned.side);
let threw = 0;
let served = 0;
let notIdempotent = 0;
let leaked = 0;
const COLOUR_KEYS = new Set(['fill', 'stroke']);
for (let i = 0; i < 6000; i += 1) {
  const d = mutate(JSON.parse(baseJson));
  let out;
  try {
    out = S.cleanDesignSide(d, ctx);
  } catch {
    threw += 1;
    continue;
  }
  if (!out) continue;
  served += 1;
  const again = S.cleanDesignSide(JSON.parse(JSON.stringify(out.side)), ctx);
  if (!again || JSON.stringify(again.side) !== JSON.stringify(out.side)) notIdempotent += 1;
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 6) return;
    for (const [k, v] of Object.entries(o)) {
      if ((k === 'src' || k === 'source') && v) leaked += 1;
      if (COLOUR_KEYS.has(k) && v !== null && v !== '' && !/^#[0-9a-f]{6}$/.test(String(v))) leaked += 1;
      if (k === '__proto__' || k === 'constructor') leaked += 1;
      walk(v, depth + 1);
    }
  };
  walk(out.side, 0);
}
check('6 000 mutated designs: the cleaner never threw', threw, 0);
check('…every design it served is clean again unchanged (idempotent)', notIdempotent, 0);
check('…and none carries an address, a non-hex colour or a "__proto__"', leaked, 0);
console.log(`     (${served} of 6000 mutated designs were still served, cleaned)`);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ every design rule holds\n');
process.exit(failed ? 1 : 0);
