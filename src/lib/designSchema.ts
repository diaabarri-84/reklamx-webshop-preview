/**
 * WHAT A DESIGN MAY CONTAIN — an allowlist, per kind of object (designer v2).
 *
 * A design is fabric JSON. The browser's loadFromJSON puts EVERY key of an object
 * onto the live object, so a design from anywhere but this shop's own designer
 * (an owner template served to every customer, a draft, an order) is rebuilt here
 * key by key: only the keys fabric 7.4 writes for that kind, only values of the
 * expected shape and size. Anything else — an unknown key, a "__proto__", an
 * address, a filter, a gradient, text on a path, a shadow, a composite mode — is
 * dropped or refused. The previous cleaner (round 16) refused a few known dangers
 * and let the rest through; the review showed unknown keys reaching fabric
 * instances.
 *
 * Kinds: Textbox, Image (top level, by rxImageId, src blanked, clipPath only as one
 * of our own plain shapes), Rect, Circle, Ellipse, Triangle, Polygon, Polyline,
 * Line, Path (fabric's normalised M/L/C/Q/Z), Group (one level: shapes, paths and
 * text), and our own RxPattern (a background drawn from src/lib/designPatterns.ts)
 * and RxQr (src/lib/designQr.ts) — those carry their PARAMETERS only.
 *
 * Colours are normalised to #rrggbb ("" / null for none); the variant recolouring
 * and the server both rely on that. Pure; scripts/test-design-schema.mjs.
 */
import { cleanPatternSpec } from './designPatterns.js';
// The package-free half: this module is in the SERVER's bundle (see designQrSpec.ts).
import { cleanQrSpec } from './designQrSpec.js';

/** A picture's id, as the designer makes them (img-<time>-<random>): never "__proto__" or "constructor". */
export const DESIGN_IMAGE_ID = /^img-[a-z0-9]{1,24}-[a-z0-9]{1,24}$/;

export const DESIGN_KINDS = [
  'Textbox', 'Image', 'Rect', 'Circle', 'Ellipse', 'Triangle', 'Polygon', 'Polyline', 'Line', 'Path', 'Group', 'RxPattern', 'RxQr',
] as const;
export type DesignKind = (typeof DESIGN_KINDS)[number];
const KIND_BY_LOWER = new Map<string, DesignKind>(DESIGN_KINDS.map((k) => [k.toLowerCase(), k]));

/** Bounds that keep a design renderable: a template is drawn on every customer's phone. */
export const DESIGN_LIMITS = {
  objects: 1500,
  groupChildren: 400,
  pathCommands: 20_000,
  points: 4000,
  text: 4000,
  coordinate: 1_000_000,
} as const;

type Obj = Record<string, unknown>;
type Clean = (v: unknown) => unknown | typeof DROP | typeof REFUSE;
const DROP = Symbol('drop');
const REFUSE = Symbol('refuse');

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const num = (min: number, max: number): Clean => (v) => (finite(v) && (v as number) >= min && (v as number) <= max ? v : REFUSE);
const bool: Clean = (v) => (typeof v === 'boolean' ? v : REFUSE);
const oneOf = (...allowed: unknown[]): Clean => (v) => (allowed.includes(v) ? v : REFUSE);
/** Always this value, whatever came in: the key's shape is fixed, its content is not ours to trust. */
const fixed = (value: unknown): Clean => () => value;
const C = DESIGN_LIMITS.coordinate;

/** "#abc", "#aabbcc", "#aabbccdd", "rgb(…)", "rgba(…)", "transparent" → "#rrggbb" (alpha folded away: print has no alpha). */
export function normaliseColour(v: unknown): string | null | typeof REFUSE {
  if (v === null || v === undefined) return null;
  if (v === '' || v === 'transparent') return '';
  if (typeof v !== 'string') return REFUSE;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${m[1].split('').map((c) => c + c).join('')}`;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return `#${m[1]}`;
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) {
    const parts = [m[1], m[2], m[3]].map(Number);
    if (parts.some((p) => p > 255)) return REFUSE;
    return `#${parts.map((p) => p.toString(16).padStart(2, '0')).join('')}`;
  }
  if (s === 'black') return '#000000';
  if (s === 'white') return '#ffffff';
  return REFUSE;
}
const colour: Clean = (v) => normaliseColour(v);

const dashArray: Clean = (v) => {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > 8) return REFUSE;
  // A dash of a thousandth of a unit renders for minutes: at least 0.1 mm (1 unit).
  if (!v.every((x) => finite(x) && x >= 1 && x <= C)) return REFUSE;
  return v;
};

/** Keys every kind has (fabric 7.4 `toObject`), with what each may hold. */
const COMMON: Record<string, Clean> = {
  type: (v) => v, // set by the caller to the canonical kind
  version: (v) => (typeof v === 'string' ? v.slice(0, 20) : DROP),
  originX: oneOf('left', 'center', 'right'),
  originY: oneOf('top', 'center', 'bottom'),
  left: num(-C, C),
  top: num(-C, C),
  width: num(0, C),
  height: num(0, C),
  fill: colour,
  stroke: colour,
  strokeWidth: num(0, 10_000),
  strokeDashArray: dashArray,
  strokeLineCap: oneOf('butt', 'round', 'square'),
  strokeDashOffset: num(-C, C),
  strokeLineJoin: oneOf('miter', 'round', 'bevel'),
  strokeUniform: bool,
  strokeMiterLimit: num(1, 50),
  scaleX: num(-10_000, 10_000),
  scaleY: num(-10_000, 10_000),
  angle: num(-36_000, 36_000),
  flipX: bool,
  flipY: bool,
  opacity: num(0, 1),
  visible: bool,
  fillRule: oneOf('nonzero', 'evenodd'),
  paintFirst: oneOf('fill', 'stroke'),
  skewX: num(-89, 89),
  skewY: num(-89, 89),
  // Never ours to accept: a shadow, a background box, a composite mode.
  shadow: fixed(null),
  backgroundColor: fixed(''),
  globalCompositeOperation: fixed('source-over'),
  // The shop's own markers (OnlineDesigner.tsx).
  rxSlot: bool,
  rxFill: bool,
  rxLock: oneOf('words', 'locked', 'unlockable'),
  rxBox: (v) => {
    const b = v as { w?: unknown; h?: unknown; fontSize?: unknown } | null;
    if (!b || typeof b !== 'object') return REFUSE;
    if (!finite(b.w) || !finite(b.h) || !finite(b.fontSize)) return REFUSE;
    if ((b.w as number) <= 0 || (b.h as number) <= 0 || (b.fontSize as number) <= 0) return REFUSE;
    return { w: b.w, h: b.h, fontSize: b.fontSize };
  },
  rxElement: (v) => {
    const e = v as { lib?: unknown; id?: unknown } | null;
    if (!e || typeof e !== 'object') return REFUSE;
    if (!['social', 'icon', 'emoji', 'shape'].includes(String(e.lib)) || !/^[a-z0-9-]{1,48}$/.test(String(e.id))) return REFUSE;
    return { lib: e.lib, id: e.id };
  },
};

const TEXT_ALIGN = ['left', 'center', 'right', 'justify', 'justify-left', 'justify-center', 'justify-right'];

const PER_KIND: Record<DesignKind, Record<string, Clean>> = {
  Textbox: {
    text: (v) => (typeof v === 'string' && v.length <= DESIGN_LIMITS.text ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : REFUSE),
    fontSize: num(0.5, 50_000),
    fontWeight: (v) => (v === 'bold' || v === 700 || v === '700' ? 'bold' : v === 'normal' || v === 400 || v === '400' ? 'normal' : REFUSE),
    // Mapped to the library by the caller (fontFamilyOk): an unknown family is not refused, it is replaced.
    fontFamily: (v) => (typeof v === 'string' && v.length <= 80 ? v : REFUSE),
    fontStyle: oneOf('normal', 'italic'),
    lineHeight: num(0.5, 5),
    charSpacing: num(-500, 3000),
    textAlign: oneOf(...TEXT_ALIGN),
    underline: bool,
    overline: bool,
    linethrough: bool,
    textBackgroundColor: fixed(''),
    direction: fixed('ltr'),
    textDecorationThickness: num(0, 1000),
    minWidth: num(0, C),
    splitByGrapheme: bool,
    // Per-character styles and text along a path: never.
    styles: fixed([]),
    path: fixed(null),
    pathStartOffset: fixed(0),
    pathSide: fixed('left'),
    pathAlign: fixed('baseline'),
    rxCaps: bool,
    rxList: bool,
  },
  Image: {
    src: fixed(''),
    crossOrigin: fixed(null),
    filters: fixed([]),
    cropX: num(0, C),
    cropY: num(0, C),
    rxImageId: (v) => (typeof v === 'string' && DESIGN_IMAGE_ID.test(v) ? v : REFUSE),
    rxOrigId: (v) => (typeof v === 'string' && DESIGN_IMAGE_ID.test(v) ? v : REFUSE),
    rxAdjust: (v) => {
      const a = v as { hue?: unknown; sat?: unknown; bright?: unknown } | null;
      if (!a || typeof a !== 'object') return REFUSE;
      const ok = (x: unknown, lim: number) => finite(x) && Math.abs(x as number) <= lim;
      if (!ok(a.hue, 180) || !ok(a.sat, 100) || !ok(a.bright, 100)) return REFUSE;
      return { hue: a.hue, sat: a.sat, bright: a.bright };
    },
  },
  Rect: { rx: num(0, C), ry: num(0, C) },
  Circle: { radius: num(0, C), startAngle: num(0, 360), endAngle: num(0, 360), counterClockwise: bool },
  Ellipse: { rx: num(0, C), ry: num(0, C) },
  Triangle: {},
  Polygon: { points: (v) => points(v) },
  Polyline: { points: (v) => points(v) },
  Line: { x1: num(-C, C), y1: num(-C, C), x2: num(-C, C), y2: num(-C, C) },
  Path: { path: (v) => pathCommands(v) },
  Group: {
    subTargetCheck: bool,
    interactive: bool,
    layoutManager: fixed({ type: 'layoutManager', strategy: 'fit-content' }),
  },
  RxPattern: {
    rx: num(0, C),
    ry: num(0, C),
    rxPattern: (v) => cleanPatternSpec(v) ?? REFUSE,
  },
  RxQr: {
    rxQr: (v) => cleanQrSpec(v) ?? REFUSE,
    rxQrBg: colour,
  },
};

function points(v: unknown): unknown {
  if (!Array.isArray(v) || v.length < 2 || v.length > DESIGN_LIMITS.points) return REFUSE;
  const out: Array<{ x: number; y: number }> = [];
  for (const p of v) {
    const q = p as { x?: unknown; y?: unknown } | null;
    if (!q || !finite(q.x) || !finite(q.y) || Math.abs(q.x as number) > C || Math.abs(q.y as number) > C) return REFUSE;
    out.push({ x: q.x as number, y: q.y as number });
  }
  return out;
}

/** fabric's normalised path: absolute M/L/C/Q/Z with finite numbers, bounded. */
const PATH_ARITY: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };
function pathCommands(v: unknown): unknown {
  if (!Array.isArray(v) || v.length === 0 || v.length > DESIGN_LIMITS.pathCommands) return REFUSE;
  const out: unknown[] = [];
  for (const cmd of v) {
    if (!Array.isArray(cmd) || typeof cmd[0] !== 'string') return REFUSE;
    const letter = cmd[0];
    const arity = PATH_ARITY[letter];
    if (arity === undefined || cmd.length !== arity + 1) return REFUSE;
    const nums = cmd.slice(1);
    if (!nums.every((x) => finite(x) && Math.abs(x as number) <= C)) return REFUSE;
    out.push([letter, ...nums]);
  }
  return out;
}

/** A clip shape for a picture (a round or rounded photo frame): one of our plain shapes, nothing nested. */
const CLIP_KINDS = new Set<DesignKind>(['Rect', 'Circle', 'Ellipse', 'Path', 'Polygon']);
const CLIP_EXTRA: Record<string, Clean> = { inverted: fixed(false), absolutePositioned: bool };

export interface CleanContext {
  /** Is this font family one the designer has? (an unknown one is replaced by `defaultFont`). */
  fontFamilyOk: (family: string) => boolean;
  defaultFont: string;
  /** Picture ids found, for the caller to resolve. */
  imageIds: Set<string>;
  count: number;
}

function cleanWith(o: Obj, kind: DesignKind, ctx: CleanContext, extra: Record<string, Clean> = {}): Obj | null {
  const allowed = { ...COMMON, ...PER_KIND[kind], ...extra };
  const out: Obj = Object.create(null);
  for (const key of Object.keys(o)) {
    if (!Object.prototype.hasOwnProperty.call(allowed, key)) continue; // unknown keys are dropped, never copied
    const cleaned = allowed[key](o[key]);
    if (cleaned === REFUSE) return null;
    if (cleaned === DROP) continue;
    out[key] = cleaned;
  }
  out.type = kind;
  if (kind === 'Textbox') {
    const family = String(out.fontFamily ?? '');
    if (!ctx.fontFamilyOk(family)) out.fontFamily = ctx.defaultFont;
    if (typeof out.text !== 'string') return null;
  }
  return { ...out };
}

function cleanObject(raw: unknown, depth: number, ctx: CleanContext): Obj | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  ctx.count += 1;
  if (ctx.count > DESIGN_LIMITS.objects) return null;
  const o = raw as Obj;
  const kind = KIND_BY_LOWER.get(String(o.type ?? '').toLowerCase());
  if (!kind) return null;
  if (kind === 'Image') {
    if (depth > 0) return null; // pictures only at the top level
    const base = cleanWith(o, 'Image', ctx);
    if (!base || typeof base.rxImageId !== 'string') return null;
    ctx.imageIds.add(base.rxImageId);
    if (typeof base.rxOrigId === 'string') ctx.imageIds.add(base.rxOrigId);
    if (o.clipPath != null) {
      const clip = o.clipPath as Obj;
      const clipKind = KIND_BY_LOWER.get(String(clip?.type ?? '').toLowerCase());
      if (!clipKind || !CLIP_KINDS.has(clipKind) || (clip as Obj).clipPath != null) return null;
      const cleanedClip = cleanWith(clip, clipKind, ctx, CLIP_EXTRA);
      if (!cleanedClip) return null;
      base.clipPath = cleanedClip;
    }
    return base;
  }
  if (o.clipPath != null) return null; // only pictures may be clipped
  if (kind === 'Group') {
    if (depth > 0 || !Array.isArray(o.objects) || o.objects.length === 0 || o.objects.length > DESIGN_LIMITS.groupChildren) return null;
    const base = cleanWith(o, 'Group', ctx);
    if (!base) return null;
    const children: Obj[] = [];
    for (const child of o.objects as unknown[]) {
      const kindOf = KIND_BY_LOWER.get(String((child as Obj | null)?.type ?? '').toLowerCase());
      if (!kindOf || kindOf === 'Group' || kindOf === 'Image' || kindOf === 'RxPattern') return null;
      const c = cleanObject(child, depth + 1, ctx);
      if (!c) return null;
      children.push(c);
    }
    base.objects = children;
    return base;
  }
  if (kind === 'RxPattern' && depth > 0) return null;
  return cleanWith(o, kind, ctx);
}

/**
 * One SIDE of a design (fabric's `{version, background, objects}`), rebuilt, or
 * null when anything in it is outside the allowlist. `background` is a colour.
 */
export function cleanDesignSide(
  raw: unknown,
  ctx: Omit<CleanContext, 'imageIds' | 'count'> & { imageIds?: Set<string> },
): { side: { version?: string; background: string; objects: Obj[] }; imageIds: string[] } | null {
  const root = raw as { version?: unknown; background?: unknown; objects?: unknown } | null;
  if (!root || typeof root !== 'object' || Array.isArray(root) || !Array.isArray(root.objects)) return null;
  const c: CleanContext = { ...ctx, imageIds: ctx.imageIds ?? new Set(), count: 0 };
  const objects: Obj[] = [];
  for (const o of root.objects as unknown[]) {
    const cleaned = cleanObject(o, 0, c);
    if (!cleaned) return null;
    objects.push(cleaned);
  }
  const bg = normaliseColour(root.background ?? '#ffffff');
  if (bg === REFUSE) return null;
  return {
    side: {
      ...(typeof root.version === 'string' ? { version: root.version.slice(0, 20) } : {}),
      background: bg || '#ffffff',
      objects,
    },
    imageIds: [...c.imageIds],
  };
}
