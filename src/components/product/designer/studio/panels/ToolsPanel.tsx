/**
 * Tools (Pixartprinting's "Verktyg"): AI Studio and the QR code, as two cards — each
 * opens its own panel (with a way back here). AI Studio only where the shop has
 * switched AI pictures on.
 */
import React from 'react';
import { QrCode, Wand2 } from 'lucide-react';
import type { TranslationKey } from '../../../../../lib/translations';

export default function ToolsPanel({ t, ai, onOpen }: { t: (k: TranslationKey) => string; ai: boolean; onOpen: (tool: 'ai' | 'qr') => void }) {
  const card = (id: 'ai' | 'qr', Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>, title: string, sub: string) => (
    <button
      key={id}
      type="button"
      onClick={() => onOpen(id)}
      data-rx-st-tool={id}
      className="w-full flex items-start gap-4 p-4 rounded-lg border border-[#e3e3e3] bg-white text-left hover:border-[#0b77c4] transition-colors"
    >
      <span className="w-[6.25rem] h-[6.25rem] shrink-0 rounded bg-[#f2f2f2] flex items-center justify-center">
        <Icon className="w-11 h-11 text-[#1d1d1d]" strokeWidth={1.5} />
      </span>
      <span className="min-w-0">
        <span className="block text-[1.0625rem] font-bold text-[#1d1d1d]">{title}</span>
        <span className="block mt-1 text-[0.875rem] leading-snug text-[#1d1d1d]">{sub}</span>
      </span>
    </button>
  );
  return (
    <div className="space-y-5" data-rx-st-panel="tools">
      {ai && card('ai', Wand2, t('stRailAi'), t('stToolAiSub'))}
      {card('qr', QrCode, t('stToolQrTitle'), t('stToolQrSub'))}
    </div>
  );
}
