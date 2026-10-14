/**
 * Crop a picture: its whole original shown, the part kept in a frame moved and
 * resized by hand (a mouse or a finger) or moved with the arrow keys, free or held to
 * a shape. What is kept stays where it was on the page (StudioEngine.crop).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { FabricImage } from 'fabric';
import { X } from 'lucide-react';
import type { TranslationKey } from '../../../../lib/translations';
import type { StudioEngine } from './engine';
import type { Tagged } from './studioObjects';
import { Chip } from './panels/ElementsPanel';

type Rect = { x: number; y: number; w: number; h: number };
type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const MIN = 16;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export default function Cropper({ engine, o, t, onClose }: { engine: StudioEngine; o: FabricImage; t: (k: TranslationKey) => string; onClose: () => void }) {
  // Opened: it has the keyboard (Tab walked the studio's controls hidden behind it).
  const layerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => layerRef.current?.focus(), []);
  const picture = engine.images.get(String((o as Tagged).rxImageId ?? ''));
  const el = o.getElement() as HTMLImageElement | HTMLCanvasElement;
  const natW = (el as HTMLImageElement).naturalWidth || el.width || 1;
  const natH = (el as HTMLImageElement).naturalHeight || el.height || 1;
  const frameAspect = o.width / o.height;
  const [rect, setRect] = useState<Rect>({ x: o.cropX || 0, y: o.cropY || 0, w: o.width, h: o.height });
  const [aspect, setAspect] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  const drag = useRef<{ handle: Handle; start: Rect; x: number; y: number } | null>(null);

  useEffect(() => {
    const fit = () => {
      const box = boxRef.current;
      if (!box) return;
      setK(Math.min(box.clientWidth / natW, box.clientHeight / natH));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [natW, natH]);

  /** A rectangle kept inside the picture, at least MIN a side, held to the aspect when one is chosen. */
  const clamp = (r: Rect, handle: Handle): Rect => {
    let { x, y, w, h } = r;
    w = Math.max(MIN, Math.min(natW, w));
    h = Math.max(MIN, Math.min(natH, h));
    if (aspect && handle !== 'move') {
      if (handle === 'n' || handle === 's') w = h * aspect;
      else h = w / aspect;
      if (w > natW) {
        w = natW;
        h = w / aspect;
      }
      if (h > natH) {
        h = natH;
        w = h * aspect;
      }
      if (handle.includes('w')) x = r.x + r.w - w;
      if (handle.includes('n')) y = r.y + r.h - h;
    }
    x = Math.max(0, Math.min(natW - w, x));
    y = Math.max(0, Math.min(natH - h, y));
    return { x, y, w, h };
  };

  const chooseAspect = (a: number | null) => {
    setAspect(a);
    if (!a) return;
    setRect((r) => {
      // The largest rectangle of that shape inside the current one, centred.
      let w = r.w;
      let h = w / a;
      if (h > r.h) {
        h = r.h;
        w = h * a;
      }
      return clamp({ x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }, 'move');
    });
  };

  const onDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { handle, start: rect, x: e.clientX, y: e.clientY };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // A mirrored picture is shown mirrored, frame and all: a hand moving right moves its left edge.
    const dx = ((e.clientX - d.x) / k) * (o.flipX ? -1 : 1);
    const dy = ((e.clientY - d.y) / k) * (o.flipY ? -1 : 1);
    const s = d.start;
    let r: Rect = { ...s };
    if (d.handle === 'move') r = { ...s, x: s.x + dx, y: s.y + dy };
    else {
      if (d.handle.includes('e')) r.w = s.w + dx;
      if (d.handle.includes('s')) r.h = s.h + dy;
      if (d.handle.includes('w')) {
        r.x = s.x + dx;
        r.w = s.w - dx;
      }
      if (d.handle.includes('n')) {
        r.y = s.y + dy;
        r.h = s.h - dy;
      }
      if (r.w < MIN) {
        if (d.handle.includes('w')) r.x = s.x + s.w - MIN;
        r.w = MIN;
      }
      if (r.h < MIN) {
        if (d.handle.includes('n')) r.y = s.y + s.h - MIN;
        r.h = MIN;
      }
      // Never past the picture's own edges while resizing.
      if (r.x < 0) {
        r.w += r.x;
        r.x = 0;
      }
      if (r.y < 0) {
        r.h += r.y;
        r.y = 0;
      }
      r.w = Math.min(r.w, natW - r.x);
      r.h = Math.min(r.h, natH - r.y);
    }
    setRect(clamp(r, d.handle));
  };
  const onUp = () => {
    drag.current = null;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The arrow keys move the frame (Shift: ten times as far), as they move an object
      // on the board — the frame could only be dragged (code review DSN-20).
      const arrow = ARROWS[e.key];
      if (arrow) {
        e.stopPropagation();
        e.preventDefault();
        // 1 % of the picture a press; shown mirrored, the frame moves the way the arrow points.
        const step = Math.max(1, Math.max(natW, natH) * (e.shiftKey ? 0.1 : 0.01));
        const dx = arrow[0] * step * (o.flipX ? -1 : 1);
        const dy = arrow[1] * step * (o.flipY ? -1 : 1);
        setRect((r) => ({ ...r, x: Math.max(0, Math.min(natW - r.w, r.x + dx)), y: Math.max(0, Math.min(natH - r.h, r.y + dy)) }));
        return;
      }
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, natW, natH, o]);

  const handles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const handlePos: Record<string, React.CSSProperties> = {
    nw: { left: -9, top: -9, cursor: 'nwse-resize' },
    n: { left: '50%', top: -9, marginLeft: -9, cursor: 'ns-resize' },
    ne: { right: -9, top: -9, cursor: 'nesw-resize' },
    e: { right: -9, top: '50%', marginTop: -9, cursor: 'ew-resize' },
    se: { right: -9, bottom: -9, cursor: 'nwse-resize' },
    s: { left: '50%', bottom: -9, marginLeft: -9, cursor: 'ns-resize' },
    sw: { left: -9, bottom: -9, cursor: 'nesw-resize' },
    w: { left: -9, top: '50%', marginTop: -9, cursor: 'ew-resize' },
  };

  return (
    <div ref={layerRef} tabIndex={-1} className="absolute inset-0 z-[240] flex flex-col bg-gray-900/90 outline-none" role="dialog" aria-modal="true" aria-label={t('stCropTitle')} data-rx-st-cropper data-rx-st-layer>
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <h3 className="flex-1 text-sm font-black">{t('stCropTitle')}</h3>
        <button type="button" onClick={onClose} aria-label={t('stCancel')} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div ref={boxRef} className="relative flex-1 min-h-0 mx-4 flex items-center justify-center" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ touchAction: 'none' }}>
        {picture && (
          <div className="relative" style={{ width: natW * k, height: natH * k, transform: `scale(${o.flipX ? -1 : 1}, ${o.flipY ? -1 : 1})` }}>
            <img src={picture.url} alt="" className="absolute inset-0 w-full h-full select-none" draggable={false} />
            <div className="absolute inset-0 overflow-hidden">
              <div
                className="absolute border-2 border-white cursor-move"
                style={{ left: rect.x * k, top: rect.y * k, width: rect.w * k, height: rect.h * k, boxShadow: '0 0 0 9999px rgba(15,23,42,0.6)' }}
                onPointerDown={onDown('move')}
                data-rx-st-crop-rect
              >
                <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'linear-gradient(to right, rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.35) 1px, transparent 1px)', backgroundSize: '33.33% 33.33%' }} />
              </div>
            </div>
            <div className="absolute" style={{ left: rect.x * k, top: rect.y * k, width: rect.w * k, height: rect.h * k }}>
              {handles.map((h) => (
                <span
                  key={h}
                  onPointerDown={onDown(h)}
                  className="absolute w-[1.125rem] h-[1.125rem] rounded-full bg-white border-2 border-[#0b77c4] shadow touch-none after:absolute after:-inset-3 after:content-['']"
                  style={handlePos[h]}
                  data-rx-st-crop-handle={h}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="px-4 py-3 space-y-3">
        <div className="flex flex-wrap justify-center gap-1.5">
          <Chip active={aspect === null} onClick={() => chooseAspect(null)} testId="crop-free">{t('stCropFree')}</Chip>
          <Chip active={aspect === natW / natH} onClick={() => chooseAspect(natW / natH)} testId="crop-original">{t('stCropOriginal')}</Chip>
          <Chip active={aspect === 1} onClick={() => chooseAspect(1)} testId="crop-square">{t('stCropSquare')}</Chip>
          <Chip active={aspect === frameAspect} onClick={() => chooseAspect(frameAspect)} testId="crop-frame">{t('stCropFrame')}</Chip>
        </div>
        <div className="flex justify-center gap-2">
          <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-full text-xs font-black text-white border border-white/40 hover:bg-white/10">
            {t('stCancel')}
          </button>
          <button
            type="button"
            onClick={() => {
              engine.crop(o, rect);
              onClose();
            }}
            data-rx-st-crop-apply
            className="px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-wider text-white bg-[#0b77c4] hover:bg-[#0a68ab]"
          >
            {t('stCrop')}
          </button>
        </div>
      </div>
    </div>
  );
}
