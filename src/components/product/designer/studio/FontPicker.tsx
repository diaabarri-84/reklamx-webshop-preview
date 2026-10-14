/**
 * The typeface list: searchable, by kind, every name drawn in its own face from ONE
 * small picture (fontSprite.webp, scripts/build-font-sprite.mjs) — the families
 * themselves load only when one is chosen.
 */
import React, { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { TranslationKey } from '../../../../lib/translations';
import { DESIGNER_FONT_LIBRARY, type FontCategory } from '../../../../lib/designFonts';
import spriteUrl from '../fontSprite.webp';
import sprite from '../fontSprite.json';
import { Chip } from './panels/ElementsPanel';

const CATEGORY_LABEL: Record<FontCategory, TranslationKey> = {
  sans: 'stFontSans',
  serif: 'stFontSerif',
  display: 'stFontDisplay',
  script: 'stFontScript',
  mono: 'stFontMono',
};

const ROW = sprite.row;
const WIDTH = sprite.width;
/** A sprite drawn for another list would show the wrong names: fall back to plain text. */
const SPRITE_OK = sprite.order.length === DESIGNER_FONT_LIBRARY.length && sprite.order.every((f, i) => f === DESIGNER_FONT_LIBRARY[i].family);

export default function FontPicker({ value, onPick, t }: { value: string; onPick: (family: string) => void; t: (k: TranslationKey) => string }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FontCategory | null>(null);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return DESIGNER_FONT_LIBRARY.map((f, index) => ({ f, index })).filter(
      ({ f }) => (!category || f.category === category) && (!q || f.label.toLowerCase().includes(q)),
    );
  }, [query, category]);

  return (
    <div className="space-y-2" data-rx-st-fontpicker>
      <label className="relative block">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('stFontSearch')}
          aria-label={t('stFontSearch')}
          autoFocus
          className="w-full h-9 pl-9 pr-3 rounded-xl border border-gray-200 text-base sm:text-sm font-bold"
          data-rx-st-search="fonts"
        />
      </label>
      <div className="flex flex-wrap gap-1">
        <Chip active={category === null} onClick={() => setCategory(null)}>{t('stElAll')}</Chip>
        {(Object.keys(CATEGORY_LABEL) as FontCategory[]).map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)} testId={`font-${c}`}>
            {t(CATEGORY_LABEL[c])}
          </Chip>
        ))}
      </div>
      <div className="max-h-72 overflow-y-auto -mx-1 px-1" role="listbox" aria-label={t('dsgFont')}>
        {list.map(({ f, index }) => (
          <button
            key={f.family}
            type="button"
            role="option"
            aria-selected={value === f.family}
            aria-label={f.label}
            onClick={() => onPick(f.family)}
            data-rx-st-font={f.family}
            className={cn('w-full flex items-center gap-2 px-2 rounded-lg text-left', value === f.family ? 'bg-[#e7f1f8]' : 'hover:bg-gray-100')}
            style={{ height: ROW + 6 }}
          >
            {SPRITE_OK ? (
              <span
                aria-hidden="true"
                className="block shrink-0"
                style={{
                  width: WIDTH,
                  height: ROW,
                  maxWidth: 'calc(100% - 24px)',
                  backgroundImage: `url(${spriteUrl})`,
                  backgroundSize: `${WIDTH}px auto`,
                  backgroundPosition: `0 ${-index * ROW}px`,
                  backgroundRepeat: 'no-repeat',
                  mixBlendMode: 'multiply',
                }}
              />
            ) : (
              <span className="text-sm font-bold text-gray-800">{f.label}</span>
            )}
            {value === f.family && <Check className="ml-auto w-4 h-4 text-[#1174ba] shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
}
