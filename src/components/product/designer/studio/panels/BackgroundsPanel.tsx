/**
 * Backgrounds: a colour, or one of the shop's own patterns (src/lib/designPatterns.ts)
 * in two colours at a size that suits the product — a 10 mm dot on a business card,
 * a 15 cm one on a roll-up read from across the room. A picture as the background
 * is one of the customer's own, filled to the edges from the picture's Fit menu.
 * A template whose background the shop fixed says so instead.
 */
import React, { useMemo, useState } from 'react';
import { Lock, Trash2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import type { TranslationKey } from '../../../../../lib/translations';
import { PATTERNS, drawPatternTile, patternById, type PatternCategory, type PatternSpec } from '../../../../../lib/designPatterns';
import type { StudioEngine } from '../engine';
import { ColourPicker, SectionLabel, Slider } from '../ui';
import { Chip } from './ElementsPanel';

const CATEGORY_LABEL: Record<PatternCategory, TranslationKey> = {
  geometric: 'stPatGeometric',
  organic: 'stPatOrganic',
  playful: 'stPatPlayful',
  classic: 'stPatClassic',
};

/** Pairs that print well: [background, pattern]. */
const PAIRS: Array<[string, string]> = [
  ['#ffffff', '#1d71b8'],
  ['#ffffff', '#e30613'],
  ['#fff7e0', '#f39200'],
  ['#eef7ee', '#009640'],
  ['#1d1d1b', '#ffed00'],
  ['#2d2e83', '#ffffff'],
  ['#f6f1ea', '#c8a46e'],
  ['#ededed', '#706f6f'],
];

/** Pattern pictures by pattern and colours: the oldest let go past 200 (every colour tried drew each pattern shown again — code review DSN-18). */
const thumbs = new Map<string, string>();
const THUMBS_KEPT = 200;

function patternThumb(spec: PatternSpec): string {
  const key = `${spec.id}|${spec.colours.join(',')}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  const def = patternById(spec.id);
  if (!def) return '';
  // Two and a half tiles across a 72 px square.
  const tilePx = 29;
  const tile = drawPatternTile({ ...spec, scaleMm: def.tileMm }, tilePx / def.tileMm, (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  });
  const out = document.createElement('canvas');
  out.width = 72;
  out.height = 72;
  const ctx = out.getContext('2d');
  if (!tile || !ctx) return '';
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return '';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, 72, 72);
  const url = out.toDataURL('image/png');
  thumbs.set(key, url);
  if (thumbs.size > THUMBS_KEPT) thumbs.delete(thumbs.keys().next().value as string);
  return url;
}

export default function BackgroundsPanel({ engine, t }: { engine: StudioEngine; t: (k: TranslationKey) => string }) {
  const [category, setCategory] = useState<PatternCategory>('geometric');
  const current = engine.pattern?.rxPattern ?? null;
  // Pixart's two tabs: a colour, or a pattern (open on the pattern when there is one).
  const [tab, setTab] = useState<'colour' | 'pattern'>(current ? 'pattern' : 'colour');
  const [pair, setPair] = useState<[string, string]>(current?.colours ?? PAIRS[0]);
  // How much larger than its own tile a pattern is drawn on this product.
  const k = Math.max(1, engine.shortSideMm / 55);
  const labels = { custom: t('dsgCustomColour'), eyedropper: t('stEyedropper'), hex: t('stHex') };

  const choose = (id: string) => {
    const def = patternById(id);
    if (!def) return;
    const factor = current ? current.scaleMm / (patternById(current.id)?.tileMm ?? def.tileMm) : k;
    engine.setPattern({ id, colours: current?.colours ?? pair, scaleMm: Math.min(400, Math.max(2, def.tileMm * factor)) });
  };
  const recolour = (colours: [string, string], soon = false) => {
    setPair(colours);
    if (current) engine.setPattern({ ...current, colours }, { soon });
  };

  const list = useMemo(() => PATTERNS.filter((p) => p.category === category), [category]);

  if (engine.backgroundLocked) {
    return (
      <p className="flex items-center gap-2 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-3 py-3" data-rx-st-bg-locked>
        <Lock className="w-4 h-4 shrink-0" />
        {t('stBgLocked')}
      </p>
    );
  }

  const def = current ? patternById(current.id) : null;
  return (
    <div className="space-y-5" data-rx-st-panel="backgrounds">
      <div className="flex gap-6 border-b border-[#e3e3e3]" role="tablist">
        {(['colour', 'pattern'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-rx-st-bg-tab={id}
            className={cn('pb-2 -mb-px text-[0.9375rem] font-medium text-[#1d1d1d] border-b-2', tab === id ? 'border-[#0b77c4]' : 'border-transparent')}
          >
            {t(id === 'colour' ? 'stBgColour' : 'stBgPattern')}
          </button>
        ))}
      </div>

      {tab === 'colour' && (
      <>
      <div>
        <ColourPicker value={engine.backgroundColour} onPick={(c) => engine.setBackgroundColour(c || '#ffffff', { soon: true })} labels={labels} testId="background" />
      </div>
      <div>
        <SectionLabel>{t('stBgPicture')}</SectionLabel>
        <p className="text-[0.6875rem] font-bold text-gray-500">{t('stBgPictureHint')}</p>
      </div>
      </>
      )}

      {tab === 'pattern' && (
      <>
      <div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {(Object.keys(CATEGORY_LABEL) as PatternCategory[]).map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)} testId={`pattern-${c}`}>
              {t(CATEGORY_LABEL[c])}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2" data-rx-st-patterns>
          {list.map((p) => {
            const url = patternThumb({ id: p.id, colours: current?.colours ?? pair, scaleMm: p.tileMm });
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => choose(p.id)}
                title={p.label}
                aria-label={p.label}
                aria-pressed={current?.id === p.id}
                data-rx-st-pattern={p.id}
                className={cn(
                  'aspect-square rounded-xl overflow-hidden border-2 transition',
                  current?.id === p.id ? 'border-[#0b77c4]' : 'border-transparent ring-1 ring-gray-200 hover:ring-[#a9cfee]',
                )}
              >
                {url && <img src={url} alt="" className="w-full h-full" draggable={false} />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <SectionLabel>{t('stPatColours')}</SectionLabel>
        <div className="grid grid-cols-8 gap-1.5 mb-3">
          {PAIRS.map((p) => (
            <button
              key={p.join()}
              type="button"
              onClick={() => recolour(p)}
              aria-label={p.join(' / ')}
              aria-pressed={pair[0] === p[0] && pair[1] === p[1]}
              className={cn('aspect-square rounded-full border overflow-hidden', pair[0] === p[0] && pair[1] === p[1] ? 'ring-2 ring-[#0b77c4] ring-offset-1' : 'border-gray-300')}
              style={{ background: `linear-gradient(135deg, ${p[0]} 50%, ${p[1]} 50%)` }}
            />
          ))}
        </div>
        {current && (
          <div className="space-y-3">
            <details className="rounded-xl border border-gray-200 px-3 py-2">
              <summary className="text-[0.6875rem] font-black text-gray-700 cursor-pointer">{t('stPatBackground')}</summary>
              <div className="pt-2">
                <ColourPicker value={current.colours[0]} onPick={(c) => c && recolour([c, current.colours[1]], true)} labels={labels} testId="pattern-bg" />
              </div>
            </details>
            <details className="rounded-xl border border-gray-200 px-3 py-2">
              <summary className="text-[0.6875rem] font-black text-gray-700 cursor-pointer">{t('stPatMotif')}</summary>
              <div className="pt-2">
                <ColourPicker value={current.colours[1]} onPick={(c) => c && recolour([current.colours[0], c], true)} labels={labels} testId="pattern-fg" />
              </div>
            </details>
            {def && (
              <Slider
                label={t('stPatScale')}
                value={Math.round(current.scaleMm)}
                min={Math.max(2, Math.round(def.tileMm * 0.5))}
                max={Math.min(400, Math.round(def.tileMm * k * 3))}
                onChange={(v) => engine.setPattern({ ...current, scaleMm: v }, { soon: true })}
                format={(v) => `${v} mm`}
                testId="pattern-scale"
              />
            )}
            <button
              type="button"
              onClick={() => engine.setPattern(null)}
              data-rx-st-pattern-remove
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-xs font-black text-gray-700 hover:border-red-300 hover:text-red-700"
            >
              <Trash2 className="w-4 h-4" />
              {t('stPatRemove')}
            </button>
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
