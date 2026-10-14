/**
 * WHAT THE CHECK BEFORE ATTACHING LOOKS FOR on a printed side, read from the side's
 * own JSON (ProofView.tsx says it to the customer). Pure and in board units, so it is
 * tested without a board: scripts/test-proof-checks.mjs.
 */
import { cleanQrSpec, qrPath } from '../../../../lib/designQr';
import { QR_MIN_CONTRAST, QR_MIN_MODULE_MM, contrastRatio } from '../../../../lib/qrPayload';
import type { OutlineKind } from '../../../../lib/shapes';
import { objectLeavesInk } from './studioObjects';

type Obj = Record<string, unknown>;
type Pt = { x: number; y: number };

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const typeOf = (o: Obj) => String(o?.type ?? '').toLowerCase();

/** The four corners of a serialised object (centre ± its turned half-size), in board units. */
export function cornersOf(o: Obj): Pt[] {
  const w = num(o.width, 0) * Math.abs(num(o.scaleX, 1));
  const h = num(o.height, 0) * Math.abs(num(o.scaleY, 1));
  const origin: Record<string, number> = { left: -0.5, top: -0.5, center: 0, right: 0.5, bottom: 0.5 };
  const ox = origin[String(o.originX ?? 'center')] ?? 0;
  const oy = origin[String(o.originY ?? 'center')] ?? 0;
  const a = (num(o.angle, 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const cx = num(o.left, 0) - (ox * w * cos - oy * h * sin);
  const cy = num(o.top, 0) - (ox * w * sin + oy * h * cos);
  return [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ].map(([dx, dy]) => ({ x: cx + dx * w * cos - dy * h * sin, y: cy + dx * w * sin + dy * h * cos }));
}

const centreOf = (o: Obj): Pt => {
  const c = cornersOf(o);
  return { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
};

/** Is a point inside an object's (turned) box? On the same side of all four edges. */
function covers(o: Obj, p: Pt): boolean {
  if (!(num(o.width, 0) > 0 && num(o.height, 0) > 0)) return false;
  const c = cornersOf(o);
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    const cross = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    if (cross === 0) continue;
    if (sign === 0) sign = cross;
    else if (cross !== sign) return false;
  }
  return true;
}

/**
 * The colour under the middle of objects[index]: the first solid shape beneath it that
 * covers that point, else the page's own background. Null when what is there is a
 * picture, a pattern, a see-through shape or an element of several colours — nothing
 * can be said about its contrast then.
 */
function colourBehind(objects: Obj[], index: number, background: unknown): string | null {
  const p = centreOf(objects[index]);
  for (let i = index - 1; i >= 0; i -= 1) {
    const o = objects[i];
    // An empty photo frame is not printed; words are letters, not a ground.
    if (o.visible === false || o.rxSlot) continue;
    const type = typeOf(o);
    if (type === 'textbox' || type === 'i-text' || type === 'text') continue;
    if (!covers(o, p)) continue;
    if (type === 'image' || type === 'rxpattern' || type === 'group' || type === 'rxqr') return null;
    const fill = typeof o.fill === 'string' ? o.fill.trim() : '';
    if (!fill || fill === 'transparent' || fill === 'none') continue;
    return num(o.opacity, 1) < 1 ? null : fill;
  }
  return typeof background === 'string' && background ? background : '#ffffff';
}

/**
 * How many QR codes on a side a phone may not read: squares (modules) under 0.3 mm, or
 * under 3:1 contrast against what is behind them — its own light background, else the
 * shape or page under it. A white code on a dark ground reads, and is not counted.
 */
export function weakQrCodes(objects: Obj[], background: unknown, unitsPerMm: number): number {
  let weak = 0;
  objects.forEach((o, i) => {
    if (typeOf(o) !== 'rxqr' || o.visible === false) return;
    const spec = cleanQrSpec(o.rxQr);
    const path = spec ? qrPath(spec) : null;
    if (!path) return;
    // The quiet zone is part of the code's box: `size` modules across all of it.
    const sideMm = Math.min(num(o.width, 0) * Math.abs(num(o.scaleX, 1)), num(o.height, 0) * Math.abs(num(o.scaleY, 1))) / unitsPerMm;
    const small = sideMm / path.size < QR_MIN_MODULE_MM - 1e-9;
    const ground = typeof o.rxQrBg === 'string' && o.rxQrBg ? o.rxQrBg : colourBehind(objects, i, background);
    const ink = typeof o.fill === 'string' && o.fill ? o.fill : '#000000';
    const ratio = ground === null ? null : contrastRatio(ink, ground);
    if (small || (ratio !== null && ratio < QR_MIN_CONTRAST)) weak += 1;
  });
  return weak;
}

/** How close to the cut line an edge may end before a cut a hair off shows it, mm (either side). */
export const EDGE_AT_CUT_MM = 1;

/**
 * How many inked things on a side END AT THE CUT: an edge within ±1 mm of the trim
 * line. Cut a hair off, a thin white sliver shows there, or the shape's own edge is
 * shaved off (code review DSN-07). Words have their own warning (the safe area); an
 * empty photo frame does not print. Nothing LOCKED is judged: the shop's own shapes
 * come held in its templates and starters ('unlockable'), placed as the shop meant
 * them — a burst that meets the cut is the design, and warning about it told the
 * customer the shop's design was faulty (second pass #2). Once he unlocks one it is
 * his, and judged; what he locked himself he placed on purpose. Skipped on a round
 * or oval cut, which meets its box at four points only.
 */
export function edgesAtCut(
  objects: Obj[],
  trim: { x: number; y: number; w: number; h: number },
  unitsPerMm: number,
  outline: OutlineKind | null,
): number {
  if (outline === 'circle' || outline === 'ellipse') return 0;
  const tol = EDGE_AT_CUT_MM * unitsPerMm;
  const near = (v: number, line: number) => Math.abs(v - line) <= tol;
  const right = trim.x + trim.w;
  const bottom = trim.y + trim.h;
  let count = 0;
  for (const o of objects) {
    const type = typeOf(o);
    // The shop's own template objects are left alone; an object the CUSTOMER locked is
    // still his, and still judged.
    if (o.visible === false || o.rxSlot || (o.rxLock && !o.rxOwnLock)) continue;
    if (type === 'textbox' || type === 'i-text' || type === 'text' || !objectLeavesInk(o)) continue;
    const c = cornersOf(o);
    const x0 = Math.min(...c.map((p) => p.x));
    const x1 = Math.max(...c.map((p) => p.x));
    const y0 = Math.min(...c.map((p) => p.y));
    const y1 = Math.max(...c.map((p) => p.y));
    // An edge counts where it runs along the page, not out in the bleed beside it.
    const alongY = Math.min(y1, bottom) - Math.max(y0, trim.y) > tol;
    const alongX = Math.min(x1, right) - Math.max(x0, trim.x) > tol;
    const atSide = alongY && [x0, x1].some((x) => near(x, trim.x) || near(x, right));
    const atTopOrFoot = alongX && [y0, y1].some((y) => near(y, trim.y) || near(y, bottom));
    if (atSide || atTopOrFoot) count += 1;
  }
  return count;
}
