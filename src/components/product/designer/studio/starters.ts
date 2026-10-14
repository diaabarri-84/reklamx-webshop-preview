/**
 * The shop's own designs (src/lib/starterTemplates.ts) for this screen: in the
 * customer's language, built for the product as configured, and drawn small for the
 * gallery's cards — lazily, a few at a time, each picture made once.
 */
import { StaticCanvas } from 'fabric';
import '../rxObjects';
import type { TranslationKey } from '../../../../lib/translations';
import { buildStarter, type StarterContext, type StarterWords } from '../../../../lib/starterTemplates';
import { sideFontFamilies, type DesignDoc, type SideId } from '../../../../lib/designDoc';
import { ensureFontFamilies } from '../fonts';
import type { TemplateMeta } from '../types';

export function starterWords(t: (k: TranslationKey) => string): StarterWords {
  return {
    name: t('stSmpName'),
    title: t('stSmpTitle'),
    company: t('stSmpCompany'),
    phone: t('stSmpPhone'),
    email: t('stSmpEmail'),
    web: t('stSmpWeb'),
    address: t('stSmpAddress'),
    headline: t('stSmpHeadline'),
    sub: t('stSmpSub'),
    body: t('stSmpBody'),
    day: t('stSmpDay'),
    month: t('stSmpMonth'),
    place: t('stSmpPlace'),
    offer: t('stSmpOffer'),
    sale: t('stSmpSale'),
    cta: t('stSmpCta'),
    slogan: t('stSmpSlogan'),
    photoHere: t('dsgPhotoHere'),
  };
}

/** A starter as a studio document, with the template it came from (a starter never needs refitting: it is built for the size). */
export function starterDoc(
  id: string,
  variant: string | null | undefined,
  ctx: StarterContext,
  name: string,
): DesignDoc | null {
  const built = buildStarter(id, variant, ctx);
  if (!built) return null;
  const meta: TemplateMeta & { starter: true; variant: string } = {
    id,
    name,
    trimMm: { ...ctx.trimMm },
    outline: ctx.outline,
    lowestPictureDpi: null,
    lockBackground: false,
    starter: true,
    variant: built.palette.id,
  };
  return { v: 2, sides: built.sides, template: meta as unknown as Record<string, unknown> };
}

// ---- small pictures of a side ------------------------------------------------------------------

const cache = new Map<string, string>();
/**
 * The picture a slot holds now: a new one for the slot replaces it in the cache. The
 * 3D view made a 900 px picture of each side every time it opened after a change, and
 * kept them all (tens of MB in a long session — code review DSN-18).
 */
const slots = new Map<string, string>();
const queue: Array<() => Promise<void>> = [];
let running = 0;
const PARALLEL = 2;

function pump() {
  while (running < PARALLEL && queue.length) {
    const job = queue.shift()!;
    running += 1;
    void job().finally(() => {
      running -= 1;
      pump();
    });
  }
}

/**
 * The TRIM area of one side's JSON as a PNG data URL about `maxPx` on its longer
 * side — fonts loaded first, so a card shows the face the design uses. Cached by
 * `key` (by `slot`, only the latest of each); a few drawn at a time so a long gallery
 * never stalls the page.
 */
export function sideThumb(
  key: string,
  json: string,
  trimMm: { wMm: number; hMm: number },
  bleedMm: number,
  maxPx: number,
  { slot }: { slot?: string } = {},
): Promise<string> {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const again = cache.get(key);
        if (again) {
          resolve(again);
          return;
        }
        await ensureFontFamilies(sideFontFamilies(json));
        const host = document.createElement('canvas');
        const scene = new StaticCanvas(host, { width: 1, height: 1, enableRetinaScaling: false, renderOnAddRemove: false });
        try {
          await scene.loadFromJSON(json);
          const u = 10;
          const w = trimMm.wMm * u;
          const h = trimMm.hMm * u;
          const el = scene.toCanvasElement(maxPx / Math.max(w, h), { left: bleedMm * u, top: bleedMm * u, width: w, height: h });
          const url = el.toDataURL('image/png');
          el.width = 0;
          el.height = 0;
          cache.set(key, url);
          if (slot) {
            const before = slots.get(slot);
            if (before !== undefined && before !== key) cache.delete(before);
            slots.set(slot, key);
          }
          if (cache.size > 300) cache.delete(cache.keys().next().value as string);
          resolve(url);
        } finally {
          void scene.dispose();
          host.width = 0;
          host.height = 0;
        }
      } catch (err) {
        reject(err);
      }
    });
    pump();
  });
}

export type ThumbSide = SideId;
