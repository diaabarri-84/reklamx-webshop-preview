import { LocalizedList, LocalizedText } from '../types';
import { Language } from './translations';

/**
 * Pick shop-owner text for the current language.
 *
 * Product and option names are typed by the owner in the dashboard, so they
 * cannot live in translations.ts like UI chrome does. Each one carries an
 * optional per-language map beside the original single string; that string
 * stays the fallback so everything entered before the map existed still
 * renders, and a half-filled map degrades to it one language at a time
 * rather than showing a blank.
 */
export function localized(
  fallback: string,
  // `null` as well as undefined: a cleared map is written as null, because the
  // dashboard saves with { merge: true } and an omitted key would survive.
  i18n: LocalizedText | null | undefined,
  language: Language,
): string {
  const forLanguage = i18n?.[language]?.trim();
  if (forLanguage) return forLanguage;
  const english = i18n?.en?.trim();
  if (english) return english;
  return fallback;
}

/**
 * The list version of `localized`, for owner-authored bullet lists.
 *
 * A partially translated list is worse than an untranslated one — half the
 * bullets in Swedish and half in English reads as a bug — so this swaps the
 * WHOLE list or none of it, and an empty array counts as "not translated".
 */
export function localizedList(
  fallback: string[] | undefined,
  i18n: LocalizedList | undefined,
  language: Language,
): string[] {
  const forLanguage = i18n?.[language];
  if (forLanguage?.length) return forLanguage;
  const english = i18n?.en;
  if (english?.length) return english;
  return fallback ?? [];
}
