import { useState, type CSSProperties } from 'react';
import { Minus } from 'lucide-react';
import { motion } from 'motion/react';
import { PrintingField, PrintingFieldOption } from '../../types';
import { NEO } from '../NeumorphicSidebar';
import { cn } from '../../lib/utils';
import type { TranslationKey } from '../../lib/translations';
import { isChargedOnce } from '../../lib/chargeOnce';

/**
 * The colour picker for option fields whose values are colours (garment colour,
 * bottle colour, pen barrel…), rendered HelloPrint-style but in our language:
 *
 *  - a compact row of square colour tiles instead of the usual text cards, so a
 *    t-shirt with 34 colours is one glance rather than a wall of words;
 *  - the overflow hides behind a dark "+N" tile that expands the rest IN PLACE
 *    (no modal, no scroll jump), and swaps itself for a "show less" tile;
 *  - selected = orange ring + slight raise, the same grammar as NeoOptionField.
 *
 * The colour itself is not stored anywhere: an option only carries a `value`
 * ('colour_black', 'navy_blue', '#c0392b') and an English `label`, so this file
 * owns the vocabulary that turns those into a fill. When it cannot resolve one
 * the caller is expected to fall back to the normal card grid — a misread field
 * degrades to something correct instead of to a row of blank grey squares.
 */

/** Checkerboard, not a fill: 'transparent' and 'clear' are the absence of ink. */
const TRANSPARENT_FILL = 'transparent';

/** 'Full colour' is CMYK — the reference draws it as a rainbow wheel, so do we. */
const RAINBOW_FILL =
  'conic-gradient(from 210deg, #e8761c, #f5c518, #2e8b40, #22b3a6, #2563eb, #6b3fa0, #d0281f, #e8761c)';

/**
 * The print-trade colour vocabulary the catalogue actually uses, English first
 * with the Swedish spellings that leak into `value` on a Swedish-run shop.
 *
 * Deliberately absent: a bare 'colour'/'color'. A "Print colours" field offers
 * "1 colour / 2 colours / 4 colours", and mapping the bare word would make that
 * field resolve at 100% and render four identical rainbow tiles instead of the
 * text cards it needs. Only the explicit 'full colour' family means CMYK here.
 */
const COLOUR_TABLE: Record<string, string> = {
  // Whites and naturals
  white: '#ffffff',
  vit: '#ffffff',
  hvid: '#ffffff',
  'off white': '#f4f1e8',
  offwhite: '#f4f1e8',
  ivory: '#f4f1e8',
  cream: '#f4efe1',
  ecru: '#e6dcc6',
  natural: '#e8dcc4',
  natur: '#e8dcc4',
  // Blacks and greys
  black: '#141414',
  svart: '#141414',
  sort: '#141414',
  charcoal: '#36393f',
  anthracite: '#2f3337',
  antracit: '#2f3337',
  grey: '#9aa0a6',
  gray: '#9aa0a6',
  grå: '#9aa0a6',
  gra: '#9aa0a6',
  'light grey': '#cfd3d8',
  'light gray': '#cfd3d8',
  'dark grey': '#5a5f66',
  'dark gray': '#5a5f66',
  silver: '#c0c4c9',
  gold: '#c9a227',
  guld: '#c9a227',
  // Blues
  navy: '#1b2a4a',
  'navy blue': '#1b2a4a',
  marinblå: '#1b2a4a',
  marinbla: '#1b2a4a',
  blue: '#2563eb',
  blå: '#2563eb',
  bla: '#2563eb',
  'royal blue': '#2b4fbf',
  royalblue: '#2b4fbf',
  'sky blue': '#7fc4e8',
  'light blue': '#a8d5f2',
  'dark blue': '#16305e',
  turquoise: '#22b3a6',
  turkos: '#22b3a6',
  teal: '#177e77',
  // Greens
  green: '#2e8b40',
  grön: '#2e8b40',
  gron: '#2e8b40',
  grøn: '#2e8b40',
  lime: '#a4d233',
  'forest green': '#1f4d2b',
  'dark green': '#14532d',
  'light green': '#8fd18a',
  olive: '#6b7233',
  khaki: '#b3a679',
  // Reds and warm tones
  red: '#d0281f',
  röd: '#d0281f',
  rod: '#d0281f',
  rød: '#d0281f',
  burgundy: '#6b1f2e',
  bordeaux: '#6b1f2e',
  maroon: '#6b1f2e',
  wine: '#5c1a26',
  vinröd: '#5c1a26',
  orange: '#e8761c',
  yellow: '#f5c518',
  gul: '#f5c518',
  pink: '#ef7fa8',
  rosa: '#ef7fa8',
  fuchsia: '#c026a8',
  fuscia: '#c026a8',
  magenta: '#cf1a7d',
  purple: '#6b3fa0',
  lila: '#6b3fa0',
  violet: '#7c4dbd',
  // Earth tones
  brown: '#6b4423',
  brun: '#6b4423',
  beige: '#d9c9a8',
  sand: '#d8c39a',
  taupe: '#a89881',
  // Non-solid tiles
  transparent: TRANSPARENT_FILL,
  clear: TRANSPARENT_FILL,
  genomskinlig: TRANSPARENT_FILL,
  'full colour': RAINBOW_FILL,
  'full color': RAINBOW_FILL,
  fullcolour: RAINBOW_FILL,
  fullcolor: RAINBOW_FILL,
  fullfärg: RAINBOW_FILL,
  fullfarg: RAINBOW_FILL,
  cmyk: RAINBOW_FILL,
  multicolour: RAINBOW_FILL,
  multicolor: RAINBOW_FILL,
  'multi colour': RAINBOW_FILL,
  'multi color': RAINBOW_FILL,
};

/**
 * A Map, not the object itself: `COLOUR_TABLE['constructor']` would hand back a
 * Function and we would happily push it into a style attribute.
 */
const NAMED = new Map<string, string>(Object.entries(COLOUR_TABLE));

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;

/** '#fff' → '#ffffff', so the luminance maths below only sees one shape. */
function expandHex(hex: string): string {
  if (hex.length !== 4) return hex;
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
}

/**
 * One string → a fill, or null. Handles a literal hex, then the whole phrase,
 * then its words: two-word names are tried before single ones so "sky blue" and
 * "forest green" are not swallowed by the bare "blue"/"green" that follows them.
 */
function fillFromText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase();
  if (!lower) return null;
  if (HEX.test(lower)) return expandHex(lower);

  const phrase = lower
    .replace(/^colou?rs?[_\s-]+/, '') // 'colour_black' is the catalogue's own prefix
    .replace(/[_\-/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const whole = NAMED.get(phrase);
  if (whole) return whole;

  const words = phrase.split(' ').filter(Boolean);
  for (let i = 0; i + 1 < words.length; i++) {
    const pair = NAMED.get(`${words[i]} ${words[i + 1]}`);
    if (pair) return pair;
  }
  for (const word of words) {
    if (HEX.test(word)) return expandHex(word);
    const hit = NAMED.get(word);
    if (hit) return hit;
  }
  return null;
}

/** The CSS colour for one option, or null when it cannot be resolved. */
export function swatchColour(option: PrintingFieldOption): string | null {
  // `value` is the machine-ish field ('colour_navy_blue') and wins; `label` is
  // the canonical English text and only has to answer when the value is opaque.
  return fillFromText(option?.value) ?? fillFromText(option?.label) ?? null;
}

/** en/sv/da/no: colour, color, färg, farg, farge, farve. */
const COLOUR_FIELD_WORDS = /colou?r|f[äa]rg|farve|f[æa]rve/i;

/** True when a field's options look like colours and should render as swatches. */
export function looksLikeColourField(field: PrintingField): boolean {
  const options = field?.options ?? [];
  // A single swatch is not a picker, and one lucky match is not evidence.
  if (options.length < 2) return false;

  const names: string[] = [
    field.name,
    field.code ?? '',
    ...(field.nameI18n ? Object.values(field.nameI18n) : []),
  ].filter((n): n is string => typeof n === 'string' && n.length > 0);
  if (!names.some((n) => COLOUR_FIELD_WORDS.test(n))) return false;

  // The name alone is not enough: "Print colours" (1/2/4) says colour and is a
  // text field. Demand that the vocabulary above actually reads most of the
  // options, because a false positive turns a paper-type list into blank tiles.
  const fills = options.map(swatchColour).filter((f): f is string => f !== null);
  if (fills.length / options.length < 0.7) return false;

  // And demand that the resolved fills are actually DIFFERENT from each other.
  // Without this the catalogue's process fields sail through: "Colour profile"
  // (CMYK / RGB / Pantone) resolves five of six options — to the same rainbow
  // tile four times over — and "White ink & underbase" resolves all five to
  // white. Those are descriptions of a process, not a palette, and a row of
  // identical tiles is worse than the plain cards they replaced.
  const distinct = new Set(fills).size;
  return distinct >= 3 && distinct / fills.length >= 0.6;
}

/** The inner tile's background: solid, checkerboard, or the CMYK wheel. */
function fillStyle(fill: string | null): CSSProperties {
  if (fill === TRANSPARENT_FILL) {
    return {
      backgroundColor: '#ffffff',
      backgroundImage:
        'linear-gradient(45deg,#cbd0da 25%,transparent 25%,transparent 75%,#cbd0da 75%),linear-gradient(45deg,#cbd0da 25%,transparent 25%,transparent 75%,#cbd0da 75%)',
      backgroundSize: '10px 10px',
      backgroundPosition: '0 0, 5px 5px',
    };
  }
  if (fill && fill.startsWith('conic-gradient')) return { backgroundImage: fill };
  if (fill) return { backgroundColor: fill };
  return { backgroundColor: '#e9ebf2' };
}

/**
 * Pale fills need an outline or white disappears into our #eceef4 surface.
 * Rec. 709 luminance on the resolved hex; the checkerboard counts as pale too.
 */
function isPaleFill(fill: string | null): boolean {
  if (fill === TRANSPARENT_FILL) return true;
  if (!fill || !HEX.test(fill)) return false;
  const r = parseInt(fill.slice(1, 3), 16);
  const g = parseInt(fill.slice(3, 5), 16);
  const b = parseInt(fill.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.72;
}

/** The two letters we draw when a colour in a colour field still will not resolve. */
function initialsOf(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

interface NeoColorSwatchesProps {
  options: PrintingFieldOption[];
  selected?: PrintingFieldOption;
  onSelect: (option: PrintingFieldOption) => void;
  /** Renders each option's label in the shopper's language. */
  labelOf: (option: PrintingFieldOption) => string;
  t: (key: TranslationKey) => string;
  /** Tiles shown before the "+N" overflow tile. Default 5. */
  maxVisible?: number;
}

export default function NeoColorSwatches({
  options,
  selected,
  onSelect,
  labelOf,
  t,
  maxVisible = 5,
}: NeoColorSwatchesProps) {
  const [expanded, setExpanded] = useState(false);

  if (!options.length) return null;

  const selectedIndex = selected ? options.findIndex((o) => o.id === selected.id) : -1;
  const hiddenCount = Math.max(0, options.length - maxVisible);
  // "+1" spends a tile to save a tile — only collapse when it buys real room.
  const collapsible = hiddenCount > 1;
  // A pick that lives past the fold must never be invisible, so a selection in
  // the overflow opens the row whether or not the shopper pressed "+N".
  const forcedOpen = selectedIndex >= maxVisible;
  const showAll = !collapsible || expanded || forcedOpen;
  const visible = showAll ? options : options.slice(0, maxVisible);

  /** "+35" / "-10" — the bare number; the currency lives in the accessible text. */
  const signedModifier = (mod: number) => (mod > 0 ? `+${mod}` : String(mod));

  return (
    <div role="group" aria-label={t('ppColourGroupLabel')} className="flex flex-wrap items-start gap-2.5">
      {visible.map((option, index) => {
        const fill = swatchColour(option);
        const name = labelOf(option) || option.value;
        const isSelected = selected?.id === option.id;
        const mod = option.priceModifier || 0;
        const surcharge = t(isChargedOnce(option) ? 'cfgSurchargeOnce' : 'cfgSurchargePerUnit')
          .replace('{0}', signedModifier(mod));
        const label =
          mod !== 0
            ? t('ppColourSwatchAriaPriced').replace('{0}', name).replace('{1}', surcharge)
            : t('ppColourSwatchAria').replace('{0}', name);

        return (
          <motion.div
            key={option.id}
            // Only the tiles that were behind "+N" animate in; the first row is
            // already on screen and must not flicker on every re-render.
            initial={index >= maxVisible ? { opacity: 0, scale: 0.85 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-14 flex-col items-center gap-1"
          >
            <button
              type="button"
              onClick={() => onSelect(option)}
              aria-pressed={isSelected}
              aria-label={label}
              title={name}
              className={cn(
                'w-14 h-14 rounded-2xl p-1.5 flex items-center justify-center transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-orange-500',
                NEO.card,
                NEO.ease,
                isSelected
                  ? 'ring-2 ring-orange-500 -translate-y-0.5 shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]'
                  : 'shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff] hover:-translate-y-0.5 hover:shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]',
              )}
            >
              <span
                aria-hidden="true"
                style={fillStyle(fill)}
                className={cn(
                  // NEO.inset itself is a 12px white/grey bloom — on a 44px tile
                  // it washes the colour out, which is the one thing a colour
                  // picker may not do. Same pressed-in read, a quarter as loud.
                  'flex h-full w-full items-center justify-center rounded-xl shadow-[inset_2px_2px_5px_rgba(0,0,0,0.26),inset_-1px_-1px_3px_rgba(255,255,255,0.30)]',
                  isPaleFill(fill) && 'ring-1 ring-black/10',
                )}
              >
                {/* Up to 30% of a colour field's options may not resolve (see the
                    70% gate); initials beat an anonymous grey square. */}
                {!fill && (
                  <span className="text-[0.625rem] font-black leading-none text-gray-500">
                    {initialsOf(name)}
                  </span>
                )}
              </span>
            </button>

            {mod !== 0 && (
              <span title={surcharge} className="text-[0.5625rem] font-black leading-none text-orange-600">
                {signedModifier(mod)}
              </span>
            )}
          </motion.div>
        );
      })}

      {collapsible && !showAll && (
        <div className="flex w-14 flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            aria-expanded={false}
            aria-label={t('ppColourShowMore').replace('{0}', String(hiddenCount))}
            className={cn(
              'w-14 h-14 rounded-2xl bg-[#3a3f4b] text-white text-xs font-black flex items-center justify-center transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-orange-500 hover:-translate-y-0.5',
              NEO.raisedSm,
              NEO.ease,
              'hover:shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]',
            )}
          >
            +{hiddenCount}
          </button>
        </div>
      )}

      {/* Hidden while `forcedOpen` holds the row open: a collapse button that
          cannot collapse is worse than no button. */}
      {collapsible && showAll && !forcedOpen && (
        <div className="flex w-14 flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded
            aria-label={t('ppColourShowLess')}
            className={cn(
              'w-14 h-14 rounded-2xl bg-[#3a3f4b] text-white flex items-center justify-center transition-all duration-300 outline-none focus-visible:ring-2 focus-visible:ring-orange-500 hover:-translate-y-0.5',
              NEO.raisedSm,
              NEO.ease,
              'hover:shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]',
            )}
          >
            <Minus className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
