/**
 * One of the shop's own designs, drawn small at a size that suits it — for the
 * owner's list in the dashboard (Design templates), where there is no product to
 * build it for. Loaded on its own (it brings fabric with it), only by that screen.
 */
import React, { useMemo } from 'react';
import type { TranslationKey } from '../../../../lib/translations';
import { printSpecFor } from '../../../../lib/printSpec';
import { starterById, type StarterContext } from '../../../../lib/starterTemplates';
import { StarterPicture } from './TemplateGallery';
import { starterWords } from './starters';

/** A business card for contact designs, a round label for labels, A5 for the rest. */
export function sampleSizeOf(use: string): { trimMm: { wMm: number; hMm: number }; kind: 'card' | 'sticker' | 'print' } {
  if (use === 'contact') return { trimMm: { wMm: 85, hMm: 55 }, kind: 'card' };
  if (use === 'label') return { trimMm: { wMm: 50, hMm: 50 }, kind: 'sticker' };
  return { trimMm: { wMm: 148, hMm: 210 }, kind: 'print' };
}

export default function StarterThumb({ id, t }: { id: string; t: (k: TranslationKey) => string }) {
  const def = starterById(id);
  const sample = sampleSizeOf(def?.use ?? 'promotion');
  const ctx: StarterContext = useMemo(() => {
    const spec = printSpecFor({ kind: sample.kind, trimMm: sample.trimMm });
    return { trimMm: sample.trimMm, bleedMm: spec.bleedMm, outline: null, safeMm: spec.safeMm, hiddenMm: spec.hiddenMm, sides: ['front'], words: starterWords(t) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, t]);
  if (!def) return null;
  return <StarterPicture def={def} palette={def.palettes[0]} side="front" ctx={ctx} aspect={sample.trimMm.wMm / sample.trimMm.hMm} maxPx={160} eager />;
}
