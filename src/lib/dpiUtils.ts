import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { chooseArtworkBox, readPageBoxes, type ChosenArtworkBox } from './pdfBoxes';

// Ensure PDF.js worker is configured in browser environment
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface DpiAnalysisResult {
  dpi: number | null;
  isLowDpi: boolean; // true if dpi < 300
  qualityLabel: 'excellent' | 'acceptable' | 'low' | 'vector' | 'unknown';
  naturalWidthPx: number;
  naturalHeightPx: number;
  targetWidthCm: number;
  targetWidthInches: number;
  recommendedWidthPx: number;
  fileType: string;
  isVector: boolean;
  analyzable: boolean;
  message: string;
  /**
   * Height ÷ width of the PRINTED area when the PDF says where it is (its
   * TrimBox — a PDF/X with crop marks): the per-metre page sets the length, and
   * so the price, from this rather than from a page that includes the slug.
   */
  aspect?: number;
  /** That TrimBox and the page around it, in mm — production must place the file by it (fileSpecs.placeBy). */
  trim?: { widthMm: number; heightMm: number; pageWidthMm: number; pageHeightMm: number };
}

/** One PDF point = 1/72 inch = 25.4/72 mm. */
const PT_TO_MM = 25.4 / 72;

/**
 * What could be physically measured about an uploaded artwork file:
 *  - PDFs carry a true page size, reported in millimetres (first page,
 *    rotation-applied via pdf.js viewport, points × 25.4/72);
 *  - raster images carry only pixels, reported as natural width/height;
 *  - everything else (SVG/EPS/AI/PSD, undecodable files) is unmeasurable —
 *    callers should skip size validation rather than reject.
 */
export type ArtworkMeasurement =
  /**
   * `widthMm`/`heightMm`: the PAGE, as always. `readBox`: the file's own TrimBox
   * (or BleedBox) when it has one smaller than the page — a PDF/X exported with
   * crop marks (src/lib/pdfBoxes.ts). The page is checked first, as before, and
   * the box is read ONLY when the page is refused: reading it means the file's
   * bytes a second time, and most files never need it.
   */
  | { kind: 'pdf'; widthMm: number; heightMm: number; readBox?: () => Promise<ChosenArtworkBox | null> }
  | { kind: 'raster'; widthPx: number; heightPx: number }
  | { kind: 'unmeasurable' };

export async function measureArtworkMm(file: File): Promise<ArtworkMeasurement> {
  const fileExt = file.name.split('.').pop()?.toLowerCase() || '';

  if (fileExt === 'pdf') {
    try {
      const page = await pdfPage(file);
      return { kind: 'pdf', widthMm: page.widthMm, heightMm: page.heightMm, readBox: () => pdfArtworkBox(file, page) };
    } catch {
      return { kind: 'unmeasurable' };
    }
  }

  // Vector/layered formats without a browser-readable physical size.
  if (['svg', 'eps', 'ai', 'psd'].includes(fileExt)) {
    return { kind: 'unmeasurable' };
  }

  // Raster images: pixels are all they truly carry.
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ kind: 'raster', widthPx: img.naturalWidth, heightPx: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ kind: 'unmeasurable' });
    };
    img.src = objectUrl;
  });
}

/** What pdf.js says about page 1 — and nothing kept open: the worker is destroyed at once. */
async function pdfPage(file: File): Promise<{
  widthMm: number;
  heightMm: number;
  view: number[];
  ref: { num: number; gen: number } | null;
  rotate: number;
  userUnit: number;
}> {
  // getDocument hands the buffer to its worker, and every call makes a new one:
  // picking a 50 MB file twice on a phone piled them up. Read what is needed, destroy.
  const task = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
  try {
    const doc = await task.promise;
    const p = await doc.getPage(1);
    const viewport = p.getViewport({ scale: 1.0 });
    return {
      widthMm: viewport.width * PT_TO_MM,
      heightMm: viewport.height * PT_TO_MM,
      view: [...(p.view as number[])],
      ref: (p as any).ref ?? null,
      rotate: Number(p.rotate) || 0,
      userUnit: Number((p as any).userUnit) || 1,
    };
  } finally {
    // Awaited: the box may be read from the file next, and pdf.js's copy must be gone first.
    await task.destroy().catch(() => {});
  }
}

/**
 * The file's own TrimBox (or BleedBox) when it is smaller than its page — or null,
 * and the page is measured exactly as before. Read from the file's bytes AFTER
 * pdf.js has let go of its copy, so a 50 MB file is never held twice.
 */
async function pdfArtworkBox(
  file: File,
  page: { view: number[]; ref: { num: number; gen: number } | null; rotate: number; userUnit: number },
): Promise<ChosenArtworkBox | null> {
  try {
    const boxes = await readPageBoxes(new Uint8Array(await file.arrayBuffer()), page.ref, page.view);
    if (!boxes) return null;
    const chosen = chooseArtworkBox({ view: page.view, trim: boxes.trim, bleed: boxes.bleed, userUnit: page.userUnit, rotate: page.rotate });
    return chosen.source === 'page' ? null : chosen;
  } catch {
    return null;
  }
}

/**
 * Calculates resolution (DPI) for a given file relative to the target physical print width in cm.
 * Target print density formula: DPI = Pixel Width / (Print Width in cm / 2.54)
 */
export async function analyzeFileDpi(
  file: File,
  targetWidthCm: number
): Promise<DpiAnalysisResult> {
  const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
  const targetInches = targetWidthCm / 2.54;
  const recommendedPx = Math.round(targetInches * 300); // 300 DPI target

  // 1. Vector SVG Files — DPI does not apply, pixel dimensions are not invented
  if (fileExt === 'svg') {
    return {
      dpi: null,
      isLowDpi: false,
      qualityLabel: 'vector',
      naturalWidthPx: 0,
      naturalHeightPx: 0,
      targetWidthCm,
      targetWidthInches: targetInches,
      recommendedWidthPx: recommendedPx,
      fileType: 'SVG',
      isVector: true,
      analyzable: true,
      message: 'Vector SVG file detected. Scalable to any size; DPI does not apply.'
    };
  }

  // 2. PDF Files - Read metadata & embedded image XObjects via pdfjs-dist
  if (fileExt === 'pdf') {
    // Let go on the failure path too: a PDF pdf.js cannot read kept its worker.
    let failedTask: { destroy: () => Promise<void> } | null = null;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      failedTask = loadingTask;
      const pdfDoc = await loadingTask.promise;
      const firstPage = await pdfDoc.getPage(1);

      const viewport = firstPage.getViewport({ scale: 1.0 });
      const ptsWidth = viewport.width;
      const ptsHeight = viewport.height;
      const pageInfo = {
        view: [...(firstPage.view as number[])],
        ref: (firstPage as any).ref ?? null,
        rotate: Number(firstPage.rotate) || 0,
        userUnit: Number((firstPage as any).userUnit) || 1,
      };

      // Extract image XObjects from operator list to find actual raster resolution
      let maxRasterWidthPx = 0;
      let maxRasterHeightPx = 0;
      let hasRasterImages = false;

      try {
        const operatorList = await firstPage.getOperatorList();
        const validFnTypes = [
          pdfjsLib.OPS?.paintImageXObject,
          pdfjsLib.OPS?.paintInlineImageXObject,
          pdfjsLib.OPS?.paintImageXObjectRepeat
        ].filter(Boolean);

        for (let i = 0; i < operatorList.fnArray.length; i++) {
          if (validFnTypes.includes(operatorList.fnArray[i])) {
            const imgName = operatorList.argsArray[i]?.[0];
            if (imgName && firstPage.objs) {
              try {
                const imgData = await new Promise<any>((resolve) => {
                  firstPage.objs.get(imgName, (obj: any) => resolve(obj));
                });
                if (imgData && imgData.width) {
                  hasRasterImages = true;
                  if (imgData.width > maxRasterWidthPx) {
                    maxRasterWidthPx = imgData.width;
                    maxRasterHeightPx = imgData.height || Math.round(imgData.width * (ptsHeight / ptsWidth));
                  }
                }
              } catch {
                // Ignore single object resolution error
              }
            }
          }
        }
      } catch {
        // Fallback if operator list inspection fails
      }

      // The printed area's proportions, when the file states its TrimBox (only
      // then: a scan on an A4 page keeps today's reading). pdf.js is let go first.
      await loadingTask.destroy().catch(() => {});
      failedTask = null;
      const trimBox = await pdfArtworkBox(file, pageInfo);
      const byTrim = trimBox && trimBox.source === 'trimbox' && trimBox.widthMm > 0 ? trimBox : null;
      const aspect = byTrim ? byTrim.heightMm / byTrim.widthMm : undefined;
      const trim = byTrim
        ? { widthMm: byTrim.widthMm, heightMm: byTrim.heightMm, pageWidthMm: byTrim.pageWidthMm, pageHeightMm: byTrim.pageHeightMm }
        : undefined;

      // Vector-only PDF (or uninspectable raster): DPI does not apply — report
      // the true page aspect via the point dimensions, never a manufactured DPI
      if (!hasRasterImages || maxRasterWidthPx === 0) {
        return {
          ...(aspect ? { aspect, trim } : {}),
          dpi: null,
          isLowDpi: false,
          qualityLabel: 'vector',
          naturalWidthPx: Math.round(ptsWidth),
          naturalHeightPx: Math.round(ptsHeight),
          targetWidthCm,
          targetWidthInches: targetInches,
          recommendedWidthPx: recommendedPx,
          fileType: 'PDF',
          isVector: true,
          analyzable: true,
          message: 'Vector PDF detected. Scalable to any size; DPI does not apply.'
        };
      }

      const calculatedDpi = Math.round(maxRasterWidthPx / targetInches);
      const isLow = calculatedDpi < 300;

      return {
        ...(aspect ? { aspect, trim } : {}),
        dpi: calculatedDpi,
        isLowDpi: isLow,
        qualityLabel: calculatedDpi >= 300 ? 'excellent' : calculatedDpi >= 200 ? 'acceptable' : 'low',
        naturalWidthPx: maxRasterWidthPx,
        naturalHeightPx: maxRasterHeightPx,
        targetWidthCm,
        targetWidthInches: targetInches,
        recommendedWidthPx: recommendedPx,
        fileType: 'PDF',
        isVector: false,
        analyzable: true,
        message: isLow
          ? `PDF resolution is ${calculatedDpi} DPI for a ${targetWidthCm} cm print. Recommended resolution is 300 DPI (${recommendedPx} px wide).`
          : `PDF resolution is optimal at ${calculatedDpi} DPI for a ${targetWidthCm} cm print.`
      };

    } catch (err) {
      await failedTask?.destroy().catch(() => {});
      console.warn('PDF metadata parsing failed — resolution not analyzable:', err);
      return {
        dpi: null,
        isLowDpi: false,
        qualityLabel: 'unknown',
        naturalWidthPx: 0,
        naturalHeightPx: 0,
        targetWidthCm,
        targetWidthInches: targetInches,
        recommendedWidthPx: recommendedPx,
        fileType: 'PDF',
        isVector: false,
        analyzable: false,
        message: 'The PDF could not be parsed, so its print resolution could not be analyzed.'
      };
    }
  }

  // 3. Raster Image Files (PNG, JPG, JPEG, WEBP, TIFF, etc.)
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.src = objectUrl;

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const widthPx = img.naturalWidth;
      const heightPx = img.naturalHeight;
      const calculatedDpi = Math.round(widthPx / targetInches);
      const isLow = calculatedDpi < 300;

      resolve({
        dpi: calculatedDpi,
        isLowDpi: isLow,
        qualityLabel: calculatedDpi >= 300 ? 'excellent' : calculatedDpi >= 200 ? 'acceptable' : 'low',
        naturalWidthPx: widthPx,
        naturalHeightPx: heightPx,
        targetWidthCm,
        targetWidthInches: targetInches,
        recommendedWidthPx: recommendedPx,
        fileType: fileExt.toUpperCase(),
        isVector: false,
        analyzable: true,
        message: isLow
          ? `File resolution is ${calculatedDpi} DPI (${widthPx}×${heightPx} px) for ${targetWidthCm} cm print width. Recommended is 300 DPI (${recommendedPx} px wide).`
          : `File resolution is high (${calculatedDpi} DPI) for ${targetWidthCm} cm print width.`
      });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        dpi: null,
        isLowDpi: false,
        qualityLabel: 'unknown',
        naturalWidthPx: 0,
        naturalHeightPx: 0,
        targetWidthCm,
        targetWidthInches: targetInches,
        recommendedWidthPx: recommendedPx,
        fileType: fileExt.toUpperCase(),
        isVector: false,
        analyzable: false,
        message: 'The image could not be decoded, so its print resolution could not be analyzed.'
      });
    };
  });
}
