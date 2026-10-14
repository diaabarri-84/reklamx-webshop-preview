import React, { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * The soft-UI ("neumorphic") sidebar the client picked from a reference video,
 * rebuilt with the shop's identity. One component drives all three dashboards
 * (admin / staff / customer) so the look can never drift between them.
 *
 * The design language, kept faithful to the reference:
 *  - a floating rounded card on a soft grey page, "pressed out" of the surface
 *    by a double shadow — dark to the bottom-right, white light to the top-left;
 *  - small uppercase section labels; icon + label rows in muted grey;
 *  - the ACTIVE row is a filled brand-orange pill with white text;
 *  - hovered rows raise out of the surface with the same double shadow;
 *  - a chevron collapses the card to an icon-only rail (the default on small
 *    screens, where the full card would eat the whole viewport);
 *  - little round badges for counts (new orders, points, …);
 *  - every movement on the reference's cubic-bezier(.22,1,.36,1).
 */

export interface NeumorphicSidebarItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
}

export interface NeumorphicSidebarSection {
  /** Small uppercase caption above the group; omit for none. */
  label?: string;
  items: NeumorphicSidebarItem[];
}

interface Props {
  /** Brand block at the top: logo tile + name + small tagline. */
  title: string;
  tagline?: string;
  logoUrl?: string;
  sections: NeumorphicSidebarSection[];
  /** Rendered below a divider at the bottom (settings / log out / back). */
  footer?: NeumorphicSidebarItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** The neumorphic surface tokens — one place, used by sidebar and page shells. */
export const NEO = {
  page: 'bg-[#e8eaf1]',
  card: 'bg-[#eceef4]',
  // Raised out of the surface (the resting card and hovered rows).
  raised: 'shadow-[10px_10px_22px_#c9cdd8,-10px_-10px_22px_#ffffff]',
  raisedSm: 'shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff]',
  // Pressed into the surface (wells, inputs).
  inset: 'shadow-[inset_6px_6px_12px_#c9cdd8,inset_-6px_-6px_12px_#ffffff]',
  ease: '[transition-timing-function:cubic-bezier(.22,1,.36,1)]',
};

export default function NeumorphicSidebar({ title, tagline: rawTagline, logoUrl, sections, footer, activeId, onSelect }: Props) {
  // A tagline that merely repeats the title ("ReklamX / REKLAMX") says nothing
  // twice — same rule as the page titles.
  const tagline = rawTagline && rawTagline.trim().toLowerCase() !== title.trim().toLowerCase() ? rawTagline : undefined;
  // Collapsed by default on small screens — the full card would cover the page.
  const [collapsed, setCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false,
  );
  useEffect(() => {
    const onResize = () => { if (window.innerWidth < 1024) setCollapsed(true); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const Row = ({ item }: { item: NeumorphicSidebarItem }) => {
    const active = item.id === activeId;
    return (
      <button
        onClick={() => onSelect(item.id)}
        title={collapsed ? item.label : undefined}
        className={cn(
          'group relative flex items-center w-full rounded-2xl font-bold text-sm transition-all duration-300',
          NEO.ease,
          collapsed ? 'justify-center p-3' : 'gap-3 px-4 py-3',
          // Hover classes must be literal strings — Tailwind's scanner cannot
          // see a variant built by string concatenation, and the hover-raise
          // effect silently vanishes from the production CSS.
          active
            ? 'bg-gradient-to-br from-orange-500 to-orange-700 text-white shadow-[6px_6px_16px_rgba(194,65,12,.35),-4px_-4px_12px_#ffffff]'
            : 'text-gray-500 hover:text-gray-800 hover:bg-[#f0f2f8] hover:shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff]',
        )}
      >
        <span className="w-5 h-5 shrink-0 flex items-center justify-center [&>svg]:w-[1.125rem] [&>svg]:h-[1.125rem]">
          {item.icon}
        </span>
        {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
        {item.badge != null && item.badge !== 0 && (
          <span
            className={cn(
              'min-w-[1.25rem] h-5 px-1.5 rounded-full text-[0.625rem] font-black flex items-center justify-center',
              active ? 'bg-white/25 text-white' : 'bg-orange-600 text-white',
              collapsed && 'absolute -top-0.5 -right-0.5',
            )}
          >
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <aside
      className={cn(
        'shrink-0 self-start sticky top-6 rounded-[1.625rem] p-4 transition-all duration-500',
        NEO.card, NEO.raised, NEO.ease,
        collapsed ? 'w-[4.75rem]' : 'w-[16.25rem]',
      )}
    >
      {/* Brand header.

          The logo used to be forced into this 40x40 tile with object-contain.
          The shop's own mark is 1205x236 — five times wider than it is tall —
          so it painted at roughly 32x6px: a grey dash at the top of every
          dashboard the owner opens. A wordmark needs width, so when the rail is
          open the tile becomes a wide plate that keeps the picture's own shape;
          when it is collapsed to 76px there is no width to give, and the
          initial is more legible than a 6px smear. */}
      <div className={cn('flex items-center mb-2', collapsed ? 'justify-center' : 'gap-3 pr-1')}>
        <div
          className={cn(
            'h-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center',
            NEO.raisedSm,
            // 96px, not 124: the rail is 260px wide and the title column has
            // to keep enough room for "Production Workspace" beside it — at
            // 124 the name clipped to "Rekl..." and the tagline, the only thing
            // that tells the three dashboards apart, vanished entirely.
            logoUrl && !collapsed ? 'w-auto min-w-10 max-w-[9.375rem] px-2' : 'w-10',
          )}
        >
          {logoUrl && !collapsed ? (
            <img src={logoUrl} alt="" className="max-h-8 w-auto max-w-full object-contain" />
          ) : (
            <span className="w-full h-full bg-gradient-to-br from-orange-500 to-orange-700 text-white font-black text-lg flex items-center justify-center">
              {title.charAt(0)}
            </span>
          )}
        </div>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            {/* The wordmark carries the name; the typed title is for when there is none. */}
            {!logoUrl && <p className="font-black text-gray-900 leading-tight truncate">{title}</p>}
            {tagline && <p className="text-[0.5625rem] font-bold tracking-[0.14em] uppercase text-gray-400 truncate">{tagline}</p>}
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          className={cn(
            'w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 transition-all duration-300',
            NEO.ease, 'hover:shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff]',
            collapsed && 'absolute -right-3 top-6 bg-[#eceef4] ' + NEO.raisedSm,
          )}
        >
          <ChevronLeft className={cn('w-4 h-4 transition-transform duration-500', collapsed && 'rotate-180')} />
        </button>
      </div>

      {sections.map((section, si) => (
        <div key={si}>
          {section.label && !collapsed && (
            <p className="px-4 pt-4 pb-1.5 text-[0.625rem] font-black tracking-[0.18em] uppercase text-gray-400">
              {section.label}
            </p>
          )}
          {(section.label == null || collapsed) && si > 0 && <div className="my-3 mx-3 border-t border-gray-300/50" />}
          {section.label && collapsed && null}
          <nav className="space-y-1.5 mt-1">
            {section.items.map((item) => <Row key={item.id} item={item} />)}
          </nav>
        </div>
      ))}

      {footer && footer.length > 0 && (
        <>
          <div className="my-3 mx-3 border-t border-gray-300/50" />
          <nav className="space-y-1.5">
            {footer.map((item) => <Row key={item.id} item={item} />)}
          </nav>
        </>
      )}
    </aside>
  );
}
