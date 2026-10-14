/**
 * THE HOME PAGE'S SECTIONS, IN HIS ORDER — client, 2026-10-07 ("lay out the pages
 * and order them"): the five sections of the home page were in a fixed order in
 * the code. settings.homeSectionOrder holds his order; this reads it safely — an
 * unknown id is dropped, a section it does not mention (a new one in an update)
 * is added at the end, so nothing he did not ask to remove ever disappears.
 * Pure; scripts/test-home-sections.mjs.
 */
export const HOME_SECTIONS = ['hero', 'categories', 'benefits', 'inspiration', 'news'] as const;
export type HomeSectionId = (typeof HOME_SECTIONS)[number];

export function homeSectionOrder(saved: unknown): HomeSectionId[] {
  const known = new Set<string>(HOME_SECTIONS);
  const seen = new Set<string>();
  const out: HomeSectionId[] = [];
  for (const id of Array.isArray(saved) ? saved : []) {
    const key = String(id);
    if (known.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key as HomeSectionId);
    }
  }
  for (const id of HOME_SECTIONS) if (!seen.has(id)) out.push(id);
  return out;
}
