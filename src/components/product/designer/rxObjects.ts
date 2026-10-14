/**
 * THE SHOP'S OWN KINDS OF OBJECT — a pattern background and a QR code (designer v2).
 *
 * Both are drawn from their PARAMETERS each time they are rendered, at whatever
 * resolution the canvas has at that moment: the screen draws a pattern tile at screen
 * density, the print file draws it again at the file's own DPI, and a QR code is a
 * set of filled squares that is sharp at any size. The JSON holds only the
 * parameters (src/lib/designSchema.ts checks them), never a picture — a fabric
 * Pattern fill would put a data URL into every undo step, and one that came back
 * empty would silently print no background.
 *
 * Registered with fabric's class registry on import: import this module before ANY
 * loadFromJSON (the designer, the print file, thumbnails).
 */
import { Circle, Ellipse, Group, Rect, Textbox, classRegistry, util, type FabricObject } from 'fabric';
import { cleanPatternSpec, drawPatternTile, type PatternSpec } from '../../../lib/designPatterns';
import { cleanQrSpec, qrPath, type QrSpec } from '../../../lib/designQr';

/** Board units per millimetre (OnlineDesigner.tsx). */
const U = 10;

/**
 * Tiles already drawn, by pattern, colours and pixel size: redrawing every frame would
 * be wasteful. Within a PIXEL budget, not only a count: 24 tiles of up to 4096² px were
 * up to 1.6 GB, kept for the life of the page — every print resolution tried added one.
 * A tile bigger than half the budget (a print's) is drawn, used and let go.
 */
const tiles = new Map<string, HTMLCanvasElement>();
const TILE_CACHE = 24;
const TILE_BUDGET_PX = 24 * 1024 * 1024;
let tilePixels = 0;

function tileFor(spec: PatternSpec, px: number): HTMLCanvasElement | null {
  const size = Math.max(4, Math.min(4096, Math.round(px)));
  const key = `${spec.id}|${spec.colours.join(',')}|${size}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  const tile = drawPatternTile(spec, size / spec.scaleMm, () => {
    const c = util.createCanvasElement();
    c.width = size;
    c.height = size;
    return c;
  });
  if (!tile) return null;
  const area = tile.width * tile.height;
  if (area > TILE_BUDGET_PX / 2) return tile;
  tiles.set(key, tile);
  tilePixels += area;
  while (tiles.size > TILE_CACHE || tilePixels > TILE_BUDGET_PX) {
    const oldest = tiles.keys().next().value as string;
    const gone = tiles.get(oldest);
    tiles.delete(oldest);
    if (gone) tilePixels -= gone.width * gone.height;
  }
  return tile;
}

/** Device pixels per local unit on each axis, from the context's current transform. */
function pixelsPerUnit(ctx: CanvasRenderingContext2D): { x: number; y: number } {
  const m = ctx.getTransform();
  return { x: Math.hypot(m.a, m.b) || 1, y: Math.hypot(m.c, m.d) || 1 };
}

export class RxPattern extends Rect {
  static type = 'RxPattern';
  static customProperties = ['rxPattern'];
  declare rxPattern: PatternSpec;

  _render(ctx: CanvasRenderingContext2D) {
    const w = this.width;
    const h = this.height;
    const spec = cleanPatternSpec(this.rxPattern);
    ctx.fillStyle = spec?.colours[0] ?? '#ffffff';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    if (!spec) return;
    // The tile is spec.scaleMm on the BOARD whatever this rectangle's own scale:
    // a background stretched to the bleed must not stretch its dots into ovals.
    const tileLocalX = (spec.scaleMm * U) / Math.abs(this.scaleX || 1);
    const tileLocalY = (spec.scaleMm * U) / Math.abs(this.scaleY || 1);
    const ppu = pixelsPerUnit(ctx);
    const tile = tileFor(spec, tileLocalX * ppu.x);
    if (!tile) return;
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return;
    // Map tile pixels onto local units by scaling the context, then fill the same
    // rectangle in the scaled coordinates — works on every canvas implementation.
    const sx = tileLocalX / tile.width;
    const sy = tileLocalY / tile.height;
    ctx.save();
    ctx.scale(sx, sy);
    ctx.fillStyle = pattern;
    ctx.fillRect(-w / 2 / sx, -h / 2 / sy, w / sx, h / sy);
    ctx.restore();
  }
}

export class RxQr extends Rect {
  static type = 'RxQr';
  static customProperties = ['rxQr', 'rxQrBg'];
  declare rxQr: QrSpec;
  /** The light colour behind the code, quiet zone included ('' = none: the design shows through). */
  declare rxQrBg: string;
  private qrKey = '';
  private qrRuns: Array<[number, number, number]> = [];
  private qrSize = 0;

  /** The dark modules as [x, y, run length], rebuilt only when the text changes. */
  modules(): { size: number; runs: Array<[number, number, number]> } {
    const spec = cleanQrSpec(this.rxQr);
    const key = spec ? `${spec.ecc}|${spec.text}` : '';
    if (key !== this.qrKey) {
      this.qrKey = key;
      this.qrRuns = [];
      this.qrSize = 0;
      const path = spec ? qrPath(spec) : null;
      if (path) {
        this.qrSize = path.size;
        for (const m of path.d.matchAll(/M(\d+) (\d+)h(\d+)/g)) this.qrRuns.push([Number(m[1]), Number(m[2]), Number(m[3])]);
      }
    }
    return { size: this.qrSize, runs: this.qrRuns };
  }

  _render(ctx: CanvasRenderingContext2D) {
    const w = this.width;
    const h = this.height;
    if (this.rxQrBg) {
      ctx.fillStyle = this.rxQrBg;
      ctx.fillRect(-w / 2, -h / 2, w, h);
    }
    const { size, runs } = this.modules();
    if (!size) return;
    const mx = w / size;
    const my = h / size;
    ctx.fillStyle = typeof this.fill === 'string' && this.fill ? this.fill : '#000000';
    // Each run a hair wider than its modules, so neighbouring runs never show a
    // hairline gap between them at a fractional scale.
    for (const [x, y, len] of runs) ctx.fillRect(-w / 2 + x * mx, -h / 2 + y * my, len * mx + 0.01, my + 0.01);
  }
}

/**
 * Text, with the designer's CAPITALS as a style (`rxCaps`): the words stay as typed
 * and are drawn in capitals, so turning it off gives the customer's own casing back.
 * Only letters whose capital is ONE character are changed (ß stays ß): the text being
 * edited and the text drawn must keep the same character positions, or the cursor
 * would land beside the letter typed. Saved as a plain 'Textbox' — every design,
 * print file and thumbnail loads text as this class once this module is imported.
 */
export class RxTextbox extends Textbox {
  static type = 'Textbox';
  declare rxCaps?: boolean;

  _splitTextIntoLines(text: string) {
    if (!this.rxCaps) return super._splitTextIntoLines(text);
    const caps = this.graphemeSplit(text)
      .map((g) => {
        const up = g.toUpperCase();
        return up.length === g.length ? up : g;
      })
      .join('');
    return super._splitTextIntoLines(caps);
  }
}

classRegistry.setClass(RxPattern);
classRegistry.setClass(RxQr);
classRegistry.setClass(RxTextbox, 'Textbox');

/** A rectangle with rounded corners as a path (the studio's "rounded" picture shape). */
function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rx: number, ry: number) {
  ctx.moveTo(x + rx, y);
  ctx.lineTo(x + w - rx, y);
  ctx.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - ry);
  ctx.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
  ctx.lineTo(x + rx, y + h);
  ctx.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + ry);
  ctx.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/**
 * A SHAPED PICTURE IN A PRINT FILE IS CLIPPED ON THE PAGE, NOT THROUGH A CACHE.
 *
 * fabric draws any object that has a clipPath through a cache canvas of its own —
 * whatever objectCaching says — capped at 2 MP, and scales that up into the file: a
 * round photo 300 mm across a 150 dpi roll-up printed at about 120 dpi, 800 mm across
 * at 46, while the check before attaching reported the photo's own resolution. For the
 * print and the export, the clip comes off and the same shape is clipped on the page's
 * own context instead, at the file's resolution. The studio's shapes only (a circle,
 * an oval, rounded corners, centred on the picture); anything else keeps fabric's way.
 * Groups are walked.
 */
export function clipOnThePage(o: FabricObject): void {
  if (o instanceof Group) o.getObjects().forEach(clipOnThePage);
  const clip = o.clipPath as FabricObject | undefined;
  if (!clip || clip.absolutePositioned || clip.inverted || (clip.angle ?? 0) !== 0) return;
  if (clip.originX !== 'center' || clip.originY !== 'center') return;
  const cx = clip.left ?? 0;
  const cy = clip.top ?? 0;
  const sx = clip.scaleX ?? 1;
  const sy = clip.scaleY ?? 1;
  let shape: ((ctx: CanvasRenderingContext2D) => void) | null = null;
  if (clip instanceof Circle) {
    const r = clip.radius;
    shape = (ctx) => ctx.ellipse(cx, cy, r * sx, r * sy, 0, 0, Math.PI * 2);
  } else if (clip instanceof Ellipse) {
    const { rx, ry } = clip;
    shape = (ctx) => ctx.ellipse(cx, cy, rx * sx, ry * sy, 0, 0, Math.PI * 2);
  } else if (clip instanceof Rect) {
    const w = clip.width * sx;
    const h = clip.height * sy;
    const rx = Math.min(Math.max(0, (clip.rx ?? 0) * sx), w / 2);
    const ry = Math.min(Math.max(0, (clip.ry ?? 0) * sy), h / 2);
    shape = (ctx) => roundedRectPath(ctx, cx - w / 2, cy - h / 2, w, h, rx, ry);
  }
  if (!shape) return;
  o.clipPath = undefined;
  const target = o as unknown as { _render: (ctx: CanvasRenderingContext2D) => void };
  const render = target._render.bind(o);
  target._render = (ctx: CanvasRenderingContext2D) => {
    ctx.save();
    ctx.beginPath();
    shape!(ctx);
    ctx.clip();
    render(ctx);
    ctx.restore();
  };
}
