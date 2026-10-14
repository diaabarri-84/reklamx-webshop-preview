/**
 * THE DESIGN GALLERY — what "Open the designer" opens first, as on Pixartprinting:
 * every ready-made design for THIS product (the shop owner's own, and the shop's
 * starters built for the size — src/lib/starterTemplates.ts), filtered by use, style
 * and industry, each card in its colour variants; a card opens a preview of both
 * sides; "Create now" starts from a blank page, "Continue your design" from the
 * customer's own draft. The owner decides the order of all of them and can hide any
 * (his decision of 2026-10-07): `order` and `hidden` come from the shop's settings.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, CirclePlus, History, LayoutTemplate, Loader2, Minus, Plus, SlidersHorizontal } from 'lucide-react';
import { CircleClose, ScrollPen, ShopMark, UI_FONT, useUiFont } from './look';
import { cn } from '../../../../lib/utils';
import type { Language, TranslationKey } from '../../../../lib/translations';
import { localized } from '../../../../lib/localizedText';
import { localeFor } from '../../../../lib/dateFormat';
import { templateMiss, type TemplateMiss } from '../../../../lib/designTemplateMatch';
import { offeredDesigns } from '../../../../lib/templateOrder';
import type { OutlineKind } from '../../../../lib/shapes';
import type { PrintSpec, ProductKind } from '../../../../lib/printSpec';
import type { SideId } from '../../../../lib/printSides';
import {
  buildStarter,
  startersFor,
  type Palette,
  type StarterContext,
  type StarterDef,
  type StarterIndustry,
  type StarterStyle,
  type StarterUse,
} from '../../../../lib/starterTemplates';
import type { TemplateSummary } from '../types';
import { sideThumb, starterWords } from './starters';

export type GalleryChoice = { template: string; variant?: string } | { blank: true } | { continue: true };

type Item =
  | { type: 'starter'; id: string; def: StarterDef; name: string }
  | { type: 'shop'; id: string; summary: TemplateSummary; name: string };

const USE_LABEL: Record<StarterUse, TranslationKey> = {
  contact: 'stUseContact',
  promotion: 'stUsePromotion',
  event: 'stUseEvent',
  label: 'stUseLabel',
};
const STYLE_LABEL: Record<StarterStyle, TranslationKey> = {
  minimal: 'stStyMinimal',
  classic: 'stStyClassic',
  modern: 'stStyModern',
  bold: 'stStyBold',
  elegant: 'stStyElegant',
  playful: 'stStyPlayful',
};
const INDUSTRY_LABEL: Record<StarterIndustry, TranslationKey> = {
  general: 'stIndGeneral',
  business: 'stIndBusiness',
  creative: 'stIndCreative',
  food: 'stIndFood',
  beauty: 'stIndBeauty',
  construction: 'stIndConstruction',
  health: 'stIndHealth',
  events: 'stIndEvents',
};

/** Why a template is not offered, for the admin's eyes only (the dashboard speaks English). */
const MISS_TEXT: Record<TemplateMiss, string> = {
  'no-size': 'no size chosen yet',
  cut: 'made for another cut shape',
  proportions: 'made for other proportions',
  'product-smaller': 'this size is too small for it (under 0.85×)',
  'product-larger': 'this size is too large for it (over 2×)',
  pictures: 'its pictures would print under 150 DPI here',
};

type Filters = { use: Set<string>; style: Set<string>; industry: Set<string> };
const EMPTY = (): Filters => ({ use: new Set(), style: new Set(), industry: new Set() });

function matches(item: Item, f: Filters, skip?: keyof Filters): boolean {
  if (item.type === 'shop') return (Object.keys(f) as Array<keyof Filters>).every((k) => k === skip || f[k].size === 0);
  const tags: Record<keyof Filters, string[]> = { use: [item.def.use], style: item.def.styles, industry: item.def.industries };
  return (Object.keys(f) as Array<keyof Filters>).every((k) => k === skip || f[k].size === 0 || tags[k].some((x) => f[k].has(x)));
}

export interface TemplateGalleryProps {
  productName: string;
  sizeLabel?: string;
  trimMm: { wMm: number; hMm: number };
  outline: OutlineKind | null;
  spec: PrintSpec;
  sides: SideId[];
  kind: ProductKind;
  /** The owner's templates for this product (undefined while they load, null when the shop could not say). */
  templates?: TemplateSummary[] | null;
  onRetryTemplates?: () => void;
  /** The owner's order of every design (template ids, starter ids), and the ones he hid. */
  order?: string[];
  hidden?: string[];
  /** The customer's own design on this device, if any. */
  draftSavedAt?: number | null;
  /** The shop's own designs offered too (the owner's "basic layouts" switch; on unless he turned it off). */
  starters?: boolean;
  /** Something to say first (his design from a template made for another size). */
  notice?: string | null;
  /** An admin is looking: say which of his templates are not offered here, and why. */
  showMisses?: boolean;
  t: (k: TranslationKey) => string;
  language: Language;
  onChoose: (choice: GalleryChoice) => void;
  /** "Add to basket without the design" — when the line may be designed later. */
  onWithout?: () => void;
  /** The line's price, beside the product's name (Pixart's "Info 49,63 €"). */
  priceLabel?: string;
  onClose: () => void;
}

/** A phone, as the studio decides it (Pixart's gallery is laid out differently there). */
function useNarrowGallery() {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** One side of a starter, drawn small when its card comes into view. */
export function StarterPicture({ def, palette, side, ctx, aspect, maxPx = 360, eager = false }: {
  def: StarterDef;
  palette: Palette;
  side: SideId;
  ctx: StarterContext;
  aspect: number;
  maxPx?: number;
  eager?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    if (eager || visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [eager, visible]);
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const sides: SideId[] = side === 'back' ? ['front', 'back'] : ['front'];
    const built = buildStarter(def.id, palette.id, { ...ctx, sides });
    const json = built?.sides.find((s) => s.id === side)?.json;
    if (!json) return;
    const key = `${def.id}|${palette.id}|${side}|${ctx.trimMm.wMm}x${ctx.trimMm.hMm}|${ctx.outline}|${ctx.words.name}|${maxPx}`;
    setUrl(null);
    sideThumb(key, json, ctx.trimMm, ctx.bleedMm, maxPx)
      .then((u) => alive && setUrl(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible, def.id, palette.id, side, ctx, maxPx]);
  return (
    <div ref={ref} className="relative w-full flex items-center justify-center" style={{ aspectRatio: String(aspect) }}>
      {url ? (
        <img
          src={url}
          alt=""
          className={cn(
            'max-w-full max-h-full object-contain shadow-md ring-1 ring-black/5 bg-white',
            // A round or oval product shows round, as it is cut.
            (ctx.outline === 'circle' || ctx.outline === 'ellipse') && 'rounded-[50%]',
          )}
          draggable={false}
        />
      ) : (
        <span className="absolute inset-0 m-auto w-full h-full bg-gray-100 animate-pulse rounded" />
      )}
    </div>
  );
}

export default function TemplateGallery(props: TemplateGalleryProps) {
  const { t, language, trimMm, outline, spec, sides, kind, templates, order, hidden } = props;
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  // Pixart's phone header keeps the price under "Details".
  const [showDetails, setShowDetails] = useState(false);
  // Pixart's filter card: each question folded until opened.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const narrow = useNarrowGallery();
  // The side the preview shows on a phone (one at a time, an arrow to the other).
  const [previewSide, setPreviewSide] = useState<SideId>('front');
  useUiFont();
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Item | null>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  const previewRef = useRef<Item | null>(null);
  previewRef.current = preview;
  // A design or a blank page chosen while his own is kept on the device: asked once
  // first. Either one was saved over it, without a word, at the first change (code
  // review DSN-05). "Continue your design" needs no question.
  const [confirm, setConfirm] = useState<GalleryChoice | null>(null);
  const confirmId = useId();
  const confirmRef = useRef<HTMLDivElement>(null);
  const confirmOpenRef = useRef(false);
  confirmOpenRef.current = confirm !== null;
  const choose = (choice: GalleryChoice) => {
    if (props.draftSavedAt && !('continue' in choice)) setConfirm(choice);
    else props.onChoose(choice);
  };
  useEffect(() => {
    if (confirm) confirmRef.current?.querySelector<HTMLElement>('[data-rx-gal-confirm-cancel]')?.focus();
  }, [confirm]);

  const words = useMemo(() => starterWords(t), [t]);
  const ctx: StarterContext = useMemo(
    () => ({ trimMm, bleedMm: spec.bleedMm, outline, safeMm: spec.safeMm, hiddenMm: spec.hiddenMm, sides: ['front'], words }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trimMm.wMm, trimMm.hMm, spec.bleedMm, spec.safeMm, outline, words, JSON.stringify(spec.hiddenMm)],
  );
  const aspect = trimMm.wMm / trimMm.hMm;
  const twoSided = sides.length > 1;

  // The designs offered here — the same list the studio's Designs panel shows
  // (src/lib/templateOrder.ts): his that fit, the shop's own unless switched off,
  // none he hid, in his order; a template of his made since he arranged them first.
  const items: Item[] = useMemo(
    () =>
      offeredDesigns({
        templates,
        fits: (x) => templateMiss(x, trimMm, outline) === null,
        starters: startersFor(kind),
        startersOn: props.starters !== false,
        hidden,
        order,
      }).map((d): Item =>
        d.type === 'shop'
          ? { type: 'shop', id: d.id, summary: d.summary, name: localized(d.summary.name, d.summary.nameI18n, language) }
          : { type: 'starter', id: d.id, def: d.def, name: t(d.def.labelKey as TranslationKey) },
      ),
    [templates, trimMm, outline, kind, hidden, order, language, t, props.starters],
  );

  // Nothing to choose from (his templates do not fit, the shop's own are off, no
  // draft): straight to a blank page — never an empty choice.
  const autoBlank = useRef(false);
  useEffect(() => {
    if (autoBlank.current || !Array.isArray(templates) || items.length > 0 || props.draftSavedAt) return;
    autoBlank.current = true;
    // "His own design, else a blank page" — the studio decides once it has read the
    // device. A blank chosen here started before the draft was read, and the first
    // change saved the empty page over it.
    props.onChoose({ continue: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, items.length, props.draftSavedAt]);

  const missed = props.showMisses
    ? (templates ?? []).flatMap((x) => {
        const why = templateMiss(x, trimMm, outline);
        return why ? [{ x, why }] : [];
      })
    : [];

  const shown = items.filter((i) => matches(i, filters));
  const groups: Array<{ key: keyof Filters; label: TranslationKey; values: Array<[string, TranslationKey]> }> = [
    { key: 'use', label: 'stGalUse', values: Object.entries(USE_LABEL) as Array<[string, TranslationKey]> },
    { key: 'style', label: 'stGalStyle', values: Object.entries(STYLE_LABEL) as Array<[string, TranslationKey]> },
    { key: 'industry', label: 'stGalIndustry', values: Object.entries(INDUSTRY_LABEL) as Array<[string, TranslationKey]> },
  ];
  const countFor = (key: keyof Filters, value: string) =>
    items.filter((i) => i.type === 'starter' && matches(i, filters, key) && (key === 'use' ? [i.def.use] : key === 'style' ? i.def.styles : i.def.industries).includes(value as never)).length;
  const toggle = (key: keyof Filters, value: string) =>
    setFilters((f) => {
      const next = { ...f, [key]: new Set(f[key]) };
      if (next[key].has(value)) next[key].delete(value);
      else next[key].add(value);
      return next;
    });
  const active = filters.use.size + filters.style.size + filters.industry.size;

  // Escape closes the preview, then the gallery; Tab stays inside; the page behind does not scroll.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        if (confirmOpenRef.current) setConfirm(null);
        else if (previewRef.current) setPreview(null);
        else onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      // The question, while it is asked, keeps the keyboard to itself.
      const root = (confirmOpenRef.current ? confirmRef.current : null) ?? rootRef.current;
      if (!root) return;
      e.stopPropagation();
      const focusable = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(
        (el) => el.offsetParent !== null,
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const cur = document.activeElement as HTMLElement | null;
      if (!cur || !root.contains(cur) || cur === root) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && cur === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus?.();
    };
  }, []);

  const paletteOf = (def: StarterDef) => def.palettes.find((p) => p.id === variants[def.id]) ?? def.palettes[0];

  const filterPanel = (
    <div data-rx-gal-filters>
      {groups.map((g) => {
        const values = g.values.filter(([value]) => countFor(g.key, value) > 0 || filters[g.key].has(value));
        if (values.length === 0) return null;
        const open = openGroups.has(g.key) || filters[g.key].size > 0;
        return (
          <div key={g.key} className="border-b border-[#e3e3e3]">
            <button
              type="button"
              onClick={() => setOpenGroups((cur) => {
                const next = new Set(cur);
                if (next.has(g.key)) next.delete(g.key);
                else next.add(g.key);
                return next;
              })}
              aria-expanded={open}
              data-rx-gal-group={g.key}
              className="w-full flex items-center justify-between py-5 text-left text-[1rem] font-bold text-[#333333]"
            >
              {t(g.label)}
              {open ? <Minus className="w-5 h-5 text-[#0b77c4]" strokeWidth={1.5} /> : <Plus className="w-5 h-5 text-[#0b77c4]" strokeWidth={1.5} />}
            </button>
            {open && (
              <div className="flex flex-wrap gap-2 pb-5">
                {values.map(([value, label]) => {
                  const on = filters[g.key].has(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggle(g.key, value)}
                      aria-pressed={on}
                      data-rx-gal-filter={`${g.key}-${value}`}
                      className={cn(
                        'px-2 py-1 rounded-sm border text-[0.875rem] transition-colors',
                        on ? 'bg-[#0b77c4] border-[#0b77c4] text-white' : 'bg-white border-[#0b77c4] text-[#0b77c4] hover:bg-[#e7f1f8]',
                      )}
                    >
                      {t(label)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {active > 0 && (
        <button type="button" onClick={() => setFilters(EMPTY())} className="mt-4 text-[0.8125rem] font-bold text-[#0b77c4] underline" data-rx-gal-clear>
          {t('stGalClear')}
        </button>
      )}
    </div>
  );

  const swatches = (def: StarterDef, big = false) => (
    <span className="flex items-center gap-2" role="group" aria-label={t('stGalColours')}>
      {def.palettes.map((p, pi) => {
        const on = paletteOf(def).id === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => setVariants((v) => ({ ...v, [def.id]: p.id }))}
            aria-label={t('stColourN').replace('{0}', String(pi + 1))}
            aria-pressed={on}
            data-rx-gal-swatch={`${def.id}:${p.id}`}
            className={cn(
              "relative rounded-[0.25rem] after:absolute after:-inset-2 after:content-['']",
              big ? 'w-[1.375rem] h-[1.375rem]' : 'w-[1.375rem] h-[1.375rem]',
              on ? 'ring-2 ring-[#0b77c4] ring-offset-2' : 'ring-1 ring-black/10',
            )}
            style={{ background: `linear-gradient(135deg, ${p.accent} 55%, ${p.bg === '#ffffff' ? p.accent2 : p.bg} 55%)` }}
          />
        );
      })}
    </span>
  );

  // A collage of the shop's own designs in the banner, where Pixart shows its pictures.
  const collage = items.filter((i): i is Extract<Item, { type: 'starter' }> => i.type === 'starter').slice(0, 4);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      lang={language}
      data-rx-gallery
      className="fixed inset-0 z-[200] flex flex-col bg-white outline-none text-[#1d1d1d]"
      style={{ fontFamily: UI_FONT }}
    >
      {/* Pixart's header: close, the shop's mark, the product and its price — and "later" on the
          right; on a phone the name over two lines and the price under "Details". */}
      <header className={cn('flex items-center shrink-0 bg-white border-b border-[#d1d2d4]', narrow ? 'gap-3 px-4 h-[3.875rem]' : 'gap-4 px-5 h-[4.375rem]')}>
        <button type="button" onClick={props.onClose} aria-label={t('dsgClose')} className="shrink-0 text-[#686868] hover:text-[#1d1d1d]">
          <CircleClose className="w-5 h-5" />
        </button>
        {narrow && <span className="w-px h-6 bg-[#d1d2d4]" aria-hidden="true" />}
        <ShopMark className={narrow ? 'h-6 max-w-[6rem] text-[0.9375rem]' : ''} />
        {!narrow && <span className="w-px h-9 bg-[#e3e3e3]" aria-hidden="true" />}
        {narrow ? (
          <>
            <h2 id={titleId} className="min-w-0 flex-1 text-[0.9375rem] leading-[1.25] font-bold text-[#555555] line-clamp-2">{props.productName || t('stGalTitle')}</h2>
            <button type="button" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails} data-rx-gal-details className="shrink-0 inline-flex items-center gap-1.5 text-[1rem] font-bold text-[#0b77c4]">
              {t('stGalDetails')}
              <ArrowDown className={cn('w-6 h-6 transition-transform', showDetails && 'rotate-180')} strokeWidth={1.4} />
            </button>
          </>
        ) : (
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[0.875rem] font-bold text-[#555555] truncate">{props.productName || t('stGalTitle')}</h2>
            <p className="flex items-center gap-1.5 text-[0.75rem] font-bold">
              <CirclePlus className="w-3.5 h-3.5 text-[#0b77c4]" strokeWidth={1.6} />
              <span className="text-[#0b77c4]">{t('stInfo')}</span>
              <span className="text-[#2ea512]">{props.priceLabel ?? props.sizeLabel}</span>
            </p>
          </div>
        )}
        {props.onWithout && (
          <div className="hidden sm:block text-right leading-tight">
            <p className="text-[0.8125rem] text-[#1d1d1d]">{t('stLaterQuestion')}</p>
            <button type="button" onClick={props.onWithout} title={t('stGalWithoutHint')} data-rx-gal-without className="text-[0.8125rem] font-bold text-[#0b77c4] underline underline-offset-2">
              {t('stLaterLink')}
            </button>
          </div>
        )}
      </header>
      {narrow && showDetails && (
        <p className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 border-b border-[#d1d2d4] bg-white text-[0.8125rem] font-bold" data-rx-gal-details-open>
          <span className="text-[#2ea512]">{props.priceLabel ?? props.sizeLabel}</span>
          {props.priceLabel && <span className="text-[#555555]">{props.sizeLabel}</span>}
        </p>
      )}

      <main className="flex-1 min-h-0 overflow-y-auto">
        {/* The banner (Pixart's phone banner: 94 px, two lines of 19 px) */}
        <section className="relative overflow-hidden bg-[#2477bd] text-white">
          <div className="relative z-10 px-5 sm:px-14 py-[1.0625rem] sm:py-[1.8125rem] max-w-[60%] max-sm:max-w-none">
            <h3 className="text-[1.1875rem] leading-[1.875rem] sm:text-[1.5rem] sm:leading-[2rem] font-bold">{t('stGalHeroTitle')}</h3>
            <p className="hidden sm:block mt-1 text-[1.0625rem]">{t('stGalHeroSub')}</p>
          </div>
          {!narrow && collage.length > 0 && (
            <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-3 pointer-events-none" aria-hidden="true">
              {collage.map((item, i) => (
                <span key={item.id} className="block w-[8.125rem] shadow-lg" style={{ transform: `rotate(${[-8, 5, -4, 7][i % 4]}deg)` }}>
                  <StarterPicture def={item.def} palette={paletteOf(item.def)} side="front" ctx={ctx} aspect={Math.max(0.55, Math.min(1.9, aspect))} maxPx={200} />
                </span>
              ))}
            </div>
          )}
        </section>

        <div className="max-w-[90rem] mx-auto px-3 sm:px-3 py-5 flex gap-6">
          {/* The filter card (desktop) */}
          {!narrow && (
            <aside className="w-[18.3125rem] shrink-0 self-start rounded-2xl bg-white shadow-[0_2px_14px_rgba(0,0,0,0.08)] px-5 pt-6 pb-4" aria-label={t('stGalFilterTitle')}>
              <h4 className="text-[1.25rem] font-bold text-[#333333] mb-3">{t('stGalFilterTitle').toLowerCase()}</h4>
              {filterPanel}
            </aside>
          )}

          <div className="flex-1 min-w-0 space-y-4">
            <div className="flex items-center gap-3 sm:px-4">
              {narrow && (
                <button type="button" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters} className="inline-flex items-center gap-2 text-[1.0625rem] text-[#1d1d1d]">
                  <SlidersHorizontal className="w-5 h-5 text-[#0b77c4]" strokeWidth={1.6} />
                  {t('stGalFilterTitle').toLowerCase()}
                  {active > 0 && <span className="px-1.5 rounded-full bg-[#0b77c4] text-white text-[0.75rem]">{active}</span>}
                </button>
              )}
              <span className="ml-auto text-[0.9375rem] font-bold text-[#333333]" data-rx-gal-count>
                {t('stGalResults').replace('{0}', String(shown.length))}
              </span>
            </div>
            {narrow && showFilters && <div className="rounded-2xl bg-white shadow-[0_2px_14px_rgba(0,0,0,0.08)] px-4">{filterPanel}</div>}
            {props.notice && (
              <p role="alert" className="text-[0.75rem] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-chooser-notice>
                {props.notice}
              </p>
            )}
            {props.onWithout && narrow && (
              <button type="button" onClick={props.onWithout} className="w-full text-[0.8125rem] font-bold text-[#0b77c4] underline underline-offset-2 text-left">
                {t('stLaterQuestion')} {t('stLaterLink')}
              </button>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-8" data-rx-gal-grid>
              {props.draftSavedAt && (
                <button
                  type="button"
                  onClick={() => props.onChoose({ continue: true })}
                  data-rx-gal-continue
                  className="flex flex-col text-left rounded-2xl bg-white p-4 hover:shadow-[0_2px_14px_rgba(0,0,0,0.10)] transition-shadow"
                >
                  <span className="w-full aspect-[1/0.95] rounded-2xl bg-[#e7f1f8] flex items-center justify-center text-[#0b77c4]">
                    <History className="w-14 h-14" strokeWidth={1.4} />
                  </span>
                  <span className="mt-3 text-[1.125rem] font-bold text-[#333333]">{t('stGalContinue')}</span>
                  <span className="text-[0.9375rem] text-[#333333]">
                    {t('stGalContinueSub').replace(
                      '{0}',
                      new Date(props.draftSavedAt).toLocaleString(localeFor(language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
                    )}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => choose({ blank: true })}
                data-rx-gal-scratch
                className="flex flex-col text-left rounded-2xl bg-[#e5f3f5] p-4 hover:shadow-[0_2px_14px_rgba(0,0,0,0.10)] transition-shadow"
              >
                <span className="w-full aspect-[1/0.95] rounded-2xl bg-[#b2dbe0] flex items-center justify-center text-[#006c7a]">
                  <ScrollPen className="w-20 h-20" />
                </span>
                <span className="mt-3 text-[1.125rem] font-bold text-[#333333]">{t('stGalScratch')}</span>
                <span className="text-[0.9375rem] text-[#333333]">{t('stGalScratchLong')}</span>
              </button>

              {shown.map((item) =>
                item.type === 'starter' ? (
                  <div key={item.id} className="flex flex-col p-4 rounded-2xl bg-white hover:shadow-[0_2px_14px_rgba(0,0,0,0.10)] transition-shadow" data-rx-gal-card={item.id}>
                    <button type="button" onClick={() => { setPreviewSide('front'); setPreview(item); }} className="block w-full aspect-[1/0.91] rounded-2xl bg-[#f5f5f5] p-[14%]" aria-label={`${t('stGalPreview')}: ${item.name}`}>
                      <span className="w-full h-full flex items-center justify-center">
                        <span className="w-full shadow-md">
                          <StarterPicture def={item.def} palette={paletteOf(item.def)} side="front" ctx={ctx} aspect={Math.max(0.55, Math.min(1.9, aspect))} />
                        </span>
                      </span>
                    </button>
                    <span className="mt-4 text-[1.0625rem] font-bold text-[#333333] truncate">{item.name}</span>
                    <span className="mt-2">{swatches(item.def)}</span>
                  </div>
                ) : (
                  <div key={item.id} className="flex flex-col p-4 rounded-2xl bg-white hover:shadow-[0_2px_14px_rgba(0,0,0,0.10)] transition-shadow" data-rx-gal-card={item.id} data-rx-shop-template={item.id}>
                    <button type="button" onClick={() => { setPreviewSide('front'); setPreview(item); }} className="block w-full aspect-[1/0.91] rounded-2xl bg-[#f5f5f5] p-[14%]" aria-label={`${t('stGalPreview')}: ${item.name}`}>
                      <span className="w-full h-full flex items-center justify-center">
                        {item.summary.thumbnailUrl ? (
                          <img src={item.summary.thumbnailUrl} alt="" className="max-w-full max-h-full object-contain shadow-md" loading="lazy" />
                        ) : (
                          <LayoutTemplate className="w-8 h-8 text-gray-300" />
                        )}
                      </span>
                    </button>
                    <span className="mt-4 text-[1.0625rem] font-bold text-[#333333] truncate">{item.name}</span>
                    <span className="mt-1 text-[0.75rem] font-bold text-[#0b77c4]">{t('stGalShop')}</span>
                  </div>
                ),
              )}
            </div>
            {templates === undefined && (
              <p className="flex items-center gap-2 text-[0.75rem] font-bold text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('dsgTemplatesLoading')}
              </p>
            )}
            {templates === null && (
              <div className="flex flex-wrap items-center gap-3 text-[0.75rem] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-templates-failed>
                <span className="flex-1 min-w-[10rem]">{t('dsgTemplatesListFailed')}</span>
                {props.onRetryTemplates && (
                  <button type="button" onClick={props.onRetryTemplates} className="font-bold text-[#0b77c4] shrink-0" data-rx-templates-retry>
                    {t('dsgRetry')}
                  </button>
                )}
              </div>
            )}
            {shown.length === 0 && <p className="text-[0.8125rem] font-bold text-gray-500 py-6 text-center">{t('stGalNone')}</p>}
            {missed.length > 0 && (
              <div className="text-[0.625rem] font-bold text-gray-500 bg-white border border-dashed border-gray-300 rounded-xl px-3 py-2 space-y-0.5" data-rx-template-misses>
                <p className="font-black text-gray-600">Only you see this (admin): templates for this product that are not offered at this size —</p>
                {missed.map(({ x, why }) => (
                  <p key={x.id}>
                    “{x.name}” — {MISS_TEXT[why]} (made for {Math.round(x.trimMm.wMm)} × {Math.round(x.trimMm.hMm)} mm)
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Pixart's preview: the name, both sides on a grey panel (one and an arrow on a phone), the colours, "Choose" */}
      {preview && (
        // Pixart's sits near the top of the window (28 px; 8 on a phone), not in its middle.
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/55 p-2 sm:px-6 sm:pt-7 sm:pb-6" onClick={() => setPreview(null)} data-rx-gal-preview={preview.id}>
          <div className="relative w-full max-w-[50rem] max-h-full overflow-y-auto rounded-[1.375rem] bg-white shadow-2xl px-3 sm:px-4 pt-[2.5rem] sm:pt-[3.875rem] pb-4 sm:pb-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={preview.name}>
            <button type="button" onClick={() => setPreview(null)} aria-label={t('dsgProofBack')} className="absolute right-[0.3125rem] top-[0.25rem] p-2 text-[#1d1d1d]">
              <CircleClose className="w-[1.375rem] h-[1.375rem] sm:w-[1.25rem] sm:h-[1.25rem]" />
            </button>
            <h3 className="text-center text-[1.125rem] sm:text-[1.875rem] font-bold text-[#333333] px-10">{preview.name}</h3>
            <div className="relative mt-4 sm:mt-[3.375rem] rounded-2xl bg-[#f5f5f5] p-3 sm:p-6">
              {preview.type === 'starter' ? (
                narrow ? (
                  <>
                    {twoSided && (
                      <button
                        type="button"
                        onClick={() => setPreviewSide((s) => (s === 'front' ? 'back' : 'front'))}
                        aria-label={previewSide === 'front' ? t('stBack') : t('stFront')}
                        className="absolute left-3 top-3 z-10 w-12 h-12 rounded-full border border-[#1d1d1d] bg-white/80 flex items-center justify-center"
                      >
                        <ArrowRight className={cn('w-5 h-5 text-[#1174ba]', previewSide === 'back' && 'rotate-180')} />
                      </button>
                    )}
                    <figure className="px-6 py-10">
                      <StarterPicture def={preview.def} palette={paletteOf(preview.def)} side={previewSide} ctx={ctx} aspect={aspect} maxPx={700} eager />
                    </figure>
                  </>
                ) : (
                  <div className={cn('grid gap-0', twoSided ? 'grid-cols-2' : 'grid-cols-1')}>
                    {(twoSided ? (['front', 'back'] as SideId[]) : (['front'] as SideId[])).map((s) => (
                      <figure key={s} className={twoSided ? '' : 'max-w-[32.5rem] mx-auto w-full'}>
                        <StarterPicture def={preview.def} palette={paletteOf(preview.def)} side={s} ctx={ctx} aspect={aspect} maxPx={900} eager />
                      </figure>
                    ))}
                  </div>
                )
              ) : (
                <span className="w-full flex items-center justify-center" style={{ aspectRatio: String(aspect) }}>
                  {preview.summary.thumbnailUrl && <img src={preview.summary.thumbnailUrl} alt="" className="max-w-full max-h-full object-contain shadow-md" />}
                </span>
              )}
            </div>
            <div className="mt-4 sm:mt-6 flex flex-wrap items-center gap-3 sm:gap-4 px-1 sm:px-3">
              {preview.type === 'starter' && swatches(preview.def, true)}
              <button
                type="button"
                onClick={() => choose(preview.type === 'starter' ? { template: preview.id, variant: paletteOf(preview.def).id } : { template: preview.id })}
                data-rx-gal-choose
                // Pixart's size on a phone (30 px); the finger's target stays 46 px (an invisible margin).
                className="relative ml-auto px-4 sm:px-6 h-[1.875rem] sm:h-[2.0625rem] rounded-full border-2 border-[#1d1d1d] bg-white text-[0.9375rem] sm:text-[1.0625rem] font-bold text-[#1d1d1d] hover:bg-[#1d1d1d] hover:text-white transition-colors max-sm:before:absolute max-sm:before:-inset-x-1 max-sm:before:-inset-y-2 max-sm:before:content-['']"
              >
                {narrow ? t('stGalUseDesign') : t('stGalChoose')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "This replaces your design saved …" — over the preview too, where Choose asks it */}
      {confirm && props.draftSavedAt && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4" onClick={() => setConfirm(null)} data-rx-gal-confirm>
          <div
            ref={confirmRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={confirmId}
            className="w-full max-w-[26.25rem] rounded-[1.375rem] bg-white shadow-2xl p-5 sm:p-6 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p id={confirmId} className="text-[1rem] sm:text-[1.0625rem] leading-snug font-bold text-[#333333]">
              {t('stGalReplaceDraft').replace(
                '{0}',
                new Date(props.draftSavedAt).toLocaleString(localeFor(language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
              )}
            </p>
            <div className="flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                data-rx-gal-confirm-cancel
                className="min-h-[2.75rem] px-5 rounded-full border-2 border-[#1d1d1d] bg-white text-[0.9375rem] font-bold text-[#1d1d1d] hover:bg-[#f2f2f2] active:bg-[#e3e3e3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b77c4] disabled:opacity-40 transition-colors"
              >
                {t('stCancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  const choice = confirm;
                  setConfirm(null);
                  props.onChoose(choice);
                }}
                data-rx-gal-confirm-replace
                className="min-h-[2.75rem] px-5 rounded-full border-2 border-[#1d1d1d] bg-[#1d1d1d] text-[0.9375rem] font-bold text-white hover:bg-[#333333] active:bg-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b77c4] disabled:opacity-40 transition-colors"
              >
                {t('stReplace')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
