import React, { useRef, useState } from 'react';
import { Check, FileText, Info, Loader2, Palette, PenTool, UploadCloud, X } from 'lucide-react';
import { PrintingField, PrintingFieldOption } from '../../types';
import { cn } from '../../lib/utils';
import { NEO } from '../NeumorphicSidebar';
import type { TranslationKey } from '../../lib/translations';
import NeoSizePreview from './NeoSizePreview';
import { ARTWORK_MIN_DPI, minPixelsFor } from '../../lib/artworkLimits';
import { ARTWORK_BLEED_MM } from '../../lib/artworkFit';
import { isChargedOnce } from '../../lib/chargeOnce';
import { isOptionAvailable } from '../../lib/optionAvailability';
import { isDesignerMethod } from '../../lib/onlineDesign';
import type { OutlineKind } from '../../lib/shapes';

/**
 * "How should your artwork reach us?" — the step every printed order needs and
 * this shop did not have.
 *
 * The shop already shipped an `artwork_supply_method` option field: upload a
 * print-ready PDF, send photos for us to lay out, order now and send the files
 * later, reprint a previous job, or buy the design service. Choosing one did
 * nothing at all — the file box was a separate section further down, shown only
 * on products flagged isWeb2Print, and nothing ever asked the customer for a file.
 * So an order could reach production with no artwork and no note saying why.
 *
 * Here the choice drives the flow: a method that means "I have the file" opens
 * the dropzone and holds add-to-cart until something is actually attached; a
 * method that means "not yet" says plainly what happens next and lets the order
 * through. The pricing is untouched — the cards ARE the field's own options, so
 * a surcharge like the design service still comes from the product document and
 * the server prices it exactly as before.
 */

/**
 * Values/ids that mean "no file in the dropzone" — everything else expects one.
 * "Design online" is here because its file comes from the designer, not the
 * dropzone. It is NOT a "no file" choice: the step holds the order until a design
 * is attached (the `designer` prop, round 16 item 5).
 */
const NO_FILE_IDS = new Set([
  'af-supply-later',
  'af-supply-reprint',
  'af-supply-designer',
  'af-supply-template',
]);
const NO_FILE_VALUES = /later|reprint|design_service|online_template|no_artwork/i;

/**
 * Which options a customer may see is decided in src/lib/optionAvailability.ts
 * (hidden ones, and the design service's "Design it online", which has nothing
 * behind it) and src/lib/onlineDesign.ts (the artwork step's own "Design online",
 * on the products that offer it). The configurator filters with both; the filter
 * below stays as a second guard for any caller that hands the step a raw field.
 */

/** True when picking this option obliges the customer to attach a file now. */
export function methodNeedsArtwork(option?: PrintingFieldOption): boolean {
  if (!option) return true;
  if (NO_FILE_IDS.has(option.id)) return false;
  if (NO_FILE_VALUES.test(option.value || '')) return false;
  if (NO_FILE_VALUES.test(option.label || '')) return false;
  return true;
}

export interface ArtworkUploadState {
  fileName: string;
  /** 0–100 while a Storage upload runs, null when idle. */
  progress: number | null;
  error: string;
  /** Set once the file is safely in object storage. */
  storedUrl?: string | null;
}

interface NeoArtworkStepProps {
  /** The product's own artwork_supply_method field, when it has one. */
  field?: PrintingField;
  selected?: PrintingFieldOption;
  onSelect: (option: PrintingFieldOption) => void;
  labelOf: (option: PrintingFieldOption) => string;
  /** Formats a net SEK surcharge for a card. */
  formatPrice: (amount: number) => string;
  upload: ArtworkUploadState;
  onPickFile: (file: File) => void;
  onClearFile: () => void;
  /** Comma-separated accept list for the file input. */
  accept: string;
  /**
   * Is the file obligatory before this product can be bought? False is the
   * shop's default — the dropzone is still there, it just does not hold the
   * order hostage, and it says so rather than leaving the shopper guessing.
   */
  required?: boolean;
  /** The largest file this shop can take right now, in MB. */
  maxMb: number;
  /** "200 × 100 cm" — what the artwork has to match. */
  sizeLabel?: string;
  /** The same size as numbers, so the preview can draw it to scale. */
  sizeMm?: { wMm: number; hMm: number } | null;
  /**
   * For the PREVIEW only, when it differs from sizeMm: a round item sized
   * "30 mm ø", which the file check deliberately does not use (src/lib/shapes.ts).
   */
  previewMm?: { wMm: number; hMm: number } | null;
  /** The cut shape the customer chose — the preview clips the artwork to it. */
  outline?: OutlineKind | null;
  /** The chosen file, drawn inside the size frame. */
  file?: File | null;
  /** "91 × 61 mm" — the same size with the shop's 3 mm bleed, which the check accepts too. */
  bleedSizeLabel?: string;
  /** Millimetres of bleed the attached file carries, so the preview cuts it off as the cutter will. */
  fileBleedMm?: number | null;
  /** A PDF measured by its own TrimBox: the region its preview draws (src/lib/pdfBoxes.ts). */
  filePdfBox?: number[] | null;
  /**
   * The shop makes this line's artwork — a reprint, or the studio (src/lib/artwork.ts).
   * The notes then say what the customer sends instead (a reply to the order
   * confirmation, which asks for it): "we will email you where to send your file"
   * was a promise no e-mail kept, because such a line owes no file.
   */
  shopArtwork?: 'reprint' | 'studio' | null;
  /**
   * The online designer, when the chosen method is "Design online" (round 16,
   * item 5). The step then shows a way into the designer instead of the
   * dropzone. Until a design is attached, the configurator holds the order.
   */
  designer?: {
    /** Why it cannot open for the size chosen now, already in words; absent when it can. */
    blocked?: string;
    /** A design from the designer is attached to this line. */
    attached: boolean;
    onOpen: () => void;
    /** "You changed the size…": said after a design was taken off. */
    notice?: string;
  };
  t: (key: TranslationKey) => string;
}

export default function NeoArtworkStep({
  field,
  selected,
  onSelect,
  labelOf,
  formatPrice,
  upload,
  onPickFile,
  onClearFile,
  accept,
  required = false,
  maxMb,
  sizeLabel,
  sizeMm,
  file,
  t,
  previewMm,
  outline,
  designer,
  bleedSizeLabel,
  fileBleedMm,
  filePdfBox,
  shopArtwork = null,
}: NeoArtworkStepProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const options = (field?.options ?? []).filter(isOptionAvailable);
  // Without the field there is nothing to choose between, but the customer still
  // has to send us a file — so the dropzone stands on its own.
  const designing = !!field && !!designer && isDesignerMethod(selected);
  const needsArtwork = field ? methodNeedsArtwork(selected) : true;
  const uploading = upload.progress !== null;

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onPickFile(file);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[0.6875rem] font-black uppercase text-gray-400 tracking-wider">
          {t('ppArtworkHeading')}
        </h3>
        {!required && (
          <span className="px-2 py-0.5 rounded-full text-[0.5625rem] font-black uppercase tracking-wider text-gray-500 bg-[#e9ebf2] shadow-[inset_2px_2px_5px_#c9cdd8,inset_-2px_-2px_5px_#ffffff]">
            {t('ppArtworkOptional')}
          </span>
        )}
      </div>

      {options.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-extrabold text-gray-900">
              <span>{t('ppArtworkMethodQuestion')}</span>
              {field?.description && (
                <span
                  title={field.description}
                  aria-label={t('cfgFieldInfo')}
                  className="cursor-help text-gray-400 hover:text-orange-600 transition-colors"
                >
                  <Info className="w-3.5 h-3.5" />
                </span>
              )}
            </span>
            {selected && (
              <span className="text-[0.6875rem] font-black text-orange-600 truncate max-w-[50%]">
                {labelOf(selected)}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {options.map((option) => {
              const isSelected = selected?.id === option.id;
              const mod = option.priceModifier || 0;
              const wantsFile = methodNeedsArtwork(option);
              const designs = isDesignerMethod(option);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelect(option)}
                  aria-pressed={isSelected}
                  className={cn(
                    'relative p-3.5 rounded-2xl text-left flex flex-col gap-1 transition-all duration-300',
                    NEO.card,
                    NEO.ease,
                    isSelected
                      ? 'ring-2 ring-orange-500 -translate-y-0.5 text-gray-900 shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]'
                      : 'text-gray-700 shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff] hover:shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff] hover:-translate-y-0.5',
                  )}
                >
                  {/* The catalogue marks both "Upload a PDF" and "Design online"
                      as recommended; two badges side by side recommend nothing. */}
                  {option.recommended && !designs && (
                    <span className="absolute -top-2 left-3 z-10 px-2 py-0.5 rounded-full text-[0.5625rem] font-black uppercase tracking-wider text-white bg-gradient-to-br from-orange-500 to-orange-700 shadow-[3px_3px_8px_#c9cdd8]">
                      {t('cfgRecommended')}
                    </span>
                  )}

                  <span className="flex items-start justify-between gap-2 w-full">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0',
                          isSelected ? 'text-orange-600' : 'text-gray-400',
                          NEO.card,
                          NEO.raisedSm,
                        )}
                      >
                        {designs ? <PenTool className="w-4 h-4" /> : wantsFile ? <UploadCloud className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                      </span>
                      <span className="text-xs font-extrabold leading-tight">{labelOf(option)}</span>
                    </span>
                    {isSelected && (
                      <span className="w-4 h-4 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                  </span>

                  <span
                    className={cn(
                      'text-[0.625rem] font-black pl-10',
                      mod !== 0 ? 'text-orange-600' : 'text-gray-400',
                    )}
                  >
                    {mod !== 0
                      ? t(isChargedOnce(option) ? 'cfgSurchargeOnce' : 'cfgSurchargePerUnit')
                          .replace('{0}', mod > 0 ? `+${mod}` : String(mod))
                      : t('cfgPriceIncluded')}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {designing && designer ? (
        // Focusable, so focus has somewhere to land when the designer closes
        // and the button that opened it has turned into the upload's progress.
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start outline-none" data-rx-designer-step tabIndex={-1}>
          {/* "Design online": the way into the designer, and once a design is
              attached, the design itself. The order waits for it: choosing this
              and adding to the basket with nothing designed would send production
              an order with no artwork and no note saying why. */}
          <div className={cn('p-5 rounded-2xl space-y-3 text-center bg-[#e9ebf2]', NEO.inset)}>
            <span className={cn('mx-auto w-10 h-10 rounded-2xl flex items-center justify-center text-orange-600', NEO.card, NEO.raisedSm)}>
              <Palette className="w-5 h-5" />
            </span>
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 text-orange-600 animate-spin" />
                <span className="text-xs font-black text-gray-900">
                  {t('ppArtworkUploading').replace('{0}', String(upload.progress ?? 0))}
                </span>
              </div>
            ) : designer.attached && upload.fileName ? (
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-xs font-black text-gray-900 break-all px-2" data-rx-designer-file>{upload.fileName}</span>
                <span className="text-[0.625rem] font-bold text-green-700">
                  {upload.storedUrl ? t('dsgReady') : t('ppArtworkAttached')}
                </span>
                <span className="flex flex-wrap justify-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={designer.onOpen}
                    disabled={!!designer.blocked}
                    className="px-3 py-1.5 rounded-full text-[0.6875rem] font-black text-white bg-gradient-to-br from-orange-500 to-orange-700 disabled:opacity-40"
                  >
                    {t('dsgEdit')}
                  </button>
                  <button
                    type="button"
                    onClick={onClearFile}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black text-gray-600 bg-[#eceef4] shadow-[4px_4px_10px_#c9cdd8,-4px_-4px_10px_#ffffff] hover:text-orange-600"
                  >
                    <X className="w-3 h-3" />
                    {t('dsgRemove')}
                  </button>
                </span>
              </div>
            ) : (
              <>
                <p className="text-xs font-bold text-gray-700">{t('dsgIntro')}</p>
                <button
                  type="button"
                  onClick={designer.onOpen}
                  disabled={!!designer.blocked}
                  data-rx-designer-open
                  className="px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-wider text-white bg-gradient-to-br from-orange-500 to-orange-700 shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('dsgOpen')}
                </button>
              </>
            )}
            {designer.blocked && !uploading && (
              <p className="text-[0.6875rem] font-black text-orange-800" data-rx-designer-blocked>{designer.blocked}</p>
            )}
            {designer.notice && (
              <p className="text-[0.6875rem] font-black text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-designer-notice>
                {designer.notice}
              </p>
            )}
            {upload.error && (
              <p className="text-[0.625rem] font-black text-red-600 bg-red-50 p-1.5 rounded-lg">{upload.error}</p>
            )}
          </div>
          <NeoSizePreview
            widthMm={(previewMm ?? sizeMm)?.wMm}
            heightMm={(previewMm ?? sizeMm)?.hMm}
            file={designer.attached ? file : null}
            sizeLabel={sizeLabel}
            outline={outline}
            t={t}
            className={cn('mx-auto md:mx-0 p-3 rounded-2xl', NEO.card, NEO.raisedSm)}
          />
        </div>
      ) : needsArtwork ? (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-4 items-start">
          {/* The dropzone. It says the size the artwork has to be, because the
              file is checked against the size chosen above and being told that
              AFTER the rejection is no help at all. */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFiles(e.dataTransfer?.files ?? null);
            }}
            className={cn(
              'p-6 rounded-2xl border-2 border-dashed space-y-2 text-center relative bg-[#e9ebf2] transition-colors',
              NEO.inset,
              dragging ? 'border-orange-500' : 'border-[#c9cdd8] hover:border-orange-400',
              'focus-within:border-orange-500 focus-within:ring-2 focus-within:ring-orange-500',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              onChange={(e) => {
                // Taken, then cleared: picking the SAME file again — after a
                // refusal, or "Remove" — fired no change and did nothing (code
                // review WEB-13). The list is live, so the file is read first.
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onPickFile(f);
              }}
              accept={accept}
              disabled={uploading}
              aria-label={t('ppArtworkDrop')}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10 disabled:cursor-wait"
            />

            {upload.fileName && !uploading ? (
              <div className="flex flex-col items-center gap-1.5">
                <span
                  className={cn(
                    'w-10 h-10 rounded-2xl flex items-center justify-center text-orange-600',
                    NEO.card,
                    NEO.raisedSm,
                  )}
                >
                  <FileText className="w-5 h-5" />
                </span>
                <span className="text-xs font-black text-gray-900 break-all px-4">
                  {upload.fileName}
                </span>
                <span className="text-[0.625rem] font-bold text-green-700">
                  {upload.storedUrl ? t('ppArtworkStored') : t('ppArtworkAttached')}
                </span>
                <button
                  type="button"
                  onClick={onClearFile}
                  className="relative z-20 mt-1 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black text-gray-600 bg-[#eceef4] shadow-[4px_4px_10px_#c9cdd8,-4px_-4px_10px_#ffffff] hover:text-orange-600"
                >
                  <X className="w-3 h-3" />
                  {t('ppArtworkRemove')}
                </button>
              </div>
            ) : uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-6 h-6 text-orange-600 animate-spin" />
                <span className="text-xs font-black text-gray-900">
                  {t('ppArtworkUploading').replace('{0}', String(upload.progress ?? 0))}
                </span>
                <div className="w-40 h-1.5 rounded-full bg-[#d8dbe4] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-orange-500 to-orange-700 transition-all duration-200"
                    style={{ width: `${upload.progress ?? 0}%` }}
                  />
                </div>
              </div>
            ) : (
              /* ONLY THE ICON IN THE BOX (2026-10-13): the six lines of instructions
                 made a wall of text the eye skipped anyway. The same instructions
                 stay in the box for screen readers (sr-only); what a sighted
                 customer needs is the big arrow that says "drop it here". */
              <div className="flex flex-col items-center justify-center py-4">
                <UploadCloud className="w-20 h-20 text-orange-600 transition-transform duration-300 group-hover:-translate-y-1" strokeWidth={1.25} aria-hidden />
                <span className="sr-only">
                <span className="text-xs font-black text-gray-900">{t('ppArtworkDrop')}</span>
                {sizeLabel && (
                  <span className="text-[0.625rem] font-black text-orange-600">
                    {/* Both sizes the check accepts (src/lib/artworkFit.ts): the
                        bleed the line below asks for is not a reason to refuse. */}
                    {t('ppArtworkSizeHint').replace(
                      '{0}',
                      bleedSizeLabel ? sizeLabel + t('cfgOrWithBleed').replace('{0}', bleedSizeLabel) : sizeLabel,
                    )}
                  </span>
                )}
                {/* WHAT "AT THE RIGHT SIZE" ACTUALLY MEANS — 15.6.2.
                    The pixel count and the bleed decide whether a file is
                    usable, and the customer only ever met them in a REJECTION:
                    the resolution figure lived in the error message and the
                    3 mm bleed in a separate tab he had no reason to open. Said
                    here, before he picks a file, they are instructions instead
                    of complaints. */}
                {sizeMm && sizeMm.wMm > 0 && sizeMm.hMm > 0 && (
                  <span className="text-[0.625rem] font-bold text-gray-500">
                    {/* THE NUMBER THE UPLOADER ACTUALLY ENFORCES — 15.6.2b.
                        This said 300 DPI while handlePickFile accepted 150, so
                        the shop told a customer his roll-up needed
                        10039 × 23622 px "or it prints blurred" and then took
                        5020 × 11812 without a word. One constant now feeds the
                        sentence and the check. */}
                    {/* The pixels for the size WITH its bleed: enough for either
                        reading, so a customer who follows both lines here is never
                        refused for following them (round 16 review). */}
                    {t('ppArtworkPixelHint')
                      .replace('{0}', String(minPixelsFor(sizeMm.wMm + 2 * ARTWORK_BLEED_MM)))
                      .replace('{1}', String(minPixelsFor(sizeMm.hMm + 2 * ARTWORK_BLEED_MM)))
                      .replace('{2}', String(ARTWORK_MIN_DPI))}
                  </span>
                )}
                {sizeMm && (
                  <span className="text-[0.625rem] font-bold text-gray-400">{t('ppGuidelineBleed')}</span>
                )}
                <span className="text-[0.625rem] text-gray-400 font-bold">
                  {t('cfgAllowedFormatsHint')
                    .replace('{0}', accept.replace(/\./g, '').toUpperCase())
                    .replace('{1}', String(maxMb))}
                </span>
                {/* Without this the empty dropzone reads as a wall. It is not:
                    the order goes through with no file and we ask for it after. */}
                {!required && (
                  <span className="text-[0.625rem] font-black text-emerald-700 px-4">
                    {t(shopArtwork === 'studio' ? 'ppArtworkStudioDropNote' : 'ppArtworkOptionalNote')}
                  </span>
                )}
                </span>
              </div>
            )}

            {upload.error && (
              <p className="text-[0.625rem] font-black text-red-600 bg-red-50 p-1.5 rounded-lg relative z-20">
                {upload.error}
              </p>
            )}
          </div>

          {/* The chosen size, drawn to scale, with the artwork inside it once
              there is one. Standing beside the dropzone rather than under it, so
              it is in view while the file is being picked. */}
          <NeoSizePreview
            widthMm={(previewMm ?? sizeMm)?.wMm}
            heightMm={(previewMm ?? sizeMm)?.hMm}
            file={file}
            sizeLabel={sizeLabel}
            outline={outline}
            bleedMm={fileBleedMm ?? 0}
            pdfBox={filePdfBox ?? null}
            t={t}
            className={cn('mx-auto md:mx-0 p-3 rounded-2xl', NEO.card, NEO.raisedSm)}
          />
        </div>
      ) : (
        <p
          className={cn(
            'text-[0.6875rem] font-bold text-gray-600 p-3.5 rounded-2xl flex items-start gap-2',
            NEO.card,
            NEO.raisedSm,
          )}
        >
          <FileText className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
          <span data-rx-artwork-note={shopArtwork ?? 'later'}>
            {t(shopArtwork === 'reprint' ? 'ppArtworkReprintNote' : shopArtwork === 'studio' ? 'ppArtworkStudioNote' : 'ppArtworkLaterNote')}
          </span>
        </p>
      )}
    </section>
  );
}
