import React, { useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '../App';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Download, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  FileImage, 
  FileText, 
  Ruler, 
  Layers, 
  ExternalLink,
  Eye,
  CheckCircle2
} from 'lucide-react';
import { triggerFileDownload } from '../lib/downloadHelper';
import { isDisplayableImage } from '../lib/utils';

interface DesignAttachmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  widthCm?: number;
  heightCm?: number;
  productName?: string;
  orderId?: string;
  /**
   * A studio design's page pictures (designer v2). Shown INSTEAD of the print file,
   * which may be a 40 MB PDF; the print file is what Download fetches.
   */
  previews?: Array<{ side: 'front' | 'back'; url: string }> | null;
}

export default function DesignAttachmentModal({
  isOpen,
  onClose,
  fileUrl,
  fileName = 'Design_Attachment.png',
  fileType = 'PNG',
  widthCm,
  heightCm,
  productName,
  orderId,
  previews}: DesignAttachmentModalProps) {
  const { t } = useAuth();
  const displayName = productName || t('damDefaultName');
  const [zoomLevel, setZoomLevel] = useState(1);
  // THE ZOOM REACHES EVERY EDGE. The pictures are laid out at 100 % (fitted to the
  // stage), then scaled from their top-left corner inside a box sized to the scaled
  // pictures; auto margins centre that box while it is smaller than the stage and give
  // way when it is larger, so the stage scrolls to all four edges. Scaled about their
  // middle in a centred stage, a zoomed page's top and left overflowed where no
  // scrollbar reaches (code review, second pass #7). Measured: the stage's inner width
  // (what the pictures are fitted to) and the pictures' own size before the zoom.
  const stageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ stageW: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const content = contentRef.current;
    if (!stage || !content) {
      setFit(null);
      return;
    }
    const measure = () => {
      const css = getComputedStyle(stage);
      const stageW = Math.max(0, stage.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight));
      // offsetWidth/offsetHeight leave the zoom's transform out: the size at 100 %.
      const next = { stageW, w: content.offsetWidth, h: content.offsetHeight };
      setFit((cur) => (cur && cur.stageW === next.stageW && cur.w === next.w && cur.h === next.h ? cur : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(stage);
    watch.observe(content);
    return () => watch.disconnect();
  }, [isOpen, fileUrl, fileName, fileType, previews]);

  if (!isOpen || !fileUrl) return null;

  // Not "is it served over http" — every print file here is. See isDisplayableImage.
  const isImage = isDisplayableImage(fileUrl, fileName, fileType);
  // A studio design's page pictures zoom too: a PDF design's were shown at one size,
  // its small text unreadable (code review DSN-20).
  const hasPages = !!previews && previews.length > 0;
  const canZoom = isImage || hasPages;

  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 0.3, 3));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 0.3, 0.6));
  const handleResetZoom = () => setZoomLevel(1);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-slate-900 border border-slate-800 rounded-3xl max-w-5xl w-full h-[90vh] flex flex-col shadow-2xl text-white overflow-hidden relative"
          dir={'ltr'}
          data-rx-design-attachment
        >
          {/* Header Bar */}
          <div className="bg-slate-950 p-4 sm:px-6 flex items-center justify-between border-b border-slate-800 shrink-0">
            <div className="flex items-center space-x-3 space-x-reverse min-w-0">
              <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
                <FileImage className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <h3 className="font-black text-base truncate text-white">
                    {'Large Design Preview'}
                  </h3>
                  <span className="bg-blue-500/20 text-blue-300 border border-blue-400/30 text-[0.625rem] font-black px-2 py-0.5 rounded-full uppercase shrink-0">
                    {fileType}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono truncate">
                  {fileName} {orderId ? `• Order Ref: #${orderId}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 space-x-reverse shrink-0">
              {/* Zoom Controls for Images and page pictures */}
              {canZoom && (
                <div className="hidden sm:flex items-center bg-slate-800 rounded-xl p-1 border border-slate-700/50 space-x-1 space-x-reverse">
                  <button
                    onClick={handleZoomOut}
                    className="p-1.5 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                    title={'Zoom Out'}
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-mono font-bold px-1 text-slate-300 min-w-[2.8125rem] text-center">
                    {Math.round(zoomLevel * 100)}%
                  </span>
                  <button
                    onClick={handleZoomIn}
                    className="p-1.5 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                    title={'Zoom In'}
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleResetZoom}
                    className="p-1.5 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                    title={'Reset'}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Download Action */}
              <button
                type="button"
                onClick={() => triggerFileDownload(fileUrl, fileName)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold px-3.5 py-2 rounded-xl text-xs flex items-center space-x-1.5 space-x-reverse transition-all shadow-md active:scale-95 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{'Download File'}</span>
              </button>

              <button
                onClick={onClose}
                aria-label="Close"
                title="Close"
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* What the page pictures are, and are not: production checks the print file. */}
          {hasPages && (
            <p className="px-4 sm:px-6 py-2 bg-slate-950 border-b border-slate-800 text-[0.6875rem] font-bold text-slate-400 shrink-0" data-rx-design-pages-note>
              Previews of the trimmed page (up to 800 px), not the print file: download the file to check fine detail and the bleed.
            </p>
          )}

          {/* Main Stage Image / Document Viewer: a zoomed picture scrolls to every edge
              (arrow keys too, once it has the focus). A steady scrollbar gutter: a bar
              appearing would narrow what the pictures are fitted to, and refit them. */}
          <div
            ref={stageRef}
            tabIndex={canZoom ? 0 : undefined}
            role={canZoom ? 'region' : undefined}
            aria-label={canZoom ? 'Design preview' : undefined}
            className="flex-1 bg-slate-950/70 p-4 overflow-auto flex relative select-none [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-400"
            data-rx-design-stage
          >
            {canZoom ? (
              // Sized to the zoomed pictures; its width and height move with the scale, in step.
              <div
                className="m-auto transition-[width,height] duration-200 ease-out"
                style={fit ? { width: fit.w * zoomLevel, height: fit.h * zoomLevel, flexShrink: 0 } : undefined}
              >
                <div
                  ref={contentRef}
                  className={`${fit ? 'w-max ' : ''}origin-top-left transition-transform duration-200 ease-out`}
                  style={{ maxWidth: fit ? fit.stageW : '100%', transform: `scale(${zoomLevel})` }}
                  data-rx-design-zoom={Math.round(zoomLevel * 100)}
                >
                  {hasPages ? (
                    // Side by side from a tablet up, fitted together: a wrapped row keeps its
                    // full width, and the zoom enlarged the empty space beside the pages too.
                    <div className="flex flex-wrap sm:flex-nowrap items-center justify-center gap-6 p-2" data-rx-design-pages>
                      {previews.map((p, i) => (
                        <figure key={p.side} className="space-y-2 text-center">
                          <img src={p.url} alt={`${fileName} — page ${i + 1}`} className="max-h-[62vh] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800 bg-white" />
                          {previews.length > 1 && (
                            <figcaption className="text-[0.6875rem] font-black text-slate-300 uppercase tracking-wider">
                              Page {i + 1} · {p.side === 'back' ? 'Back' : 'Front'}
                            </figcaption>
                          )}
                        </figure>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center p-2" data-rx-design-image>
                      <img
                        src={fileUrl}
                        alt={fileName}
                        className="max-h-[70vh] max-w-full object-contain rounded-2xl shadow-2xl border border-slate-800 bg-checkerboard"
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="m-auto text-center p-8 bg-slate-900 border border-slate-800 rounded-3xl max-w-md space-y-4">
                <div className="w-16 h-16 bg-blue-600/20 text-blue-400 rounded-2xl flex items-center justify-center mx-auto border border-blue-500/30">
                  <FileText className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="font-extrabold text-lg text-white">{fileName}</h4>
                  <p className="text-xs text-slate-400 mt-1">
                    {'Non-image print document format.'}
                  </p>
                </div>
                <div className="pt-2 flex justify-center gap-3">
                  <button
                    onClick={() => triggerFileDownload(fileUrl, fileName)}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-extrabold px-5 py-2.5 rounded-xl text-xs flex items-center gap-2 cursor-pointer shadow-md"
                  >
                    <Download className="w-4 h-4" />
                    <span>{'Download Document'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Details Footer Bar for Employees */}
          <div className="bg-slate-950 p-4 px-6 border-t border-slate-800 shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="space-y-0.5">
              <span className="text-slate-400 font-bold block text-[0.625rem] uppercase">
                {'Target Product:'}
              </span>
              <span className="font-extrabold text-white block text-sm truncate">{displayName}</span>
            </div>

            <div className="space-y-0.5 border-t sm:border-t-0 sm:border-r border-slate-800 sm:pr-4 pt-2 sm:pt-0">
              <span className="text-slate-400 font-bold block text-[0.625rem] uppercase">
                {'Print Dimensions:'}
              </span>
              <span className="font-mono font-black text-amber-400 block text-sm">
                {widthCm && heightCm && widthCm > 0 && heightCm > 0 
                  ? `${widthCm} × ${heightCm} cm` 
                  : t('damStandardSize')}
              </span>
            </div>

            <div className="space-y-0.5 border-t sm:border-t-0 sm:border-r border-slate-800 sm:pr-4 pt-2 sm:pt-0">
              <span className="text-slate-400 font-bold block text-[0.625rem] uppercase">
                {'Attachment Name & Format:'}
              </span>
              <span className="font-mono font-bold text-emerald-400 block text-xs truncate">
                {fileName} ({fileType})
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
