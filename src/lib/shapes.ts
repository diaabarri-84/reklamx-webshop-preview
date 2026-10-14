/**
 * SHAPES — "customise the shape of the design: round, oval, custom …" (the
 * client's item 4; "he controls everything").
 *
 * The catalogue has long offered sixteen priced cut shapes (product_shape,
 * cs-shape-*), but nothing in the shop knew what any of them LOOKED like: the
 * choice was a line of text in a dropdown, the preview was always a rectangle,
 * and the job sheet said "Shape: Round (circle)" somewhere in a run of options.
 * This module is what the shop knows about an outline: its kind, how to draw it
 * in a box, and which option means which outline.
 *
 * WHICH OPTION IS WHICH SHAPE — never guessed from words. A question is a cut
 * shape question when it is one of the catalogue's own (its options carry the
 * catalogue's shape ids) or when the owner ticks it as one (`field.cutShape`);
 * only inside such a question does an option have an outline at all — his
 * choice per option (`option.outline`), else the catalogue's id, else its stored
 * value. Two reviews found what reading words does: "square" is a print
 * ORIENTATION elsewhere in the catalogue, "custom" is a SIZE, "round" is a hole
 * punch and a hem, and an English NAME he can edit decided it — "Corner shape"
 * cut a circle, "Stansform" was never recognised.
 *
 * Pure and dependency-free: the product page, the server and the job sheet use
 * it, and it must never pull the 3 000-line option catalogue into either.
 * Tested in scripts/test-shapes.mjs.
 */

export type OutlineKind =
  | 'rect'
  | 'square'
  | 'circle'
  | 'ellipse'
  | 'stadium'
  | 'half_circle'
  | 'arch'
  | 'leaf'
  | 'hexagon'
  | 'triangle'
  | 'star'
  | 'heart'
  | 'seal'
  | 'rect_scalloped'
  | 'plaque'
  | 'custom';

export const OUTLINE_KINDS: readonly OutlineKind[] = [
  'rect', 'square', 'circle', 'ellipse', 'stadium', 'half_circle', 'arch', 'leaf',
  'hexagon', 'triangle', 'star', 'heart', 'seal', 'rect_scalloped', 'plaque', 'custom',
];

/** For the admin editor, which is English throughout. */
export const OUTLINE_NAMES: Record<OutlineKind, string> = {
  rect: 'Rectangle',
  square: 'Square',
  circle: 'Circle',
  ellipse: 'Oval',
  stadium: 'Straight oval (capsule)',
  half_circle: 'Half-circle',
  arch: 'Arch',
  leaf: 'Leaf',
  hexagon: 'Hexagon',
  triangle: 'Triangle',
  star: 'Star',
  heart: 'Heart',
  seal: 'Seal (scalloped round)',
  rect_scalloped: 'Scalloped rectangle',
  plaque: 'Plaque',
  custom: 'Custom contour (the customer\'s own cut line)',
};

export function isOutlineKind(v: unknown): v is OutlineKind {
  return typeof v === 'string' && (OUTLINE_KINDS as readonly string[]).includes(v);
}

/**
 * Kinds drawn in the largest SQUARE that fits the box, centred: a circle in an
 * 85 × 55 mm box is a 55 mm circle, not an oval — a round sticker ordered at a
 * rectangular size is a contradiction the preview should show, not hide.
 */
const SQUARE_KINDS: ReadonlySet<OutlineKind> = new Set(['circle', 'square', 'hexagon', 'star', 'heart', 'seal', 'triangle']);
export function needsSquareBox(kind: OutlineKind): boolean {
  return SQUARE_KINDS.has(kind);
}

/** The catalogue's own shape options, by id (optionCatalogue.ts, the legacy field, the Paper Stickers seed). */
const DEFAULT_OUTLINE_BY_ID: Record<string, OutlineKind> = {
  'cs-shape-rect': 'rect',
  'cs-shape-square': 'square',
  'cs-shape-round': 'circle',
  'cs-shape-oval': 'ellipse',
  'cs-shape-straight-oval': 'stadium',
  'cs-shape-halfcircle': 'half_circle',
  'cs-shape-arch': 'arch',
  'cs-shape-leaf': 'leaf',
  'cs-shape-hexagon': 'hexagon',
  'cs-shape-triangle': 'triangle',
  'cs-shape-seal': 'seal',
  'cs-shape-rect-scallop': 'rect_scalloped',
  'cs-shape-star': 'star',
  'cs-shape-heart': 'heart',
  'cs-shape-plaque': 'plaque',
  'cs-shape-custom': 'custom',
  // The legacy "Design shape" field. ads-1 "Standard Rectangle / Square" is
  // deliberately absent: it is the default of a field that sits on products
  // next to product_shape, and must never outrank the customer's Round.
  'ads-2': 'circle',
  'ads-3': 'ellipse',
  'ads-4': 'custom',
  // Paper Stickers (scripts/data/paper-stickers-suboptions.mjs).
  ind_round: 'circle',
  ind_square: 'square',
  ind_rect: 'rect',
  roll_round: 'circle',
  roll_square: 'square',
  roll_rect: 'rect',
  roll_oval: 'ellipse',
};

/** Inside a shape question only: an option's stored VALUE, '-' and '_' alike. Never bare 'custom' or 'half'. */
const OUTLINE_BY_VALUE: Record<string, OutlineKind> = {
  round: 'circle',
  circle: 'circle',
  oval: 'ellipse',
  ellipse: 'ellipse',
  square: 'square',
  rectangle: 'rect',
  rectangular: 'rect',
  straight_oval: 'stadium',
  stadium: 'stadium',
  capsule: 'stadium',
  half_circle: 'half_circle',
  arch: 'arch',
  leaf: 'leaf',
  hexagon: 'hexagon',
  triangle: 'triangle',
  star: 'star',
  heart: 'heart',
  seal: 'seal',
  seal_scalloped: 'seal',
  rectangle_scalloped: 'rect_scalloped',
  plaque: 'plaque',
  custom_contour: 'custom',
};

type FieldLike = { id?: unknown; cutShape?: unknown; options?: unknown };
type OptionLike = { id?: unknown; value?: unknown; outline?: unknown };

/** One of the catalogue's own shape questions: an option carries a catalogue shape id. */
export function isCatalogueShapeField(field: FieldLike | null | undefined): boolean {
  const options = Array.isArray(field?.options) ? (field!.options as OptionLike[]) : [];
  return options.some((o) => Object.hasOwn(DEFAULT_OUTLINE_BY_ID, String(o?.id ?? '')));
}

/**
 * A question that chooses the CUT SHAPE — his tick (`cutShape`), either way;
 * absent, the catalogue's own shape questions (product_shape, the legacy design
 * shape, the Paper Stickers shapes). Never the question's name: he can rename
 * anything, and the name of a flag's shape, a corner, a hole or an orientation
 * says "shape" too.
 */
export function isShapeField(field: FieldLike | null | undefined): boolean {
  if (field?.cutShape === true) return true;
  if (field?.cutShape === false) return false;
  return isCatalogueShapeField(field);
}

/** What the owner set, as he set it: a kind, 'none', or nothing (automatic). */
export function ownOutline(option: OptionLike | null | undefined): OutlineKind | 'none' | null {
  const own = option?.outline;
  return own === 'none' || isOutlineKind(own) ? (own as OutlineKind | 'none') : null;
}

/**
 * The outline an option stands for, or null. `field` is the question it belongs
 * to: outside a cut shape question nothing is an outline, whatever it is set to
 * — unticking the question switches its outlines off with it.
 */
export function outlineOf(option: OptionLike | null | undefined, field: FieldLike | null | undefined): OutlineKind | null {
  if (!option || !isShapeField(field)) return null;
  const own = ownOutline(option);
  if (own === 'none') return null;
  if (own) return own;
  const id = String(option.id ?? '');
  if (Object.hasOwn(DEFAULT_OUTLINE_BY_ID, id)) return DEFAULT_OUTLINE_BY_ID[id];
  const value = String(option.value ?? '').trim().toLowerCase().replace(/-/g, '_');
  return Object.hasOwn(OUTLINE_BY_VALUE, value) ? OUTLINE_BY_VALUE[value] : null;
}

/** A plain cut — what a product is cut to when nobody chose a shape. */
function plainness(kind: OutlineKind): number {
  return kind === 'rect' ? 0 : kind === 'square' ? 1 : 2;
}

/**
 * The outline a line is cut to, among the outlines of everything chosen on it:
 * any real shape before a square, a square before a rectangle, and the first in
 * the page's order among equals. So a product carrying the legacy "Design shape"
 * (a rectangle or square by default — even one the owner set explicitly) beside
 * "Shape" is cut to the customer's Star.
 */
export function primaryOutline(chosen: Array<{ outline?: OutlineKind | null }>): OutlineKind | null {
  let best: OutlineKind | null = null;
  for (const c of chosen) {
    if (c.outline && (best === null || plainness(c.outline) > plainness(best))) best = c.outline;
  }
  return best;
}

/**
 * A round size written "30 mm ø" — the trailing form only, and only on the
 * option's dimensions. For the preview frame of a round item, and nothing else:
 * the shared size parser must not learn it, or a 40 mm roll CORE ("Ø 25/38/40
 * mm") would become a print size and a 36 mm file with its 3 mm bleed would be
 * refused against a 30 mm "size".
 */
export function diameterMm(option: { dimensions?: unknown } | null | undefined): number | null {
  const m = String(option?.dimensions ?? '').match(/^\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)\s*[øØ]\s*$/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.')) * (m[2] === 'cm' ? 10 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Width × height, as fractions of an icon's square, each kind is drawn at. */
const ICON_BOX: Partial<Record<OutlineKind, readonly [number, number]>> = {
  rect: [1, 0.68],
  ellipse: [1, 0.68],
  stadium: [1, 0.55],
  half_circle: [1, 0.55],
  arch: [0.78, 1],
  rect_scalloped: [1, 0.72],
  plaque: [1, 0.72],
};

/**
 * A shape drawn as an ICON in a `size` × `size` square — a picture card, the
 * editor's outline picker, the job sheet's "Cut:" badge — at the shape's own
 * proportions. Drawn in the square itself an oval is a circle, a capsule is a
 * circle and a rectangle is a square: four of the sixteen picture cards looked
 * like their neighbours. `dx`/`dy` centre the path in the square.
 */
export function iconOutline(kind: OutlineKind, size: number): { d: string; dx: number; dy: number } {
  const [fw, fh] = ICON_BOX[kind] ?? [1, 1];
  const w = size * fw;
  const h = size * fh;
  return { d: outlinePath(kind, w, h), dx: (size - w) / 2, dy: (size - h) / 2 };
}

/**
 * SVG path data for `kind` drawn in a `w` × `h` box at the origin.
 *
 * GEOMETRY, kind by kind:
 * - rect: the box. custom: the box too (the cut line is in the customer's file;
 *   the caller draws it dashed and says so).
 * - square, circle, hexagon (flat top and bottom), triangle (point up), star
 *   (five points, point up), heart, seal (round with a scalloped edge): in the
 *   largest centred square — see needsSquareBox.
 * - ellipse: touches all four sides. stadium: a rectangle whose short ends are
 *   half-circles. half_circle: the flat side down, as wide as the box allows.
 * - arch: straight sides and base, a round top as wide as the box.
 * - leaf: the box with the top-left and bottom-right corners fully rounded
 *   (the catalogue: "two opposite corners rounded off").
 * - rect_scalloped: the box with a scalloped (bitten) edge all round.
 * - plaque: the box with concave (inward) rounded corners.
 */
export function outlinePath(kind: OutlineKind, w: number, h: number): string {
  const W = Number.isFinite(w) && w > 0 ? w : 1;
  const H = Number.isFinite(h) && h > 0 ? h : 1;
  const s = Math.min(W, H);
  const ox = (W - s) / 2;
  const oy = (H - s) / 2;
  const cx = W / 2;
  const cy = H / 2;

  switch (kind) {
    case 'square':
      return `M${f(ox)} ${f(oy)}H${f(ox + s)}V${f(oy + s)}H${f(ox)}Z`;
    case 'circle': {
      const r = s / 2;
      return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
    }
    case 'ellipse':
      return `M0 ${f(cy)}A${f(W / 2)} ${f(H / 2)} 0 1 0 ${f(W)} ${f(cy)}A${f(W / 2)} ${f(H / 2)} 0 1 0 0 ${f(cy)}Z`;
    case 'stadium': {
      if (W >= H) {
        const r = H / 2;
        return `M${f(r)} 0H${f(W - r)}A${f(r)} ${f(r)} 0 0 1 ${f(W - r)} ${f(H)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
      }
      const r = W / 2;
      return `M0 ${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(W)} ${f(r)}V${f(H - r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(H - r)}Z`;
    }
    case 'half_circle': {
      const r = Math.min(W / 2, H);
      const base = (H + r) / 2;
      return `M${f(cx - r)} ${f(base)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + r)} ${f(base)}Z`;
    }
    case 'arch': {
      const ry = Math.min(W / 2, H);
      return `M0 ${f(H)}V${f(ry)}A${f(W / 2)} ${f(ry)} 0 0 1 ${f(W)} ${f(ry)}V${f(H)}Z`;
    }
    case 'leaf': {
      const r = s / 2;
      return `M${f(r)} 0H${f(W)}V${f(H - r)}A${f(r)} ${f(r)} 0 0 1 ${f(W - r)} ${f(H)}H0V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
    }
    case 'hexagon': {
      const hh = (s * Math.sqrt(3)) / 2;
      const top = cy - hh / 2;
      const bottom = cy + hh / 2;
      return `M${f(ox + s / 4)} ${f(top)}H${f(ox + (3 * s) / 4)}L${f(ox + s)} ${f(cy)}L${f(ox + (3 * s) / 4)} ${f(bottom)}H${f(ox + s / 4)}L${f(ox)} ${f(cy)}Z`;
    }
    case 'triangle':
      return `M${f(cx)} ${f(oy)}L${f(ox + s)} ${f(oy + s)}H${f(ox)}Z`;
    case 'star': {
      const R = s / 2;
      const r = R * 0.42;
      let d = '';
      for (let i = 0; i < 10; i += 1) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? R : r;
        d += `${i === 0 ? 'M' : 'L'}${f(cx + rad * Math.cos(a))} ${f(cy + rad * Math.sin(a))}`;
      }
      return `${d}Z`;
    }
    case 'heart': {
      // A 100 × 100 heart, scaled into the square.
      const k = s / 100;
      const X = (x: number) => f(ox + x * k);
      const Y = (y: number) => f(oy + y * k);
      return (
        `M${X(50)} ${Y(92)}` +
        `C${X(20)} ${Y(72)} ${X(0)} ${Y(52)} ${X(0)} ${Y(30)}` +
        `C${X(0)} ${Y(13)} ${X(13)} ${Y(2)} ${X(27)} ${Y(2)}` +
        `C${X(38)} ${Y(2)} ${X(46)} ${Y(9)} ${X(50)} ${Y(17)}` +
        `C${X(54)} ${Y(9)} ${X(62)} ${Y(2)} ${X(73)} ${Y(2)}` +
        `C${X(87)} ${Y(2)} ${X(100)} ${Y(13)} ${X(100)} ${Y(30)}` +
        `C${X(100)} ${Y(52)} ${X(80)} ${Y(72)} ${X(50)} ${Y(92)}Z`
      );
    }
    case 'seal': {
      const R = s / 2;
      const inner = R * 0.86;
      const n = 18;
      let d = '';
      for (let i = 0; i < n; i += 1) {
        const a0 = (i * 2 * Math.PI) / n;
        const a1 = ((i + 0.5) * 2 * Math.PI) / n;
        const a2 = ((i + 1) * 2 * Math.PI) / n;
        if (i === 0) d += `M${f(cx + inner * Math.cos(a0))} ${f(cy + inner * Math.sin(a0))}`;
        d += `Q${f(cx + R * Math.cos(a1))} ${f(cy + R * Math.sin(a1))} ${f(cx + inner * Math.cos(a2))} ${f(cy + inner * Math.sin(a2))}`;
      }
      return `${d}Z`;
    }
    case 'rect_scalloped': {
      const m = s * 0.07; // how deep each bite is
      const bites = (len: number) => Math.max(3, Math.round(len / (s / 4)));
      let d = `M${f(m)} ${f(m)}`;
      const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
        const n = bites(Math.hypot(x1 - x0, y1 - y0));
        for (let i = 0; i < n; i += 1) {
          const t0 = i / n;
          const t1 = (i + 1) / n;
          const mx = x0 + (x1 - x0) * ((t0 + t1) / 2) + nx * m;
          const my = y0 + (y1 - y0) * ((t0 + t1) / 2) + ny * m;
          d += `Q${f(mx)} ${f(my)} ${f(x0 + (x1 - x0) * t1)} ${f(y0 + (y1 - y0) * t1)}`;
        }
      };
      edge(m, m, W - m, m, 0, -1);
      edge(W - m, m, W - m, H - m, 1, 0);
      edge(W - m, H - m, m, H - m, 0, 1);
      edge(m, H - m, m, m, -1, 0);
      return `${d}Z`;
    }
    case 'plaque': {
      const r = s * 0.15;
      return `M${f(r)} 0H${f(W - r)}A${f(r)} ${f(r)} 0 0 0 ${f(W)} ${f(r)}V${f(H - r)}A${f(r)} ${f(r)} 0 0 0 ${f(W - r)} ${f(H)}H${f(r)}A${f(r)} ${f(r)} 0 0 0 0 ${f(H - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 0 ${f(r)} 0Z`;
    }
    case 'rect':
    case 'custom':
    default:
      return `M0 0H${f(W)}V${f(H)}H0Z`;
  }
}
