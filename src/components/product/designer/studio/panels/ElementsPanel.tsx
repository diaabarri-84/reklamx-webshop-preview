/**
 * Elements: shapes, lines and arrows, frames, badges, icons, social-media marks and
 * emojis — the shop's own whitelisted library (elementLibrary.json, built by
 * scripts/build-designer-elements.mjs), named in the customer's language and searched
 * by its names and keywords in his language and in English, and by its category's
 * words (elementNames.ts). Laid out as Pixart's Elements: a search box, then each
 * category as a row of three with "Show all". Photo frames are Masks now (MasksPanel.tsx).
 */
import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import type { Language, TranslationKey } from '../../../../../lib/translations';
import library from '../../elementLibrary.json';
import type { StudioEngine } from '../engine';
import { elementLabel, elementMatches, type NamedElement } from '../elementNames';

export interface LibraryElement extends NamedElement {
  id: string;
  lib: string;
  category: string;
  paint: 'fill' | 'stroke' | 'none';
  svg: string;
}

export const ELEMENTS = library as LibraryElement[];

const CATEGORIES: Array<{ id: string; label: TranslationKey }> = [
  { id: 'shapes', label: 'stElShapes' },
  { id: 'lines', label: 'stElLines' },
  { id: 'frames', label: 'stElFrames' },
  { id: 'badges', label: 'stElBadges' },
  { id: 'contacts', label: 'stElIcons' },
  { id: 'socials', label: 'stElSocials' },
  { id: 'emojis', label: 'stElEmojis' },
];

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export default function ElementsPanel({ engine, t, language, onDone }: { engine: StudioEngine; t: (k: TranslationKey) => string; language: Language; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const matching = useMemo(() => {
    if (!query.trim()) return [];
    return ELEMENTS.filter((e) => {
      const cat = CATEGORIES.find((c) => c.id === e.category);
      return elementMatches(e, query, language, cat ? t(cat.label) : '');
    });
  }, [query, t, language]);

  const add = async (e: LibraryElement) => {
    await engine.addElement(e);
    onDone();
  };

  const tile = (e: LibraryElement) => (
    <button
      key={e.id}
      type="button"
      onClick={() => void add(e)}
      title={elementLabel(e, language)}
      aria-label={elementLabel(e, language)}
      data-rx-st-element={e.id}
      className="aspect-square p-3 rounded border border-[#e3e3e3] bg-white hover:border-[#0b77c4] transition-colors"
    >
      <img src={svgUrl(e.svg)} alt="" className="w-full h-full object-contain" draggable={false} loading="lazy" />
    </button>
  );
  const grid = (list: LibraryElement[]) =>
    list.length === 0 ? (
      <p className="text-xs font-bold text-gray-400 text-center py-6">{t('stElNone')}</p>
    ) : (
      <div className="grid grid-cols-3 gap-3" data-rx-st-elements>
        {list.map(tile)}
      </div>
    );

  return (
    <div className="space-y-5" data-rx-st-panel="elements">
      {/* Pixart's search: a plain box, the magnifier on the right */}
      <label className="relative block">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('stElSearch')}
          aria-label={t('stElSearch')}
          className="w-full h-[3.125rem] pl-5 pr-12 rounded-md border border-[#e3e3e3] text-base sm:text-[0.875rem] text-[#1d1d1d] placeholder:text-[#8a8a8a]"
          data-rx-st-search="elements"
        />
        <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 text-[#1174ba]" strokeWidth={1.6} />
      </label>

      {query.trim() ? (
        grid(matching)
      ) : category ? (
        <div className="space-y-3">
          <button type="button" onClick={() => setCategory(null)} className="inline-flex items-center gap-1 text-[0.875rem] font-bold text-[#0b77c4]" data-rx-st-chip="all">
            <ChevronLeft className="w-4 h-4" />
            {t(CATEGORIES.find((c) => c.id === category)?.label ?? 'stElAll')}
          </button>
          {grid(ELEMENTS.filter((e) => e.category === category))}
        </div>
      ) : (
        CATEGORIES.map((c) => {
          const list = ELEMENTS.filter((e) => e.category === c.id);
          if (list.length === 0) return null;
          return (
            <section key={c.id} className="space-y-2.5">
              <div className="flex items-baseline justify-between">
                <h4 className="text-[0.9375rem] text-[#1d1d1d]">{t(c.label)}</h4>
                <button type="button" onClick={() => setCategory(c.id)} className="text-[0.875rem] font-bold text-[#0b77c4]" data-rx-st-chip={c.id}>
                  {t('stElShowAll')}
                </button>
              </div>
              <div className="relative grid grid-cols-3 gap-3">
                {list.slice(0, 3).map(tile)}
                {list.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setCategory(c.id)}
                    aria-label={t('stElShowAll')}
                    className="absolute -right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center text-[#1174ba]"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                )}
              </div>
            </section>
          );
        })
      )}
      {(category === 'emojis' || (!category && !query.trim())) && <p className="text-[0.625rem] font-bold text-gray-400">{t('stElCredit')}</p>}
    </div>
  );
}

function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-rx-st-chip={testId}
      className={cn(
        'px-2.5 py-1 rounded-full text-[0.6875rem] font-black border transition',
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400',
      )}
    >
      {children}
    </button>
  );
}

export { Chip };
