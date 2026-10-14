/**
 * A PRINT PDF FROM IMAGE TILES — the designer's print file for two-sided and large
 * designs (designer v2).
 *
 * One page per side. Each page is MediaBox = the trim with its bleed, BleedBox = the
 * same, TrimBox = the product, and is drawn as a grid of image TILES the browser
 * rendered from the same scene the customer saw (no font or layout conversion, so
 * nothing can differ from the screen). A tile is JPEG (DCTDecode) when it holds a
 * photo, zlib-deflated RGB (FlateDecode) when it is flat artwork — JPEG's 4:2:0
 * colour subsampling smears small coloured text.
 *
 * Written as Blob PARTS: tiles are never copied into one big buffer (a roll-up is
 * tens of megabytes; a phone has little memory to spare). A library would have been
 * an extra ~180 KB downloaded by every shopper (the build puts node_modules in the
 * eager vendor chunk) and doubled the memory on save. src/lib/pdfBoxes.ts reads the
 * boxes back in the tests.
 *
 * Pure (Blob and TextEncoder exist in browsers and in Node ≥ 18).
 */

export interface PdfTile {
  /** The encoded image: JPEG bytes, or zlib-wrapped deflate of packed RGB. */
  data: Blob;
  filter: 'DCTDecode' | 'FlateDecode';
  widthPx: number;
  heightPx: number;
  /** Where it goes on the page, in points from the page's TOP-left (converted below). */
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
}

export interface PdfPage {
  widthPt: number;
  heightPt: number;
  /** [x0, y0, x1, y1] in points from the BOTTOM-left, as PDF boxes are. */
  trimBox: [number, number, number, number];
  bleedBox: [number, number, number, number];
  tiles: PdfTile[];
}

/** PDF's own limit: 14 400 points (200 inches, 5 080 mm) a side. */
export const PDF_MAX_PAGE_PT = 14_400;
export const MM_TO_PT = 72 / 25.4;

const num = (x: number) => {
  const r = Math.round(x * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const box = (b: number[]) => `[${b.map(num).join(' ')}]`;

export function writePrintPdf(pages: PdfPage[], meta: { title?: string; producer?: string } = {}): Blob {
  if (pages.length === 0) throw new Error('A print file needs a page.');
  for (const p of pages) {
    if (!(p.widthPt > 0 && p.heightPt > 0) || p.widthPt > PDF_MAX_PAGE_PT || p.heightPt > PDF_MAX_PAGE_PT) {
      throw new Error('Page size outside what a PDF can hold.');
    }
  }
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (p: string | Blob | Uint8Array) => {
    if (typeof p === 'string') {
      const bytes = enc.encode(p);
      parts.push(bytes);
      pos += bytes.length;
    } else if (p instanceof Uint8Array) {
      parts.push(p);
      pos += p.length;
    } else {
      parts.push(p);
      pos += p.size;
    }
  };
  const begin = (n: number) => {
    offsets[n] = pos;
    push(`${n} 0 obj\n`);
  };
  // Header, then a comment of four bytes above 127: tells transfer tools the file is binary.
  push('%PDF-1.6\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1 = catalog, 2 = pages, 3 = info; then per page: tiles…, content, page.
  let next = 4;
  const pageNums: number[] = [];
  for (const page of pages) {
    const tileNums = page.tiles.map(() => next++);
    const contentNum = next++;
    const pageNum = next++;
    pageNums.push(pageNum);
    page.tiles.forEach((t, i) => {
      begin(tileNums[i]);
      push(
        `<< /Type /XObject /Subtype /Image /Width ${t.widthPx} /Height ${t.heightPx} /ColorSpace /DeviceRGB` +
          ` /BitsPerComponent 8 /Filter /${t.filter} /Length ${t.data.size} >>\nstream\n`,
      );
      push(t.data);
      push('\nendstream\nendobj\n');
    });
    // Each tile drawn at its place: the image space is a unit square scaled to the
    // tile, the y axis flipped from "from the top" to PDF's "from the bottom".
    const ops = page.tiles
      .map((t, i) => `q ${num(t.wPt)} 0 0 ${num(t.hPt)} ${num(t.xPt)} ${num(page.heightPt - t.yPt - t.hPt)} cm /T${i} Do Q`)
      .join('\n');
    begin(contentNum);
    push(`<< /Length ${enc.encode(ops).length} >>\nstream\n${ops}\nendstream\nendobj\n`);
    const xobjects = page.tiles.map((_, i) => `/T${i} ${tileNums[i]} 0 R`).join(' ');
    begin(pageNum);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.widthPt)} ${num(page.heightPt)}]` +
        ` /BleedBox ${box(page.bleedBox)} /TrimBox ${box(page.trimBox)}` +
        ` /Resources << /XObject << ${xobjects} >> >> /Contents ${contentNum} 0 R >>\nendobj\n`,
    );
  }
  begin(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  begin(2);
  push(`<< /Type /Pages /Kids [${pageNums.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageNums.length} >>\nendobj\n`);
  // Info strings as PDF text: only printable ASCII, parentheses and backslashes escaped.
  const pdfText = (s: string) => `(${s.replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1').slice(0, 200)})`;
  begin(3);
  push(`<< /Title ${pdfText(meta.title ?? 'Print file')} /Producer ${pdfText(meta.producer ?? 'ReklamX online designer')} >>\nendobj\n`);
  const xref = pos;
  let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
  for (let i = 1; i < next; i += 1) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(`${table}trailer\n<< /Size ${next} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
