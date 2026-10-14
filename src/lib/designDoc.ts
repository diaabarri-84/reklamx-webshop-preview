/**
 * A DESIGN, ALL ITS SIDES — designer v2.
 *
 * One design is one document: a list of sides (front, back), each one fabric's
 * `{version, background, objects}` held as a JSON STRING. Strings are immutable, so a
 * history step that changed the front shares the back with the step before it, at
 * no cost — the history is ONE list of whole-document steps (the template a design
 * started from travels with every step, so per-side histories would disagree).
 *
 * Everything that walks a design — the pictures it uses, the fonts it needs, how
 * many objects it has — walks EVERY side here. A walker that saw only the side on
 * screen would let the device draft delete the other side's pictures.
 *
 * A round-16 design (one side, fabric's object at the top) reads as its front.
 * Pure; scripts/test-design-doc.mjs.
 */
import type { SideId } from './printSides.js';

export type { SideId } from './printSides.js';

export interface DesignSide {
  id: SideId;
  /** fabric's {version, background, objects}, as JSON. */
  json: string;
}

export interface DesignDoc {
  v: 2;
  sides: DesignSide[];
  /** The template the design started from (the designer's TemplateMeta), or null. */
  template: Record<string, unknown> | null;
}

export const BLANK_SIDE_JSON = JSON.stringify({ version: '7.4.0', background: '#ffffff', objects: [] });
const SIDE_IDS: readonly SideId[] = ['front', 'back'];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored design (v2, or a round-16 single-side one), or null when it is neither. */
export function parseDesignDoc(raw: unknown): DesignDoc | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(data)) return null;
  const template = isRecord(data.template) ? data.template : isRecord(data.rxTemplate) ? data.rxTemplate : null;
  if (data.v === 2 && Array.isArray(data.sides)) {
    const sides: DesignSide[] = [];
    for (const s of data.sides) {
      if (!isRecord(s) || !SIDE_IDS.includes(s.id as SideId) || sides.some((x) => x.id === s.id)) return null;
      const json = typeof s.json === 'string' ? s.json : isRecord(s.json) ? JSON.stringify(s.json) : null;
      if (!json || !isSideJson(json)) return null;
      sides.push({ id: s.id as SideId, json });
    }
    if (sides.length === 0) return null;
    return { v: 2, sides: orderSides(sides), template };
  }
  if (Array.isArray(data.objects)) {
    const { rxTemplate: _t, ...side } = data;
    return { v: 2, sides: [{ id: 'front', json: JSON.stringify(side) }], template };
  }
  return null;
}

function isSideJson(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    return isRecord(parsed) && Array.isArray(parsed.objects);
  } catch {
    return false;
  }
}

const orderSides = (sides: DesignSide[]) => [...sides].sort((a, b) => SIDE_IDS.indexOf(a.id) - SIDE_IDS.indexOf(b.id));

export function serializeDesignDoc(doc: DesignDoc): string {
  return JSON.stringify({ v: 2, sides: doc.sides, template: doc.template ?? null });
}

export function sideJson(doc: DesignDoc, id: SideId): string | null {
  return doc.sides.find((s) => s.id === id)?.json ?? null;
}

/** A new document with this side's JSON replaced (or added); every other side shared. */
export function withSide(doc: DesignDoc, id: SideId, json: string): DesignDoc {
  const others = doc.sides.filter((s) => s.id !== id);
  return { ...doc, sides: orderSides([...others, { id, json }]) };
}

/**
 * The document with at least these sides (blank ones added). A side the product no
 * longer prints is KEPT: switching back to double-sided brings the back back. What
 * is printed is decided by the product's sides, never by what the draft holds.
 */
export function ensureSides(doc: DesignDoc, wanted: SideId[]): DesignDoc {
  let out = doc;
  for (const id of wanted) if (!sideJson(out, id)) out = withSide(out, id, BLANK_SIDE_JSON);
  return out;
}

export function blankDesignDoc(sides: SideId[]): DesignDoc {
  return ensureSides({ v: 2, sides: [], template: null }, sides.length ? sides : ['front']);
}

/** Walk every object of one side's JSON, groups and clip shapes included. */
function walkObjects(json: string, visit: (o: Record<string, unknown>) => void): void {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return;
  }
  const walk = (objects: unknown, depth: number) => {
    if (!Array.isArray(objects) || depth > 4) return;
    for (const o of objects) {
      if (!isRecord(o)) continue;
      visit(o);
      walk(o.objects, depth + 1);
    }
  };
  walk(isRecord(data) ? data.objects : null, 0);
}

/** Every picture id ANY side uses — the colour-edited picture's original too. */
export function designImageIds(doc: DesignDoc): string[] {
  const ids = new Set<string>();
  for (const side of doc.sides) {
    walkObjects(side.json, (o) => {
      if (typeof o.rxImageId === 'string' && o.rxImageId) ids.add(o.rxImageId);
      if (typeof o.rxOrigId === 'string' && o.rxOrigId) ids.add(o.rxOrigId);
    });
  }
  return [...ids];
}

/** The font families one side's text uses (load them BEFORE fabric builds the text). */
export function sideFontFamilies(json: string): string[] {
  const families = new Set<string>();
  walkObjects(json, (o) => {
    if (typeof o.fontFamily === 'string' && o.fontFamily) families.add(o.fontFamily);
  });
  return [...families];
}

export function designFontFamilies(doc: DesignDoc): string[] {
  return [...new Set(doc.sides.flatMap((s) => sideFontFamilies(s.json)))];
}

/** Objects on a side, group members counted — what a reload must give back, one for one. */
export function countSideObjects(json: string): number {
  let n = 0;
  walkObjects(json, () => {
    n += 1;
  });
  return n;
}
