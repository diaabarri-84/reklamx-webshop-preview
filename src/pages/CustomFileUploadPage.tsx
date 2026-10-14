import React, { useState, useEffect, useRef } from 'react';
import { writeCart } from '../lib/cart';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { signInAnonymously } from 'firebase/auth';
import { PrintSettings } from '../types';
import { useAuth } from '../App';
import { uploadFile } from '../lib/uploadFile';
import { 
  UploadCloud, 
  FileCheck, 
  AlertTriangle, 
  Info, 
  Ruler, 
  Calculator, 
  ShoppingCart, 
  CheckCircle2, 
  FileText, 
  FileImage, 
  Image as ImageIcon,
  Sparkles,
  ArrowLeft,
  Check,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { analyzeFileDpi, DpiAnalysisResult } from '../lib/dpiUtils';
import { MAX_FILE_MB, artworkWouldOverflow } from '../lib/artworkLimits';
import VatTag from '../components/VatTag';

// The ceiling comes from src/lib/artworkLimits.ts, which the server uses too.
// It said 3 MB here while the server refused anything over about 0.67 MB, so a
// 1 MB press-ready PDF passed every check on this page, priced correctly, went
// through the whole checkout form and was thrown out at the pay button.

// Formats the browser can render inline; the actual preview list is the
// intersection of this with settings.allowedFormats so the two cannot drift.
const PREVIEWABLE_IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'svg', 'webp'];

const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  svg: ['image/svg+xml'],
  tiff: ['image/tiff'],
  tif: ['image/tiff'],
  eps: ['application/postscript', 'application/eps', 'image/x-eps'],
  ai: ['application/postscript', 'application/pdf', 'application/illustrator'],
  psd: ['image/vnd.adobe.photoshop', 'application/x-photoshop', 'application/photoshop']
};

const MAGIC_SIGNATURES: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]],
  png: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]]
};

async function matchesMagicBytes(file: File, extension: string): Promise<boolean> {
  const signatures = MAGIC_SIGNATURES[extension];
  if (!signatures) return true;
  try {
    const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    return signatures.some(
      (sig) => sig.length <= header.length && sig.every((byte, i) => header[i] === byte)
    );
  } catch {
    return false;
  }
}

// With Firebase Storage wired in, the honest ceiling is the bucket rule's
// 50 MB. The old MAX_FILE_MB (~0.65 MB, the Firestore-document ceiling) now
// only gates the FALLBACK path, when a file has to be embedded because the
// upload to storage failed.
const STORAGE_MAX_MB = 50;

const DEFAULT_SETTINGS: PrintSettings = {
  maxWidthCm: 28,
  pricePerLinearMeter: 250,
  minPrice: 149,
  vatRatePercent: 25,
  allowedFormats: ['pdf', 'png', 'jpg', 'jpeg', 'svg', 'eps', 'tiff', 'psd', 'ai'],
  currencySymbol: 'kr',
  maxFileSizeMb: STORAGE_MAX_MB
};

export default function CustomFileUploadPage() {
  const { t, formatPriceWithVat, includeVat } = useAuth();

  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_SETTINGS);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // File & Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [fileDataUrl, setFileDataUrl] = useState<string | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const readerGenerationRef = useRef(0);
  /**
   * Which pick the measuring belongs to. The measuring is awaited, and a second
   * file picked meanwhile could finish first: the first file's length, price and
   * "place by its TrimBox" then landed on the second file's line (round 16 review).
   */
  const analysisGenerationRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const replacePreviewUrl = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setFilePreviewUrl(url);
  };

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  // Detected Dimensions & Resolution
  const [naturalWidthPx, setNaturalWidthPx] = useState<number>(0);
  const [naturalHeightPx, setNaturalHeightPx] = useState<number>(0);
  const [calculatedHeightCm, setCalculatedHeightCm] = useState<number>(0);
  const [customHeightOverride, setCustomHeightOverride] = useState<number | null>(null);

  // DPI Analysis State
  const [dpiResult, setDpiResult] = useState<DpiAnalysisResult | null>(null);
  const [analyzingDpi, setAnalyzingDpi] = useState<boolean>(false);

  // Order Details
  const [quantity, setQuantity] = useState<number>(1);
  const [addedToCartSuccess, setAddedToCartSuccess] = useState(false);
  /** 0–100 while the artwork is uploading to storage, null when idle. */
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  // Fetch print settings from Firestore
  useEffect(() => {
    const docRef = doc(db, 'settings', 'printSettings');
    const unsubscribe = onSnapshot(
      docRef, 
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as PrintSettings;
          setSettings({
            maxWidthCm: data.maxWidthCm || 28,
            pricePerLinearMeter: data.pricePerLinearMeter || 250,
            minPrice: data.minPrice || 149,
            allowedFormats: data.allowedFormats && data.allowedFormats.length > 0 ? data.allowedFormats : DEFAULT_SETTINGS.allowedFormats,
            currencySymbol: data.currencySymbol || 'kr',
            // These two were dropped on the floor: the owner set a file-size
            // limit and a VAT rate in the dashboard and this page used the
            // hard-coded defaults instead.
            maxFileSizeMb: data.maxFileSizeMb,
            vatRatePercent: data.vatRatePercent,
          });
        } else {
          // Initialize default settings in Firestore
          setDoc(docRef, DEFAULT_SETTINGS).catch(() => {});
        }
        setLoadingSettings(false);
      },
      (err) => {
        console.warn('Notice fetching print settings in CustomFileUploadPage (using defaults):', err);
        setLoadingSettings(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Calculate file dimensions and DPI resolution dynamically on upload
  const handleFileChange = async (file: File) => {
    const analysis = ++analysisGenerationRef.current;
    setFileError(null);
    setCustomHeightOverride(null);
    setDpiResult(null);
    // Nothing of the previous file's measuring may stand for this one.
    setCalculatedHeightCm(0);
    setNaturalWidthPx(0);
    setNaturalHeightPx(0);
    setFileDataUrl(null);
    readerGenerationRef.current++;
    setIsReadingFile(false);
    setAnalyzingDpi(true);

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const cleanAllowed = settings.allowedFormats.map(f => f.toLowerCase().replace('.', ''));

    if (!cleanAllowed.includes(extension)) {
      setFileError(`${t('customUploadUnsupportedFormat')} .${extension} — ${t('customUploadAllowedFormatsLabel')} ${cleanAllowed.join(', ')}`);
      setSelectedFile(null);
      replacePreviewUrl(null);
      setAnalyzingDpi(false);
      return;
    }

    const allowedMimes = ALLOWED_MIME_TYPES[extension];
    if (allowedMimes && file.type && !allowedMimes.includes(file.type.toLowerCase())) {
      setFileError(t('fileTypeMismatch'));
      setSelectedFile(null);
      replacePreviewUrl(null);
      setAnalyzingDpi(false);
      return;
    }

    // Size was never checked here. `file.size` was read exactly once in this file,
    // to print it — nothing gated on it, so a 200 MB TIFF went straight into
    // readAsDataURL. Base64 inflates a file by ~37%, and the result is held in
    // memory, written to localStorage (~5 MB ceiling) and then into a Firestore
    // document (1 MiB ceiling). Whichever limit it hits first, the customer loses
    // the upload with no explanation.
    // The owner may set a LOWER limit from the dashboard, never a higher one —
    // above this the order cannot physically be stored.
    const configured = Number(settings.maxFileSizeMb);
    const maxMb = Number.isFinite(configured) && configured > 0 ? Math.min(configured, STORAGE_MAX_MB) : STORAGE_MAX_MB;
    const fileMb = file.size / (1024 * 1024);
    if (fileMb > maxMb) {
      setFileError(
        `${t('customUploadFileIs')} ${fileMb.toFixed(1)} MB. ${t('customUploadMaxIs')} ${maxMb} MB — ${t('customUploadCompressOrSend')}`,
      );
      setSelectedFile(null);
      replacePreviewUrl(null);
      setAnalyzingDpi(false);
      return;
    }

    const magicOk = await matchesMagicBytes(file, extension);
    if (analysis !== analysisGenerationRef.current) return;
    if (!magicOk) {
      setFileError(t('fileTypeMismatch'));
      setSelectedFile(null);
      replacePreviewUrl(null);
      setAnalyzingDpi(false);
      return;
    }

    setSelectedFile(file);

    // Read file data URL for downloads
    const readerGeneration = ++readerGenerationRef.current;
    setIsReadingFile(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      if (readerGenerationRef.current !== readerGeneration) return;
      setFileDataUrl(e.target?.result as string);
      setIsReadingFile(false);
    };
    reader.onerror = () => {
      if (readerGenerationRef.current !== readerGeneration) return;
      setFileError(t('cfgFileReadError'));
      setSelectedFile(null);
      setFileDataUrl(null);
      setIsReadingFile(false);
      setAnalyzingDpi(false);
    };
    reader.readAsDataURL(file);

    // If image format, create object URL for preview
    const previewableFormats = PREVIEWABLE_IMAGE_FORMATS.filter(f => cleanAllowed.includes(f));
    if (previewableFormats.includes(extension)) {
      replacePreviewUrl(URL.createObjectURL(file));
    } else {
      replacePreviewUrl(null);
    }

    // Perform client-side PDF & Image metadata resolution/DPI analysis
    try {
      const res = await analyzeFileDpi(file, settings.maxWidthCm);
      if (analysis !== analysisGenerationRef.current) return;
      setDpiResult(res);
      setNaturalWidthPx(res.naturalWidthPx);
      setNaturalHeightPx(res.naturalHeightPx);

      if (res.aspect || res.naturalWidthPx > 0) {
        // The printed area's proportions when the PDF states them (its TrimBox —
        // crop marks and slug excluded); otherwise the page or the image, as before.
        const ratio = res.aspect ?? res.naturalHeightPx / res.naturalWidthPx;
        const heightCm = Math.round(ratio * settings.maxWidthCm * 10) / 10;
        setCalculatedHeightCm(Math.max(1, heightCm));
      }
    } catch (err) {
      console.error('Error analyzing DPI metadata:', err);
    } finally {
      if (analysis === analysisGenerationRef.current) setAnalyzingDpi(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  // Determine effective print height (manual override or calculated)
  const effectiveHeightCm = customHeightOverride !== null ? customHeightOverride : (calculatedHeightCm || 35);
  const heightMeters = effectiveHeightCm / 100;

  // Meter pricing logic: price = heightMeters * pricePerLinearMeter
  const rawPrice = heightMeters * settings.pricePerLinearMeter;
  const isMinPriceApplied = rawPrice < settings.minPrice;
  const unitPrice = isMinPriceApplied ? settings.minPrice : Math.round(rawPrice * 100) / 100;
  const totalPrice = unitPrice * quantity;

  const handleAddToCart = async () => {
    // Not while the file is still being measured: its length — and where
    // production must place it — is not known yet.
    if (!selectedFile || isReadingFile || analyzingDpi || !fileDataUrl || uploadPct !== null) return;

    // The artwork goes to Firebase Storage, and the ORDER carries only its URL —
    // the old way embedded the whole file as base64 inside the cart and the
    // Firestore order document, which capped a print file at ~0.65 MB. Guests
    // get an anonymous auth identity so the bucket rules still know an owner.
    // If storage is unreachable (rules not yet published, network), fall back to
    // the embedded path with its old limits rather than losing the sale.
    let uploaded: { url: string; path: string } | null = null;
    try {
      let uid = auth.currentUser?.uid;
      if (!uid) uid = (await signInAnonymously(auth)).user.uid;
      setUploadPct(0);
      const up = await uploadFile(selectedFile, { userId: uid, folder: 'artwork', onProgress: setUploadPct });
      uploaded = { url: up.url, path: up.path };
    } catch (err) {
      console.warn('Storage upload unavailable — falling back to embedding the file:', err);
    } finally {
      setUploadPct(null);
    }

    const fileMb = selectedFile.size / (1024 * 1024);
    if (!uploaded && fileMb > MAX_FILE_MB) {
      setFileError(
        `${t('customUploadStorageDownStart')} ${fileMb.toFixed(1)} ${t('customUploadStorageDownMiddle')} ${MAX_FILE_MB} ${t('customUploadStorageDownEnd')}`,
      );
      return;
    }

    const artworkUrl = uploaded?.url ?? fileDataUrl;

    const cartItem = {
      id: `custom-${Date.now()}`,
      title: `${t('customUploadTitle')} (${settings.maxWidthCm}cm × ${effectiveHeightCm.toFixed(1)}cm)`,
      isCustomUpload: true,
      fileName: selectedFile.name,
      fileUrl: artworkUrl,
      widthCm: settings.maxWidthCm,
      heightCm: effectiveHeightCm,
      fileType: selectedFile.name.split('.').pop()?.toUpperCase() || 'PDF',
      fileSpecs: {
        fileName: selectedFile.name,
        fileUrl: artworkUrl,
        storagePath: uploaded?.path ?? null,
        fileSizeMb: (selectedFile.size / (1024 * 1024)).toFixed(2),
        fileType: selectedFile.name.split('.').pop()?.toUpperCase(),
        maxWidthCm: settings.maxWidthCm,
        widthCm: settings.maxWidthCm,
        heightCm: effectiveHeightCm,
        // The length READ OFF THE FILE, in its own field. It was overwritten with the
        // typed one above, so a 3 m file sold as 50 cm left no trace of the 3 m.
        calculatedHeightCm: calculatedHeightCm > 0 ? calculatedHeightCm : null,
        heightMeters: heightMeters,
        previewUrl: null,
        dpi: dpiResult && dpiResult.analyzable ? dpiResult.dpi : null,
        isLowDpi: dpiResult?.isLowDpi || false,
        // The length above came from the file's TrimBox, not its page: production
        // must place the file by that box, or the page's slug and marks print as
        // product and the length printed is not the length paid for (round 16 review).
        ...(dpiResult?.trim
          ? { placeBy: 'trimbox', pageWidthMm: dpiResult.trim.pageWidthMm, pageHeightMm: dpiResult.trim.pageHeightMm }
          : {}),
      },
      unitPrice,
      quantity,
      totalPrice
    };

    // Writing the cart can throw QuotaExceededError once base64 artwork pushes
    // it past the browser's ~5 MB store. With a storage URL the item is tiny and
    // none of this bites; the guards remain for the fallback path.
    try {
      const existingCart = JSON.parse(localStorage.getItem('reklamx_cart') || '[]');

      if (!uploaded) {
        // The server sums EMBEDDED artwork across the whole cart against one
        // document limit, so two files that each pass on their own can still
        // fail together. Say so now, not after the address form.
        const overflow = artworkWouldOverflow(existingCart, selectedFile?.size ?? 0);
        if (overflow) {
          setFileError(overflow);
          return;
        }
      }

      existingCart.push(cartItem);
      writeCart(existingCart);
      window.dispatchEvent(new Event('storage'));
    } catch (err) {
      console.error('Could not save the cart:', err);
      setFileError(
        t('shopCartSaveError'),
      );
      return;
    }

    setAddedToCartSuccess(true);
    setTimeout(() => setAddedToCartSuccess(false), 5000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-gray-900 text-white rounded-3xl p-8 md:p-12 mb-12 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-blue-500/10 backdrop-blur-2xl rounded-l-full pointer-events-none hidden md:block" />
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30 text-xs font-bold mb-4 tracking-wide uppercase">
            <Sparkles className="w-4 h-4 mr-2 text-blue-400" />
            {t('customUploadBadge')}
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight mb-4 leading-tight">
            {t('customUploadTitle')}
          </h1>
          <p className="text-lg text-blue-100/90 leading-relaxed mb-6">
            {t('customUploadSubtitle')}
          </p>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-white/10 text-xs font-semibold">
            <div className="flex items-center space-x-2 text-blue-200">
              <Ruler className="w-4 h-4 text-blue-400" />
              <span>{t('maxRollWidth')}: {settings.maxWidthCm} cm</span>
            </div>
            <div className="flex items-center space-x-2 text-blue-200">
              <Calculator className="w-4 h-4 text-blue-400" />
              <span>{t('ratePerMeter')}: {settings.pricePerLinearMeter} kr</span>
            </div>
            <div className="flex items-center space-x-2 text-blue-200">
              <Info className="w-4 h-4 text-blue-400" />
              <span>{t('minOrderPrice')}: {settings.minPrice} kr</span>
            </div>
            <div className="flex items-center space-x-2 text-blue-200">
              <FileCheck className="w-4 h-4 text-blue-400" />
              <span>{settings.allowedFormats.length} {t('customUploadFormatsAllowed')}</span>
            </div>
            {/* The limit was only ever revealed by the rejection message AFTER a
                too-big file was chosen. Say it up front, before the customer
                prepares a file we cannot take. */}
            <div className="flex items-center space-x-2 text-blue-200">
              <Info className="w-4 h-4 text-blue-400" />
              <span>
                {t('maxFileSizeLabel')}: {Math.min(Number(settings.maxFileSizeMb) > 0 ? Number(settings.maxFileSizeMb) : STORAGE_MAX_MB, STORAGE_MAX_MB)} MB
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left / Main Section: Upload Area & File Details */}
        <div className="lg:col-span-7 space-y-6">
          {/* File Drag & Drop Box */}
          <div 
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-3xl p-8 text-center transition-all cursor-pointer relative overflow-hidden bg-white shadow-sm",
              isDragging ? "border-blue-600 bg-blue-50/50 scale-[0.99]" : "border-gray-200 hover:border-blue-400 hover:bg-gray-50/50"
            )}
          >
            {/* opacity-0, NOT hidden — the input stays in the tab order, which
                is the only way to reach this drop zone without a mouse. It had
                no accessible name at all, so a keyboard user landed on an
                invisible control that announced nothing. */}
            <input
              type="file"
              aria-label={t('cfuChooseFileAria')}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded-3xl"
              onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
            />

            <div className="relative z-10 flex flex-col items-center justify-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-inner">
                <UploadCloud className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">
                  {t('dragDropFile')}
                </h3>
                <p className="text-sm text-gray-500">
                  {t('orBrowseFiles')}
                </p>
              </div>

              {/* Format badges */}
              <div className="flex flex-wrap justify-center gap-1.5 pt-2 max-w-md">
                {settings.allowedFormats.map((ext) => (
                  <span key={ext} className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-md text-[0.6875rem] font-bold uppercase tracking-wider">
                    .{ext.replace('.', '')}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Format Error Alert */}
          {fileError && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-3 text-red-800"
            >
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">{t('customUploadInvalidFormatTitle')}</p>
                <p className="text-xs text-red-700 mt-0.5">{fileError}</p>
              </div>
            </motion.div>
          )}

          {/* Uploaded File Summary & Interactive Visualizer */}
          {selectedFile && !fileError && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-3xl p-6 border border-gray-100 shadow-md space-y-6"
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                    <FileImage className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 text-base">{selectedFile.name}</h4>
                    <p className="text-xs text-gray-500">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • {selectedFile.name.split('.').pop()?.toUpperCase()}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2 space-x-reverse">
                  <span className="px-3 py-1 bg-green-50 text-green-700 font-bold text-xs rounded-full flex items-center border border-green-200">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                    {t('customUploadFormatValidated')}
                  </span>
                  {dpiResult && (
                    <span className={cn(
                      "px-3 py-1 font-mono font-black text-xs rounded-full border flex items-center",
                      !dpiResult.analyzable
                        ? "bg-gray-100 text-gray-700 border-gray-300"
                        : dpiResult.isLowDpi
                          ? "bg-amber-100 text-amber-900 border-amber-300"
                          : "bg-emerald-100 text-emerald-900 border-emerald-300"
                    )}>
                      {!dpiResult.analyzable
                        ? t('dpiUnknownBadge')
                        : dpiResult.isVector
                          ? t('dpiVectorBadge')
                          : `${dpiResult.dpi} DPI`}
                    </span>
                  )}
                </div>
              </div>

              {/* Client-Side DPI Analysis Utility Feedback */}
              {analyzingDpi && (
                <div className="p-4 bg-blue-50/80 border border-blue-200 rounded-2xl flex items-center space-x-3 text-blue-900 text-xs font-bold animate-pulse">
                  <RefreshCw className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                  <span>{t('dpiAnalyzing')}</span>
                </div>
              )}

              {dpiResult && !dpiResult.analyzable && (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl flex items-start space-x-3 text-gray-700 text-xs shadow-sm">
                  <div className="p-2 bg-gray-100 text-gray-600 rounded-xl border border-gray-200 shrink-0">
                    <Info className="w-5 h-5 text-gray-500" />
                  </div>
                  <div>
                    <span className="font-black block text-sm text-gray-900">{t('dpiNotAnalyzedTitle')}</span>
                    <span className="text-[0.6875rem] text-gray-600 font-medium block mt-0.5">
                      {t('dpiNotAnalyzedBody')}
                    </span>
                  </div>
                </div>
              )}

              {dpiResult && dpiResult.analyzable && dpiResult.isLowDpi && (
                <motion.div 
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-5 bg-amber-50/90 border-2 border-amber-300 rounded-2xl space-y-3.5 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-3 space-x-reverse">
                      <div className="p-2 bg-amber-200/80 text-amber-900 rounded-xl shrink-0 mt-0.5 border border-amber-300">
                        <AlertTriangle className="w-5 h-5 text-amber-700" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h5 className="font-extrabold text-amber-950 text-sm">
                            {t('dpiLowWarningTitle')}
                          </h5>
                          <span className="bg-amber-300 text-amber-950 font-mono font-black text-xs px-2.5 py-0.5 rounded-md border border-amber-400">
                            {dpiResult.dpi} DPI
                          </span>
                        </div>
                        <p className="text-xs text-amber-900/90 mt-1 font-medium leading-relaxed">
                          {t('dpiLowBodyStart')} <strong>{dpiResult.dpi} DPI</strong> {t('dpiLowBodyAtWidth')} <strong>{settings.maxWidthCm} cm</strong>. {t('dpiLowBodyStandard')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Resolution Comparison Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-white/90 p-3.5 rounded-xl border border-amber-200 shadow-inner">
                    <div className="space-y-0.5">
                      <span className="text-slate-500 font-extrabold block text-[0.625rem] uppercase tracking-wider">
                        {t('dpiCurrentResolutionLabel')}
                      </span>
                      <div className="font-mono font-black text-slate-900 text-sm">
                        {dpiResult.naturalWidthPx} × {dpiResult.naturalHeightPx} px
                      </div>
                      <span className="text-[0.6875rem] font-bold text-amber-700 block">
                        {t('dpiYields')} ~{dpiResult.dpi} {t('dpiAtPrintWidth')} {settings.maxWidthCm} cm
                      </span>
                    </div>

                    <div className="space-y-0.5 border-t sm:border-t-0 sm:border-r border-amber-200 sm:pr-3 pt-2 sm:pt-0">
                      <span className="text-slate-500 font-extrabold block text-[0.625rem] uppercase tracking-wider">
                        {t('dpiRecommendedLabel')}
                      </span>
                      <div className="font-mono font-black text-emerald-800 text-sm">
                        ~{dpiResult.recommendedWidthPx} {t('dpiPxWidth')}
                      </div>
                      <span className="text-[0.6875rem] font-bold text-emerald-600 block">
                        {t('dpiOptimalThreshold')}
                      </span>
                    </div>
                  </div>

                  <div className="text-[0.6875rem] text-amber-950 bg-amber-100/70 p-3 rounded-xl border border-amber-200/80 leading-relaxed font-medium">
                    💡 <strong>{t('dpiHowToImprove')}</strong>
                    <ul className="list-disc list-inside mt-1 space-y-0.5 text-amber-900">
                      <li>{t('dpiTipHigherRes')}</li>
                      <li>{t('dpiTipExport300')}</li>
                      <li>{t('dpiTipProceedAnyway')}</li>
                    </ul>
                  </div>
                </motion.div>
              )}

              {dpiResult && dpiResult.analyzable && !dpiResult.isLowDpi && (
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-950 shadow-sm">
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className="p-2 bg-emerald-100 text-emerald-800 rounded-xl border border-emerald-200 shrink-0">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <span className="font-black block text-sm text-emerald-950">{t('dpiHighResVerified')}</span>
                      <span className="text-[0.6875rem] text-emerald-800 font-medium block mt-0.5">
                        {dpiResult.isVector
                          ? t('dpiVectorDetected')
                          : `${t('dpiFileResolutionIs')} ${dpiResult.dpi} ${t('dpiMeetsStandard')}`}
                      </span>
                    </div>
                  </div>
                  <span className="bg-emerald-200/90 text-emerald-950 font-mono font-black text-xs px-3 py-1 rounded-lg border border-emerald-300 shrink-0">
                    {dpiResult.isVector ? t('dpiVectorBadge') : `${dpiResult.dpi} DPI`}
                  </span>
                </div>
              )}

              {/* Interactive Dimensions Display */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block mb-1">
                    {t('customUploadPrintWidth')} ({t('maxRollWidth')})
                  </span>
                  <div className="text-2xl font-black text-gray-900 flex items-baseline">
                    <span>{settings.maxWidthCm}</span>
                    <span className="text-sm font-semibold text-gray-500 ml-1">cm</span>
                  </div>
                  <p className="text-[0.6875rem] text-gray-500 mt-1">
                    {t('customUploadMaxRollPrintWidth')}
                  </p>
                </div>

                <div className="bg-blue-50/60 p-4 rounded-2xl border border-blue-100">
                  <span className="text-xs text-blue-600 font-bold uppercase tracking-wider block mb-1">
                    {t('heightCm')} ({t('heightMeters')})
                  </span>
                  <div className="text-2xl font-black text-blue-900 flex items-baseline">
                    <span>{effectiveHeightCm.toFixed(1)}</span>
                    <span className="text-sm font-semibold text-blue-600 ml-1">cm</span>
                  </div>
                  <p className="text-[0.6875rem] text-blue-700 mt-1">
                    {dpiResult?.trim
                      ? `${t('customUploadDerivedFromTrim')} — ${Math.round(dpiResult.trim.widthMm)} × ${Math.round(dpiResult.trim.heightMm)} mm`
                      : naturalWidthPx > 0
                        ? `${t('customUploadDerivedFromRatio')} (${naturalWidthPx}×${naturalHeightPx} px)`
                        : t('customUploadDefaultHeight')}
                  </p>
                </div>
              </div>

              {/* Manual Height Adjuster */}
              <div className="pt-2 border-t border-gray-100">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-bold text-gray-700">
                    {t('customUploadAdjustHeight')}
                  </label>
                  {customHeightOverride !== null && (
                    <button 
                      onClick={() => setCustomHeightOverride(null)}
                      className="text-xs text-blue-600 hover:underline flex items-center"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      {t('customUploadResetAutoHeight')}
                    </button>
                  )}
                </div>
                <input 
                  type="number" 
                  min="1" 
                  max="1000"
                  step="0.5"
                  value={effectiveHeightCm} 
                  onChange={(e) => setCustomHeightOverride(parseFloat(e.target.value) || 1)}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Image Canvas Preview with Rulers */}
              {filePreviewUrl && (
                <div className="relative bg-gray-100 rounded-2xl p-4 overflow-hidden border border-gray-200 flex flex-col items-center">
                  <span className="text-[0.625rem] font-bold text-gray-500 uppercase tracking-widest mb-2">
                    {t('customUploadPreviewTitle')}
                  </span>
                  <div className="relative border-2 border-blue-500/30 rounded-lg overflow-hidden max-h-72 bg-white shadow-inner">
                    <img 
                      src={filePreviewUrl} 
                      alt={t('customUploadPreviewAlt')} 
                      className="max-h-64 object-contain"
                    />
                    {/* Width Tag Overlay */}
                    <div className="absolute top-2 left-2 bg-black/75 text-white text-[0.625rem] font-bold px-2 py-0.5 rounded-md backdrop-blur-md">
                      ↔ {settings.maxWidthCm} cm
                    </div>
                    {/* Height Tag Overlay */}
                    <div className="absolute bottom-2 right-2 bg-blue-600 text-white text-[0.625rem] font-bold px-2 py-0.5 rounded-md shadow-md">
                      ↕ {effectiveHeightCm.toFixed(1)} cm
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* Right Section: Pricing Summary & Checkout */}
        <div className="lg:col-span-5">
          <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-xl space-y-6 sticky top-24">
            <h3 className="text-xl font-black text-gray-900 border-b border-gray-100 pb-4 flex items-center justify-between">
              <span>{t('dimensions')}</span>
              <Calculator className="w-5 h-5 text-blue-600" />
            </h3>

            {/* Price Calculation Breakdown */}
            <div className="space-y-3.5 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>{t('widthCm')}</span>
                <span className="font-bold text-gray-900">{settings.maxWidthCm} cm</span>
              </div>

              <div className="flex justify-between text-gray-600">
                <span>{t('heightCm')}</span>
                <span className="font-bold text-gray-900">{effectiveHeightCm.toFixed(1)} cm ({heightMeters.toFixed(3)} m)</span>
              </div>

              <div className="flex justify-between text-gray-600">
                <span>{t('ratePerMeter')}</span>
                <span className="font-bold text-gray-900">{settings.pricePerLinearMeter} {settings.currencySymbol}</span>
              </div>

              <div className="flex justify-between text-gray-600">
                <span>{t('calculatedPrice')}</span>
                <span className="font-bold text-gray-900">{rawPrice.toFixed(2)} {settings.currencySymbol}</span>
              </div>

              <div className="flex justify-between text-gray-600">
                <span>{t('minOrderPrice')}</span>
                <span className="font-bold text-gray-900">{settings.minPrice} {settings.currencySymbol}</span>
              </div>

              {/* Minimum price applied notification */}
              {selectedFile && isMinPriceApplied && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold flex items-center">
                  <Info className="w-4 h-4 text-amber-600 mr-2 shrink-0" />
                  <span>
                    {t('minPriceNotice')}
                  </span>
                </div>
              )}

              <div className="border-t border-gray-100 pt-4 flex justify-between items-center">
                <div>
                  <span className="font-bold text-gray-900 text-base block">{t('cfgUnitPriceNetLabel')}</span>
                  <span className="text-[0.625rem] text-gray-500 font-bold block">{t('vatTagExcl')}</span>
                </div>
                <span className="text-2xl font-black text-blue-600">
                  {unitPrice.toFixed(2)} {settings.currencySymbol}
                  {/* Fixed mode: the unit price is always net (the left-hand
                      label says so, but only in English — this tag translates). */}
                  <VatTag mode="excl" className="ml-1.5" />
                </span>
              </div>
            </div>

            {/* Quantity Selector */}
            <div className="pt-2">
              <label className="text-xs font-bold text-gray-700 block mb-2">{t('quantity')}</label>
              <div className="flex items-center space-x-3">
                <button 
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-10 h-10 bg-gray-100 rounded-xl font-bold text-gray-700 hover:bg-gray-200 transition-colors flex items-center justify-center text-lg"
                >
                  -
                </button>
                <input 
                  type="number" 
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 text-center font-black text-lg py-2 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button 
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-10 h-10 bg-gray-100 rounded-xl font-bold text-gray-700 hover:bg-gray-200 transition-colors flex items-center justify-center text-lg"
                >
                  +
                </button>
              </div>
            </div>

            {/* Total Price & Add to Cart Action */}
            {(() => {
              const totalVatInfo = formatPriceWithVat(totalPrice);
              return (
                <div className="bg-gray-900 text-white p-5 rounded-2xl space-y-4 shadow-xl">
                  {/* On a phone the label and the figure had been fighting for
                      one 340px row: the price broke as "149 / SEK" over two
                      lines and the note under it split mid-number, "Gross:
                      186.25" then "kr)". They stack on a narrow screen and sit
                      side by side from `sm` up, and neither one breaks inside
                      itself any more. */}
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 sm:gap-3">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-gray-300 block">{t('totalPrice')}</span>
                      <span className="text-[0.625rem] text-gray-400 font-extrabold block mt-0.5 whitespace-nowrap">
                        {includeVat
                          ? `${t('customUploadInclVat25')} (${totalVatInfo.vatAmount.toFixed(1)} kr ${t('customUploadVatWord')})`
                          : `${t('vatTagExcl')} (${t('customUploadGross')}: ${totalVatInfo.grossPrice} kr)`}
                      </span>
                    </div>
                    <span className="text-3xl font-black text-blue-400 whitespace-nowrap">
                      {totalVatInfo.formatted}
                      <VatTag dark className="ml-1.5" />
                    </span>
                  </div>

                  <button
                    onClick={handleAddToCart}
                    disabled={!selectedFile || !!fileError || isReadingFile || analyzingDpi || !fileDataUrl || uploadPct !== null}
                    className={cn(
                      "w-full py-4 rounded-xl font-bold text-base transition-all flex items-center justify-center shadow-lg",
                      selectedFile && !fileError && !isReadingFile && !analyzingDpi && fileDataUrl && uploadPct === null
                        ? "bg-blue-600 text-white hover:bg-blue-500 active:scale-98 shadow-blue-500/25 cursor-pointer"
                        : "bg-gray-700 text-gray-400 cursor-not-allowed"
                    )}
                  >
                    {isReadingFile || analyzingDpi || uploadPct !== null ? (
                      <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                      <ShoppingCart className="w-5 h-5 mr-2" />
                    )}
                    <span>
                      {uploadPct !== null
                        ? `${t('preparingFile')} ${uploadPct}%`
                        : isReadingFile || analyzingDpi ? t('preparingFile') : t('addToOrder')}
                    </span>
                  </button>
                </div>
              );
            })()}

            {/* Success Feedback */}
            {addedToCartSuccess && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="p-4 bg-green-50 border border-green-200 rounded-2xl flex items-center text-green-800 text-sm font-bold"
              >
                <Check className="w-5 h-5 text-green-600 mr-2 shrink-0" />
                <span>{t('customUploadAddedSuccess')}</span>
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
