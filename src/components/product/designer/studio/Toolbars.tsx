/**
 * The toolbar for what is chosen on the board — text, a picture, a shape or element,
 * a QR code, a photo frame — as Pixartprinting's Designer lays it out, and the small
 * bar that floats over the chosen object (replace, copy, lock, delete).
 *
 * Every change goes through the engine, which keeps it as one undo step (a slider:
 * one step when the hand lets go). An object held by a lock shows why instead of
 * tools; the shop's "only the words" text offers only its words.
 */
import React, { useEffect, useRef, useState } from 'react';
import { FabricImage, Textbox, type FabricObject } from 'fabric';
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Blend,
  Bold,
  ChevronDown,
  Copy,
  Crop,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Italic,
  Link2,
  Lock,
  LockOpen,
  Maximize,
  Minus,
  Move,
  Pencil,
  Plus,
  QrCode,
  Replace,
  RotateCw,
  Shapes,
  SlidersHorizontal,
  Strikethrough,
  Trash2,
  Underline,
  UnfoldVertical,
  Unlink2,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../../../../lib/utils';
import type { TranslationKey } from '../../../../lib/translations';
import { fontFamilyInfo } from '../../../../lib/designFonts';
import { imageQuality } from '../../../../lib/designSize';
import type { SideInk } from '../../../../lib/printSides';
import { RxQr, type RxTextbox } from '../rxObjects';
import { kindOf, type StudioEngine } from './engine';
import { PALETTE_WIDE, type Tagged } from './studioObjects';
import FontPicker from './FontPicker';
import { ColourPicker, Divider, PopoverButton, SectionLabel, Slider, SwatchDot, ToolButton } from './ui';
import { ELEMENTS } from './panels/ElementsPanel';
import { CapsGlyph, ListGlyph, RotateGlyph, SpacingGlyph } from './look';

type T = (k: TranslationKey) => string;

const GREYS = ['#000000', '#1d1d1b', '#3c3c3b', '#575756', '#706f6f', '#878787', '#9d9d9c', '#b2b2b2', '#c6c6c6', '#dadada', '#ededed', '#ffffff'];

/** The colours a side can print: black-only and greyscale sides are offered greys only. */
export function paletteFor(ink: SideInk | undefined): readonly string[] {
  if (ink === 'black') return ['#000000', '#ffffff'];
  if (ink === 'greyscale') return GREYS;
  return PALETTE_WIDE;
}

interface Common {
  engine: StudioEngine;
  t: T;
  palette: readonly string[];
  inlineText: boolean;
  onReplace: (o: FabricObject) => void;
  onCrop: (o: FabricImage) => void;
  onEditQr: (o: RxQr) => void;
  onEditText: (o: Textbox) => void;
}

const colourLabels = (t: T) => ({ custom: t('dsgCustomColour'), eyedropper: t('stEyedropper'), hex: t('stHex'), none: t('stNoColour') });

/**
 * One number per object on the board, for React's `key`: a box that holds a number typed
 * for one object (the size boxes) is never reused for the next one chosen. Reused, it
 * kept the number typed for the last one, and leaving it put that on the new one
 * (second pass #4). Only those boxes are keyed: an open menu stays open.
 */
const objectKeys = new WeakMap<FabricObject, number>();
let lastObjectKey = 0;
function objectKey(o: FabricObject): number {
  let key = objectKeys.get(o);
  if (key === undefined) {
    lastObjectKey += 1;
    key = lastObjectKey;
    objectKeys.set(o, key);
  }
  return key;
}

/**
 * Was this field left with Escape? The studio's keyboard marks the field it takes the
 * focus from (DesignStudio.tsx), and a box that applies when it is left puts back what
 * it showed instead: Escape is "never mind", it applied the number typed.
 */
const leftWithEscape = (e: React.FocusEvent<HTMLElement>) => e.currentTarget.hasAttribute('data-rx-escaping');

/** Layer order and alignment on the page. */
function PositionButton({ engine, o, t, narrow }: { engine: StudioEngine; o: FabricObject; t: T; narrow?: boolean }) {
  const btn = 'flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-gray-100 text-[0.625rem] font-bold text-gray-700';
  return (
    <PopoverButton icon={Move} label={t('stPosition')} showLabel={!narrow} testId="position" width={280}>
      {() => (
        <div className="space-y-3">
          <div>
            <SectionLabel>{t('stLayer')}</SectionLabel>
            <div className="grid grid-cols-4 gap-1">
              <button type="button" className={btn} onClick={() => engine.arrange('front', o)} data-rx-st-arrange="front"><ArrowUpToLine className="w-4 h-4" />{t('stToFront')}</button>
              <button type="button" className={btn} onClick={() => engine.arrange('forward', o)} data-rx-st-arrange="forward"><ArrowUp className="w-4 h-4" />{t('dsgForward')}</button>
              <button type="button" className={btn} onClick={() => engine.arrange('backward', o)} data-rx-st-arrange="backward"><ArrowDown className="w-4 h-4" />{t('dsgBackward')}</button>
              <button type="button" className={btn} onClick={() => engine.arrange('back', o)} data-rx-st-arrange="back"><ArrowDownToLine className="w-4 h-4" />{t('stToBack')}</button>
            </div>
          </div>
          <div>
            <SectionLabel>{t('stAlignPage')}</SectionLabel>
            <div className="grid grid-cols-3 gap-1">
              <button type="button" className={btn} onClick={() => engine.align('left', o)} data-rx-st-align="left"><AlignHorizontalJustifyStart className="w-4 h-4" />{t('stAlignPLeft')}</button>
              <button type="button" className={btn} onClick={() => engine.align('hcenter', o)} data-rx-st-align="hcenter"><AlignHorizontalJustifyCenter className="w-4 h-4" />{t('stAlignPCenter')}</button>
              <button type="button" className={btn} onClick={() => engine.align('right', o)} data-rx-st-align="right"><AlignHorizontalJustifyEnd className="w-4 h-4" />{t('stAlignPRight')}</button>
              <button type="button" className={btn} onClick={() => engine.align('top', o)} data-rx-st-align="top"><AlignVerticalJustifyStart className="w-4 h-4" />{t('stAlignPTop')}</button>
              <button type="button" className={btn} onClick={() => engine.align('vcenter', o)} data-rx-st-align="vcenter"><AlignVerticalJustifyCenter className="w-4 h-4" />{t('stAlignPMiddle')}</button>
              <button type="button" className={btn} onClick={() => engine.align('bottom', o)} data-rx-st-align="bottom"><AlignVerticalJustifyEnd className="w-4 h-4" />{t('stAlignPBottom')}</button>
            </div>
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

function OpacityButton({ engine, o, t, narrow }: { engine: StudioEngine; o: FabricObject; t: T; narrow?: boolean }) {
  return (
    <PopoverButton icon={Blend} label={t('stOpacity')} showLabel={!narrow} testId="opacity" width={240}>
      {() => (
        <Slider
          label={t('stOpacity')}
          value={Math.round((o.opacity ?? 1) * 100)}
          min={5}
          max={100}
          onChange={(v) => engine.change(o, { opacity: v / 100 }, { soon: true })}
          format={(v) => `${v} %`}
          testId="opacity"
        />
      )}
    </PopoverButton>
  );
}

/**
 * The text's size in points: a step down or up, or typed — applied on Enter or when the
 * box is left, then showing the size it HAS (held between 4 and 2000 pt, or left as it
 * was); Escape puts back what it showed. One box per text: TextTools keys it by the
 * text (objectKey), so a size typed for one never lands on the next one chosen.
 */
function PtBox({ engine, tb, t }: { engine: StudioEngine; tb: Textbox; t: T }) {
  const pt = engine.ptOf(tb);
  const [typed, setTyped] = useState(String(pt));
  useEffect(() => setTyped(String(pt)), [pt]);
  const step = pt < 20 ? 1 : pt < 100 ? 2 : 10;
  const setTypedPt = () => {
    // Left as shown: nothing to do (its rounded 14.0 must not nudge the size).
    if (typed === String(pt)) return;
    const v = Number(typed.replace(',', '.'));
    if (Number.isFinite(v) && v > 0) engine.setPt(tb, v, { soon: false });
    setTyped(String(engine.ptOf(tb)));
  };
  return (
    <div className="flex items-center justify-between w-[8.625rem] h-[2.25rem] mx-1 px-1 rounded border border-[#9bb1b1] bg-white shrink-0" role="group" aria-label={t('dsgTextSize')}>
      <ToolButton icon={Minus} label={t('stSmaller')} onClick={() => engine.setPt(tb, Math.max(4, pt - step), { soon: true })} testId="smaller" className="h-8 w-8" iconClassName="w-4 h-4" iconStroke={2.6} />
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={(e) => (leftWithEscape(e) ? setTyped(String(engine.ptOf(tb))) : setTypedPt())}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setTypedPt();
        }}
        inputMode="decimal"
        aria-label={t('stTextSizePt')}
        title={t('stTextSizePt')}
        className="w-12 h-8 text-center text-base sm:text-[0.9375rem] text-black tabular-nums border-0 bg-transparent outline-none"
        data-rx-designer-pt
      />
      <ToolButton icon={Plus} label={t('stLarger')} onClick={() => engine.setPt(tb, pt + step, { soon: true })} testId="larger" className="h-8 w-8" iconClassName="w-4 h-4" iconStroke={2.6} />
    </div>
  );
}

function TextTools({ engine, o, t, palette, inlineText, onEditText, narrow }: Common & { o: Textbox; narrow: boolean }) {
  const tb = o as Textbox & Tagged & RxTextbox;
  const info = fontFamilyInfo(tb.fontFamily);
  const wordsOnly = engine.opts.mode === 'customer' && tb.rxLock === 'words';
  if (wordsOnly) {
    return (
      <>
        {!inlineText && <ToolButton icon={Pencil} label={t('stEditText')} showLabel onClick={() => onEditText(tb)} testId="edit-text" />}
        <span className="flex items-center gap-1.5 px-2 text-[0.6875rem] font-bold text-gray-500" data-rx-words-only>
          <Lock className="w-3.5 h-3.5" />
          {t('dsgWordsOnly')}
        </span>
      </>
    );
  }
  const toggleList = () => {
    const lines = String(tb.text ?? '').split('\n');
    const on = !tb.rxList;
    const text = lines.map((l) => (on ? (l.trim() && !l.startsWith('• ') ? `• ${l}` : l) : l.replace(/^• /, ''))).join('\n');
    tb.rxList = on;
    engine.change(tb, { text });
  };
  const AlignIcon = tb.textAlign === 'left' ? AlignLeft : tb.textAlign === 'right' ? AlignRight : tb.textAlign === 'justify' ? AlignJustify : AlignCenter;
  // Pixart's text bar: the typeface in a box (its name in its own face), the size in
  // a box with − and +, "A" over its colour, B I U S, then Capitals, Alignment,
  // Spacing, List — and "More" for the rest.
  return (
    <>
      {!inlineText && <ToolButton icon={Pencil} label={t('stEditText')} showLabel={!narrow} onClick={() => onEditText(tb)} testId="edit-text" />}
      <PopoverButton
        label={t('dsgFont')}
        testId="font"
        width={300}
        trigger={
          <span className="flex items-center justify-between gap-2 w-[12.5rem] h-[2.25rem] pl-3.5 pr-2 rounded border border-[#9bb1b1] bg-white">
            <span className="truncate text-[1.1875rem] text-black" style={{ fontFamily: `"${tb.fontFamily}", sans-serif` }}>
              {info?.label ?? tb.fontFamily}
            </span>
            <ChevronDown className="w-5 h-5 shrink-0 text-[#1174ba]" strokeWidth={2} />
          </span>
        }
      >
        {(close) => (
          <FontPicker
            value={String(tb.fontFamily)}
            t={t}
            onPick={(family) => {
              close();
              void engine.setFontFamily(tb, family);
            }}
          />
        )}
      </PopoverButton>
      <PtBox key={objectKey(tb)} engine={engine} tb={tb} t={t} />
      <PopoverButton
        label={t('dsgColour')}
        testId="text-colour"
        width={260}
        trigger={
          <span className="flex flex-col items-center leading-none px-1.5">
            <span className="text-[1.25rem] font-normal text-[#1174ba]">A</span>
            <span className="mt-1 w-[1.5rem] h-[0.375rem] rounded-full ring-1 ring-black/10" style={{ background: String(tb.fill ?? '#000000') }} />
          </span>
        }
      >
        {() => <ColourPicker value={String(tb.fill ?? '')} onPick={(c) => c && engine.change(tb, { fill: c }, { soon: true })} palette={palette} onlyPalette={palette !== PALETTE_WIDE} labels={colourLabels(t)} testId="text" />}
      </PopoverButton>
      <ToolButton icon={Bold} label={t('dsgBold')} active={tb.fontWeight === 'bold'} disabled={!info?.bold} onClick={() => engine.change(tb, { fontWeight: tb.fontWeight === 'bold' ? 'normal' : 'bold' })} testId="bold" />
      <ToolButton icon={Italic} label={t('stItalic')} active={tb.fontStyle === 'italic'} disabled={!info?.italic} onClick={() => engine.change(tb, { fontStyle: tb.fontStyle === 'italic' ? 'normal' : 'italic' })} testId="italic" />
      <ToolButton icon={Underline} label={t('stUnderline')} active={!!tb.underline} onClick={() => engine.change(tb, { underline: !tb.underline })} testId="underline" />
      <ToolButton icon={Strikethrough} label={t('stStrike')} active={!!tb.linethrough} onClick={() => engine.change(tb, { linethrough: !tb.linethrough })} testId="strike" />
      <Divider />
      <ToolButton icon={CapsGlyph} label={t('stCaps')} showLabel={!narrow} active={!!tb.rxCaps} onClick={() => engine.change(tb, { rxCaps: !tb.rxCaps })} testId="caps" />
      <PopoverButton icon={AlignIcon} label={t('stAlign')} showLabel={!narrow} testId="align" width={220}>
        {(close) => (
          <div className="grid grid-cols-4 gap-1">
            {([
              ['left', AlignLeft, 'dsgAlignLeft'],
              ['center', AlignCenter, 'dsgAlignCenter'],
              ['right', AlignRight, 'dsgAlignRight'],
              ['justify', AlignJustify, 'stAlignJustify'],
            ] as const).map(([a, Icon, label]) => (
              <ToolButton
                key={a}
                icon={Icon}
                label={t(label)}
                active={tb.textAlign === a}
                onClick={() => {
                  engine.change(tb, { textAlign: a });
                  close();
                }}
                testId={`align-${a}`}
              />
            ))}
          </div>
        )}
      </PopoverButton>
      <PopoverButton icon={SpacingGlyph} label={t('stSpacing')} showLabel={!narrow} testId="spacing" width={260}>
        {() => (
          <div className="space-y-3">
            <Slider label={t('stLetterSpacing')} value={Math.round(tb.charSpacing ?? 0)} min={-100} max={800} step={10} onChange={(v) => engine.change(tb, { charSpacing: v }, { soon: true })} testId="letter-spacing" />
            <Slider label={t('stLineSpacing')} value={Math.round((tb.lineHeight ?? 1.16) * 100) / 100} min={0.7} max={3} step={0.05} onChange={(v) => engine.change(tb, { lineHeight: v }, { soon: true })} format={(v) => v.toFixed(2)} testId="line-height" />
          </div>
        )}
      </PopoverButton>
      <ToolButton icon={ListGlyph} label={t('stList')} showLabel={!narrow} active={!!tb.rxList} onClick={toggleList} testId="list" />
      {/* Pixart keeps "Show more" at the far end of the bar. */}
      {!narrow && <span className="flex-1" aria-hidden="true" />}
      <Divider />
      <MoreButton engine={engine} o={tb} t={t} />
    </>
  );
}

/** Pixart's "More": rotate, opacity, the layer and the place on the page. */
function MoreButton({ engine, o, t }: { engine: StudioEngine; o: FabricObject; t: T }) {
  const btn = 'flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-[#e7f1f8] text-[0.6875rem] text-[#1d1d1d]';
  return (
    <PopoverButton
      label={t('stMore')}
      testId="more"
      width={300}
      trigger={
        <span className="flex items-center gap-2 px-1 text-[0.9375rem] text-[#1d1d1d] whitespace-nowrap">
          {t('stMore')}
          <ChevronRight className="w-7 h-7 text-[#1174ba]" strokeWidth={2.2} />
        </span>
      }
    >
      {() => (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1">
            <button type="button" className={btn} onClick={() => engine.rotate90(o)} data-rx-st-more="rotate"><RotateCw className="w-4 h-4 text-[#1174ba]" />{t('stRotate')}</button>
            <button type="button" className={btn} onClick={() => engine.arrange('front', o)} data-rx-st-arrange="front"><ArrowUpToLine className="w-4 h-4 text-[#1174ba]" />{t('stToFront')}</button>
            <button type="button" className={btn} onClick={() => engine.arrange('back', o)} data-rx-st-arrange="back"><ArrowDownToLine className="w-4 h-4 text-[#1174ba]" />{t('stToBack')}</button>
            <button type="button" className={btn} onClick={() => void engine.duplicate(o)} data-rx-st-more="duplicate"><Copy className="w-4 h-4 text-[#1174ba]" />{t('dsgDuplicate')}</button>
          </div>
          <Slider
            label={t('stOpacity')}
            value={Math.round((o.opacity ?? 1) * 100)}
            min={5}
            max={100}
            onChange={(v) => engine.change(o, { opacity: v / 100 }, { soon: true })}
            format={(v) => `${v} %`}
            testId="opacity"
          />
          <div>
            <SectionLabel>{t('stAlignPage')}</SectionLabel>
            <div className="grid grid-cols-3 gap-1">
              <button type="button" className={btn} onClick={() => engine.align('left', o)} data-rx-st-align="left"><AlignHorizontalJustifyStart className="w-4 h-4 text-[#1174ba]" />{t('stAlignPLeft')}</button>
              <button type="button" className={btn} onClick={() => engine.align('hcenter', o)} data-rx-st-align="hcenter"><AlignHorizontalJustifyCenter className="w-4 h-4 text-[#1174ba]" />{t('stAlignPCenter')}</button>
              <button type="button" className={btn} onClick={() => engine.align('right', o)} data-rx-st-align="right"><AlignHorizontalJustifyEnd className="w-4 h-4 text-[#1174ba]" />{t('stAlignPRight')}</button>
              <button type="button" className={btn} onClick={() => engine.align('top', o)} data-rx-st-align="top"><AlignVerticalJustifyStart className="w-4 h-4 text-[#1174ba]" />{t('stAlignPTop')}</button>
              <button type="button" className={btn} onClick={() => engine.align('vcenter', o)} data-rx-st-align="vcenter"><AlignVerticalJustifyCenter className="w-4 h-4 text-[#1174ba]" />{t('stAlignPMiddle')}</button>
              <button type="button" className={btn} onClick={() => engine.align('bottom', o)} data-rx-st-align="bottom"><AlignVerticalJustifyEnd className="w-4 h-4 text-[#1174ba]" />{t('stAlignPBottom')}</button>
            </div>
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

/**
 * THE SIZE, TYPED: W × H in mm, as the text's size box takes points (code review
 * DSN-20). Applied on Enter or when the box is left, as one undo step, about the
 * object's centre; then both fields show the size the object HAS — held at a limit,
 * or left as it was, they kept showing the number typed (second pass #4). Escape puts
 * back what they showed and changes nothing. A picture keeps its proportions; a shape
 * does while its chain is on. A line has no height of its own (its thickness is its
 * stroke's): only its length is offered. One box per object — keyed by it
 * (objectKey) — so numbers typed for one never land on the next one chosen.
 */
function SizeBox({ engine, o, t, ratioToggle = false }: { engine: StudioEngine; o: FabricObject; t: T; ratioToggle?: boolean }) {
  const size = engine.sizeMmOf(o);
  const shown = (mm: number) => String(Math.round(mm * 10) / 10);
  const [w, setW] = useState(shown(size.w));
  const [h, setH] = useState(shown(size.h));
  const [keep, setKeep] = useState(true);
  useEffect(() => setW(shown(size.w)), [size.w]);
  useEffect(() => setH(shown(size.h)), [size.h]);
  // The one side a line has: the other has no size to type.
  const only: 'w' | 'h' | null = !(o.height > 0) ? 'w' : !(o.width > 0) ? 'h' : null;
  const showNow = () => {
    const now = engine.sizeMmOf(o);
    setW(shown(now.w));
    setH(shown(now.h));
  };
  const apply = (side: 'w' | 'h') => {
    const typed = side === 'w' ? w : h;
    // Left as shown: nothing to do (a rounded 50.3 must not become a step of its own).
    if (typed === shown(side === 'w' ? size.w : size.h)) return;
    const mm = Number(typed.replace(',', '.'));
    if (Number.isFinite(mm) && mm > 0) engine.setSizeMm(o, side, mm, !ratioToggle || keep);
    showNow();
  };
  if (!(o.width > 0) && !(o.height > 0)) return null;
  const label = (side: 'w' | 'h') => t(only ? 'stSizeLength' : side === 'w' ? 'stSizeWidth' : 'stSizeHeight');
  const field = (side: 'w' | 'h') => (
    <input
      value={side === 'w' ? w : h}
      onChange={(e) => (side === 'w' ? setW : setH)(e.target.value)}
      onBlur={(e) => (leftWithEscape(e) ? showNow() : apply(side))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') apply(side);
      }}
      inputMode="decimal"
      aria-label={label(side)}
      title={label(side)}
      className="w-[3.25rem] h-9 text-center text-base sm:text-[0.9375rem] text-black tabular-nums border-0 bg-transparent outline-none disabled:opacity-40"
      data-rx-st-size={side}
    />
  );
  return (
    <>
      <div
        className="flex items-center h-10 mx-1 px-1 rounded border border-[#9bb1b1] bg-white shrink-0 hover:border-[#1174ba] focus-within:border-[#1174ba] focus-within:ring-1 focus-within:ring-[#1174ba]"
        role="group"
        aria-label={t('stSizeMm')}
        data-rx-st-sizebox={only ? 'length' : ''}
      >
        {only ? (
          field(only)
        ) : (
          <>
            {field('w')}
            <span className="text-[0.875rem] text-[#686868]" aria-hidden="true">×</span>
            {field('h')}
          </>
        )}
        <span className="pr-1.5 text-[0.8125rem] text-[#686868]" aria-hidden="true">mm</span>
      </div>
      {ratioToggle && !only && <ToolButton icon={keep ? Link2 : Unlink2} label={t('stSizeKeepRatio')} active={keep} onClick={() => setKeep((v) => !v)} testId="size-ratio" />}
    </>
  );
}

function AdjustButton({ engine, o, t, narrow }: { engine: StudioEngine; o: FabricImage; t: T; narrow: boolean }) {
  const start = (o as Tagged).rxAdjust ?? { hue: 0, sat: 0, bright: 0 };
  const [v, setV] = useState(start);
  const applied = useRef(false);
  const frame = useRef(0);
  const preview = (next: typeof v) => {
    setV(next);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => void engine.previewAdjust(o, next));
  };
  return (
    <PopoverButton
      icon={SlidersHorizontal}
      label={t('stAdjust')}
      showLabel={!narrow}
      testId="adjust"
      width={270}
      onOpen={() => {
        applied.current = false;
        setV((o as Tagged).rxAdjust ?? { hue: 0, sat: 0, bright: 0 });
      }}
      onClose={() => {
        if (!applied.current) void engine.cancelAdjust(o);
      }}
    >
      {(close) => (
        <div className="space-y-3">
          <Slider label={t('stHue')} value={v.hue} min={-180} max={180} onChange={(hue) => preview({ ...v, hue })} format={(x) => `${x}°`} testId="hue" />
          <Slider label={t('stSaturation')} value={v.sat} min={-100} max={100} onChange={(sat) => preview({ ...v, sat })} testId="saturation" />
          <Slider label={t('stBrightness')} value={v.bright} min={-100} max={100} onChange={(bright) => preview({ ...v, bright })} testId="brightness" />
          <div className="flex gap-2">
            <button type="button" onClick={() => preview({ hue: 0, sat: 0, bright: 0 })} className="flex-1 px-3 py-2 rounded-full text-xs font-black text-gray-700 bg-white border border-gray-300">
              {t('stReset')}
            </button>
            <button
              type="button"
              onClick={async () => {
                // Kept only once it IS kept: an edit that failed was "applied" here, so
                // closing never put the picture back — the board showed the edit while
                // the design (the print) kept the original.
                try {
                  await engine.applyAdjust(o, v);
                  applied.current = true;
                } catch (err) {
                  console.warn('The colour edit could not be made:', err);
                  void engine.cancelAdjust(o);
                }
                close();
              }}
              data-rx-st-adjust-apply
              className="flex-1 px-3 py-2 rounded-full text-xs font-black text-white bg-[#0b77c4] hover:bg-[#0a68ab]"
            >
              {t('stApply')}
            </button>
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

function ImageTools({ engine, o, t, onReplace, onCrop, narrow }: Common & { o: FabricImage; narrow: boolean }) {
  const dpi = engine.dpiOf(o);
  const level = imageQuality(dpi, engine.spec);
  const shape = engine.shapeOf(o);
  const item = 'w-full flex items-center gap-2 px-2.5 py-2 rounded-xl hover:bg-gray-100 text-xs font-bold text-gray-700 text-left';
  return (
    <>
      <ToolButton icon={Replace} label={t('stReplace')} showLabel={!narrow} onClick={() => onReplace(o)} testId="replace" />
      <AdjustButton engine={engine} o={o} t={t} narrow={narrow} />
      <ToolButton icon={Crop} label={t('stCrop')} showLabel={!narrow} onClick={() => onCrop(o)} testId="crop" />
      <PopoverButton icon={FlipHorizontal2} label={t('stFlip')} showLabel={!narrow} testId="flip" width={230}>
        {(close) => (
          <div className="space-y-1">
            <button type="button" className={item} onClick={() => { engine.flip(o, 'x'); close(); }} data-rx-st-flip="x"><FlipHorizontal2 className="w-4 h-4" />{t('stFlipH')}</button>
            <button type="button" className={item} onClick={() => { engine.flip(o, 'y'); close(); }} data-rx-st-flip="y"><FlipVertical2 className="w-4 h-4" />{t('stFlipV')}</button>
          </div>
        )}
      </PopoverButton>
      <PopoverButton icon={Maximize} label={t('stFit')} showLabel={!narrow} testId="fit" width={270}>
        {(close) => (
          <div className="space-y-1">
            {!engine.backgroundLocked && (
              <button type="button" className={item} onClick={() => { engine.fillBackground(o); close(); }} data-rx-st-fit="fill">{t('stFitFill')}</button>
            )}
            <button type="button" className={item} onClick={() => { engine.fitInside(o); close(); }} data-rx-st-fit="page">{t('stFitPage')}</button>
            <button type="button" className={item} onClick={() => { engine.fitInside(o, true); close(); }} data-rx-st-fit="safe">{t('stFitSafe')}</button>
          </div>
        )}
      </PopoverButton>
      <PopoverButton icon={Shapes} label={t('stShape')} showLabel={!narrow} testId="shape" width={250}>
        {(close) => (
          <div className="grid grid-cols-2 gap-1">
            {([
              ['none', 'stShapeNone', 'rounded-none'],
              ['rounded', 'stShapeRounded', 'rounded-lg'],
              ['circle', 'stShapeCircle', 'rounded-full aspect-square'],
              ['ellipse', 'stShapeEllipse', 'rounded-[50%]'],
            ] as const).map(([k, label, cls]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  engine.setShape(o, k);
                  close();
                }}
                aria-pressed={shape === k}
                data-rx-st-shape={k}
                className={cn('flex flex-col items-center gap-1 p-2 rounded-xl text-[0.6875rem] font-bold', shape === k ? 'bg-[#e7f1f8] text-[#08558c]' : 'hover:bg-gray-100 text-gray-700')}
              >
                <span className={cn('block h-7 bg-gray-300', k === 'circle' ? 'w-7' : 'w-10', cls)} />
                {t(label)}
              </button>
            ))}
          </div>
        )}
      </PopoverButton>
      <Divider />
      <SizeBox key={objectKey(o)} engine={engine} o={o} t={t} />
      <OpacityButton engine={engine} o={o} t={t} narrow />
      <PositionButton engine={engine} o={o} t={t} narrow={narrow} />
      <span
        className={cn(
          'shrink-0 ml-1 px-2 py-1 rounded-full text-[0.625rem] font-black whitespace-nowrap',
          level === 'good' && 'text-emerald-800 bg-emerald-50',
          level === 'fair' && 'text-amber-800 bg-amber-50',
          level === 'poor' && 'text-red-700 bg-red-50',
        )}
        title={t(level === 'good' ? 'dsgPhotoGood' : level === 'fair' ? 'dsgPhotoFair' : 'dsgPhotoPoor').replace('{0}', String(Math.round(dpi)))}
        data-rx-photo-quality={level}
      >
        {Math.round(dpi)} DPI
      </span>
    </>
  );
}

/** Which paint an element is coloured with: its library entry says; a plain shape is filled. */
function paintOf(o: FabricObject): 'fill' | 'stroke' | 'none' {
  const el = (o as Tagged).rxElement;
  if (el) return ELEMENTS.find((e) => e.id === el.id)?.paint ?? 'fill';
  return 'fill';
}

function ShapeTools({ engine, o, t, palette, narrow }: Common & { o: FabricObject; narrow: boolean }) {
  const paint = paintOf(o);
  const parts = o.type === 'group' || o.type === 'Group' ? ((o as unknown as { getObjects(): FabricObject[] }).getObjects?.() ?? []) : [o];
  const first = parts.find((p) => (paint === 'stroke' ? p.stroke : p.fill)) ?? parts[0];
  const current = String((paint === 'stroke' ? first?.stroke : first?.fill) ?? '');
  const recolour = (c: string) => {
    for (const p of parts) {
      if (paint === 'stroke') p.set('stroke', c);
      else if (p.fill && p.fill !== '') p.set('fill', c);
    }
    engine.change(o, { dirty: true }, { soon: true });
  };
  const outlined = paint !== 'stroke' && !(o as Tagged).rxElement;
  return (
    <>
      {paint !== 'none' && (
        <PopoverButton label={t('dsgColour')} showLabel={!narrow} testId="shape-colour" width={260} trigger={<SwatchDot colour={current} />}>
          {() => <ColourPicker value={current} onPick={(c) => c && recolour(c)} palette={palette} onlyPalette={palette !== PALETTE_WIDE} labels={colourLabels(t)} testId="shape" />}
        </PopoverButton>
      )}
      {outlined && (
        <PopoverButton label={t('stOutline')} showLabel={!narrow} testId="outline" width={260} trigger={<span className="w-5 h-5 rounded-full border-[3px]" style={{ borderColor: String(o.stroke || '#d1d5db') }} />}>
          {() => (
            <div className="space-y-3">
              <ColourPicker value={String(o.stroke ?? '')} onPick={(c) => engine.change(o, { stroke: c || null, strokeWidth: c ? Math.max(o.strokeWidth || 0, 10) : 0, strokeUniform: true }, { soon: true })} palette={palette} onlyPalette={palette !== PALETTE_WIDE} allowNone labels={colourLabels(t)} testId="outline" />
              {!!o.stroke && (
                <Slider label={t('stOutlineWidth')} value={Math.round((o.strokeWidth || 0) / 10 * 10) / 10} min={0.1} max={20} step={0.1} onChange={(mm) => engine.change(o, { strokeWidth: mm * 10, strokeUniform: true }, { soon: true })} format={(v) => `${v.toFixed(1)} mm`} testId="outline-width" />
              )}
            </div>
          )}
        </PopoverButton>
      )}
      {paint === 'stroke' && (
        <PopoverButton label={t('stOutlineWidth')} icon={UnfoldVertical} testId="stroke-width" width={240}>
          {() => (
            <Slider label={t('stOutlineWidth')} value={Math.round(((first?.strokeWidth || 1) * 100)) / 100} min={0.25} max={12} step={0.25} onChange={(w) => {
              for (const p of parts) p.set({ strokeWidth: w, strokeUniform: true });
              engine.change(o, { dirty: true }, { soon: true });
            }} format={(v) => v.toFixed(2)} testId="stroke-width" />
          )}
        </PopoverButton>
      )}
      <Divider />
      <SizeBox key={objectKey(o)} engine={engine} o={o} t={t} ratioToggle />
      <OpacityButton engine={engine} o={o} t={t} narrow />
      <PositionButton engine={engine} o={o} t={t} narrow={narrow} />
    </>
  );
}

function QrTools({ engine, o, t, onEditQr, narrow }: Common & { o: RxQr; narrow: boolean }) {
  return (
    <>
      <ToolButton icon={QrCode} label={t('stQrUpdate')} showLabel={!narrow} onClick={() => onEditQr(o)} testId="edit-qr" />
      <PopoverButton label={t('stQrColour')} showLabel={!narrow} testId="qr-colour" width={260} trigger={<SwatchDot colour={String(o.fill ?? '#000000')} />}>
        {() => (
          <div className="space-y-3">
            <ColourPicker value={String(o.fill ?? '')} onPick={(c) => c && engine.change(o, { fill: c, dirty: true }, { soon: true })} labels={colourLabels(t)} testId="qr-fg" />
            <div>
              <SectionLabel>{t('stQrBackground')}</SectionLabel>
              <div className="flex gap-1.5">
                <ToolButton label={t('stQrBgWhite')} showLabel active={!!o.rxQrBg} onClick={() => engine.change(o, { rxQrBg: '#ffffff', dirty: true })} testId="qr-bg-white" />
                <ToolButton label={t('stQrBgNone')} showLabel active={!o.rxQrBg} onClick={() => engine.change(o, { rxQrBg: '', dirty: true })} testId="qr-bg-none" />
              </div>
            </div>
          </div>
        )}
      </PopoverButton>
      <Divider />
      <PositionButton engine={engine} o={o} t={t} narrow={narrow} />
    </>
  );
}

/** The toolbar for the chosen object (nothing when nothing is chosen). */
export function ContextToolbar(props: Common & { narrow: boolean }) {
  const { engine, t } = props;
  const o = engine.selected;
  if (!o) return null;
  const kind = kindOf(o);
  // The pattern background is set in the Backgrounds panel: no tools for it here (no size box).
  if (kind === 'pattern') return null;
  if (engine.fixedSelected && (o as Tagged).rxLock === 'unlockable') {
    return (
      <span className="flex items-center gap-1.5 px-2 text-[0.6875rem] font-bold text-gray-600" data-rx-st-locked-hint>
        <Lock className="w-3.5 h-3.5" />
        {t('stLockedHint')}
      </span>
    );
  }
  if (kind === 'text' && o instanceof Textbox) return <TextTools {...props} o={o} />;
  if (kind === 'image' && o instanceof FabricImage) return <ImageTools {...props} o={o} />;
  if (kind === 'qr' && o instanceof RxQr) return <QrTools {...props} o={o} />;
  if (kind === 'slot') {
    return (
      <>
        <ToolButton icon={ImagePlus} label={t('dsgAddPhotoHere')} showLabel onClick={() => props.onReplace(o)} testId="slot-add" />
        <Divider />
        <PositionButton engine={engine} o={o} t={t} narrow={props.narrow} />
      </>
    );
  }
  return <ShapeTools {...props} o={o} />;
}

/**
 * The bar over the chosen object: replace (a picture or a frame), copy, lock or
 * unlock, delete. Follows the object as it moves; never covers the top of the screen.
 */
export function ObjectBar({ engine, t, area, onReplace }: { engine: StudioEngine; t: T; area: HTMLElement | null; onReplace: (o: FabricObject) => void }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const o = engine.selected;
  useEffect(() => {
    if (!o || !area) {
      setPos(null);
      return;
    }
    const place = () => {
      const r = engine.screenRectOf(o);
      const bar = barRef.current;
      if (!r || !bar) return;
      const w = bar.offsetWidth || 160;
      const h = bar.offsetHeight || 40;
      const aw = area.clientWidth;
      const ah = area.clientHeight;
      let top = r.top - h - 18;
      // Under it instead, clear of the turn handle hanging below it.
      if (top < 6) top = Math.min(ah - h - 6, r.bottom + 56);
      const left = Math.min(Math.max(6, (r.left + r.right) / 2 - w / 2), Math.max(6, aw - w - 6));
      setPos({ left, top: Math.max(6, top) });
    };
    place();
    const off = engine.subscribeView(place);
    return () => {
      off();
    };
  }, [o, area, engine]);
  if (!o || engine.preview) return null;
  const tag = o as Tagged;
  const customer = engine.opts.mode === 'customer';
  const kind = kindOf(o);
  if (customer && (tag.rxLock === 'words' || tag.rxLock === 'locked')) return null;
  const locked = customer && tag.rxLock === 'unlockable';
  return (
    <div
      ref={barRef}
      className="absolute z-20 flex items-center gap-[1.375rem] px-[1.125rem] h-[4.125rem] rounded-lg bg-white shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      data-rx-st-objectbar
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!locked && (kind === 'image' || kind === 'slot') && <ToolButton icon={Replace} label={t('stReplace')} onClick={() => onReplace(o)} testId="bar-replace" />}
      {!locked && <ToolButton icon={RotateGlyph} label={t('stRotate')} onClick={() => engine.rotate90(o)} testId="bar-rotate" />}
      {!locked && <ToolButton icon={Copy} label={t('dsgDuplicate')} onClick={() => void engine.duplicate(o)} testId="bar-duplicate" />}
      <ToolButton icon={locked ? Lock : LockOpen} label={locked ? t('stUnlock') : t('stLock')} active={locked} onClick={() => engine.toggleLock(o)} testId="bar-lock" />
      {!locked && <ToolButton icon={Trash2} label={t('dsgDelete')} onClick={() => engine.remove(o)} testId="delete" className="hover:text-red-600" />}
    </div>
  );
}
