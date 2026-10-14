/**
 * A DESIGN TEMPLATE AS THE SHOP SERVES IT — round 16, item 5b.
 *
 * The owner writes `designTemplates/{id}` from the dashboard; customers never
 * read Firestore for it. The server reads the collection once after each change,
 * cleans every document with this module, and answers from its copy. A document
 * that cannot be served WHOLE is not served at all: above all one whose design
 * names a picture the document does not hold (or holds at an address that is not
 * the shop's own storage). Shown without it, the shop's own logo would silently
 * be missing from the customer's print file.
 *
 * Pure; scripts/test-design.mjs.
 */
import { cleanScope, type TemplateScope } from './designTemplateMatch.js';
import { isOutlineKind, type OutlineKind } from './shapes.js';
import { cleanDesignSide, DESIGN_IMAGE_ID } from './designSchema.js';
import { DEFAULT_DESIGNER_FONT, isDesignerFontFamily } from './designFonts.js';

/** Characters of design JSON a template may hold (pictures live in Storage, never inline). */
export const TEMPLATE_JSON_MAX = 200_000;

export interface TemplateSummary {
  id: string;
  name: string;
  nameI18n: Partial<Record<'sv' | 'da' | 'no', string>> | null;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  thumbnailUrl: string;
  lowestPictureDpi: number | null;
  scope: TemplateScope;
  sortOrder: number;
}

export interface TemplateFull extends TemplateSummary {
  /** The board, as fabric JSON; pictures referenced by rxImageId. */
  json: string;
  /** rxImageId → the picture's download URL. */
  images: Record<string, string>;
  /** The customer may not change the background colour. */
  lockBackground: boolean;
  hidden: boolean;
}

/** A picture's id, as the designer makes them (img-<time>-<random>): never "__proto__" or "constructor". */
export const TEMPLATE_IMAGE_ID = DESIGN_IMAGE_ID;

/**
 * The design as it may reach a customer's browser, or null.
 *
 * fabric's loadFromJSON sets EVERY key it is given on the customer's canvas and
 * objects, so the design is rebuilt from an ALLOWLIST (src/lib/designSchema.ts):
 * only the background colour and the objects, each object only with the keys its
 * kind has. A picture only at the top level, only by its id, with its address taken
 * out — the browser puts in the template's own, checked one: an address from
 * anywhere else would be fetched by every customer, and an image from another site
 * would taint the canvas so that no print file could be made. A font the designer
 * does not have is replaced by its default.
 */
export function cleanDesignJson(json: string): { json: string; imageIds: string[] } | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const cleaned = cleanDesignSide(data, { fontFamilyOk: isDesignerFontFamily, defaultFont: DEFAULT_DESIGNER_FONT });
  if (!cleaned) return null;
  return { json: JSON.stringify(cleaned.side), imageIds: cleaned.imageIds };
}

/** Every rxImageId the design names, inside groups too. */
export function referencedImageIds(json: string): string[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const ids = new Set<string>();
  const walk = (objects: unknown, depth: number) => {
    if (!Array.isArray(objects) || depth > 8) return;
    for (const o of objects as Array<Record<string, unknown>>) {
      if (o && typeof o.rxImageId === 'string' && o.rxImageId) ids.add(o.rxImageId);
      // The original of a colour-edited picture: kept to edit again, and with the draft.
      if (o && typeof o.rxOrigId === 'string' && o.rxOrigId) ids.add(o.rxOrigId);
      walk(o?.objects, depth + 1);
    }
  };
  walk((data as { objects?: unknown })?.objects, 0);
  return [...ids];
}

// Control characters out: a name goes on a plain-text order sheet, line by line.
const text = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/**
 * The document, cleaned, or null when it cannot be served whole.
 * `allowedUrl` says whether an address is the shop's own storage.
 */
export function cleanTemplateDoc(
  id: string,
  raw: Record<string, unknown> | null | undefined,
  allowedUrl: (url: string) => boolean,
): TemplateFull | null {
  if (!raw || typeof raw !== 'object') return null;
  const trim = raw.trimMm as { wMm?: unknown; hMm?: unknown } | undefined;
  const wMm = Number(trim?.wMm);
  const hMm = Number(trim?.hMm);
  if (!(wMm > 0 && hMm > 0 && wMm <= 5000 && hMm <= 5000)) return null;
  const outline = raw.outline == null ? null : isOutlineKind(raw.outline) ? (raw.outline as OutlineKind) : undefined;
  // A custom contour's cut line lives in the customer's own file: never a template.
  if (outline === undefined || outline === 'custom') return null;
  const rawJson = typeof raw.json === 'string' ? raw.json : '';
  if (!rawJson || rawJson.length > TEMPLATE_JSON_MAX) return null;
  const design = cleanDesignJson(rawJson);
  if (!design) return null;
  const json = design.json;
  // Exactly the pictures the design uses, each by an OWN key of the document's
  // map: "constructor" is in every plain object, and would pass for a picture
  // the document never held.
  const images: Record<string, string> = Object.create(null);
  const stored = (raw.images && typeof raw.images === 'object' ? raw.images : {}) as Record<string, { url?: unknown } | null>;
  for (const imageId of design.imageIds) {
    const entry = Object.prototype.hasOwnProperty.call(stored, imageId) ? stored[imageId] : null;
    const url = typeof entry?.url === 'string' ? entry.url : '';
    if (!url || !allowedUrl(url)) return null;
    images[imageId] = url;
  }
  const i18n = (raw.nameI18n && typeof raw.nameI18n === 'object' ? raw.nameI18n : {}) as Record<string, unknown>;
  const nameI18n: Partial<Record<'sv' | 'da' | 'no', string>> = {};
  for (const lang of ['sv', 'da', 'no'] as const) {
    const v = text(i18n[lang], 120);
    if (v) nameI18n[lang] = v;
  }
  const thumb = typeof raw.thumbnailUrl === 'string' && allowedUrl(raw.thumbnailUrl) ? raw.thumbnailUrl : '';
  const dpi = Number(raw.lowestPictureDpi);
  return {
    id,
    name: text(raw.name, 120) || 'Template',
    nameI18n: Object.keys(nameI18n).length ? nameI18n : null,
    trimMm: { wMm, hMm },
    outline,
    thumbnailUrl: thumb,
    lowestPictureDpi: dpi > 0 ? dpi : null,
    scope: cleanScope(raw.scope),
    sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    json,
    images,
    lockBackground: raw.lockBackground === true,
    hidden: raw.hidden === true,
  };
}

/** What the list endpoint sends: no design, no pictures. */
export function summaryOf(t: TemplateFull): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    nameI18n: t.nameI18n,
    trimMm: t.trimMm,
    outline: t.outline,
    thumbnailUrl: t.thumbnailUrl,
    lowestPictureDpi: t.lowestPictureDpi,
    scope: t.scope,
    sortOrder: t.sortOrder,
  };
}
