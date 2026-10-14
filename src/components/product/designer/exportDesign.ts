/**
 * THE PRINT FILE — round 16, item 5.
 *
 * The board the customer edits is a few hundred pixels across. The file is up
 * to 16 million (src/lib/designSize.ts). It is drawn from the design itself,
 * not from the screen, with four rules that each stop a ruined job:
 *
 *  - A FRESH CANVAS, WITH THE OBJECT CACHE OFF. fabric normally draws each
 *    object through a cache canvas capped at about 2 MP. Exported at 16 MP, a
 *    big headline or a full-bleed photo would come out upscaled from that cache.
 *    The pixel count would say 300 DPI while the detail was a quarter of it, and
 *    nothing would notice.
 *  - ONE BIG CANVAS. The scene's own canvas is 1 × 1 pixel: toCanvasElement
 *    renders the design ONCE, at the export scale, into the only large canvas.
 *    A scene the size of the board was a second 13-26 MP canvas on A3/A2, and two
 *    big canvases are what a phone runs out of memory on.
 *  - EVERYTHING ON IT, EXACT, AND NOT EMPTY. fabric drops a picture that fails to
 *    load without a word, so the objects drawn are counted against the design.
 *    The canvas must come back at the exact pixel size, the encoder must return a
 *    file, and a design with ink on it must not come back blank. That last one is
 *    how Safari fails when it cannot allocate. Any of these throws, and the
 *    customer is told; an incomplete or blank file is never uploaded.
 *  - PHOTOS SCALED AT HIGH QUALITY. fabric leaves the browser's default ('low'),
 *    which shrinks a 4000-pixel phone photo into 470 pixels by skipping most of
 *    them: aliasing and moiré, baked into the file.
 *  - PNG, unless a photo would make it too big: a 16 MP PNG of a photograph is
 *    30-60 MB, over the bucket's 50 MB, so a photo on a file over 4 MP is a JPEG
 *    at 0.92. A logo on a business card stays a crisp PNG.
 *  - THE RESOLUTION IN THE FILE (src/lib/imageDpi.ts). Without it every program
 *    reads the file at 72 ppi, four times its real size.
 *
 * Also returned: a small picture of the TRIM area only (no bleed), for the size
 * preview on the product page. Decoding the full print file into a 190-pixel box
 * there would cost a phone 64 MB for nothing.
 */
import { Group, StaticCanvas, type FabricObject } from 'fabric';
// The shop's own kinds (pattern, QR, text in capitals): registered before any load.
import { clipOnThePage } from './rxObjects';
import { toGreys } from './inkGreys';
import { designFileName, type DesignExportSize } from '../../../lib/designSize';
import { withJpegDpi, withPngDpi } from '../../../lib/imageDpi';

export class DesignExportError extends Error {
  constructor(public readonly reason: 'allocate' | 'size' | 'encode' | 'blank' | 'missing') {
    super(`design export failed: ${reason}`);
  }
}

/** Above this many pixels, a design with a photo in it is saved as a JPEG. */
const PNG_WITH_PHOTO_MAX_PIXELS = 4_000_000;

export interface DesignExportInput {
  /** canvas.toObject(...) of the board, empty photo frames already taken out. */
  json: Record<string, unknown>;
  /** Board units per millimetre (the board's top-left corner is the file's). */
  unitsPerMm: number;
  trimMm: { wMm: number; hMm: number };
  size: Extract<DesignExportSize, { kind: 'ok' }>;
  hasPhotos: boolean;
  /** Something is on the board (an object, or a background that is not white). */
  inkExpected: boolean;
  /** Printed in black or greys only: the file and its picture are made in greys (inkGreys.ts). */
  grey?: boolean;
}

export interface DesignExportResult {
  file: File;
  preview: File;
  widthPx: number;
  heightPx: number;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      resolve(null);
    }
  });

/**
 * True when a downscaled copy of the file has no ink in it. 256 pixels across,
 * scaled at HIGH quality (which averages every pixel in, where 'low' samples a
 * few and misses a short caption), so even a 2 mm line of text on an A3 poster
 * still shows as grey. A transparent pixel means nothing was drawn at all: the
 * export always paints its background, so that is a failed render, not white.
 */
function looksBlank(source: HTMLCanvasElement): boolean {
  const n = 256;
  const probe = document.createElement('canvas');
  probe.width = n;
  probe.height = n;
  const ctx = probe.getContext('2d');
  if (!ctx) return false;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, n, n);
  const { data } = ctx.getImageData(0, 0, n, n);
  probe.width = 0;
  probe.height = 0;
  let ink = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) return true;
    if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) ink = true;
  }
  return !ink;
}

const countObjects = (objects: unknown): number =>
  (Array.isArray(objects) ? objects : []).reduce(
    (n: number, o: { objects?: unknown }) => n + 1 + countObjects(o?.objects),
    0,
  );

const countLoaded = (objects: FabricObject[]): number =>
  objects.reduce((n, o) => n + 1 + (o instanceof Group ? countLoaded(o.getObjects()) : 0), 0);

/**
 * A small picture of the trim area (the owner's template card, round 16 5b):
 * the same scene and the same checks as the print file, at about `maxPx` across.
 */
export async function renderThumbnail(input: {
  json: Record<string, unknown>;
  unitsPerMm: number;
  trimMm: { wMm: number; hMm: number };
  bleedMm: number;
  maxPx?: number;
}): Promise<Blob> {
  const { unitsPerMm: u, trimMm, bleedMm } = input;
  const host = document.createElement('canvas');
  const scene = new StaticCanvas(host, { width: 1, height: 1, enableRetinaScaling: false, renderOnAddRemove: false });
  scene.on('before:render', ({ ctx }) => {
    ctx.imageSmoothingQuality = 'high';
  });
  let out: HTMLCanvasElement | null = null;
  try {
    await scene.loadFromJSON(input.json);
    if (countLoaded(scene.getObjects()) !== countObjects((input.json as { objects?: unknown }).objects)) {
      throw new DesignExportError('missing');
    }
    const w = trimMm.wMm * u;
    const h = trimMm.hMm * u;
    const m = (input.maxPx ?? 480) / Math.max(w, h);
    out = scene.toCanvasElement(m, { left: bleedMm * u, top: bleedMm * u, width: w, height: h });
    const blob = await toBlob(out, 'image/png');
    if (!blob) throw new DesignExportError('encode');
    return blob;
  } finally {
    if (out) {
      out.width = 0;
      out.height = 0;
    }
    void scene.dispose();
    host.width = 0;
    host.height = 0;
  }
}

export async function exportDesign(input: DesignExportInput): Promise<DesignExportResult> {
  const { size, trimMm } = input;
  const host = document.createElement('canvas');
  const scene = new StaticCanvas(host, {
    width: 1,
    height: 1,
    enableRetinaScaling: false,
    renderOnAddRemove: false,
  });
  // Set on the very context the file is drawn into: renderCanvas fires this
  // with it, after setting imageSmoothingEnabled and before drawing anything.
  scene.on('before:render', ({ ctx }) => {
    ctx.imageSmoothingQuality = 'high';
  });
  let out: HTMLCanvasElement | null = null;
  try {
    await scene.loadFromJSON(input.json);
    // fabric settles each object separately and DROPS one that fails (a
    // picture whose blob would not decode). The file would go out without it.
    if (countLoaded(scene.getObjects()) !== countObjects((input.json as { objects?: unknown }).objects)) {
      throw new DesignExportError('missing');
    }
    const uncached = (o: FabricObject) => {
      o.objectCaching = false;
      if (o instanceof Group) o.getObjects().forEach(uncached);
    };
    scene.getObjects().forEach(uncached);
    // Shaped pictures clipped on the page, at the file's resolution — never through
    // fabric's 2 MP cache (rxObjects.ts clipOnThePage).
    scene.getObjects().forEach(clipOnThePage);

    // Pixels per board unit. The crop is half a pixel wider than the file, so
    // the canvas (which truncates) comes out at exactly widthPx × heightPx.
    const m = size.dpi / 25.4 / input.unitsPerMm;
    try {
      out = scene.toCanvasElement(m, {
        left: 0,
        top: 0,
        width: (size.widthPx + 0.5) / m,
        height: (size.heightPx + 0.5) / m,
      });
    } catch {
      throw new DesignExportError('allocate');
    }
    if (out.width !== size.widthPx || out.height !== size.heightPx) throw new DesignExportError('size');
    if (input.grey) toGreys(out);
    if (input.inkExpected && looksBlank(out)) throw new DesignExportError('blank');

    const type = input.hasPhotos && size.widthPx * size.heightPx > PNG_WITH_PHOTO_MAX_PIXELS ? 'image/jpeg' : 'image/png';
    const encoded = await toBlob(out, type, type === 'image/jpeg' ? 0.92 : undefined);
    if (!encoded || encoded.size === 0) throw new DesignExportError('encode');
    const bytes = new Uint8Array(await encoded.arrayBuffer());
    const tagged = type === 'image/png' ? withPngDpi(bytes, size.dpi) : withJpegDpi(bytes, size.dpi);
    const blob = new Blob([tagged], { type });

    // The preview: the trim area only, at most 480 px across.
    const pxPerMm = size.dpi / 25.4;
    const bleedPx = size.bleedMm * pxPerMm;
    const trimW = trimMm.wMm * pxPerMm;
    const trimH = trimMm.hMm * pxPerMm;
    const k = Math.min(1, 480 / Math.max(trimW, trimH));
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(trimW * k));
    small.height = Math.max(1, Math.round(trimH * k));
    const sctx = small.getContext('2d');
    if (!sctx) throw new DesignExportError('allocate');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(out, bleedPx, bleedPx, trimW, trimH, 0, 0, small.width, small.height);
    const previewBlob = await toBlob(small, 'image/png');
    small.width = 0;
    small.height = 0;
    if (!previewBlob) throw new DesignExportError('encode');

    return {
      file: new File([blob], designFileName(trimMm, size, type), { type }),
      preview: new File([previewBlob], 'design-preview.png', { type: 'image/png' }),
      widthPx: size.widthPx,
      heightPx: size.heightPx,
    };
  } finally {
    // Hand the memory back at once: a phone needs it for the upload.
    if (out) {
      out.width = 0;
      out.height = 0;
    }
    void scene.dispose();
    host.width = 0;
    host.height = 0;
  }
}
