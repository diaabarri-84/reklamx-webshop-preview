/**
 * THE PRINT PDF — two-sided and large designs (designer v2).
 *
 * The same rules as the round-16 file (exportDesign.ts) — a fresh scene with the
 * object cache OFF (fabric's ~2 MP cache would be upscaled into the print), photos
 * scaled at HIGH quality, every object counted back after loading (fabric drops a
 * picture that fails, without a word) — plus what size and sides need:
 *
 *  - TILES. A roll-up at 150 dpi is ~60 MP: no phone holds that in one canvas.
 *    The page is cut into tiles of at most 4096 px a side and 8 MP
 *    (src/lib/printSpec.ts tilePlan), rendered ONE AT A TIME from the scene with an
 *    offset, encoded, and the canvas released before the next. Each tile is checked:
 *    exact size, and not transparent (a canvas the browser could not allocate comes
 *    back empty, which would print as a white hole).
 *  - JPEG ONLY WHERE THERE IS A PHOTO. A tile crossing a picture is JPEG 0.92; a
 *    flat one is zlib-deflated RGB (lossless, small for flat colour, and free of
 *    JPEG's 4:2:0 colour smear on small coloured text).
 *  - A BYTE BUDGET. The shop stores files under 50 MB and copies to Google Drive
 *    under 40 MB: the file must stay under 38 MB. The resolution is chosen from a
 *    quick low-resolution trial, then verified while rendering; over the budget,
 *    one step lower, down to the product's floor (his resolution table) — below
 *    that the design is refused with a reason ('too-large'), never sent half-made.
 *  - FONTS FIRST. Every family the design uses must be loaded, or the file is
 *    refused: the browser would silently draw the fallback ('fonts').
 *
 * Returned with the file: a PNG of each side's trim (the preview production, the
 * basket and the order pages show — never the print file itself), and the sides
 * that came out blank (a back left empty is the customer's choice to confirm).
 */
import { Group, StaticCanvas, type FabricObject } from 'fabric';
import { clipOnThePage } from './rxObjects';
import { toGreys } from './inkGreys';
import { MM_TO_PT, writePrintPdf, type PdfPage, type PdfTile } from '../../../lib/pdfWriter';
import { PRINT_FILE_MAX_BYTES, dpiSteps, pagePixels, tilePlan, type PrintSpec, type TileRect } from '../../../lib/printSpec';
import { sideFontFamilies, type SideId } from '../../../lib/designDoc';
import { ensureFontFamilies, isFontFamilyLoaded } from './fonts';

export type PrintFileReason = 'fonts' | 'missing' | 'allocate' | 'size' | 'encode' | 'too-large';

export class PrintFileError extends Error {
  constructor(public readonly reason: PrintFileReason) {
    super(`print file failed: ${reason}`);
  }
}

export interface PrintSideScene {
  id: SideId;
  /** fabric's {version, background, objects} with every picture's src a usable (blob:) URL. */
  json: Record<string, unknown>;
  /** Printed in black or greys only: the file and its picture are made in greys (inkGreys.ts). */
  grey?: boolean;
}

export interface PrintPdfResult {
  file: File;
  previews: Array<{ id: SideId; file: File }>;
  dpi: number;
  /** The JPEG quality photos were saved at (0.92 unless the file had to be made smaller at the floor). */
  jpegQuality: number;
  bytes: number;
  blankSides: SideId[];
}

const JPEG_QUALITY = 0.92;
/**
 * At the product's floor, before refusing: lower JPEG qualities. WebKit's encoder
 * (every iPhone) writes JPEGs 1.4–3.6 times larger than Chromium's at the same quality
 * (measured), and a 0.7 JPEG still prints a roll-up photo well from a metre away.
 * Flat tiles are lossless whatever this says.
 */
const FLOOR_QUALITIES = [0.85, 0.78, 0.7];
const PREVIEW_PX = 800;

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      resolve(null);
    }
  });

const release = (c: HTMLCanvasElement | null) => {
  if (c) {
    c.width = 0;
    c.height = 0;
  }
};

const countJson = (objects: unknown): number =>
  (Array.isArray(objects) ? objects : []).reduce((n: number, o: { objects?: unknown }) => n + 1 + countJson(o?.objects), 0);
const countLoaded = (objects: FabricObject[]): number =>
  objects.reduce((n, o) => n + 1 + (o instanceof Group ? countLoaded(o.getObjects()) : 0), 0);

/** One side, loaded into its own 1×1 scene (the only big canvases are the tiles). */
async function loadScene(side: PrintSideScene): Promise<{ scene: StaticCanvas; host: HTMLCanvasElement; photos: Array<{ l: number; t: number; r: number; b: number }> }> {
  const host = document.createElement('canvas');
  const scene = new StaticCanvas(host, { width: 1, height: 1, enableRetinaScaling: false, renderOnAddRemove: false });
  scene.on('before:render', ({ ctx }) => {
    ctx.imageSmoothingQuality = 'high';
  });
  await scene.loadFromJSON(side.json);
  if (countLoaded(scene.getObjects()) !== countJson((side.json as { objects?: unknown }).objects)) {
    void scene.dispose();
    throw new PrintFileError('missing');
  }
  const uncached = (o: FabricObject) => {
    o.objectCaching = false;
    if (o instanceof Group) o.getObjects().forEach(uncached);
  };
  scene.getObjects().forEach(uncached);
  // Shaped pictures clipped on the page, at the file's resolution — never through
  // fabric's 2 MP cache (rxObjects.ts clipOnThePage).
  scene.getObjects().forEach(clipOnThePage);
  // Where the photos are, in board units: a tile crossing one is a JPEG.
  const photos = scene
    .getObjects()
    .filter((o) => o.type === 'image' || o.type === 'Image')
    .map((o) => {
      const b = o.getBoundingRect();
      return { l: b.left, t: b.top, r: b.left + b.width, b: b.top + b.height };
    });
  return { scene, host, photos };
}

async function deflateRgb(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof CompressionStream === 'undefined') return null;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = new Uint8Array(canvas.width * canvas.height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4) {
    rgb[j++] = data[i];
    rgb[j++] = data[i + 1];
    rgb[j++] = data[i + 2];
  }
  try {
    const stream = new Blob([rgb]).stream().pipeThrough(new CompressionStream('deflate'));
    return await new Response(stream).blob();
  } catch {
    return null;
  }
}

/** A tile the browser could not allocate comes back transparent. */
function looksUnallocated(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  const points: Array<[number, number]> = [
    [0, 0],
    [canvas.width - 1, canvas.height - 1],
    [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)],
  ];
  return points.some(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] === 0);
}

/** No ink at all on a preview (the same test as the round-16 file). */
function looksBlank(source: HTMLCanvasElement): boolean {
  const n = 128;
  const probe = document.createElement('canvas');
  probe.width = n;
  probe.height = n;
  const ctx = probe.getContext('2d');
  if (!ctx) return false;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, n, n);
  const { data } = ctx.getImageData(0, 0, n, n);
  release(probe);
  for (let i = 0; i < data.length; i += 4) if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) return false;
  return true;
}

interface Loaded {
  id: SideId;
  grey: boolean;
  scene: StaticCanvas;
  host: HTMLCanvasElement;
  photos: Array<{ l: number; t: number; r: number; b: number }>;
}

/**
 * The order tiles are rendered in: spread over the page (0, ½, ¼, ¾, …), so the bytes
 * of the first few predict the whole — a roll-up's flat top would mislead otherwise.
 */
function spreadOrder(n: number): number[] {
  const order: number[] = [];
  const seen = new Set<number>();
  for (let denom = 1; order.length < n; denom *= 2) {
    for (let k = 0; k < denom && order.length < n; k += 1) {
      const i = Math.min(n - 1, Math.floor((n * (2 * k + 1)) / (2 * denom)));
      if (!seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
    }
    if (denom > n * 4) break;
  }
  for (let i = 0; i < n; i += 1) if (!seen.has(i)) order.push(i);
  return order;
}

export async function makePrintPdf(input: {
  sides: PrintSideScene[];
  trimMm: { wMm: number; hMm: number };
  spec: Pick<PrintSpec, 'bleedMm' | 'targetDpi' | 'minDpi'>;
  unitsPerMm: number;
  fileName: (dpi: number, pages: number) => string;
  maxBytes?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<PrintPdfResult> {
  const { trimMm, unitsPerMm: u } = input;
  const bleed = input.spec.bleedMm;
  const maxBytes = input.maxBytes ?? PRINT_FILE_MAX_BYTES;

  // Fonts first: a family the design uses that did not load would print as the fallback.
  const families = input.sides.flatMap((s) => sideFontFamilies(JSON.stringify(s.json)));
  const { failed } = await ensureFontFamilies(families);
  if (failed.length || families.some((f) => !isFontFamilyLoaded(f))) throw new PrintFileError('fonts');

  const loaded: Loaded[] = [];
  try {
    for (const side of input.sides) loaded.push({ id: side.id, grey: side.grey === true, ...(await loadScene(side)) });

    const dpis = dpiSteps(input.spec);
    // The ladder: each resolution at full quality, then — at the floor — lower JPEG qualities.
    const ladder: Array<{ dpi: number; quality: number }> = [
      ...dpis.map((dpi) => ({ dpi, quality: JPEG_QUALITY })),
      ...FLOOR_QUALITIES.map((quality) => ({ dpi: input.spec.minDpi, quality })),
    ];
    // Start at the target; a render that will not fit stops early with a projection
    // of its size, and the next try jumps straight to the rung that should fit.
    let i = 0;
    while (i < ladder.length) {
      const attempt = await renderAtDpi(loaded, ladder[i].dpi, ladder[i].quality, input, maxBytes);
      if ('file' in attempt) return attempt;
      const wanted = ladder[i].dpi * Math.sqrt((maxBytes * 0.85) / attempt.projected);
      let next = i + 1;
      while (next < ladder.length && ladder[next].quality === JPEG_QUALITY && ladder[next].dpi > wanted) next += 1;
      i = next;
    }
    throw new PrintFileError('too-large');
  } finally {
    for (const side of loaded) {
      void side.scene.dispose();
      release(side.host);
    }
  }
}

/** The whole file at one resolution, or null when it went over the byte budget. */
async function renderAtDpi(
  loaded: Loaded[],
  dpi: number,
  quality: number,
  input: Parameters<typeof makePrintPdf>[0],
  maxBytes: number,
): Promise<PrintPdfResult | { projected: number }> {
  const { trimMm, unitsPerMm: u } = input;
  const bleed = input.spec.bleedMm;
  const m = dpi / 25.4 / u; // pixels per board unit
  const { w: pageW, h: pageH } = pagePixels(trimMm, bleed, dpi);
  const plan = tilePlan(pageW, pageH);
  const total = plan.length * loaded.length;
  const pxToPt = 72 / dpi;
  const pages: PdfPage[] = [];
  const totalPx = pageW * pageH * loaded.length;
  const order = spreadOrder(plan.length);
  let bytes = 0;
  let px = 0;
  let done = 0;
  for (const side of loaded) {
    const tiles: PdfTile[] = new Array(plan.length);
    for (const index of order) {
      const t = plan[index];
      const tile = await renderTile(side, t, m, quality);
      bytes += tile.data.size;
      px += t.w * t.h;
      const projected = (bytes / px) * totalPx;
      // Certain to be over, or clearly heading there once enough of the page is seen.
      if (bytes > maxBytes || (px >= totalPx * 0.4 && projected > maxBytes * 1.2)) return { projected: Math.max(projected, bytes) };
      tiles[index] = { ...tile, xPt: t.x * pxToPt, yPt: t.y * pxToPt, wPt: t.w * pxToPt, hPt: t.h * pxToPt };
      done += 1;
      input.onProgress?.(done, total);
    }
    const wPt = (trimMm.wMm + 2 * bleed) * MM_TO_PT;
    const hPt = (trimMm.hMm + 2 * bleed) * MM_TO_PT;
    const b = bleed * MM_TO_PT;
    pages.push({ widthPt: wPt, heightPt: hPt, bleedBox: [0, 0, wPt, hPt], trimBox: [b, b, wPt - b, hPt - b], tiles });
  }
  const pdf = writePrintPdf(pages, { title: input.fileName(dpi, loaded.length) });
  if (pdf.size > maxBytes) return { projected: pdf.size };

  // One preview per side: the TRIM only, about 800 px on its longer side.
  const previews: Array<{ id: SideId; file: File }> = [];
  const blankSides: SideId[] = [];
  for (const side of loaded) {
    const w = trimMm.wMm * u;
    const h = trimMm.hMm * u;
    let small: HTMLCanvasElement | null = null;
    try {
      small = side.scene.toCanvasElement(PREVIEW_PX / Math.max(w, h), { left: bleed * u, top: bleed * u, width: w, height: h });
      if (looksUnallocated(small)) throw new PrintFileError('allocate');
      if (side.grey) toGreys(small);
      if (looksBlank(small)) blankSides.push(side.id);
      const png = await toBlob(small, 'image/png');
      if (!png) throw new PrintFileError('encode');
      previews.push({ id: side.id, file: new File([png], `design-preview-${side.id}.png`, { type: 'image/png' }) });
    } finally {
      release(small);
    }
  }
  return {
    file: new File([pdf], input.fileName(dpi, loaded.length), { type: 'application/pdf' }),
    previews,
    dpi,
    jpegQuality: quality,
    bytes: pdf.size,
    blankSides,
  };
}

async function renderTile(side: Loaded, t: TileRect, m: number, quality: number): Promise<Omit<PdfTile, 'xPt' | 'yPt' | 'wPt' | 'hPt'>> {
  let canvas: HTMLCanvasElement | null = null;
  try {
    try {
      // Half a pixel wider than the tile: the canvas truncates to exactly t.w × t.h.
      canvas = side.scene.toCanvasElement(m, { left: t.x / m, top: t.y / m, width: (t.w + 0.5) / m, height: (t.h + 0.5) / m });
    } catch {
      throw new PrintFileError('allocate');
    }
    if (canvas.width !== t.w || canvas.height !== t.h) throw new PrintFileError('size');
    if (looksUnallocated(canvas)) throw new PrintFileError('allocate');
    if (side.grey) toGreys(canvas);
    const unitL = t.x / m;
    const unitT = t.y / m;
    const unitR = (t.x + t.w) / m;
    const unitB = (t.y + t.h) / m;
    const photo = side.photos.some((p) => p.l < unitR && p.r > unitL && p.t < unitB && p.b > unitT);
    let data = photo ? await toBlob(canvas, 'image/jpeg', quality) : await deflateRgb(canvas);
    let filter: PdfTile['filter'] = photo ? 'DCTDecode' : 'FlateDecode';
    if (!data && !photo) {
      // No CompressionStream (older browsers): a high-quality JPEG rather than nothing.
      data = await toBlob(canvas, 'image/jpeg', 0.95);
      filter = 'DCTDecode';
    }
    if (!data || data.size === 0) throw new PrintFileError('encode');
    return { data, filter, widthPx: t.w, heightPx: t.h };
  } finally {
    release(canvas);
  }
}
