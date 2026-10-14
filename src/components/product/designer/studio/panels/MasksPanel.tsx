/**
 * Masks (Pixartprinting's "Masker"): the shapes a picture can be cut to. With a picture
 * chosen, the shape is cut from it; with none, a photo frame of that shape is put on the
 * page — tapped, it takes an upload, cut to the frame. The shapes the print file can
 * clip on the page (rxObjects.ts clipOnThePage): a circle, an oval, rounded corners, and
 * none.
 */
import React from 'react';
import { FabricImage } from 'fabric';
import type { TranslationKey } from '../../../../../lib/translations';
import type { StudioEngine } from '../engine';
import type { SlotShape, Tagged } from '../studioObjects';

const SHAPES: Array<{ id: SlotShape; label: TranslationKey; path: string }> = [
  { id: 'circle', label: 'stMaskCircle', path: 'M30 6a24 24 0 1 1 0 48a24 24 0 1 1 0-48z' },
  { id: 'ellipse', label: 'stMaskOval', path: 'M30 12c15.5 0 26 8 26 18s-10.5 18-26 18S4 40 4 30s10.5-18 26-18z' },
  { id: 'rounded', label: 'stMaskRounded', path: 'M16 8h28a8 8 0 0 1 8 8v28a8 8 0 0 1-8 8H16a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z' },
  { id: 'rect', label: 'stMaskRect', path: 'M8 12h44v36H8z' },
];

export default function MasksPanel({ engine, t, onDone }: { engine: StudioEngine; t: (k: TranslationKey) => string; onDone: () => void }) {
  const sel = engine.selected;
  const customer = engine.opts.mode === 'customer';
  const picture = sel instanceof FabricImage && !(customer && (sel as Tagged).rxLock) ? sel : null;
  return (
    <div className="space-y-4" data-rx-st-panel="masks">
      <p className="text-[0.8125rem] leading-snug text-[#555555]">{t('stMasksIntro')}</p>
      <div className="grid grid-cols-3 gap-3">
        {SHAPES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              if (picture) engine.setShape(picture, s.id === 'rect' ? 'none' : s.id);
              else engine.addSlot(s.id, t('dsgPhotoHere'));
              onDone();
            }}
            title={t(s.label)}
            aria-label={t(s.label)}
            data-rx-st-mask={s.id}
            className="aspect-square rounded-lg border border-[#e3e3e3] bg-white p-3 hover:border-[#0b77c4] transition-colors"
          >
            <svg viewBox="0 0 60 60" className="w-full h-full" aria-hidden="true">
              <path d={s.path} fill="#e3f2ef" stroke="#11705f" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
