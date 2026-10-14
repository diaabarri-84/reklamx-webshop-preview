/**
 * THE STUDIO'S OBJECTS — what goes on the board, and how a customer may handle it
 * (designer v2, the Pixartprinting-style editor).
 *
 * Carried over from the round-16 designer (OnlineDesigner.tsx), unchanged in what
 * they decide: big handles a thumb can hit, pictures cut down on the way in, the
 * shop's locks applied after EVERY load (fabric keeps no lock in its JSON). New:
 *
 *  - a third lock, 'unlockable' — the Pixart default for a template's pictures and
 *    shapes: it does not move by accident, and the customer can unlock it;
 *  - elements from the library (a whitelisted SVG → fabric shapes), recolourable;
 *  - the shop's own pattern background and QR code (rxObjects.ts);
 *  - a picture's ORIGINAL kept beside a colour-edited copy (rxOrigId), so the edit
 *    can be made again from the original rather than from a copy of a copy.
 */
import { Circle, Control, Ellipse, FabricImage, Group, Rect, Textbox, controlsUtils, loadSVGFromString, type FabricObject } from 'fabric';
import { RxPattern, RxQr } from '../rxObjects';
import { fitText } from '../fitText';
import type { PatternSpec } from '../../../../lib/designPatterns';
import type { QrSpec } from '../../../../lib/designQr';
import { CANVAS_MAX_PIXELS, pictureLimits, pictureScale, scaledPictureSize, type PictureDevice } from '../../../../lib/designSize';

/** Board units per millimetre: tenths, so a 1.5 mm caption is a 15-unit font, never a sub-pixel one. */
export const U = 10;

/** Our own properties, carried through fabric's JSON (src/lib/designSchema.ts allows exactly these). */
export const PROPS = [
  'rxImageId', 'rxSlot', 'rxFill', 'rxLock', 'rxOwnLock', 'rxBox', 'rxElement', 'rxOrigId', 'rxAdjust', 'rxCaps', 'rxList', 'rxPattern', 'rxQr', 'rxQrBg',
];

export type Lock = 'words' | 'locked' | 'unlockable';
export type TextBox = { w: number; h: number; fontSize: number };
export type Tagged = FabricObject & {
  rxImageId?: string;
  rxSlot?: boolean;
  rxFill?: boolean;
  rxLock?: Lock;
  /** The customer locked it himself — not the shop's template lock (the check before attaching still judges it). */
  rxOwnLock?: boolean;
  rxBox?: TextBox;
  rxElement?: { lib: string; id: string };
  rxOrigId?: string;
  rxAdjust?: { hue: number; sat: number; bright: number };
  rxCaps?: boolean;
  rxList?: boolean;
};
export type Mode = 'customer' | 'owner';

/**
 * Pictures are cut down on the way in (designSize.ts pictureLimits). On a computer, to
 * what ONE canvas holds on a phone: 8192 px on the long side and 16 777 216 pixels in
 * all — by area, not by the long side alone, which threw away a third of a camera
 * photo's pixels. On a phone or a tablet, to 4096 px on the long side, as before: there
 * each full-size copy by area cost half as much memory again. The colour edits
 * (adjustPicture) draw the whole picture on one canvas, and every picture fits one.
 */
export const MAX_PICTURE_BYTES = 40 * 1024 * 1024;

/**
 * Is this a phone or a tablet — its primary pointer a finger — or a computer? Asked as
 * each picture comes in. Where it cannot be told, a phone: the smaller cut is the safe one.
 */
export function pictureDevice(): PictureDevice {
  try {
    // A computer only when the browser SAYS its pointer is fine: one that cannot
    // answer the question gets the smaller, safer cut.
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches ? 'desktop' : 'touch';
  } catch {
    return 'touch';
  }
}

/** A picture the OWNER puts in a template is downloaded by every customer who picks it: smaller. */
export const OWNER_PICTURE_LIMITS = { maxSide: 4096, maxBytes: 4 * 1024 * 1024 };

/** Colours that print as they look (process mixes inside FOGRA39); anything else is one tap further. */
export const PALETTE = ['#000000', '#ffffff', '#706f6f', '#e30613', '#f39200', '#ffed00', '#009640', '#009fe3', '#1d71b8', '#662483'];
/** A wider set for the colour picker, still printable. */
export const PALETTE_WIDE = [
  '#000000', '#3c3c3b', '#706f6f', '#b2b2b2', '#ededed', '#ffffff',
  '#e30613', '#e6332a', '#ea5b0c', '#f39200', '#fbba00', '#ffed00',
  '#95c11f', '#3aaa35', '#009640', '#008d36', '#00a19a', '#009fe3',
  '#1d71b8', '#2d2e83', '#662483', '#951b81', '#e6007e', '#c8a46e',
];
export const INK = '#111111';

/**
 * PIXART'S TURN HANDLE: a blue disc with two white arrows, on a stem UNDER the object
 * (fabric's sits above it, where the floating bar goes). One control for every object —
 * a Control is settings only.
 */
const TURN_BELOW = new Control({
  x: 0,
  y: 0.5,
  offsetY: 32,
  withConnection: true,
  actionName: 'rotate',
  actionHandler: controlsUtils.rotationWithSnapping,
  cursorStyleHandler: controlsUtils.rotationStyleHandler,
  sizeX: 22,
  sizeY: 22,
  touchSizeX: 40,
  touchSizeY: 40,
  render(ctx, left, top) {
    ctx.save();
    ctx.translate(left, top);
    ctx.fillStyle = '#1174ba';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (const turn of [0, Math.PI]) {
      ctx.save();
      ctx.rotate(turn);
      const from = Math.PI * 1.05;
      const to = Math.PI * 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 5, from, to);
      ctx.stroke();
      // The arrowhead at the arc's end, pointing the way it turns.
      const x = 5 * Math.cos(to);
      const y = 5 * Math.sin(to);
      const dx = -Math.sin(to);
      const dy = Math.cos(to);
      ctx.beginPath();
      ctx.moveTo(x + dx * 2.4, y + dy * 2.4);
      ctx.lineTo(x - dy * 2.2, y + dx * 2.2);
      ctx.lineTo(x + dy * 2.2, y - dx * 2.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },
});

export const newImageId = () => `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Handles and locks, set after EVERY load (fabric keeps no lock in its JSON).
 * `rxLock` is what a CUSTOMER may do: 'locked' — fixed by the shop, cannot be picked
 * up; 'words' — the words may change, nothing else; 'unlockable' — held still against
 * a slip of the hand (a template's pictures and shapes, or the customer's own lock),
 * and the customer may unlock it from the object bar. The owner is never held.
 * `inlineText`: words typed straight into the board (a mouse); on a touch screen they
 * are typed in a sheet above the keyboard instead, which never hides them.
 */
export function dressControls(o: FabricObject, mode: Mode = 'customer', { inlineText = false }: { inlineText?: boolean } = {}) {
  const lock = mode === 'customer' ? (o as Tagged).rxLock : undefined;
  o.set({
    // Fixed by the shop: never picked up; still evented, so a tap lands on IT and says so.
    selectable: lock !== 'locked',
    evented: true,
    hoverCursor: lock === 'locked' ? 'not-allowed' : lock ? 'default' : null,
    lockMovementX: !!lock,
    lockMovementY: !!lock,
    lockScalingX: !!lock,
    lockScalingY: !!lock,
    lockRotation: !!lock,
    hasControls: !lock,
    cornerSize: 12,
    touchCornerSize: 36,
    transparentCorners: false,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#1174ba',
    borderColor: '#1174ba',
    cornerStyle: 'circle',
    borderScaleFactor: 1.5,
    lockSkewingX: true,
    lockSkewingY: true,
    lockScalingFlip: true,
  });
  // The pattern background is the Backgrounds panel's, never picked up on the board: it
  // was so only when first laid (setPattern), and after a reload, an undo or another
  // page it could be grabbed, moved, and shrunk with the size box (second pass, watch).
  if (o instanceof RxPattern) o.set({ selectable: false, evented: false, hoverCursor: null, hasControls: false, lockMovementX: true, lockMovementY: true, lockScalingX: true, lockScalingY: true, lockRotation: true });
  // Each object has its own set of controls (fabric makes one per object).
  o.controls.mtr = TURN_BELOW;
  if (o instanceof Textbox) {
    o.set({ editable: inlineText && lock !== 'locked' && lock !== 'unlockable' });
    o.setControlsVisibility({ mt: false, mb: false });
  } else if (o instanceof FabricImage || (o as Tagged).rxSlot || o instanceof RxQr) {
    o.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
  }
}

/** Is this object held against a customer's hand right now? */
export function isFixed(o: Tagged | null | undefined, mode: Mode): boolean {
  return !!o && mode === 'customer' && !!o.rxLock;
}

/** An empty photo frame from a layout: shown on the board, never printed. */
/** The shapes a photo frame can have (the studio's Masks): what the picture put in it is cut to. */
export type SlotShape = 'rect' | 'rounded' | 'circle' | 'ellipse';

/** The shape a photo frame cuts its picture to — read off its own frame, nothing stored beside it. */
export function slotShape(o: FabricObject): 'none' | 'rounded' | 'circle' | 'ellipse' {
  if (!(o instanceof Group)) return 'none';
  const frame = o.getObjects()[0];
  if (frame instanceof Circle) return 'circle';
  if (frame instanceof Ellipse) return 'ellipse';
  if (frame instanceof Rect && (frame.rx ?? 0) > 0) return 'rounded';
  return 'none';
}

export function makeSlot(cx: number, cy: number, w: number, h: number, shape: boolean | SlotShape, label: string, stroke: number, font: string): Group {
  const kind: SlotShape = shape === true ? 'circle' : shape === false ? 'rect' : shape;
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
  const r = Math.min(w, h) * 0.12;
  const frame =
    kind === 'circle'
      ? new Circle({ ...frameProps, radius: Math.min(w, h) / 2 })
      : kind === 'ellipse'
        ? new Ellipse({ ...frameProps, rx: w / 2, ry: h / 2 })
        : new Rect({ ...frameProps, width: w, height: h, ...(kind === 'rounded' ? { rx: r, ry: r } : {}) });
  const round = kind === 'circle' || kind === 'ellipse';
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

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/** A picture from the device, cut down to what the designer can use on it, and kept as a Blob. */
export async function preparePicture(
  file: Blob,
  limits: { maxSide: number; maxBytes: number; maxPixels?: number } = { ...pictureLimits(pictureDevice()), maxBytes: Infinity },
): Promise<{ blob: Blob; url: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const k = pictureScale(bitmap.width, bitmap.height, limits.maxSide, limits.maxPixels ?? CANVAS_MAX_PIXELS);
    if (k >= 1 && file.size <= limits.maxBytes) {
      return { blob: file, url: URL.createObjectURL(file), width: bitmap.width, height: bitmap.height };
    }
    const canvas = document.createElement('canvas');
    const size = scaledPictureSize(bitmap.width, bitmap.height, k);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no context');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // A picture that can be see-through stays so where it is: a WebP logo on a clear
    // ground, made a JPEG, came out on a BLACK square (code review DSN-19). Looked at
    // once, and only when it matters (a JPEG never has any).
    let clear: boolean | null = null;
    const isClear = () => (clear ??= hasTransparency(ctx, canvas.width, canvas.height));
    const type = file.type === 'image/png' || (file.type !== 'image/jpeg' && isClear()) ? 'image/png' : 'image/jpeg';
    const encode = (as: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, as, 0.9));
    let blob = await encode(type);
    if (blob && blob.size > limits.maxBytes && type === 'image/png' && !isClear()) {
      blob = await encode('image/jpeg');
    }
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('encode');
    return { blob, url: URL.createObjectURL(blob), ...size };
  } finally {
    bitmap.close();
  }
}

/**
 * A colour-edited copy of a picture: hue (degrees), saturation and brightness
 * (−100…100), BAKED into new pixels — fabric's filters are not allowed in a design
 * (src/lib/designSchema.ts) and would differ from the print. ctx.filter where the
 * browser has it; otherwise pixel by pixel.
 */
export async function adjustPicture(source: Blob, adjust: { hue: number; sat: number; bright: number }): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  // The edit keeps every pixel (the picture's crop is counted in them), so a picture
  // past what one canvas holds on a phone is refused here — drawn anyway, it came out
  // EMPTY on an iPhone. Every picture that came in through preparePicture fits.
  if (pictureScale(bitmap.width, bitmap.height) < 1) {
    bitmap.close();
    throw new Error('too large');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no context');
  const css = `hue-rotate(${adjust.hue}deg) saturate(${100 + adjust.sat}%) brightness(${100 + adjust.bright}%)`;
  let viaFilter = false;
  if ('filter' in ctx) {
    ctx.filter = css;
    viaFilter = ctx.filter === css;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  if (!viaFilter) {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    adjustPixels(img.data, adjust);
    ctx.putImageData(img, 0, 0);
  }
  // A see-through WebP keeps its clear parts (as a PNG): a JPEG made them black (DSN-19).
  const clear = source.type !== 'image/png' && source.type !== 'image/jpeg' && hasTransparency(ctx, canvas.width, canvas.height);
  const type = source.type === 'image/png' || clear ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('encode');
  return blob;
}

/** The same three adjustments on raw RGBA, matching the CSS filter functions' matrices. */
export function adjustPixels(data: Uint8ClampedArray, { hue, sat, bright }: { hue: number; sat: number; bright: number }) {
  const a = (hue * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // hue-rotate matrix (W3C filter effects)
  const h = [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.14, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
  const s = 1 + sat / 100;
  const sm = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  const b = 1 + bright / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let bl = data[i + 2];
    [r, g, bl] = [h[0] * r + h[1] * g + h[2] * bl, h[3] * r + h[4] * g + h[5] * bl, h[6] * r + h[7] * g + h[8] * bl];
    [r, g, bl] = [sm[0] * r + sm[1] * g + sm[2] * bl, sm[3] * r + sm[4] * g + sm[5] * bl, sm[6] * r + sm[7] * g + sm[8] * bl];
    data[i] = r * b;
    data[i + 1] = g * b;
    data[i + 2] = bl * b;
  }
}

/** Does this colour put ink on paper? White and near-white do not. */
export function inkColour(colour: unknown): boolean {
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

/** A board object that would print something. */
export function objectLeavesInk(o: Record<string, unknown>): boolean {
  const type = String(o.type ?? '').toLowerCase();
  if (type === 'image' || type === 'rxpattern' || type === 'rxqr') return true;
  if (type === 'group') return Array.isArray(o.objects) && (o.objects as Array<Record<string, unknown>>).some(objectLeavesInk);
  if (type === 'textbox' || type === 'i-text' || type === 'text') return String(o.text ?? '').trim() !== '' && inkColour(o.fill);
  return inkColour(o.fill) || (Number(o.strokeWidth) > 0 && inkColour(o.stroke));
}

/** An element of the library as fabric objects: one object, or a group of its parts. */
export async function elementObject(svg: string, element: { lib: string; id: string }): Promise<FabricObject> {
  const { objects } = await loadSVGFromString(svg);
  const parts = objects.filter((o): o is FabricObject => !!o);
  if (parts.length === 0) throw new Error('empty element');
  const o = parts.length === 1 ? parts[0] : new Group(parts);
  (o as Tagged).rxElement = { lib: element.lib, id: element.id };
  return o;
}

/** Recolour an element: every part painted in `paint` ('fill' or 'stroke') takes the colour. */
export function recolourElement(o: FabricObject, paint: 'fill' | 'stroke', colour: string) {
  const parts = o instanceof Group ? o.getObjects() : [o];
  for (const p of parts) {
    if (paint === 'stroke') p.set('stroke', colour);
    else if (p.fill && p.fill !== 'none' && p.fill !== '') p.set('fill', colour);
  }
  o.set('dirty', true);
}

/** The pattern background: the whole board, bleed included, at the bottom. */
export function patternObject(board: { w: number; h: number }, spec: PatternSpec): RxPattern {
  const p = new RxPattern({ left: 0, top: 0, width: board.w, height: board.h, originX: 'left', originY: 'top', strokeWidth: 0 });
  p.rxPattern = spec;
  return p;
}

export function qrObject(spec: QrSpec, at: { x: number; y: number }, sizeUnits: number, colours: { fg: string; bg: string }): RxQr {
  const q = new RxQr({
    left: at.x,
    top: at.y,
    width: sizeUnits,
    height: sizeUnits,
    originX: 'center',
    originY: 'center',
    fill: colours.fg,
    strokeWidth: 0,
  });
  q.rxQr = spec;
  q.rxQrBg = colours.bg;
  return q;
}
