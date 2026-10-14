/**
 * The studio's small parts: buttons, popovers, the colour picker, sliders.
 *
 * POPOVERS LEAVE THE TOOLBAR. The contextual toolbar scrolls sideways on a phone, and
 * anything positioned inside a scrolling box is cut off by it. A popover is drawn in
 * the studio's own layer (StudioLayer), fixed on screen under its button, and kept on
 * screen — still inside the studio's dialog, so Tab stays in it and Escape closes the
 * popover, not the studio.
 */
import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Pipette } from 'lucide-react';
import { cn } from '../../../../lib/utils';
import { PALETTE_WIDE } from './studioObjects';

export const StudioLayer = createContext<HTMLElement | null>(null);

type Icon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

export function ToolButton({
  icon: IconC,
  label,
  onClick,
  active,
  disabled,
  showLabel = false,
  testId,
  className,
  children,
  buttonRef,
  iconClassName = 'w-6 h-6',
  iconStroke = 1.6,
}: {
  icon?: Icon;
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
  showLabel?: boolean;
  testId?: string;
  className?: string;
  children?: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
  /** Smaller than Pixart's 24 px where its own are (the size box's − and +, the page arrows). */
  iconClassName?: string;
  iconStroke?: number;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={showLabel ? undefined : label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      data-rx-st={testId}
      className={cn(
        // Pixart's tools: 24 px blue line icons, dark words beside them, a pale blue
        // hover; one that cannot be used now is a pale grey (its colours, sampled).
        'group shrink-0 inline-flex items-center justify-center gap-2 h-10 rounded-lg text-[#1174ba] transition-colors',
        showLabel ? 'px-2.5' : children ? 'min-w-10 px-1.5' : 'w-10',
        active ? 'bg-[#e7f1f8] text-[#0b77c4] ring-1 ring-[#a9cfee]' : 'hover:bg-[#e7f1f8]',
        'disabled:text-[#d5d8d8] disabled:hover:bg-transparent',
        className,
      )}
    >
      {IconC && <IconC className={iconClassName} strokeWidth={iconStroke} />}
      {children}
      {showLabel && <span className="text-[0.9375rem] text-[#1d1d1d] group-disabled:text-[#c4c4c4] whitespace-nowrap">{label}</span>}
    </button>
  );
}

/** Pixart's switch row: the words, then a blue track with a white knob (grey when off). */
export function SwitchRow({ on, onChange, label, testId }: { on: boolean; onChange: () => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      data-rx-st={testId}
      className="w-full flex items-center justify-between gap-3 py-4 border-b border-[#e3e3e3] text-left text-[0.9375rem] text-[#1d1d1d]"
    >
      {label}
      <span className={cn('relative shrink-0 w-10 h-[1.125rem] rounded-full transition-colors', on ? 'bg-[#1174ba]' : 'bg-[#c4c4c4]')} aria-hidden="true">
        <span className={cn('absolute top-[0.1875rem] w-3 h-3 rounded-full bg-white transition-all', on ? 'left-[1.5625rem]' : 'left-[0.1875rem]')} />
      </span>
    </button>
  );
}

export const Divider = () => <span className="shrink-0 w-px h-8 bg-[#e3e3e3] mx-2" aria-hidden="true" />;

/** A popover under its button, in the studio's layer, kept on screen. */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  width = 280,
  testId,
  label,
}: {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  testId?: string;
  label: string;
}) {
  const layer = useContext(StudioLayer);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const w = Math.min(width, vw - 16);
      const left = Math.min(Math.max(8, r.left), vw - w - 8);
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const h = boxRef.current?.offsetHeight ?? 300;
      if (below >= Math.min(h, 260) || below >= above) setPos({ left, top: r.bottom + 6, maxH: Math.max(160, below) });
      else setPos({ left, top: Math.max(8, r.top - 6 - Math.min(h, above)), maxH: Math.max(160, above) });
    };
    place();
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    // Placed again when what it holds grows (a list opened inside it): it stays on screen.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (ro && boxRef.current) ro.observe(boxRef.current);
    return () => {
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      ro?.disconnect();
    };
  }, [open, anchor, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || anchor?.contains(t)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      onCloseRef.current();
      anchor?.focus();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor]);

  if (!open || !layer) return null;
  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label={label}
      data-rx-st-popover={testId}
      className="fixed z-[260] rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 p-3 overflow-y-auto"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: Math.min(width, window.innerWidth - 16), maxHeight: pos?.maxH }}
    >
      {children}
    </div>,
    layer,
  );
}

/** A button that opens a popover: the pair, with its own open state. */
export function PopoverButton({
  icon,
  label,
  showLabel,
  testId,
  width,
  active,
  disabled,
  children,
  trigger,
  onClose,
  onOpen,
}: {
  icon?: Icon;
  label: string;
  showLabel?: boolean;
  testId?: string;
  width?: number;
  active?: boolean;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
  /** Something else to show in the button (a colour swatch, a value). */
  trigger?: React.ReactNode;
  /** Told when it closes, however it closes (a live preview to undo). */
  onClose?: () => void;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    onClose?.();
  };
  return (
    <>
      <ToolButton
        buttonRef={ref}
        icon={icon}
        label={label}
        showLabel={showLabel}
        testId={testId}
        active={open || active}
        disabled={disabled}
        onClick={() => {
          if (open) close();
          else {
            setOpen(true);
            onOpen?.();
          }
        }}
      >
        {trigger}
      </ToolButton>
      <Popover anchor={ref.current} open={open} onClose={close} width={width} testId={testId} label={label}>
        {children(close)}
      </Popover>
    </>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="block text-[0.625rem] font-black uppercase tracking-wider text-gray-400 mb-1.5">{children}</span>;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onDone,
  format = (v) => String(v),
  testId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** The hand let go: the moment for one undo step. */
  onDone?: () => void;
  format?: (v: number) => string;
  testId?: string;
}) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[0.6875rem] font-bold text-gray-600">{label}</label>
        <span className="text-[0.6875rem] font-black text-gray-800 tabular-nums">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onDone}
        onKeyUp={onDone}
        data-rx-st-slider={testId}
        className="w-full accent-[#0b77c4]"
      />
    </div>
  );
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/** Palette, any colour, a hex field and — where the browser has one — the eyedropper. */
export function ColourPicker({
  value,
  onPick,
  labels,
  palette = PALETTE_WIDE,
  allowNone = false,
  onlyPalette = false,
  testId,
}: {
  value: string | null | undefined;
  onPick: (colour: string) => void;
  labels: { custom: string; eyedropper: string; hex: string; none?: string };
  palette?: readonly string[];
  allowNone?: boolean;
  /** Only these colours (a side printed in black or greys): no other colour, hex or eyedropper. */
  onlyPalette?: boolean;
  testId?: string;
}) {
  const current = String(value ?? '').toLowerCase();
  const hex = /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000';
  const [typed, setTyped] = useState(hex);
  useEffect(() => setTyped(hex), [hex]);
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  const commitTyped = () => {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(typed.trim());
    if (!m) {
      setTyped(hex);
      return;
    }
    const full = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    onPick(`#${full.toLowerCase()}`);
  };
  return (
    <div className="space-y-2.5" data-rx-st-colours={testId}>
      <div className="grid grid-cols-6 gap-1.5">
        {allowNone && (
          <button
            type="button"
            onClick={() => onPick('')}
            aria-label={labels.none}
            title={labels.none}
            aria-pressed={current === ''}
            data-rx-swatch="none"
            className={cn(
              'relative aspect-square rounded-md border border-gray-300 bg-white overflow-hidden',
              current === '' && 'ring-2 ring-[#0b77c4] ring-offset-1',
            )}
          >
            <span className="absolute left-1/2 top-[-20%] h-[140%] w-px bg-red-500 rotate-45" />
          </button>
        )}
        {palette.map((colour) => (
          <button
            key={colour}
            type="button"
            onClick={() => onPick(colour)}
            aria-label={colour}
            aria-pressed={current === colour}
            data-rx-swatch={colour}
            className={cn(
              'relative aspect-square rounded-md border transition-transform',
              current === colour ? 'ring-2 ring-[#0b77c4] ring-offset-1 border-transparent' : 'border-gray-300 hover:scale-110',
            )}
            style={{ background: colour }}
          >
            {current === colour && (
              <Check className={cn('absolute inset-0 m-auto w-3.5 h-3.5', ['#ffffff', '#ededed', '#ffed00', '#fbba00', '#b2b2b2'].includes(colour) ? 'text-gray-800' : 'text-white')} />
            )}
          </button>
        ))}
      </div>
      {!onlyPalette && (
      <div className="flex items-center gap-2">
        <label
          className="relative shrink-0 w-8 h-8 rounded-full border border-gray-300 overflow-hidden cursor-pointer"
          style={{ background: 'conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)' }}
          title={labels.custom}
        >
          <input type="color" value={hex} onChange={(e) => onPick(e.target.value)} aria-label={labels.custom} className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTyped();
          }}
          aria-label={labels.hex}
          spellCheck={false}
          className="min-w-0 flex-1 h-8 px-2 rounded-lg border border-gray-200 text-base sm:text-xs font-mono font-bold text-gray-800 uppercase"
          data-rx-st-hex={testId}
        />
        {EyeDropper && (
          <button
            type="button"
            title={labels.eyedropper}
            aria-label={labels.eyedropper}
            onClick={async () => {
              try {
                const { sRGBHex } = await new EyeDropper().open();
                if (sRGBHex) onPick(sRGBHex.toLowerCase());
              } catch {
                /* the customer pressed Escape */
              }
            }}
            className="shrink-0 w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50"
          >
            <Pipette className="w-4 h-4" />
          </button>
        )}
      </div>
      )}
    </div>
  );
}

/** A colour shown on a toolbar button. */
export function SwatchDot({ colour }: { colour: string | null | undefined }) {
  const c = String(colour ?? '');
  return (
    <span
      className="w-5 h-5 rounded-full border border-gray-300 shadow-inner"
      style={{ background: c || 'repeating-conic-gradient(#e5e7eb 0 25%, #ffffff 0 50%) 50% / 8px 8px' }}
      aria-hidden="true"
    />
  );
}
