/**
 * WHICH SIDES A LINE IS PRINTED ON — and whether an online design can make them.
 *
 * The catalogue says it in several questions (src/components/Admin/optionCatalogue.ts):
 * `printed_sides`, `flag_printed_sides`, `bag_print_sides`, and implicitly
 * `colour_configuration` (4/4 = colour both sides, 4/0 = front only). One answer is
 * needed by the designer (front and back pages), the print file (pages), the order
 * and the job sheet ("Page 1 Front / Page 2 Back"). Read here only, by option id or
 * by VALUE inside its own question (a library copy keeps the value, not the id).
 *
 * The first question that says something wins, in that order. A raster RGB print
 * file cannot honour spot (Pantone), white, metallic or neon inks, nor a wrap-around
 * "all-over" print — the designer is not offered there ('blocked'); black-only and
 * greyscale sides are designed in black and greys ('ink').
 *
 * Pure; scripts/test-design-doc.mjs.
 */

export type SideId = 'front' | 'back';
export type SideInk = 'colour' | 'black' | 'greyscale';
export type DesignBlock = 'unprinted' | 'all-over' | 'special-ink';

export interface PrintSides {
  /** The pages a design has, in print order. */
  sides: SideId[];
  /** One design printed on both sides (a bag "both sides — same design"). */
  sameOnBothSides: boolean;
  /** Why an online design cannot make this line, or null. */
  blocked: DesignBlock | null;
  ink: Record<SideId, SideInk>;
}

/** A chosen option as the page knows it (id, value) or the server (optionId, value). */
export interface SidesOptionRef {
  fieldId?: string | null;
  id?: string | null;
  optionId?: string | null;
  value?: string | null;
}

type SidesAnswer = { sides?: SideId[]; same?: boolean; blocked?: DesignBlock };

/** Per question: option id or value → what it says about the sides. */
const SIDE_QUESTIONS: Array<{ field: string; byKey: Record<string, SidesAnswer> }> = [
  {
    field: 'printed_sides',
    byKey: {
      'pc-sides-single': { sides: ['front'] }, single_sided: { sides: ['front'] },
      'pc-sides-double': { sides: ['front', 'back'] }, double_sided: { sides: ['front', 'back'] },
      'pc-sides-back': { sides: ['back'] }, back_only: { sides: ['back'] },
      'pc-sides-allover': { blocked: 'all-over' }, all_over: { blocked: 'all-over' },
      'pc-sides-unprinted': { blocked: 'unprinted' }, unprinted: { blocked: 'unprinted' },
    },
  },
  {
    field: 'flag_printed_sides',
    byKey: {
      'df-fsides-single': { sides: ['front'] }, single: { sides: ['front'] },
      'df-fsides-single-blockout': { sides: ['front'] }, single_blockout: { sides: ['front'] },
      'df-fsides-double-sewn': { sides: ['front', 'back'] }, double_sewn: { sides: ['front', 'back'] },
      'df-fsides-double-blockout': { sides: ['front', 'back'] }, double_blockout: { sides: ['front', 'back'] },
    },
  },
  {
    field: 'bag_print_sides',
    byKey: {
      'bp-sides-none': { blocked: 'unprinted' }, unprinted: { blocked: 'unprinted' },
      'bp-sides-one-small': { sides: ['front'] }, one_side_small: { sides: ['front'] },
      'bp-sides-one-large': { sides: ['front'] }, one_side_large: { sides: ['front'] },
      'bp-sides-both-same': { sides: ['front'], same: true }, both_same: { sides: ['front'], same: true },
      'bp-sides-both-diff': { sides: ['front', 'back'] }, both_different: { sides: ['front', 'back'] },
      'bp-sides-allover': { blocked: 'all-over' }, all_over: { blocked: 'all-over' },
    },
  },
];

/** 4/0, 4/4, 1/1 … : the inks on the front and on the back. */
const COLOUR_CONFIG = /^pc-cfg-(\d)-(\d)$|^(\d)_(\d)$/;
const SPECIAL_INK_MODES = new Set([
  'pc-mode-pantone', 'pantone_spot', 'pc-mode-cmyk-pantone', 'cmyk_plus_pantone',
  'pc-mode-white', 'white_ink', 'pc-mode-metallic', 'metallic_ink', 'pc-mode-neon', 'neon_ink',
]);
const GREYSCALE_MODES = new Set(['pc-mode-bw', 'black_white']);

const keysOf = (o: SidesOptionRef) => [String(o.optionId ?? o.id ?? ''), String(o.value ?? '')].filter(Boolean);

export function printSides(options: SidesOptionRef[] | null | undefined): PrintSides {
  const chosen = options ?? [];
  const inField = (field: string) => chosen.filter((o) => String(o.fieldId ?? '') === field);
  let answer: SidesAnswer | null = null;
  for (const q of SIDE_QUESTIONS) {
    for (const o of inField(q.field)) {
      for (const key of keysOf(o)) {
        if (Object.prototype.hasOwnProperty.call(q.byKey, key)) {
          answer = q.byKey[key];
          break;
        }
      }
      if (answer) break;
    }
    if (answer) break;
  }
  // The colour configuration: inks per side, and — when nothing above said — the sides.
  let inks: [number, number] | null = null;
  for (const o of inField('colour_configuration')) {
    for (const key of keysOf(o)) {
      const m = COLOUR_CONFIG.exec(key);
      if (m) {
        inks = [Number(m[1] ?? m[3]), Number(m[2] ?? m[4])];
        break;
      }
    }
    if (inks) break;
  }
  let blocked: DesignBlock | null = answer?.blocked ?? null;
  let sides: SideId[] = answer?.sides ?? (inks && inks[1] > 0 ? ['front', 'back'] : ['front']);
  const inkOf = (n: number | undefined): SideInk => (n === 1 ? 'black' : 'colour');
  const ink: Record<SideId, SideInk> = { front: inkOf(inks?.[0]), back: inkOf(inks?.[1]) };
  // 2 or 5 inks are spot colours (Pantone): not a raster file's to honour.
  if (inks && (inks[0] === 2 || inks[0] === 5 || inks[1] === 2 || inks[1] === 5)) blocked = blocked ?? 'special-ink';
  for (const o of inField('print_colour_mode')) {
    const keys = keysOf(o);
    if (keys.some((k) => SPECIAL_INK_MODES.has(k))) blocked = blocked ?? 'special-ink';
    if (keys.some((k) => GREYSCALE_MODES.has(k))) {
      ink.front = ink.front === 'black' ? 'black' : 'greyscale';
      ink.back = ink.back === 'black' ? 'black' : 'greyscale';
    }
  }
  if (sides.length === 0) sides = ['front'];
  return { sides, sameOnBothSides: answer?.same === true, blocked, ink };
}
