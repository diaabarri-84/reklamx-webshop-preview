/**
 * THE SHOP'S OWN READY-MADE DESIGNS — designer v2's gallery (the "179 designs"
 * Pixartprinting opens its Designer on).
 *
 * Not files: DESIGNS IN CODE. Each starter is a function of the product — its exact
 * trim, bleed, cut, safe area and hidden zones (src/lib/printSpec.ts) — of the
 * customer's language (the sample words) and of a colour variant. So a business-card
 * design fits 85 × 55, 90 × 50 and 55 × 85 exactly; a roll-up design keeps its words
 * out of the foot that disappears into the cassette; nothing is ever stretched, and
 * nothing is downloaded or read from the database (a gallery that costs no Firestore
 * read and survives a quota outage). Our own geometry and words: nothing here is
 * taken from anyone else's templates.
 *
 * Each design is fabric JSON for the studio (src/components/product/designer/studio),
 * every side through the shop's allowlist (src/lib/designSchema.ts) in
 * scripts/test-starter-templates.mjs. Text sizes are estimated from each typeface's
 * average letter width so a sample name sits on one line; the customer's own words
 * may be longer, and wrap, as in any editor.
 *
 * Pure (no fabric, no DOM).
 */
import { safeBox } from './designTemplates.js';
import { qrPayload } from './qrPayload.js';
import type { OutlineKind } from './shapes.js';
import type { ProductKind, Margins } from './printSpec.js';
import type { SideId } from './printSides.js';

const U = 10;
const VERSION = '7.4.0';

export type StarterUse = 'contact' | 'promotion' | 'event' | 'label';
export type StarterStyle = 'minimal' | 'classic' | 'modern' | 'bold' | 'elegant' | 'playful';
export type StarterIndustry = 'general' | 'business' | 'creative' | 'food' | 'beauty' | 'construction' | 'health' | 'events';

export interface StarterWords {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  web: string;
  address: string;
  headline: string;
  sub: string;
  body: string;
  day: string;
  month: string;
  place: string;
  offer: string;
  sale: string;
  cta: string;
  slogan: string;
  photoHere: string;
}

export interface Palette {
  id: string;
  /** Page background. */
  bg: string;
  /** Text. */
  ink: string;
  /** Quiet text. */
  muted: string;
  accent: string;
  accent2: string;
  /** Text on the accent. */
  onAccent: string;
}

export interface StarterContext {
  trimMm: { wMm: number; hMm: number };
  bleedMm: number;
  outline: OutlineKind | null;
  safeMm: number;
  hiddenMm: Margins;
  /** The pages the product prints. */
  sides: SideId[];
  words: StarterWords;
}

/** mm, in TRIM coordinates (0, 0 = the trim's top-left corner). */
interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Build {
  trim: { w: number; h: number };
  b: number;
  /** Where words go: inside the cut by the safe margin, out of the hidden zones. */
  safe: Frame;
  orient: 'landscape' | 'portrait' | 'square';
  short: number;
  w: StarterWords;
  p: Palette;
  outline: OutlineKind | null;
}

type Obj = Record<string, unknown>;
interface SideOut {
  background: string;
  objects: Obj[];
}

export interface StarterDef {
  id: string;
  /** English, for the owner's dashboard; customers see `labelKey`. */
  name: string;
  labelKey: string;
  use: StarterUse;
  styles: StarterStyle[];
  industries: StarterIndustry[];
  kinds: ProductKind[];
  palettes: Palette[];
  front: (b: Build) => SideOut;
  back?: (b: Build) => SideOut;
}

// ---- the parts ---------------------------------------------------------------------------

/** Average advance of a letter, in ems, per family and weight — for sizing words to a box. */
const ADVANCE: Record<string, { normal: number; bold: number }> = {
  'RX Inter': { normal: 0.56, bold: 0.6 },
  'RX Montserrat': { normal: 0.63, bold: 0.68 },
  'RX Playfair Display': { normal: 0.52, bold: 0.56 },
  'RX Anton': { normal: 0.46, bold: 0.46 },
  'RX Dancing Script': { normal: 0.43, bold: 0.45 },
};

interface TextOpts {
  size: number;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  colour: string;
  align?: 'left' | 'center' | 'right';
  spacing?: number;
  lineHeight?: number;
  caps?: boolean;
  /** Shrink to keep the longest line on one line inside the box. */
  fit?: boolean;
}

/** The largest size, up to `size`, at which the longest line fits `width` (mm). */
function fitSize(text: string, width: number, o: TextOpts): number {
  const font = o.font ?? 'RX Inter';
  const adv = ADVANCE[font] ?? ADVANCE['RX Inter'];
  const em = (o.bold ? adv.bold : adv.normal) * (o.caps ? 1.12 : 1) + (o.spacing ?? 0) / 1000;
  const longest = Math.max(1, ...text.split('\n').map((l) => l.length));
  return Math.max(1.2, Math.min(o.size, (width * 0.97) / (longest * em)));
}

function text(b: Build, t: string, f: Frame, o: TextOpts): Obj {
  const size = o.fit === false ? o.size : fitSize(t, f.w, o);
  const align = o.align ?? 'left';
  return {
    type: 'Textbox',
    version: VERSION,
    originX: 'center',
    originY: 'center',
    left: (b.b + f.x + f.w / 2) * U,
    top: (b.b + f.y + f.h / 2) * U,
    width: f.w * U,
    text: t,
    fontSize: size * U,
    fontFamily: o.font ?? 'RX Inter',
    fontWeight: o.bold ? 'bold' : 'normal',
    fontStyle: o.italic ? 'italic' : 'normal',
    fill: o.colour,
    textAlign: align,
    lineHeight: o.lineHeight ?? 1.18,
    charSpacing: o.spacing ?? 0,
    strokeWidth: 0,
    ...(o.caps ? { rxCaps: true } : {}),
  };
}

function rect(b: Build, f: Frame, colour: string, extra: Obj = {}): Obj {
  return {
    type: 'Rect',
    version: VERSION,
    originX: 'center',
    originY: 'center',
    left: (b.b + f.x + f.w / 2) * U,
    top: (b.b + f.y + f.h / 2) * U,
    width: f.w * U,
    height: f.h * U,
    fill: colour,
    strokeWidth: 0,
    rxLock: 'unlockable',
    ...extra,
  };
}

function circle(b: Build, cx: number, cy: number, r: number, colour: string, extra: Obj = {}): Obj {
  return {
    type: 'Circle',
    version: VERSION,
    originX: 'center',
    originY: 'center',
    left: (b.b + cx) * U,
    top: (b.b + cy) * U,
    radius: r * U,
    width: 2 * r * U,
    height: 2 * r * U,
    fill: colour,
    strokeWidth: 0,
    rxLock: 'unlockable',
    ...extra,
  };
}

/** A polygon from trim-mm points; fabric centres it on its own points' box. */
function polygon(b: Build, pts: Array<[number, number]>, colour: string): Obj {
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = Math.max(...xs) - minX;
  const h = Math.max(...ys) - minY;
  return {
    type: 'Polygon',
    version: VERSION,
    originX: 'center',
    originY: 'center',
    left: (b.b + minX + w / 2) * U,
    top: (b.b + minY + h / 2) * U,
    width: w * U,
    height: h * U,
    points: pts.map(([x, y]) => ({ x: (x - minX) * U, y: (y - minY) * U })),
    fill: colour,
    strokeWidth: 0,
    rxLock: 'unlockable',
  };
}

/** A many-pointed burst for an offer, centred at (cx, cy), radius r (mm). */
function burst(b: Build, cx: number, cy: number, r: number, colour: string, spikes = 18): Obj {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.84;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return polygon(b, pts, colour);
}

/** An empty photo frame (the studio's rxSlot): drop a picture into it. */
function slot(b: Build, f: Frame, round: boolean): Obj {
  const w = f.w * U;
  const h = f.h * U;
  const stroke = Math.max(0.3, b.short * 0.005) * U;
  const frame = round
    ? { type: 'Circle', version: VERSION, originX: 'center', originY: 'center', left: 0, top: 0, radius: Math.min(w, h) / 2, width: Math.min(w, h), height: Math.min(w, h) }
    : { type: 'Rect', version: VERSION, originX: 'center', originY: 'center', left: 0, top: 0, width: w, height: h };
  const inner = round ? Math.min(w, h) * 0.66 : w * 0.82;
  const labelSize = Math.max(12, Math.min(w, h) * 0.1);
  return {
    type: 'Group',
    version: VERSION,
    originX: 'center',
    originY: 'center',
    left: (b.b + f.x + f.w / 2) * U,
    top: (b.b + f.y + f.h / 2) * U,
    width: round ? Math.min(w, h) : w,
    height: round ? Math.min(w, h) : h,
    subTargetCheck: false,
    interactive: false,
    rxSlot: true,
    objects: [
      { ...frame, fill: '#eef0f4', stroke: '#9ca3af', strokeWidth: stroke, strokeDashArray: [stroke * 4, stroke * 3] },
      {
        type: 'Textbox',
        version: VERSION,
        originX: 'center',
        originY: 'center',
        left: 0,
        top: 0,
        width: inner,
        text: b.w.photoHere,
        fontSize: labelSize,
        fontFamily: 'RX Inter',
        fill: '#6b7280',
        textAlign: 'center',
        strokeWidth: 0,
      },
    ],
  };
}

function qr(b: Build, f: Frame, payload: string, fg: string, bg: string): Obj {
  const side = Math.min(f.w, f.h);
  return {
    type: 'RxQr',
    version: VERSION,
    originX: 'center',
    originY: 'center',
    left: (b.b + f.x + f.w / 2) * U,
    top: (b.b + f.y + f.h / 2) * U,
    width: side * U,
    height: side * U,
    fill: fg,
    rxQrBg: bg,
    rxQr: { text: payload.slice(0, 600), ecc: 'M' },
    strokeWidth: 0,
  };
}

function pattern(b: Build, id: string, colours: [string, string], scaleMm: number): Obj {
  return {
    type: 'RxPattern',
    version: VERSION,
    originX: 'left',
    originY: 'top',
    left: 0,
    top: 0,
    width: (b.trim.w + 2 * b.b) * U,
    height: (b.trim.h + 2 * b.b) * U,
    fill: colours[0],
    strokeWidth: 0,
    rxPattern: { id, colours, scaleMm: Math.min(400, Math.max(2, scaleMm)) },
    rxLock: 'unlockable',
  };
}

/** The whole board, bleed included. */
const fullBleed = (b: Build): Frame => ({ x: -b.b, y: -b.b, w: b.trim.w + 2 * b.b, h: b.trim.h + 2 * b.b });

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() ?? '')
    .join('');

const contactLines = (w: StarterWords, withAddress = false) => [w.phone, w.email, w.web, ...(withAddress ? [w.address] : [])].join('\n');

// ---- palettes --------------------------------------------------------------------------------

const LIGHT: Palette[] = [
  { id: 'navy', bg: '#ffffff', ink: '#1d1d1b', muted: '#575756', accent: '#2d2e83', accent2: '#009fe3', onAccent: '#ffffff' },
  { id: 'red', bg: '#ffffff', ink: '#1d1d1b', muted: '#575756', accent: '#e30613', accent2: '#f39200', onAccent: '#ffffff' },
  { id: 'green', bg: '#ffffff', ink: '#1d1d1b', muted: '#575756', accent: '#008d36', accent2: '#95c11f', onAccent: '#ffffff' },
  { id: 'black', bg: '#ffffff', ink: '#1d1d1b', muted: '#575756', accent: '#1d1d1b', accent2: '#c8a46e', onAccent: '#ffffff' },
];
const WARM: Palette[] = [
  { id: 'sand', bg: '#f6f1ea', ink: '#3c3c3b', muted: '#706f6f', accent: '#c8a46e', accent2: '#3c3c3b', onAccent: '#ffffff' },
  { id: 'rose', bg: '#fdf2f4', ink: '#3c3c3b', muted: '#706f6f', accent: '#e6007e', accent2: '#951b81', onAccent: '#ffffff' },
  { id: 'teal', bg: '#eef8f8', ink: '#1d1d1b', muted: '#575756', accent: '#00a19a', accent2: '#1d71b8', onAccent: '#ffffff' },
  { id: 'sun', bg: '#fffbea', ink: '#1d1d1b', muted: '#575756', accent: '#fbba00', accent2: '#e6332a', onAccent: '#1d1d1b' },
];
const DARK: Palette[] = [
  { id: 'gold', bg: '#1d1d1b', ink: '#f6f1ea', muted: '#c6c6c6', accent: '#c8a46e', accent2: '#c8a46e', onAccent: '#1d1d1b' },
  { id: 'night', bg: '#2d2e83', ink: '#ffffff', muted: '#dadada', accent: '#ededed', accent2: '#009fe3', onAccent: '#2d2e83' },
  { id: 'forest', bg: '#0b3d2e', ink: '#f6f1ea', muted: '#c6c6c6', accent: '#c8a46e', accent2: '#95c11f', onAccent: '#0b3d2e' },
  { id: 'wine', bg: '#5b1a2a', ink: '#fdf2f4', muted: '#dadada', accent: '#f3d9a4', accent2: '#f3d9a4', onAccent: '#5b1a2a' },
];

// ---- the designs ---------------------------------------------------------------------------------

const CARD: ProductKind[] = ['card'];
const PRINTS: ProductKind[] = ['print', 'poster', 'rollup', 'banner', 'flag', 'sign'];
const LABELS: ProductKind[] = ['sticker'];

/** Contact text block (name, title) at a frame; returns the objects and where they end. */
function nameBlock(b: Build, f: Frame, align: 'left' | 'center' | 'right', o: { font?: string; nameColour?: string; titleColour?: string; caps?: boolean } = {}) {
  const nameSize = Math.min(f.h * 0.42, b.short * 0.12);
  const titleSize = nameSize * 0.55;
  const nameFrame: Frame = { x: f.x, y: f.y, w: f.w, h: nameSize * 1.3 };
  const titleFrame: Frame = { x: f.x, y: f.y + nameSize * 1.35, w: f.w, h: titleSize * 1.4 };
  return {
    objects: [
      text(b, b.w.name, nameFrame, { size: nameSize, font: o.font ?? 'RX Montserrat', bold: true, colour: o.nameColour ?? b.p.ink, align }),
      text(b, b.w.title, titleFrame, { size: titleSize, font: 'RX Inter', colour: o.titleColour ?? b.p.muted, align, caps: o.caps, spacing: o.caps ? 80 : 0 }),
    ],
    bottom: titleFrame.y + titleFrame.h,
  };
}

const STARTERS: StarterDef[] = [
  {
    id: 'starter-classic',
    name: 'Classic',
    labelKey: 'stTplClassic',
    use: 'contact',
    styles: ['classic', 'minimal'],
    industries: ['general', 'business', 'construction'],
    kinds: CARD,
    palettes: LIGHT,
    front: (b) => {
      const { safe: s } = b;
      const top = nameBlock(b, { x: s.x, y: s.y, w: s.w * (b.orient === 'portrait' ? 1 : 0.78), h: s.h * 0.34 }, 'left');
      const bar = rect(b, { x: s.x, y: top.bottom + s.h * 0.04, w: Math.max(4, s.w * 0.12), h: Math.max(0.6, b.short * 0.012) }, b.p.accent);
      const cSize = Math.min(b.short * 0.052, s.h * 0.09);
      const lines = contactLines(b.w);
      const block: Frame = { x: s.x, y: s.y + s.h - cSize * 1.3 * 3, w: s.w * (b.orient === 'portrait' ? 1 : 0.62), h: cSize * 1.3 * 3 };
      const company = b.orient === 'portrait'
        ? text(b, b.w.company, { x: s.x, y: block.y - cSize * 2.6, w: s.w, h: cSize * 2 }, { size: cSize * 1.25, font: 'RX Montserrat', bold: true, colour: b.p.accent })
        : text(b, b.w.company, { x: s.x + s.w * 0.55, y: s.y + s.h - cSize * 2, w: s.w * 0.45, h: cSize * 2 }, { size: cSize * 1.25, font: 'RX Montserrat', bold: true, colour: b.p.accent, align: 'right' });
      return { background: b.p.bg, objects: [...top.objects, bar, text(b, lines, block, { size: cSize, colour: b.p.ink, lineHeight: 1.3 }), company] };
    },
    back: (b) => {
      const { safe: s } = b;
      const big = Math.min(s.h * 0.24, b.short * 0.15);
      return {
        background: b.p.accent,
        objects: [
          text(b, b.w.company, { x: s.x, y: s.y + s.h * 0.3, w: s.w, h: big * 1.4 }, { size: big, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center' }),
          text(b, b.w.web, { x: s.x, y: s.y + s.h * 0.3 + big * 1.6, w: s.w, h: big * 0.8 }, { size: big * 0.42, colour: b.p.onAccent, align: 'center', spacing: 40 }),
        ],
      };
    },
  },
  {
    id: 'starter-band',
    name: 'Side band',
    labelKey: 'stTplBand',
    use: 'contact',
    styles: ['modern', 'bold'],
    industries: ['general', 'business', 'creative', 'construction'],
    kinds: CARD,
    palettes: LIGHT,
    front: (b) => {
      const { safe: s, trim: t } = b;
      const objects: Obj[] = [];
      let textFrame: Frame;
      if (b.orient === 'portrait') {
        const bandH = t.h * 0.34;
        objects.push(rect(b, { x: -b.b, y: -b.b, w: t.w + 2 * b.b, h: bandH + b.b }, b.p.accent));
        const mono = Math.min(bandH * 0.5, t.w * 0.4);
        objects.push(text(b, initials(b.w.company), { x: s.x, y: Math.max(s.y, (bandH - mono * 1.2) / 2), w: s.w, h: mono * 1.2 }, { size: mono, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center', spacing: 60 }));
        textFrame = { x: s.x, y: bandH + s.h * 0.08, w: s.w, h: s.y + s.h - bandH - s.h * 0.08 };
      } else {
        const bandW = t.w * 0.34;
        objects.push(rect(b, { x: -b.b, y: -b.b, w: bandW + b.b, h: t.h + 2 * b.b }, b.p.accent));
        const mono = Math.min(bandW * 0.42, t.h * 0.32);
        objects.push(text(b, initials(b.w.company), { x: Math.max(s.x, 0), y: t.h / 2 - mono * 0.65, w: bandW - Math.max(s.x, 0) * 2, h: mono * 1.3 }, { size: mono, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center', spacing: 60 }));
        textFrame = { x: bandW + t.w * 0.06, y: s.y, w: s.x + s.w - bandW - t.w * 0.06, h: s.h };
      }
      const nb = nameBlock(b, { x: textFrame.x, y: textFrame.y + textFrame.h * 0.08, w: textFrame.w, h: textFrame.h * 0.42 }, 'left');
      const cSize = Math.min(b.short * 0.05, textFrame.h * 0.085);
      objects.push(...nb.objects);
      objects.push(rect(b, { x: textFrame.x, y: nb.bottom + textFrame.h * 0.04, w: textFrame.w * 0.85, h: Math.max(0.3, b.short * 0.005) }, b.p.accent2));
      objects.push(text(b, contactLines(b.w), { x: textFrame.x, y: textFrame.y + textFrame.h - cSize * 1.3 * 3, w: textFrame.w, h: cSize * 1.3 * 3 }, { size: cSize, colour: b.p.ink, lineHeight: 1.3 }));
      return { background: b.p.bg, objects };
    },
    back: (b) => {
      const { safe: s } = b;
      const big = Math.min(s.h * 0.22, b.short * 0.14);
      return {
        background: b.p.accent,
        objects: [
          rect(b, { x: s.x + s.w * 0.3, y: s.y + s.h * 0.62, w: s.w * 0.4, h: Math.max(0.4, b.short * 0.008) }, b.p.accent2),
          text(b, b.w.company, { x: s.x, y: s.y + s.h * 0.3, w: s.w, h: big * 1.4 }, { size: big, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center' }),
          text(b, b.w.slogan, { x: s.x, y: s.y + s.h * 0.68, w: s.w, h: big * 0.8 }, { size: big * 0.4, colour: b.p.onAccent, align: 'center', italic: true }),
        ],
      };
    },
  },
  {
    id: 'starter-centred',
    name: 'Centred',
    labelKey: 'stTplCentred',
    use: 'contact',
    styles: ['minimal', 'elegant'],
    industries: ['general', 'beauty', 'health', 'creative'],
    kinds: [...CARD, ...LABELS],
    palettes: WARM,
    front: (b) => {
      const { safe: s } = b;
      const nameSize = Math.min(s.h * 0.17, b.short * 0.12);
      const cy = s.y + s.h * 0.42;
      const rule = Math.max(0.3, b.short * 0.005);
      const cSize = Math.min(b.short * 0.045, s.h * 0.08);
      return {
        background: b.p.bg,
        objects: [
          text(b, b.w.company, { x: s.x, y: s.y, w: s.w, h: cSize * 1.6 }, { size: cSize, colour: b.p.accent, align: 'center', caps: true, spacing: 220, bold: true }),
          rect(b, { x: s.x + s.w * 0.38, y: cy - nameSize * 1.05, w: s.w * 0.24, h: rule }, b.p.accent),
          text(b, b.w.name, { x: s.x, y: cy - nameSize * 0.7, w: s.w, h: nameSize * 1.4 }, { size: nameSize, font: 'RX Playfair Display', colour: b.p.ink, align: 'center' }),
          text(b, b.w.title, { x: s.x, y: cy + nameSize * 0.8, w: s.w, h: nameSize * 0.9 }, { size: nameSize * 0.42, colour: b.p.muted, align: 'center', caps: true, spacing: 120 }),
          rect(b, { x: s.x + s.w * 0.38, y: cy + nameSize * 1.9, w: s.w * 0.24, h: rule }, b.p.accent),
          text(b, `${b.w.phone}  ·  ${b.w.email}`, { x: s.x, y: s.y + s.h - cSize * 1.8, w: s.w, h: cSize * 1.6 }, { size: cSize, colour: b.p.ink, align: 'center' }),
        ],
      };
    },
    back: (b) => {
      const { safe: s } = b;
      const pw = s.w * 0.7;
      const ph = s.h * 0.42;
      const big = Math.min(ph * 0.34, b.short * 0.11);
      return {
        background: b.p.bg,
        objects: [
          pattern(b, 'dots-small', [b.p.bg, b.p.accent], Math.max(4, b.short * 0.09)),
          rect(b, { x: s.x + (s.w - pw) / 2, y: s.y + (s.h - ph) / 2, w: pw, h: ph }, '#ffffff', { rx: ph * 0.12 * U, ry: ph * 0.12 * U }),
          text(b, b.w.company, { x: s.x + (s.w - pw) / 2 + pw * 0.05, y: s.y + s.h / 2 - big * 0.7, w: pw * 0.9, h: big * 1.4 }, { size: big, font: 'RX Playfair Display', colour: b.p.accent, align: 'center' }),
        ],
      };
    },
  },
  {
    id: 'starter-circles',
    name: 'Corner circles',
    labelKey: 'stTplCircles',
    use: 'contact',
    styles: ['playful', 'modern'],
    industries: ['creative', 'events', 'food', 'general'],
    kinds: [...CARD, ...LABELS],
    palettes: [...LIGHT.slice(0, 3), WARM[3]],
    front: (b) => {
      const { safe: s, trim: t } = b;
      const r1 = b.short * 0.5;
      const r2 = b.short * 0.24;
      const textW = b.orient === 'portrait' ? s.w : s.w * 0.62;
      const nb = nameBlock(b, { x: s.x, y: s.y + s.h * (b.orient === 'portrait' ? 0.36 : 0.18), w: textW, h: s.h * 0.34 }, 'left');
      const cSize = Math.min(b.short * 0.048, s.h * 0.085);
      return {
        background: b.p.bg,
        objects: [
          circle(b, t.w + r1 * 0.15, -r1 * 0.15, r1, b.p.accent),
          // Bottom right, clear of the contact lines on the left.
          circle(b, t.w - r2 * 0.6, t.h + r2 * 0.35, r2, b.p.accent2),
          ...nb.objects,
          text(b, contactLines(b.w), { x: s.x + (b.orient === 'portrait' ? 0 : s.w * 0.0), y: s.y + s.h - cSize * 1.3 * 3, w: textW, h: cSize * 1.3 * 3 }, { size: cSize, colour: b.p.ink, lineHeight: 1.3, align: b.orient === 'portrait' ? 'left' : 'left' }),
        ],
      };
    },
    back: (b) => {
      const { safe: s, trim: t } = b;
      const r1 = b.short * 0.42;
      const big = Math.min(s.h * 0.2, b.short * 0.12);
      return {
        background: b.p.accent,
        objects: [
          circle(b, -r1 * 0.1, -r1 * 0.1, r1, b.p.accent2),
          circle(b, t.w + r1 * 0.3, t.h + r1 * 0.3, r1 * 0.8, b.p.bg),
          text(b, b.w.company, { x: s.x, y: t.h / 2 - big * 0.7, w: s.w, h: big * 1.4 }, { size: big, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center' }),
        ],
      };
    },
  },
  {
    id: 'starter-luxe',
    name: 'Dark and gold',
    labelKey: 'stTplLuxe',
    use: 'contact',
    styles: ['elegant', 'classic'],
    industries: ['beauty', 'business', 'food', 'general'],
    kinds: CARD,
    palettes: DARK,
    front: (b) => {
      const { safe: s } = b;
      const nameSize = Math.min(s.h * 0.16, b.short * 0.115);
      const cy = s.y + s.h * 0.38;
      const cSize = Math.min(b.short * 0.044, s.h * 0.08);
      return {
        background: b.p.bg,
        objects: [
          text(b, b.w.name, { x: s.x, y: cy - nameSize * 0.7, w: s.w, h: nameSize * 1.4 }, { size: nameSize, font: 'RX Playfair Display', italic: true, colour: b.p.accent, align: 'center' }),
          text(b, b.w.title, { x: s.x, y: cy + nameSize * 0.75, w: s.w, h: nameSize * 0.8 }, { size: nameSize * 0.36, colour: b.p.ink, align: 'center', caps: true, spacing: 260 }),
          rect(b, { x: s.x + s.w * 0.44, y: cy + nameSize * 1.65, w: s.w * 0.12, h: Math.max(0.3, b.short * 0.005) }, b.p.accent),
          text(b, contactLines(b.w), { x: s.x, y: s.y + s.h - cSize * 1.35 * 3, w: s.w, h: cSize * 1.35 * 3 }, { size: cSize, colour: b.p.muted, align: 'center', lineHeight: 1.35 }),
        ],
      };
    },
    back: (b) => {
      const { safe: s, trim: t } = b;
      const r = Math.min(s.h, s.w) * 0.3;
      const cx = t.w / 2;
      const cy = s.y + s.h * 0.42;
      return {
        background: b.p.bg,
        objects: [
          circle(b, cx, cy, r, '', { stroke: b.p.accent, strokeWidth: Math.max(0.3, b.short * 0.006) * U }),
          text(b, initials(b.w.company), { x: cx - r, y: cy - r * 0.55, w: 2 * r, h: r * 1.1 }, { size: r * 0.8, font: 'RX Playfair Display', colour: b.p.accent, align: 'center' }),
          text(b, b.w.company, { x: s.x, y: cy + r * 1.25, w: s.w, h: r * 0.6 }, { size: r * 0.32, colour: b.p.ink, align: 'center', caps: true, spacing: 260 }),
        ],
      };
    },
  },
  {
    id: 'starter-qr',
    name: 'QR contact',
    labelKey: 'stTplQr',
    use: 'contact',
    styles: ['modern', 'minimal'],
    industries: ['business', 'creative', 'general', 'health'],
    kinds: CARD,
    palettes: LIGHT,
    front: (b) => {
      const { safe: s } = b;
      const vcard = qrPayload('vcard', { first: b.w.name.split(' ')[0], last: b.w.name.split(' ').slice(1).join(' '), org: b.w.company, title: b.w.title, phone: b.w.phone, email: b.w.email, web: b.w.web }) ?? b.w.web;
      const objects: Obj[] = [];
      if (b.orient === 'portrait') {
        const side = Math.min(s.w * 0.62, s.h * 0.4);
        objects.push(...nameBlock(b, { x: s.x, y: s.y, w: s.w, h: s.h * 0.24 }, 'center').objects);
        objects.push(qr(b, { x: s.x + (s.w - side) / 2, y: s.y + s.h * 0.32, w: side, h: side }, vcard, b.p.accent, ''));
        const cSize = Math.min(b.short * 0.05, s.h * 0.05);
        objects.push(text(b, `${b.w.phone}\n${b.w.email}`, { x: s.x, y: s.y + s.h - cSize * 2.8, w: s.w, h: cSize * 2.8 }, { size: cSize, colour: b.p.ink, align: 'center', lineHeight: 1.3 }));
      } else {
        const side = Math.min(s.h * 0.95, s.w * 0.36);
        const textW = s.w - side - s.w * 0.06;
        const nb = nameBlock(b, { x: s.x, y: s.y + s.h * 0.04, w: textW, h: s.h * 0.4 }, 'left');
        const cSize = Math.min(b.short * 0.048, s.h * 0.085);
        objects.push(...nb.objects);
        objects.push(text(b, contactLines(b.w), { x: s.x, y: s.y + s.h - cSize * 1.3 * 3, w: textW, h: cSize * 1.3 * 3 }, { size: cSize, colour: b.p.ink, lineHeight: 1.3 }));
        objects.push(qr(b, { x: s.x + s.w - side, y: s.y + (s.h - side) / 2, w: side, h: side }, vcard, b.p.accent, ''));
      }
      return { background: b.p.bg, objects };
    },
    back: (b) => {
      const { safe: s } = b;
      const big = Math.min(s.h * 0.22, b.short * 0.13);
      return {
        background: b.p.accent,
        objects: [
          text(b, b.w.company, { x: s.x, y: s.y + s.h * 0.32, w: s.w, h: big * 1.4 }, { size: big, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center' }),
          text(b, b.w.web, { x: s.x, y: s.y + s.h * 0.32 + big * 1.5, w: s.w, h: big * 0.8 }, { size: big * 0.42, colour: b.p.onAccent, align: 'center' }),
        ],
      };
    },
  },
  {
    id: 'starter-photo',
    name: 'Photo',
    labelKey: 'stTplPhoto',
    use: 'contact',
    styles: ['modern', 'playful'],
    industries: ['creative', 'beauty', 'health', 'general'],
    kinds: CARD,
    palettes: WARM,
    front: (b) => {
      const { safe: s } = b;
      const objects: Obj[] = [];
      if (b.orient === 'portrait') {
        const d = Math.min(s.w * 0.62, s.h * 0.38);
        objects.push(slot(b, { x: s.x + (s.w - d) / 2, y: s.y, w: d, h: d }, true));
        const nb = nameBlock(b, { x: s.x, y: s.y + d + s.h * 0.06, w: s.w, h: s.h * 0.22 }, 'center');
        objects.push(...nb.objects);
        const cSize = Math.min(b.short * 0.05, s.h * 0.05);
        objects.push(text(b, contactLines(b.w), { x: s.x, y: s.y + s.h - cSize * 1.3 * 3, w: s.w, h: cSize * 1.3 * 3 }, { size: cSize, colour: b.p.ink, align: 'center', lineHeight: 1.3 }));
      } else {
        const d = Math.min(s.h * 0.92, s.w * 0.38);
        objects.push(slot(b, { x: s.x, y: s.y + (s.h - d) / 2, w: d, h: d }, true));
        const tx = s.x + d + s.w * 0.07;
        const tw = s.x + s.w - tx;
        const nb = nameBlock(b, { x: tx, y: s.y + s.h * 0.08, w: tw, h: s.h * 0.4 }, 'left');
        objects.push(...nb.objects);
        const cSize = Math.min(b.short * 0.046, s.h * 0.08);
        objects.push(text(b, contactLines(b.w), { x: tx, y: s.y + s.h - cSize * 1.3 * 3, w: tw, h: cSize * 1.3 * 3 }, { size: cSize, colour: b.p.ink, lineHeight: 1.3 }));
      }
      return { background: b.p.bg, objects };
    },
    back: (b) => {
      const { safe: s, trim: t } = b;
      const big = Math.min(s.h * 0.2, b.short * 0.12);
      const pw = s.w * 0.8;
      return {
        background: b.p.bg,
        objects: [
          pattern(b, 'stripes-diagonal', [b.p.bg, b.p.accent], Math.max(5, b.short * 0.12)),
          rect(b, { x: (t.w - pw) / 2, y: t.h / 2 - big * 1.1, w: pw, h: big * 2.2 }, '#ffffff'),
          text(b, b.w.company, { x: (t.w - pw) / 2 + pw * 0.05, y: t.h / 2 - big * 0.7, w: pw * 0.9, h: big * 1.4 }, { size: big, font: 'RX Montserrat', bold: true, colour: b.p.accent, align: 'center' }),
        ],
      };
    },
  },
  {
    id: 'starter-diagonal',
    name: 'Diagonal',
    labelKey: 'stTplDiagonal',
    use: 'contact',
    styles: ['bold', 'modern'],
    industries: ['construction', 'business', 'general'],
    kinds: CARD,
    palettes: LIGHT,
    front: (b) => {
      const { safe: s, trim: t, b: bl } = b;
      const objects: Obj[] = [
        polygon(b, [[t.w * 0.52, t.h + bl], [t.w + bl, t.h * 0.3], [t.w + bl, t.h + bl]], b.p.accent),
        polygon(b, [[t.w * 0.7, t.h + bl], [t.w + bl, t.h * 0.58], [t.w + bl, t.h + bl]], b.p.accent2),
      ];
      const textW = b.orient === 'portrait' ? s.w : s.w * 0.7;
      const nb = nameBlock(b, { x: s.x, y: s.y, w: textW, h: s.h * 0.34 }, 'left');
      objects.push(...nb.objects);
      const cSize = Math.min(b.short * 0.046, s.h * 0.08);
      objects.push(text(b, contactLines(b.w), { x: s.x, y: s.y + s.h * (b.orient === 'portrait' ? 0.4 : 0.5), w: textW * 0.85, h: cSize * 1.3 * 3 }, { size: cSize, colour: b.p.ink, lineHeight: 1.3 }));
      return { background: b.p.bg, objects };
    },
    back: (b) => {
      const { safe: s, trim: t, b: bl } = b;
      const big = Math.min(s.h * 0.2, b.short * 0.12);
      return {
        background: b.p.bg,
        objects: [
          polygon(b, [[-bl, -bl], [t.w * 0.75, -bl], [t.w * 0.35, t.h + bl], [-bl, t.h + bl]], b.p.accent),
          text(b, b.w.company, { x: s.x, y: t.h / 2 - big * 0.7, w: s.w * 0.62, h: big * 1.4 }, { size: big, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'left' }),
        ],
      };
    },
  },
  // ---- prints: flyers, posters, roll-ups, banners, signs ----
  {
    id: 'starter-headline',
    name: 'Big headline',
    labelKey: 'stTplHeadline',
    use: 'promotion',
    styles: ['bold', 'modern'],
    industries: ['general', 'business', 'food', 'events', 'construction'],
    kinds: PRINTS,
    palettes: LIGHT,
    front: (b) => {
      const { safe: s, trim: t } = b;
      const objects: Obj[] = [];
      if (b.orient === 'landscape') {
        const leftW = s.w * 0.52;
        const hl = Math.min(s.h * 0.2, leftW * 0.16);
        objects.push(text(b, b.w.headline, { x: s.x, y: s.y, w: leftW, h: hl * 2.6 }, { size: hl, font: 'RX Anton', colour: b.p.ink, caps: true, lineHeight: 1.05 }));
        objects.push(text(b, b.w.sub, { x: s.x, y: s.y + hl * 2.7, w: leftW, h: hl * 0.9 }, { size: hl * 0.42, colour: b.p.accent, bold: true }));
        objects.push(text(b, b.w.body, { x: s.x, y: s.y + hl * 3.7, w: leftW * 0.92, h: s.h * 0.3 }, { size: hl * 0.3, colour: b.p.muted, fit: false, lineHeight: 1.35 }));
        objects.push(slot(b, { x: s.x + s.w * 0.56, y: s.y, w: s.w * 0.44, h: s.h }, false));
        const cSize = hl * 0.32;
        objects.push(text(b, `${b.w.web}   ${b.w.phone}`, { x: s.x, y: s.y + s.h - cSize * 1.6, w: leftW, h: cSize * 1.6 }, { size: cSize, colour: b.p.ink, bold: true }));
      } else {
        const hl = Math.min(s.w * 0.15, s.h * 0.08);
        objects.push(text(b, b.w.headline, { x: s.x, y: s.y, w: s.w, h: hl * 2.4 }, { size: hl, font: 'RX Anton', colour: b.p.ink, caps: true, align: 'center', lineHeight: 1.05 }));
        objects.push(text(b, b.w.sub, { x: s.x, y: s.y + hl * 2.5, w: s.w, h: hl * 0.8 }, { size: hl * 0.4, colour: b.p.accent, bold: true, align: 'center' }));
        const photoTop = s.y + hl * 3.5;
        const photoH = s.h * (b.orient === 'square' ? 0.34 : 0.4);
        objects.push(slot(b, { x: s.x, y: photoTop, w: s.w, h: photoH }, false));
        objects.push(text(b, b.w.body, { x: s.x + s.w * 0.05, y: photoTop + photoH + s.h * 0.03, w: s.w * 0.9, h: s.h * 0.12 }, { size: hl * 0.27, colour: b.p.muted, align: 'center', fit: false, lineHeight: 1.35 }));
        // The colour band: the bottom of the SAFE area (a roll-up's foot stays clear of it).
        const bandH = Math.max(hl * 1.2, s.h * 0.1);
        const bandTop = s.y + s.h - bandH;
        objects.push(rect(b, { x: -b.b, y: bandTop, w: t.w + 2 * b.b, h: t.h + b.b - bandTop }, b.p.accent));
        objects.push(text(b, `${b.w.web}   ·   ${b.w.phone}`, { x: s.x, y: bandTop + bandH * 0.2, w: s.w, h: bandH * 0.6 }, { size: bandH * 0.3, colour: b.p.onAccent, bold: true, align: 'center' }));
      }
      return { background: b.p.bg, objects };
    },
  },
  {
    id: 'starter-split',
    name: 'Split',
    labelKey: 'stTplSplit',
    use: 'promotion',
    styles: ['modern', 'bold'],
    industries: ['general', 'food', 'beauty', 'health', 'creative'],
    kinds: PRINTS,
    palettes: [...LIGHT.slice(0, 3), WARM[2]],
    front: (b) => {
      const { safe: s, trim: t } = b;
      const objects: Obj[] = [];
      if (b.orient === 'landscape') {
        const half = t.w * 0.5;
        objects.push(slot(b, { x: -b.b, y: -b.b, w: half + b.b, h: t.h + 2 * b.b }, false));
        objects.push(rect(b, { x: half, y: -b.b, w: t.w - half + b.b, h: t.h + 2 * b.b }, b.p.accent));
        const tx = half + t.w * 0.05;
        const tw = s.x + s.w - tx;
        const hl = Math.min(s.h * 0.18, tw * 0.15);
        objects.push(text(b, b.w.headline, { x: tx, y: s.y + s.h * 0.08, w: tw, h: hl * 2.5 }, { size: hl, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, lineHeight: 1.08 }));
        objects.push(text(b, b.w.sub, { x: tx, y: s.y + s.h * 0.08 + hl * 2.6, w: tw, h: hl }, { size: hl * 0.45, colour: b.p.onAccent }));
        objects.push(rect(b, { x: tx, y: s.y + s.h * 0.7, w: Math.min(tw, hl * 6), h: hl * 1.1 }, b.p.accent2, { rx: hl * 0.55 * U, ry: hl * 0.55 * U }));
        objects.push(text(b, b.w.cta, { x: tx, y: s.y + s.h * 0.7, w: Math.min(tw, hl * 6), h: hl * 1.1 }, { size: hl * 0.42, colour: '#ffffff', bold: true, align: 'center' }));
        objects.push(text(b, b.w.web, { x: tx, y: s.y + s.h - hl * 0.7, w: tw, h: hl * 0.7 }, { size: hl * 0.34, colour: b.p.onAccent }));
      } else {
        const half = t.h * 0.48;
        objects.push(slot(b, { x: -b.b, y: -b.b, w: t.w + 2 * b.b, h: half + b.b }, false));
        objects.push(rect(b, { x: -b.b, y: half, w: t.w + 2 * b.b, h: t.h - half + b.b }, b.p.accent));
        const top = Math.max(half + t.h * 0.04, s.y);
        const room = s.y + s.h - top;
        const hl = Math.min(s.w * 0.11, room * 0.16);
        objects.push(text(b, b.w.headline, { x: s.x, y: top, w: s.w, h: hl * 2.4 }, { size: hl, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center', lineHeight: 1.08 }));
        objects.push(text(b, b.w.sub, { x: s.x, y: top + hl * 2.5, w: s.w, h: hl }, { size: hl * 0.45, colour: b.p.onAccent, align: 'center' }));
        const btnW = Math.min(s.w * 0.6, hl * 6);
        objects.push(rect(b, { x: s.x + (s.w - btnW) / 2, y: top + room * 0.62, w: btnW, h: hl * 1.1 }, b.p.accent2, { rx: hl * 0.55 * U, ry: hl * 0.55 * U }));
        objects.push(text(b, b.w.cta, { x: s.x + (s.w - btnW) / 2, y: top + room * 0.62, w: btnW, h: hl * 1.1 }, { size: hl * 0.42, colour: '#ffffff', bold: true, align: 'center' }));
        objects.push(text(b, `${b.w.web}   ·   ${b.w.phone}`, { x: s.x, y: s.y + s.h - hl * 0.8, w: s.w, h: hl * 0.8 }, { size: hl * 0.32, colour: b.p.onAccent, align: 'center' }));
      }
      return { background: b.p.bg, objects };
    },
  },
  {
    id: 'starter-event',
    name: 'Event',
    labelKey: 'stTplEvent',
    use: 'event',
    styles: ['playful', 'bold'],
    industries: ['events', 'food', 'creative', 'general'],
    kinds: PRINTS,
    palettes: [...WARM.slice(1), LIGHT[0]],
    front: (b) => {
      const { safe: s, trim: t } = b;
      const objects: Obj[] = [
        circle(b, t.w * 0.92, t.h * 0.06, b.short * 0.28, b.p.accent2, { opacity: 0.18 }),
        circle(b, t.w * 0.05, t.h * 0.9, b.short * 0.22, b.p.accent, { opacity: 0.16 }),
      ];
      const landscape = b.orient === 'landscape';
      const dateW = landscape ? Math.min(s.h * 0.62, s.w * 0.24) : Math.min(s.w * 0.36, s.h * 0.2);
      const date: Frame = { x: s.x, y: s.y, w: dateW, h: dateW };
      objects.push(rect(b, date, b.p.accent, { rx: dateW * 0.1 * U, ry: dateW * 0.1 * U }));
      objects.push(text(b, b.w.day, { x: date.x, y: date.y + dateW * 0.08, w: dateW, h: dateW * 0.55 }, { size: dateW * 0.44, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center' }));
      objects.push(text(b, b.w.month, { x: date.x, y: date.y + dateW * 0.62, w: dateW, h: dateW * 0.28 }, { size: dateW * 0.16, colour: b.p.onAccent, align: 'center', caps: true, spacing: 120, bold: true }));
      const tx = landscape ? s.x + dateW + s.w * 0.05 : s.x;
      const tw = landscape ? s.x + s.w - tx : s.w;
      const ty = landscape ? s.y : s.y + dateW + s.h * 0.05;
      const hl = Math.min(landscape ? s.h * 0.2 : s.w * 0.14, tw * 0.16);
      objects.push(text(b, b.w.headline, { x: tx, y: ty, w: tw, h: hl * 2.5 }, { size: hl, font: 'RX Montserrat', bold: true, colour: b.p.ink, lineHeight: 1.08 }));
      objects.push(text(b, b.w.place, { x: tx, y: ty + hl * 2.6, w: tw, h: hl * 0.9 }, { size: hl * 0.42, colour: b.p.accent, bold: true }));
      objects.push(text(b, b.w.body, { x: tx, y: ty + hl * 3.6, w: tw * 0.95, h: s.h * 0.2 }, { size: hl * 0.3, colour: b.p.muted, fit: false, lineHeight: 1.35 }));
      const qs = Math.min(s.w, s.h) * (landscape ? 0.3 : 0.2);
      objects.push(qr(b, { x: s.x + s.w - qs, y: s.y + s.h - qs, w: qs, h: qs }, qrPayload('url', { url: b.w.web }) ?? b.w.web, b.p.ink, '#ffffff'));
      objects.push(text(b, b.w.web, { x: s.x, y: s.y + s.h - qs * 0.3, w: s.w - qs * 1.15, h: qs * 0.3 }, { size: qs * 0.14, colour: b.p.ink, bold: true }));
      return { background: b.p.bg, objects };
    },
  },
  {
    id: 'starter-offer',
    name: 'Offer',
    labelKey: 'stTplOffer',
    use: 'promotion',
    styles: ['bold', 'playful'],
    industries: ['general', 'food', 'beauty', 'events'],
    kinds: PRINTS,
    palettes: [LIGHT[1], LIGHT[0], WARM[3], LIGHT[3]],
    front: (b) => {
      const { safe: s } = b;
      const landscape = b.orient === 'landscape';
      // A roll-up is read from across the room: the offer large, in the middle of the height.
      const tall = !landscape && s.h > s.w * 1.8;
      const r = tall ? s.w * 0.4 : Math.min(s.w, s.h) * (landscape ? 0.36 : 0.24);
      const cx = landscape ? s.x + s.w - r : tall ? s.x + s.w / 2 : s.x + s.w - r * 0.95;
      const cy = landscape ? s.y + s.h / 2 : tall ? s.y + s.h * 0.24 : s.y + r * 0.95;
      const objects: Obj[] = [
        burst(b, cx, cy, r, b.p.accent),
        // One line: the burst's width, never wrapped (Anton's figures and % run wider than its letters).
        text(b, b.w.offer, { x: cx - r * 0.8, y: cy - r * 0.38, w: r * 1.6, h: r * 0.76 }, { size: r * 0.55, font: 'RX Anton', colour: b.p.onAccent, align: 'center', caps: true }),
      ];
      const tw = landscape ? s.w - 2 * r - s.w * 0.04 : s.w;
      const ty = landscape ? s.y + s.h * 0.1 : tall ? s.y + s.h * 0.5 : s.y + 2 * r + s.h * 0.03;
      const hl = Math.min(landscape ? s.h * 0.3 : s.w * 0.24, tw * 0.3);
      objects.push(text(b, b.w.sale, { x: s.x, y: ty, w: tw, h: hl * 1.25 }, { size: hl, font: 'RX Anton', colour: b.p.ink, caps: true, align: landscape ? 'left' : 'center' }));
      objects.push(text(b, b.w.sub, { x: s.x, y: ty + hl * 1.3, w: tw, h: hl * 0.5 }, { size: hl * 0.24, colour: b.p.accent, bold: true, align: landscape ? 'left' : 'center' }));
      const btnW = Math.min(tw * 0.7, hl * 2.6);
      const btnX = landscape ? s.x : s.x + (s.w - btnW) / 2;
      const btnY = ty + hl * 2;
      objects.push(rect(b, { x: btnX, y: btnY, w: btnW, h: hl * 0.48 }, b.p.ink, { rx: hl * 0.24 * U, ry: hl * 0.24 * U }));
      objects.push(text(b, b.w.cta, { x: btnX, y: btnY, w: btnW, h: hl * 0.48 }, { size: hl * 0.2, colour: '#ffffff', bold: true, align: 'center' }));
      const cSize = Math.min(hl * 0.16, s.h * 0.04);
      objects.push(text(b, `${b.w.web}   ·   ${b.w.phone}`, { x: s.x, y: s.y + s.h - cSize * 1.6, w: s.w, h: cSize * 1.6 }, { size: cSize, colour: b.p.muted, align: 'center' }));
      return { background: b.p.bg, objects };
    },
  },
  {
    id: 'starter-minimal',
    name: 'Minimal',
    labelKey: 'stTplMinimal',
    use: 'promotion',
    styles: ['minimal', 'elegant'],
    industries: ['beauty', 'health', 'business', 'creative', 'general'],
    kinds: [...PRINTS, ...LABELS],
    palettes: WARM,
    front: (b) => {
      const { safe: s } = b;
      const inset = Math.min(s.w, s.h) * 0.04;
      const hl = Math.min(s.w * 0.12, s.h * 0.1);
      const cy = s.y + s.h * 0.42;
      return {
        background: b.p.bg,
        objects: [
          rect(b, { x: s.x + inset, y: s.y + inset, w: s.w - 2 * inset, h: s.h - 2 * inset }, '', { stroke: b.p.accent, strokeWidth: Math.max(0.3, b.short * 0.004) * U }),
          text(b, b.w.company, { x: s.x + s.w * 0.1, y: s.y + s.h * 0.12, w: s.w * 0.8, h: hl * 0.7 }, { size: hl * 0.3, colour: b.p.accent, caps: true, spacing: 300, align: 'center', bold: true }),
          text(b, b.w.headline, { x: s.x + s.w * 0.1, y: cy - hl * 1.2, w: s.w * 0.8, h: hl * 2.4 }, { size: hl, font: 'RX Playfair Display', colour: b.p.ink, align: 'center', lineHeight: 1.1 }),
          text(b, b.w.sub, { x: s.x + s.w * 0.12, y: cy + hl * 1.4, w: s.w * 0.76, h: hl * 0.9 }, { size: hl * 0.34, colour: b.p.muted, align: 'center', italic: true }),
          text(b, `${b.w.web}   ·   ${b.w.phone}`, { x: s.x + s.w * 0.1, y: s.y + s.h * 0.82, w: s.w * 0.8, h: hl * 0.6 }, { size: hl * 0.26, colour: b.p.ink, align: 'center' }),
        ],
      };
    },
  },
  {
    id: 'starter-pattern',
    name: 'Pattern',
    labelKey: 'stTplPattern',
    use: 'promotion',
    styles: ['playful', 'modern'],
    industries: ['events', 'food', 'creative', 'general'],
    kinds: [...PRINTS, ...LABELS],
    palettes: [WARM[1], WARM[2], WARM[3], LIGHT[0]],
    front: (b) => {
      const { safe: s, trim: t } = b;
      // A small label has room for the words, not for the contact line.
      const small = b.short < 90;
      const pw = s.w * (small ? 0.94 : 0.84);
      const ph = s.h * (b.orient === 'landscape' ? 0.7 : small ? 0.56 : 0.48);
      const px = (t.w - pw) / 2;
      const py = s.y + (s.h - ph) / 2;
      const hl = Math.min(pw * 0.12, ph * 0.2);
      const objects: Obj[] = [
        pattern(b, b.p.id === 'navy' ? 'waves' : 'confetti', [b.p.bg, b.p.accent], Math.max(8, b.short * 0.22)),
        rect(b, { x: px, y: py, w: pw, h: ph }, '#ffffff', { rx: Math.min(pw, ph) * 0.06 * U, ry: Math.min(pw, ph) * 0.06 * U }),
        text(b, b.w.headline, { x: px + pw * 0.08, y: py + ph * (small ? 0.2 : 0.12), w: pw * 0.84, h: hl * 2.4 }, { size: hl, font: 'RX Montserrat', bold: true, colour: b.p.accent, align: 'center', lineHeight: 1.08 }),
        text(b, b.w.sub, { x: px + pw * 0.08, y: py + ph * (small ? 0.2 : 0.12) + hl * 2.5, w: pw * 0.84, h: hl }, { size: hl * 0.42, colour: b.p.ink, align: 'center' }),
      ];
      if (!small) {
        objects.push(text(b, `${b.w.web}   ·   ${b.w.phone}`, { x: px + pw * 0.08, y: py + ph - hl * 1.1, w: pw * 0.84, h: hl * 0.7 }, { size: hl * 0.32, colour: b.p.muted, align: 'center', bold: true }));
      }
      return { background: b.p.bg, objects };
    },
  },
  // ---- labels and stickers ----
  {
    id: 'starter-badge',
    name: 'Badge',
    labelKey: 'stTplBadge',
    use: 'label',
    styles: ['bold', 'classic'],
    industries: ['food', 'general', 'business', 'creative'],
    kinds: LABELS,
    palettes: [LIGHT[1], LIGHT[0], LIGHT[2], DARK[0]],
    front: (b) => {
      const { safe: s, trim: t } = b;
      const r = Math.min(t.w, t.h) * 0.47;
      const cx = t.w / 2;
      const cy = t.h / 2;
      const inner = Math.min(s.w, s.h);
      return {
        background: b.p.bg,
        objects: [
          burst(b, cx, cy, r, b.p.accent, 24),
          circle(b, cx, cy, r * 0.74, '', { stroke: b.p.onAccent, strokeWidth: Math.max(0.3, r * 0.025) * U }),
          text(b, b.w.company, { x: cx - inner * 0.42, y: cy - inner * 0.16, w: inner * 0.84, h: inner * 0.2 }, { size: inner * 0.16, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center' }),
          text(b, b.w.slogan, { x: cx - inner * 0.36, y: cy + inner * 0.08, w: inner * 0.72, h: inner * 0.14 }, { size: inner * 0.08, colour: b.p.onAccent, align: 'center', italic: true }),
        ],
      };
    },
  },
  {
    id: 'starter-label',
    name: 'Simple label',
    labelKey: 'stTplLabel',
    use: 'label',
    styles: ['minimal', 'modern'],
    industries: ['food', 'beauty', 'general', 'business'],
    kinds: LABELS,
    palettes: [LIGHT[0], WARM[0], WARM[2], DARK[0]],
    front: (b) => {
      const { safe: s } = b;
      const big = Math.min(s.w * 0.16, s.h * 0.22);
      const cy = s.y + s.h / 2;
      return {
        background: b.p.accent,
        objects: [
          text(b, b.w.company, { x: s.x, y: cy - big * 0.9, w: s.w, h: big * 1.3 }, { size: big, font: 'RX Montserrat', bold: true, colour: b.p.onAccent, align: 'center' }),
          rect(b, { x: s.x + s.w * 0.35, y: cy + big * 0.55, w: s.w * 0.3, h: Math.max(0.3, b.short * 0.008) }, b.p.onAccent),
          text(b, b.w.slogan, { x: s.x, y: cy + big * 0.75, w: s.w, h: big * 0.7 }, { size: big * 0.36, colour: b.p.onAccent, align: 'center', italic: true }),
        ],
      };
    },
  },
];

export const STARTER_TEMPLATES: readonly StarterDef[] = STARTERS;

/** Is this one of ours (never in the database)? */
export const isStarterId = (id: unknown): boolean => typeof id === 'string' && id.startsWith('starter-');

export function starterById(id: string): StarterDef | null {
  return STARTERS.find((s) => s.id === id) ?? null;
}

/** The starters offered on a product of this kind: its own, else the general prints'. */
export function startersFor(kind: ProductKind): StarterDef[] {
  const own = STARTERS.filter((s) => s.kinds.includes(kind));
  return own.length ? own : STARTERS.filter((s) => s.kinds.includes('print'));
}

function buildContext(ctx: StarterContext, palette: Palette): Build {
  const { wMm, hMm } = ctx.trimMm;
  const box = safeBox(ctx.outline, wMm, hMm, ctx.safeMm);
  const hid = ctx.hiddenMm;
  const x0 = Math.max(box.xMm, hid.left);
  const y0 = Math.max(box.yMm, hid.top);
  const x1 = Math.min(box.xMm + box.wMm, wMm - hid.right);
  const y1 = Math.min(box.yMm + box.hMm, hMm - hid.bottom);
  const safe: Frame = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  const orient = wMm > hMm * 1.12 ? 'landscape' : hMm > wMm * 1.12 ? 'portrait' : 'square';
  return { trim: { w: wMm, h: hMm }, b: ctx.bleedMm, safe, orient, short: Math.min(wMm, hMm), w: ctx.words, p: palette, outline: ctx.outline };
}

const sideJsonOf = (side: SideOut) => JSON.stringify({ version: VERSION, background: side.background, objects: side.objects });

/**
 * A starter, built for this product: { sides: [{ id, json }] } for the studio —
 * the front always; the back when the product prints one (from the starter's own
 * back, else blank). Null for an unknown starter.
 */
export function buildStarter(id: string, paletteId: string | null | undefined, ctx: StarterContext): { sides: Array<{ id: SideId; json: string }>; palette: Palette } | null {
  const def = starterById(id);
  if (!def) return null;
  const palette = def.palettes.find((p) => p.id === paletteId) ?? def.palettes[0];
  const b = buildContext(ctx, palette);
  const sides: Array<{ id: SideId; json: string }> = [];
  for (const side of ctx.sides.length ? ctx.sides : (['front'] as SideId[])) {
    if (side === 'front' || (side === 'back' && ctx.sides.length === 1)) sides.push({ id: side, json: sideJsonOf(def.front(b)) });
    else sides.push({ id: side, json: sideJsonOf(def.back ? def.back(b) : { background: palette.bg, objects: [] }) });
  }
  return { sides, palette };
}
