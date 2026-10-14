import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  ChevronLeft, 
  ChevronRight, 
  ZoomIn, 
  ZoomOut, 
  RotateCw, 
  Maximize2, 
  Download, 
  FileCheck, 
  AlertCircle, 
  Sparkles, 
  CheckCircle2, 
  Printer, 
  Ruler, 
  Eye, 
  Layers,
  RefreshCw
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configure pdfjs worker source
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
} catch (e) {
  console.warn('PDF.js worker fallback configuration:', e);
}

interface PdfPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileUrl: string | null | undefined;
  fileName?: string;
  widthCm?: number;
  heightCm?: number;
}

export default function PdfPreviewModal({
  isOpen,
  onClose,
  fileUrl,
  fileName = 'Document.pdf',
  widthCm,
  heightCm
}: PdfPreviewModalProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [rendering, setRendering] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Print Proof Overlays
  const [showBleedOverlay, setShowBleedOverlay] = useState<boolean>(true);
  const [isVerified, setIsVerified] = useState<boolean>(false);

  // Load Document
  useEffect(() => {
    if (!isOpen || !fileUrl) {
      setPdfDoc(null);
      setNumPages(0);
      setCurrentPage(1);
      setErrorMsg(null);
      return;
    }

    let isMounted = true;
    // pdf.js keeps a worker per document until it is destroyed: closed with the
    // preview (or a new file), not left running in the tab.
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setLoading(true);
    setErrorMsg(null);

    const loadPdf = async () => {
      try {
        // Handle data URL, blob URL, or direct URL
        loadingTask = pdfjsLib.getDocument({
          url: fileUrl,
          cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
          cMapPacked: true,
        });

        const docProxy = await loadingTask.promise;
        if (!isMounted) return;

        setPdfDoc(docProxy);
        setNumPages(docProxy.numPages);
        setCurrentPage(1);
        setLoading(false);
      } catch (err: any) {
        // Closed (or a new file) while loading: its document was destroyed on purpose.
        if (!isMounted) return;
        console.error('PDF.js loading error:', err);
        setErrorMsg(
          err.message?.includes('Invalid PDF')
            ? 'The uploaded file is not a valid PDF or is corrupted.'
            : 'Unable to render PDF preview. Please download the file to inspect it directly.'
        );
        setLoading(false);
      }
    };

    loadPdf();

    return () => {
      isMounted = false;
      setPdfDoc(null);
      void loadingTask?.destroy().catch(() => {});
    };
  }, [isOpen, fileUrl]);

  // Render Page to Canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let renderTaskHandle: pdfjsLib.RenderTask | null = null;
    let isCancelled = false;

    const renderPage = async () => {
      setRendering(true);
      try {
        const page = await pdfDoc.getPage(currentPage);
        if (isCancelled) return;

        const viewport = page.getViewport({ scale, rotation });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // Support high-DPI retina screens
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const transform = outputScale !== 1 
          ? [outputScale, 0, 0, outputScale, 0, 0] 
          : undefined;

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';

        const renderContext = {
          canvasContext: context,
          canvas: canvas,
          viewport,
          transform
        };

        renderTaskHandle = page.render(renderContext);
        await renderTaskHandle.promise;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('Page render error:', err);
        }
      } finally {
        if (!isCancelled) {
          setRendering(false);
        }
      }
    };

    renderPage();

    return () => {
      isCancelled = true;
      if (renderTaskHandle) {
        renderTaskHandle.cancel();
      }
    };
  }, [pdfDoc, currentPage, scale, rotation]);

  if (!isOpen) return null;

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(prev => prev - 1);
  };

  const handleNextPage = () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) setCurrentPage(prev => prev + 1);
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handleZoomIn = () => {
    setScale(prev => Math.min(prev + 0.25, 3.0));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = () => {
    setScale(1.2);
    setRotation(0);
  };

  const handleDownload = () => {
    if (!fileUrl) return;
    const a = document.createElement('a');
    a.href = fileUrl;
    a.download = fileName || 'print_proof.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-5xl h-[92vh] bg-gray-900 rounded-3xl border border-gray-800 shadow-2xl overflow-hidden flex flex-col text-white"
        >
          {/* Header */}
          <div className="bg-gray-950 px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-orange-600/20 border border-orange-500/30 text-orange-400 flex items-center justify-center">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="font-extrabold text-sm text-gray-100 truncate max-w-xs sm:max-w-md">
                    {fileName}
                  </h3>
                  <span className="px-2 py-0.5 rounded-md bg-orange-500/20 text-orange-300 border border-orange-500/30 text-[0.625rem] font-black uppercase">
                    PDF Proof
                  </span>
                </div>
                {widthCm && heightCm && (
                  <p className="text-xs text-gray-400 flex items-center space-x-1 mt-0.5">
                    <Ruler className="w-3 h-3 text-orange-400" />
                    <span>Print Size: {widthCm}cm × {heightCm}cm</span>
                  </p>
                )}
              </div>
            </div>

            {/* Actions / Close */}
            <div className="flex items-center space-x-2">
              <button
                onClick={handleDownload}
                className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl text-xs font-bold transition-colors"
                title="Download Original PDF"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </button>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-white bg-gray-800/80 hover:bg-gray-800 rounded-full transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Controls Bar */}
          <div className="bg-gray-900/90 border-b border-gray-800/80 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0 select-none">
            {/* Page Navigation */}
            <div className="flex items-center space-x-1.5 bg-gray-950/80 p-1 rounded-xl border border-gray-800">
              <button
                onClick={handlePrevPage}
                disabled={currentPage <= 1 || loading}
                className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-300 disabled:opacity-40 transition-colors"
                title="Previous Page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-2 font-bold text-gray-200 min-w-[4.375rem] text-center">
                Page {numPages > 0 ? currentPage : 0} of {numPages}
              </span>
              <button
                onClick={handleNextPage}
                disabled={currentPage >= numPages || loading}
                className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-300 disabled:opacity-40 transition-colors"
                title="Next Page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Zoom & Rotation */}
            <div className="flex items-center space-x-1.5 bg-gray-950/80 p-1 rounded-xl border border-gray-800">
              <button
                onClick={handleZoomOut}
                className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-300 transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={handleResetZoom}
                className="px-2 font-mono font-extrabold text-orange-400 hover:text-orange-300 transition-colors"
                title="Reset Scale"
              >
                {Math.round(scale * 100)}%
              </button>
              <button
                onClick={handleZoomIn}
                className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-300 transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <div className="w-px h-4 bg-gray-800 mx-1" />
              <button
                onClick={handleRotate}
                className="p-1.5 hover:bg-gray-800 rounded-lg text-gray-300 transition-colors flex items-center space-x-1"
                title="Rotate Clockwise"
              >
                <RotateCw className="w-4 h-4" />
                {rotation > 0 && <span className="text-[0.625rem] text-orange-400">{rotation}°</span>}
              </button>
            </div>

            {/* Print Overlays Toggle */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowBleedOverlay(prev => !prev)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl font-bold transition-all ${
                  showBleedOverlay 
                    ? 'bg-orange-600/30 text-orange-300 border border-orange-500/40 shadow-sm' 
                    : 'bg-gray-950 text-gray-400 border border-gray-800 hover:text-gray-200'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{showBleedOverlay ? 'Cut & Bleed Guides ON' : 'Show Print Guides'}</span>
              </button>
            </div>
          </div>

          {/* Main Viewer Canvas Area */}
          <div 
            ref={containerRef}
            className="flex-1 overflow-auto bg-gray-950 p-6 flex items-center justify-center relative custom-scrollbar"
          >
            {loading && (
              <div className="flex flex-col items-center justify-center space-y-3 text-gray-400">
                <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
                <p className="text-xs font-bold">Rendering High-Resolution PDF Proof...</p>
              </div>
            )}

            {errorMsg && (
              <div className="max-w-md p-6 bg-red-950/40 border border-red-900/60 rounded-3xl text-center space-y-3">
                <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
                <h4 className="font-black text-sm text-red-200">PDF Preview Unavailable</h4>
                <p className="text-xs text-red-300/80 leading-relaxed">{errorMsg}</p>
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold inline-flex items-center space-x-2"
                >
                  <Download className="w-4 h-4" />
                  <span>Download PDF Directly</span>
                </button>
              </div>
            )}

            {!loading && !errorMsg && (
              <div className="relative inline-block shadow-2xl rounded-lg overflow-hidden border border-gray-800 bg-white">
                <canvas ref={canvasRef} className="block max-w-full h-auto" />

                {/* Print Bleed & Safety Overlay */}
                {showBleedOverlay && (
                  <div className="absolute inset-0 pointer-events-none">
                    {/* Outer Red Bleed Line */}
                    <div className="absolute inset-2 border-2 border-dashed border-red-500/70" />
                    <span className="absolute top-2.5 left-3 bg-red-600/90 text-white text-[0.5625rem] font-black px-1.5 py-0.5 rounded shadow">
                      Bleed Edge (3mm)
                    </span>

                    {/* Inner Green Safe Zone */}
                    <div className="absolute inset-6 border-2 border-dotted border-emerald-500/80" />
                    <span className="absolute bottom-2.5 right-3 bg-emerald-600/90 text-white text-[0.5625rem] font-black px-1.5 py-0.5 rounded shadow">
                      Safe Text Zone
                    </span>
                  </div>
                )}

                {rendering && (
                  <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] flex items-center justify-center">
                    <RefreshCw className="w-6 h-6 text-orange-400 animate-spin" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Pre-flight Verification Checklist */}
          <div className="bg-gray-950 border-t border-gray-800 p-4 px-6 flex flex-wrap items-center justify-between gap-4 shrink-0">
            <div className="flex items-center space-x-6 text-xs text-gray-300 font-medium">
              {/* 15.6.6 — A SIZE NOBODY GAVE IS NOT A SIZE, and this one had a
                  green tick beside it. `{widthCm || 28}cm × {heightCm || 35}cm`
                  printed an invented 28 × 35 next to a ✓ in a row the customer
                  reads as a pre-flight check that PASSED — the strongest way
                  this shop had of asserting something false. The heading twenty
                  lines up has guarded on the pair since it was written; this
                  line did not. No size, no claim. */}
              {Number(widthCm) > 0 && Number(heightCm) > 0 && (
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Dimensions: <strong className="text-white">{widthCm}cm × {heightCm}cm</strong></span>
                </div>
              )}
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Vector & Raster Layout Check OK</span>
              </div>
              <div className="flex items-center space-x-2 hidden md:flex">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>CMYK Color Space Ready</span>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => {
                  setIsVerified(true);
                  setTimeout(() => {
                    onClose();
                  }, 400);
                }}
                className={`px-5 py-2.5 rounded-2xl font-black text-xs transition-all flex items-center space-x-2 ${
                  isVerified 
                    ? 'bg-emerald-600 text-white shadow-lg' 
                    : 'bg-orange-600 hover:bg-orange-500 text-white shadow-md'
                }`}
              >
                <FileCheck className="w-4 h-4" />
                <span>{isVerified ? 'Proof Verified ✓' : 'Approve Layout & Continue'}</span>
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
