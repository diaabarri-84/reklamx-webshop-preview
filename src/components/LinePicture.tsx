/**
 * THE PICTURE OF AN ORDER LINE, BIG — the job sheet and the packing slip. Client,
 * 2026-10-07: "the product's picture must be visible and very big", over a FILE
 * cell that said only "PDF" and a slip that showed a document icon.
 *
 * In order of what says most about the job:
 *   1. the online designer's page picture (its print file is never loaded here —
 *      a two-sided roll-up PDF is 40 MB);
 *   2. a picture file the customer sent (JPG, PNG…);
 *   3. the first page of a PDF the customer sent, drawn here with pdf.js;
 *   4. the product's own photo — frozen on the line when ordered (productImage), or
 *      looked up for older orders from the catalogue the server keeps (no read).
 *
 * The box is a FIXED size, chosen by the caller: the sheet is measured for A4 when
 * printing starts, and a picture that arrives later must not move anything.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { isDisplayableImage } from '../lib/utils';
import { previewOf } from '../lib/designFileSpecs';
import SafeImage from './SafeImage';
// The worker's ADDRESS only (a string, as pdf.js insists) — imported statically, as
// the checkout's PDF preview does: a dynamic `?url` import handed pdf.js a module.
// pdf.js itself still loads only when a PDF is drawn.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type LinePictureSource =
  | { kind: 'design'; url: string }
  | { kind: 'file'; url: string }
  | { kind: 'pdf'; url: string; product: string | null }
  | { kind: 'product'; url: string };

/** What to show for a line — or null when there is nothing at all to show. */
export function pictureOf(item: any, productImages: Record<string, string> = {}): LinePictureSource | null {
  const fileUrl: string = item?.fileSpecs?.fileUrl || item?.fileUrl || item?.designData || '';
  const fileName: string = item?.fileSpecs?.fileName || item?.fileName || '';
  const fileType: string = item?.fileSpecs?.fileType || '';
  const product: string | null = (typeof item?.productImage === 'string' && item.productImage) || productImages[String(item?.productId ?? '')] || null;
  const design = fileUrl ? previewOf(item?.fileSpecs) : null;
  if (design) return { kind: 'design', url: design };
  if (fileUrl && isDisplayableImage(fileUrl, fileName, fileType)) return { kind: 'file', url: fileUrl };
  if (fileUrl && (/pdf/i.test(fileType) || /\.pdf(?:$|[?#])/i.test(fileName) || /^data:application\/pdf/i.test(fileUrl))) {
    return { kind: 'pdf', url: fileUrl, product };
  }
  if (product) return { kind: 'product', url: product };
  return null;
}

/**
 * The products' own photos for lines that did not freeze one (orders from before
 * 2026-10) — from the server's catalogue copy, one small call per sheet.
 */
export function useProductImages(items: any[] | null | undefined): Record<string, string> {
  const ids = [...new Set((items ?? []).filter((i) => i?.productId && !i?.productImage).map((i) => String(i.productId)))].slice(0, 50);
  const key = ids.join(',');
  const [images, setImages] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetch(`/api/catalogue/images?ids=${key.split(',').map(encodeURIComponent).join(',')}`)
      .then((r) => (r.ok ? r.json() : { images: {} }))
      .then((j) => alive && setImages((j?.images ?? {}) as Record<string, string>))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  return images;
}

// ONE pdf.js worker for every PDF drawn here, and two drawn at a time. pdf.js starts
// a worker per document unless it is handed one, and only that document's destroy()
// ends it: a 15-line order had ten alive at once, and every sheet closed before its
// PDFs drew — or a PDF that could not be read — left one running until a reload.
let sharedWorker: import('pdfjs-dist').PDFWorker | null = null;
let drawing = 0;
const queue: Array<() => void> = [];
async function drawSlot(): Promise<() => void> {
  if (drawing >= 2) await new Promise<void>((resolve) => queue.push(resolve));
  drawing += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    drawing -= 1;
    queue.shift()?.();
  };
}
// Page one of each PDF once drawn, by address: opening the job sheet and then the
// packing slip downloaded, and drew, every PDF twice.
const drawnPages = new Map<string, string>();
function remember(url: string, picture: string) {
  drawnPages.set(url, picture);
  if (drawnPages.size > 16) drawnPages.delete(drawnPages.keys().next().value as string);
}

/** Page one of a PDF, drawn to a canvas that fills the box; `fallback` when it cannot be drawn. */
function PdfFirstPage({ url, fallback }: { url: string; fallback: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cached, setCached] = useState<string | null>(() => drawnPages.get(url) ?? null);
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>(() => (drawnPages.has(url) ? 'ok' : 'loading'));
  useEffect(() => {
    const hit = drawnPages.get(url);
    if (hit) {
      setCached(hit);
      setState('ok');
      return;
    }
    setCached(null);
    setState('loading');
    let cancelled = false;
    let loading: { destroy: () => Promise<void> } | null = null;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    // Every way out ends the document: drawn, failed, or the sheet closed under it
    // (which also stops the download).
    let ended = false;
    const end = () => {
      if (ended || !loading) return;
      ended = true;
      void loading.destroy().catch(() => {});
    };
    (async () => {
      const release = await drawSlot();
      try {
        if (cancelled) return;
        const pdfjsLib = await import('pdfjs-dist');
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = String(pdfWorkerUrl);
        if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new pdfjsLib.PDFWorker();
        if (cancelled) return;
        // Page one only: where the server allows it, the bytes that page needs and
        // not the whole file (the back of a two-sided roll-up is half of it).
        const doc = pdfjsLib.getDocument({ url, worker: sharedWorker, disableStream: true, disableAutoFetch: true });
        loading = doc;
        const pdf = await doc.promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const base = page.getViewport({ scale: 1 });
        // Enough pixels for the biggest box, on paper too (about 240 px at 2×).
        const scale = Math.min(720 / base.width, 720 / base.height);
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no canvas');
        task = page.render({ canvasContext: ctx, viewport, canvas }) as unknown as { cancel: () => void; promise: Promise<void> };
        await task.promise;
        if (cancelled) return;
        try {
          remember(url, canvas.toDataURL('image/jpeg', 0.9));
        } catch {
          /* not kept: drawn again next time */
        }
        setState('ok');
      } catch (err) {
        // A picture is a courtesy: the job, the file and its download are all there anyway.
        if (!cancelled) {
          console.warn('Could not draw the PDF\'s first page:', err);
          setState('failed');
        }
      } finally {
        end();
        release();
      }
    })();
    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* already finished */
      }
      end();
    };
  }, [url]);
  if (state === 'failed') return <>{fallback}</>;
  if (cached) return <img src={cached} alt="" className="max-w-full max-h-full object-contain" data-rx-line-picture-pdf />;
  return (
    <>
      <canvas ref={canvasRef} className={state === 'ok' ? 'max-w-full max-h-full object-contain' : 'hidden'} data-rx-line-picture-pdf />
      {state === 'loading' && <Loader2 className="w-5 h-5 text-slate-400 animate-spin print:hidden" />}
    </>
  );
}

/** The picture itself, inside a box the caller sizes. */
export function LinePictureView({
  source,
  label,
  fileBadge,
  designAttr = false,
}: {
  source: LinePictureSource;
  /** Under the photo whenever it is the PRODUCT's, not the customer's artwork. */
  label?: string;
  /**
   * Over the product's photo when the customer DID send a file that cannot be drawn
   * here (an AI, EPS or PSD file, or a PDF that would not open): what it is.
   */
  fileBadge?: string;
  /** The job sheet's own marker on a designer page picture (one per line; e2e). */
  designAttr?: boolean;
}) {
  const productBadges = (
    <>
      {fileBadge ? (
        <span className="absolute top-0 inset-x-0 bg-slate-800/85 text-[0.5rem] font-black uppercase tracking-wide text-white text-center py-0.5" data-rx-line-picture-file>
          {fileBadge}
        </span>
      ) : null}
      {label ? (
        <span className="absolute bottom-0 inset-x-0 bg-white/85 text-[0.5rem] font-black uppercase tracking-wide text-slate-600 text-center py-0.5">{label}</span>
      ) : null}
    </>
  );
  if (source.kind === 'pdf') {
    return (
      <PdfFirstPage
        url={source.url}
        fallback={
          source.product ? (
            <>
              <SafeImage loading="eager" src={source.product} alt="" className="max-h-full max-w-full object-contain" data-rx-line-picture="product" />
              {productBadges}
            </>
          ) : (
            <span className="text-[0.5625rem] font-black text-slate-500 uppercase">PDF</span>
          )
        }
      />
    );
  }
  return (
    <>
      <SafeImage
        loading="eager"
        src={source.url}
        alt=""
        className="max-h-full max-w-full object-contain"
        data-rx-line-picture={source.kind}
        {...(designAttr && source.kind === 'design' ? { 'data-rx-sheet-preview': '' } : {})}
      />
      {source.kind === 'product' && productBadges}
    </>
  );
}

/** How big a line's picture is on a sheet with `lines` lines: big for one, smaller as they add up (one A4 page). */
export function pictureSizeFor(lines: number): number {
  if (lines <= 1) return 240;
  if (lines === 2) return 170;
  if (lines <= 4) return 120;
  if (lines <= 8) return 84;
  return 56;
}
