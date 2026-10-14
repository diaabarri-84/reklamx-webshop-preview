/**
 * HOW A PRODUCT IS PRINTED — bleed, safe area, hidden zones, resolution (designer v2).
 *
 * One spec per line, from the product's KIND (which size question it uses), the
 * owner's resolution table (by size, edited in the dashboard — his decision of
 * 2026-10-07: "by size, or the owner sets it as he likes") and the owner's own
 * values for that product. The designer draws the board with this bleed and these
 * guides; the print file is made at this resolution; the job sheet repeats it.
 *
 * Defaults are the trade's usual ones and are only defaults:
 *   cards, flyers, posters, stickers, signs — 3 mm bleed, text 3–5 mm inside;
 *   roll-ups — the foot of the print disappears into the cassette and the top
 *   under the rail: keep content out of the bottom 100 mm and the top 30 mm;
 *   banners and flags — hems and eyelets: keep text 30 mm inside.
 * The resolution table: up to 450 mm long 300 dpi (never below 150); up to 1 m
 * 200 (150); larger 150 (100) — this shop's own large-format standard is 150 dpi
 * (src/lib/artworkLimits.ts), and a roll-up is read from a metre away.
 *
 * Pure; scripts/test-print-file.mjs.
 */

export type ProductKind = 'card' | 'print' | 'poster' | 'sticker' | 'sign' | 'rollup' | 'banner' | 'flag';

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PrintSpec {
  kind: ProductKind;
  /** Printed beyond the trim on every side, mm. */
  bleedMm: number;
  /** Text and important content this far inside the trim, mm. */
  safeMm: number;
  /** Parts of the product that will not be seen (cassette, rail, sleeve), mm from each edge. */
  hiddenMm: Margins;
  /** The resolution the print file is made at, when it fits. */
  targetDpi: number;
  /** Never below this: a design that does not fit at it is refused, honestly. */
  minDpi: number;
}

export interface DpiBand {
  /** The band covers products whose LONGER side is at most this (mm); null = everything larger. */
  maxLongSideMm: number | null;
  targetDpi: number;
  minDpi: number;
}

export const DEFAULT_DPI_BANDS: readonly DpiBand[] = [
  { maxLongSideMm: 450, targetDpi: 300, minDpi: 150 },
  { maxLongSideMm: 1000, targetDpi: 200, minDpi: 150 },
  { maxLongSideMm: null, targetDpi: 150, minDpi: 100 },
];

const NO_MARGINS: Margins = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The most bleed a product may have, mm — ONE number for his editor, the designer's
 * file and the order: the server kept a file's bleed only up to 20 while his editor
 * allowed 50, so a 25 mm roll-up bleed vanished from the job sheet and production
 * placed the file with its bleed printed on the product.
 */
export const BLEED_MAX_MM = 50;

export const KIND_DEFAULTS: Readonly<Record<ProductKind, { bleedMm: number; safeMm: number; hiddenMm: Margins }>> = {
  card: { bleedMm: 3, safeMm: 3, hiddenMm: NO_MARGINS },
  print: { bleedMm: 3, safeMm: 3, hiddenMm: NO_MARGINS },
  poster: { bleedMm: 3, safeMm: 5, hiddenMm: NO_MARGINS },
  sticker: { bleedMm: 3, safeMm: 3, hiddenMm: NO_MARGINS },
  sign: { bleedMm: 3, safeMm: 5, hiddenMm: NO_MARGINS },
  rollup: { bleedMm: 3, safeMm: 20, hiddenMm: { top: 30, right: 0, bottom: 100, left: 0 } },
  banner: { bleedMm: 3, safeMm: 30, hiddenMm: NO_MARGINS },
  flag: { bleedMm: 3, safeMm: 30, hiddenMm: NO_MARGINS },
};

/** The size question a product uses tells what it is (src/components/Admin/optionCatalogue.ts). */
const KIND_BY_FIELD: Record<string, ProductKind> = {
  rollup_banner_size: 'rollup',
  roller_banner_size: 'rollup',
  large_format_size: 'banner',
  flag_size: 'flag',
  business_card_size: 'card',
  sticker_label_size: 'sticker',
  poster_size: 'poster',
};

export function kindOfProduct(fieldIds: readonly string[]): ProductKind {
  for (const id of fieldIds) {
    const kind = KIND_BY_FIELD[id];
    if (kind) return kind;
  }
  return 'print';
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const between = (v: unknown, lo: number, hi: number): number | null => (finite(v) && v >= lo && v <= hi ? v : null);

/** The owner's resolution table, made safe: sorted, bounded, the open-ended band last. */
export function cleanDpiBands(raw: unknown): DpiBand[] {
  if (!Array.isArray(raw)) return [...DEFAULT_DPI_BANDS];
  const bands: DpiBand[] = [];
  for (const b of raw.slice(0, 8)) {
    const r = b as Partial<DpiBand> | null;
    const target = between(r?.targetDpi, 50, 1200);
    const min = between(r?.minDpi, 50, 1200);
    const max = r?.maxLongSideMm == null ? null : between(r.maxLongSideMm, 10, 20_000);
    if (target === null || min === null || (r?.maxLongSideMm != null && max === null)) continue;
    bands.push({ maxLongSideMm: max, targetDpi: Math.round(Math.max(target, min)), minDpi: Math.round(min) });
  }
  if (bands.length === 0) return [...DEFAULT_DPI_BANDS];
  bands.sort((a, b) => (a.maxLongSideMm ?? Infinity) - (b.maxLongSideMm ?? Infinity));
  if (bands[bands.length - 1].maxLongSideMm !== null) bands.push({ ...bands[bands.length - 1], maxLongSideMm: null });
  return bands;
}

export function dpiBandFor(trimMm: { wMm: number; hMm: number }, bands: readonly DpiBand[]): DpiBand {
  const long = Math.max(trimMm.wMm, trimMm.hMm);
  return bands.find((b) => b.maxLongSideMm === null || long <= b.maxLongSideMm) ?? bands[bands.length - 1];
}

/** The owner's own values for one product: any of them, each hidden side on its own. */
export type SpecOverride = Partial<Omit<PrintSpec, 'kind' | 'hiddenMm'>> & { hiddenMm?: Partial<Margins> };

/**
 * The owner's own values for one product (product.printSpec), made safe; missing = the
 * defaults. A hidden zone is PER SIDE: a roll-up given only its foot keeps the rail's
 * 30 mm at the top — "empty boxes use the usual values", as his editor says (an empty
 * side used to be saved and read as 0).
 */
export function cleanSpecOverride(raw: unknown): SpecOverride {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: SpecOverride = {};
  const bleed = between(r.bleedMm, 0, BLEED_MAX_MM);
  if (bleed !== null) out.bleedMm = bleed;
  const safe = between(r.safeMm, 0, 500);
  if (safe !== null) out.safeMm = safe;
  const target = between(r.targetDpi, 50, 1200);
  const min = between(r.minDpi, 50, 1200);
  if (min !== null) out.minDpi = Math.round(min);
  if (target !== null) out.targetDpi = Math.round(target);
  const h = r.hiddenMm as Record<string, unknown> | undefined;
  if (h && typeof h === 'object') {
    const sides: Partial<Margins> = {};
    for (const k of ['top', 'right', 'bottom', 'left'] as const) {
      const v = between(h[k], 0, 2000);
      if (v !== null) sides[k] = v;
    }
    if (Object.keys(sides).length) out.hiddenMm = sides;
  }
  return out;
}

/**
 * KEPT INSIDE THE PRODUCT. His values are typed per product, and nothing stops a
 * 100 mm "hidden foot" on a 55 mm business card or a 500 mm safe margin — the safe
 * box then shrinks to a millimetre and the shop's designs build microscopic text.
 * The hidden zones keep at least 40 % of each side visible (both shrunk in proportion),
 * and the safe margin keeps at least half of the shorter side.
 */
function insideProduct(spec: { safeMm: number; hiddenMm: Margins }, trimMm: { wMm: number; hMm: number }): { safeMm: number; hiddenMm: Margins } {
  const pair = (a: number, b: number, side: number): [number, number] => {
    const most = side * 0.6;
    return a + b > most && a + b > 0 ? [(a * most) / (a + b), (b * most) / (a + b)] : [a, b];
  };
  const [top, bottom] = pair(spec.hiddenMm.top, spec.hiddenMm.bottom, trimMm.hMm);
  const [left, right] = pair(spec.hiddenMm.left, spec.hiddenMm.right, trimMm.wMm);
  return {
    safeMm: Math.min(spec.safeMm, Math.min(trimMm.wMm, trimMm.hMm) / 4),
    hiddenMm: { top, right, bottom, left },
  };
}

export function printSpecFor(input: {
  kind: ProductKind;
  trimMm: { wMm: number; hMm: number };
  bands?: readonly DpiBand[];
  override?: unknown;
}): PrintSpec {
  const defaults = KIND_DEFAULTS[input.kind] ?? KIND_DEFAULTS.print;
  const band = dpiBandFor(input.trimMm, input.bands && input.bands.length ? input.bands : DEFAULT_DPI_BANDS);
  const own = cleanSpecOverride(input.override);
  const minDpi = own.minDpi ?? band.minDpi;
  const inside = insideProduct(
    {
      safeMm: own.safeMm ?? defaults.safeMm,
      hiddenMm: {
        top: own.hiddenMm?.top ?? defaults.hiddenMm.top,
        right: own.hiddenMm?.right ?? defaults.hiddenMm.right,
        bottom: own.hiddenMm?.bottom ?? defaults.hiddenMm.bottom,
        left: own.hiddenMm?.left ?? defaults.hiddenMm.left,
      },
    },
    input.trimMm,
  );
  return {
    kind: input.kind,
    bleedMm: own.bleedMm ?? defaults.bleedMm,
    safeMm: inside.safeMm,
    hiddenMm: inside.hiddenMm,
    minDpi,
    targetDpi: Math.max(own.targetDpi ?? band.targetDpi, minDpi),
  };
}

/** The page in pixels: the trim with its bleed, at a resolution, rounded UP (never short of the size). */
export function pagePixels(trimMm: { wMm: number; hMm: number }, bleedMm: number, dpi: number): { w: number; h: number } {
  const px = (mm: number) => Math.ceil(((mm + 2 * bleedMm) / 25.4) * dpi - 1e-9);
  return { w: px(trimMm.wMm), h: px(trimMm.hMm) };
}

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The page cut into tiles a phone can render one at a time: at most `maxSide` px a
 * side and `maxPixels` each (older iOS caps a canvas at ~16.7 MP and all canvases
 * together; the editor's own canvas counts too). Whole pixels, no gaps, no overlaps.
 */
export function tilePlan(wPx: number, hPx: number, maxSide = 4096, maxPixels = 8_000_000): TileRect[] {
  const cols = Math.max(1, Math.ceil(wPx / maxSide));
  const tileW = Math.ceil(wPx / cols);
  const tileHMax = Math.max(1, Math.min(maxSide, Math.floor(maxPixels / tileW)));
  const rows = Math.max(1, Math.ceil(hPx / tileHMax));
  const xs = Array.from({ length: cols + 1 }, (_, i) => Math.round((wPx * i) / cols));
  const ys = Array.from({ length: rows + 1 }, (_, i) => Math.round((hPx * i) / rows));
  const tiles: TileRect[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) tiles.push({ x: xs[c], y: ys[r], w: xs[c + 1] - xs[c], h: ys[r + 1] - ys[r] });
  }
  return tiles;
}

/** Resolutions to try, best first: the target, then 15 % steps down, ending exactly at the floor. */
export function dpiSteps(spec: Pick<PrintSpec, 'targetDpi' | 'minDpi'>): number[] {
  const out: number[] = [];
  for (let d = spec.targetDpi; d > spec.minDpi; d = Math.floor(d * 0.85)) out.push(d);
  out.push(spec.minDpi);
  return [...new Set(out)];
}

/** The largest print file the shop can store and file: Storage refuses 50 MB, the Drive copy 40 MB. */
export const PRINT_FILE_MAX_BYTES = 38 * 1024 * 1024;
