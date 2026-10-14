import React, { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { Canvas, Circle, FabricImage, Group, Rect, Textbox, cache, type FabricObject } from 'fabric';
import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Circle as CircleIcon,
  Copy,
  ImagePlus,
  LayoutTemplate,
  Loader2,
  Lock,
  Maximize2,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { localeFor } from '../../../lib/dateFormat';
import { localized } from '../../../lib/localizedText';
import { templateMiss, type TemplateMiss } from '../../../lib/designTemplateMatch';
import { referencedImageIds, TEMPLATE_JSON_MAX } from '../../../lib/designTemplateDoc';
import type { Language, TranslationKey } from '../../../lib/translations';
import { outlinePath, type OutlineKind } from '../../../lib/shapes';
import { DESIGN_BLEED_MM, designExportSize, effectiveDpi, imageQuality } from '../../../lib/designSize';
import { DESIGN_TEMPLATES, SAFE_MARGIN_MM, safeBox, templateLayout, type TemplateId } from '../../../lib/designTemplates';
import NeoSizePreview from '../NeoSizePreview';
import DesignGuides from './DesignGuides';
import { DEFAULT_DESIGNER_FONT, DESIGNER_FONTS, loadDesignerFonts } from './fonts';
import { deleteDraft, loadDraft, saveDraft } from './draftStore';
import { exportDesign, renderThumbnail } from './exportDesign';
import { fetchPictures, fetchTemplateFull } from './templatesApi';
import { fitText } from './fitText';
import type { DesignDraft, DesignerResult, TemplateDesign, TemplateMeta, TemplateSummary } from './types';
import { holdReloads } from '../../../lib/reloadHold';

/**
 * THE ONLINE DESIGNER — round 16, item 5.
 *
 * The catalogue has always sold "Design online from a ready-made template", and
 * nothing was behind it. This is: a full-screen dialog over the product page,
 * where the board IS the product. It has the chosen trim size, in millimetres,
 * with the 3 mm bleed around it, and the cut line of the chosen shape. "Use this
 * design" makes the print file (exportDesign.ts) and shows it back for a last
 * check. "Add to my order" hands it to the page, which attaches it exactly as if
 * the customer had uploaded it.
 *
 * Built for a phone first. The board fits the screen both ways. Text is edited
 * in a plain text box under the board, not inside the canvas, where the iPhone
 * keyboard would cover what is being typed. The handles are big enough for a
 * thumb. A size slider stands in for the pinch fabric does not have. The dialog
 * follows the visible viewport, so the keyboard never hides it.
 *
 * Nothing is lost. Every change is kept on the device (draftStore.ts). The
 * phone's Back gesture closes the dialog instead of leaving the product (the
 * page put a history entry under it). Closing an unsent design says it is not
 * on the order yet.
 *
 * TWO MODES (round 16, item 5b). For a CUSTOMER it starts from the owner's own
 * templates for this product (src/lib/designTemplateMatch.ts decides which fit),
 * then the basic layouts. For the OWNER, in the dashboard, it is where he makes
 * those templates: the same tools, plus "for the customer" on every element
 * (free, only the words, locked), and "Save template" instead of a print file.
 * A lock lives in the design as `rxLock` and is applied in dressControls, which
 * runs after EVERY load (undo, redo, a draft, a template): fabric does not keep
 * selectable/evented/lock* in its JSON, so a lock set once would be gone after the
 * first Undo.
 */

/** Board units per millimetre: tenths, so a 1.5 mm caption is a 15-unit font, never a sub-pixel one. */
const U = 10;
/** Our own properties, carried through fabric's JSON. */
const PROPS = ['rxImageId', 'rxSlot', 'rxFill', 'rxLock', 'rxBox'];
const MAX_UNDO = 30;
const PT_PER_MM = 72 / 25.4;
/** Pictures are cut down to this on the way in: enough for any file the designer makes. */
const MAX_PICTURE_SIDE = 4096;
const MAX_PICTURE_BYTES = 40 * 1024 * 1024;
/**
 * Colours that print as they look: the screen versions of plain process mixes
 * (C100, M100+Y100, Y100…), all inside the press's FOGRA39 range. Screen-only
 * colours (an electric violet, a bright sky blue) print noticeably duller; they
 * are still one tap further, under the picker.
 */
const PALETTE = ['#000000', '#ffffff', '#706f6f', '#e30613', '#f39200', '#ffed00', '#009640', '#009fe3', '#1d71b8', '#662483'];
const INK = '#111111';

/**
 * `rxFill`: a picture stretched over the whole board, bleed included (kept so when the size changes).
 * `rxLock`: what a CUSTOMER may do with it, set by the owner — anything (absent), only the words, nothing.
 * `rxBox`: for "only the words", the box the shop drew (width, height, type size, in board
 * units): the customer's words are fitted into it, never let out of it.
 */
type Lock = 'words' | 'locked';
type TextBox = { w: number; h: number; fontSize: number };
type Tagged = FabricObject & { rxImageId?: string; rxSlot?: boolean; rxFill?: boolean; rxLock?: Lock; rxBox?: TextBox };
type Mode = 'customer' | 'owner';
type Phase = 'loading' | 'failed' | 'start' | 'edit' | 'exporting' | 'proof';

interface Proof {
  file: File;
  preview: File;
  widthPx: number;
  heightPx: number;
  lowestDpi: number | null;
  textNearEdge: boolean;
  emptySlots: number;
}

export interface OnlineDesignerProps {
  productId: string;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  /** "50 × 50 mm" — shown under the title. */
  sizeLabel?: string;
  /** The page's copy of the design from an earlier opening, if any. */
  draft: DesignDraft | null;
  onDraftChange: (draft: DesignDraft) => void;
  onUse: (result: DesignerResult) => void;
  onClose: () => void;
  t: (key: TranslationKey) => string;
  /** The shopper's language: the one date the designer shows is written in it. */
  language: Language;
  /** 'owner' in the dashboard's template editor; a customer otherwise. */
  mode?: Mode;
  /** Where the device draft is kept; the product id unless given (template:<id> for the owner). */
  draftKey?: string;
  /** Customer: the owner's templates for this product (undefined while they load, null when the shop could not say). */
  templates?: TemplateSummary[] | null;
  /** Customer: ask for the list again (it could not be had). */
  onRetryTemplates?: () => void;
  /** Customer: also offer the four basic layouts (the owner can switch them off). */
  basicLayouts?: boolean;
  /** Customer: an ADMIN is looking — say which templates were left out here, and why. */
  showMisses?: boolean;
  /** Owner: a device draft counts only when newer than this (the saved template's time). */
  draftNotBefore?: number;
  /** Owner: the whole save. Resolves once stored; rejects with words to show him. */
  onSaveTemplate?: (design: TemplateDesign) => Promise<void>;
  /** The heading, when not "Design your print" (the owner's template name). */
  title?: string;
}

/**
 * Big corner handles a thumb can hit; pictures and frames keep their proportions.
 * And the owner's locks, for a customer, set again after every load.
 */
function dressControls(o: FabricObject, mode: Mode = 'customer') {
  const lock = mode === 'customer' ? (o as Tagged).rxLock : undefined;
  o.set({
    // Fixed by the shop: it cannot be picked up at all. Still `evented`, so a tap
    // lands on IT (and says so) rather than on whatever lies underneath.
    selectable: lock !== 'locked',
    evented: true,
    hoverCursor: lock === 'locked' ? 'not-allowed' : null,
    // Only the words: chosen to type in, never moved, scaled or turned.
    lockMovementX: !!lock,
    lockMovementY: !!lock,
    lockScalingX: !!lock,
    lockScalingY: !!lock,
    lockRotation: !!lock,
    hasControls: !lock,
    cornerSize: 13,
    touchCornerSize: 36,
    transparentCorners: false,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#ea580c',
    borderColor: '#ea580c',
    cornerStyle: 'circle',
    borderScaleFactor: 1.5,
    lockSkewingX: true,
    lockSkewingY: true,
    lockScalingFlip: true,
  });
  if (o instanceof Textbox) {
    // Typed in the panel, never inside the canvas.
    o.set({ editable: false });
    o.setControlsVisibility({ mt: false, mb: false });
  } else if (o instanceof FabricImage || (o as Tagged).rxSlot) {
    o.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
  }
}

/** An empty photo frame from a layout: shown on the board, never printed. */
function makeSlot(cx: number, cy: number, w: number, h: number, round: boolean, label: string, stroke: number, font: string): Group {
  const frameProps = {
    left: cx,
    top: cy,
    originX: 'center' as const,
    originY: 'center' as const,
    fill: '#f3f4f6',
    stroke: '#9ca3af',
    strokeWidth: stroke,
    strokeDashArray: [stroke * 4, stroke * 3],
  };
  const frame = round ? new Circle({ ...frameProps, radius: Math.min(w, h) / 2 }) : new Rect({ ...frameProps, width: w, height: h });
  const inner = round ? Math.min(w, h) * 0.66 : w * 0.82;
  const text = new Textbox(label, {
    left: cx,
    top: cy,
    originX: 'center',
    originY: 'center',
    width: inner,
    fontSize: Math.max(12, Math.min(w, h) * 0.12),
    fill: '#6b7280',
    textAlign: 'center',
    fontFamily: font,
    strokeWidth: 0,
  });
  fitText(text, inner, Math.min(w, h) * 0.8);
  const group = new Group([frame, text], { originX: 'center', originY: 'center', subTargetCheck: false, interactive: false });
  (group as Tagged).rxSlot = true;
  return group;
}

/**
 * A picture the OWNER puts in a template is downloaded by every customer who
 * picks it: as large as a customer's own (4096 px), but about 4 MB at most. It
 * was 2500 px, and a photo across an A4 template then printed under 150 DPI —
 * so the template was offered on no product at all.
 */
const OWNER_PICTURE_LIMITS = { maxSide: MAX_PICTURE_SIDE, maxBytes: 4 * 1024 * 1024 };

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/** A picture from the device, cut down to what the designer can use and kept as a Blob. */
async function preparePicture(
  file: File,
  limits: { maxSide: number; maxBytes: number } = { maxSide: MAX_PICTURE_SIDE, maxBytes: Infinity },
): Promise<{ blob: Blob; url: string }> {
  const bitmap = await createImageBitmap(file);
  try {
    const long = Math.max(bitmap.width, bitmap.height);
    if (long <= limits.maxSide && file.size <= limits.maxBytes) return { blob: file, url: URL.createObjectURL(file) };
    const k = Math.min(1, limits.maxSide / long);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * k);
    canvas.height = Math.round(bitmap.height * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no context');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // A PNG may be a logo with a transparent background: it stays a PNG. So does any
    // other picture that can be see-through and is: a WebP logo on a clear ground, made
    // a JPEG, was baked onto a BLACK square in the owner's template, for every customer
    // who picked it (code review, second pass #3; the studio's own preparePicture keeps
    // it, DSN-19). Looked at once, and never for a JPEG, which has no clear parts.
    let clear: boolean | null = null;
    const isClear = () => (clear ??= hasTransparency(ctx, canvas.width, canvas.height));
    const type = file.type === 'image/png' || (file.type !== 'image/jpeg' && isClear()) ? 'image/png' : 'image/jpeg';
    const encode = (as: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, as, 0.9));
    let blob = await encode(type);
    // …unless it is a PHOTO saved as a PNG, over the limit: as a JPEG it is a fraction of that.
    if (blob && blob.size > limits.maxBytes && type === 'image/png' && !isClear()) {
      blob = await encode('image/jpeg');
    }
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('encode');
    return { blob, url: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}

/**
 * Does this colour put ink on paper? White and near-white do not (the same
 * 245 the blank check in exportDesign.ts uses); a named colour or a gradient is
 * assumed to.
 */
function inkColour(colour: unknown): boolean {
  const s = String(colour ?? '').trim().toLowerCase();
  if (!s || s === 'transparent' || s === 'white' || s === 'none') return false;
  let rgb: number[] | null = null;
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) rgb = [m[1], m[2], m[3]].map((x) => parseInt(x + x, 16));
  else if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(s))) rgb = [m[1], m[2], m[3]].map((x) => parseInt(x, 16));
  else if ((m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s))) rgb = [m[1], m[2], m[3]].map(Number);
  if (!rgb) return true;
  return rgb.some((v) => v < 245);
}

/** A board object that would print something: a picture, words in a colour, a coloured shape. */
function objectLeavesInk(o: Record<string, unknown>): boolean {
  const type = String(o.type ?? '').toLowerCase();
  if (type === 'image') return true;
  if (type === 'textbox' || type === 'i-text' || type === 'text') return String(o.text ?? '').trim() !== '' && inkColour(o.fill);
  return inkColour(o.fill) || (Number(o.strokeWidth) > 0 && inkColour(o.stroke));
}

function readViewport() {
  const v = typeof window !== 'undefined' ? window.visualViewport : null;
  return v ? { top: v.offsetTop, height: v.height } : { top: 0, height: typeof window !== 'undefined' ? window.innerHeight : 800 };
}

function ToolButton({ icon: Icon, label, onClick, disabled, testId }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-rx-tool={testId}
      className="shrink-0 flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-gray-700 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-gray-700"
    >
      <Icon className="w-5 h-5" />
      <span className="text-[0.625rem] font-black whitespace-nowrap">{label}</span>
    </button>
  );
}

function Swatches({ value, onPick, label, customLabel }: {
  value: unknown;
  onPick: (colour: string) => void;
  label: string;
  customLabel: string;
}) {
  const current = String(value ?? '').toLowerCase();
  const hex = /^#[0-9a-f]{6}$/i.test(current) ? current : '#000000';
  return (
    <div className="space-y-1.5">
      <span className="block text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {PALETTE.map((colour) => (
          <button
            key={colour}
            type="button"
            onClick={() => onPick(colour)}
            aria-label={colour}
            aria-pressed={current === colour}
            data-rx-swatch={colour}
            className={cn(
              'w-7 h-7 rounded-full border transition-transform',
              current === colour ? 'ring-2 ring-orange-500 ring-offset-2 border-transparent' : 'border-gray-300 hover:scale-110',
            )}
            style={{ background: colour }}
          />
        ))}
        <label
          className="relative w-7 h-7 rounded-full border border-gray-300 overflow-hidden cursor-pointer"
          style={{ background: 'conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef, #ef4444)' }}
          title={customLabel}
        >
          <input
            type="color"
            value={hex}
            onChange={(e) => onPick(e.target.value)}
            aria-label={customLabel}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
}

/** The owner: what a customer may do with this element of the template. */
function LockControl({ value, isText, onChange }: {
  value: Lock | null;
  isText: boolean;
  onChange: (lock: Lock | null) => void;
}) {
  const choices: Array<[Lock | null, string, string]> = [
    [null, 'Can change', 'The customer may move, restyle or delete it.'],
    ...(isText ? ([['words', 'Only the words', 'The customer types new words; nothing else changes.']] as Array<[Lock, string, string]>) : []),
    ['locked', 'Locked', 'Fixed by you: the customer cannot touch it.'],
  ];
  return (
    <fieldset className="space-y-1.5 pt-1 border-t border-gray-100" data-rx-lock-control>
      <legend className="block text-[0.625rem] font-black uppercase tracking-wider text-gray-400">For the customer</legend>
      {choices.map(([lock, heading, help]) => (
        <label
          key={heading}
          className={cn('flex items-start gap-2 p-2 rounded-xl border cursor-pointer', value === lock ? 'border-orange-400 bg-orange-50' : 'border-gray-200')}
        >
          <input
            type="radio"
            name="rx-lock"
            checked={value === lock}
            onChange={() => onChange(lock)}
            className="mt-0.5 accent-orange-600"
            data-rx-lock={lock ?? 'free'}
          />
          <span>
            <span className="block text-xs font-black text-gray-800">{heading}</span>
            <span className="block text-[0.625rem] font-bold text-gray-500">{help}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** A layout, drawn small at the product's own proportions and shape, for the chooser. */
function TemplateThumb({ id, trimMm, outline, words }: {
  id: TemplateId;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  words: { headline: string; subline: string; caption: string };
}) {
  const clip = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { wMm: w, hMm: h } = trimMm;
  const elements = templateLayout(id, { wMm: w, hMm: h, outline }, words);
  const cut = outlinePath(outline ?? 'rect', w, h);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id={clip}>
          <path d={cut} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect x={0} y={0} width={w} height={h} fill="#ffffff" />
        {elements.map((el, i) =>
          el.type === 'text' ? (
            <rect
              key={i}
              x={el.box.xMm + el.box.wMm * 0.15}
              y={el.box.yMm + el.box.hMm / 2 - el.fontSizeMm * 0.35}
              width={el.box.wMm * 0.7}
              height={el.fontSizeMm * 0.7}
              rx={el.fontSizeMm * 0.2}
              fill={el.bold ? '#374151' : '#9ca3af'}
            />
          ) : el.round ? (
            <circle key={i} cx={el.box.xMm + el.box.wMm / 2} cy={el.box.yMm + el.box.hMm / 2} r={Math.min(el.box.wMm, el.box.hMm) / 2} fill="#e5e7eb" />
          ) : (
            <rect key={i} x={el.box.xMm} y={el.box.yMm} width={el.box.wMm} height={el.box.hMm} fill="#e5e7eb" />
          ),
        )}
      </g>
      <path d={cut} fill="none" stroke="#ea580c" strokeWidth={Math.max(w, h) / 60} strokeDasharray={`${Math.max(w, h) / 25} ${Math.max(w, h) / 40}`} />
    </svg>
  );
}

/** Why a template is not offered, for the admin's eyes only (the dashboard speaks English). */
const MISS_TEXT: Record<TemplateMiss, string> = {
  'no-size': 'no size chosen yet',
  cut: 'made for another cut shape',
  proportions: 'made for other proportions',
  'product-smaller': 'this size is too small for it (under 0.85×)',
  'product-larger': 'this size is too large for it (over 2×)',
  pictures: 'its pictures would print under 150 DPI here',
};

const LAYOUT_LABEL: Record<TemplateId, TranslationKey> = {
  blank: 'dsgLayoutBlank',
  headline: 'dsgLayoutHeadline',
  'photo-caption': 'dsgLayoutPhotoCaption',
  'centred-logo': 'dsgLayoutCentredLogo',
};

export default function OnlineDesigner({
  productId,
  trimMm,
  outline,
  sizeLabel,
  draft,
  onDraftChange,
  onUse,
  onClose,
  t,
  language,
  mode = 'customer',
  draftKey,
  templates,
  onRetryTemplates,
  basicLayouts = true,
  showMisses = false,
  draftNotBefore = 0,
  onSaveTemplate,
  title,
}: OnlineDesignerProps) {
  const titleId = useId();
  const owner = mode === 'owner';
  const storeKey = draftKey ?? productId;
  // A new build out while a template is being made: no reload under it (code review DSN-08).
  useEffect(() => holdReloads(), []);
  const b = DESIGN_BLEED_MM;
  const board = useMemo(() => ({ w: (trimMm.wMm + 2 * b) * U, h: (trimMm.hMm + 2 * b) * U }), [trimMm.wMm, trimMm.hMm, b]);
  const trim = useMemo(() => ({ x: b * U, y: b * U, w: trimMm.wMm * U, h: trimMm.hMm * U }), [trimMm.wMm, trimMm.hMm, b]);
  const exportSize = useMemo(() => designExportSize(trimMm), [trimMm]);
  const safe = useMemo(() => safeBox(outline, trimMm.wMm, trimMm.hMm), [outline, trimMm.wMm, trimMm.hMm]);
  const minSideMm = Math.min(trimMm.wMm, trimMm.hMm);
  const center = { x: trim.x + trim.w / 2, y: trim.y + trim.h / 2 };
  const words = useMemo(
    () => ({ headline: t('dsgSampleHeadline'), subline: t('dsgSampleSubline'), caption: t('dsgSampleCaption') }),
    [t],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const imagesRef = useRef(new Map<string, { blob: Blob; url: string }>());
  const hist = useRef({ past: [] as string[], future: [] as string[], current: '' });
  const dirty = useRef(false);
  const busy = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const commitTimer = useRef<number | undefined>(undefined);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoTargetRef = useRef<Tagged | null>(null);
  const draftRef = useRef(draft);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  // Pictures already on the device under their own keys: written once, never again.
  // "Attach" runs once: a double tap made two uploads and went back twice.
  const attachingRef = useRef(false);
  // The owner's template this design started from (customer mode). In a ref for
  // the autosave, in state for what the page shows (a locked background).
  const [templateMeta, setTemplateMetaState] = useState<TemplateMeta | null>(null);
  const templateMetaRef = useRef<TemplateMeta | null>(null);
  const setTemplateMeta = (meta: TemplateMeta | null) => {
    templateMetaRef.current = meta;
    setTemplateMetaState(meta);
  };
  // Something to say on the chooser itself (a template that would not load).
  const [chooserNotice, setChooserNotice] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;
  const [chooserFromEdit, setChooserFromEdit] = useState(false);
  const [fonts, setFonts] = useState<Set<string>>(() => new Set());
  // New text in the first family that loaded: fabric has no fallback of its
  // own, so a family that failed would draw in the browser's default while the
  // picker named another.
  const baseFont = DESIGNER_FONTS.find((f) => fonts.has(f.family))?.family ?? DEFAULT_DESIGNER_FONT;
  const [selected, setSelected] = useState<Tagged | null>(null);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [view, setView] = useState({ z: 1, w: 0, h: 0 });
  const [notice, setNotice] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [checked, setChecked] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // The device refused to keep the design (storage full, blocked): the close
  // warning must not then promise that it "stays saved on this device".
  const [deviceSaveFailed, setDeviceSaveFailed] = useState(false);
  const [vv, setVv] = useState(readViewport);
  const closeWarningRef = useRef<HTMLDivElement>(null);
  // A PHONE WITH ITS KEYBOARD UP. With the header, the tools and the footer all
  // on screen, a 6.1" iPhone kept about 200 px for the board and the panel, and
  // the text box being typed into was under the footer. While a text field is in
  // use on a short visible screen, the tools and the footer step aside.
  const [textFocused, setTextFocused] = useState(false);
  const compact = textFocused && vv.height < 600;
  useEffect(() => {
    if (confirmClose) closeWarningRef.current?.focus();
  }, [confirmClose]);

  // ---- keeping the design ------------------------------------------------
  const saveNow = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const json = hist.current.current;
    if (!canvasRef.current || !json) return;
    // The pictures THIS step names — read from the step being kept, not from the
    // canvas, which is half-loaded while an undo runs.
    const images: Record<string, Blob> = {};
    for (const id of referencedImageIds(json)) {
      const entry = imagesRef.current.get(id);
      if (entry) images[id] = entry.blob;
    }
    const savedAt = Date.now();
    // The template of THIS step, from the step itself: during an undo the step
    // has already changed while the one on screen has not caught up yet.
    let template: TemplateMeta | null = null;
    if (!owner) {
      try {
        template = (JSON.parse(json) as { rxTemplate?: TemplateMeta | null }).rxTemplate ?? null;
      } catch {
        template = templateMetaRef.current;
      }
    }
    const next: DesignDraft = { json, images, trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm }, savedAt, template };
    onDraftChangeRef.current(next);
    // Every picture goes to the store, which writes only those it does not hold
    // yet — in the same transaction that deletes the ones no longer named.
    void saveDraft({ key: storeKey, json, imageIds: Object.keys(images), trimMm: next.trimMm, savedAt, template }, images).then((ok) =>
      setDeviceSaveFailed(!ok),
    );
  }, [storeKey, trimMm.wMm, trimMm.hMm]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(saveNow, 600);
  }, [saveNow]);

  /**
   * One step of the history: the board, AND the owner's template it came from.
   * Undo restores both — it used to bring a template's board back with no
   * template (its background unlocked, its name gone from the job sheet), or
   * leave a template's name on the customer's own earlier design.
   */
  const snapshotOf = (c: Canvas) => JSON.stringify({ ...c.toObject(PROPS), rxTemplate: templateMetaRef.current ?? null });

  /** The board as it is now becomes one step of undo, and is kept. */
  const commit = useCallback(() => {
    window.clearTimeout(commitTimer.current);
    commitTimer.current = undefined;
    const c = canvasRef.current;
    // Never in the middle of an undo: the board is half-loaded then, and its
    // snapshot would become a history step of its own.
    if (!c || busy.current) return;
    const snapshot = snapshotOf(c);
    const h = hist.current;
    if (snapshot === h.current) return;
    if (h.current) {
      h.past.push(h.current);
      if (h.past.length > MAX_UNDO) h.past.shift();
    }
    h.current = snapshot;
    h.future = [];
    dirty.current = true;
    refresh();
    scheduleSave();
  }, [scheduleSave]);

  /** For a slider or typing: one undo step when the hand stops, not one per pixel. */
  const commitSoon = useCallback(() => {
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(commit, 400);
  }, [commit]);

  const baseline = () => {
    const c = canvasRef.current;
    hist.current = { past: [], future: [], current: c ? snapshotOf(c) : '' };
    dirty.current = false;
    refresh();
  };

  const commitRef = useRef(commit);
  commitRef.current = commit;

  // ---- the board on screen -----------------------------------------------
  const fit = useCallback(() => {
    const area = areaRef.current;
    const c = canvasRef.current;
    if (!area || !c) return;
    const availW = Math.max(60, area.clientWidth - 24);
    const availH = Math.max(60, area.clientHeight - 24);
    const z = Math.min(availW / board.w, availH / board.h);
    const w = Math.max(1, Math.floor(board.w * z));
    const h = Math.max(1, Math.floor(board.h * z));
    c.setDimensions({ width: w, height: h });
    c.setViewportTransform([z, 0, 0, z, 0, 0]);
    c.requestRenderAll();
    setView({ z, w, h });
  }, [board.w, board.h]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  /** A picture stretched over the whole board, bleed included, centred. */
  const coverBoard = (img: FabricObject) => {
    const s = Math.max(board.w / img.width, board.h / img.height);
    img.set({ left: board.w / 2, top: board.h / 2, scaleX: s, scaleY: s, angle: 0 });
    img.setCoords();
  };

  /**
   * A saved design onto the board, refitted if the size has changed since.
   * Resolves with how many of its objects did NOT come back: fabric drops a
   * picture whose blob no longer decodes without a word, and the next autosave
   * would make that loss permanent unless the customer is told. `lockedLost`:
   * one of them was the SHOP's (locked) — he cannot put that back himself.
   */
  const restoreInto = async (
    c: Canvas,
    images: Map<string, { blob: Blob; url: string }>,
    d: DesignDraft,
    lost?: { locked: boolean },
  ): Promise<number> => {
    for (const [id, blob] of Object.entries(d.images ?? {})) {
      if (blob instanceof Blob && !images.has(id)) images.set(id, { blob, url: URL.createObjectURL(blob) });
    }
    const data = JSON.parse(d.json) as { objects?: Array<Record<string, any>> };
    const all = Array.isArray(data.objects) ? data.objects : [];
    const objects = all.filter((o) => {
      if (!o.rxImageId) return true;
      const entry = images.get(String(o.rxImageId));
      if (!entry) return false;
      o.src = entry.url;
      return true;
    });
    const oldW = (Number(d.trimMm?.wMm) + 2 * b) * U;
    const oldH = (Number(d.trimMm?.hMm) + 2 * b) * U;
    if (oldW > 0 && oldH > 0 && (Math.abs(oldW - board.w) > 0.01 || Math.abs(oldH - board.h) > 0.01)) {
      // Around the TRIM, not the board's corner: from the corner, an element on
      // the old trim edge landed in the new bleed and was cut off.
      const sx = (board.w - 2 * b * U) / (oldW - 2 * b * U);
      const sy = (board.h - 2 * b * U) / (oldH - 2 * b * U);
      const s = Math.min(sx, sy);
      for (const o of objects) {
        o.left = ((Number(o.left) || 0) - b * U) * sx + b * U;
        o.top = ((Number(o.top) || 0) - b * U) * sy + b * U;
        // A rectangle follows each axis: a band across the board still reaches
        // both edges after a small change of proportions (a uniform scale left a
        // white sliver). Text and pictures keep their shape.
        const perAxis = String(o.type ?? '').toLowerCase() === 'rect';
        o.scaleX = (Number(o.scaleX) || 1) * (perAxis ? sx : s);
        o.scaleY = (Number(o.scaleY) || 1) * (perAxis ? sy : s);
      }
    }
    await c.loadFromJSON({ version: (data as { version?: string }).version, background: (data as { background?: unknown }).background, objects });
    for (const o of c.getObjects()) {
      // A background photo still covers the whole board, bleed and all, after
      // a change of proportions.
      if ((o as Tagged).rxFill && o instanceof FabricImage) coverBoard(o);
      dressControls(o, mode);
      o.setCoords();
    }
    c.requestRenderAll();
    if (lost) {
      const lockedIn = all.filter((o) => o?.rxLock).length;
      lost.locked = c.getObjects().filter((o) => (o as Tagged).rxLock).length < lockedIn;
    }
    return all.length - c.getObjects().length;
  };

  const bootRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let alive = true;
    const images = new Map<string, { blob: Blob; url: string }>();
    imagesRef.current = images;
    const el = document.createElement('canvas');
    host.appendChild(el);
    const c = new Canvas(el, {
      width: 10,
      height: 10,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: false,
      controlsAboveOverlay: true,
      targetFindTolerance: 8,
    });
    canvasRef.current = c;
    const pick = (o?: FabricObject) => setSelected((o as Tagged) ?? null);
    c.on('selection:created', (e) => pick(e.selected?.[0]));
    c.on('selection:updated', (e) => pick(e.selected?.[0]));
    c.on('selection:cleared', () => pick(undefined));
    c.on('object:modified', (e) => {
      // Moved or shrunk by hand, a background photo is just a photo again.
      const o = e.target as Tagged | undefined;
      if (o?.rxFill) {
        const r = o.getBoundingRect();
        if (r.left > 0.5 || r.top > 0.5 || r.left + r.width < board.w - 0.5 || r.top + r.height < board.h - 0.5) o.rxFill = false;
      }
      commitRef.current();
    });
    c.on('object:scaling', () => refresh());
    // A tap on something the shop fixed: say so, rather than seem broken — and
    // stop saying it at the next tap anywhere else (it stood over the very text
    // he had then picked to change).
    c.on('mouse:down', (e) => {
      if (mode !== 'customer') return;
      const fixedText = t('dsgFixedByShop');
      if ((e.target as Tagged | undefined)?.rxLock === 'locked') setNotice(fixedText);
      else setNotice((cur) => (cur === fixedText ? null : cur));
    });
    fitRef.current();

    const boot = async () => {
      const loaded = await loadDesignerFonts();
      if (!alive) return;
      if (loaded.size === 0) {
        setPhase('failed');
        return;
      }
      // Anything measured before the fonts arrived was measured in a fallback.
      cache.clearFontCache();
      setFonts(loaded);
      let saved = draftRef.current;
      let fromDevice = false;
      // The customer: the page's copy first, then the device's. The owner: the
      // device's copy only when it is NEWER than the template he saved (work he
      // had not saved yet), else the template itself.
      if (!saved || owner) {
        const stored = await loadDraft(storeKey);
        if (!alive) return;
        if (stored && (!saved || stored.savedAt > draftNotBefore)) {
          // The owner's own unsaved work — with the saved template's pictures to
          // hand, should the device have lost one of them.
          // A round-16 draft: its template is the TemplateMeta this designer wrote.
          const own = stored as DesignDraft;
          saved = owner && saved ? { ...own, images: { ...saved.images, ...own.images } } : own;
          fromDevice = true;
        }
      }
      // A design started from a template, at a size that template does not fit
      // (the customer changed the size since): refitting would stretch the
      // shop's locked layout, which a template never is. Choose again instead.
      if (saved?.template && !owner && templateMiss(saved.template, trimMm, outline) !== null) {
        saved = null;
        setChooserNotice(t('dsgTemplateOtherSize'));
      }
      // …and one whose pictures the device no longer holds all of: the SHOP's are
      // fetched again. One that cannot come back would leave the shop's locked
      // logo out of his print, with nothing he could do about it — so choose again.
      if (saved?.template && !owner) {
        const have = saved.images ?? {};
        const missing = referencedImageIds(saved.json).filter((id) => !(have[id] instanceof Blob));
        if (missing.length > 0) {
          const full = await fetchTemplateFull(saved.template.id);
          const want = full ? Object.fromEntries(missing.filter((id) => full.images[id]).map((id) => [id, full.images[id]])) : {};
          const pictures = Object.keys(want).length > 0 ? await fetchPictures(want) : {};
          if (!alive) return;
          if (!full || !pictures || missing.some((id) => full.images[id] && !pictures[id])) {
            saved = null;
            setChooserNotice(t('dsgTemplateRestoreFailed'));
          } else {
            saved = { ...saved, images: { ...have, ...pictures } };
          }
        }
      }
      if (saved) {
        const dropped = { locked: false };
        let lost = await restoreInto(c, images, saved, dropped).catch(() => -1);
        if (!alive) return;
        // A piece the shop locked did not come back (a picture the device could
        // no longer read, one the owner has replaced since): his print would go
        // out without it. Not kept — chosen again.
        if (lost > 0 && dropped.locked && !owner && saved.template) {
          c.remove(...c.getObjects());
          lost = -1;
          setChooserNotice(t('dsgTemplateRestoreFailed'));
        }
        if (lost >= 0) {
          // The template first: the first step of the history carries it.
          setTemplateMeta(owner ? null : saved.template ?? null);
          baseline();
          if (fromDevice) setRestoredAt(saved.savedAt);
          if (lost > 0) setNotice(t('dsgPicturesLost'));
          setPhase('edit');
          return;
        }
      }
      c.backgroundColor = '#ffffff';
      c.requestRenderAll();
      baseline();
      setChooserFromEdit(false);
      setPhase('start');
    };
    bootRef.current = () => {
      setPhase('loading');
      void boot();
    };
    void boot();

    return () => {
      alive = false;
      if (saveTimer.current !== undefined || commitTimer.current !== undefined) {
        window.clearTimeout(commitTimer.current);
        commitRef.current();
        saveNowRef.current();
      }
      canvasRef.current = null;
      void c.dispose();
      el.remove();
      for (const entry of images.values()) URL.revokeObjectURL(entry.url);
    };
    // Mounted once: the page closes and reopens the dialog for a new size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const ro = new ResizeObserver(() => fitRef.current());
    ro.observe(area);
    return () => ro.disconnect();
  }, []);

  // The dialog follows the VISIBLE viewport: with the keyboard up, it shrinks
  // above it instead of being covered by it.
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const on = () => setVv(readViewport());
    v.addEventListener('resize', on);
    v.addEventListener('scroll', on);
    return () => {
      v.removeEventListener('resize', on);
      v.removeEventListener('scroll', on);
    };
  }, []);

  // ---- actions -------------------------------------------------------------
  const render = () => canvasRef.current?.requestRenderAll();

  const place = (o: FabricObject) => {
    const c = canvasRef.current;
    if (!c) return;
    dressControls(o, mode);
    c.add(o);
    o.setCoords();
    c.setActiveObject(o);
    c.requestRenderAll();
    setSelected(o as Tagged);
    commit();
  };

  const addText = () => {
    const fontMm = Math.min(Math.max(minSideMm * 0.1, 2), 120);
    const width = Math.max(10, safe.wMm * 0.9) * U;
    const tb = new Textbox(t('dsgNewText'), {
      left: center.x,
      top: center.y,
      originX: 'center',
      originY: 'center',
      width,
      fontSize: fontMm * U,
      fontFamily: baseFont,
      fill: INK,
      textAlign: 'center',
      strokeWidth: 0,
    });
    fitText(tb, width);
    place(tb);
  };

  const addShape = (kind: 'rect' | 'circle') => {
    const side = minSideMm * 0.3 * U;
    const common = { left: center.x, top: center.y, originX: 'center' as const, originY: 'center' as const, fill: '#ea580c', strokeWidth: 0 };
    place(kind === 'rect' ? new Rect({ ...common, width: side, height: side }) : new Circle({ ...common, radius: side / 2 }));
  };

  const openPhotoPicker = (target: Tagged | null) => {
    photoTargetRef.current = target;
    photoInputRef.current?.click();
  };

  const onPhotoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const target = photoTargetRef.current;
    photoTargetRef.current = null;
    if (!file) return;
    setNotice(null);
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      setNotice(t('dsgPictureType'));
      return;
    }
    if (file.size > MAX_PICTURE_BYTES) {
      setNotice(t('dsgPictureTooBig'));
      return;
    }
    let picture: { blob: Blob; url: string };
    try {
      picture = await preparePicture(file, owner ? OWNER_PICTURE_LIMITS : undefined);
    } catch {
      // HEIC on Android, a broken file: the browser cannot open it.
      setNotice(t('dsgPictureUnreadable'));
      return;
    }
    const c = canvasRef.current;
    if (!c) {
      URL.revokeObjectURL(picture.url);
      return;
    }
    let img: FabricImage;
    try {
      img = await FabricImage.fromURL(picture.url);
    } catch {
      URL.revokeObjectURL(picture.url);
      setNotice(t('dsgPictureUnreadable'));
      return;
    }
    const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    imagesRef.current.set(id, picture);
    const inFrame = !!target && c.getObjects().includes(target);
    const box = inFrame
      ? { x: target!.left, y: target!.top, w: target!.getScaledWidth(), h: target!.getScaledHeight() }
      : { x: center.x, y: center.y, w: trim.w * 0.6, h: trim.h * 0.6 };
    const s = Math.min(box.w / img.width, box.h / img.height);
    img.set({ left: box.x, top: box.y, originX: 'center', originY: 'center', scaleX: s, scaleY: s, strokeWidth: 0 });
    (img as Tagged).rxImageId = id;
    if (inFrame) {
      const index = c.getObjects().indexOf(target!);
      c.remove(target!);
      dressControls(img, mode);
      c.insertAt(index, img);
      img.setCoords();
      c.setActiveObject(img);
      c.requestRenderAll();
      setSelected(img as Tagged);
      commit();
    } else {
      place(img);
    }
  };

  const applyTemplate = (id: TemplateId) => {
    const c = canvasRef.current;
    if (!c) return;
    const background = c.backgroundColor || '#ffffff';
    c.discardActiveObject();
    c.remove(...c.getObjects());
    c.backgroundColor = background;
    const stroke = Math.max(0.3, minSideMm * 0.005) * U;
    for (const el of templateLayout(id, { wMm: trimMm.wMm, hMm: trimMm.hMm, outline }, words)) {
      const cx = (b + el.box.xMm + el.box.wMm / 2) * U;
      const cy = (b + el.box.yMm + el.box.hMm / 2) * U;
      let o: FabricObject;
      if (el.type === 'text') {
        const tb = new Textbox(el.text, {
          left: cx,
          top: cy,
          originX: 'center',
          originY: 'center',
          width: el.box.wMm * U,
          fontSize: el.fontSizeMm * U,
          fontWeight: el.bold ? 'bold' : 'normal',
          fontFamily: baseFont,
          fill: INK,
          textAlign: 'center',
          strokeWidth: 0,
        });
        fitText(tb, el.box.wMm * U, el.box.hMm * U);
        o = tb;
      } else {
        o = makeSlot(cx, cy, el.box.wMm * U, el.box.hMm * U, el.round, t('dsgPhotoHere'), stroke, baseFont);
      }
      dressControls(o, mode);
      c.add(o);
      o.setCoords();
    }
    c.requestRenderAll();
    setSelected(null);
    setRestoredAt(null);
    // A basic layout: the design no longer comes from one of the owner's templates.
    setTemplateMeta(null);
    setChooserNotice(null);
    setPhase('edit');
    commit();
  };

  const active = () => canvasRef.current?.getActiveObject() as Tagged | undefined;
  /** For a customer, something the shop has fixed (or fixed but for its words) stays as it is. */
  const fixed = (o: Tagged | null | undefined) => !owner && !!o?.rxLock;

  const removeSelected = () => {
    const c = canvasRef.current;
    const o = active();
    if (!c || !o || fixed(o)) return;
    c.remove(o);
    c.discardActiveObject();
    c.requestRenderAll();
    setSelected(null);
    commit();
  };
  const removeSelectedRef = useRef(removeSelected);
  removeSelectedRef.current = removeSelected;

  const duplicate = async () => {
    const o = active();
    if (!o || fixed(o)) return;
    const copy = await o.clone(PROPS);
    copy.set({ left: o.left + 3 * U, top: o.top + 3 * U });
    place(copy);
  };

  const layer = (dir: 'up' | 'down') => {
    const c = canvasRef.current;
    const o = active();
    if (!c || !o || fixed(o)) return;
    if (dir === 'up') c.bringObjectForward(o);
    else c.sendObjectBackwards(o);
    c.requestRenderAll();
    commit();
  };

  const loadSnapshot = async (json: string, { quiet = false }: { quiet?: boolean } = {}) => {
    const c = canvasRef.current;
    if (!c) return;
    c.discardActiveObject();
    let step: { version?: string; background?: unknown; objects?: unknown[]; rxTemplate?: TemplateMeta | null };
    try {
      step = JSON.parse(json);
      // Only the board's own keys: fabric sets every other one on the canvas.
      await c.loadFromJSON({ version: step.version, background: step.background, objects: step.objects ?? [] });
    } catch {
      // Closed while loading: the canvas is gone, and so is the reason to finish.
      return;
    }
    if (canvasRef.current !== c) return;
    if (!owner) setTemplateMeta(step.rxTemplate ?? null);
    for (const o of c.getObjects()) {
      dressControls(o, mode);
      o.setCoords();
    }
    c.requestRenderAll();
    setSelected(null);
    refresh();
    // Putting the board back as it was (a template that failed to load) is not
    // a change: it must not be kept as a new design, nor warned about on close.
    if (quiet) return;
    dirty.current = true;
    scheduleSave();
  };

  /**
   * Typing, a swatch or a slider reaches the history 400 ms after the hand
   * stops. Undo pressed inside that window went back TWO steps and lost what
   * was just typed, so the pending change is made a step first.
   */
  const flushPending = () => {
    if (commitTimer.current !== undefined) commit();
  };

  const undo = async () => {
    flushPending();
    const h = hist.current;
    if (busy.current || h.past.length === 0) return;
    busy.current = true;
    try {
      h.future.push(h.current);
      h.current = h.past.pop() as string;
      await loadSnapshot(h.current);
    } finally {
      busy.current = false;
    }
  };
  const redo = async () => {
    flushPending();
    const h = hist.current;
    if (busy.current || h.future.length === 0) return;
    busy.current = true;
    try {
      h.past.push(h.current);
      h.current = h.future.pop() as string;
      await loadSnapshot(h.current);
    } finally {
      busy.current = false;
    }
  };
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;

  const setBackground = (colour: string) => {
    const c = canvasRef.current;
    if (!c || (!owner && templateMetaRef.current?.lockBackground)) return;
    c.backgroundColor = colour;
    c.requestRenderAll();
    refresh();
    commitSoon();
  };

  /** A picture stretched over the whole board, bleed included, behind everything. */
  const fillBackground = (img: FabricImage) => {
    const c = canvasRef.current;
    if (!c || (!owner && templateMetaRef.current?.lockBackground)) return;
    coverBoard(img);
    (img as Tagged).rxFill = true;
    // Behind everything the customer may change, but not behind the shop's own
    // fixed bottom layers (a locked background would hide it completely).
    const objects = c.getObjects();
    let floor = 0;
    if (!owner) while (floor < objects.length && objects[floor] !== img && (objects[floor] as Tagged).rxLock) floor += 1;
    if (floor === 0) c.sendObjectToBack(img);
    else c.moveObjectTo(img, floor);
    img.setCoords();
    c.requestRenderAll();
    refresh();
    commit();
  };

  /** A frame's "Your photo here", in the CUSTOMER's language (the owner made it in his). */
  const relabelSlots = (c: Canvas) => {
    for (const o of c.getObjects()) {
      if (!(o as Tagged).rxSlot || !(o instanceof Group)) continue;
      for (const child of o.getObjects()) {
        if (child instanceof Textbox) {
          child.set('text', t('dsgPhotoHere'));
          child.initDimensions();
        }
      }
      o.set('dirty', true);
    }
    c.requestRenderAll();
  };

  /**
   * One of the owner's templates onto the board — every picture, or nothing
   * (templatesApi.ts): without one, the shop's locked logo would silently be
   * missing from the customer's print file.
   */
  const pickTemplate = async (summary: TemplateSummary) => {
    const c = canvasRef.current;
    if (!c || busy.current) return;
    busy.current = true;
    setChooserNotice(null);
    setNotice(null);
    setPhase('loading');
    let ok = false;
    let touched = false;
    try {
      const full = await fetchTemplateFull(summary.id);
      // The list can be hours old: the owner may have changed its size or cut since.
      if (!full || templateMiss(full, trimMm, outline) !== null) throw new Error('template');
      const pictures = await fetchPictures(full.images);
      if (!pictures || canvasRef.current !== c) throw new Error('template');
      c.discardActiveObject();
      touched = true;
      const lost = await restoreInto(c, imagesRef.current, { json: full.json, images: pictures, trimMm: full.trimMm, savedAt: 0 });
      if (lost !== 0) throw new Error('template');
      relabelSlots(c);
      // A words-only text from a template saved without its box: the box it has now.
      for (const o of c.getObjects()) {
        if (o instanceof Textbox && (o as Tagged).rxLock === 'words' && !(o as Tagged).rxBox) {
          (o as Tagged).rxBox = { w: o.width, h: o.height, fontSize: o.fontSize };
        }
      }
      setTemplateMeta({
        id: full.id,
        // The owner's own name for it: what the job sheet says, in every language.
        name: full.name,
        trimMm: full.trimMm,
        outline: full.outline,
        lowestPictureDpi: full.lowestPictureDpi,
        lockBackground: full.lockBackground,
      });
      setSelected(null);
      setRestoredAt(null);
      setPhase('edit');
      ok = true;
    } catch {
      // Whatever was on the board comes back, with its own template or none: a
      // half-loaded template was left under the old design's name.
      if (touched && canvasRef.current === c && hist.current.current) await loadSnapshot(hist.current.current, { quiet: true });
      setChooserNotice(t('dsgTemplateFailed'));
      setPhase('start');
    } finally {
      busy.current = false;
    }
    if (ok) commit();
  };

  /** The owner: what a customer may do with this element. */
  const setLockOf = (o: Tagged, lock: Lock | null) => {
    if (lock) o.rxLock = lock;
    else delete o.rxLock;
    if (lock === 'words' && o instanceof Textbox) (o as Tagged).rxBox = { w: o.width, h: o.height, fontSize: o.fontSize };
    else delete o.rxBox;
    dressControls(o, mode);
    refresh();
    commit();
  };

  /**
   * The owner, on unsaved work the device kept: back to the template as it was
   * last saved, and the device's copy gone (it would be offered again otherwise).
   */
  const backToSaved = async () => {
    const c = canvasRef.current;
    const saved = draftRef.current;
    if (!c || !saved || busy.current) return;
    busy.current = true;
    try {
      c.discardActiveObject();
      const lost = await restoreInto(c, imagesRef.current, saved);
      if (canvasRef.current !== c) return;
      // Nothing of the unsaved work may be written back after this.
      window.clearTimeout(commitTimer.current);
      commitTimer.current = undefined;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      void deleteDraft(storeKey);
      baseline();
      setSelected(null);
      setRestoredAt(null);
      setNotice(lost > 0 ? t('dsgPicturesLost') : null);
    } catch {
      setNotice(t('dsgTemplateFailed'));
    } finally {
      busy.current = false;
    }
  };

  /**
   * The owner's "Save template": the design, its pictures, a small picture of it
   * and how sharp its pictures are, handed to the dashboard, which stores it all
   * before it writes anything (src/components/Admin/DesignTemplatesAdmin.tsx).
   */
  const saveTemplate = async () => {
    const c = canvasRef.current;
    if (!c || !onSaveTemplate || busy.current) return;
    window.clearTimeout(commitTimer.current);
    // Each words-only text's box as it is NOW: he may have retyped or resized it
    // since he chose "Only the words". The customer's words are fitted into it.
    for (const o of c.getObjects()) {
      if (o instanceof Textbox && (o as Tagged).rxLock === 'words') (o as Tagged).rxBox = { w: o.width, h: o.height, fontSize: o.fontSize };
      else delete (o as Tagged).rxBox;
    }
    commit();
    const data = c.toObject(PROPS) as { objects: Array<Record<string, unknown>> };
    if (!inkColour(c.backgroundColor) && !data.objects.some(objectLeavesInk)) {
      setNotice(t('dsgEmpty'));
      return;
    }
    if (JSON.stringify(data).length > TEMPLATE_JSON_MAX) {
      setNotice('This design is too large to keep as a template. Take some elements out, or shorten long texts, and save again.');
      return;
    }
    c.discardActiveObject();
    c.requestRenderAll();
    setSelected(null);
    setNotice(null);
    setPhase('exporting');
    await new Promise((resolve) => requestAnimationFrame(() => window.setTimeout(resolve, 30)));
    try {
      await loadDesignerFonts();
      await document.fonts.ready;
      const images: Record<string, Blob> = {};
      for (const o of c.getObjects()) {
        const id = (o as Tagged).rxImageId;
        const entry = id ? imagesRef.current.get(id) : undefined;
        if (id && entry) images[id] = entry.blob;
      }
      const photos = c.getObjects().filter((o) => o instanceof FabricImage) as FabricImage[];
      const dpis = photos.map((p) => effectiveDpi(p.width, p.getScaledWidth() / U));
      const thumbnail = await renderThumbnail({ json: data, unitsPerMm: U, trimMm, bleedMm: b, maxPx: 480 });
      await onSaveTemplate({
        json: JSON.stringify(data),
        images,
        thumbnail,
        lowestPictureDpi: dpis.length ? Math.min(...dpis) : null,
      });
      // Saved: nothing is left unsaved, and the device copy is not offered again.
      dirty.current = false;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
      void deleteDraft(storeKey);
    } catch (err) {
      setNotice(err instanceof Error && err.message ? err.message : t('dsgExportFailed'));
      setPhase('edit');
    }
  };

  /** Is any text past the safe margin, so the cutter could take part of it off? */
  const textNearEdge = (c: Canvas): boolean => {
    const tol = 0.5 * U;
    const cx = trim.x + trim.w / 2;
    const cy = trim.y + trim.h / 2;
    const box = { x: (b + safe.xMm) * U, y: (b + safe.yMm) * U, w: safe.wMm * U, h: safe.hMm * U };
    const round = outline === 'circle' || outline === 'ellipse';
    const rx = ((outline === 'circle' ? minSideMm : trimMm.wMm) / 2 - SAFE_MARGIN_MM) * U + tol;
    const ry = ((outline === 'circle' ? minSideMm : trimMm.hMm) / 2 - SAFE_MARGIN_MM) * U + tol;
    return c.getObjects().some((o) =>
      o instanceof Textbox &&
      o.getCoords().some((p) =>
        round
          ? ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 > 1
          : p.x < box.x - tol || p.y < box.y - tol || p.x > box.x + box.w + tol || p.y > box.y + box.h + tol,
      ),
    );
  };

  const makePrintFile = async () => {
    const c = canvasRef.current;
    if (!c || exportSize.kind !== 'ok' || busy.current) return;
    window.clearTimeout(commitTimer.current);
    commit();
    const data = c.toObject(PROPS) as { objects: Array<Record<string, unknown>> };
    const emptySlots = data.objects.filter((o) => o.rxSlot).length;
    data.objects = data.objects.filter((o) => !o.rxSlot);
    // Something that leaves ink: a photo, words in a colour that is not white,
    // a coloured shape or background. Without any, there is nothing to print,
    // and a plain white file must not go to production as "the artwork".
    const inked = inkColour(c.backgroundColor) || data.objects.some(objectLeavesInk);
    if (!inked) {
      setNotice(t('dsgEmpty'));
      return;
    }
    c.discardActiveObject();
    c.requestRenderAll();
    setSelected(null);
    setNotice(null);
    setPhase('exporting');
    // Let "Preparing your print file…" paint before the export holds the thread.
    await new Promise((resolve) => requestAnimationFrame(() => window.setTimeout(resolve, 30)));
    try {
      await loadDesignerFonts();
      await document.fonts.ready;
      const photos = c.getObjects().filter((o) => o instanceof FabricImage) as FabricImage[];
      const dpis = photos.map((p) => effectiveDpi(p.width, p.getScaledWidth() / U));
      const result = await exportDesign({
        json: data,
        unitsPerMm: U,
        trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm },
        size: exportSize,
        hasPhotos: photos.length > 0,
        // Only with ink on the board can a white file mean a failed export.
        inkExpected: true,
      });
      setProof({
        ...result,
        lowestDpi: dpis.length ? Math.min(...dpis) : null,
        textNearEdge: textNearEdge(c),
        emptySlots,
      });
      setChecked(false);
      setPhase('proof');
    } catch (err) {
      console.warn('The print file could not be made:', err);
      setNotice(t('dsgExportFailed'));
      setPhase('edit');
    }
  };

  const attach = () => {
    if (!proof || !checked || exportSize.kind !== 'ok' || attachingRef.current) return;
    attachingRef.current = true;
    dirty.current = false;
    saveNow();
    onUse({
      file: proof.file,
      preview: proof.preview,
      trimMm: { wMm: trimMm.wMm, hMm: trimMm.hMm },
      outline,
      bleedMm: exportSize.bleedMm,
      dpi: exportSize.dpi,
      lowestImageDpi: proof.lowestDpi,
      template: templateMetaRef.current ? { id: templateMetaRef.current.id, name: templateMetaRef.current.name } : null,
    });
  };

  const requestClose = () => {
    if (phase === 'exporting' || attachingRef.current) return;
    if (dirty.current && (phase === 'edit' || phase === 'proof' || phase === 'start')) {
      setConfirmClose(true);
      return;
    }
    if (saveTimer.current !== undefined) saveNow();
    onClose();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  // Escape closes (and must not reach the product dialog behind, which would
  // close too); Delete and Ctrl/Cmd+Z work on a keyboard. Never while typing.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        requestCloseRef.current();
        return;
      }
      // TAB STAYS IN THE DESIGNER. It walked out into the product page behind
      // (and, in the product dialog, into that dialog's own trap, which never
      // let it back). Kept here, and kept from the dialog's handler.
      if (e.key === 'Tab') {
        const root = rootRef.current;
        if (!root) return;
        e.stopPropagation();
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (!active || !root.contains(active) || active === root) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      const target = e.target as HTMLElement | null;
      const typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      // The board's shortcuts only while it is the thing on screen: Ctrl+Z on
      // the check screen changed the design after its file was made.
      if (typing || phaseRef.current !== 'edit') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && canvasRef.current?.getActiveObject()) {
        e.preventDefault();
        removeSelectedRef.current();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? redoRef.current() : undoRef.current());
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      // Back where the designer was opened from; after "Attach" that button has
      // turned into the upload's progress, so the artwork step itself.
      const back = opener && opener.isConnected ? opener : document.querySelector<HTMLElement>('[data-rx-designer-step]');
      back?.focus?.();
    };
  }, []);

  // ---- what is selected ------------------------------------------------------
  const tb = selected instanceof Textbox ? selected : null;
  const img = selected instanceof FabricImage ? selected : null;
  const slot = selected?.rxSlot ? selected : null;
  const shape = selected && !tb && !img && !slot ? selected : null;
  const c = canvasRef.current;

  const ptOf = (o: Textbox) => Math.round(((o.fontSize * (o.scaleY || 1)) / U) * PT_PER_MM);
  const maxPt = Math.max(24, Math.round(minSideMm * 0.8 * PT_PER_MM));
  const pctOf = (o: FabricObject) => Math.round((o.getScaledWidth() / trim.w) * 100);
  const setPct = (o: FabricObject, pct: number) => {
    const k = ((pct / 100) * trim.w) / o.getScaledWidth();
    if (!Number.isFinite(k) || k <= 0) return;
    o.set({ scaleX: o.scaleX * k, scaleY: o.scaleY * k });
    o.setCoords();
    render();
    refresh();
    commitSoon();
  };
  const setFill = (o: FabricObject, colour: string) => {
    o.set('fill', colour);
    render();
    refresh();
    commitSoon();
  };
  const restyleText = (o: Textbox, props: Partial<Textbox>) => {
    o.set(props);
    o.initDimensions();
    o.setCoords();
    render();
    refresh();
  };
  const photoDpi = img ? effectiveDpi(img.width, img.getScaledWidth() / U) : 0;
  const photoLevel = img ? imageQuality(photoDpi) : 'good';
  const h = hist.current;
  const label = 'block text-[0.625rem] font-black uppercase tracking-wider text-gray-400';
  // A customer, on a text the shop fixed but for its words: the words, nothing else.
  const wordsOnly = !owner && (tb as Tagged | null)?.rxLock === 'words';
  const bgLocked = !owner && !!templateMeta?.lockBackground;
  // The owner's templates that fit this size and cut — and, for an ADMIN looking
  // at the page, the ones that do not, with the reason (he would otherwise make a
  // template and never find out why it does not show).
  const offered = owner ? [] : (templates ?? []).filter((x) => templateMiss(x, trimMm, outline) === null);
  const missed = owner || !showMisses ? [] : (templates ?? []).flatMap((x) => {
    const why = templateMiss(x, trimMm, outline);
    return why ? [{ x, why }] : [];
  });
  // The list could not be had: the basic layouts stand in for it (whatever the
  // owner's setting) beside a way to ask again — not a blank board.
  const templatesFailed = !owner && templates === null;
  const showBasics = owner || basicLayouts || templatesFailed;

  // A customer with nothing to choose from (the owner switched the basic layouts
  // off and none of his templates fits this size): straight to a blank board —
  // still told why, when his own design from another size was put aside.
  useEffect(() => {
    if (owner || phase !== 'start' || chooserFromEdit || basicLayouts || !Array.isArray(templates)) return;
    if (offered.length === 0) {
      const why = chooserNotice;
      applyTemplate('blank');
      if (why) setNotice(why);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, templates, basicLayouts, chooserFromEdit]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-rx-designer
      className="fixed left-0 right-0 z-[200] flex flex-col bg-[#eceef4] outline-none overflow-hidden"
      style={{ top: vv.top, height: vv.height }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 sm:px-5 py-2.5 bg-white border-b border-gray-200">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-black text-gray-900 truncate">{title ?? t('dsgTitle')}</h2>
          {sizeLabel && <p className="text-[0.6875rem] font-bold text-gray-500 truncate">{sizeLabel}</p>}
        </div>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t('dsgClose')}
          className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {confirmClose && (
        <div
          ref={closeWarningRef}
          tabIndex={-1}
          className="flex flex-wrap items-center gap-2 px-3 sm:px-5 py-2.5 bg-amber-50 border-b border-amber-200 outline-none"
          role="alert"
          data-rx-close-warning
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-xs font-bold text-amber-900 flex-1 min-w-[12rem]">
            {owner ? 'This template has changes that are not saved yet.' : t(deviceSaveFailed ? 'dsgCloseWarnUnsaved' : 'dsgCloseWarn')}
          </span>
          <button
            type="button"
            onClick={() => setConfirmClose(false)}
            className="px-3 py-1.5 rounded-full text-xs font-black text-white bg-gradient-to-br from-orange-500 to-orange-700"
          >
            {t('dsgKeepDesigning')}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmClose(false);
              if (saveTimer.current !== undefined) saveNow();
              onClose();
            }}
            className="px-3 py-1.5 rounded-full text-xs font-black text-gray-700 bg-white border border-gray-300"
          >
            {t('dsgCloseAnyway')}
          </button>
        </div>
      )}

      {/* Tools — out of the way while a phone keyboard is up */}
      {(phase === 'edit' || phase === 'start') && !compact && (
        <div className="flex items-center gap-0.5 px-2 py-1 bg-white border-b border-gray-200 overflow-x-auto" role="toolbar" aria-label={t('dsgTitle')}>
          {(showBasics || offered.length > 0) && <ToolButton
            icon={LayoutTemplate}
            label={t('dsgLayouts')}
            testId="layouts"
            onClick={() => {
              // Tapped again while the chooser is open: it keeps its way back.
              setChooserFromEdit((was) => phase === 'edit' || was);
              setPhase('start');
            }}
          />}
          <ToolButton icon={Type} label={t('dsgAddText')} testId="text" onClick={addText} disabled={phase !== 'edit'} />
          <ToolButton icon={ImagePlus} label={t('dsgAddPhoto')} testId="photo" onClick={() => openPhotoPicker(null)} disabled={phase !== 'edit'} />
          <ToolButton icon={Square} label={t('dsgAddSquare')} testId="square" onClick={() => addShape('rect')} disabled={phase !== 'edit'} />
          <ToolButton icon={CircleIcon} label={t('dsgAddCircle')} testId="circle" onClick={() => addShape('circle')} disabled={phase !== 'edit'} />
          <span className="w-px h-8 bg-gray-200 mx-1 shrink-0" />
          <ToolButton icon={Undo2} label={t('dsgUndo')} testId="undo" onClick={() => void undo()} disabled={phase !== 'edit' || h.past.length === 0} />
          <ToolButton icon={Redo2} label={t('dsgRedo')} testId="redo" onClick={() => void redo()} disabled={phase !== 'edit' || h.future.length === 0} />
        </div>
      )}

      {/* The board, and the panel beside it (under it on a phone) */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <div
          ref={areaRef}
          className={cn('relative flex-1 min-w-0 flex items-center justify-center overflow-hidden', compact ? 'min-h-[6rem]' : 'min-h-[11.25rem]')}
        >
          <div
            className="relative bg-white shadow-xl"
            style={{ width: view.w, height: view.h, touchAction: 'none' }}
            data-rx-designer-board
          >
            <div ref={hostRef} className="absolute inset-0" />
            {view.w > 0 && (
              <DesignGuides board={board} trim={trim} outline={outline} safe={SAFE_MARGIN_MM * U} z={view.z} width={view.w} height={view.h} />
            )}
          </div>

          {(phase === 'loading' || phase === 'exporting') && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#eceef4]/85"
              data-rx-designer-busy={phase}
              role="status"
              aria-live="polite"
            >
              <Loader2 className="w-8 h-8 text-orange-600 animate-spin" />
              <span className="text-xs font-black text-gray-700">{phase === 'loading' ? t('dsgLoading') : owner ? 'Saving the template…' : t('dsgPreparing')}</span>
            </div>
          )}

          {phase === 'failed' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-[#eceef4]">
              <AlertTriangle className="w-8 h-8 text-amber-600" />
              <span className="text-sm font-bold text-gray-800 max-w-xs">{t('dsgFontsFailed')}</span>
              <button
                type="button"
                onClick={() => bootRef.current()}
                className="px-4 py-2 rounded-full text-xs font-black text-white bg-gradient-to-br from-orange-500 to-orange-700"
              >
                {t('dsgRetry')}
              </button>
            </div>
          )}

          {phase === 'start' && (
            <div className="absolute inset-0 overflow-y-auto bg-[#eceef4]/95 p-4" data-rx-layouts>
              <div className="max-w-xl mx-auto space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-black text-gray-900">{t('dsgChooseLayout')}</h3>
                  {chooserFromEdit && (
                    <button type="button" onClick={() => setPhase('edit')} className="text-xs font-black text-orange-700">
                      {t('dsgProofBack')}
                    </button>
                  )}
                </div>
                {chooserFromEdit && (c?.getObjects().length ?? 0) > 0 && (
                  <p className="text-[0.6875rem] font-bold text-gray-500">{t('dsgLayoutReplaces')}</p>
                )}
                {chooserNotice && (
                  <p role="alert" className="text-[0.6875rem] font-black text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-chooser-notice>
                    {chooserNotice}
                  </p>
                )}
                {!owner && (templates === undefined || templatesFailed || offered.length > 0) && (
                  <div className="space-y-2" data-rx-shop-templates>
                    <h4 className={label}>{t('dsgShopTemplates')}</h4>
                    {templates === undefined ? (
                      <p className="flex items-center gap-2 text-[0.6875rem] font-bold text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('dsgTemplatesLoading')}
                      </p>
                    ) : templatesFailed ? (
                      <div className="flex flex-wrap items-center gap-3 text-[0.6875rem] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-templates-failed>
                        <span className="flex-1 min-w-[10rem]">{t('dsgTemplatesListFailed')}</span>
                        {onRetryTemplates && (
                          <button type="button" onClick={onRetryTemplates} className="font-black text-orange-700 shrink-0" data-rx-templates-retry>
                            {t('dsgRetry')}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {offered.map((x) => (
                          <button
                            key={x.id}
                            type="button"
                            onClick={() => void pickTemplate(x)}
                            data-rx-shop-template={x.id}
                            className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white border border-gray-200 hover:border-orange-400 hover:shadow-md transition"
                          >
                            <span className="w-full aspect-[4/3] flex items-center justify-center p-1">
                              {x.thumbnailUrl ? (
                                <img src={x.thumbnailUrl} alt="" className="max-w-full max-h-full object-contain rounded shadow-sm ring-1 ring-gray-200" />
                              ) : (
                                <LayoutTemplate className="w-8 h-8 text-gray-300" />
                              )}
                            </span>
                            <span className="text-xs font-black text-gray-800 text-center">{localized(x.name, x.nameI18n, language)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {missed.length > 0 && (
                  <div className="text-[0.625rem] font-bold text-gray-500 bg-white border border-dashed border-gray-300 rounded-xl px-3 py-2 space-y-0.5" data-rx-template-misses>
                    <p className="font-black text-gray-600">Only you see this (admin): templates for this product that are not offered at this size —</p>
                    {missed.map(({ x, why }) => (
                      <p key={x.id}>
                        “{x.name}” — {MISS_TEXT[why]} (made for {Math.round(x.trimMm.wMm)} × {Math.round(x.trimMm.hMm)} mm)
                      </p>
                    ))}
                  </div>
                )}
                {showBasics && !owner && (offered.length > 0 || templatesFailed) && <h4 className={label}>{t('dsgBasicLayouts')}</h4>}
                {showBasics && (
                <div className="grid grid-cols-2 gap-3">
                  {DESIGN_TEMPLATES.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => applyTemplate(id)}
                      data-rx-layout={id}
                      className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white border border-gray-200 hover:border-orange-400 hover:shadow-md transition"
                    >
                      <span className="w-full aspect-[4/3] flex items-center justify-center p-1">
                        <TemplateThumb id={id} trimMm={trimMm} outline={outline} words={words} />
                      </span>
                      <span className="text-xs font-black text-gray-800">{t(LAYOUT_LABEL[id])}</span>
                    </button>
                  ))}
                </div>
                )}
              </div>
            </div>
          )}

          {phase === 'proof' && proof && (
            <div className="absolute inset-0 overflow-y-auto bg-[#eceef4] p-4" data-rx-proof>
              <div className="max-w-md mx-auto space-y-3">
                <h3 className="text-sm font-black text-gray-900">{t('dsgProofTitle')}</h3>
                <NeoSizePreview
                  widthMm={trimMm.wMm}
                  heightMm={trimMm.hMm}
                  file={proof.preview}
                  sizeLabel={sizeLabel}
                  outline={outline}
                  t={t}
                  className="mx-auto p-3 rounded-2xl bg-white"
                />
                <p className="text-[0.6875rem] font-bold text-gray-600" data-rx-proof-file>
                  {t('dsgProofFile')
                    .replace('{0}', String(proof.widthPx))
                    .replace('{1}', String(proof.heightPx))
                    .replace('{2}', exportSize.kind === 'ok' ? String(exportSize.dpi) : '')}
                </p>
                <ul className="space-y-1.5">
                  {proof.lowestDpi !== null && imageQuality(proof.lowestDpi) === 'poor' && (
                    <li className="text-[0.6875rem] font-black text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2" data-rx-proof-warning="photo-poor">
                      {t('dsgProofPhotoPoor').replace('{0}', String(Math.round(proof.lowestDpi)))}
                    </li>
                  )}
                  {proof.lowestDpi !== null && imageQuality(proof.lowestDpi) === 'fair' && (
                    <li className="text-[0.6875rem] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-proof-warning="photo-fair">
                      {t('dsgProofPhotoFair').replace('{0}', String(Math.round(proof.lowestDpi)))}
                    </li>
                  )}
                  {proof.textNearEdge && (
                    <li className="text-[0.6875rem] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-proof-warning="text-edge">
                      {t('dsgProofTextEdge')}
                    </li>
                  )}
                  {proof.emptySlots > 0 && (
                    <li className="text-[0.6875rem] font-bold text-gray-600 bg-white border border-gray-200 rounded-xl px-3 py-2" data-rx-proof-warning="empty-frames">
                      {t('dsgProofEmptySlots')}
                    </li>
                  )}
                  <li className="text-[0.6875rem] font-bold text-gray-500 bg-white border border-gray-200 rounded-xl px-3 py-2">{t('dsgProofColours')}</li>
                </ul>
                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-gray-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setChecked(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-orange-600"
                    data-rx-proof-tick
                  />
                  <span className="text-xs font-bold text-gray-800">{t('dsgProofTick')}</span>
                </label>
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setPhase('edit')}
                    className="px-4 py-2.5 rounded-full text-xs font-black text-gray-700 bg-white border border-gray-300"
                  >
                    {t('dsgProofBack')}
                  </button>
                  <button
                    type="button"
                    onClick={attach}
                    disabled={!checked}
                    className="px-5 py-2.5 rounded-full text-xs font-black text-white bg-gradient-to-br from-orange-500 to-orange-700 disabled:opacity-40"
                  >
                    {t('dsgProofAttach')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {phase === 'edit' && (
          <aside
            className="w-full md:w-72 shrink-0 bg-white border-t md:border-t-0 md:border-l border-gray-200 p-3 space-y-3 overflow-y-auto max-h-[42%] md:max-h-none"
            data-rx-designer-panel
          >
            {notice && (
              <p role="alert" className="text-[0.6875rem] font-black text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {notice}
              </p>
            )}
            {restoredAt && (
              <div className="flex items-center gap-2 text-[0.6875rem] font-bold text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2" data-rx-restored>
                <span className="flex-1">
                  {t('dsgRestored').replace(
                    '{0}',
                    new Date(restoredAt).toLocaleString(localeFor(language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                  )}
                </span>
                {owner && draftRef.current && (
                  <button type="button" onClick={() => void backToSaved()} className="font-black text-orange-700 shrink-0" data-rx-back-to-saved>
                    Back to the saved template
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setChooserFromEdit(true);
                    setPhase('start');
                  }}
                  className="font-black text-orange-700 shrink-0"
                >
                  {t('dsgStartOver')}
                </button>
              </div>
            )}

            {!selected && (
              <>
                <p className="text-xs font-bold text-gray-500">{t('dsgSelectHint')}</p>
                {/* The shop may have fixed the background of its template. */}
                {!bgLocked && (
                  <Swatches value={c?.backgroundColor} onPick={setBackground} label={t('dsgBackground')} customLabel={t('dsgCustomColour')} />
                )}
              </>
            )}

            {tb && (
              <>
                <div className="space-y-1">
                  <label className={label} htmlFor={`${titleId}-text`}>{t('dsgTextField')}</label>
                  <textarea
                    id={`${titleId}-text`}
                    value={tb.text}
                    rows={2}
                    onChange={(e) => {
                      const box = wordsOnly ? (tb as Tagged).rxBox : undefined;
                      if (box) {
                        // Fixed but for its words: they stay inside the box the shop
                        // drew. From the shop's own width and type size every time
                        // (fabric widens a box for a long word), then smaller until
                        // they fit — and back up when the words get shorter again.
                        tb.set({ text: e.target.value, width: box.w, fontSize: box.fontSize });
                        tb.initDimensions();
                        fitText(tb, box.w, box.h);
                        tb.setCoords();
                        render();
                        refresh();
                      } else {
                        restyleText(tb, { text: e.target.value });
                      }
                      commitSoon();
                    }}
                    onFocus={() => setTextFocused(true)}
                    onBlur={() => setTextFocused(false)}
                    data-rx-designer-text
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-base sm:text-sm font-bold text-gray-900 resize-y"
                  />
                </div>
                {wordsOnly && (
                  <p className="flex items-center gap-1.5 text-[0.6875rem] font-bold text-gray-500" data-rx-words-only>
                    <Lock className="w-3.5 h-3.5" />
                    {t('dsgWordsOnly')}
                  </p>
                )}
                {!wordsOnly && (
                <>
                <div className="space-y-1">
                  <label className={label} htmlFor={`${titleId}-font`}>{t('dsgFont')}</label>
                  <select
                    id={`${titleId}-font`}
                    value={String(tb.fontFamily)}
                    onChange={(e) => {
                      restyleText(tb, { fontFamily: e.target.value });
                      commit();
                    }}
                    data-rx-designer-font
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold bg-white"
                  >
                    {DESIGNER_FONTS.filter((f) => fonts.has(f.family)).map((f) => (
                      <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={label} htmlFor={`${titleId}-pt`}>
                    {t('dsgTextSize')} · {ptOf(tb)} pt
                  </label>
                  <input
                    id={`${titleId}-pt`}
                    type="range"
                    min={4}
                    max={maxPt}
                    value={Math.min(maxPt, ptOf(tb))}
                    onChange={(e) => {
                      const pt = Number(e.target.value);
                      restyleText(tb, { fontSize: ((pt / PT_PER_MM) * U) / (tb.scaleY || 1) });
                      commitSoon();
                    }}
                    data-rx-designer-pt
                    className="w-full accent-orange-600"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={tb.fontWeight === 'bold'}
                    aria-label={t('dsgBold')}
                    onClick={() => {
                      restyleText(tb, { fontWeight: tb.fontWeight === 'bold' ? 'normal' : 'bold' });
                      commit();
                    }}
                    className={cn('w-9 h-9 rounded-xl flex items-center justify-center border', tb.fontWeight === 'bold' ? 'bg-orange-100 border-orange-300 text-orange-800' : 'border-gray-200 text-gray-600')}
                  >
                    <Bold className="w-4 h-4" />
                  </button>
                  {(['left', 'center', 'right'] as const).map((a) => {
                    const Icon = a === 'left' ? AlignLeft : a === 'center' ? AlignCenter : AlignRight;
                    const key: TranslationKey = a === 'left' ? 'dsgAlignLeft' : a === 'center' ? 'dsgAlignCenter' : 'dsgAlignRight';
                    return (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={tb.textAlign === a}
                        aria-label={t(key)}
                        onClick={() => {
                          restyleText(tb, { textAlign: a });
                          commit();
                        }}
                        className={cn('w-9 h-9 rounded-xl flex items-center justify-center border', tb.textAlign === a ? 'bg-orange-100 border-orange-300 text-orange-800' : 'border-gray-200 text-gray-600')}
                      >
                        <Icon className="w-4 h-4" />
                      </button>
                    );
                  })}
                </div>
                <Swatches value={tb.fill} onPick={(colour) => setFill(tb, colour)} label={t('dsgColour')} customLabel={t('dsgCustomColour')} />
                </>
                )}
              </>
            )}

            {img && (
              <>
                <p
                  className={cn(
                    'text-[0.6875rem] font-black rounded-xl px-3 py-2 border',
                    photoLevel === 'good' && 'text-emerald-800 bg-emerald-50 border-emerald-200',
                    photoLevel === 'fair' && 'text-amber-800 bg-amber-50 border-amber-200',
                    photoLevel === 'poor' && 'text-red-700 bg-red-50 border-red-200',
                  )}
                  data-rx-photo-quality={photoLevel}
                >
                  {t(photoLevel === 'good' ? 'dsgPhotoGood' : photoLevel === 'fair' ? 'dsgPhotoFair' : 'dsgPhotoPoor').replace('{0}', String(Math.round(photoDpi)))}
                </p>
                <div className="space-y-1">
                  <label className={label} htmlFor={`${titleId}-size`}>{t('dsgSize')}</label>
                  <input
                    id={`${titleId}-size`}
                    type="range"
                    min={5}
                    max={200}
                    value={Math.min(200, pctOf(img))}
                    onChange={(e) => setPct(img, Number(e.target.value))}
                    className="w-full accent-orange-600"
                  />
                </div>
                {/* The shop fixed its background: a photo laid over all of it would undo that. */}
                {!bgLocked && (
                  <button
                    type="button"
                    onClick={() => fillBackground(img)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-xs font-black text-gray-700 hover:border-orange-400"
                  >
                    <Maximize2 className="w-4 h-4" />
                    {t('dsgFillBackground')}
                  </button>
                )}
              </>
            )}

            {slot && (
              <button
                type="button"
                onClick={() => openPhotoPicker(slot)}
                data-rx-slot-add
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-br from-orange-500 to-orange-700"
              >
                <ImagePlus className="w-4 h-4" />
                {t('dsgAddPhotoHere')}
              </button>
            )}

            {shape && (
              <>
                <Swatches value={shape.fill} onPick={(colour) => setFill(shape, colour)} label={t('dsgColour')} customLabel={t('dsgCustomColour')} />
                <div className="space-y-1">
                  <label className={label} htmlFor={`${titleId}-shape`}>{t('dsgSize')}</label>
                  <input
                    id={`${titleId}-shape`}
                    type="range"
                    min={3}
                    max={150}
                    value={Math.min(150, pctOf(shape))}
                    onChange={(e) => setPct(shape, Number(e.target.value))}
                    className="w-full accent-orange-600"
                  />
                </div>
              </>
            )}

            {owner && selected && !slot && (
              <LockControl
                value={selected.rxLock ?? null}
                isText={!!tb}
                onChange={(lock) => setLockOf(selected, lock)}
              />
            )}

            {selected && !fixed(selected) && (
              <div className="grid grid-cols-4 gap-1 pt-1 border-t border-gray-100">
                <ToolButton icon={ArrowUpToLine} label={t('dsgForward')} onClick={() => layer('up')} />
                <ToolButton icon={ArrowDownToLine} label={t('dsgBackward')} onClick={() => layer('down')} />
                <ToolButton icon={Copy} label={t('dsgDuplicate')} onClick={() => void duplicate()} />
                <ToolButton icon={Trash2} label={t('dsgDelete')} testId="delete" onClick={removeSelected} />
              </div>
            )}
          </aside>
        )}
      </div>

      {/* The marks, explained, and the way out */}
      {phase === 'edit' && !compact && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 sm:px-5 py-2.5 bg-white border-t border-gray-200">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem] font-bold text-gray-500 flex-1 min-w-[12rem]">
            <span className="flex items-center gap-1">
              <span className="w-4 border-t-2 border-dashed border-orange-600" />
              {t('dsgGuideCut')}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-orange-600/20" />
              {t('dsgGuideSafe')}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm bg-slate-900/30" />
              {t('dsgGuideBleed')}
            </span>
          </div>
          {owner ? (
            <button
              type="button"
              onClick={() => void saveTemplate()}
              data-rx-template-save
              className="ml-auto px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-wider text-white bg-gradient-to-br from-orange-500 to-orange-700 shadow-md"
            >
              Save template
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void makePrintFile()}
              data-rx-designer-use
              className="ml-auto px-5 py-2.5 rounded-full text-xs font-black uppercase tracking-wider text-white bg-gradient-to-br from-orange-500 to-orange-700 shadow-md"
            >
              {t('dsgUse')}
            </button>
          )}
        </div>
      )}

      <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPhotoPicked} data-rx-photo-input />
    </div>
  );
}
