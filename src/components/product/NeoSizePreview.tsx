import React, { useEffect, useRef, useState } from 'react';
import { ImageIcon, Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { NEO } from '../NeumorphicSidebar';
import type { TranslationKey } from '../../lib/translations';
import { outlinePath, type OutlineKind } from '../../lib/shapes';

/**
 * The size the customer chose, drawn to scale, with his own artwork inside it.
 *
 * The configurator already knew the finished size and already refused a file
 * that did not match it — but the shopper only ever met that as a sentence, and
 * only AFTER the rejection. He is buying a physical object; the one thing he
 * wants to see before paying is the shape of it with his design on it.
 *
 * So the frame is always here: empty and dimensioned before a file is chosen, so
 * he can see what he is about to make, and filled the moment one is. The
 * proportions are the real ones — a 400 × 600 mm banner is drawn twice as tall
 * as it is wide — which is also the cheapest way for someone to notice they
 * picked landscape when they meant portrait.
 *
 * PDFs render through pdfjs, which the shop already ships for the proof viewer;
 * raster files render directly. A format no browser can draw (EPS, AI, PSD)
 * keeps the frame and names the file rather than pretending to preview it.
 */

interface NeoSizePreviewProps {
  /** Finished size in millimetres. Without it there is nothing to draw. */
  widthMm?: number;
  heightMm?: number;
  /** The chosen file, if any. */
  file?: File | null;
  /** Human label for the size, e.g. "400 × 600 mm". */
  sizeLabel?: string;
  /**
   * The cut shape the customer chose (src/lib/shapes.ts). The artwork is clipped
   * to it and the cut line drawn over it — "this is the shape and size you are
   * ordering" was always a rectangle.
   */
  outline?: OutlineKind | null;
  /**
   * Millimetres of bleed the file carries on every side (round 16). Drawn
   * contained, a file WITH its bleed showed those 3 mm inside the frame, as if
   * they were part of the product. They are pushed outside the frame, where the
   * cutter will take them.
   */
  bleedMm?: number;
  /**
   * For a PDF measured by its own TrimBox (a PDF/X with crop marks — round 16):
   * the region to draw, in PDF user space — the trim plus its bleed. The crop
   * marks and the slug around them are never drawn.
   */
  pdfBox?: number[] | null;
  t: (key: TranslationKey) => string;
  className?: string;
}

/** The longest side of the drawn frame, in CSS pixels. */
const FRAME_MAX = 190;
/** …and the smallest a drawn box may get while still reading as a shape. */
const FRAME_MIN_PX = 30;

/** Formats that a browser can actually paint. */
const RASTER = /^image\/(png|jpeg|jpg|gif|webp|bmp|svg\+xml)$/i;

export default function NeoSizePreview({
  widthMm,
  heightMm,
  file,
  sizeLabel,
  outline,
  bleedMm = 0,
  pdfBox,
  t,
  className,
}: NeoSizePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rasterUrl, setRasterUrl] = useState<string | null>(null);
  const [pdfRendered, setPdfRendered] = useState(false);
  const [busy, setBusy] = useState(false);

  // Raster preview: an object URL, revoked when the file changes or we unmount —
  // otherwise every re-pick leaks the previous one for the life of the tab.
  useEffect(() => {
    setPdfRendered(false);
    if (!file || !RASTER.test(file.type)) {
      setRasterUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setRasterUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // PDF preview: first page only, at the frame's own size.
  useEffect(() => {
    if (!file || file.type !== 'application/pdf') return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    // Ended on every way out: pdf.js keeps a worker per document until destroy().
    let loading: { destroy: () => Promise<void> } | null = null;

    (async () => {
      setBusy(true);
      try {
        const pdfjsLib = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
        }
        const buffer = await file.arrayBuffer();
        if (cancelled) return;
        const task = pdfjsLib.getDocument({ data: buffer });
        loading = task;
        const doc = await task.promise;
        if (cancelled) return;
        const page = await doc.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        // The region to draw, in the page's own (rotated, y-down) pixels at
        // scale 1: the whole page, or only the file's box.
        let region = { x: 0, y: 0, w: base.width, h: base.height };
        if (pdfBox && pdfBox.length === 4) {
          const corners = [
            [pdfBox[0], pdfBox[1]],
            [pdfBox[2], pdfBox[3]],
            [pdfBox[0], pdfBox[3]],
            [pdfBox[2], pdfBox[1]],
          ].map(([x, y]) => base.convertToViewportPoint(x, y));
          const xs = corners.map((c) => c[0]);
          const ys = corners.map((c) => c[1]);
          const x = Math.min(...xs);
          const y = Math.min(...ys);
          const w = Math.max(...xs) - x;
          const h = Math.max(...ys) - y;
          if (w > 0 && h > 0) region = { x, y, w, h };
        }
        // Fit the region inside the frame, then multiply by the device ratio so it
        // is not a blurry rectangle on a retina screen.
        const scale = Math.min(FRAME_MAX / region.w, FRAME_MAX / region.h) * dpr;
        const viewport = page.getViewport({ scale, offsetX: -region.x * scale, offsetY: -region.y * scale });
        canvas.width = Math.ceil(region.w * scale);
        canvas.height = Math.ceil(region.h * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        renderTask = page.render({ canvasContext: ctx, viewport, canvas });
        await (renderTask as unknown as { promise: Promise<void> }).promise;
        if (!cancelled) setPdfRendered(true);
      } catch (err) {
        // A preview is a courtesy. The upload, the size check and the order are
        // all unaffected by not being able to draw it.
        console.warn('Could not preview the PDF:', err);
      } finally {
        if (!cancelled) setBusy(false);
        // The canvas keeps what was drawn.
        void loading?.destroy().catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        /* already finished */
      }
      void loading?.destroy().catch(() => {});
    };
    // pdfBox as text: a new array with the same numbers is the same region.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, pdfBox ? pdfBox.join(',') : '']);

  const hasSize = Number.isFinite(widthMm) && Number.isFinite(heightMm) && (widthMm ?? 0) > 0 && (heightMm ?? 0) > 0;
  if (!hasSize) return null;

  const w = widthMm as number;
  const h = heightMm as number;
  // The frame always FILLS its box, and carries the true aspect ratio.
  //
  // Drawing sizes to scale against each other was tried and dropped: one field
  // here offers 30 mm stickers and 297 mm ones, so the small end came out as a
  // thirty-pixel square with unreadable labels. Between "you can compare two
  // sizes you are not looking at" and "you can see the one you chose", the
  // second is what the shopper actually needs. The proportions stay honest — a
  // banner twice as tall as it is wide is drawn that way — and the millimetres
  // are printed on both edges.
  const scale = FRAME_MAX / Math.max(w, h);
  const frameW = Math.max(FRAME_MIN_PX, Math.round(w * scale));
  const frameH = Math.max(FRAME_MIN_PX, Math.round(h * scale));

  // A shape to draw: any but the plain rectangle the frame already is. The clip
  // is CSS clip-path on an inner layer (an SVG clipPath cannot clip an <img> or a
  // <canvas>), in the frame's own pixels; the cut line is an SVG over it.
  const shaped = outline && outline !== 'rect' ? outline : null;
  const cutPath = shaped ? outlinePath(shaped, frameW, frameH) : null;
  const clipStyle = shaped && shaped !== 'custom' && cutPath ? { clipPath: `path('${cutPath}')` } : undefined;

  const showPdf = file?.type === 'application/pdf';
  const unpreviewable = !!file && !rasterUrl && !showPdf;
  // The file's bleed, in frame pixels, lies OUTSIDE the frame (and is clipped).
  const bleed = bleedMm > 0 ? bleedMm : 0;
  const bx = (bleed / w) * frameW;
  const by = (bleed / h) * frameH;

  const fmt = (mm: number) =>
    mm >= 1000 ? `${(mm / 10).toFixed(0)} cm` : `${Math.round(mm)} mm`;

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <span className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">
        {t('ppPreviewHeading')}
      </span>

      <div className="flex items-end gap-2" style={{ minHeight: FRAME_MAX + 18 }}>
        {/* Height, written up the left edge like a drawing. */}
        <div className="flex flex-col items-center justify-center" style={{ height: frameH }}>
          <span
            className="text-[0.625rem] font-black text-orange-600 whitespace-nowrap"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            {fmt(h)}
          </span>
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <div
            // A drawn cut line runs along the frame's edge for a square, a plaque
            // or a leaf, and the frame's rounded corners clipped its corners off.
            className={cn('relative overflow-hidden flex items-center justify-center', shaped ? 'rounded-sm' : 'rounded-xl', NEO.inset)}
            style={{ width: frameW, height: frameH, backgroundColor: '#e9ebf2' }}
            aria-label={sizeLabel}
          >
            {busy && (
              <Loader2 className="w-5 h-5 text-orange-600 animate-spin" aria-hidden="true" />
            )}

            <div className="absolute inset-0" style={clipStyle} data-rx-cut-clip={shaped ?? undefined}>
              <div
                className="absolute flex items-center justify-center"
                style={{ left: -bx, right: -bx, top: -by, bottom: -by }}
                data-rx-preview-bleed={bleed > 0 ? bleed : undefined}
              >
                {rasterUrl && (
                  <img
                    src={rasterUrl}
                    alt={t('ppPreviewAlt')}
                    className="w-full h-full object-contain"
                  />
                )}

                <canvas
                  ref={canvasRef}
                  className={cn(
                    'max-w-full max-h-full',
                    showPdf && pdfRendered ? 'block' : 'hidden',
                  )}
                />
              </div>
            </div>

            {cutPath && (
              <svg
                className="absolute inset-0 pointer-events-none"
                width={frameW}
                height={frameH}
                viewBox={`0 0 ${frameW} ${frameH}`}
                aria-hidden="true"
                data-rx-cut-outline={shaped ?? undefined}
              >
                <path d={cutPath} fill="none" stroke="#ea580c" strokeWidth={1.5} strokeDasharray="5 3" />
              </svg>
            )}

            {!file && !busy && (
              <div className="flex flex-col items-center gap-1 px-2 text-center">
                <ImageIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
                <span className="text-[0.5625rem] font-bold text-gray-400 leading-tight">
                  {t('ppPreviewEmpty')}
                </span>
              </div>
            )}

            {unpreviewable && !busy && (
              <span className="text-[0.5625rem] font-black text-gray-500 px-2 text-center break-all leading-tight">
                {file?.name}
              </span>
            )}
          </div>

          {/* Width, written under the frame. */}
          <span className="text-[0.625rem] font-black text-orange-600">{fmt(w)}</span>
        </div>
      </div>

      <span className="text-[0.625rem] font-bold text-gray-500 text-center max-w-[15rem]">
        {file ? t('ppPreviewWithFile') : t('ppPreviewHint')}
      </span>
    </div>
  );
}
