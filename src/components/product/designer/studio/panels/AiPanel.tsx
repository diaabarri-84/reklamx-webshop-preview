/**
 * AI Studio: a picture described in words, made by the shop's image model
 * (POST /api/designer/ai-images — the server holds the key, the daily cap and the
 * per-visitor limit). Off until the owner switches it on: his Google project needs
 * billing for the image model. The pictures come back as files and join Uploads.
 */
import React, { useState } from 'react';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import type { TranslationKey } from '../../../../../lib/translations';
import type { StudioEngine } from '../engine';
import { newImageId, preparePicture } from '../studioObjects';
import { Chip } from './ElementsPanel';

export type AiShape = 'portrait' | 'landscape' | 'square';

export type AiGenerate = (prompt: string, shape: AiShape) => Promise<{ images: Blob[] } | { error: 'off' | 'limit' | 'failed' }>;

/**
 * A request and what came of it. Kept by the studio, not by this panel: the panel
 * closed and opened again while a request ran forgot it was running, and Generate
 * started a second one, paid for twice (code review DSN-02).
 */
export interface AiRequest {
  working: boolean;
  problem: TranslationKey | null;
  /** The pictures it made (they are in Uploads too). */
  results: string[];
}
export const AI_IDLE: AiRequest = { working: false, problem: null, results: [] };

export default function AiPanel({
  engine,
  t,
  generate,
  request,
  onRequest,
  onDone,
}: {
  engine: StudioEngine;
  t: (k: TranslationKey) => string;
  /** Absent: the shop has not switched AI pictures on. */
  generate?: AiGenerate;
  request: AiRequest;
  onRequest: React.Dispatch<React.SetStateAction<AiRequest>>;
  onDone: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [shape, setShape] = useState<AiShape>(engine.opts.trimMm.wMm > engine.opts.trimMm.hMm * 1.15 ? 'landscape' : engine.opts.trimMm.hMm > engine.opts.trimMm.wMm * 1.15 ? 'portrait' : 'square');
  const { working, problem, results } = request;

  if (!generate) {
    return (
      <div className="space-y-3" data-rx-st-panel="ai">
        <div className="flex items-start gap-2 text-xs font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-3 py-3" data-rx-st-ai-off>
          <Sparkles className="w-4 h-4 shrink-0 text-gray-400" />
          {t('stAiOff')}
        </div>
      </div>
    );
  }

  const ideas = t('stAiIdeas').split('|').filter(Boolean);
  const run = async () => {
    const text = prompt.trim();
    if (!text || working) return;
    onRequest((r) => ({ ...r, working: true, problem: null }));
    try {
      const answer = await generate(text.slice(0, 500), shape);
      if ('error' in answer) {
        const why: TranslationKey = answer.error === 'limit' ? 'stAiLimit' : answer.error === 'off' ? 'stAiOff' : 'stAiFailed';
        onRequest((r) => ({ ...r, problem: why }));
        return;
      }
      const ids: string[] = [];
      for (const blob of answer.images) {
        try {
          const picture = await preparePicture(blob);
          const id = newImageId();
          engine.registerPicture(id, picture, true);
          ids.push(id);
        } catch {
          /* one unreadable picture: the others still count */
        }
      }
      onRequest((r) => ({ ...r, problem: ids.length === 0 ? 'stAiFailed' : null, results: ids }));
    } catch {
      onRequest((r) => ({ ...r, problem: 'stAiFailed' }));
    } finally {
      onRequest((r) => ({ ...r, working: false }));
    }
  };

  return (
    <div className="space-y-3" data-rx-st-panel="ai">
      <p className="text-[0.6875rem] font-bold text-gray-500">{t('stAiIntro')}</p>
      <label className="block space-y-1">
        <span className="text-[0.6875rem] font-bold text-gray-600">{t('stAiPrompt')}</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
          rows={4}
          placeholder={t('stAiPlaceholder')}
          className="w-full px-3 py-2 rounded-xl border border-gray-200 text-base sm:text-sm font-bold resize-y"
          data-rx-st-ai-prompt
        />
      </label>
      <button
        type="button"
        onClick={() => setPrompt(ideas[Math.floor(Math.random() * ideas.length)] ?? '')}
        className="inline-flex items-center gap-1.5 text-[0.6875rem] font-black text-[#0b77c4]"
      >
        <Wand2 className="w-3.5 h-3.5" />
        {t('stAiInspire')}
      </button>
      <div>
        <span className="block text-[0.625rem] font-black uppercase tracking-wider text-gray-400 mb-1.5">{t('stAiFormat')}</span>
        <div className="flex flex-wrap gap-1.5">
          {(['portrait', 'landscape', 'square'] as const).map((s) => (
            <Chip key={s} active={shape === s} onClick={() => setShape(s)} testId={`ai-${s}`}>
              {t(s === 'portrait' ? 'stAiPortrait' : s === 'landscape' ? 'stAiLandscape' : 'stAiSquare')}
            </Chip>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={working || !prompt.trim()}
        data-rx-st-ai-generate
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-xs font-black uppercase tracking-wider text-white bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-md disabled:opacity-40"
      >
        {working ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {working ? t('stAiWorking') : t('stAiGenerate')}
      </button>
      {problem && <p role="alert" className="text-[0.6875rem] font-black text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{t(problem)}</p>}
      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-2" data-rx-st-ai-results>
          {results.map((id) => {
            const p = engine.images.get(id);
            return p ? (
              <button
                key={id}
                type="button"
                onClick={async () => {
                  await engine.addPicture(id);
                  onDone();
                }}
                className={cn('aspect-square rounded-xl overflow-hidden border border-gray-200 hover:border-[#0b77c4]')}
              >
                <img src={p.url} alt="" className="w-full h-full object-cover" />
              </button>
            ) : null;
          })}
        </div>
      )}
      <p className="text-[0.625rem] font-bold text-gray-400">{t('stAiNote')}</p>
    </div>
  );
}
