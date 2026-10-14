// The print engine in a real browser (scripts/local-e2e/print-engine.mjs builds this
// with Vite and runs it in Chromium and WebKit). Each case makes a real print PDF with
// src/components/product/designer/printFile.ts, then renders that PDF back with pdf.js
// and compares it with the design itself rendered by fabric: the whole page, and
// close-ups across every tile seam at the file's own resolution.
import { StaticCanvas } from 'fabric';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { clipOnThePage } from '../../../src/components/product/designer/rxObjects';
import { toGreys } from '../../../src/components/product/designer/inkGreys';
import { makePrintPdf } from '../../../src/components/product/designer/printFile';
import { ensureFontFamilies } from '../../../src/components/product/designer/fonts';
import { pagePixels, tilePlan, printSpecFor, type ProductKind } from '../../../src/lib/printSpec';
import type { SideId } from '../../../src/lib/designDoc';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const U = 10;

/** A photo-like picture: smooth colour fields, and optionally full-strength noise (the worst case for JPEG). */
async function photoUrl(w: number, h: number, noise: number): Promise<string> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#1e3a8a');
  g.addColorStop(0.5, '#f59e0b');
  g.addColorStop(1, '#be123c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  if (noise > 0) {
    const img = ctx.getImageData(0, 0, w, h);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = ((seed >> 8) % 256) - 128;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + n * noise));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] - n * noise));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * noise * 0.5));
    }
    ctx.putImageData(img, 0, 0);
  }
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95));
  c.width = 0;
  c.height = 0;
  return URL.createObjectURL(blob);
}

type Side = { id: SideId; json: Record<string, unknown>; grey?: boolean };

/** A fine black-and-white checkerboard (lossless): sharp edges that any blur would grey out. */
async function checkerUrl(px: number, square: number): Promise<string> {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000000';
  for (let y = 0; y < px; y += square) for (let x = (y / square) % 2 ? square : 0; x < px; x += 2 * square) ctx.fillRect(x, y, square, square);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  c.width = 0;
  c.height = 0;
  return URL.createObjectURL(blob);
}

/** How far a picture's pixels stray from their own mean brightness: its contrast. */
function contrast(canvas: HTMLCanvasElement): number {
  const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  const luma: number[] = [];
  for (let i = 0; i < d.length; i += 4) luma.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
  const mean = luma.reduce((a, v) => a + v, 0) / luma.length;
  return luma.reduce((a, v) => a + Math.abs(v - mean), 0) / luma.length;
}

/** The largest difference between a pixel's red, green and blue: 0 in a picture made of greys. */
function chroma(canvas: HTMLCanvasElement): number {
  const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
  let most = 0;
  for (let i = 0; i < d.length; i += 4) most = Math.max(most, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2]), Math.abs(d[i] - d[i + 2]));
  return most;
}

type Case = {
  kind: ProductKind;
  trimMm: { wMm: number; hMm: number };
  sides: Side[];
  /** What the design is compared with, when not itself (a shaped picture: its uncached self). */
  refSides?: Side[];
  /** Where to look closely at the file's own resolution, in board units. */
  closeUp?: { x: number; y: number };
};

async function cases(): Promise<Record<string, Case>> {
  const text = (t: string, o: Record<string, unknown>) => ({ type: 'Textbox', text: t, originX: 'left', originY: 'top', fill: '#111111', ...o });
  const rollTrim = { wMm: 850, hMm: 2000 };
  const b = 3;
  const W = (rollTrim.wMm + 2 * b) * U;
  const H = (rollTrim.hMm + 2 * b) * U;
  const photo = await photoUrl(3000, 2000, 0.25);
  const rollup: Side = {
    id: 'front',
    json: {
      version: '7.4.0',
      background: '#ffffff',
      objects: [
        { type: 'RxPattern', left: 0, top: 0, width: W, height: H, originX: 'left', originY: 'top', rxPattern: { id: 'confetti', colours: ['#fff7ed', '#ea580c'], scaleMm: 60 } },
        { type: 'Rect', left: 0, top: 0, width: W, height: 4200, originX: 'left', originY: 'top', fill: '#0f2a43' },
        text('SOMMARREA', { left: 600, top: 900, width: 7400, fontSize: 1500, fontFamily: 'RX Montserrat', fontWeight: 'bold', fill: '#f2c14e' }),
        text('−50 % på allt i butiken. Välkommen in! Åäö æø €', { left: 600, top: 5200, width: 7400, fontSize: 420, fontFamily: 'RX Lora' }),
        { type: 'Image', src: photo, rxImageId: 'img-test-photo1', left: 450, top: 7600, originX: 'left', originY: 'top', width: 3000, height: 2000, scaleX: 2.6, scaleY: 2.6 },
        { type: 'RxQr', left: 2800, top: 14200, width: 3000, height: 3000, originX: 'left', originY: 'top', fill: '#0f2a43', rxQrBg: '#ffffff', rxQr: { text: 'https://shop.reklamx.se', ecc: 'M' } },
      ],
    },
  };
  const cardTrim = { wMm: 85, hMm: 55 };
  const cw = (85 + 6) * U;
  const ch = (55 + 6) * U;
  const card: Side[] = [
    {
      id: 'front',
      json: {
        version: '7.4.0',
        background: '#fef3c7',
        objects: [
          { type: 'Rect', left: 0, top: 0, width: 300, height: ch, originX: 'left', originY: 'top', fill: '#b91c1c' },
          text('Sara Lind', { left: 360, top: 140, width: 500, fontSize: 70, fontFamily: 'RX Playfair Display', fontWeight: 'bold' }),
          text('Grafisk formgivare', { left: 360, top: 240, width: 500, fontSize: 36, fontFamily: 'RX Inter', fill: '#b91c1c' }),
        ],
      },
    },
    {
      id: 'back',
      json: {
        version: '7.4.0',
        background: '#ffffff',
        objects: [
          { type: 'RxQr', left: 60, top: 80, width: 300, height: 300, originX: 'left', originY: 'top', fill: '#111111', rxQrBg: '#ffffff', rxQr: { text: 'BEGIN:VCARD\nVERSION:3.0\nN:Lind;Sara\nEND:VCARD', ecc: 'M' } },
          text('sara@example.se\n+46 70 123 45 67', { left: 420, top: 160, width: 440, fontSize: 32, fontFamily: 'RX Inter', lineHeight: 1.4 }),
        ],
      },
    },
  ];
  // Both sides a full-bleed, noisy photograph: the file the byte budget is for.
  const heavyTrim = { wMm: 1000, hMm: 2000 };
  const hw = (1000 + 6) * U;
  const hh = (2000 + 6) * U;
  const noisy = await photoUrl(4096, 4096, 1);
  const heavySide = (id: SideId): Side => ({
    id,
    json: {
      version: '7.4.0',
      background: '#ffffff',
      objects: [{ type: 'Image', src: noisy, rxImageId: 'img-test-noisy1', left: 0, top: 0, originX: 'left', originY: 'top', width: 4096, height: 4096, scaleX: hw / 4096, scaleY: hh / 4096 }],
    },
  });
  // A ROUND picture 600 mm across a roll-up. fabric draws any clipped object through a
  // cache capped at 2 MP and scales it up: the print must be as sharp as the picture
  // drawn without the clip (which is never cached).
  const checker = await checkerUrl(3000, 3);
  const roundSide = (clip: boolean): Side => ({
    id: 'front',
    json: {
      version: '7.4.0',
      background: '#ffffff',
      objects: [
        {
          type: 'Image', src: checker, rxImageId: 'img-test-round1', left: W / 2, top: 8000, originX: 'center', originY: 'center',
          width: 3000, height: 3000, scaleX: 2, scaleY: 2,
          ...(clip ? { clipPath: { type: 'Circle', radius: 1500, left: 0, top: 0, originX: 'center', originY: 'center', strokeWidth: 0 } } : {}),
        },
      ],
    },
  });
  // A card printed in BLACK only, front in colours on screen: its file is made in greys.
  const greyCard = card.map((s) => ({ ...s, grey: true }));
  return {
    rollup: { kind: 'rollup', trimMm: rollTrim, sides: [rollup] },
    card: { kind: 'card', trimMm: cardTrim, sides: card },
    heavy: { kind: 'rollup', trimMm: heavyTrim, sides: [heavySide('front'), heavySide('back')] },
    round: { kind: 'rollup', trimMm: rollTrim, sides: [roundSide(true)], refSides: [roundSide(false)], closeUp: { x: W / 2, y: 8000 } },
    grey: { kind: 'card', trimMm: cardTrim, sides: greyCard },
  };
}

/** Mean absolute difference (0–255) between two equally sized canvases, and per row. */
function diff(a: HTMLCanvasElement, b: HTMLCanvasElement): { mean: number; rows: number[] } {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const da = a.getContext('2d')!.getImageData(0, 0, w, h).data;
  const db = b.getContext('2d')!.getImageData(0, 0, w, h).data;
  const rows: number[] = [];
  let total = 0;
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      row += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    }
    rows.push(row / (w * 3));
    total += row;
  }
  return { mean: total / (w * h * 3), rows };
}

/**
 * The design drawn by fabric straight, as the file should look: shaped pictures clipped on
 * the page as the print does (never through fabric's cache), a black-only side in greys.
 */
async function reference(side: Side, m: number, region: { left: number; top: number; width: number; height: number }) {
  const scene = new StaticCanvas(document.createElement('canvas'), { width: 1, height: 1, enableRetinaScaling: false, renderOnAddRemove: false });
  scene.on('before:render', ({ ctx }) => {
    ctx.imageSmoothingQuality = 'high';
  });
  await scene.loadFromJSON(side.json);
  scene.getObjects().forEach((o) => {
    o.objectCaching = false;
  });
  scene.getObjects().forEach(clipOnThePage);
  const out = scene.toCanvasElement(m, region);
  void scene.dispose();
  if (side.grey) toGreys(out);
  return out;
}

async function pdfRegion(page: pdfjs.PDFPageProxy, scale: number, x: number, y: number, w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const viewport = page.getViewport({ scale, offsetX: -x, offsetY: -y });
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return canvas;
}

(window as unknown as { runCase: (name: string) => Promise<unknown> }).runCase = async (name: string) => {
  const all = await cases();
  const c = all[name];
  const spec = printSpecFor({ kind: c.kind, trimMm: c.trimMm });
  await ensureFontFamilies(['RX Montserrat', 'RX Lora', 'RX Playfair Display', 'RX Inter']);
  const t0 = performance.now();
  const result = await makePrintPdf({
    sides: c.sides,
    trimMm: c.trimMm,
    spec,
    unitsPerMm: U,
    fileName: (dpi, pages) => `${name}_${dpi}dpi_${pages}p.pdf`,
  });
  const ms = Math.round(performance.now() - t0);
  const data = new Uint8Array(await result.file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
  const checks: Array<{ side: SideId; whole: number; seams: Array<{ at: string; seamRow: number; elsewhere: number }> }> = [];
  let sharpness: { ref: number; pdf: number } | null = null;
  let mostChroma: number | null = null;
  for (let n = 1; n <= doc.numPages; n += 1) {
    const side = c.sides[n - 1];
    const page = await doc.getPage(n);
    // The whole page at about 500 px tall.
    const boardW = (c.trimMm.wMm + 2 * spec.bleedMm) * U;
    const boardH = (c.trimMm.hMm + 2 * spec.bleedMm) * U;
    const m = 500 / boardH;
    const ref = await reference(side, m, { left: 0, top: 0, width: boardW, height: boardH });
    const viaPdf = await pdfRegion(page, (ref.height / page.view[3]), 0, 0, ref.width, ref.height);
    const whole = diff(ref, viaPdf).mean;
    // Every horizontal seam, at the file's own resolution: 160 px across, 64 rows each side.
    const mFile = result.dpi / 25.4 / U;
    const scaleFile = result.dpi / 72;
    const { w: pw, h: ph } = pagePixels(c.trimMm, spec.bleedMm, result.dpi);
    const plan = tilePlan(pw, ph);
    const seamYs = [...new Set(plan.map((t) => t.y).filter((y) => y > 0))];
    const seamXs = [...new Set(plan.map((t) => t.x).filter((x) => x > 0))];
    const seams: Array<{ at: string; seamRow: number; elsewhere: number }> = [];
    for (const y of seamYs.slice(0, 4)) {
      const x0 = Math.floor(pw / 3);
      const refCrop = await reference(side, mFile, { left: x0 / mFile, top: (y - 64) / mFile, width: 160 / mFile, height: 128 / mFile });
      const pdfCrop = await pdfRegion(page, scaleFile, x0, y - 64, refCrop.width, refCrop.height);
      const d = diff(refCrop, pdfCrop);
      const near = Math.max(d.rows[63], d.rows[64]);
      const far = d.rows.filter((_, i) => i < 56 || i > 72);
      seams.push({ at: `y=${y}`, seamRow: Math.round(near * 10) / 10, elsewhere: Math.round((far.reduce((s, v) => s + v, 0) / far.length) * 10) / 10 });
      refCrop.width = 0;
      pdfCrop.width = 0;
    }
    for (const x of seamXs.slice(0, 2)) {
      const y0 = Math.floor(ph / 3);
      const refCrop = await reference(side, mFile, { left: (x - 64) / mFile, top: y0 / mFile, width: 128 / mFile, height: 160 / mFile });
      const pdfCrop = await pdfRegion(page, scaleFile, x - 64, y0, refCrop.width, refCrop.height);
      // A vertical seam: compare columns by transposing the row test into one column pair.
      const ctxA = refCrop.getContext('2d')!.getImageData(0, 0, refCrop.width, refCrop.height).data;
      const ctxB = pdfCrop.getContext('2d')!.getImageData(0, 0, refCrop.width, refCrop.height).data;
      const col = (cx: number) => {
        let s = 0;
        for (let yy = 0; yy < refCrop.height; yy += 1) {
          const i = (yy * refCrop.width + cx) * 4;
          s += Math.abs(ctxA[i] - ctxB[i]) + Math.abs(ctxA[i + 1] - ctxB[i + 1]) + Math.abs(ctxA[i + 2] - ctxB[i + 2]);
        }
        return s / (refCrop.height * 3);
      };
      const cols = Array.from({ length: refCrop.width }, (_, i) => col(i));
      const far = cols.filter((_, i) => i < 56 || i > 72);
      seams.push({ at: `x=${x}`, seamRow: Math.round(Math.max(cols[63], cols[64]) * 10) / 10, elsewhere: Math.round((far.reduce((s, v) => s + v, 0) / far.length) * 10) / 10 });
      refCrop.width = 0;
      pdfCrop.width = 0;
    }
    checks.push({ side: side.id, whole: Math.round(whole * 10) / 10, seams });
    // A close look at the file's own resolution: as sharp as the design itself?
    if (c.closeUp) {
      const box = 240;
      const left = c.closeUp.x * mFile - box / 2;
      const top = c.closeUp.y * mFile - box / 2;
      // Against the picture WITHOUT its clip, which fabric never caches — not against the
      // same code the print uses, which would be blurred in the same way if it broke.
      const refCrop = await reference(c.refSides?.[n - 1] ?? side, mFile, { left: left / mFile, top: top / mFile, width: box / mFile, height: box / mFile });
      const pdfCrop = await pdfRegion(page, scaleFile, left, top, refCrop.width, refCrop.height);
      sharpness = { ref: Math.round(contrast(refCrop) * 10) / 10, pdf: Math.round(contrast(pdfCrop) * 10) / 10 };
      refCrop.width = 0;
      pdfCrop.width = 0;
    }
    if (c.sides[n - 1].grey) mostChroma = Math.max(mostChroma ?? 0, chroma(viaPdf));
    ref.width = 0;
    viaPdf.width = 0;
  }
  await fetch(`/upload?name=${encodeURIComponent(result.file.name)}`, { method: 'POST', body: result.file });
  return {
    name,
    ms,
    dpi: result.dpi,
    quality: result.jpegQuality,
    targetDpi: spec.targetDpi,
    minDpi: spec.minDpi,
    bytes: result.bytes,
    pages: doc.numPages,
    file: result.file.name,
    blankSides: result.blankSides,
    previews: result.previews.map((p) => [p.id, p.file.size]),
    tiles: tilePlan(...Object.values(pagePixels(c.trimMm, spec.bleedMm, result.dpi)) as [number, number]).length,
    checks,
    sharpness,
    mostChroma,
    previewChroma: await Promise.all(
      result.previews.map(async (p) => {
        const bitmap = await createImageBitmap(p.file);
        const cv = document.createElement('canvas');
        cv.width = bitmap.width;
        cv.height = bitmap.height;
        cv.getContext('2d')!.drawImage(bitmap, 0, 0);
        bitmap.close();
        const v = chroma(cv);
        cv.width = 0;
        return v;
      }),
    ),
  };
};
document.getElementById('state')!.textContent = 'ready';
