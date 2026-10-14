#!/usr/bin/env node
// A PDF/X with crop marks is measured by its TrimBox — src/lib/pdfBoxes.ts (round 16).
//
// An InDesign "PDF/X with marks and bleed" export of an 85 × 55 mm card is a
// 105 × 75 mm page: trim + bleed + the crop marks. The shop measured the page and
// refused an exactly right file. The PDFs here are written by hand, byte by byte,
// and opened with the same pdf.js the shop uses, so the page object the reader
// finds is checked against the page pdf.js drew.
//
// Usage:  node scripts/test-pdf-boxes.mjs

import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'reklamx-pdfboxes-'));
await build({ entryPoints: [join(ROOT, 'src/lib/pdfBoxes.ts')], outfile: join(dir, 'b.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const B = await import(pathToFileURL(join(dir, 'b.mjs')).href);
rmSync(dir, { recursive: true, force: true });
const require = createRequire(join(ROOT, 'package.json'));
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};

const MM = 72 / 25.4;
const pt = (mm) => Math.round(mm * MM * 100) / 100;
const box = (x0, y0, x1, y1) => `[${pt(x0)} ${pt(y0)} ${pt(x1)} ${pt(y1)}]`;
// An 85 × 55 mm card, 3 mm bleed, 10 mm of slug for the marks: a 105 × 75 mm page.
const MEDIA = box(0, 0, 105, 75);
const TRIM = box(10, 10, 95, 65);
const BLEED = box(7, 7, 98, 68);

/** A PDF from object bodies (1-based), with a classic xref table. Extra raw text may follow (an update). */
function pdf(objects, { trailerExtra = '' } = {}) {
  let out = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const page = (extra) => `<< /Type /Page /Parent 2 0 R /MediaBox ${MEDIA} ${extra} /Contents 4 0 R >>`;
const card = (extra) =>
  pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    page(extra),
    '<< /Length 0 >>\nstream\n\nendstream',
  ]);

/** Open with pdf.js as the shop does, then read the boxes the way the shop will. */
async function measure(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false });
  const doc = await task.promise;
  const p = await doc.getPage(1);
  const info = { view: [...p.view], ref: p.ref, rotate: p.rotate, userUnit: p.userUnit };
  await task.destroy();
  const boxes = await B.readPageBoxes(new Uint8Array(bytes), info.ref, info.view);
  const chosen = B.chooseArtworkBox({ view: info.view, trim: boxes?.trim, bleed: boxes?.bleed, userUnit: info.userUnit, rotate: info.rotate });
  const r = (n) => Math.round(n * 10) / 10;
  return { found: !!boxes, source: chosen.source, size: [r(chosen.widthMm), r(chosen.heightMm)], bleedMm: chosen.bleedMm, page: [r(chosen.pageWidthMm), r(chosen.pageHeightMm)] };
}

console.log('\n== the crop-marked card ==\n');
check('InDesign\'s export of an 85 × 55 card: the page is 105 × 75, the TrimBox 85 × 55 with 3 mm bleed',
  await measure(card(`/TrimBox ${TRIM} /BleedBox ${BLEED}`)),
  { found: true, source: 'trimbox', size: [85, 55], bleedMm: 3, page: [105, 75] });
check('a TrimBox and no BleedBox: the trim, bleed unknown (0) — the slug is not taken for bleed',
  (await measure(card(`/TrimBox ${TRIM}`))).bleedMm, 0);
check('a BleedBox and no TrimBox: measured by the BleedBox (91 × 61 — the size WITH bleed)',
  (await measure(card(`/BleedBox ${BLEED}`))).size, [91, 61]);
check('no boxes: the page, as before', (await measure(card(''))).source, 'page');
check('a TrimBox equal to the page says nothing: the page, as before', (await measure(card(`/TrimBox ${MEDIA}`))).source, 'page');
check('a TrimBox reaching OUTSIDE the page is not trusted', (await measure(card(`/TrimBox ${box(-5, -5, 95, 65)}`))).source, 'page');
check('a BleedBox equal to the page, around a smaller trim: bleed unknown (it is the page again)',
  (await measure(card(`/TrimBox ${TRIM} /BleedBox ${MEDIA}`))).bleedMm, 0);
check('/BoxColorInfo has its OWN /TrimBox key (a dictionary): the page\'s box is the one read',
  (await measure(card(`/BoxColorInfo << /TrimBox << /C [1 0 0] /W 1 >> >> /TrimBox ${TRIM}`))).size, [85, 55]);
check('a box written as a reference to another object',
  await (async () => {
    const bytes = pdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox ${MEDIA} /TrimBox 5 0 R /Contents 4 0 R >>`, '<< /Length 0 >>\nstream\n\nendstream', TRIM]);
    return (await measure(bytes)).size;
  })(), [85, 55]);
check('the MediaBox inherited from the page tree (only the trim on the page)',
  await (async () => {
    const bytes = pdf(['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox ${MEDIA} >>`,
      `<< /Type /Page /Parent 2 0 R /TrimBox ${TRIM} /Contents 4 0 R >>`, '<< /Length 0 >>\nstream\n\nendstream']);
    return (await measure(bytes)).source;
  })(), 'trimbox');
check('a page turned 90° reads turned (55 × 85)', (await measure(card(`/Rotate 90 /TrimBox ${TRIM}`))).size, [55, 85]);
check('UserUnit 2: everything twice the size', (await measure(card(`/UserUnit 2 /TrimBox ${TRIM}`))).size, [170, 110]);

console.log('\n== reading the right object ==\n');
// An incremental update: the page object written again, later in the file.
const original = card(`/TrimBox ${box(5, 5, 100, 70)}`);
const updated = (() => {
  const base = original.toString('latin1');
  const objOffset = Buffer.byteLength(base, 'latin1');
  const body = `3 0 obj\n${page(`/TrimBox ${TRIM}`)}\nendobj\n`;
  const prevXref = Number(/startxref\n(\d+)/.exec(base)[1]);
  const xref = objOffset + Buffer.byteLength(body, 'latin1');
  const tail = `xref\n3 1\n${String(objOffset).padStart(10, '0')} 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R /Prev ${prevXref} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(base + body + tail, 'latin1');
})();
check('saved twice (an incremental update): the LATER page object wins', (await measure(updated)).size, [85, 55]);
check('"112 0 obj" is never taken for "12 0 obj"',
  await (async () => {
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', page(`/TrimBox ${TRIM}`), '<< /Length 0 >>\nstream\n\nendstream'];
    // A real-looking page as object 112: a scanner that matched "12 0 obj" inside
    // "112 0 obj" would find it and answer with its boxes.
    const bytes = Buffer.concat([pdf(objs), Buffer.from(`\n112 0 obj\n<< /Type /Page /MediaBox [0 0 1 1] /TrimBox [0.1 0.1 0.5 0.5] >>\nendobj\n`, 'latin1')]);
    return B.readPageBoxes(new Uint8Array(bytes), { num: 12, gen: 0 }, [0, 0, 1, 1]);
  })(), null);
check('a page whose own MediaBox does not match what pdf.js drew: not trusted (null)',
  await B.readPageBoxes(new Uint8Array(card(`/TrimBox ${TRIM}`)), { num: 3, gen: 0 }, [0, 0, 10, 10]), null);
check('an encrypted file is not read', await B.readPageBoxes(new Uint8Array(card(`/TrimBox ${TRIM}`).toString('latin1').replace('/Type /Catalog', '/Type /Catalog /Encrypt 9 0 R').split('').map((c) => c.charCodeAt(0))), { num: 3, gen: 0 }, [0, 0, 297.64, 212.6]), null);
check('no ref (pdf.js could not say), garbage bytes: null — the page is measured as before',
  [await B.readPageBoxes(new Uint8Array(card('')), null, [0, 0, 1, 1]), await B.readPageBoxes(new Uint8Array([1, 2, 3, 4]), { num: 3, gen: 0 }, [0, 0, 1, 1])], [null, null]);

console.log('\n== compressed object streams (PDF 1.5+, how Acrobat and InDesign save) ==\n');
{
  // Objects 1–3 inside one FlateDecode object stream (object 4), the content
  // stream (5) and an XRef stream (6) that pdf.js reads to find them.
  const members = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox ${MEDIA} /TrimBox ${TRIM} /BleedBox ${BLEED} /Contents 5 0 R >>`];
  let header = '';
  let bodies = '';
  members.forEach((m, i) => {
    header += `${i + 1} ${Buffer.byteLength(bodies, 'latin1')} `;
    bodies += m + '\n';
  });
  const first = Buffer.byteLength(header, 'latin1');
  const packed = deflateSync(Buffer.from(header + bodies, 'latin1'));
  let out = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1');
  const off = {};
  const add = (n, head, data) => {
    off[n] = out.length;
    out = Buffer.concat([out, Buffer.from(`${n} 0 obj\n${head}`, 'latin1'), data ?? Buffer.alloc(0), Buffer.from(data ? '\nendstream\nendobj\n' : '\nendobj\n', 'latin1')]);
  };
  add(4, `<< /Type /ObjStm /N 3 /First ${first} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`, packed);
  add(5, '<< /Length 0 >>\nstream\n', Buffer.alloc(0));
  const rows = [[0, 0, 0xffff], [2, 4, 0], [2, 4, 1], [2, 4, 2], [1, off[4], 0], [1, off[5], 0], [1, out.length, 0]];
  const xrefData = Buffer.concat(rows.map(([t, a, b]) => { const r = Buffer.alloc(7); r[0] = t; r.writeUInt32BE(a, 1); r.writeUInt16BE(b, 5); return r; }));
  const xrefAt = out.length;
  add(6, `<< /Type /XRef /Size 7 /W [1 4 2] /Root 1 0 R /Length ${xrefData.length} >>\nstream\n`, xrefData);
  out = Buffer.concat([out, Buffer.from(`startxref\n${xrefAt}\n%%EOF\n`, 'latin1')]);
  check('the page object inside a compressed object stream: found, 85 × 55 with 3 mm bleed',
    await measure(out), { found: true, source: 'trimbox', size: [85, 55], bleedMm: 3, page: [105, 75] });
}
{
  // Saved twice: the page first as a PLAIN object (TrimBox 95 × 65), then again
  // inside a later object stream (85 × 55) that ends in two bytes of junk — which
  // pdf.js forgives and DecompressionStream does not. The old answer is not given
  // as if it were the file's: the reader does not know, and says so (null).
  const plain = card(`/TrimBox ${box(5, 5, 100, 70)}`).toString('latin1');
  const member = `${page(`/TrimBox ${TRIM}`)}\n`;
  const header = '3 0 ';
  const packed = Buffer.concat([deflateSync(Buffer.from(header + member, 'latin1')), Buffer.from('XY', 'latin1')]);
  const at = Buffer.byteLength(plain, 'latin1');
  const stm = Buffer.concat([Buffer.from(`6 0 obj\n<< /Type /ObjStm /N 1 /First ${header.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`, 'latin1'), packed, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
  const bytes = Buffer.concat([Buffer.from(plain, 'latin1'), stm]);
  const view = [0, 0, pt(105), pt(75)];
  check('a LATER revision in an object stream that cannot be read: not the older plain page\'s TrimBox — null',
    await B.readPageBoxes(new Uint8Array(bytes), { num: 3, gen: 0 }, view), null);
  // The same stream without the junk: read, and the later revision wins.
  const clean = Buffer.concat([Buffer.from(plain, 'latin1'), Buffer.from(`6 0 obj\n<< /Type /ObjStm /N 1 /First ${header.length} /Filter /FlateDecode /Length ${packed.length - 2} >>\nstream\n`, 'latin1'), packed.subarray(0, packed.length - 2), Buffer.from('\nendstream\nendobj\n', 'latin1')]);
  const r = await B.readPageBoxes(new Uint8Array(clean), { num: 3, gen: 0 }, view);
  check('…readable, the later revision in the stream wins over the plain one before it', r && r.trim.map((n) => Math.round(n / MM)), [10, 10, 95, 65]);
  // An object right BEFORE an object stream: the stream's "/ObjStm" falls in its
  // first kilobyte, but after its own "endobj" — it is not taken for one.
  const small = Buffer.from(`7 0 obj\n(not a stream\n\nendobj\n`, 'latin1');
  const r2 = await B.readPageBoxes(new Uint8Array(Buffer.concat([Buffer.from(plain, 'latin1'), small, clean.subarray(Buffer.byteLength(plain, 'latin1'))])), { num: 3, gen: 0 }, view);
  check('…an unparseable object just before it does not count as an unreadable stream', r2 && r2.trim.map((n) => Math.round(n / MM)), [10, 10, 95, 65]);

  // Legal or tolerated object streams that pdf.js opens: read, not taken for unreadable.
  const deflated = deflateSync(Buffer.from(header + member, 'latin1'));
  const variant = (dict, data) => {
    const stmBytes = Buffer.concat([Buffer.from(`6 0 obj\n<< /Type /ObjStm ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
    return new Uint8Array(Buffer.concat([Buffer.from(plain, 'latin1'), stmBytes]));
  };
  const trimOf = async (bytes) => { const x = await B.readPageBoxes(bytes, { num: 3, gen: 0 }, view); return x && x.trim.map((n) => Math.round(n / MM)); };
  check('…a /Length that counted the end-of-line after the data; an empty /DecodeParms; [null]; no filter at all',
    [await trimOf(variant(`/N 1 /First ${header.length} /Filter /FlateDecode`, Buffer.concat([deflated, Buffer.from('\r\n', 'latin1')]))),
      await trimOf(variant(`/N 1 /First ${header.length} /Filter /FlateDecode /DecodeParms << >>`, deflated)),
      await trimOf(variant(`/N 1 /First ${header.length} /Filter [/FlateDecode] /DecodeParms [null]`, deflated)),
      await trimOf(variant(`/N 1 /First ${header.length}`, Buffer.from(header + member, 'latin1')))],
    [[10, 10, 95, 65], [10, 10, 95, 65], [10, 10, 95, 65], [10, 10, 95, 65]]);
  check('…an empty object stream (/N 0) is read as empty: the plain page before it stands',
    await trimOf(variant('/N 0 /First 0 /Filter /FlateDecode', deflateSync(Buffer.alloc(0)))), [5, 5, 100, 70]);
}
{
  // More members than the value reader's budget (100 000 pairs): the table is
  // plain integers and is read without it — the stream is not "unreadable".
  const plain = card(`/TrimBox ${box(5, 5, 100, 70)}`).toString('latin1');
  const count = 100_001;
  const parts = [];
  let body = '';
  for (let k = 0; k < count; k += 1) {
    parts.push(`${1000 + k} ${body.length}`);
    body += '1\n';
  }
  const header = parts.join(' ') + '\n';
  const packed = deflateSync(Buffer.from(header + body, 'latin1'));
  const bytes = Buffer.concat([Buffer.from(plain, 'latin1'), Buffer.from(`6 0 obj\n<< /Type /ObjStm /N ${count} /First ${Buffer.byteLength(header, 'latin1')} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`, 'latin1'), packed, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
  const r = await B.readPageBoxes(new Uint8Array(bytes), { num: 3, gen: 0 }, [0, 0, pt(105), pt(75)]);
  check('an object stream of 100 001 members is read (it was "unreadable", and nulled the page before it)', r && r.trim.map((n) => Math.round(n / MM)), [5, 5, 100, 70]);
}

console.log('\n== which box, in numbers ==\n');
const view = [0, 0, pt(105), pt(75)];
check('the trim to draw is the trim PLUS its bleed (the preview frames the bleed outside the product)',
  B.chooseArtworkBox({ view, trim: [pt(10), pt(10), pt(95), pt(65)], bleed: [pt(7), pt(7), pt(98), pt(68)] }).box.map((n) => Math.round(n / MM)),
  [7, 7, 98, 68]);
check('a bleed under 2.5 mm on any side is not called a bleed', B.chooseArtworkBox({ view, trim: [pt(10), pt(10), pt(95), pt(65)], bleed: [pt(8), pt(7), pt(98), pt(68)] }).bleedMm, 0);

console.log(failed ? `\n❌ ${failed} check(s) failed\n` : '\n✅ every box rule holds\n');
process.exit(failed ? 1 : 0);
