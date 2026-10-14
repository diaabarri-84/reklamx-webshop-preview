/**
 * An element's name in the customer's language, and the words a search finds it by:
 * his language's and the library's English ones (scripts/build-designer-elements.mjs
 * writes both). The library spoke English only, so a search for "hjärta" found nothing
 * in a Swedish shop (code review DSN-20). Pure; scripts/test-element-names.mjs.
 */
import type { Language } from '../../../../lib/translations';

export interface NamedElement {
  label: string;
  keywords: string[];
  /** Its name and search words in the shop's other languages. */
  i18n?: Partial<Record<Exclude<Language, 'en'>, { label: string; keywords: string[] }>>;
}

/**
 * Lower case, accents off: "Hjärta" is found by "hjarta" too. Ø and æ are letters of their
 * own, which taking accents off leaves alone: folded by hand to o and ae, as a keyboard
 * without them types them, so "hjerteojne" finds "Hjerteøjne" (second pass, Q).
 */
// ø, æ and å are typed three ways without their keys: "hjerteojne", "hjerteoejne",
// "karlighed", "kaerlighed", "aa" for å. All fold to one form, the query and the names
// alike, so each spelling finds the others (an English "shoe" folds the same both sides).
export const foldText = (s: string) => s.toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'a').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/oe/g, 'o').replace(/ae/g, 'a').replace(/aa/g, 'a');

/** What the element is called in the customer's language (English where it has no other name). */
export function elementLabel(e: NamedElement, language: Language): string {
  return (language !== 'en' ? e.i18n?.[language]?.label : undefined) || e.label;
}

/** Does every word typed appear in the element's names — his language's, the English ones, or its category's? */
export function elementMatches(e: NamedElement, query: string, language: Language, categoryWord = ''): boolean {
  const q = foldText(query.trim());
  if (!q) return false;
  const own = language !== 'en' ? e.i18n?.[language] : undefined;
  const words = [own?.label ?? '', ...(own?.keywords ?? []), e.label, ...e.keywords, categoryWord].map(foldText).join(' ');
  return q.split(/\s+/).every((w) => words.includes(w));
}
