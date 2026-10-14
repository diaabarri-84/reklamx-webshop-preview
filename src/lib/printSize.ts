import type { PrintingFieldOption } from '../types';

/**
 * WHAT SIZE DID THE CUSTOMER ACTUALLY CHOOSE?
 *
 * This lived inside src/components/NeoOptionField.tsx, a React component, which
 * meant the one piece of arithmetic that decides whether a customer's artwork is
 * accepted or refused could not be tested without rendering a component — the
 * same reason the option-tree pricing was moved to src/lib/optionTree.ts.
 * NeoOptionField re-exports both functions, so nothing that imports them from
 * there had to change.
 *
 * It decides three visible things: the size line on an option card, the sentence
 * the dropzone shows the customer ("your file must be 85 × 200 cm"), and the
 * check that rejects a file whose dimensions do not match.
 */

/** Standard ISO A-series sizes in mm, for labels like "Poster A3". */
export const A_SERIES_MM: Record<string, string> = {
  A0: '841 × 1189 mm',
  A1: '594 × 841 mm',
  A2: '420 × 594 mm',
  A3: '297 × 420 mm',
  A4: '210 × 297 mm',
  A5: '148 × 210 mm',
  A6: '105 × 148 mm',
  A7: '74 × 105 mm',
};

/**
 * Resolve an option's dimensions STRING: the stored value when the admin
 * provided one, otherwise derived from the label — "A4" becomes "210 × 297 mm",
 * "Folder 148x210" becomes "148 × 210 mm". Returns undefined when neither works.
 * Single source of truth for both the display line and the numeric parser.
 */
export function resolveDimensionsString(option: PrintingFieldOption): string | undefined {
  if (option.dimensions) return option.dimensions;
  const label = option.label || '';
  const aMatch = /\b(A[0-7])\b/.exec(label);
  if (aMatch) return A_SERIES_MM[aMatch[1]];
  /**
   * THE UNIT ON THE LABEL IS THE LABEL'S — 15.2.1.
   *
   * This line used to end `${wh[1]} × ${wh[2]} mm` unconditionally, so an
   * option the owner had written as "Rollup 85x200 cm" was resolved to
   * "85 × 200 mm" and every consumer of this string believed it: the card
   * printed 85 × 200 mm, the dropzone promised the customer his file must be
   * 85 × 200 mm, and the correct 850 × 2000 mm artwork for a roll-up was
   * REFUSED. On the owner's own best-selling product.
   *
   * A written unit is now carried through. With a unit present any number is
   * accepted, including "1,5 x 2 m"; with none, the old two-to-four-digit rule
   * and the mm assumption stand exactly as they were — an unlabelled "85x200"
   * is still read as millimetres, because guessing the other way would silently
   * change the size on every product that has relied on it. The way to be
   * certain is still the option's own `dimensions` field, which wins above.
   */
  const withUnit = /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\b/i.exec(label);
  if (withUnit) return `${withUnit[1]} × ${withUnit[2]} ${withUnit[3].toLowerCase()}`;
  const wh = /(\d{2,4})\s*[x×]\s*(\d{2,4})/.exec(label);
  if (wh) return `${wh[1]} × ${wh[2]} mm`;
  return undefined;
}

/** The dimensions line for an option card (see resolveDimensionsString). */
export function optionDimensions(option: PrintingFieldOption): string | undefined {
  return resolveDimensionsString(option);
}

/**
 * The same resolution as optionDimensions, but as NUMBERS in millimetres, so
 * uploaded artwork can be checked against the chosen print size. Handles
 * "148 × 210 mm", "85x55 mm", decimal commas, cm-denominated strings
 * ("21 × 29,7 cm") and metres ("1,5 × 2 m"). Returns null when the option
 * carries no parseable size.
 */
export function parseDimensionsMm(
  option: PrintingFieldOption,
): { wMm: number; hMm: number } | null {
  const dims = resolveDimensionsString(option);
  if (!dims) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/.exec(dims);
  if (!m) return null;
  let wMm = parseFloat(m[1].replace(',', '.'));
  let hMm = parseFloat(m[2].replace(',', '.'));
  if (!Number.isFinite(wMm) || !Number.isFinite(hMm) || wMm <= 0 || hMm <= 0) return null;
  if (/\bcm\b/i.test(dims)) {
    wMm *= 10;
    hMm *= 10;
  } else if (/\bm\b/i.test(dims)) {
    // Metres — banners and hall drapes are quoted that way. `\b` cannot match
    // the m of "mm": the character beside it is a word character either way.
    wMm *= 1000;
    hMm *= 1000;
  }
  return { wMm, hMm };
}

/**
 * The size as the CUSTOMER would write it — 15.6.2.
 *
 * "850 × 2000 mm" is correct and unreadable; nobody orders a roll-up in
 * millimetres. Anything from 100 mm up is said in centimetres, which is how
 * both the trade and the customer talk about banners, roll-ups and posters, and
 * smaller print (business cards, labels, A-sizes) stays in mm where the
 * precision matters.
 */
export function formatSizeForShopper(wMm: number, hMm: number): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
  if (wMm >= 100 || hMm >= 100) return `${trim(wMm / 10)} × ${trim(hMm / 10)} cm`;
  return `${trim(wMm)} × ${trim(hMm)} mm`;
}

/**
 * HOW BIG IS THIS ORDER LINE, ACCORDING TO WHAT WAS ACTUALLY RECORDED?
 *
 * An order line can carry the size in three places, and which one it has
 * depends on how the job was sold:
 *   fileSpecs.widthCm   the file the customer attached was measured
 *   widthCm             the server PRICED the line on a size he typed
 *   printWidthCm        the size of the option he picked, on a product that
 *                       charges a flat price and never asks for one
 *
 * Every screen that prints a size was reading a different subset of those. The
 * work order's item list and its own Print-Specs tile disagreed on the same
 * sheet — "85 × 200 cm" beside "Standard Size" — because one had been given the
 * fallback chain and the other still read fileSpecs alone. That is what a rule
 * copied by hand into four files does.
 *
 * Returns null when the line genuinely has no size. Callers must print nothing
 * in that case: a work order that says 0 × 0 cm, or invents 28 × 35, is worse
 * than one that says nothing, and this shop has shipped both.
 */
export function printSizeOf(item: unknown): { widthCm: number; heightCm: number } | null {
  const line = (item ?? {}) as Record<string, any>;
  const pick = (...values: unknown[]): number => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  };
  const widthCm = pick(line.fileSpecs?.widthCm, line.widthCm, line.printWidthCm);
  const heightCm = pick(line.fileSpecs?.heightCm, line.heightCm, line.printHeightCm);
  return widthCm > 0 && heightCm > 0 ? { widthCm, heightCm } : null;
}

/**
 * PAY-05 — A CUSTOM UPLOAD WHOSE FILE IS NOT THE LENGTH THAT WAS PAID FOR.
 *
 * The upload page prices the length the customer TYPES, and keeps beside it the
 * length it read off his file (`fileSpecs.calculatedHeightCm` — only a custom
 * upload carries one). Nothing printed the second: a 3 m file sold as 50 cm went
 * to the press as "28 × 50 cm", and the difference was found at the machine, if
 * at all. The work order and the Drive order sheet now say it.
 *
 * Null unless both lengths are known and they differ by more than 10% — a length
 * read off a picture at its own resolution is never exact, and a few centimetres
 * either way are the same job. The paid length is the one the server PRICED the
 * line on, else the one the upload page sent with the file.
 */
export const MEASURED_LENGTH_TOLERANCE = 0.1;

export function measuredLengthMismatch(item: unknown): { paidCm: number; measuredCm: number } | null {
  const line = (item ?? {}) as Record<string, any>;
  const measured = Number(line.fileSpecs?.calculatedHeightCm);
  if (!Number.isFinite(measured) || measured <= 0) return null;
  const paid = [line.heightCm, line.fileSpecs?.heightCm]
    .map((value) => Number(value))
    .find((n) => Number.isFinite(n) && n > 0);
  if (paid === undefined) return null;
  if (Math.abs(measured - paid) <= paid * MEASURED_LENGTH_TOLERANCE) return null;
  const tidy = (n: number) => Math.round(n * 10) / 10;
  return { paidCm: tidy(paid), measuredCm: tidy(measured) };
}

/** What the work order and the Drive order sheet print: "Paid 50 cm — the file measures 300 cm". */
export function measuredLengthText(m: { paidCm: number; measuredCm: number }): string {
  return `Paid ${m.paidCm} cm — the file measures ${m.measuredCm} cm`;
}
