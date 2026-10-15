/**
 * THE CLOTHING TEMPLATE (owner, 2026-10-15).
 *
 * A garment is sold the way garment printers sell it: one colour, then HOW MANY
 * OF EACH SIZE — a row of sizes S…5XL with a quantity box under each, a size
 * guide and a downloadable price list. In admin it is a starting point for a new
 * product ("Start from a template → Clothing"); on the product page the size
 * field it creates is recognised by `customSettings.sizeQuantities`.
 *
 * Every size with a quantity becomes its own basket line, so the server prices
 * each one exactly as it prices any line today — no new checkout shape.
 *
 * Colours carry their hex as the option VALUE: the swatch reads a literal hex
 * (src/components/product/NeoColorSwatches.tsx), and the value is never used
 * for pricing (options are priced by id).
 */
import type { PrintingField, PrintingFieldOption } from '../types/index.js';

export const CLOTHING_COLOUR_FIELD_ID = 'garment_colour';
export const CLOTHING_SIZE_FIELD_ID = 'garment_size';

/** [id suffix, English, Swedish, Danish, Norwegian, hex] — the order of the swatch grid. */
const COLOURS: [string, string, string, string, string, string][] = [
  ['white', 'White', 'Vit', 'Hvid', 'Hvit', '#ffffff'],
  ['black', 'Black', 'Svart', 'Sort', 'Svart', '#1f2328'],
  ['natural', 'Natural', 'Natur', 'Natur', 'Natur', '#efe6d4'],
  ['light-pink', 'Light pink', 'Ljusrosa', 'Lyserød', 'Lyserosa', '#e8c4d4'],
  ['sand', 'Sand', 'Sand', 'Sand', 'Sand', '#ddd0bd'],
  ['yellow', 'Yellow', 'Gul', 'Gul', 'Gul', '#f9cf45'],
  ['ash', 'Ash grey', 'Ljusgrå', 'Lysegrå', 'Lysegrå', '#cfcfcf'],
  ['lime', 'Lime', 'Limegrön', 'Limegrøn', 'Limegrønn', '#b5d67a'],
  ['sky', 'Sky blue', 'Himmelsblå', 'Himmelblå', 'Himmelblå', '#9dbcd9'],
  ['gold', 'Gold', 'Guldgul', 'Guldgul', 'Gullgul', '#f6a623'],
  ['cornflower', 'Cornflower blue', 'Kornblå', 'Kornblå', 'Kornblå', '#7ea6dc'],
  ['grey', 'Grey', 'Grå', 'Grå', 'Grå', '#9a9a9a'],
  ['pink', 'Pink', 'Rosa', 'Pink', 'Rosa', '#dd7aa5'],
  ['orange', 'Orange', 'Orange', 'Orange', 'Oransje', '#f25c05'],
  ['heather', 'Heather grey', 'Gråmelerad', 'Gråmeleret', 'Gråmelert', '#7d7d7f'],
  ['sage', 'Sage green', 'Salviagrön', 'Salviegrøn', 'Salviegrønn', '#647a62'],
  ['green', 'Kelly green', 'Grön', 'Grøn', 'Grønn', '#00a651'],
  ['royal', 'Royal blue', 'Kungsblå', 'Kongeblå', 'Kongeblå', '#0a72d6'],
  ['dark-heather', 'Dark heather', 'Mörkgråmelerad', 'Mørkgråmeleret', 'Mørkgråmelert', '#6b6c70'],
  ['fuchsia', 'Fuchsia', 'Cerise', 'Fuchsia', 'Fuchsia', '#cf1f6b'],
  ['red', 'Red', 'Röd', 'Rød', 'Rød', '#d6002a'],
  ['burgundy', 'Burgundy', 'Vinröd', 'Bordeaux', 'Vinrød', '#7a2440'],
  ['maroon', 'Maroon', 'Mörkröd', 'Mørkerød', 'Mørkerød', '#8c1c34'],
  ['bottle', 'Bottle green', 'Flaskgrön', 'Flaskegrøn', 'Flaskegrønn', '#25392f'],
  ['navy', 'Navy', 'Marinblå', 'Marineblå', 'Marineblå', '#1d2a4d'],
  ['purple', 'Purple', 'Lila', 'Lilla', 'Lilla', '#4b1593'],
  ['lilac', 'Pale lilac', 'Ljuslila', 'Lys lilla', 'Lys lilla', '#e6d6dd'],
];

/** [label, chest cm, surcharge kr per piece] — the catalogue's own sizes, S up. */
const SIZES: [string, number, number][] = [
  ['S', 92, 0],
  ['M', 100, 0],
  ['L', 108, 0],
  ['XL', 116, 0],
  ['2XL', 124, 10],
  ['3XL', 132, 18],
  ['4XL', 140, 26],
  ['5XL', 148, 35],
];

/** The two fields the template starts a product with. */
export function clothingFields(): PrintingField[] {
  const colours: PrintingFieldOption[] = COLOURS.map(([id, en, sv, da, no, hex], i) => ({
    id: `ct-col-${id}`,
    label: en,
    labelI18n: { sv, da, no },
    value: hex,
    priceModifier: 0,
    ...(i === 0 ? { isDefault: true } : {}),
  }));
  const sizes: PrintingFieldOption[] = SIZES.map(([label, chest, surcharge]) => ({
    id: `ct-sz-${label.toLowerCase()}`,
    label,
    value: label.toLowerCase(),
    priceModifier: surcharge,
    dimensions: `Chest ${chest} cm`,
    ...(label === 'M' ? { isDefault: true } : {}),
  }));
  return [
    {
      id: CLOTHING_COLOUR_FIELD_ID,
      code: '190.5',
      name: 'Color',
      nameI18n: { sv: 'Färg', da: 'Farve', no: 'Farge' },
      group: 'online_design',
      enabled: true,
      required: true,
      options: colours,
      customSettings: { showAllSwatches: true },
    },
    {
      id: CLOTHING_SIZE_FIELD_ID,
      code: '190.6',
      name: 'Size',
      nameI18n: { sv: 'Storlek', da: 'Størrelse', no: 'Størrelse' },
      group: 'online_design',
      enabled: true,
      required: true,
      options: sizes,
      customSettings: { sizeQuantities: true },
    },
  ];
}

/** Is this the "how many of each size" field? */
export function isSizeQuantityField(field: PrintingField | null | undefined): boolean {
  return field?.customSettings?.sizeQuantities === true;
}

/** "Chest 100 cm" → 100, for the size guide. */
export function chestCmOf(option: PrintingFieldOption): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*cm/i.exec(String(option.dimensions ?? ''));
  return m ? Number(m[1].replace(',', '.')) : null;
}
