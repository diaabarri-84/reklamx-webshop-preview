/**
 * THE DESIGNER'S TYPEFACES — loaded per family, when a design needs them (designer v2).
 *
 * 35 open-licence families (src/lib/designFonts.ts; files under ./fonts as hashed
 * Vite assets, licences in public/fonts/designer). Their latin subset carries
 * å ä ö æ ø, € and typographic quotes.
 *
 * WHY WAITED FOR, AND WHY THE ORDER MATTERS. The text in a print file is drawn by
 * the browser at export time, in whatever font it has at that moment; a font that
 * has not arrived is silently replaced by the device's fallback. fabric also caches
 * every character's width per family, so text MEASURED before its font arrived keeps
 * the fallback's widths — the line breaks of one font, drawn in another. So: every
 * face of a family is loaded BEFORE any object using it is built, then the code
 * yields one task (WebKit keeps measuring with the fallback inside the same task, the
 * review proved it), then the family's width cache is cleared.
 *
 * Only real faces are offered: synthetic bold differs between Chrome and WebKit, so a
 * family without a 700 face has no Bold button (its `bold` is false).
 */
import { cache } from 'fabric';
import { DEFAULT_DESIGNER_FONT, DESIGNER_FONT_LIBRARY, fontFamilyInfo } from '../../../lib/designFonts';
import { FONT_URLS } from './fontUrls';

export { DEFAULT_DESIGNER_FONT } from '../../../lib/designFonts';

const familyLoads = new Map<string, Promise<boolean>>();

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Every face of one family, once per page. False when it could not load (a later call tries again). */
export function ensureFontFamily(family: string): Promise<boolean> {
  const info = fontFamilyInfo(family);
  if (!info) return Promise.resolve(false);
  let loading = familyLoads.get(family);
  if (!loading) {
    loading = (async () => {
      try {
        const faces = await Promise.all(
          info.faces.map((face) => {
            const url = FONT_URLS[face.file];
            if (!url) throw new Error(`no file for ${face.file}`);
            return new FontFace(family, `url(${url}) format('woff2')`, { weight: face.weight, style: face.style }).load();
          }),
        );
        for (const face of faces) document.fonts.add(face);
        await nextTask();
        cache.clearFontCache(family);
        return true;
      } catch {
        familyLoads.delete(family);
        return false;
      }
    })();
    familyLoads.set(family, loading);
  }
  return loading;
}

/**
 * The families a design uses, plus the default, all loaded — call BEFORE fabric
 * builds the design's text (a draft, a template, an undo step, a side switch, the
 * print file, a thumbnail). An unknown family is the default's (the cleaner maps it).
 */
export async function ensureFontFamilies(families: Iterable<string>): Promise<{ failed: string[] }> {
  const list = [...new Set([DEFAULT_DESIGNER_FONT, ...families])].filter((f) => fontFamilyInfo(f));
  const results = await Promise.all(list.map((f) => ensureFontFamily(f)));
  return { failed: list.filter((_, i) => !results[i]) };
}

/** Has this family loaded on this page? (the print file is refused while one it uses has not). */
export function isFontFamilyLoaded(family: string): boolean {
  const info = fontFamilyInfo(family);
  if (!info || !familyLoads.has(family)) return false;
  try {
    return info.faces.every((face) => document.fonts.check(`${face.style === 'italic' ? 'italic ' : ''}${face.weight.split(' ')[0]} 16px "${family}"`));
  } catch {
    return false;
  }
}

// ---- round-16 interface, kept until the designer's v2 shell replaces its picker ----

export interface DesignerFont {
  family: string;
  label: string;
  file: string;
}

/** The four families the round-16 picker offers. */
export const DESIGNER_FONTS: readonly DesignerFont[] = ['RX Inter', 'RX Montserrat', 'RX Playfair Display', 'RX Dancing Script']
  .map((family) => fontFamilyInfo(family))
  .filter((f): f is NonNullable<typeof f> => !!f)
  .map((f) => ({ family: f.family, label: f.label, file: f.slug }));

/** The round-16 picker's families, loaded; resolves with those that loaded. */
export async function loadDesignerFonts(): Promise<Set<string>> {
  await ensureFontFamilies(DESIGNER_FONTS.map((f) => f.family));
  return new Set(DESIGNER_FONTS.map((f) => f.family).filter((f) => familyLoads.has(f)));
}

export const ALL_DESIGNER_FONTS = DESIGNER_FONT_LIBRARY;
