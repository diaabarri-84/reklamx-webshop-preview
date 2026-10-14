import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, Minus, Plus } from 'lucide-react';
import { NEO } from '../NeumorphicSidebar';
import { cn } from '../../lib/utils';
import type { TranslationKey } from '../../lib/translations';

/**
 * The product page's information layer, HelloPrint-style but neumorphic:
 *
 *  - <NeoInfoChips> sits next to the product title — one pill per information
 *    section (Info, Produktspecifikationer, Riktlinjer för design, …). The chips
 *    are NAVIGATION, not state: they never look "selected", because the truth of
 *    which section is open is already told by the open panel further down.
 *  - <NeoInfoSections> is that stack of disclosure panels. Each one is a raised
 *    card with a header button and a body that grows open. Clicking a chip hands
 *    the section id down as `openId`; the panel opens and scrolls itself up.
 *
 * A section carrying no content is dropped from BOTH pieces, so a product with
 * no FAQ shows neither an FAQ chip nor an empty FAQ panel.
 */

export interface ProductInfoSection {
  id: string;
  title: string;
  content: React.ReactNode;
  /** Open on first render. Typically only the description. */
  defaultOpen?: boolean;
}

/**
 * Sections that actually have something to say. `null`, `undefined`, `false` and
 * `''` are what a caller writes for "this product has no such section" — React
 * renders nothing for all four, so a panel built on one would be an empty box.
 */
function withContent(sections: ProductInfoSection[]): ProductInfoSection[] {
  return sections.filter(
    (s) => s.content !== null && s.content !== undefined && s.content !== false && s.content !== '',
  );
}

/**
 * The plus/minus bullet list the reference leans on for "what's included" and
 * "what's not". Green plus / grey minus over there; orange plus / grey minus here.
 */
export function ProductBullets({
  items,
}: {
  items: { text: string; tone?: 'plus' | 'minus' }[];
}): React.ReactElement {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => {
        const isMinus = item.tone === 'minus';
        return (
          <li key={`${index}-${item.text}`} className="flex items-start gap-2.5 leading-relaxed">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0',
                isMinus
                  ? 'bg-[#d7dae6] text-gray-500'
                  : 'bg-gradient-to-br from-orange-500 to-orange-700 text-white',
              )}
            >
              {isMinus ? <Minus className="w-2.5 h-2.5" /> : <Plus className="w-2.5 h-2.5" />}
            </span>
            <span className="text-xs font-semibold text-gray-600 break-words">{item.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function NeoInfoChips({
  sections,
  onJump,
  className,
}: {
  sections: ProductInfoSection[];
  onJump: (id: string) => void;
  className?: string;
}): React.ReactElement {
  const visible = useMemo(() => withContent(sections), [sections]);
  if (visible.length === 0) return <></>;

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {visible.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => onJump(section.id)}
          className={cn(
            'rounded-full px-3.5 py-1.5 text-[0.6875rem] font-black text-gray-700 transition-all duration-300',
            NEO.card,
            NEO.raisedSm,
            NEO.ease,
            'hover:-translate-y-0.5 hover:text-orange-600 hover:shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500',
          )}
        >
          {section.title}
        </button>
      ))}
    </div>
  );
}

/** The ids a fresh render starts open — the description, usually. */
function initialOpen(sections: ProductInfoSection[]): Set<string> {
  return new Set(sections.filter((s) => s.defaultOpen).map((s) => s.id));
}

export default function NeoInfoSections({
  sections,
  openId,
  openNonce,
  t,
  className,
}: {
  sections: ProductInfoSection[];
  /** Section the chips asked to open; the panel opens and scrolls itself into view. */
  openId?: string;
  /**
   * Bumped on every chip press. Without it a second press of the SAME chip left
   * `openId` unchanged, the effect never re-ran, and the chip looked dead to a
   * reader who had scrolled away and wanted to come back.
   */
  openNonce?: number;
  t: (key: TranslationKey) => string;
  className?: string;
}): React.ReactElement {
  const visible = useMemo(() => withContent(sections), [sections]);
  const uid = useId();

  const [openIds, setOpenIds] = useState<Set<string>>(() => initialOpen(visible));

  // Another product hands us a different set of sections, and the previous
  // product's open/closed state would otherwise leak into it. Adjusting during
  // render (React's own pattern for derived state) avoids the extra paint an
  // effect would cost.
  const signature = visible.map((s) => s.id).join('|');
  const [lastSignature, setLastSignature] = useState(signature);
  if (lastSignature !== signature) {
    setLastSignature(signature);
    setOpenIds(initialOpen(visible));
  }

  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // The chips only ever ask for a jump AFTER the page is up; honouring `openId`
  // on mount would yank a freshly opened product page down to its description.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!openId) return;

    setOpenIds((prev) => (prev.has(openId) ? prev : new Set(prev).add(openId)));

    // Two frames later: one for React to commit the open state, one for the
    // panel to be laid out at its new height. The ref is on the section WRAPPER,
    // whose top does not move as its own body expands, so the scroll lands where
    // it was aimed even while the height animates.
    let inner = 0;
    const frame = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
      const el = panelRefs.current.get(openId);
      if (!el) return;
      const reduceMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(inner);
    };
  }, [openId, openNonce]);

  if (visible.length === 0) return <></>;

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className={cn('space-y-3', className)}>
      <h2 className="text-[0.625rem] font-black uppercase tracking-[0.12em] text-gray-400 px-1">
        {t('ppInfoSectionsTitle')}
      </h2>

      {visible.map((section) => {
        const isOpen = openIds.has(section.id);
        const headerDomId = `${uid}-${section.id}-header`;
        const panelDomId = `${uid}-${section.id}-panel`;

        return (
          <div
            key={section.id}
            ref={(el) => {
              if (el) panelRefs.current.set(section.id, el);
              else panelRefs.current.delete(section.id);
            }}
            // scroll-mt keeps the header clear of the sticky site header when
            // scrollIntoView({ block: 'start' }) lands on this panel.
            className={cn('rounded-2xl overflow-hidden scroll-mt-24', NEO.card, NEO.raisedSm)}
          >
            <button
              type="button"
              id={headerDomId}
              aria-expanded={isOpen}
              aria-controls={panelDomId}
              onClick={() => toggle(section.id)}
              className={cn(
                'w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left rounded-2xl transition-colors duration-300',
                NEO.ease,
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500',
                isOpen ? 'text-orange-600' : 'text-gray-900 hover:text-orange-600',
              )}
            >
              <span className="text-xs font-black leading-tight break-words">{section.title}</span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  'w-4 h-4 flex-shrink-0 transition-transform duration-300',
                  NEO.ease,
                  isOpen ? 'rotate-180 text-orange-600' : 'text-gray-500',
                )}
              />
            </button>

            {/* The body stays mounted so `aria-controls` always points at a real
                element; `inert` takes the collapsed copy out of the tab order and
                the accessibility tree. */}
            <motion.div
              id={panelDomId}
              role="region"
              aria-labelledby={headerDomId}
              inert={!isOpen}
              initial={false}
              animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="px-4 pb-4 pt-0.5 text-xs font-semibold leading-relaxed text-gray-600 break-words">
                {section.content}
              </div>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}
