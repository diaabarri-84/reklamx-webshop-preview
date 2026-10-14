/**
 * THE 3D VIEW — the product as it will be held, with the customer's own pages on it
 * (Pixartprinting's Designer has one): a card or a sheet with its thickness, a sticker
 * cut round, a roll-up on its stand. Drawn with CSS 3D (no library): each page is a
 * picture of its trim, made from the design itself; drag to turn it, or show the
 * front or the back.
 *
 * On a desk it is Pixart's: a white window at the bottom right, over the work (the
 * studio stays usable), with "larger", "move" and its ⓧ; "larger" fills the studio.
 * On a phone it fills the studio.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Move, RotateCcw } from 'lucide-react';
import { CircleClose } from './look';
import { cn } from '../../../../lib/utils';
import type { TranslationKey } from '../../../../lib/translations';
import type { OutlineKind } from '../../../../lib/shapes';
import type { ProductKind } from '../../../../lib/printSpec';
import type { SideId } from '../../../../lib/printSides';
import type { StudioEngine } from './engine';
import { sideThumb } from './starters';

/** A short fingerprint of a text (FNV-1a), for a cache key. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export default function Preview3D({
  engine,
  t,
  kind,
  outline,
  sides,
  onClose,
  floating = false,
}: {
  engine: StudioEngine;
  t: (k: TranslationKey) => string;
  kind: ProductKind;
  outline: OutlineKind | null;
  sides: SideId[];
  onClose: () => void;
  /** A desk: Pixart's window at the bottom right (else it fills the studio). */
  floating?: boolean;
}) {
  const [big, setBig] = useState(false);
  const panel = floating && !big;
  // Where the window was moved to, from its place at the bottom right.
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const moving = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const moveTo = (x: number, y: number) => {
    // Never off the studio: its ⓧ stays in reach.
    const el = layerRef.current;
    const room = el?.offsetParent as HTMLElement | null;
    if (!el || !room) return setOffset({ x, y });
    // (offsetLeft/Top leave the transform out: the window's own place.)
    const left0 = el.offsetLeft;
    const top0 = el.offsetTop;
    const nx = Math.min(room.clientWidth - 8 - el.offsetWidth - left0, Math.max(8 - left0, x));
    const ny = Math.min(room.clientHeight - 8 - el.offsetHeight - top0, Math.max(8 - top0, y));
    setOffset({ x: nx, y: ny });
  };
  // Opened: it has the keyboard (Tab walked the studio's controls hidden behind it).
  const layerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => layerRef.current?.focus(), []);
  const { wMm, hMm } = engine.opts.trimMm;
  const [faces, setFaces] = useState<Partial<Record<SideId, string>>>({});
  const [angle, setAngle] = useState({ x: -8, y: -24 });
  const drag = useRef<{ x: number; y: number; ax: number; ay: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(300);

  // Each page drawn from the design as it prints (the page on screen included, as it is
  // now; pictures by their own addresses; empty photo frames left out).
  useEffect(() => {
    let alive = true;
    engine.flush();
    for (const scene of engine.printScenes()) {
      const json = JSON.stringify(scene.json);
      // Keyed by the WHOLE design: its length and last characters stayed the same when
      // the first text changed colour, and the old face was shown. One kept per side.
      void sideThumb(`3d|${scene.id}|${json.length}|${hashText(json)}`, json, engine.opts.trimMm, engine.opts.spec.bleedMm, 900, { slot: `3d|${scene.id}` })
        .then((url) => alive && setFaces((f) => ({ ...f, [scene.id]: url })))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [engine, sides]);

  // The object's size on screen: as large as fits, kept in proportion.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const room = Math.min(el.clientWidth * 0.62, el.clientHeight * (kind === 'rollup' ? 0.62 : 0.7));
      setFit(Math.max(120, room));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const scale = fit / Math.max(wMm, hMm);
  const w = wMm * scale;
  const h = hMm * scale;
  // Paper about 0.35 mm, a card 0.6, a board sign 3, a roll-up's banner is film on a stand.
  const thickMm = kind === 'card' ? 0.6 : kind === 'sign' ? 3 : kind === 'sticker' ? 0.2 : 0.3;
  const depth = Math.max(1, Math.min(10, thickMm * scale * (kind === 'card' ? 4 : 2)));
  const round = outline === 'circle' || outline === 'ellipse';
  const radius = round ? '50%' : kind === 'sticker' ? `${Math.min(w, h) * 0.04}px` : '2px';
  const back = sides.includes('back') ? faces.back : null;
  const front = faces[sides[0]];
  const showingBack = Math.cos((angle.y * Math.PI) / 180) < 0;
  // Pixart's two tabs: the one shown filled pale blue, the other outlined.
  const tab = (on: boolean) =>
    cn('px-4 h-[2.125rem] rounded-md text-[0.9375rem] font-bold border transition-colors', on ? 'bg-[#e7f1f8] border-[#e7f1f8] text-[#0b77c4]' : 'bg-white border-[#0b77c4] text-[#0b77c4] hover:bg-[#e7f1f8]');

  const face = (url: string | null | undefined, style: React.CSSProperties, label: string) => (
    <div
      aria-label={label}
      className="absolute inset-0 overflow-hidden bg-white"
      style={{ borderRadius: radius, backfaceVisibility: 'hidden', ...style }}
    >
      {url ? <img src={url} alt="" className="w-full h-full object-cover" draggable={false} /> : <span className="absolute inset-0 bg-gray-100 animate-pulse" />}
    </div>
  );

  return (
    <div
      ref={layerRef}
      tabIndex={-1}
      className={cn(
        'absolute z-[236] flex flex-col bg-white outline-none',
        panel ? 'right-[3.25rem] bottom-[1.25rem] w-[27rem] h-[35.9375rem] max-w-[calc(100%-16px)] max-h-[calc(100%-16px)] rounded-2xl shadow-[0_6px_28px_rgba(0,0,0,0.18)]' : 'inset-0',
      )}
      style={panel ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
      role="dialog"
      aria-modal={panel ? undefined : true}
      aria-label={t('st3d')}
      data-rx-st-3d={panel ? 'window' : 'full'}
      data-rx-st-layer
    >
      <div className="flex items-center gap-1 px-3 h-14 shrink-0">
        {floating && (
          <button
            type="button"
            onClick={() => setBig((b) => !b)}
            aria-label={big ? t('st3dSmaller') : t('st3dBigger')}
            title={big ? t('st3dSmaller') : t('st3dBigger')}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[#1174ba] hover:bg-[#e7f1f8]"
            data-rx-st-3d-size
          >
            {big ? <Minimize2 className="w-6 h-6" strokeWidth={1.6} /> : <Maximize2 className="w-6 h-6" strokeWidth={1.6} />}
          </button>
        )}
        {panel && (
          <button
            type="button"
            aria-label={t('st3dMove')}
            title={t('st3dMove')}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[#1174ba] hover:bg-[#e7f1f8] cursor-move touch-none"
            onPointerDown={(ev) => {
              ev.currentTarget.setPointerCapture(ev.pointerId);
              moving.current = { x: ev.clientX, y: ev.clientY, ox: offset.x, oy: offset.y };
            }}
            onPointerMove={(ev) => {
              const m = moving.current;
              if (m) moveTo(m.ox + ev.clientX - m.x, m.oy + ev.clientY - m.y);
            }}
            onPointerUp={() => {
              moving.current = null;
            }}
            onPointerCancel={() => {
              moving.current = null;
            }}
            data-rx-st-3d-move
          >
            <Move className="w-6 h-6" strokeWidth={1.6} />
          </button>
        )}
        {!floating && <h3 className="text-[0.9375rem] font-bold text-[#1d1d1d] px-1">{t('st3d')}</h3>}
        <span className="flex-1" />
        <button type="button" onClick={onClose} aria-label={t('dsgClose')} title={t('dsgClose')} className="w-10 h-10 rounded-full flex items-center justify-center text-[#1174ba] hover:bg-[#e7f1f8]" data-rx-st-3d-close>
          <CircleClose className="w-6 h-6" />
        </button>
      </div>
      <div
        ref={boxRef}
        className="relative flex-1 min-h-0 flex items-center justify-center select-none cursor-grab active:cursor-grabbing"
        style={{ perspective: `${Math.max(900, fit * 4)}px`, touchAction: 'none' }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ax: angle.x, ay: angle.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          setAngle({ x: Math.max(-60, Math.min(60, d.ax - (e.clientY - d.y) * 0.4)), y: d.ay + (e.clientX - d.x) * 0.5 });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="relative" style={{ width: w, height: h, transformStyle: 'preserve-3d', transform: `rotateX(${angle.x}deg) rotateY(${angle.y}deg)`, transition: drag.current ? 'none' : 'transform 0.5s ease' }}>
          {/* The shadow on the floor. */}
          {kind !== 'rollup' && (
            <div
              className="absolute left-[8%] right-[8%] rounded-[50%] bg-black/25 blur-xl"
              style={{ height: Math.max(12, h * 0.08), top: h * 1.02, transform: `translateZ(${-depth}px) rotateX(90deg)` }}
            />
          )}
          {/* The edge: the thickness of the stock, seen as the object turns. */}
          {!round && (
            <>
              <div className="absolute top-0 bg-[#e8e6e1]" style={{ width: depth, height: h, left: w / 2 - depth / 2, transform: `rotateY(90deg) translateZ(${w / 2}px)` }} />
              <div className="absolute top-0 bg-[#e8e6e1]" style={{ width: depth, height: h, left: w / 2 - depth / 2, transform: `rotateY(-90deg) translateZ(${w / 2}px)` }} />
              <div className="absolute left-0 bg-[#ddd9d2]" style={{ width: w, height: depth, top: h / 2 - depth / 2, transform: `rotateX(90deg) translateZ(${h / 2}px)` }} />
              <div className="absolute left-0 bg-[#ddd9d2]" style={{ width: w, height: depth, top: h / 2 - depth / 2, transform: `rotateX(-90deg) translateZ(${h / 2}px)` }} />
            </>
          )}
          {face(front, { transform: `translateZ(${depth / 2}px)`, boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }, sides[0] === 'back' ? t('stBack') : t('stFront'))}
          {face(back ?? null, { transform: `rotateY(180deg) translateZ(${depth / 2}px)`, background: back ? undefined : '#ffffff' }, t('stBack'))}
          {kind === 'rollup' && (
            <>
              {/* The cassette at the foot, the pole behind. */}
              <div className="absolute rounded-md bg-gradient-to-b from-[#d6d9df] to-[#9aa1ad] shadow-lg" style={{ left: -w * 0.04, width: w * 1.08, height: Math.max(14, h * 0.045), top: h - Math.max(8, h * 0.03), transform: `translateZ(${depth + 6}px)` }} />
              <div className="absolute bg-[#b9bec8]" style={{ left: w / 2 - 2, width: 4, height: h, top: 0, transform: `translateZ(${-12}px)` }} />
            </>
          )}
        </div>
      </div>
      <div className="flex items-center justify-center gap-4 px-4 pt-2 pb-5 shrink-0">
        {!panel && <span className="hidden sm:inline text-[0.75rem] text-[#555555] mr-2">{t('st3dDrag')}</span>}
        <button type="button" onClick={() => setAngle({ x: -8, y: -24 })} className={tab(!showingBack)} data-rx-st-3d-front>
          {sides[0] === 'back' ? t('stBack') : t('stFront')}
        </button>
        {sides.includes('back') && sides.length > 1 && (
          <button type="button" onClick={() => setAngle({ x: -8, y: 156 })} className={tab(showingBack)} data-rx-st-3d-back>
            {t('stBack')}
          </button>
        )}
        <button type="button" onClick={() => setAngle((a) => ({ x: a.x, y: a.y + 360 }))} aria-label={t('st3dSpin')} title={t('st3dSpin')} className="w-[2.125rem] h-[2.125rem] rounded-md flex items-center justify-center border border-[#0b77c4] text-[#0b77c4] hover:bg-[#e7f1f8]">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
