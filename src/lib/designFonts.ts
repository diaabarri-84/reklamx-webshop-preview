/**
 * The designer's font families — one list for the browser's loader, the picker
 * and the server's design cleaner (src/lib/designSchema.ts), from the manifest that
 * scripts/fetch-designer-fonts.mjs writes. A design naming a family not in here is
 * drawn in the default family instead: a font the shop does not have would be
 * replaced by the device's own fallback, and print something nobody approved.
 */
import library from '../components/product/designer/fontLibrary.json';

export type FontCategory = 'sans' | 'serif' | 'display' | 'script' | 'mono';

export interface DesignerFontFace {
  file: string;
  style: 'normal' | 'italic';
  /** "400", "700", or a range "400 700" for one variable file. */
  weight: string;
}

export interface DesignerFontFamily {
  /** What text objects carry and the FontFace is registered under ("RX Inter"). */
  family: string;
  /** What the customer reads in the picker. */
  label: string;
  slug: string;
  category: FontCategory;
  licence: string;
  /** A real bold face exists (synthetic bold differs between browsers — never offered). */
  bold: boolean;
  /** A real italic face exists. */
  italic: boolean;
  faces: DesignerFontFace[];
}

export const DESIGNER_FONT_LIBRARY: readonly DesignerFontFamily[] = library as DesignerFontFamily[];

export const DEFAULT_DESIGNER_FONT = 'RX Inter';

const BY_FAMILY = new Map(DESIGNER_FONT_LIBRARY.map((f) => [f.family, f]));

export function fontFamilyInfo(family: unknown): DesignerFontFamily | null {
  return BY_FAMILY.get(String(family)) ?? null;
}

export function isDesignerFontFamily(family: unknown): boolean {
  return BY_FAMILY.has(String(family));
}
