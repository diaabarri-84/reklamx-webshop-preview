/**
 * BACKGROUND PATTERNS for the online designer — drawn, never downloaded.
 *
 * A pattern is a TILE drawn by code from two colours, so it is sharp at any print
 * resolution: the screen draws the tile at screen density, the print file draws it
 * again at the file's own DPI. The design stores only `rxPattern {id, colours,
 * scaleMm}` on its background rectangle — never the picture of a tile — so the
 * server's template cleaner can check the id against this list and nothing else
 * travels in the JSON.
 *
 * Every tile wraps: a shape crossing an edge is drawn again on the opposite side,
 * so the tiles join without a seam. Randomness (bubbles, confetti) is seeded and
 * therefore the same on every device and in the print file.
 *
 * Pure (works on any CanvasRenderingContext2D: the browser's, node-canvas in tests).
 */

export type PatternCategory = 'geometric' | 'organic' | 'playful' | 'classic';

export interface PatternDef {
  id: string;
  category: PatternCategory;
  /** English name; the screen translates by id (dsgPattern_<id>) where a key exists. */
  label: string;
  /** The tile's size in mm at scale 1. */
  tileMm: number;
  /** Draw one tile of w × h px: background already filled with colours[0]. */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, fg: string) => void;
}

/** A tiny seeded generator (mulberry32): same numbers everywhere. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw `shape` at (x, y) and again wherever it crosses the tile's edges. */
function wrap(w: number, h: number, x: number, y: number, r: number, shape: (cx: number, cy: number) => void) {
  for (const dx of [-w, 0, w]) {
    for (const dy of [-h, 0, h]) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > h) continue;
      shape(cx, cy);
    }
  }
}

const circle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

const starPath = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, inner = 0.45, points = 5) => {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const rr = i % 2 ? r * inner : r;
    const a = -Math.PI / 2 + (Math.PI / points) * i;
    const px = x + rr * Math.cos(a);
    const py = y + rr * Math.sin(a);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
};

const heartPath = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.35);
  ctx.bezierCurveTo(x - s * 0.55, y - s * 0.1, x - s * 0.3, y - s * 0.55, x, y - s * 0.25);
  ctx.bezierCurveTo(x + s * 0.3, y - s * 0.55, x + s * 0.55, y - s * 0.1, x, y + s * 0.35);
  ctx.fill();
};

export const PATTERNS: readonly PatternDef[] = [
  // ---- geometric ----
  {
    id: 'dots', category: 'geometric', label: 'Polka dots', tileMm: 10,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const r = w * 0.16;
      wrap(w, h, w * 0.25, h * 0.25, r, (x, y) => circle(ctx, x, y, r));
      wrap(w, h, w * 0.75, h * 0.75, r, (x, y) => circle(ctx, x, y, r));
    },
  },
  {
    id: 'dots-small', category: 'geometric', label: 'Small dots', tileMm: 5,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      circle(ctx, w / 2, h / 2, w * 0.12);
    },
  },
  {
    id: 'grid', category: 'geometric', label: 'Grid', tileMm: 8,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const t = Math.max(1, w * 0.06);
      ctx.fillRect(0, 0, w, t);
      ctx.fillRect(0, 0, t, h);
    },
  },
  {
    id: 'checks', category: 'geometric', label: 'Checks', tileMm: 12,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, w / 2, h / 2);
      ctx.fillRect(w / 2, h / 2, w / 2, h / 2);
    },
  },
  {
    id: 'stripes-diagonal', category: 'geometric', label: 'Diagonal stripes', tileMm: 8,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      for (const o of [-w, 0, w]) {
        ctx.beginPath();
        ctx.moveTo(o, h);
        ctx.lineTo(o + w * 0.5, h);
        ctx.lineTo(o + w * 1.5, 0);
        ctx.lineTo(o + w, 0);
        ctx.closePath();
        ctx.fill();
      }
    },
  },
  {
    id: 'stripes', category: 'geometric', label: 'Stripes', tileMm: 8,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, w, h / 2);
    },
  },
  {
    id: 'stripes-vertical', category: 'geometric', label: 'Vertical stripes', tileMm: 8,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, w / 2, h);
    },
  },
  {
    id: 'chevron', category: 'geometric', label: 'Chevron', tileMm: 12,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const t = h * 0.22;
      for (const oy of [-h, 0, h]) {
        ctx.beginPath();
        ctx.moveTo(0, oy + h * 0.5);
        ctx.lineTo(w / 2, oy);
        ctx.lineTo(w, oy + h * 0.5);
        ctx.lineTo(w, oy + h * 0.5 + t);
        ctx.lineTo(w / 2, oy + t);
        ctx.lineTo(0, oy + h * 0.5 + t);
        ctx.closePath();
        ctx.fill();
      }
    },
  },
  {
    id: 'triangles', category: 'geometric', label: 'Triangles', tileMm: 12,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: 'hexagons', category: 'geometric', label: 'Honeycomb', tileMm: 12,
    // A tile of 1 × √3 hexagon units, outlines only.
    draw: (ctx, w, h, fg) => {
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1, w * 0.06);
      const r = w / 3;
      const hex = (cx: number, cy: number) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i += 1) {
          const a = (Math.PI / 3) * i;
          const px = cx + r * Math.cos(a);
          const py = cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      };
      wrap(w, h, 0, 0, r, hex);
      wrap(w, h, w / 2, h / 2, r, hex);
    },
  },
  {
    id: 'diamonds', category: 'geometric', label: 'Diamonds', tileMm: 12,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w, h / 2);
      ctx.lineTo(w / 2, h);
      ctx.lineTo(0, h / 2);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: 'plus', category: 'geometric', label: 'Plus signs', tileMm: 10,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const a = w * 0.3;
      const t = w * 0.08;
      ctx.fillRect(w / 2 - a / 2, h / 2 - t / 2, a, t);
      ctx.fillRect(w / 2 - t / 2, h / 2 - a / 2, t, a);
    },
  },
  // ---- organic ----
  {
    id: 'waves', category: 'organic', label: 'Waves', tileMm: 14,
    // One full sine per tile width: the curve leaves the right edge exactly where
    // and how it entered the left one, so the tiles join without a step.
    draw: (ctx, w, h, fg) => {
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1, h * 0.1);
      ctx.lineCap = 'butt';
      const steps = 48;
      for (const base of [h * 0.25, h * 0.75, h * 1.25, h * -0.25]) {
        ctx.beginPath();
        for (let i = 0; i <= steps; i += 1) {
          const x = (w * i) / steps;
          const y = base + h * 0.12 * Math.sin((2 * Math.PI * x) / w);
          if (i === 0) ctx.moveTo(x - 1, y);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w + 1, base);
        ctx.stroke();
      }
    },
  },
  {
    id: 'scales', category: 'organic', label: 'Scales', tileMm: 12,
    draw: (ctx, w, h, fg) => {
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1, w * 0.06);
      const r = w / 2;
      const arc = (x: number, y: number) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI);
        ctx.stroke();
      };
      wrap(w, h, w / 2, 0, r, arc);
      wrap(w, h, 0, h / 2, r, arc);
      wrap(w, h, w, h / 2, r, arc);
    },
  },
  {
    id: 'rings', category: 'organic', label: 'Rings', tileMm: 14,
    draw: (ctx, w, h, fg) => {
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1, w * 0.05);
      for (const k of [0.15, 0.3, 0.45]) {
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, w * k, 0, Math.PI * 2);
        ctx.stroke();
      }
    },
  },
  {
    id: 'bubbles', category: 'organic', label: 'Bubbles', tileMm: 30,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const rnd = seeded(7);
      const n = 4;
      for (let gx = 0; gx < n; gx += 1) {
        for (let gy = 0; gy < n; gy += 1) {
          const r = w * (0.025 + rnd() * 0.05);
          const x = ((gx + 0.2 + rnd() * 0.6) * w) / n;
          const y = ((gy + 0.2 + rnd() * 0.6) * h) / n;
          wrap(w, h, x, y, r, (cx, cy) => circle(ctx, cx, cy, r));
        }
      }
    },
  },
  {
    id: 'confetti', category: 'organic', label: 'Confetti', tileMm: 24,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const rnd = seeded(11);
      const n = 5;
      for (let gx = 0; gx < n; gx += 1) {
        for (let gy = 0; gy < n; gy += 1) {
          const x = ((gx + 0.15 + rnd() * 0.7) * w) / n;
          const y = ((gy + 0.15 + rnd() * 0.7) * h) / n;
          const s = w * (0.035 + rnd() * 0.02);
          const a = rnd() * Math.PI;
          wrap(w, h, x, y, s * 2, (cx, cy) => {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(a);
            ctx.fillRect(-s, -s / 3, s * 2, (s * 2) / 3);
            ctx.restore();
          });
        }
      }
    },
  },
  {
    id: 'leaves', category: 'organic', label: 'Leaves', tileMm: 20,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const leaf = (x: number, y: number, a: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, -w * 0.16);
        ctx.quadraticCurveTo(w * 0.1, 0, 0, w * 0.16);
        ctx.quadraticCurveTo(-w * 0.1, 0, 0, -w * 0.16);
        ctx.fill();
        ctx.restore();
      };
      wrap(w, h, w * 0.25, h * 0.3, w * 0.2, (x, y) => leaf(x, y, 0.6));
      wrap(w, h, w * 0.75, h * 0.75, w * 0.2, (x, y) => leaf(x, y, -0.6));
    },
  },
  // ---- playful ----
  {
    id: 'squiggles', category: 'playful', label: 'Squiggles', tileMm: 16,
    draw: (ctx, w, h, fg) => {
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1, w * 0.05);
      ctx.lineCap = 'round';
      const squiggle = (x: number, y: number) => {
        ctx.beginPath();
        ctx.moveTo(x - w * 0.15, y);
        ctx.quadraticCurveTo(x - w * 0.075, y - h * 0.1, x, y);
        ctx.quadraticCurveTo(x + w * 0.075, y + h * 0.1, x + w * 0.15, y);
        ctx.stroke();
      };
      wrap(w, h, w * 0.25, h * 0.25, w * 0.2, squiggle);
      wrap(w, h, w * 0.75, h * 0.75, w * 0.2, squiggle);
    },
  },
  {
    id: 'memphis', category: 'playful', label: 'Memphis', tileMm: 24,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1, w * 0.025);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const rnd = seeded(23);
      const n = 3;
      for (let gx = 0; gx < n; gx += 1) {
        for (let gy = 0; gy < n; gy += 1) {
          const x = ((gx + 0.25 + rnd() * 0.5) * w) / n;
          const y = ((gy + 0.25 + rnd() * 0.5) * h) / n;
          const s = w * (0.05 + rnd() * 0.025);
          const kind = (gx + gy * 2) % 4;
          const a = rnd() * Math.PI;
          wrap(w, h, x, y, s * 2, (cx, cy) => {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(a);
            if (kind === 0) circle(ctx, 0, 0, s * 0.55);
            else if (kind === 1) {
              ctx.beginPath();
              ctx.moveTo(0, -s);
              ctx.lineTo(s, s * 0.8);
              ctx.lineTo(-s, s * 0.8);
              ctx.closePath();
              ctx.stroke();
            } else if (kind === 2) {
              ctx.beginPath();
              ctx.moveTo(-s * 1.4, 0);
              for (let k = 1; k <= 4; k += 1) ctx.lineTo(-s * 1.4 + k * s * 0.7, k % 2 ? -s * 0.45 : s * 0.45);
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2);
              ctx.stroke();
            }
            ctx.restore();
          });
        }
      }
    },
  },
  {
    id: 'stars', category: 'playful', label: 'Stars', tileMm: 14,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const r = w * 0.14;
      wrap(w, h, w * 0.25, h * 0.25, r, (x, y) => starPath(ctx, x, y, r));
      wrap(w, h, w * 0.75, h * 0.75, r, (x, y) => starPath(ctx, x, y, r));
    },
  },
  {
    id: 'hearts', category: 'playful', label: 'Hearts', tileMm: 14,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const s = w * 0.3;
      wrap(w, h, w * 0.25, h * 0.3, s, (x, y) => heartPath(ctx, x, y, s));
      wrap(w, h, w * 0.75, h * 0.8, s, (x, y) => heartPath(ctx, x, y, s));
    },
  },
  // ---- classic ----
  {
    id: 'plaid', category: 'classic', label: 'Plaid', tileMm: 16,
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(0, h * 0.2, w, h * 0.25);
      ctx.fillRect(w * 0.2, 0, w * 0.25, h);
      ctx.globalAlpha = 0.9;
      ctx.fillRect(0, h * 0.7, w, h * 0.05);
      ctx.fillRect(w * 0.7, 0, w * 0.05, h);
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'bricks', category: 'classic', label: 'Bricks', tileMm: 16,
    // Two courses per tile, the second offset by half a brick; the joints are drawn.
    draw: (ctx, w, h, fg) => {
      ctx.fillStyle = fg;
      const t = Math.max(1, h * 0.06);
      ctx.fillRect(0, 0, w, t);
      ctx.fillRect(0, h / 2, w, t);
      ctx.fillRect(0, 0, t, h / 2);
      ctx.fillRect(w / 2, h / 2, t, h / 2);
    },
  },
];

export const PATTERN_IDS: ReadonlySet<string> = new Set(PATTERNS.map((p) => p.id));

export function patternById(id: unknown): PatternDef | null {
  return PATTERNS.find((p) => p.id === id) ?? null;
}

/** What a design stores on its background rectangle. */
export interface PatternSpec {
  id: string;
  /** [background, foreground] as #rrggbb. */
  colours: [string, string];
  /** The tile's printed size in mm (the pattern's own tileMm × the customer's scale). */
  scaleMm: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A stored spec made safe, or null: an unknown id, a non-hex colour or an absurd size is refused. */
export function cleanPatternSpec(raw: unknown): PatternSpec | null {
  const r = raw as Partial<PatternSpec> | null;
  if (!r || typeof r !== 'object' || !PATTERN_IDS.has(String(r.id))) return null;
  const colours = Array.isArray(r.colours) ? r.colours.map(String) : [];
  if (colours.length !== 2 || !colours.every((c) => HEX.test(c))) return null;
  const scale = Number(r.scaleMm);
  if (!Number.isFinite(scale) || scale < 2 || scale > 400) return null;
  return { id: String(r.id), colours: [colours[0], colours[1]], scaleMm: Math.round(scale * 100) / 100 };
}

/**
 * One tile, drawn into a fresh canvas made by `make(w, h)` (document.createElement
 * in the browser, node-canvas in tests), at `pxPerMm` pixels per millimetre.
 */
export function drawPatternTile<C extends { getContext(type: '2d'): unknown; width: number; height: number }>(
  spec: PatternSpec,
  pxPerMm: number,
  make: (w: number, h: number) => C,
): C | null {
  const def = patternById(spec.id);
  if (!def) return null;
  const size = Math.max(4, Math.min(4096, Math.round(spec.scaleMm * pxPerMm)));
  const canvas = make(size, size);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return null;
  ctx.fillStyle = spec.colours[0];
  ctx.fillRect(0, 0, size, size);
  def.draw(ctx, size, size, spec.colours[1]);
  return canvas;
}
