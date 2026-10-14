import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { TranslationKey } from '../lib/translations';

/**
 * A design the customer made in the studio (designer v2), shown as its pages — the
 * small pictures uploaded with it — never the print file itself (a two-sided PDF
 * can be 40 MB on a phone at checkout).
 */
export default function DesignPagesModal({
  open,
  name,
  pages,
  onClose,
  t,
}: {
  open: boolean;
  name: string;
  pages: Array<{ side: 'front' | 'back'; url: string }>;
  onClose: () => void;
  t: (k: TranslationKey) => string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('stYourDesign')} data-rx-design-pages-modal>
      <div className="w-full max-w-3xl max-h-full overflow-y-auto rounded-3xl bg-white p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <h3 className="flex-1 text-sm font-black text-gray-900 truncate">
            {t('stYourDesign')}
            {name ? <span className="font-bold text-gray-500"> · {name}</span> : null}
          </h3>
          <button type="button" onClick={onClose} aria-label={t('dsgClose')} className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className={pages.length > 1 ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : ''}>
          {pages.map((p) => (
            <figure key={p.side} className="space-y-1.5 rounded-2xl bg-gray-50 p-3">
              {pages.length > 1 && <figcaption className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{p.side === 'back' ? t('stBack') : t('stFront')}</figcaption>}
              <img src={p.url} alt="" className="w-full max-h-[60vh] object-contain shadow-md bg-white" />
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
