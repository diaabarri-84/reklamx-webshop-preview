#!/usr/bin/env node
// The shop's own kinds of object — src/components/product/designer/rxObjects.ts.
//
// A pattern background and a QR code are drawn from their PARAMETERS at whatever
// resolution the canvas has: the JSON must hold the parameters only, reload as the
// same class, draw the motif at its size in mm on the BOARD whatever the object's
// own scale, and stay sharp at print multipliers. Rendered with fabric/node.
//
//   node scripts/test-design-objects.mjs
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(join(ROOT, 'package.json'));
const fabric = require('fabric/node');
const { StaticCanvas } = fabric;

const dir = mkdtempSync(join(tmpdir(), 'reklamx-rxobj-'));
await build({
  stdin: {
    contents: [
      `export * from ${JSON.stringify(join(ROOT, 'src/components/product/designer/rxObjects.ts'))};`,
      `export { qrPath, cleanQrSpec } from ${JSON.stringify(join(ROOT, 'src/lib/designQr.ts'))};`,
      `export { cleanDesignSide } from ${JSON.stringify(join(ROOT, 'src/lib/designSchema.ts'))};`,
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  // The test's fabric and the module's fabric must be ONE instance (one class registry).
  alias: { fabric: 'fabric/node' },
  external: ['fabric/node', 'canvas', 'jsdom'],
  outfile: join(dir, 'o.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
// The bundle imports 'fabric/node' — resolve it from the repo, not from the temp folder.
const bundle = await import(pathToFileURL(join(dir, 'o.mjs')).href).catch(async () => {
  const { readFileSync, writeFileSync } = await import('node:fs');
  const p = join(dir, 'o.mjs');
  writeFileSync(p, readFileSync(p, 'utf8').replaceAll('"fabric/node"', JSON.stringify(require.resolve('fabric/node'))));
  return import(pathToFileURL(p).href + '?2');
});
const O = bundle;
rmSync(dir, { recursive: true, force: true });

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const hex = (d, i) => `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
const pixel = (el, x, y) => hex(el.getContext('2d').getImageData(x, y, 1, 1).data, 0);

console.log('\n== a pattern background ==\n');
// A 60 × 40 mm board (600 × 400 units); 10 mm checks: a 6 × 4 grid of tiles.
const spec = { id: 'checks', colours: ['#ffffff', '#123456'], scaleMm: 10 };
const board = new StaticCanvas(null, { width: 600, height: 400, enableRetinaScaling: false });
board.add(new O.RxPattern({ left: 0, top: 0, width: 600, height: 400, originX: 'left', originY: 'top', objectCaching: false, rxPattern: spec }));
const json = board.toObject(['rxPattern']);
check('the JSON holds the parameters only — no picture, no pattern fill', [json.objects[0].type, json.objects[0].rxPattern, typeof json.objects[0].fill], ['RxPattern', spec, 'string']);
check('…and passes the design allowlist', O.cleanDesignSide(json, { fontFamilyOk: () => true, defaultFont: 'RX Inter' })?.side.objects[0].rxPattern, spec);
const again = new StaticCanvas(null, { width: 600, height: 400, enableRetinaScaling: false });
await again.loadFromJSON(json);
check('it reloads as the same class', again.getObjects()[0] instanceof O.RxPattern, true);
const at = (canvas, multiplier, xMm, yMm) => pixel(canvas.toCanvasElement(multiplier), Math.floor(xMm * 10 * multiplier), Math.floor(yMm * 10 * multiplier));
// "checks": the first half-tile (top-left quarter) is the foreground.
check('checks of 10 mm: the colours sit where the motif puts them, on the board',
  [at(again, 1, 2.5, 2.5), at(again, 1, 7.5, 2.5), at(again, 1, 7.5, 7.5), at(again, 1, 12.5, 2.5)], ['#123456', '#ffffff', '#123456', '#123456']);
check('…the same at a print multiplier (×6.3 — a different tile resolution, the same places)',
  [at(again, 6.3, 2.5, 2.5), at(again, 6.3, 7.5, 2.5), at(again, 6.3, 57.5, 37.5)], ['#123456', '#ffffff', '#123456']);
// The rectangle stretched ×2 wide: the checks must stay 10 mm squares, not become 20 × 10.
const stretched = new StaticCanvas(null, { width: 600, height: 400, enableRetinaScaling: false });
stretched.add(new O.RxPattern({ left: 0, top: 0, width: 300, height: 400, scaleX: 2, originX: 'left', originY: 'top', objectCaching: false, rxPattern: spec }));
check('a rectangle stretched ×2 keeps 10 mm checks (a stretched background must not stretch its motif)',
  [at(stretched, 1, 7.5, 2.5), at(stretched, 1, 12.5, 2.5)], ['#ffffff', '#123456']);
const bad = new StaticCanvas(null, { width: 100, height: 100, enableRetinaScaling: false });
bad.add(new O.RxPattern({ left: 0, top: 0, width: 100, height: 100, originX: 'left', originY: 'top', objectCaching: false, rxPattern: { id: 'nope', colours: ['#ff0000', '#000000'], scaleMm: 5 } }));
check('an unknown pattern draws a plain white background, never an error', pixel(bad.toCanvasElement(1), 50, 50), '#ffffff');

console.log('\n== a QR code ==\n');
const qrSpec = { text: 'https://shop.reklamx.se/products/roll-up', ecc: 'M' };
const qrBoard = new StaticCanvas(null, { width: 400, height: 400, enableRetinaScaling: false });
qrBoard.add(new O.RxQr({ left: 0, top: 0, width: 400, height: 400, originX: 'left', originY: 'top', fill: '#1a1a1a', rxQrBg: '#ffffff', objectCaching: false, rxQr: qrSpec }));
const qrJson = qrBoard.toObject(['rxQr', 'rxQrBg']);
check('the JSON holds what the code says, not its squares', [qrJson.objects[0].type, qrJson.objects[0].rxQr, 'path' in qrJson.objects[0]], ['RxQr', qrSpec, false]);
const qrAgain = new StaticCanvas(null, { width: 400, height: 400, enableRetinaScaling: false });
await qrAgain.loadFromJSON(qrJson);
const drawn = qrAgain.toCanvasElement(1);
const p = O.qrPath(O.cleanQrSpec(qrSpec));
const dark = new Set();
for (const m of p.d.matchAll(/M(\d+) (\d+)h(\d+)/g)) for (let k = 0; k < Number(m[3]); k += 1) dark.add(`${Number(m[1]) + k},${m[2]}`);
let wrong = 0;
const module = 400 / p.size;
for (let y = 0; y < p.size; y += 1) {
  for (let x = 0; x < p.size; x += 1) {
    const c = pixel(drawn, Math.floor((x + 0.5) * module), Math.floor((y + 0.5) * module));
    if ((c === '#1a1a1a') !== dark.has(`${x},${y}`)) wrong += 1;
  }
}
check(`every one of its ${p.size * p.size} modules drawn dark or light exactly as the code says (quiet zone included)`, wrong, 0);
const corner = pixel(drawn, 2, 2);
check('…the quiet zone is the light colour behind it', corner, '#ffffff');

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ every object rule holds\n');
process.exit(failed ? 1 : 0);
