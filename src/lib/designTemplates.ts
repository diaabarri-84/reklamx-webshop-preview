/**
 * THE READY-MADE STARTING LAYOUTS of the online designer — round 16, item 5.
 *
 * The catalogue has always sold "Design online from a ready-made template", so
 * the designer opens on a choice of layouts, not a blank board: built for ANY
 * size and shape from proportions, never from pixels, so a 50 mm round sticker
 * and an A3 poster both get a layout that fits. (Templates the owner designs
 * himself come later.)
 *
 * Everything is placed inside the SAFE AREA — inside the cut line, 3 mm in —
 * because text that touches the cut is text the cutter takes off. For a shape
 * that is not a rectangle the safe area is a box inside the shape (a circle's
 * inscribed square, and so on).
 *
 * Pure, in millimetres; the designer turns it into fabric objects. Language-free:
 * the caller passes the words. scripts/test-design-templates.mjs.
 */
import { needsSquareBox, type OutlineKind } from './shapes.js';

export interface Box {
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
}

/** How far inside the cut line nothing important should go. */
export const SAFE_MARGIN_MM = 3;

const inset = (b: Box, m: number): Box => ({ xMm: b.xMm + m, yMm: b.yMm + m, wMm: Math.max(0, b.wMm - 2 * m), hMm: Math.max(0, b.hMm - 2 * m) });

/**
 * The box inside the shape where text and pictures are safe. The geometry
 * follows outlinePath (src/lib/shapes.ts): square-box kinds are drawn in the
 * largest centred square; the fractions are each shape's inscribed area.
 */
export function safeBox(outline: OutlineKind | null | undefined, wMm: number, hMm: number, marginMm = SAFE_MARGIN_MM): Box {
  const W = Math.max(0, wMm);
  const H = Math.max(0, hMm);
  const kind = outline ?? 'rect';
  const s = Math.min(W, H);
  const square: Box = { xMm: (W - s) / 2, yMm: (H - s) / 2, wMm: s, hMm: s };
  // A centred square of `f` × the square box's side, its centre moved by (dx, dy) × side.
  const centred = (f: number, dy = 0): Box => ({
    xMm: square.xMm + (s * (1 - f)) / 2,
    yMm: square.yMm + (s * (1 - f)) / 2 + dy * s,
    wMm: s * f,
    hMm: s * f,
  });
  let box: Box;
  switch (kind) {
    case 'circle':
      box = centred(Math.SQRT1_2);
      break;
    case 'seal':
      box = centred(0.86 * Math.SQRT1_2);
      break;
    case 'ellipse':
      box = { xMm: (W - W * Math.SQRT1_2) / 2, yMm: (H - H * Math.SQRT1_2) / 2, wMm: W * Math.SQRT1_2, hMm: H * Math.SQRT1_2 };
      break;
    case 'hexagon':
      box = centred(0.6);
      break;
    case 'triangle':
      // Point up: the room is low in the shape.
      box = centred(0.42, 0.14);
      break;
    case 'star':
      box = centred(0.24);
      break;
    case 'heart':
      box = centred(0.42, -0.04);
      break;
    case 'stadium': {
      const r = Math.min(W, H) / 2;
      box = W >= H
        ? { xMm: 0.4 * r, yMm: 0.2 * r, wMm: W - 0.8 * r, hMm: H - 0.4 * r }
        : { xMm: 0.2 * r, yMm: 0.4 * r, wMm: W - 0.4 * r, hMm: H - 0.8 * r };
      break;
    }
    case 'half_circle': {
      const r = Math.min(W / 2, H);
      const base = (H + r) / 2;
      box = { xMm: W / 2 - r * Math.SQRT1_2, yMm: base - r * Math.SQRT1_2, wMm: r * Math.SQRT2, hMm: r * Math.SQRT1_2 };
      break;
    }
    case 'arch': {
      const ry = Math.min(W / 2, H);
      box = { xMm: 0.15 * W, yMm: 0.3 * ry, wMm: 0.7 * W, hMm: H - 0.3 * ry };
      break;
    }
    case 'leaf':
      box = inset({ xMm: 0, yMm: 0, wMm: W, hMm: H }, 0.15 * s);
      break;
    case 'plaque':
    case 'rect_scalloped':
      box = inset({ xMm: 0, yMm: 0, wMm: W, hMm: H }, 0.08 * s);
      break;
    case 'square':
      box = square;
      break;
    default:
      // rect, custom (his own cut line is in his file), anything unknown.
      box = needsSquareBox(kind) ? square : { xMm: 0, yMm: 0, wMm: W, hMm: H };
  }
  return inset(box, marginMm);
}

export type TemplateId = 'blank' | 'headline' | 'photo-caption' | 'centred-logo';
export const DESIGN_TEMPLATES: readonly TemplateId[] = ['blank', 'headline', 'photo-caption', 'centred-logo'];

export type DesignElement =
  | { type: 'text'; role: 'headline' | 'subline' | 'caption'; text: string; box: Box; fontSizeMm: number; bold: boolean; align: 'center' }
  | { type: 'image-slot'; box: Box; round: boolean };

/**
 * A layout, inside the safe area. Font sizes follow the box, so a headline on a
 * business card and on a poster have the same proportion to the product.
 */
export function templateLayout(
  id: TemplateId,
  board: { wMm: number; hMm: number; outline?: OutlineKind | null },
  words: { headline: string; subline: string; caption: string },
): DesignElement[] {
  const safe = safeBox(board.outline, board.wMm, board.hMm);
  // A safe area under 4 mm across (a star on a narrow label) has no room for
  // readable text: such a product starts blank rather than with a layout that
  // could only overflow its cut line.
  if (id === 'blank' || Math.min(safe.wMm, safe.hMm) < 4) return [];
  const short = Math.min(safe.wMm, safe.hMm);
  const band = (top: number, height: number): Box => ({ xMm: safe.xMm, yMm: safe.yMm + safe.hMm * top, wMm: safe.wMm, hMm: safe.hMm * height });
  // The font height follows the box it sits in, capped by the safe area's
  // smaller side so a long thin product does not get a headline taller than it.
  const font = (box: Box, share: number) => Math.max(1.5, Math.min(box.hMm * share, short * 0.3));
  if (id === 'headline') {
    const h = band(0.18, 0.4);
    const s = band(0.62, 0.22);
    return [
      { type: 'text', role: 'headline', text: words.headline, box: h, fontSizeMm: font(h, 0.6), bold: true, align: 'center' },
      { type: 'text', role: 'subline', text: words.subline, box: s, fontSizeMm: font(s, 0.55), bold: false, align: 'center' },
    ];
  }
  if (id === 'photo-caption') {
    const photo = band(0, 0.7);
    const c = band(0.76, 0.24);
    return [
      { type: 'image-slot', box: photo, round: false },
      { type: 'text', role: 'caption', text: words.caption, box: c, fontSizeMm: font(c, 0.55), bold: false, align: 'center' },
    ];
  }
  // centred-logo: a square picture slot in the middle, one line under it.
  const side = Math.min(safe.wMm, safe.hMm * 0.62);
  const logo: Box = { xMm: safe.xMm + (safe.wMm - side) / 2, yMm: safe.yMm + safe.hMm * 0.05, wMm: side, hMm: side };
  const lineTop = logo.yMm + side + safe.hMm * 0.05;
  const line: Box = { xMm: safe.xMm, yMm: lineTop, wMm: safe.wMm, hMm: Math.max(0, safe.yMm + safe.hMm - lineTop) };
  return [
    { type: 'image-slot', box: logo, round: board.outline === 'circle' || board.outline === 'ellipse' || board.outline === 'seal' },
    { type: 'text', role: 'subline', text: words.subline, box: line, fontSizeMm: font(line, 0.55), bold: true, align: 'center' },
  ];
}
