/**
 * THE MARKS OVER THE BOARD — the studio's guides (designer v2), drawn as Pixartprinting's
 * Designer draws them (the owner's "exactly like it", 2026-10-07).
 *
 * Drawn by fabric as the canvas's OVERLAY: after the design, before the handles
 * (`controlsAboveOverlay`), so a picture dragged half off the page still shows
 * every handle crisp on top. Never part of the design: the overlay is not in the
 * JSON (`excludeFromExport`), and the print file is drawn from the JSON in a
 * scene of its own (printFile.ts, exportDesign.ts) — this canvas is never exported.
 *
 *  - outside the board: the work area's own pale grey — the page is the board, bleed
 *    and all, as Pixart shows it;
 *  - the cut line: a thin magenta line; the safe area: a thin green one — with their
 *    names on two labels above the board's top right ("Cut", "Safe area");
 *  - a shaped cut (a circle, an oval): what falls outside the shape, faded;
 *  - hidden zones (a roll-up's foot in its cassette, its top under the rail):
 *    hatched, with what hides them;
 *  - the board's size with its bleed: rulers along the left and the foot; on a phone,
 *    the page number and the size under the board.
 * In PREVIEW the product as it comes off the cutter: everything outside the cut is
 * work area, and no marks.
 *
 * Line widths and lettering are constant on SCREEN at any zoom: `pxPerUnit` is set
 * by the engine whenever the view changes.
 */
import { FabricObject } from 'fabric';
import { outlinePath, type OutlineKind } from '../../../../lib/shapes';
import type { Margins } from '../../../../lib/printSpec';

export interface OverlayGeometry {
  board: { w: number; h: number };
  trim: { x: number; y: number; w: number; h: number };
  outline: OutlineKind | null;
  /** Board units. */
  safe: number;
  /** Board units, inward from each trim edge. */
  hidden: Margins;
  /** Words for the zones, the guides and the board's size, in the customer's language. */
  labels: { hidden: string; cut: string; safe: string; boardW: string; boardH: string; boardSize: string };
}

/** Pixart's work area, and its guides' colours (sampled from its own screens). */
export const WORKSPACE = '#f7f7f7';
const CUT_LINE = '#f818f9';
const CUT_CHIP = '#ff00ff';
const SAFE_LINE = '#8ef262';
const SAFE_CHIP = '#82e955';
const RULER = '#31414c';
/** Pixart's rulers are a pale line under a dark measure. */
const RULER_LINE = '#cfd2d4';
const UI_FONT = '"RX Montserrat", "RX Inter", system-ui, sans-serif';

export class StudioOverlay extends FabricObject {
  geometry: OverlayGeometry;
  /** CSS pixels per board unit, now. */
  pxPerUnit = 1;
  preview = false;
  /** A phone: page number and size under the board, no rulers. */
  compact = false;
  /** "01", "02": the page on the board. */
  page = '01';
  /** Pixart's "Ruler" switch (Settings): the board's measures along its left and foot. */
  rulers = true;
  private cut: Path2D;

  constructor(geometry: OverlayGeometry) {
    super({ selectable: false, evented: false, objectCaching: false, excludeFromExport: true });
    this.geometry = geometry;
    this.cut = new Path2D(outlinePath(geometry.outline ?? 'rect', geometry.trim.w, geometry.trim.h));
  }

  setGeometry(geometry: OverlayGeometry) {
    this.geometry = geometry;
    this.cut = new Path2D(outlinePath(geometry.outline ?? 'rect', geometry.trim.w, geometry.trim.h));
  }

  /** Drawn straight onto the canvas: no cache, no off-screen test (it covers everything). */
  render(ctx: CanvasRenderingContext2D) {
    ctx.save();
    try {
      this.draw(ctx);
    } finally {
      ctx.restore();
    }
  }

  private draw(ctx: CanvasRenderingContext2D) {
    const { board, trim, safe, hidden, labels } = this.geometry;
    const px = (n: number) => n / (this.pxPerUnit || 1);
    // The visible area in board units, from the context's own transform.
    const inv = ctx.getTransform().invertSelf();
    const a = inv.transformPoint(new DOMPoint(0, 0));
    const b = inv.transformPoint(new DOMPoint(ctx.canvas.width, ctx.canvas.height));
    const view = { x: Math.min(a.x, b.x) - 10, y: Math.min(a.y, b.y) - 10, w: Math.abs(b.x - a.x) + 20, h: Math.abs(b.y - a.y) + 20 };

    const cutOnBoard = new Path2D();
    cutOnBoard.addPath(this.cut, new DOMMatrix([1, 0, 0, 1, trim.x, trim.y]));

    if (this.preview) {
      // Only the product, as it comes off the cutter.
      const outside = new Path2D();
      outside.rect(view.x, view.y, view.w, view.h);
      outside.addPath(cutOnBoard);
      ctx.fillStyle = WORKSPACE;
      ctx.fill(outside, 'evenodd');
      ctx.strokeStyle = 'rgba(15,23,42,0.18)';
      ctx.lineWidth = px(1);
      ctx.stroke(cutOnBoard);
      return;
    }

    // Outside the board: the work area.
    const outside = new Path2D();
    outside.rect(view.x, view.y, view.w, view.h);
    outside.rect(0, 0, board.w, board.h);
    ctx.fillStyle = WORKSPACE;
    ctx.fill(outside, 'evenodd');

    // A shaped cut: what falls outside the shape is cut away — faded.
    if ((this.geometry.outline ?? 'rect') !== 'rect') {
      const off = new Path2D();
      off.rect(0, 0, board.w, board.h);
      off.addPath(cutOnBoard);
      ctx.fillStyle = 'rgba(247,247,247,0.72)';
      ctx.fill(off, 'evenodd');
    }

    // Hidden zones: hatched, with what hides them.
    const zones: Array<{ x: number; y: number; w: number; h: number; mm: number }> = [];
    if (hidden.top > 0) zones.push({ x: trim.x, y: trim.y, w: trim.w, h: hidden.top, mm: hidden.top });
    if (hidden.bottom > 0) zones.push({ x: trim.x, y: trim.y + trim.h - hidden.bottom, w: trim.w, h: hidden.bottom, mm: hidden.bottom });
    if (hidden.left > 0) zones.push({ x: trim.x, y: trim.y, w: hidden.left, h: trim.h, mm: hidden.left });
    if (hidden.right > 0) zones.push({ x: trim.x + trim.w - hidden.right, y: trim.y, w: hidden.right, h: trim.h, mm: hidden.right });
    for (const z of zones) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(z.x, z.y, z.w, z.h);
      ctx.clip();
      ctx.fillStyle = 'rgba(71,85,105,0.22)';
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeStyle = 'rgba(71,85,105,0.35)';
      ctx.lineWidth = px(1);
      const step = px(10);
      ctx.beginPath();
      for (let d = -z.h; d < z.w + z.h; d += step) {
        ctx.moveTo(z.x + d, z.y);
        ctx.lineTo(z.x + d + z.h, z.y + z.h);
      }
      ctx.stroke();
      ctx.restore();
      const size = px(11);
      if (z.h > size * 2.2 && z.w > size * 6) {
        ctx.font = `700 ${size}px ${UI_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const text = `${labels.hidden} · ${Math.round(z.mm / 10)} mm`;
        const tw = ctx.measureText(text).width + px(12);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillRect(z.x + z.w / 2 - tw / 2, z.y + z.h / 2 - size * 0.9, tw, size * 1.8);
        ctx.fillStyle = '#334155';
        ctx.fillText(text, z.x + z.w / 2, z.y + z.h / 2);
      }
    }

    // The safe area: a thin green line.
    if (safe > 0 && trim.w > 2 * safe && trim.h > 2 * safe) {
      const inner = new Path2D();
      inner.addPath(new Path2D(outlinePath(this.geometry.outline ?? 'rect', trim.w - 2 * safe, trim.h - 2 * safe)), new DOMMatrix([1, 0, 0, 1, trim.x + safe, trim.y + safe]));
      ctx.lineWidth = px(1);
      ctx.strokeStyle = SAFE_LINE;
      ctx.stroke(inner);
    }

    // The cut line: a thin magenta one.
    ctx.lineWidth = px(1);
    ctx.strokeStyle = CUT_LINE;
    ctx.stroke(cutOnBoard);

    // Their names, on two labels over the board's top right.
    const chipH = px(27);
    const chipFont = px(13);
    const chipPad = px(12);
    ctx.font = `700 ${chipFont}px ${UI_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const chips: Array<{ text: string; bg: string; fg: string }> = [
      { text: labels.cut, bg: CUT_CHIP, fg: '#ffffff' },
      { text: labels.safe, bg: SAFE_CHIP, fg: '#1d1d1d' },
    ];
    let right = board.w;
    const chipTop = -px(6) - chipH;
    for (const chip of [...chips].reverse()) {
      const w = ctx.measureText(chip.text).width + 2 * chipPad;
      const x = right - w;
      ctx.fillStyle = chip.bg;
      // A pill by hand: roundRect is missing on the older iPhones a customer may have.
      const r = chipH / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, chipTop);
      ctx.lineTo(x + w - r, chipTop);
      ctx.arc(x + w - r, chipTop + r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x + r, chipTop + chipH);
      ctx.arc(x + r, chipTop + r, r, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = chip.fg;
      ctx.fillText(chip.text, x + w / 2, chipTop + chipH / 2 + px(0.5));
      right = x - px(16);
    }

    const size = px(13);
    ctx.font = `500 ${size}px ${UI_FONT}`;
    if (this.compact) {
      // A phone: the page and the board's size, under the board.
      ctx.fillStyle = '#1d1d1d';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(this.page, 0, board.h + px(10));
      ctx.textAlign = 'right';
      ctx.fillText(labels.boardSize, board.w, board.h + px(10));
      return;
    }

    // Rulers: the board's height along its left, its width along its foot.
    if (!this.rulers) return;
    ctx.font = `400 ${px(14)}px ${UI_FONT}`;
    ctx.strokeStyle = RULER_LINE;
    ctx.lineWidth = px(1.5);
    const rx = -px(32);
    const ry = board.h + px(18);
    ctx.beginPath();
    ctx.moveTo(rx, 0);
    ctx.lineTo(rx, board.h);
    ctx.moveTo(0, ry);
    ctx.lineTo(board.w, ry);
    ctx.stroke();
    ctx.fillStyle = RULER;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tag = (text: string, x: number, y: number) => {
      const w = ctx.measureText(text).width + px(8);
      ctx.fillStyle = WORKSPACE;
      ctx.fillRect(x - w / 2, y - px(10), w, px(20));
      ctx.fillStyle = RULER;
      ctx.fillText(text, x, y);
    };
    tag(labels.boardH, rx, board.h / 2);
    tag(labels.boardW, board.w / 2, ry);
  }
}
