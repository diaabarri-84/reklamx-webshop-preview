/**
 * Designs: the shop's ready-made designs that fit this size and cut, and a blank
 * start. Choosing one replaces what is on the pages — one step, undone with Undo.
 * The list is the gallery's own (src/lib/templateOrder.ts offeredDesigns): none the
 * owner hid, the shop's own only while he offers them, in his order. An admin
 * looking at the page also sees his templates left out here, and why.
 */
import React from 'react';
import { FilePlus2, LayoutTemplate, Loader2 } from 'lucide-react';
import type { Language, TranslationKey } from '../../../../../lib/translations';
import { localized } from '../../../../../lib/localizedText';
import { templateMiss, type TemplateMiss } from '../../../../../lib/designTemplateMatch';
import type { OutlineKind } from '../../../../../lib/shapes';
import type { TemplateSummary } from '../../types';
import type { StarterContext, StarterDef } from '../../../../../lib/starterTemplates';
import type { OfferedDesign } from '../../../../../lib/templateOrder';
import { StarterPicture } from '../TemplateGallery';

const MISS_TEXT: Record<TemplateMiss, string> = {
  'no-size': 'no size chosen yet',
  cut: 'made for another cut shape',
  proportions: 'made for other proportions',
  'product-smaller': 'this size is too small for it (under 0.85×)',
  'product-larger': 'this size is too large for it (over 2×)',
  pictures: 'its pictures would print under 150 DPI here',
};

export default function DesignsPanel({
  t,
  language,
  templates,
  designs,
  starterCtx,
  trimMm,
  outline,
  showMisses,
  busy,
  onRetry,
  onPick,
  onBlank,
}: {
  t: (k: TranslationKey) => string;
  language: Language;
  /** His templates as the shop sent them (undefined while they load, null when they could not be had). */
  templates: TemplateSummary[] | null | undefined;
  /** What is offered here, in his order: his that fit, and the shop's own. */
  designs: OfferedDesign<TemplateSummary, StarterDef>[];
  starterCtx: StarterContext;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  showMisses: boolean;
  busy: boolean;
  onRetry?: () => void;
  onPick: (t: { id: string }, variant?: string) => void;
  onBlank: () => void;
}) {
  const missed = showMisses
    ? (templates ?? []).flatMap((x) => {
        const why = templateMiss(x, trimMm, outline);
        return why ? [{ x, why }] : [];
      })
    : [];
  return (
    <div className="space-y-4" data-rx-st-panel="designs">
      {/* Pixart's "Models": the count, then the designs as pictures, two by two. */}
      <div className="flex items-center justify-between">
        <p className="text-[0.75rem] leading-snug text-[#555555] max-w-[62%]">{t('dsgLayoutReplaces')}</p>
        <span className="text-[0.9375rem] text-[#1d1d1d] tabular-nums">{t('stGalResults').replace('{0}', String(designs.length))}</span>
      </div>
      <div className="grid grid-cols-2 gap-3" data-rx-shop-templates>
        <button
          type="button"
          onClick={onBlank}
          disabled={busy}
          data-rx-st-blank
          className="flex flex-col items-center justify-center gap-2 p-3 rounded border border-dashed border-[#a9cfee] bg-[#f7fbfe] hover:border-[#0b77c4] text-[#0b77c4] aspect-[3/2] disabled:opacity-50"
        >
          <FilePlus2 className="w-7 h-7" strokeWidth={1.5} />
          <span className="text-[0.75rem] font-bold text-center">{t('stDesignsBlank')}</span>
        </button>
        {designs.map((d) => {
          if (d.type === 'shop') {
            const x = d.summary;
            const name = localized(x.name, x.nameI18n, language);
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => onPick(x)}
                disabled={busy}
                title={name}
                aria-label={name}
                data-rx-shop-template={x.id}
                className="block rounded overflow-hidden border border-[#e3e3e3] bg-white hover:border-[#0b77c4] transition disabled:opacity-50"
              >
                <span className="w-full aspect-[3/2] flex items-center justify-center bg-white">
                  {x.thumbnailUrl ? <img src={x.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <LayoutTemplate className="w-8 h-8 text-gray-300" />}
                </span>
              </button>
            );
          }
          const def = d.def;
          const name = t(def.labelKey as TranslationKey);
          return (
            <button
              key={def.id}
              type="button"
              onClick={() => onPick({ id: def.id }, def.palettes[0].id)}
              disabled={busy}
              title={name}
              aria-label={name}
              data-rx-st-starter={def.id}
              className="block rounded overflow-hidden border border-[#e3e3e3] bg-white hover:border-[#0b77c4] transition disabled:opacity-50"
            >
              <StarterPicture def={def} palette={def.palettes[0]} side="front" ctx={starterCtx} aspect={Math.max(0.6, Math.min(1.8, trimMm.wMm / trimMm.hMm))} maxPx={240} />
            </button>
          );
        })}
      </div>
      {templates === undefined && (
        <p className="flex items-center gap-2 text-[0.6875rem] font-bold text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('dsgTemplatesLoading')}
        </p>
      )}
      {templates === null && (
        <div className="flex flex-wrap items-center gap-3 text-[0.6875rem] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-templates-failed>
          <span className="flex-1 min-w-[8rem]">{t('dsgTemplatesListFailed')}</span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="font-black text-[#0b77c4] shrink-0" data-rx-templates-retry>
              {t('dsgRetry')}
            </button>
          )}
        </div>
      )}
      {Array.isArray(templates) && designs.length === 0 && <p className="text-[0.6875rem] font-bold text-gray-400">{t('stDesignsNone')}</p>}
      {missed.length > 0 && (
        <div className="text-[0.625rem] font-bold text-gray-500 bg-white border border-dashed border-gray-300 rounded-xl px-3 py-2 space-y-0.5" data-rx-template-misses>
          <p className="font-black text-gray-600">Only you see this (admin): templates for this product that are not offered at this size —</p>
          {missed.map(({ x, why }) => (
            <p key={x.id}>
              “{x.name}” — {MISS_TEXT[why]} (made for {Math.round(x.trimMm.wMm)} × {Math.round(x.trimMm.hMm)} mm)
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
