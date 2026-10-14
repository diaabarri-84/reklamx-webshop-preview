/**
 * Uploads: the customer's own pictures. Uploaded here (or dropped on the panel),
 * kept in the list for this design (and on the device with the draft), added to
 * the page with a tap or dragged onto the board. Opened to REPLACE a picture or
 * fill a photo frame, the next one chosen goes there instead.
 */
import React, { useRef, useState } from 'react';
import { Info, Loader2, Replace, UploadCloud, X } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import type { TranslationKey } from '../../../../../lib/translations';
import type { FabricObject } from 'fabric';
import type { StudioEngine } from '../engine';
import { PICTURE_ACCEPT, takePictures } from '../pictures';

export const PICTURE_DRAG_TYPE = 'application/x-reklamx-picture';

export default function UploadsPanel({
  engine,
  t,
  owner,
  replaceTarget,
  onReplaced,
  onNotice,
  onDone,
}: {
  engine: StudioEngine;
  t: (k: TranslationKey) => string;
  owner: boolean;
  /** A picture or photo frame waiting for its new picture. */
  replaceTarget: FabricObject | null;
  onReplaced: () => void;
  onNotice: (text: string | null) => void;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [over, setOver] = useState(false);

  const use = async (id: string) => {
    // Replaced only while the frame is still on the board; else the picture is added.
    if (replaceTarget && engine.canvas?.getObjects().includes(replaceTarget)) {
      await engine.replacePicture(replaceTarget, id);
      onReplaced();
    } else {
      await engine.addPicture(id);
    }
    onDone();
  };

  const take = async (files: File[]) => {
    if (files.length === 0) return;
    onNotice(null);
    setWorking(true);
    try {
      const { ids, problems } = await takePictures(files, engine, { owner });
      if (problems.length) onNotice(problems.map((k) => t(k)).join(' '));
      // The first one goes straight onto the page (or into the frame waiting for it).
      if (ids[0]) await use(ids[0]);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className="space-y-3"
      data-rx-st-panel="uploads"
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setOver(false);
        void take(Array.from(e.dataTransfer.files));
      }}
    >
      {replaceTarget && (
        <p className="flex items-center gap-2 text-[0.6875rem] font-black text-[#08558c] bg-[#e7f1f8] border border-[#cfe3f3] rounded-xl px-3 py-2" data-rx-st-replacing>
          <Replace className="w-4 h-4 shrink-0" />
          <span className="flex-1">{t('stReplace')}</span>
          <button type="button" onClick={onReplaced} className="font-black text-[#0b77c4]">{t('stCancel')}</button>
        </p>
      )}
      {/* Pixart's: how many are uploaded (its ⓘ says what may be), then one solid blue button;
          a file dropped anywhere on the panel is taken too. */}
      <p className="flex items-center gap-1.5 text-[0.875rem] font-bold text-[#1d1d1d]">
        {t('stUploadedCount').replace('{0}', String(engine.uploads.length))}
        <span title={t('stUploadHint')} className="text-[#0b77c4]">
          <Info className="w-4 h-4" strokeWidth={1.8} aria-label={t('stUploadHint')} />
        </span>
      </p>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={working}
        data-rx-st-upload
        className={cn(
          'w-full inline-flex items-center justify-center gap-2 h-11 px-4 rounded-lg text-[0.9375rem] font-bold text-white transition',
          over ? 'bg-[#08558c] ring-4 ring-[#a9cfee]' : 'bg-[#0b77c4] hover:bg-[#0a68ab]',
          'disabled:opacity-60',
        )}
      >
        {working ? <Loader2 className="w-5 h-5 animate-spin" /> : <UploadCloud className="w-5 h-5" strokeWidth={1.8} />}
        {working ? t('stUploading') : t('stUploadButton')}
      </button>
      <p className="text-[0.75rem] text-[#555555]">
        {t('stUploadDrop')} · {t('stUploadHint')}
      </p>
      <input
        ref={input}
        type="file"
        accept={PICTURE_ACCEPT}
        multiple
        className="hidden"
        data-rx-photo-input
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void take(files);
        }}
      />
      {engine.uploads.length === 0 ? (
        <p className="text-xs font-bold text-gray-400 text-center py-6">{t('stUploadEmpty')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2" data-rx-st-uploads>
          {engine.uploads.map((id) => {
            const p = engine.images.get(id);
            if (!p) return null;
            return (
              <div key={id} className="relative group">
                <button
                  type="button"
                  onClick={() => void use(id)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(PICTURE_DRAG_TYPE, id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  title={replaceTarget ? t('stReplace') : t('stUploadAdd')}
                  data-rx-st-upload-item={id}
                  className="block w-full aspect-square rounded-xl overflow-hidden border border-gray-200 hover:border-[#0b77c4] bg-[repeating-conic-gradient(#f3f4f6_0_25%,#ffffff_0_50%)] bg-[length:16px_16px]"
                >
                  <img src={p.url} alt="" className="w-full h-full object-contain" draggable={false} />
                </button>
                <button
                  type="button"
                  onClick={() => engine.removeUpload(id)}
                  aria-label={t('stUploadRemove')}
                  title={t('stUploadRemove')}
                  className="absolute top-0.5 right-0.5 w-8 h-8 rounded-full bg-white/90 shadow flex items-center justify-center text-gray-600 hover:text-red-600 opacity-80 group-hover:opacity-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
