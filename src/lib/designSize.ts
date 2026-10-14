/**
 * HOW BIG A FILE THE ONLINE DESIGNER MAKES — round 16, item 5.
 *
 * "Use this design" exports ONE raster: the product's trim size plus a 3 mm
 * bleed on every side, which is what the shop's own guideline asks of every
 * customer file ("Add 3 mm bleed on every side and keep text 3 mm inside the
 * trim"). The background runs into the bleed, so a cut that wanders by a
 * millimetre leaves colour at the edge instead of a white sliver.
 *
 * 300 DPI where the browser can hold it, less on a big product, and never below
 * the 150 DPI the shop accepts from any customer file (ARTWORK_MIN_DPI). A size
 * that cannot reach 150 within the limit is refused up front. The customer is
 * told to upload a file or choose the design service, rather than spending an
 * hour on a design nobody can export.
 *
 * THE LIMIT IS THE BROWSER'S, not the printer's. Safari on an iPhone will not
 * allocate a canvas over 16 777 216 pixels, and its canvases share one memory
 * budget with the board the customer is editing on. A canvas it cannot allocate
 * draws NOTHING, and an empty white file would be uploaded as the artwork. So
 * there is one cap, a little under that, for every device: an A2 poster at about
 * 200 DPI is the largest thing the designer makes. Pure; scripts/test-design.mjs.
 */
import { ARTWORK_MIN_DPI } from './artworkLimits.js';

export const DESIGN_TARGET_DPI = 300;
/** The floor every customer file is held to — the designer's file too. */
export const DESIGN_MIN_DPI = ARTWORK_MIN_DPI;
/** One canvas, every device: under iOS Safari's 16 777 216-pixel ceiling. */
export const DESIGN_MAX_PIXELS = 16_000_000;
/** No side longer than this, whatever the area (a 2 m strip). */
export const DESIGN_MAX_SIDE_PX = 8192;
/** iOS Safari's own ceiling for one canvas: 4096 × 4096 pixels. */
export const CANVAS_MAX_PIXELS = 16_777_216;
/** The shop's own bleed, on every side. */
export const DESIGN_BLEED_MM = 3;

export type DesignExportSize =
  | {
      kind: 'ok';
      dpi: number;
      widthPx: number;
      heightPx: number;
      bleedMm: number;
      /** The whole file in millimetres: trim + bleed on both sides. */
      wMm: number;
      hMm: number;
    }
  /** No usable size was given (none chosen yet, or one that cannot be measured). */
  | { kind: 'no-size' }
  /** Even 150 DPI would not fit the browser; `maxDpi` is what would. */
  | { kind: 'too-large'; maxDpi: number };

const MM_PER_INCH = 25.4;

/**
 * Pixels across `mm` at `dpi`, rounded UP. This is the same rounding as
 * minPixelsFor, so the file is never one pixel short of the floor it is
 * measured against. The epsilon keeps an exact 591.0000000001 at 591.
 */
export function pixelsFor(mm: number, dpi: number): number {
  return Math.ceil((mm / MM_PER_INCH) * dpi - 1e-9);
}

export function designExportSize(
  trim: { wMm: number; hMm: number } | null | undefined,
  {
    bleedMm = DESIGN_BLEED_MM,
    targetDpi = DESIGN_TARGET_DPI,
    minDpi = DESIGN_MIN_DPI,
  }: { bleedMm?: number; targetDpi?: number; minDpi?: number } = {},
): DesignExportSize {
  const w = Number(trim?.wMm);
  const h = Number(trim?.hMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { kind: 'no-size' };
  const b = Math.max(0, Number(bleedMm) || 0);
  const W = w + 2 * b;
  const H = h + 2 * b;
  const fits = (dpi: number) => {
    const pw = pixelsFor(W, dpi);
    const ph = pixelsFor(H, dpi);
    return pw * ph <= DESIGN_MAX_PIXELS && Math.max(pw, ph) <= DESIGN_MAX_SIDE_PX;
  };
  // The highest whole DPI within both limits: the closed form, then stepped
  // down past the rounding up of each side.
  const maxDpi = Math.floor(Math.min(
    Math.sqrt(DESIGN_MAX_PIXELS / ((W / MM_PER_INCH) * (H / MM_PER_INCH))),
    DESIGN_MAX_SIDE_PX / (Math.max(W, H) / MM_PER_INCH),
  ));
  let dpi = Math.min(targetDpi, maxDpi);
  while (dpi >= minDpi && !fits(dpi)) dpi -= 1;
  if (dpi < minDpi) return { kind: 'too-large', maxDpi: Math.max(0, Math.min(maxDpi, minDpi - 1)) };
  return { kind: 'ok', dpi, widthPx: pixelsFor(W, dpi), heightPx: pixelsFor(H, dpi), bleedMm: b, wMm: W, hMm: H };
}

/**
 * The resolution a picture prints at: its own pixels across the width it was
 * placed at. A 640-pixel phone photo stretched across an A3 poster is 54 DPI.
 * The file around it would still be 200 DPI, and production could not tell.
 */
export function effectiveDpi(naturalPx: number, placedMm: number): number {
  if (!(naturalPx > 0) || !(placedMm > 0)) return 0;
  return naturalPx / (placedMm / MM_PER_INCH);
}

/**
 * HOW FAR A CUSTOMER'S PICTURE IS CUT DOWN on the way into the designer: to `maxSide` px
 * on its long side AND `maxPixels` in all — by default 8192 px and 16 777 216 pixels,
 * the most one canvas holds on an iPhone (its colour edits are drawn on one). The long
 * side alone, at 4096, cut a 24 MP camera photo to 4096 × 2731: about 150 DPI across a
 * 70 cm poster, marked poor where the photo itself was fine (code review DSN-06). By its
 * area it keeps 5016 × 3344 — on a computer (pictureLimits). 1 when it fits as it is.
 */
export function pictureScale(w: number, h: number, maxSide = DESIGN_MAX_SIDE_PX, maxPixels = CANVAS_MAX_PIXELS): number {
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.min(1, maxSide / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
}

/** The device a customer's picture comes in on: a phone or a tablet (a finger first), or a computer. */
export type PictureDevice = 'touch' | 'desktop';

/** The long side a picture is cut to on a phone or a tablet: the cap before DSN-06, kept there. */
export const TOUCH_MAX_PICTURE_SIDE = 4096;

/**
 * THE CUT BY DEVICE (second pass, a watch on DSN-06). By area on a computer, as above.
 * Not on a phone or a tablet: there every full-size copy the designer holds of a picture
 * — the one on the board, its colour edit, the 3D view's, the print file's — grows by
 * half again, and a 2–3 GB iPhone runs out of memory. There it stays 4096 px on the long
 * side, as it was. The caller says which device it is (studioObjects.ts pictureDevice);
 * pure, so both are tested (scripts/test-design.mjs).
 */
export function pictureLimits(device: PictureDevice): { maxSide: number; maxPixels: number } {
  return device === 'touch'
    ? { maxSide: TOUCH_MAX_PICTURE_SIDE, maxPixels: CANVAS_MAX_PIXELS }
    : { maxSide: DESIGN_MAX_SIDE_PX, maxPixels: CANVAS_MAX_PIXELS };
}

/** A picture's pixels once cut down by `k`: rounded DOWN, so it never passes either limit. */
export function scaledPictureSize(w: number, h: number, k: number): { width: number; height: number } {
  if (k >= 1) return { width: w, height: h };
  return { width: Math.max(1, Math.floor(w * k)), height: Math.max(1, Math.floor(h * k)) };
}

/**
 * An object's new size from one side typed in mm (the studio's W × H box): the other
 * side follows when the proportions are kept, and stays exactly as it is when not. The
 * side typed is held between `min` and `max`; neither side ever passes `max`; with the
 * proportions kept, both move together, so they never bend to fit.
 *
 * NEVER THE OTHER WAY: asked to shrink, nothing grows, and the reverse. A thin rule of
 * 100 × 0.5 mm typed 50 wide came out 200 × 1 — its thin side pushed up to the least
 * size, its length with it (code review, second pass #4). So a side that FOLLOWS is
 * held at `min` only when it was at least that already; a side already thinner (a
 * rule, a hairline) follows in proportion, 50 × 0.25. A limit that could only be met
 * by moving the wrong way leaves the size as it is. A side with no size at all (a
 * line's height) stays none: only the other can be typed.
 */
export function typedSizeMm(
  now: { w: number; h: number },
  side: 'w' | 'h',
  mm: number,
  keepRatio: boolean,
  { min, max }: { min: number; max: number },
): { w: number; h: number } {
  const typed = now[side];
  const other = now[side === 'w' ? 'h' : 'w'];
  if (!(typed > 0) || !(mm > 0)) return { w: now.w, h: now.h };
  // Held to the limits, then never past "as it is" the wrong way.
  const towards = (asked: number, held: number, as: number) => (asked < as ? Math.min(held, as) : asked > as ? Math.max(held, as) : as);
  if (!keepRatio) {
    const next = towards(mm, Math.min(max, Math.max(min, mm)), typed);
    return side === 'w' ? { w: next, h: now.h } : { w: now.w, h: next };
  }
  const asked = mm / typed;
  const least = Math.max(min / typed, other >= min ? min / other : 0);
  const most = max / Math.max(typed, other);
  // Too thin to reach the least size without passing the largest: the largest wins.
  const k = towards(asked, Math.min(most, Math.max(least, asked)), 1);
  return { w: now.w * k, h: now.h * k };
}

/** At or above this a photo prints sharp; between it and the floor, acceptably. */
export const IMAGE_DPI_GOOD = 250;

export type ImageQuality = 'good' | 'fair' | 'poor';

/**
 * How a photo will print. Given the product's own resolutions (designer v2: his table
 * by size, or his value for the product), it is judged against THOSE — a fixed 150/250
 * marked a 120 dpi photo on a roll-up (floor 100) as blurred, and passed 160 where he
 * set 300 as the floor: under his floor it is poor, near his target (5/6 of it) good.
 */
export function imageQuality(dpi: number, spec?: { minDpi: number; targetDpi: number } | null): ImageQuality {
  if (spec && spec.minDpi > 0 && spec.targetDpi > 0) {
    if (dpi >= (spec.targetDpi * 5) / 6) return 'good';
    return dpi >= spec.minDpi ? 'fair' : 'poor';
  }
  if (dpi >= IMAGE_DPI_GOOD) return 'good';
  return dpi >= DESIGN_MIN_DPI ? 'fair' : 'poor';
}

/** 85 → "85", 85.5 → "85.5": a size as it reads in a file name. */
const mmText = (mm: number) => String(Math.round(mm * 10) / 10);

/**
 * What production sees on the job sheet ("Artwork file: …"):
 * online-design_50x50mm_300dpi_bleed3mm.png. The size, the resolution and the
 * bleed are all in the name, so nobody has to open the file to know how to
 * place it.
 */
export function designFileName(
  trim: { wMm: number; hMm: number },
  size: { dpi: number; bleedMm: number },
  type: 'image/png' | 'image/jpeg',
): string {
  const bleed = size.bleedMm > 0 ? `_bleed${mmText(size.bleedMm)}mm` : '';
  return `online-design_${mmText(trim.wMm)}x${mmText(trim.hMm)}mm_${size.dpi}dpi${bleed}.${type === 'image/png' ? 'png' : 'jpg'}`;
}

/**
 * The name of a designer PDF (designer v2: two sides, or a size too large for one
 * picture): online-design_850x2000mm_150dpi_bleed3mm_2pages.pdf — size, resolution,
 * bleed and pages in the name, as for the picture files.
 */
export function designPdfFileName(trim: { wMm: number; hMm: number }, size: { dpi: number; bleedMm: number; pages: number }): string {
  const bleed = size.bleedMm > 0 ? `_bleed${mmText(size.bleedMm)}mm` : '';
  const pages = size.pages > 1 ? `_${size.pages}pages` : '';
  return `online-design_${mmText(trim.wMm)}x${mmText(trim.hMm)}mm_${size.dpi}dpi${bleed}${pages}.pdf`;
}
