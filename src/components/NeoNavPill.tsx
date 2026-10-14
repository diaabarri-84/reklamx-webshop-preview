import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils';

/**
 * The header navigation from the client's third reference video: one long
 * neumorphic capsule raised out of the surface, plain grey links inside, and a
 * single extruded pill that SLIDES smoothly from link to link — it sits under
 * the active page, glides to whatever the mouse hovers, and glides home when
 * the mouse leaves. The reference built this with CSS anchor(); measured
 * offsets + a transition do the same everywhere browsers exist.
 */

export interface NeoNavItem {
  to: string;
  label: string;
}

export default function NeoNavPill({ items }: { items: NeoNavItem[] }) {
  const location = useLocation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const linkRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pill, setPill] = useState<{ left: number; width: number; visible: boolean }>({ left: 0, width: 0, visible: false });

  const activeIndex = items.findIndex((it) =>
    it.to === '/' ? location.pathname === '/' : location.pathname.startsWith(it.to),
  );
  const targetIndex = hovered ?? (activeIndex >= 0 ? activeIndex : null);

  // The resize listener below is registered once, so it closes over the FIRST
  // render's targetIndex forever — which slid the pill back under the home link
  // whenever anyone resized a window while reading a product page. A ref every
  // render updates is what the frozen handler reads instead.
  const targetRef = useRef<number | null>(targetIndex);
  targetRef.current = targetIndex;

  const measure = () => {
    const target = targetRef.current;
    if (target == null) { setPill((p) => ({ ...p, visible: false })); return; }
    const el = linkRefs.current[target];
    const wrap = wrapRef.current;
    if (!el || !wrap) return;
    const w = wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setPill({ left: r.left - w.left, width: r.width, visible: true });
  };

  useLayoutEffect(measure, [targetIndex, location.pathname, items.map((i) => i.label).join('|')]);
  // No dependency array meant this ran after EVERY render: a listener removed
  // and re-added on every hover, on every page of the shop. `measure` reads
  // refs and state setters only, so binding it once is enough.
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={wrapRef}
      onMouseLeave={() => setHovered(null)}
      className="relative flex items-center rounded-full p-1.5 bg-[#eceef4] shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]"
    >
      {/* The sliding extruded pill. */}
      <span
        aria-hidden
        className={cn(
          'absolute top-1.5 bottom-1.5 rounded-full bg-gradient-to-br from-[#f4f6fb] to-[#e7e9f0]',
          'shadow-[5px_5px_12px_#c9cdd8,-5px_-5px_12px_#ffffff]',
          'transition-all duration-500 [transition-timing-function:cubic-bezier(.22,1,.36,1)]',
          pill.visible ? 'opacity-100' : 'opacity-0',
        )}
        style={{ left: pill.left, width: pill.width }}
      />
      {items.map((item, i) => (
        <Link
          key={item.to}
          ref={(el) => { linkRefs.current[i] = el; }}
          to={item.to}
          onMouseEnter={() => setHovered(i)}
          className={cn(
            // HEADER BUDGET: the roomier padding starts at 2xl, not xl —
            // between 1280 and 1535 those 8px x 5 links were coming out of the
            // logo's width. See the logo comment in App.tsx.
            'relative z-10 px-3 2xl:px-4 py-2 rounded-full text-[0.6875rem] font-black uppercase tracking-wider whitespace-nowrap transition-colors duration-300',
            i === activeIndex ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
