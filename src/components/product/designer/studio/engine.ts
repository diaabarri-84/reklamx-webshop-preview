/**
 * THE STUDIO'S ENGINE — the board, the design's sides, the history, the view
 * (designer v2, the Pixartprinting-style editor).
 *
 * One fabric canvas shows ONE side at a time; the document (src/lib/designDoc.ts)
 * holds every side as a JSON string. A change on screen becomes one step of ONE
 * history of whole documents (the side that changed is shared with nothing; the
 * others are the very same strings as the step before). Undo shows the side the
 * step changed. The template a design started from travels in every step.
 *
 * Kept from the round-16 designer because each one stopped a real loss:
 *  - locks applied after EVERY load (fabric keeps none in its JSON);
 *  - fonts loaded BEFORE fabric builds any text (it measures once, with whatever
 *    font it has — src/components/product/designer/fonts.ts);
 *  - a load that drops a picture says how many (fabric skips a picture that will
 *    not decode, without a word), so the page can tell the customer;
 *  - no step is taken while a side is half-loaded; a pending change becomes a step
 *    before Undo (or Undo went back two steps and lost what was just typed).
 *
 * Framework-free: the React shell (DesignStudio.tsx) subscribes and reads.
 */
import { Canvas, Circle, Ellipse, FabricImage, Group, Point, Rect, Textbox, util, type FabricObject } from 'fabric';
import { RxPattern, RxQr, RxTextbox } from '../rxObjects';
import {
  INK,
  PROPS,
  adjustPicture,
  adjustPixels,
  dressControls,
  elementObject,
  inkColour,
  isFixed,
  makeSlot,
  newImageId,
  objectLeavesInk,
  patternObject,
  qrObject,
  recolourElement,
  slotShape,
  U,
  type Lock,
  type Mode,
  type SlotShape,
  type Tagged,
} from './studioObjects';
import { StudioOverlay } from './overlay';
import { cornersOf, edgesAtCut, weakQrCodes } from './proofChecks';
import { fitText } from '../fitText';
import { DEFAULT_DESIGNER_FONT, ensureFontFamilies } from '../fonts';
import { fontFamilyInfo } from '../../../../lib/designFonts';
import {
  BLANK_SIDE_JSON,
  designImageIds,
  ensureSides,
  sideFontFamilies,
  sideJson,
  withSide,
  type DesignDoc,
  type SideId,
} from '../../../../lib/designDoc';
import { refitSideJson, type BoardGeometry } from '../../../../lib/designRefit';
import { safeBox } from '../../../../lib/designTemplates';
import { effectiveDpi, pictureScale, typedSizeMm } from '../../../../lib/designSize';
import { QR_MIN_PRINT_MM, qrPath, type QrSpec } from '../../../../lib/designQr';
import { QR_MIN_MODULE_MM } from '../../../../lib/qrPayload';
import type { PatternSpec } from '../../../../lib/designPatterns';
import type { PrintSpec } from '../../../../lib/printSpec';
import type { OutlineKind } from '../../../../lib/shapes';

export const MAX_UNDO = 50;
export const PT_PER_MM = 72 / 25.4;
/** Zoom, as a multiple of "the whole board fits". */
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 12;

export type SelectionKind = 'text' | 'image' | 'slot' | 'qr' | 'pattern' | 'element' | 'shape' | 'group';

export interface Picture {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

interface Step {
  doc: DesignDoc;
  /**
   * The side the change that MADE this step was on. Undoing the step shows that
   * side (with the change gone); redoing it shows it again (with the change back).
   * Not the side on screen — that is `StudioEngine.side`.
   */
  side: SideId;
}

export interface EngineOptions {
  mode: Mode;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  spec: PrintSpec;
  /** The pages the product prints, in order. */
  sides: SideId[];
  /** Words the board itself shows (its guides' names among them). */
  labels: { hidden: string; photoHere: string; cut?: string; safe?: string };
  /** A phone: the page number and size under the board instead of rulers beside it. */
  compact?: boolean;
  /** Text typed on the board itself (a mouse), not in a sheet (touch). */
  inlineText: boolean;
  /** Every change, kept (the shell writes it to the device). */
  onAutosave: (doc: DesignDoc, pictures: Record<string, Blob>, uploads: string[]) => void;
  /** A tap on the board: on something the shop fixed (`locked`), or not. */
  onTap?: (locked: boolean) => void;
  /** A text was tapped twice on a touch screen: type in the sheet. */
  onTextEditRequest?: (o: Textbox) => void;
}

const isTextbox = (o: unknown): o is Textbox => o instanceof Textbox;

export function kindOf(o: FabricObject | null | undefined): SelectionKind | null {
  if (!o) return null;
  if (o instanceof RxQr) return 'qr';
  if (o instanceof RxPattern) return 'pattern';
  if (o instanceof Textbox) return 'text';
  if (o instanceof FabricImage) return 'image';
  if ((o as Tagged).rxSlot) return 'slot';
  if ((o as Tagged).rxElement) return 'element';
  if (o instanceof Group) return 'group';
  return 'shape';
}

/** A request for an animation frame that is dropped when one is already pending. */
function frameThrottle(fn: () => void): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      fn();
    });
  };
}

export class StudioEngine {
  readonly opts: EngineOptions;
  readonly board: { w: number; h: number };
  readonly trim: { x: number; y: number; w: number; h: number };
  /** The box text belongs in: inside the cut by the safe margin, out of the hidden zones (board units). */
  readonly safe: { x: number; y: number; w: number; h: number };
  readonly geometry: BoardGeometry;

  canvas: Canvas | null = null;
  overlay: StudioOverlay;
  readonly images = new Map<string, Picture>();
  /** The customer's own pictures for the Uploads panel, newest first. */
  uploads: string[] = [];

  private history: { past: Step[]; future: Step[]; current: Step };
  side: SideId;
  selected: FabricObject | null = null;
  /** A side is loading, a template opening, an undo running: nothing else may start. */
  busy = false;
  dirty = false;
  preview = false;
  zoom = 1;
  private center: { x: number; y: number };
  private fitZ = 1;
  private size = { w: 0, h: 0 };
  /** Thumbnails of each page, for the pages bar (data URLs). */
  thumbs: Partial<Record<SideId, string>> = {};

  private version = 0;
  private listeners = new Set<() => void>();
  private viewListeners = new Set<() => void>();
  private commitTimer: number | undefined;
  private saveTimer: number | undefined;
  private thumbTimer: number | undefined;
  private cascade = 0;
  private panning: { x: number; y: number } | null = null;
  private pinch: { dist: number; zoom: number; mid: { x: number; y: number }; center: { x: number; y: number } } | null = null;
  private host: HTMLElement | null = null;
  private el: HTMLCanvasElement | null = null;
  private cleanups: Array<() => void> = [];
  private disposed = false;

  constructor(opts: EngineOptions, doc: DesignDoc) {
    this.opts = opts;
    const b = opts.spec.bleedMm;
    const { wMm, hMm } = opts.trimMm;
    this.board = { w: (wMm + 2 * b) * U, h: (hMm + 2 * b) * U };
    this.trim = { x: b * U, y: b * U, w: wMm * U, h: hMm * U };
    this.geometry = { trimMm: { wMm, hMm }, bleedMm: b };
    const box = safeBox(opts.outline, wMm, hMm, opts.spec.safeMm);
    const hid = opts.spec.hiddenMm;
    const x0 = Math.max(box.xMm, hid.left);
    const y0 = Math.max(box.yMm, hid.top);
    const x1 = Math.min(box.xMm + box.wMm, wMm - hid.right);
    const y1 = Math.min(box.yMm + box.hMm, hMm - hid.bottom);
    this.safe = { x: (b + x0) * U, y: (b + y0) * U, w: Math.max(1, x1 - x0) * U, h: Math.max(1, y1 - y0) * U };
    this.center = { x: this.board.w / 2, y: this.board.h / 2 };
    this.side = opts.sides[0] ?? 'front';
    const start = ensureSides(doc, opts.sides);
    this.history = { past: [], future: [], current: { doc: start, side: this.side } };
    this.overlay = new StudioOverlay({
      board: this.board,
      trim: this.trim,
      outline: opts.outline,
      safe: opts.spec.safeMm * U,
      hidden: { top: hid.top * U, right: hid.right * U, bottom: hid.bottom * U, left: hid.left * U },
      labels: {
        hidden: opts.labels.hidden,
        cut: opts.labels.cut ?? 'Cut',
        safe: opts.labels.safe ?? 'Safe area',
        // The board as Pixart measures it: with its bleed.
        boardW: `${Math.round((wMm + 2 * b) * 10) / 10}mm`,
        boardH: `${Math.round((hMm + 2 * b) * 10) / 10}mm`,
        boardSize: `${(wMm + 2 * b).toFixed(1)} x ${(hMm + 2 * b).toFixed(1)} mm`,
      },
    });
    this.overlay.compact = opts.compact === true;
    this.markPage();
  }

  /** A phone: the page and size under the board; a wider screen: rulers beside it. */
  setCompact(on: boolean) {
    if (this.overlay.compact === on) return;
    this.overlay.compact = on;
    this.canvas?.requestRenderAll();
  }

  /** "01", "02": the page on the board, as the guides name it. */
  private markPage() {
    this.overlay.page = String(Math.max(0, this.opts.sides.indexOf(this.side)) + 1).padStart(2, '0');
  }

  // ---- room around the board --------------------------------------------------------
  /**
   * What the floating controls cover (CSS px from each edge): the board is fitted — and
   * centred — in what is left, while the canvas still fills the whole area (Pixart's
   * bars float over the work; a panel opening does not move the board). `pad`: the air
   * kept inside that box (omitted: a little, by the box's size; 0: the board touches it,
   * as Pixart's touches its own lines on a desk).
   */
  private insets: { top: number; right: number; bottom: number; left: number; pad?: number } = { top: 0, right: 0, bottom: 0, left: 0 };
  setInsets(next: { top: number; right: number; bottom: number; left: number; pad?: number }) {
    const same = (['top', 'right', 'bottom', 'left', 'pad'] as const).every((k) => this.insets[k] === next[k]);
    if (same) return;
    this.insets = next;
    this.resize(this.size.w, this.size.h);
  }
  /** The board (bleed included) on screen, in CSS px within the canvas — for what Pixart lines up with it. */
  boardOnScreen(): { left: number; top: number; width: number; height: number } | null {
    const c = this.canvas;
    if (!c) return null;
    const v = c.viewportTransform;
    return { left: v[4], top: v[5], width: this.board.w * v[0], height: this.board.h * v[3] };
  }
  private inner(): { cx: number; cy: number; w: number; h: number } {
    const w = Math.max(40, this.size.w - this.insets.left - this.insets.right);
    const h = Math.max(40, this.size.h - this.insets.top - this.insets.bottom);
    return { cx: this.insets.left + w / 2, cy: this.insets.top + h / 2, w, h };
  }

  // ---- subscriptions ------------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  emit = () => {
    this.version += 1;
    for (const fn of this.listeners) fn();
  };
  /** The view moved (zoom, pan, an object dragged): the floating bar follows, nothing else re-renders. */
  subscribeView = (fn: () => void) => {
    this.viewListeners.add(fn);
    return () => this.viewListeners.delete(fn);
  };
  private emitView = frameThrottle(() => {
    for (const fn of this.viewListeners) fn();
  });

  get doc(): DesignDoc {
    return this.history.current.doc;
  }
  get template(): Record<string, unknown> | null {
    return this.history.current.doc.template;
  }
  get canUndo() {
    return this.history.past.length > 0;
  }
  get canRedo() {
    return this.history.future.length > 0;
  }
  /** CSS pixels per board unit, now. */
  /** The product's print values the board was made for (bleed, safe area, resolution). */
  get spec(): PrintSpec {
    return this.opts.spec;
  }

  get pxPerUnit() {
    return this.fitZ * this.zoom;
  }

  // ---- the canvas -------------------------------------------------------------------
  mount(host: HTMLElement) {
    this.host = host;
    const el = document.createElement('canvas');
    host.appendChild(el);
    this.el = el;
    const c = new Canvas(el, {
      width: Math.max(10, host.clientWidth),
      height: Math.max(10, host.clientHeight),
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: false,
      controlsAboveOverlay: true,
      targetFindTolerance: 8,
      fireMiddleClick: false,
      stopContextMenu: true,
    });
    c.overlayImage = this.overlay;
    this.canvas = c;
    this.size = { w: c.width, h: c.height };

    const pick = (o?: FabricObject) => {
      this.selected = o ?? null;
      this.emit();
    };
    c.on('selection:created', (e) => pick(e.selected?.[0]));
    c.on('selection:updated', (e) => pick(e.selected?.[0]));
    c.on('selection:cleared', () => pick(undefined));
    c.on('object:modified', (e) => {
      const o = e.target as Tagged | undefined;
      // Moved or shrunk by hand, a background picture is just a picture again.
      if (o?.rxFill) {
        const r = o.getBoundingRect();
        if (r.left > 0.5 || r.top > 0.5 || r.left + r.width < this.board.w - 0.5 || r.top + r.height < this.board.h - 0.5) o.rxFill = false;
      }
      this.commit();
    });
    const moved = () => {
      this.emitView();
    };
    c.on('object:moving', moved);
    c.on('object:scaling', () => {
      moved();
      this.emit();
    });
    c.on('object:rotating', moved);
    c.on('after:render', moved);
    // Where a words-only text sits: fabric keeps a text's TOP edge as it is typed into,
    // the fit below keeps its centre — together the words crept down with every key
    // (60 keys took a line off the card). The centre is held where the shop put it.
    let editAnchor: Point | null = null;
    c.on('text:editing:entered', (e) => {
      editAnchor = (e.target as Textbox).getCenterPoint();
    });
    c.on('text:changed', (e) => {
      const tb = e.target as Textbox & Tagged;
      if (tb.rxLock === 'words' && tb.rxBox && this.opts.mode === 'customer') {
        // Fixed but for its words: they stay inside the box the shop drew.
        tb.set({ width: tb.rxBox.w, fontSize: tb.rxBox.fontSize });
        tb.initDimensions();
        fitText(tb, tb.rxBox.w, tb.rxBox.h);
        if (editAnchor) tb.setPositionByOrigin(editAnchor, 'center', 'center');
        tb.setCoords();
      }
      this.emit();
    });
    c.on('text:editing:exited', () => this.commit());
    c.on('mouse:down', (e) => {
      const target = e.target as Tagged | undefined;
      this.opts.onTap?.(this.opts.mode === 'customer' && target?.rxLock === 'locked');
      if (!target && !this.pinch) {
        const p = this.pointerOf(e.e);
        if (p) this.panning = p;
      }
    });
    c.on('mouse:move', (e) => {
      if (!this.panning || this.pinch) return;
      const p = this.pointerOf(e.e);
      if (!p) return;
      this.panBy(p.x - this.panning.x, p.y - this.panning.y);
      this.panning = p;
    });
    c.on('mouse:up', (e) => {
      this.panning = null;
      // A touch screen: a second tap on the text already chosen types in the sheet.
      const target = e.target;
      if (!this.opts.inlineText && e.isClick && this.tappedSelected && isTextbox(target) && !this.preview) {
        this.opts.onTextEditRequest?.(target);
      }
      this.tappedSelected = false;
    });
    c.on('mouse:down:before', (e) => {
      this.tappedSelected = !!e.target && e.target === this.selected;
    });
    c.on('mouse:dblclick', (e) => {
      const target = e.target;
      if (isTextbox(target) && !this.opts.inlineText) this.opts.onTextEditRequest?.(target);
    });

    // Zoom with the wheel (a trackpad's pinch is a wheel with Ctrl), pan with it otherwise.
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const rect = (host as HTMLElement).getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) {
        this.zoomAt(this.zoom * Math.exp(-ev.deltaY * 0.01), { x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      } else {
        this.panBy(-ev.deltaX, -ev.deltaY);
      }
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    this.cleanups.push(() => host.removeEventListener('wheel', onWheel));

    // Safari's own trackpad pinch.
    let gestureStart = 1;
    const onGestureStart = (ev: Event) => {
      ev.preventDefault();
      gestureStart = this.zoom;
    };
    const onGestureChange = (ev: Event) => {
      ev.preventDefault();
      const g = ev as Event & { scale: number; clientX: number; clientY: number };
      const rect = host.getBoundingClientRect();
      this.zoomAt(gestureStart * g.scale, { x: g.clientX - rect.left, y: g.clientY - rect.top });
    };
    host.addEventListener('gesturestart', onGestureStart);
    host.addEventListener('gesturechange', onGestureChange);
    this.cleanups.push(() => {
      host.removeEventListener('gesturestart', onGestureStart);
      host.removeEventListener('gesturechange', onGestureChange);
    });

    // Two fingers: pinch and pan. Caught on the way DOWN to the canvas and kept from
    // it, so the first finger's object does not move while the hand zooms.
    const touchPoints = (ev: TouchEvent) => {
      const rect = host.getBoundingClientRect();
      return Array.from(ev.touches).slice(0, 2).map((t) => ({ x: t.clientX - rect.left, y: t.clientY - rect.top }));
    };
    const onTouchStart = (ev: TouchEvent) => {
      if (ev.touches.length < 2) return;
      ev.preventDefault();
      ev.stopPropagation();
      // Whatever the first finger had started to move goes back where it was.
      const canvas = this.canvas as (Canvas & { _currentTransform?: { target: FabricObject; original: Record<string, unknown> } | null }) | null;
      const t = canvas?._currentTransform;
      if (t?.target && t.original) {
        t.target.set(t.original as Partial<FabricObject>);
        t.target.setCoords();
        canvas!._currentTransform = null;
      }
      this.panning = null;
      this.tappedSelected = false;
      const [a, b] = touchPoints(ev);
      this.pinch = {
        dist: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        zoom: this.zoom,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        center: { ...this.center },
      };
    };
    const onTouchMove = (ev: TouchEvent) => {
      if (!this.pinch) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.touches.length < 2) return;
      const [a, b] = touchPoints(ev);
      const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const start = this.pinch;
      // The board point under the first midpoint stays under the fingers. (Measured from
      // the middle of the room the bars leave, where applyView puts the board's centre.)
      const box = this.inner();
      const z0 = this.fitZ * start.zoom;
      const anchor = {
        x: start.center.x + (start.mid.x - box.cx) / z0,
        y: start.center.y + (start.mid.y - box.cy) / z0,
      };
      this.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, start.zoom * (dist / start.dist)));
      const z = this.fitZ * this.zoom;
      this.center = { x: anchor.x - (mid.x - box.cx) / z, y: anchor.y - (mid.y - box.cy) / z };
      this.applyView();
    };
    // Never kept from the canvas: fabric ends its own touch when the last finger lifts.
    const onTouchEnd = (ev: TouchEvent) => {
      if (this.pinch && ev.touches.length === 0) this.pinch = null;
    };
    host.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    host.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    host.addEventListener('touchend', onTouchEnd, { capture: true });
    host.addEventListener('touchcancel', onTouchEnd, { capture: true });
    this.cleanups.push(() => {
      host.removeEventListener('touchstart', onTouchStart, { capture: true });
      host.removeEventListener('touchmove', onTouchMove, { capture: true });
      host.removeEventListener('touchend', onTouchEnd, { capture: true });
      host.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    });
    // A phone puts the tab away (another app, the lock button) and may never wake it:
    // what is pending is kept NOW, not in the 400 + 600 ms the timers would wait.
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && !this.busy) this.flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onHidden));

    this.resize(host.clientWidth, host.clientHeight);
  }

  private tappedSelected = false;

  private pointerOf(e: Event): { x: number; y: number } | null {
    const host = this.host;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const t = (e as TouchEvent).touches?.[0] ?? (e as TouchEvent).changedTouches?.[0];
    const src = t ?? (e as MouseEvent);
    if (typeof src.clientX !== 'number') return null;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.commitTimer);
    window.clearTimeout(this.saveTimer);
    window.clearTimeout(this.thumbTimer);
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    const c = this.canvas;
    this.canvas = null;
    if (c) void c.dispose();
    this.el?.remove();
    this.el = null;
    for (const p of this.images.values()) URL.revokeObjectURL(p.url);
    this.images.clear();
    this.listeners.clear();
    this.viewListeners.clear();
  }

  // ---- the view ---------------------------------------------------------------------
  resize(w: number, h: number) {
    const c = this.canvas;
    if (!c || w < 2 || h < 2) return;
    c.setDimensions({ width: Math.floor(w), height: Math.floor(h) });
    this.size = { w: Math.floor(w), h: Math.floor(h) };
    // Room for the rulers along two edges and a little air, inside what the bars leave.
    const box = this.inner();
    const pad = this.insets.pad ?? Math.min(48, Math.max(16, Math.min(box.w, box.h) * 0.06));
    this.fitZ = Math.max(1e-4, Math.min((box.w - 2 * pad) / this.board.w, (box.h - 2 * pad) / this.board.h));
    this.applyView();
  }

  private applyView() {
    const c = this.canvas;
    if (!c) return;
    const z = this.fitZ * this.zoom;
    // The whole board on screen: it stays in the middle. Closer: never lose it.
    this.center =
      this.zoom <= 1
        ? { x: this.board.w / 2, y: this.board.h / 2 }
        : {
            x: Math.min(this.board.w, Math.max(0, this.center.x)),
            y: Math.min(this.board.h, Math.max(0, this.center.y)),
          };
    const box = this.inner();
    c.setViewportTransform([z, 0, 0, z, box.cx - this.center.x * z, box.cy - this.center.y * z]);
    this.overlay.pxPerUnit = z;
    for (const o of c.getObjects()) o.setCoords();
    c.requestRenderAll();
    this.emitView();
    this.emit();
  }

  /** Zoom to `zoom` (× fit), keeping the board point under `at` (CSS px in the canvas) where it is. */
  zoomAt(zoom: number, at?: { x: number; y: number }) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
    const box = this.inner();
    const p = at ?? { x: box.cx, y: box.cy };
    const z0 = this.fitZ * this.zoom;
    const anchor = { x: this.center.x + (p.x - box.cx) / z0, y: this.center.y + (p.y - box.cy) / z0 };
    this.zoom = next;
    const z = this.fitZ * next;
    this.center = { x: anchor.x - (p.x - box.cx) / z, y: anchor.y - (p.y - box.cy) / z };
    this.applyView();
  }

  zoomStep(dir: 1 | -1) {
    const steps = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12];
    const next = dir > 0 ? steps.find((s) => s > this.zoom + 1e-3) : [...steps].reverse().find((s) => s < this.zoom - 1e-3);
    this.zoomAt(next ?? this.zoom);
  }

  fit() {
    this.zoom = 1;
    this.center = { x: this.board.w / 2, y: this.board.h / 2 };
    this.applyView();
  }

  panBy(dx: number, dy: number) {
    const z = this.fitZ * this.zoom;
    this.center = { x: this.center.x - dx / z, y: this.center.y - dy / z };
    this.applyView();
  }

  /** Where an object is on screen (CSS px in the canvas), for the floating bar. */
  screenRectOf(o: FabricObject): { left: number; top: number; right: number; bottom: number } | null {
    const c = this.canvas;
    if (!c) return null;
    const v = c.viewportTransform;
    const pts = o.getCoords().map((p) => util.transformPoint(p, v));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }

  /** The board point under a screen point (CSS px in the canvas). */
  boardPointAt(x: number, y: number): { x: number; y: number } {
    // The inverse of applyView: the board's centre sits in the middle of the room the bars leave.
    const box = this.inner();
    const z = this.fitZ * this.zoom;
    return { x: this.center.x + (x - box.cx) / z, y: this.center.y + (y - box.cy) / z };
  }

  /** Pixart's "Ruler" switch: the board's measures beside it (a wider screen). */
  get rulers(): boolean {
    return this.overlay.rulers;
  }
  setRulers(on: boolean) {
    this.overlay.rulers = on;
    this.canvas?.requestRenderAll();
    this.emit();
  }

  setPreview(on: boolean) {
    const c = this.canvas;
    this.preview = on;
    this.overlay.preview = on;
    if (c) {
      if (on) {
        c.discardActiveObject();
        this.selected = null;
      }
      c.skipTargetFind = on;
      c.requestRenderAll();
    }
    this.emit();
  }

  // ---- loading a side ----------------------------------------------------------------
  /**
   * One side's JSON onto the board: fonts first, pictures by id, locks dressed.
   * Resolves with how many objects did NOT come back (a picture the device no longer
   * holds), and whether one of them was the shop's.
   */
  private async loadSide(json: string): Promise<{ lost: number; lockedLost: boolean }> {
    const c = this.canvas;
    if (!c) return { lost: 0, lockedLost: false };
    let data: { background?: unknown; objects?: Array<Record<string, unknown>> };
    try {
      data = JSON.parse(json);
    } catch {
      data = JSON.parse(BLANK_SIDE_JSON);
    }
    const all = Array.isArray(data.objects) ? data.objects : [];
    await ensureFontFamilies(sideFontFamilies(json));
    const objects = all.filter((o) => {
      if (String(o.type ?? '').toLowerCase() !== 'image') return true;
      const p = this.images.get(String(o.rxImageId ?? ''));
      if (!p) return false;
      o.src = p.url;
      return true;
    });
    const made = (await util.enlivenObjects(objects)) as FabricObject[];
    if (this.canvas !== c || this.disposed) return { lost: 0, lockedLost: false };
    c.discardActiveObject();
    c.remove(...c.getObjects());
    c.backgroundColor = typeof data.background === 'string' && data.background ? data.background : '#ffffff';
    for (const o of made) {
      this.dress(o);
      c.add(o);
      o.setCoords();
    }
    c.overlayImage = this.overlay;
    c.requestRenderAll();
    this.selected = null;
    const lockedIn = all.filter((o) => o?.rxLock === 'locked').length;
    const lockedOut = made.filter((o) => (o as Tagged).rxLock === 'locked').length;
    return { lost: all.length - made.length, lockedLost: lockedOut < lockedIn };
  }

  private dress(o: FabricObject) {
    dressControls(o, this.opts.mode, { inlineText: this.opts.inlineText });
  }

  /**
   * The design to start from: every side refitted from the geometry it was made at,
   * the pages the product prints added blank, pictures registered. The history
   * starts here. Resolves with what did not come back on the side shown.
   */
  async start(
    doc: DesignDoc,
    pictures: Record<string, Blob>,
    from: BoardGeometry | null,
    uploads: string[] = [],
  ): Promise<{ lost: number; lockedLost: boolean }> {
    this.registerPictures(pictures);
    this.uploads = uploads.filter((id) => this.images.has(id));
    const refitted = this.refitDoc(doc, from);
    this.history = { past: [], future: [], current: { doc: ensureSides(refitted, this.opts.sides), side: this.opts.sides[0] ?? 'front' } };
    this.side = this.history.current.side;
    this.markPage();
    this.busy = true;
    this.emit();
    try {
      const result = await this.loadSide(sideJson(this.doc, this.side) ?? BLANK_SIDE_JSON);
      // A picture that did not come back is gone from the design from now on.
      if (result.lost > 0) this.history.current = { doc: withSide(this.doc, this.side, this.snapshotSide()), side: this.side };
      // …on EVERY side, here and now. Only the side on screen was looked at: a picture
      // the device no longer held on the back went to print as nothing, without a word.
      let lostElsewhere = 0;
      let lockedElsewhere = false;
      let doc = this.doc;
      for (const s of this.opts.sides) {
        if (s === this.side) continue;
        const json = sideJson(doc, s);
        if (!json) continue;
        try {
          const data = JSON.parse(json) as { objects?: Array<Record<string, unknown>> };
          const objects = Array.isArray(data.objects) ? data.objects : [];
          const missing = (o: Record<string, unknown>) => String(o?.type ?? '').toLowerCase() === 'image' && !this.images.has(String(o.rxImageId ?? ''));
          const gone = objects.filter(missing);
          if (gone.length === 0) continue;
          lostElsewhere += gone.length;
          if (gone.some((o) => o.rxLock === 'locked')) lockedElsewhere = true;
          doc = withSide(doc, s, JSON.stringify({ ...data, objects: objects.filter((o) => !missing(o)) }));
        } catch {
          /* a side that cannot be read is refused when it is shown */
        }
      }
      if (lostElsewhere > 0) this.history.current = { doc, side: this.history.current.side };
      this.dirty = false;
      this.scheduleThumbs();
      return { lost: result.lost + lostElsewhere, lockedLost: result.lockedLost || lockedElsewhere };
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  refitDoc(doc: DesignDoc, from: BoardGeometry | null): DesignDoc {
    if (!from) return doc;
    let out = doc;
    for (const s of doc.sides) {
      const json = refitSideJson(s.json, from, this.geometry, U);
      if (json && json !== s.json) out = withSide(out, s.id, json);
    }
    return out;
  }

  registerPictures(pictures: Record<string, Blob>) {
    if (this.disposed) return;
    for (const [id, blob] of Object.entries(pictures)) {
      if (!(blob instanceof Blob) || this.images.has(id)) continue;
      this.images.set(id, { blob, url: URL.createObjectURL(blob), width: 0, height: 0 });
    }
  }

  registerPicture(id: string, picture: { blob: Blob; url: string; width: number; height: number }, upload = false) {
    // CLOSED MEANWHILE (an AI picture or a big upload finishing after Close): nothing is
    // kept — a save from here held only this picture, and the device draft lost the rest.
    if (this.disposed) {
      URL.revokeObjectURL(picture.url);
      return;
    }
    this.images.set(id, picture);
    if (upload) {
      this.uploads = [id, ...this.uploads.filter((x) => x !== id)].slice(0, 40);
      this.scheduleSave();
    }
    this.emit();
  }

  removeUpload(id: string) {
    if (this.disposed) return;
    this.uploads = this.uploads.filter((x) => x !== id);
    this.scheduleSave();
    this.emit();
  }

  // ---- history ----------------------------------------------------------------------------
  /** The side on screen as JSON: pictures by id only (their addresses are this page's own). */
  snapshotSide(): string {
    const c = this.canvas;
    if (!c) return sideJson(this.doc, this.side) ?? BLANK_SIDE_JSON;
    const data = c.toObject(PROPS) as { version?: string; objects?: Array<Record<string, unknown>> };
    const objects = (data.objects ?? []).map((o) => (String(o.type).toLowerCase() === 'image' ? { ...o, src: '' } : o));
    const bg = typeof c.backgroundColor === 'string' && c.backgroundColor ? c.backgroundColor : '#ffffff';
    return JSON.stringify({ version: data.version, background: bg, objects });
  }

  /** The board as it is now becomes one step of the history, and is kept. */
  commit(opts: { template?: Record<string, unknown> | null } = {}) {
    window.clearTimeout(this.commitTimer);
    this.commitTimer = undefined;
    if (!this.canvas || this.busy || this.disposed) return;
    const json = this.snapshotSide();
    const cur = this.history.current;
    const template = opts.template !== undefined ? opts.template : cur.doc.template;
    if (json === sideJson(cur.doc, this.side) && template === cur.doc.template) return;
    const doc: DesignDoc = { ...withSide(cur.doc, this.side, json), template };
    this.history.past.push(cur);
    if (this.history.past.length > MAX_UNDO) this.history.past.shift();
    this.history.current = { doc, side: this.side };
    this.history.future = [];
    this.dirty = true;
    this.scheduleSave();
    this.scheduleThumbs();
    this.emit();
  }

  /** What is on the pages now is where the history starts (a template opened from the gallery). */
  resetHistory() {
    // Nor is it his design yet: the save the opening had scheduled wrote the template
    // over the design kept on this device before he changed a thing (code review
    // DSN-05). It is kept from his first real change on.
    window.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.history = { past: [], future: [], current: this.history.current };
    this.dirty = false;
    this.emit();
  }

  /** For a slider or typing: one step when the hand stops, not one per pixel. */
  commitSoon() {
    window.clearTimeout(this.commitTimer);
    this.commitTimer = window.setTimeout(() => this.commit(), 400);
  }

  /**
   * WORDS BEING TYPED ON THE BOARD ARE A STEP BEFORE ANYTHING ELSE HAPPENS. Typing is
   * committed when the editing ends, and Undo, a page tab or a template set `busy`
   * first — loading the side then ended the editing, the commit saw `busy` and gave up,
   * and the words were gone (Undo took the change before them too). Close never ended
   * it at all.
   */
  private endTextEditing() {
    const active = this.canvas?.getActiveObject();
    if (active instanceof Textbox && active.isEditing) active.exitEditing(); // → text:editing:exited → commit()
  }

  private flushPending() {
    this.endTextEditing();
    if (this.commitTimer !== undefined) this.commit();
  }

  async undo() {
    this.flushPending();
    if (this.busy || this.history.past.length === 0) return;
    const leaving = this.history.current;
    const step = this.history.past.pop() as Step;
    this.history.future.push(leaving);
    this.history.current = step;
    // Where the change being undone was.
    await this.showStep(leaving.side);
  }

  async redo() {
    this.flushPending();
    if (this.busy || this.history.future.length === 0) return;
    const step = this.history.future.pop() as Step;
    this.history.past.push(this.history.current);
    this.history.current = step;
    await this.showStep(step.side);
  }

  private async showStep(side: SideId) {
    this.busy = true;
    this.emit();
    try {
      if (this.opts.sides.includes(side)) this.side = side;
      this.markPage();
      await this.loadSide(sideJson(this.doc, this.side) ?? BLANK_SIDE_JSON);
      this.dirty = true;
      this.scheduleSave();
      this.scheduleThumbs();
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  /** Another page on the board. */
  async showSide(id: SideId) {
    if (id === this.side || this.busy || !this.opts.sides.includes(id)) return;
    this.flushPending();
    this.renderThumb();
    this.busy = true;
    this.emit();
    try {
      this.side = id;
      this.markPage();
      await this.loadSide(sideJson(this.doc, id) ?? BLANK_SIDE_JSON);
    } finally {
      this.busy = false;
      this.scheduleThumbs();
      this.emit();
    }
  }

  /** A whole new document (a template chosen): one undoable step. */
  async replaceDoc(doc: DesignDoc, pictures: Record<string, Blob>, from: BoardGeometry | null, opts: { prepare?: (c: Canvas) => void } = {}) {
    // Closed meanwhile (a template arriving after Close): the board is gone, and a
    // snapshot of it would have written the front over every side.
    if (this.busy || this.disposed || !this.canvas) return { lost: 0, lockedLost: false };
    this.flushPending();
    this.registerPictures(pictures);
    const next = ensureSides(this.refitDoc(doc, from), this.opts.sides);
    const before = this.history.current;
    this.busy = true;
    this.emit();
    try {
      this.side = this.opts.sides[0] ?? 'front';
      this.markPage();
      // Every side through the board once: slots relabelled, word boxes measured.
      let out = next;
      for (const s of this.opts.sides) {
        const r = await this.loadSide(sideJson(out, s) ?? BLANK_SIDE_JSON);
        if (r.lost > 0) throw Object.assign(new Error('template pictures'), { lost: r });
        if (this.canvas) opts.prepare?.(this.canvas);
        out = withSide(out, s, this.snapshotSide());
      }
      if (this.side !== this.opts.sides[this.opts.sides.length - 1]) await this.loadSide(sideJson(out, this.side) ?? BLANK_SIDE_JSON);
      this.history.past.push(before);
      if (this.history.past.length > MAX_UNDO) this.history.past.shift();
      this.history.current = { doc: out, side: this.side };
      this.history.future = [];
      this.dirty = true;
      this.scheduleSave();
      this.thumbs = {};
      this.scheduleThumbs();
      return { lost: 0, lockedLost: false };
    } catch (err) {
      // Whatever was there comes back.
      this.history.current = before;
      this.side = before.side;
      this.markPage();
      await this.loadSide(sideJson(before.doc, before.side) ?? BLANK_SIDE_JSON);
      throw err;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  // ---- keeping ---------------------------------------------------------------------------
  scheduleSave() {
    if (this.disposed) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 600);
  }

  saveNow() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.disposed) return;
    const doc = this.doc;
    const pictures: Record<string, Blob> = {};
    for (const id of [...designImageIds(doc), ...this.uploads]) {
      const p = this.images.get(id);
      if (p) pictures[id] = p.blob;
    }
    this.opts.onAutosave(doc, pictures, this.uploads.filter((id) => pictures[id]));
  }

  get savePending() {
    return this.saveTimer !== undefined || this.commitTimer !== undefined;
  }

  /** Before closing: the words being typed and the pending change are a step, and the step is kept. */
  flush() {
    this.endTextEditing();
    if (this.commitTimer !== undefined) this.commit();
    if (this.saveTimer !== undefined) this.saveNow();
  }

  // ---- page thumbnails -------------------------------------------------------------------
  private scheduleThumbs() {
    window.clearTimeout(this.thumbTimer);
    this.thumbTimer = window.setTimeout(() => this.renderThumb(), 500);
  }

  /** The side on screen, small, for the pages bar. */
  renderThumb() {
    const c = this.canvas;
    if (!c || this.busy) return;
    const url = this.snapshotPng(c, 120);
    if (url) {
      this.thumbs = { ...this.thumbs, [this.side]: url };
      this.emit();
    }
  }

  /** The trim area of the board as a PNG data URL, about `maxPx` on its longer side, with no marks. */
  snapshotPng(c: Canvas, maxPx: number): string | null {
    const vpt = [...c.viewportTransform] as typeof c.viewportTransform;
    const overlay = c.overlayImage;
    try {
      c.overlayImage = undefined;
      c.viewportTransform = [1, 0, 0, 1, 0, 0];
      const m = maxPx / Math.max(this.trim.w, this.trim.h);
      const el = c.toCanvasElement(m, { left: this.trim.x, top: this.trim.y, width: this.trim.w, height: this.trim.h });
      const url = el.toDataURL('image/png');
      el.width = 0;
      el.height = 0;
      return url;
    } catch {
      return null;
    } finally {
      c.overlayImage = overlay;
      c.setViewportTransform(vpt);
    }
  }

  // ---- placing things ----------------------------------------------------------------------
  /** Where the next new thing goes: the middle of the safe box, a little further each time. */
  private nextSpot(): { x: number; y: number } {
    const step = Math.min(this.safe.w, this.safe.h) * 0.04;
    const k = this.cascade % 6;
    this.cascade += 1;
    return { x: this.safe.x + this.safe.w / 2 + k * step, y: this.safe.y + this.safe.h / 2 + k * step };
  }

  place(o: FabricObject, { select = true }: { select?: boolean } = {}) {
    const c = this.canvas;
    if (!c || this.preview) return;
    this.dress(o);
    c.add(o);
    o.setCoords();
    if (select) {
      c.setActiveObject(o);
      this.selected = o;
    }
    c.requestRenderAll();
    this.commit();
  }

  get shortSideMm() {
    return Math.min(this.opts.trimMm.wMm, this.opts.trimMm.hMm);
  }

  /**
   * New text, sized for the product: a heading is about a tenth of the short side
   * (14 pt on a business card, ~200 pt on a roll-up), never under 6 pt.
   */
  async addText(
    kind: 'heading' | 'subheading' | 'body',
    text: string,
    style: { family?: string; bold?: boolean; italic?: boolean; charSpacing?: number; caps?: boolean; scale?: number } = {},
  ): Promise<Textbox | null> {
    // The face first: fabric measures the words once, with whatever font it has then.
    await ensureFontFamilies([style.family ?? DEFAULT_DESIGNER_FONT]);
    if (!this.canvas) return null;
    const k = (kind === 'heading' ? 0.09 : kind === 'subheading' ? 0.06 : 0.035) * (style.scale ?? 1);
    const fontMm = Math.min(Math.max(this.shortSideMm * k, kind === 'body' ? 2.2 : 3), 400);
    const width = this.safe.w * (kind === 'body' ? 0.7 : 0.85);
    const at = this.nextSpot();
    const tb = new RxTextbox(text, {
      left: at.x,
      top: at.y,
      originX: 'center',
      originY: 'center',
      width,
      fontSize: fontMm * U,
      fontFamily: style.family ?? DEFAULT_DESIGNER_FONT,
      fontWeight: (style.bold ?? kind === 'heading') ? 'bold' : 'normal',
      fontStyle: style.italic ? 'italic' : 'normal',
      charSpacing: style.charSpacing ?? 0,
      fill: INK,
      textAlign: 'center',
      strokeWidth: 0,
      lineHeight: 1.16,
    });
    if (style.caps) (tb as RxTextbox).rxCaps = true;
    tb.initDimensions();
    fitText(tb, width);
    this.place(tb);
    return tb;
  }

  /** A picture from the Uploads (or AI) panel: inside the safe box, or at a point it was dropped on. */
  async addPicture(id: string, at?: { x: number; y: number }): Promise<FabricImage | null> {
    const p = this.images.get(id);
    if (!p || !this.canvas) return null;
    const img = await FabricImage.fromURL(p.url);
    if (!this.canvas) return null;
    const box = { w: this.trim.w * 0.6, h: this.trim.h * 0.6 };
    const s = Math.min(box.w / img.width, box.h / img.height);
    const spot = at ?? this.nextSpot();
    img.set({ left: spot.x, top: spot.y, originX: 'center', originY: 'center', scaleX: s, scaleY: s, strokeWidth: 0 });
    (img as Tagged).rxImageId = id;
    this.place(img);
    return img;
  }

  /** Swap the picture in an image or a photo frame for another, keeping the place it had. */
  async replacePicture(target: FabricObject, id: string): Promise<void> {
    const c = this.canvas;
    const p = this.images.get(id);
    if (!c || !p || !c.getObjects().includes(target)) return;
    const img = await FabricImage.fromURL(p.url);
    if (!this.canvas) return;
    const w = target.getScaledWidth();
    const h = target.getScaledHeight();
    // Cover the box it replaces (a frame is filled, as Pixart fills its frames).
    const s = Math.max(w / img.width, h / img.height);
    const center = target.getCenterPoint();
    img.set({
      left: center.x,
      top: center.y,
      originX: 'center',
      originY: 'center',
      scaleX: s,
      scaleY: s,
      angle: target.angle,
      opacity: target.opacity,
      strokeWidth: 0,
    });
    // Too wide or tall for the box: crop the overflow, so it takes the box's place exactly.
    const cropW = Math.min(img.width, w / s);
    const cropH = Math.min(img.height, h / s);
    img.set({ cropX: (img.width - cropW) / 2, cropY: (img.height - cropH) / 2, width: cropW, height: cropH });
    // The same shape, made for the NEW picture (a copy of the old clip was sized in the
    // old picture's pixels: a round 1000 px logo replaced by a 4000 px photo came out a
    // circle a third of the frame).
    // A photo frame cuts its picture to its own shape (the Masks panel's oval, circle…).
    const shape = target instanceof FabricImage ? (target.clipPath ? this.shapeOf(target) : 'none') : (target as Tagged).rxSlot ? slotShape(target) : 'none';
    if (shape !== 'none') img.clipPath = this.clipShape(shape, cropW, cropH) ?? undefined;
    (img as Tagged).rxImageId = id;
    if ((target as Tagged).rxFill) (img as Tagged).rxFill = true;
    const lock = (target as Tagged).rxLock;
    if (lock === 'unlockable') (img as Tagged).rxLock = lock;
    const index = c.getObjects().indexOf(target);
    c.remove(target);
    this.dress(img);
    c.insertAt(index, img);
    img.setCoords();
    c.setActiveObject(img);
    this.selected = img;
    c.requestRenderAll();
    this.commit();
  }

  async addElement(entry: { lib: string; id: string; svg: string; paint: string }, colour?: string) {
    const o = await elementObject(entry.svg, { lib: entry.lib, id: entry.id });
    if (!this.canvas) return null;
    const side = Math.min(this.trim.w, this.trim.h) * (entry.lib === 'shape' ? 0.35 : 0.22);
    const s = side / Math.max(o.width, o.height);
    const at = this.nextSpot();
    o.set({ left: at.x, top: at.y, originX: 'center', originY: 'center', scaleX: s, scaleY: s });
    if (colour && entry.paint !== 'none') recolourElement(o, entry.paint === 'stroke' ? 'stroke' : 'fill', colour);
    // Lines and outlines keep their weight when scaled.
    const uniform = (x: FabricObject) => x.set({ strokeUniform: true });
    if (o instanceof Group) o.getObjects().forEach(uniform);
    else uniform(o);
    this.place(o);
    return o;
  }

  addQr(spec: QrSpec, colours: { fg: string; bg: string }) {
    // Never smaller than a phone reads: 15 mm, and 0.3 mm a square. A contact card has
    // far more squares than a link, and at 15 mm they were 0.2 mm (code review DSN-14).
    // Still inside the safe box: where that is too small, the check before attaching says so.
    const modules = qrPath(spec)?.size ?? 0;
    const side = Math.min(
      Math.max(QR_MIN_PRINT_MM * U, modules * QR_MIN_MODULE_MM * U, Math.min(this.trim.w, this.trim.h) * 0.24),
      Math.min(this.safe.w, this.safe.h),
    );
    const o = qrObject(spec, this.nextSpot(), side, colours);
    this.place(o);
    return o;
  }

  updateQr(o: RxQr, spec: QrSpec, colours: { fg: string; bg: string }) {
    o.set({ rxQr: spec, fill: colours.fg, rxQrBg: colours.bg, dirty: true });
    this.canvas?.requestRenderAll();
    this.commit();
  }

  /** Empty photo frame. */
  /** A photo frame (the Masks panel): round, oval, rounded or square; its picture is cut to it. */
  addSlot(shape: boolean | SlotShape, label: string) {
    const side = Math.min(this.safe.w, this.safe.h) * 0.5;
    const at = this.nextSpot();
    const stroke = Math.max(0.3, this.shortSideMm * 0.005) * U;
    const wide = shape === 'ellipse' ? Math.min(side * 1.35, this.safe.w * 0.9) : side;
    this.place(makeSlot(at.x, at.y, wide, side, shape, label, stroke, DEFAULT_DESIGNER_FONT));
  }

  // ---- the background ------------------------------------------------------------------------
  get backgroundLocked(): boolean {
    return this.opts.mode === 'customer' && (this.template as { lockBackground?: boolean } | null)?.lockBackground === true;
  }

  get backgroundColour(): string {
    const bg = this.canvas?.backgroundColor;
    return typeof bg === 'string' ? bg : '#ffffff';
  }

  get pattern(): RxPattern | null {
    return (this.canvas?.getObjects().find((o) => o instanceof RxPattern) as RxPattern | undefined) ?? null;
  }

  setBackgroundColour(colour: string, { soon = false }: { soon?: boolean } = {}) {
    const c = this.canvas;
    if (!c || this.backgroundLocked) return;
    c.backgroundColor = colour;
    c.requestRenderAll();
    this.emit();
    if (soon) this.commitSoon();
    else this.commit();
  }

  /** The pattern background: one per side, the whole board, under everything but the shop's fixed floor. */
  setPattern(spec: PatternSpec | null, { soon = false }: { soon?: boolean } = {}) {
    const c = this.canvas;
    if (!c || this.backgroundLocked) return;
    const existing = this.pattern;
    if (!spec) {
      if (existing) c.remove(existing);
    } else if (existing) {
      existing.set({ rxPattern: spec, dirty: true });
    } else {
      // Never picked up on the board: dressControls says so, here and after every load.
      const p = patternObject(this.board, spec);
      this.dress(p);
      c.insertAt(this.floorIndex(), p);
    }
    c.requestRenderAll();
    this.emit();
    if (soon) this.commitSoon();
    else this.commit();
  }

  /** The bottom of what the customer may change: above the shop's own fixed layers. */
  private floorIndex(except?: FabricObject): number {
    const objects = this.canvas?.getObjects() ?? [];
    let floor = 0;
    if (this.opts.mode === 'customer') {
      while (floor < objects.length && objects[floor] !== except && (objects[floor] as Tagged).rxLock === 'locked') floor += 1;
    }
    return floor;
  }

  /** A picture over the whole board, bleed included, at the bottom (above a pattern). */
  fillBackground(img: FabricImage) {
    const c = this.canvas;
    if (!c || this.backgroundLocked) return;
    const s = Math.max(this.board.w / img.width, this.board.h / img.height);
    img.set({ left: this.board.w / 2, top: this.board.h / 2, originX: 'center', originY: 'center', scaleX: s, scaleY: s, angle: 0 });
    (img as Tagged).rxFill = true;
    let floor = this.floorIndex(img);
    const objects = c.getObjects();
    if (objects[floor] instanceof RxPattern && objects[floor] !== img) floor += 1;
    c.moveObjectTo(img, Math.min(floor, objects.length - 1));
    img.setCoords();
    c.requestRenderAll();
    this.commit();
  }

  /**
   * A picture as large as fits, centred: inside the trim ("Fit on the page"), or, `safe`,
   * inside the safe box. Never out into the bleed: fitted to the whole board, a
   * print-ready card with no bleed of its own was enlarged by 7 %, 3 mm of it cut off
   * each side and its words left 0.2 mm from the cut (code review, second pass #1).
   * Where it ends at the cut line, the check before attaching says so; "Fill the page"
   * runs it into the bleed.
   */
  fitInside(o: FabricObject, safe = false) {
    const box = safe ? this.safe : this.trim;
    const s = Math.min(box.w / o.width, box.h / o.height);
    o.set({ scaleX: s * Math.sign(o.scaleX || 1), scaleY: s * Math.sign(o.scaleY || 1), angle: 0 });
    o.setPositionByOrigin(new Point(box.x + box.w / 2, box.y + box.h / 2), 'center', 'center');
    (o as Tagged).rxFill = false;
    o.setCoords();
    this.canvas?.requestRenderAll();
    this.commit();
  }

  // ---- the chosen object ------------------------------------------------------------------------
  get fixedSelected(): boolean {
    return isFixed(this.selected as Tagged | null, this.opts.mode);
  }

  /** A change to the chosen object's own properties (colour, opacity, style). */
  change(o: FabricObject, props: Record<string, unknown>, { soon = false }: { soon?: boolean } = {}) {
    o.set(props);
    if (isTextbox(o)) o.initDimensions();
    o.setCoords();
    this.canvas?.requestRenderAll();
    this.emit();
    if (soon) this.commitSoon();
    else this.commit();
  }

  /** New words for a text (from the sheet, or the panel): a words-only text keeps the shop's box. */
  setText(o: Textbox, text: string) {
    const t = o as Textbox & Tagged;
    // Words the shop fixed are not his to change, however they were reached.
    if (t.rxLock === 'locked' && this.opts.mode === 'customer') return;
    if (t.rxLock === 'words' && t.rxBox && this.opts.mode === 'customer') {
      o.set({ text, width: t.rxBox.w, fontSize: t.rxBox.fontSize });
      o.initDimensions();
      fitText(o, t.rxBox.w, t.rxBox.h);
    } else {
      o.set({ text });
      o.initDimensions();
    }
    o.setCoords();
    this.canvas?.requestRenderAll();
    this.emit();
    this.commitSoon();
  }

  /** A quarter turn, about its own centre (the floating bar's "Rotate"). */
  rotate90(o: FabricObject | null = this.selected) {
    if (!o || !this.canvas) return;
    if (this.opts.mode === 'customer' && (o as Tagged).rxLock) return;
    o.rotate(((o.angle || 0) + 90) % 360);
    o.setCoords();
    this.canvas.requestRenderAll();
    this.emit();
    this.commit();
  }

  /**
   * THE KEYBOARD'S TAB ON THE BOARD: the next object of this page in stacking order
   * (`dir` -1: the one before), chosen as a click chooses it. Never what the shop fixed
   * against choosing, nor the pattern background. Null when there is none that way:
   * Tab then leaves the board, and the object chosen last stays chosen.
   */
  chooseNext(dir: 1 | -1): { o: FabricObject; index: number; count: number } | null {
    const c = this.canvas;
    if (!c || this.preview || this.busy) return null;
    const list = c.getObjects().filter((o) => o.selectable !== false && o.visible !== false && !(o instanceof RxPattern));
    const at = this.selected ? list.indexOf(this.selected) : -1;
    const index = at === -1 ? (dir > 0 ? 0 : list.length - 1) : at + dir;
    const o = list[index];
    if (!o) return null;
    this.endTextEditing();
    c.setActiveObject(o);
    c.requestRenderAll();
    return { o, index, count: list.length };
  }

  remove(o: FabricObject | null = this.selected) {
    const c = this.canvas;
    if (!c || !o || isFixed(o as Tagged, this.opts.mode)) return;
    c.remove(o);
    c.discardActiveObject();
    this.selected = null;
    c.requestRenderAll();
    this.commit();
  }

  async duplicate(o: FabricObject | null = this.selected) {
    if (!o || isFixed(o as Tagged, this.opts.mode)) return;
    const copy = await o.clone(PROPS);
    const d = Math.min(this.trim.w, this.trim.h) * 0.04;
    copy.set({ left: o.left + d, top: o.top + d });
    delete (copy as Tagged).rxFill;
    this.place(copy);
  }

  /** The customer's own lock: 'unlockable' on, or off. The shop's locks are not his to change. */
  toggleLock(o: FabricObject | null = this.selected) {
    if (!o) return;
    const t = o as Tagged;
    if (this.opts.mode === 'customer' && (t.rxLock === 'locked' || t.rxLock === 'words')) return;
    if (t.rxLock === 'unlockable') {
      delete t.rxLock;
      delete t.rxOwnLock;
    } else {
      t.rxLock = 'unlockable';
      // His own lock keeps it in place; it does not make it the shop's template object,
      // which the check before attaching leaves alone (a locked photo at the cut is still his).
      if (this.opts.mode === 'customer') t.rxOwnLock = true;
    }
    if (isTextbox(o) && o.isEditing) o.exitEditing();
    this.dress(o);
    this.canvas?.requestRenderAll();
    this.commit();
  }

  /** The owner: what a customer may do with this element. */
  setLock(o: FabricObject, lock: Lock | null) {
    const t = o as Tagged;
    if (lock) t.rxLock = lock;
    else delete t.rxLock;
    if (lock === 'words' && isTextbox(o)) t.rxBox = { w: o.width, h: o.height, fontSize: o.fontSize };
    else delete t.rxBox;
    this.dress(o);
    this.canvas?.requestRenderAll();
    this.commit();
  }

  arrange(dir: 'front' | 'forward' | 'backward' | 'back', o: FabricObject | null = this.selected) {
    const c = this.canvas;
    if (!c || !o || isFixed(o as Tagged, this.opts.mode)) return;
    const objects = c.getObjects();
    const base = this.floorIndex(o);
    // Never under the shop's fixed floor, nor under the pattern background.
    const floor = objects[base] instanceof RxPattern && objects[base] !== o ? base + 1 : base;
    const index = objects.indexOf(o);
    let to = index;
    if (dir === 'front') to = objects.length - 1;
    else if (dir === 'forward') to = Math.min(objects.length - 1, index + 1);
    else if (dir === 'backward') to = Math.max(floor, index - 1);
    else to = floor;
    if (to === index) return;
    c.moveObjectTo(o, to);
    c.requestRenderAll();
    this.commit();
  }

  /** On the page: against an edge or the middle of the trim. */
  align(where: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom', o: FabricObject | null = this.selected) {
    if (!o || isFixed(o as Tagged, this.opts.mode)) return;
    const box = this.trim;
    const r = o.getBoundingRect();
    let dx = 0;
    let dy = 0;
    if (where === 'left') dx = box.x - r.left;
    if (where === 'hcenter') dx = box.x + box.w / 2 - (r.left + r.width / 2);
    if (where === 'right') dx = box.x + box.w - (r.left + r.width);
    if (where === 'top') dy = box.y - r.top;
    if (where === 'vcenter') dy = box.y + box.h / 2 - (r.top + r.height / 2);
    if (where === 'bottom') dy = box.y + box.h - (r.top + r.height);
    o.set({ left: o.left + dx, top: o.top + dy });
    o.setCoords();
    this.canvas?.requestRenderAll();
    this.commit();
  }

  /** Another typeface: its faces loaded first; bold and italic kept only where the family has them. */
  async setFontFamily(o: Textbox, family: string): Promise<boolean> {
    const { failed } = await ensureFontFamilies([family]);
    if (failed.includes(family) || !this.canvas) return false;
    const info = fontFamilyInfo(family);
    const props: Record<string, unknown> = { fontFamily: family };
    if (!info?.bold && o.fontWeight === 'bold') props.fontWeight = 'normal';
    if (!info?.italic && o.fontStyle === 'italic') props.fontStyle = 'normal';
    const t = o as Textbox & Tagged;
    o.set(props);
    o.initDimensions();
    if (t.rxLock === 'words' && t.rxBox && this.opts.mode === 'customer') fitText(o, t.rxBox.w, t.rxBox.h);
    o.setCoords();
    this.canvas.requestRenderAll();
    this.emit();
    this.commit();
    return true;
  }

  /** A text's size in points, as printed. */
  ptOf(o: Textbox): number {
    return Math.round(((o.fontSize * Math.abs(o.scaleY || 1)) / U) * PT_PER_MM * 10) / 10;
  }

  setPt(o: Textbox, pt: number, { soon = true }: { soon?: boolean } = {}) {
    const clamped = Math.min(2000, Math.max(4, pt));
    this.change(o, { fontSize: ((clamped / PT_PER_MM) * U) / Math.abs(o.scaleY || 1) }, { soon });
  }

  /** An object's own width and height on the page, mm (as drawn, before any turn). */
  sizeMmOf(o: FabricObject): { w: number; h: number } {
    return { w: (o.width * Math.abs(o.scaleX || 1)) / U, h: (o.height * Math.abs(o.scaleY || 1)) / U };
  }

  /**
   * A size typed in mm (the toolbar's W × H), one side at a time, about the object's
   * centre, as one undo step. `keepRatio`: the other side follows. Kept between 1 mm
   * and twice the board's longer side, never moved the other way (designSize.ts
   * typedSizeMm). A line has no height of its own: only its length is sized, and its
   * other scale is left as it is. A size that comes out unchanged is no step at all.
   */
  setSizeMm(o: FabricObject, side: 'w' | 'h', mm: number, keepRatio: boolean) {
    const along = side === 'w' ? o.width : o.height;
    // The pattern background covers the board: it has no size of its own to type.
    if (!this.canvas || isFixed(o as Tagged, this.opts.mode) || o instanceof RxPattern || !(along > 0) || !(mm > 0)) return;
    const now = this.sizeMmOf(o);
    const { w, h } = typedSizeMm(now, side, mm, keepRatio, { min: 1, max: (2 * Math.max(this.board.w, this.board.h)) / U });
    if (Math.abs(w - now.w) < 1e-9 && Math.abs(h - now.h) < 1e-9) return;
    const centre = o.getCenterPoint();
    if (o.width > 0) o.set({ scaleX: ((w * U) / o.width) * Math.sign(o.scaleX || 1) });
    if (o.height > 0) o.set({ scaleY: ((h * U) / o.height) * Math.sign(o.scaleY || 1) });
    o.setPositionByOrigin(centre, 'center', 'center');
    o.setCoords();
    // Made smaller than the board, a background picture is just a picture again.
    const t = o as Tagged;
    if (t.rxFill) {
      const r = o.getBoundingRect();
      if (r.left > 0.5 || r.top > 0.5 || r.left + r.width < this.board.w - 0.5 || r.top + r.height < this.board.h - 0.5) t.rxFill = false;
    }
    this.canvas.requestRenderAll();
    this.emit();
    this.commit();
  }

  /** How sharp a picture prints where it is now (its own pixels over its printed width). */
  dpiOf(o: FabricImage): number {
    return effectiveDpi(o.width, o.getScaledWidth() / U);
  }

  /** The topmost object under a board point (a drop onto a photo frame fills it). */
  objectAt(p: { x: number; y: number }): FabricObject | null {
    const objects = this.canvas?.getObjects() ?? [];
    for (let i = objects.length - 1; i >= 0; i -= 1) {
      const o = objects[i];
      if (o instanceof RxPattern || !o.visible) continue;
      if (o.containsPoint(new Point(p.x, p.y))) return o;
    }
    return null;
  }

  // ---- pictures ------------------------------------------------------------------------------------
  flip(o: FabricObject, axis: 'x' | 'y') {
    if (axis === 'x') this.change(o, { flipX: !o.flipX });
    else this.change(o, { flipY: !o.flipY });
  }

  /**
   * Crop a picture to a part of its ORIGINAL pixels (x, y, w, h). What is kept stays
   * exactly where it was on the page, at the same scale: only the edges move in.
   */
  crop(o: FabricImage, rect: { x: number; y: number; w: number; h: number }) {
    const el = o.getElement() as HTMLImageElement | HTMLCanvasElement;
    const natW = (el as HTMLImageElement).naturalWidth || el.width;
    const natH = (el as HTMLImageElement).naturalHeight || el.height;
    const x = Math.max(0, Math.min(natW - 1, rect.x));
    const y = Math.max(0, Math.min(natH - 1, rect.y));
    const w = Math.max(1, Math.min(natW - x, rect.w));
    const h = Math.max(1, Math.min(natH - y, rect.h));
    // The centre of the new crop, from the centre of the old one, in source pixels…
    let dx = x + w / 2 - ((o.cropX || 0) + o.width / 2);
    let dy = y + h / 2 - ((o.cropY || 0) + o.height / 2);
    if (o.flipX) dx = -dx;
    if (o.flipY) dy = -dy;
    // …then on the page: scaled and turned with the picture.
    const a = (o.angle * Math.PI) / 180;
    const sx = dx * Math.abs(o.scaleX);
    const sy = dy * Math.abs(o.scaleY);
    const c = o.getCenterPoint();
    const centre = new Point(c.x + sx * Math.cos(a) - sy * Math.sin(a), c.y + sx * Math.sin(a) + sy * Math.cos(a));
    o.set({ cropX: x, cropY: y, width: w, height: h });
    o.setPositionByOrigin(centre, 'center', 'center');
    if (o.clipPath) o.clipPath = this.clipShape(this.shapeOf(o), w, h) ?? undefined;
    (o as Tagged).rxFill = false;
    o.set('dirty', true);
    o.setCoords();
    this.canvas?.requestRenderAll();
    this.commit();
  }

  /** The shape a picture is cut to: none, rounded corners, a circle or an oval. */
  shapeOf(o: FabricObject): 'none' | 'rounded' | 'circle' | 'ellipse' {
    const clip = o.clipPath;
    if (!clip) return 'none';
    if (clip instanceof Circle) return 'circle';
    if (clip instanceof Ellipse) return 'ellipse';
    return 'rounded';
  }

  private clipShape(kind: 'none' | 'rounded' | 'circle' | 'ellipse', w: number, h: number): FabricObject | null {
    const common = { left: 0, top: 0, originX: 'center' as const, originY: 'center' as const, strokeWidth: 0 };
    if (kind === 'circle') return new Circle({ ...common, radius: Math.min(w, h) / 2 });
    if (kind === 'ellipse') return new Ellipse({ ...common, rx: w / 2, ry: h / 2 });
    if (kind === 'rounded') {
      const r = Math.min(w, h) * 0.12;
      return new Rect({ ...common, width: w, height: h, rx: r, ry: r });
    }
    return null;
  }

  setShape(o: FabricImage, kind: 'none' | 'rounded' | 'circle' | 'ellipse') {
    o.clipPath = this.clipShape(kind, o.width, o.height) ?? undefined;
    o.set('dirty', true);
    this.canvas?.requestRenderAll();
    this.emit();
    this.commit();
  }

  /** The picture's original, before any colour edit: the edit is always made from it. */
  private originalOf(o: FabricImage): { id: string; picture: Picture } | null {
    const t = o as Tagged;
    const id = t.rxOrigId ?? t.rxImageId;
    const picture = id ? this.images.get(id) : undefined;
    return id && picture ? { id, picture } : null;
  }

  private adjustWork: { o: FabricImage; source: ImageBitmap; canvas: HTMLCanvasElement } | null = null;
  // The source being made for a picture, and which slider frame may draw when it is ready.
  private adjustLoading: { o: FabricImage; ready: Promise<boolean> } | null = null;
  private adjustTicket = 0;

  /**
   * Colour edits shown live: drawn from the original into a canvas of the same pixel
   * size, swapped in as the picture's element (so its crop and size stay), never
   * saved until applyAdjust.
   */
  async previewAdjust(o: FabricImage, adjust: { hue: number; sat: number; bright: number }) {
    const orig = this.originalOf(o);
    if (!orig) return;
    const ticket = (this.adjustTicket += 1);
    if (!this.adjustWork || this.adjustWork.o !== o) {
      // ONE source per picture, made once. Every slider frame during the first wait
      // used to make its own full-size bitmap and canvas (about 48 MB each for a 12 MP
      // photo), and only the last was ever freed — enough to exhaust a phone.
      if (this.adjustLoading?.o !== o) {
        this.endAdjust();
        const loading = {
          o,
          ready: createImageBitmap(orig.picture.blob).then(
            (source) => {
              // Past what one canvas holds on a phone it would show EMPTY: no live preview
              // then (adjustPicture refuses the edit itself, and the picture is kept).
              if (this.adjustLoading !== loading || this.disposed || pictureScale(source.width, source.height) < 1) {
                source.close();
                return false;
              }
              const canvas = document.createElement('canvas');
              canvas.width = source.width;
              canvas.height = source.height;
              this.adjustWork = { o, source, canvas };
              this.adjustLoading = null;
              return true;
            },
            () => false,
          ),
        };
        this.adjustLoading = loading;
      }
      const ready = await this.adjustLoading!.ready;
      // Only the latest frame draws once it is ready; the ones before it are spent.
      if (!ready || ticket !== this.adjustTicket || !this.adjustWork || this.adjustWork.o !== o) return;
    }
    const { source, canvas } = this.adjustWork;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const css = `hue-rotate(${adjust.hue}deg) saturate(${100 + adjust.sat}%) brightness(${100 + adjust.bright}%)`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = css;
    if (ctx.filter === css) {
      ctx.drawImage(source, 0, 0);
      ctx.filter = 'none';
    } else {
      ctx.filter = 'none';
      ctx.drawImage(source, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      adjustPixels(data.data, adjust);
      ctx.putImageData(data, 0, 0);
    }
    o.setElement(canvas, { width: o.width, height: o.height });
    o.set('dirty', true);
    this.canvas?.requestRenderAll();
  }

  private endAdjust() {
    this.adjustLoading = null;
    if (!this.adjustWork) return;
    this.adjustWork.source.close();
    this.adjustWork.canvas.width = 0;
    this.adjustWork.canvas.height = 0;
    this.adjustWork = null;
  }

  /** Put back the picture the object names (the live preview was not kept). */
  async cancelAdjust(o: FabricImage) {
    const id = (o as Tagged).rxImageId;
    const p = id ? this.images.get(id) : undefined;
    if (p) {
      const img = await util.loadImage(p.url);
      o.setElement(img, { width: o.width, height: o.height });
      o.set('dirty', true);
      this.canvas?.requestRenderAll();
    }
    this.endAdjust();
  }

  /** Keep the colour edit: a new picture made from the original, which is kept beside it. */
  async applyAdjust(o: FabricImage, adjust: { hue: number; sat: number; bright: number }) {
    const orig = this.originalOf(o);
    if (!orig) return;
    const t = o as Tagged;
    const none = adjust.hue === 0 && adjust.sat === 0 && adjust.bright === 0;
    let id = orig.id;
    // The preview's full-size source goes before the full-size edit is made (its canvas
    // stays on the board until the edit replaces it, then goes too — endAdjust below).
    this.adjustLoading = null;
    this.adjustWork?.source.close();
    if (!none) {
      const blob = await adjustPicture(orig.picture.blob, adjust);
      id = newImageId();
      this.images.set(id, { blob, url: URL.createObjectURL(blob), width: orig.picture.width, height: orig.picture.height });
    }
    const p = this.images.get(id)!;
    const img = await util.loadImage(p.url);
    o.setElement(img, { width: o.width, height: o.height });
    t.rxImageId = id;
    if (none) {
      delete t.rxOrigId;
      delete t.rxAdjust;
    } else {
      t.rxOrigId = orig.id;
      t.rxAdjust = { ...adjust };
    }
    o.set('dirty', true);
    this.endAdjust();
    this.canvas?.requestRenderAll();
    this.commit();
  }

  // ---- the design for print ----------------------------------------------------------------------
  /**
   * Every printed side, as fabric JSON with each picture's address filled in and the
   * empty photo frames taken out — what the print file is drawn from.
   */
  printScenes({ flush = true }: { flush?: boolean } = {}): Array<{ id: SideId; json: Record<string, unknown>; emptySlots: number; inked: boolean }> {
    // A page's picture only (the pages column) must not end the words being typed.
    if (flush) this.flushPending();
    const out: Array<{ id: SideId; json: Record<string, unknown>; emptySlots: number; inked: boolean }> = [];
    for (const id of this.opts.sides) {
      const data = JSON.parse(sideJson(this.doc, id) ?? BLANK_SIDE_JSON) as { version?: string; background?: string; objects: Array<Record<string, unknown>> };
      const emptySlots = data.objects.filter((o) => o.rxSlot).length;
      const objects = data.objects
        .filter((o) => !o.rxSlot)
        .map((o) => {
          if (String(o.type).toLowerCase() !== 'image') return o;
          const p = this.images.get(String(o.rxImageId ?? ''));
          return { ...o, src: p?.url ?? '' };
        });
      const inked = inkColour(data.background) || objects.some(objectLeavesInk);
      out.push({ id, json: { version: data.version, background: data.background ?? '#ffffff', objects }, emptySlots, inked });
    }
    return out;
  }

  /** The lowest resolution any picture prints at, on every printed side; null with none. */
  lowestPictureDpi(): number | null {
    let low: number | null = null;
    for (const id of this.opts.sides) {
      const data = JSON.parse(sideJson(this.doc, id) ?? BLANK_SIDE_JSON) as { objects: Array<Record<string, unknown>> };
      for (const o of data.objects) {
        if (String(o.type).toLowerCase() !== 'image') continue;
        const w = Number(o.width) || 0;
        const shown = (w * Math.abs(Number(o.scaleX) || 1)) / U;
        const dpi = effectiveDpi(w, shown);
        if (dpi > 0 && (low === null || dpi < low)) low = dpi;
      }
    }
    return low;
  }

  /** Is any text, on any printed side, past the safe line (so the cutter, or the stand, could take part of it)? */
  textNearEdge(): SideId[] {
    const sides: SideId[] = [];
    const tol = 0.5 * U;
    const box = this.safe;
    const round = this.opts.outline === 'circle' || this.opts.outline === 'ellipse';
    const cx = this.trim.x + this.trim.w / 2;
    const cy = this.trim.y + this.trim.h / 2;
    const shortSide = Math.min(this.trim.w, this.trim.h);
    const rx = (this.opts.outline === 'circle' ? shortSide : this.trim.w) / 2 - this.opts.spec.safeMm * U + tol;
    const ry = (this.opts.outline === 'circle' ? shortSide : this.trim.h) / 2 - this.opts.spec.safeMm * U + tol;
    for (const id of this.opts.sides) {
      const data = JSON.parse(sideJson(this.doc, id) ?? BLANK_SIDE_JSON) as { objects: Array<Record<string, unknown>> };
      const near = data.objects.some((o) => {
        if (String(o.type).toLowerCase() !== 'textbox' || !String(o.text ?? '').trim()) return false;
        return cornersOf(o).some((p) =>
          round
            ? ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 > 1
            : p.x < box.x - tol || p.y < box.y - tol || p.x > box.x + box.w + tol || p.y > box.y + box.h + tol,
        );
      });
      if (near) sides.push(id);
    }
    return sides;
  }

  /** The printed sides with something that ends right at the cut line (±1 mm), where a cut a hair off shows. */
  edgeAtCutSides(): SideId[] {
    return this.opts.sides.filter((id) => {
      const data = JSON.parse(sideJson(this.doc, id) ?? BLANK_SIDE_JSON) as { objects?: Array<Record<string, unknown>> };
      return edgesAtCut(Array.isArray(data.objects) ? data.objects : [], this.trim, U, this.opts.outline) > 0;
    });
  }

  /** The printed sides with a QR code a phone may not read: squares under 0.3 mm, or too little contrast. */
  weakQrSides(): SideId[] {
    return this.opts.sides.filter((id) => {
      const data = JSON.parse(sideJson(this.doc, id) ?? BLANK_SIDE_JSON) as { background?: unknown; objects?: Array<Record<string, unknown>> };
      return weakQrCodes(Array.isArray(data.objects) ? data.objects : [], data.background, U) > 0;
    });
  }

  /** Words on a side that read nothing printable (no ink at all): a back left empty. */
  blankSides(): SideId[] {
    return this.printScenes().filter((s) => !s.inked).map((s) => s.id);
  }
}
