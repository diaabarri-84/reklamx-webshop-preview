/**
 * A SIDE MOVED TO ANOTHER SIZE OR BLEED — designer v2.
 *
 * A draft or an owner's template made at one size, opened at another (the customer
 * changed the size, or the owner's template fits within its 2 % / 0.85–2× rule —
 * src/lib/designTemplateMatch.ts). Each object's CENTRE keeps its place relative to
 * the TRIM (never the board's corner: from the corner, an element on the old trim
 * edge landed in the new bleed and was cut off), and:
 *
 *  - a rectangle follows each axis, so a band across the board still reaches both
 *    edges after a small change of proportions (a uniform scale left a white sliver);
 *  - a background picture (`rxFill`) covers the whole new board, bleed included;
 *  - the pattern background is the whole new board, exactly;
 *  - everything else — text, pictures, shapes, groups — keeps its shape and is
 *    scaled by the smaller of the two factors.
 *
 * A change of BLEED alone (the owner set 5 mm where the draft had 3) moves nothing
 * relative to the trim and scales nothing. Pure; scripts/test-design-refit.mjs.
 */

export interface BoardGeometry {
  trimMm: { wMm: number; hMm: number };
  bleedMm: number;
}

type Obj = Record<string, unknown>;

const ORIGIN: Record<string, number> = { left: -0.5, top: -0.5, center: 0, right: 0.5, bottom: 0.5 };
const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function sameGeometry(a: BoardGeometry, b: BoardGeometry): boolean {
  return (
    Math.abs(a.trimMm.wMm - b.trimMm.wMm) < 0.01 &&
    Math.abs(a.trimMm.hMm - b.trimMm.hMm) < 0.01 &&
    Math.abs(a.bleedMm - b.bleedMm) < 0.001
  );
}

/** The object's centre in board units, from its origin point, size, scale and angle. */
function centreOf(o: Obj): { x: number; y: number } {
  const w = n(o.width, 0) * n(o.scaleX, 1);
  const h = n(o.height, 0) * n(o.scaleY, 1);
  const ox = ORIGIN[String(o.originX ?? 'center')] ?? 0;
  const oy = ORIGIN[String(o.originY ?? 'center')] ?? 0;
  const a = (n(o.angle, 0) * Math.PI) / 180;
  // The origin point sits at (ox·w, oy·h) from the centre, turned with the object.
  const dx = ox * w * Math.cos(a) - oy * h * Math.sin(a);
  const dy = ox * w * Math.sin(a) + oy * h * Math.cos(a);
  return { x: n(o.left, 0) - dx, y: n(o.top, 0) - dy };
}

/** Put the object's origin point where it must be for its centre to be at (cx, cy). */
function placeCentre(o: Obj, cx: number, cy: number) {
  const w = n(o.width, 0) * n(o.scaleX, 1);
  const h = n(o.height, 0) * n(o.scaleY, 1);
  const ox = ORIGIN[String(o.originX ?? 'center')] ?? 0;
  const oy = ORIGIN[String(o.originY ?? 'center')] ?? 0;
  const a = (n(o.angle, 0) * Math.PI) / 180;
  o.left = cx + ox * w * Math.cos(a) - oy * h * Math.sin(a);
  o.top = cy + ox * w * Math.sin(a) + oy * h * Math.cos(a);
}

/**
 * The side's objects for the new geometry. `unitsPerMm`: board units per mm (10).
 * Returns the same string when nothing changes; null when it is not a side.
 */
export function refitSideJson(json: string, from: BoardGeometry, to: BoardGeometry, unitsPerMm = 10): string | null {
  let data: { objects?: unknown } & Obj;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.objects)) return null;
  if (sameGeometry(from, to)) return json;
  const U = unitsPerMm;
  const fw = from.trimMm.wMm;
  const fh = from.trimMm.hMm;
  if (!(fw > 0 && fh > 0)) return json;
  const sx = to.trimMm.wMm / fw;
  const sy = to.trimMm.hMm / fh;
  const s = Math.min(sx, sy);
  const board = { w: (to.trimMm.wMm + 2 * to.bleedMm) * U, h: (to.trimMm.hMm + 2 * to.bleedMm) * U };
  const fb = from.bleedMm * U;
  const tb = to.bleedMm * U;
  const objects = (data.objects as unknown[]).map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const o: Obj = { ...(raw as Obj) };
    const type = String(o.type ?? '').toLowerCase();
    if (type === 'rxpattern') {
      Object.assign(o, { left: 0, top: 0, originX: 'left', originY: 'top', width: board.w, height: board.h, scaleX: 1, scaleY: 1, angle: 0 });
      return o;
    }
    if (type === 'image' && o.rxFill === true) {
      const w = n(o.width, 1) || 1;
      const h = n(o.height, 1) || 1;
      const k = Math.max(board.w / w, board.h / h);
      Object.assign(o, { originX: 'center', originY: 'center', left: board.w / 2, top: board.h / 2, scaleX: k, scaleY: k, angle: 0 });
      return o;
    }
    const c = centreOf(o);
    const nx = (c.x - fb) * sx + tb;
    const ny = (c.y - fb) * sy + tb;
    if (type === 'rect') {
      o.scaleX = n(o.scaleX, 1) * sx;
      o.scaleY = n(o.scaleY, 1) * sy;
    } else {
      o.scaleX = n(o.scaleX, 1) * s;
      o.scaleY = n(o.scaleY, 1) * s;
    }
    placeCentre(o, nx, ny);
    return o;
  });
  return JSON.stringify({ ...data, objects });
}
