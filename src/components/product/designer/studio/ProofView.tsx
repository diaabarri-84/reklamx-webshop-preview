/**
 * "Check your design" — every page as it will look after cutting, what the file is,
 * and what could go wrong (a blurry picture, text outside the safe area, something
 * ending right at the cut line, a QR code a phone may not read, an empty page, empty
 * photo frames). Nothing is attached until the customer ticks that he has checked it.
 */
import React from 'react';
import NeoSizePreview from '../../NeoSizePreview';
import type { TranslationKey } from '../../../../lib/translations';
import type { OutlineKind } from '../../../../lib/shapes';
import type { SideId } from '../../../../lib/designDoc';
import { imageQuality } from '../../../../lib/designSize';

export interface ProofData {
  file: File;
  previews: Array<{ side: SideId; file: File }>;
  dpi: number;
  format: 'png' | 'pdf';
  pages: number;
  widthPx?: number;
  heightPx?: number;
  lowestDpi: number | null;
  textOutside: SideId[];
  /** Sides with a QR code a phone may not read (too small, or too little contrast). */
  qrWeak: SideId[];
  /** Sides with something that ends right at the cut line, where a cut a hair off shows. */
  edgeAtCut: SideId[];
  blank: SideId[];
  emptySlots: number;
}

export default function ProofView({
  proof,
  t,
  trimMm,
  outline,
  sizeLabel,
  bleedMm,
  dpiSpec,
  sideLabel,
  twoSided,
  checked,
  onCheck,
  onBack,
  onAttach,
}: {
  proof: ProofData;
  t: (k: TranslationKey) => string;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  sizeLabel?: string;
  bleedMm: number;
  /** The product's own floor and target resolution (its print values). */
  dpiSpec?: { minDpi: number; targetDpi: number };
  sideLabel: (s: SideId) => string;
  twoSided: boolean;
  checked: boolean;
  onCheck: (v: boolean) => void;
  onBack: () => void;
  onAttach: () => void;
}) {
  // Judged against this product's own resolutions, not fixed numbers.
  const quality = proof.lowestDpi !== null ? imageQuality(proof.lowestDpi, dpiSpec) : null;
  const fileLine =
    proof.format === 'png' && proof.widthPx && proof.heightPx
      ? t('stProofPng').replace('{0}', String(proof.widthPx)).replace('{1}', String(proof.heightPx)).replace('{2}', String(proof.dpi)).replace('{3}', String(bleedMm))
      : t('stProofPdf')
          .replace('{0}', proof.pages > 1 ? t('stTwoPages') : t('stOnePage'))
          .replace('{1}', String(proof.dpi))
          .replace('{2}', String(bleedMm));
  const onSide = (s: SideId, text: string) => (twoSided ? t('stProofOnSide').replace('{0}', sideLabel(s)).replace('{1}', text) : text);
  return (
    <div className="absolute inset-0 z-[230] overflow-y-auto bg-[#e9ebf1] p-4" data-rx-proof>
      <div className="max-w-2xl mx-auto space-y-3">
        <h3 className="text-sm font-black text-gray-900">{t('dsgProofTitle')}</h3>
        <p className="text-[0.6875rem] font-bold text-gray-500">{t('stProofLook')}</p>
        <div className={twoSided ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : ''} data-rx-proof-pages={proof.previews.length}>
          {proof.previews.map((p) => (
            <figure key={p.side} className="rounded-2xl bg-white p-3 space-y-1.5" data-rx-proof-page={p.side}>
              {twoSided && <figcaption className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{sideLabel(p.side)}</figcaption>}
              <NeoSizePreview widthMm={trimMm.wMm} heightMm={trimMm.hMm} file={p.file} sizeLabel={sizeLabel} outline={outline} t={t} className="mx-auto" />
            </figure>
          ))}
        </div>
        <p className="text-[0.6875rem] font-bold text-gray-600" data-rx-proof-file>{fileLine}</p>
        <ul className="space-y-1.5">
          {quality === 'poor' && (
            <li className="text-[0.6875rem] font-black text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2" data-rx-proof-warning="photo-poor">
              {t('dsgProofPhotoPoor').replace('{0}', String(Math.round(proof.lowestDpi ?? 0)))}
            </li>
          )}
          {quality === 'fair' && (
            <li className="text-[0.6875rem] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-proof-warning="photo-fair">
              {t('dsgProofPhotoFair').replace('{0}', String(Math.round(proof.lowestDpi ?? 0)))}
            </li>
          )}
          {proof.textOutside.map((s) => (
            <li key={`edge-${s}`} className="text-[0.6875rem] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-proof-warning="text-edge">
              {onSide(s, t('stProofTextOutside'))}
            </li>
          ))}
          {proof.edgeAtCut.map((s) => (
            <li key={`cut-${s}`} className="text-[0.6875rem] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-proof-warning="edge-at-cut">
              {onSide(s, t('stProofEdgeAtCut'))}
            </li>
          ))}
          {proof.qrWeak.map((s) => (
            <li key={`qr-${s}`} className="text-[0.6875rem] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-proof-warning="qr">
              {onSide(s, t('stProofQrWeak'))}
            </li>
          ))}
          {proof.blank.map((s) => (
            <li key={`blank-${s}`} className="text-[0.6875rem] font-black text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-proof-warning={`blank-${s}`}>
              {t(s === 'back' ? 'stProofBackBlank' : 'stProofFrontBlank')}
            </li>
          ))}
          {proof.emptySlots > 0 && (
            <li className="text-[0.6875rem] font-bold text-gray-600 bg-white border border-gray-200 rounded-xl px-3 py-2" data-rx-proof-warning="empty-frames">
              {t('dsgProofEmptySlots')}
            </li>
          )}
          <li className="text-[0.6875rem] font-bold text-gray-500 bg-white border border-gray-200 rounded-xl px-3 py-2">{t('dsgProofColours')}</li>
        </ul>
        <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-gray-200 cursor-pointer">
          <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#0b77c4]" data-rx-proof-tick />
          <span className="text-xs font-bold text-gray-800">{t('dsgProofTick')}</span>
        </label>
        <div className="flex flex-wrap gap-2 justify-end pb-6">
          <button type="button" onClick={onBack} className="px-4 py-2.5 rounded-full text-xs font-black text-gray-700 bg-white border border-gray-300" data-rx-proof-back>
            {t('dsgProofBack')}
          </button>
          <button
            type="button"
            onClick={onAttach}
            disabled={!checked}
            data-rx-proof-attach
            className="px-5 py-2.5 rounded-full text-xs font-black text-white bg-[#0b77c4] hover:bg-[#0a68ab] disabled:opacity-40"
          >
            {t('dsgProofAttach')}
          </button>
        </div>
      </div>
    </div>
  );
}
