/**
 * DOES THIS FILE FIT THE SIZE THE CUSTOMER CHOSE? — the upload check, round 16.
 *
 * It lived inline in ProductConfigurator.handlePickFile, untested, and it
 * refused files made the way the shop itself asks for them. The dropzone says
 * "Add 3 mm bleed on every side" (ppGuidelineBleed), and then:
 *  - a PDF was measured against the bare trim size at ±2 mm, so an 85 × 55 mm
 *    business card exported at 91 × 61 mm with its bleed was refused as "the
 *    wrong size";
 *  - a picture's proportions were held to the trim within 2 %, which a bleed
 *    only fits on near-square or large items. The same card at 91 × 61 is 3.5 %
 *    off, so it was refused too.
 * A customer who followed the instructions was refused, and one who ignored
 * them got through.
 *
 * Now either is accepted: the trim size, or the trim size with the bleed. The
 * resolution floor is unchanged (150 DPI, ARTWORK_MIN_DPI). A picture passes
 * with the pixels for the reading its proportions match, or for the larger box
 * when they match both. The answer says whether the file carries the bleed, so
 * the line can tell production (fileSpecs.bleedMm) and the preview can crop it.
 * Pure; scripts/test-design.mjs.
 */
import { minPixelsFor } from './artworkLimits.js';

/** What dpiUtils.measureArtworkMm reports about a file. */
export type ArtworkMeasure =
  | { kind: 'pdf'; widthMm: number; heightMm: number }
  | { kind: 'raster'; widthPx: number; heightPx: number }
  | { kind: 'unmeasurable' };

export type ArtworkFit =
  /**
   * `withBleed`: true / false when the file's shape says which it is; null when
   * either could be meant (a square product, or one so large that 6 mm moves the
   * proportions by under 2 %), so nobody can tell from the file alone.
   */
  | { kind: 'ok'; withBleed: boolean | null }
  /** A PDF whose page is neither the trim size nor the trim size with bleed. */
  | { kind: 'size-mismatch' }
  /** A picture whose proportions match neither. */
  | { kind: 'ratio-mismatch' }
  /** The right proportions, too few pixels: at least `minWPx` × `minHPx`. */
  | { kind: 'too-low-res'; minWPx: number; minHPx: number };

export const ARTWORK_BLEED_MM = 3;
const PAGE_TOLERANCE_MM = 2;
const RATIO_TOLERANCE = 0.02;

export function checkArtworkFit(
  measured: ArtworkMeasure,
  trim: { wMm: number; hMm: number },
  { bleedMm = ARTWORK_BLEED_MM }: { bleedMm?: number } = {},
): ArtworkFit {
  const boxes = [
    { wMm: trim.wMm, hMm: trim.hMm, withBleed: false },
    { wMm: trim.wMm + 2 * bleedMm, hMm: trim.hMm + 2 * bleedMm, withBleed: true },
  ];

  if (measured.kind === 'pdf') {
    // A true page size: within ±2 mm per side, turned 90° allowed.
    const near = (w: number, h: number, box: { wMm: number; hMm: number }) =>
      Math.abs(w - box.wMm) <= PAGE_TOLERANCE_MM && Math.abs(h - box.hMm) <= PAGE_TOLERANCE_MM;
    for (const box of boxes) {
      if (near(measured.widthMm, measured.heightMm, box) || near(measured.heightMm, measured.widthMm, box)) {
        return { kind: 'ok', withBleed: box.withBleed };
      }
    }
    return { kind: 'size-mismatch' };
  }

  if (measured.kind === 'raster') {
    const { widthPx, heightPx } = measured;
    const ratioMatches = (wPx: number, hPx: number, box: { wMm: number; hMm: number }) => {
      const target = box.wMm / box.hMm;
      return hPx > 0 && Math.abs(wPx / hPx - target) / target <= RATIO_TOLERANCE;
    };
    // Each reading whose proportions the picture has, with the picture turned to match it.
    const readings = boxes.flatMap((box) => {
      const oriented = ratioMatches(widthPx, heightPx, box)
        ? [widthPx, heightPx]
        : ratioMatches(heightPx, widthPx, box)
          ? [heightPx, widthPx]
          : null;
      return oriented ? [{ box, w: oriented[0], h: oriented[1] }] : [];
    });
    if (readings.length === 0) return { kind: 'ratio-mismatch' };
    // When BOTH fit (square, or large), the file may well carry the bleed, so it
    // must have the pixels for the larger box. A 50 mm sticker file of 296 px
    // with its bleed would otherwise print at 134 DPI, under the floor. The
    // dropzone quotes the larger number too, so nobody is asked for one figure
    // and held to another.
    const demand = readings[readings.length - 1];
    const minWPx = minPixelsFor(demand.box.wMm);
    const minHPx = minPixelsFor(demand.box.hMm);
    if (demand.w < minWPx || demand.h < minHPx) return { kind: 'too-low-res', minWPx, minHPx };
    return { kind: 'ok', withBleed: readings.length > 1 ? null : demand.box.withBleed };
  }

  // SVG, EPS, AI, PSD or anything undecodable: accepted, as it always was.
  return { kind: 'ok', withBleed: false };
}
