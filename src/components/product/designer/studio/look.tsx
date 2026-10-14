/**
 * THE DESIGNER'S LOOK — matched to Pixartprinting's Designer, screen by screen, as the
 * owner asked on 2026-10-07 ("exactly like the one I sent"): its colours (sampled from
 * its own screens), its typeface (Montserrat — one of the designer's own fonts here),
 * and the shop's own mark where Pixart shows its logo. Never their logo, pictures or
 * designs. Tailwind needs the colours written out in the class names, so the screens
 * repeat them literally; these constants are for what is drawn on a canvas or styled
 * inline.
 */
import React, { useEffect } from 'react';
import { useSiteSettings } from '../../../../context/SiteSettingsContext';
import { ensureFontFamilies } from '../fonts';
import { cn } from '../../../../lib/utils';
import { logoSrc } from '../../../../lib/brandLogo';

export const LOOK = {
  /** Links, the active rail item, filter tags, the chosen colour. */
  blue: '#0b77c4',
  /** Icons, the selection, the "+" button. */
  icon: '#1174ba',
  /** The rail's icon tiles. */
  tile: '#e7f1f8',
  /** Continue; prices. */
  green: '#2ea512',
  /** The cut line, and its label. */
  cut: '#ff00ff',
  /** The safe area's label, and its line. */
  safe: '#82e955',
  safeLine: '#8ef262',
  /** Around the board. */
  canvas: '#f7f7f7',
  text: '#1d1d1d',
  muted: '#555555',
  ruler: '#31414c',
  banner: '#2477bd',
  /** "Unsaved" beside Save. */
  unsaved: '#f7cd1b',
} as const;

export const UI_FONT = '"RX Montserrat", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** The designer's typeface, loaded once (it is one of the designer's own fonts). */
export function useUiFont() {
  useEffect(() => {
    void ensureFontFamilies(['RX Montserrat']).catch(() => {});
  }, []);
}

/** The shop's own mark, where Pixart's header shows its logo. */
export function ShopMark({ className = '' }: { className?: string }) {
  const { settings } = useSiteSettings();
  // The wordmark alone (src/lib/brandLogo.ts) — the name is in the picture.
  return <img src={logoSrc(settings)} alt={settings.siteName || 'ReklamX'} className={cn('shrink-0 h-7 w-auto max-w-[9.375rem] object-contain object-left', className)} />;
}

/** Pixart's close: a thin circle with a cross. */
export function CircleClose({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M8.5 8.5l7 7M15.5 8.5l-7 7" strokeLinecap="round" />
    </svg>
  );
}

/** The scroll-and-pen picture of "Create now" (drawn here; not Pixart's file). */
export function ScrollPen({ className = 'w-20 h-20' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 8h30a6 6 0 0 1 6 6v6" />
      <path d="M14 8a5 5 0 0 0-5 5v3h9v-3a5 5 0 0 0-4-5" />
      <path d="M18 16v36a5 5 0 0 0 5 5h27a5 5 0 0 1-5-5v-4" />
      <path d="M45 57a5 5 0 0 0 5-5v-4H40v4" />
      <path d="M53 18l-15 15-4 9 9-4 15-15a3.5 3.5 0 0 0-5-5z" />
    </svg>
  );
}

/*
 * PIXART'S OWN GLYPHS, drawn here as plain line icons (the shapes, not their files): where
 * the icon library has nothing that reads the same at a glance. Each takes the props of a
 * library icon, so the rail and the toolbars use them alike.
 */
type GlyphProps = { className?: string; strokeWidth?: number };
const glyph = (body: React.ReactNode) =>
  function Glyph({ className = 'w-6 h-6', strokeWidth = 1.6 }: GlyphProps) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {body}
      </svg>
    );
  };

/** Elements: a circle behind a square. */
export const ElementsGlyph = glyph(
  <>
    <circle cx="9.5" cy="9.5" r="6.5" />
    <rect x="9" y="9" width="11.5" height="11.5" rx="1" />
  </>,
);
/** Masks: a square in a stamp's frame. */
export const MasksGlyph = glyph(
  <>
    <path d="M3.5 3.5h17v17h-17z" strokeDasharray="2.2 1.9" />
    <rect x="8" y="8" width="8" height="8" rx="0.5" />
  </>,
);
/** Backgrounds: a hatch. */
export const BackgroundsGlyph = glyph(
  <>
    <path d="M4 12 12 4M4 19 19 4M10 20l10-10M16 20l4-4" />
  </>,
);
/** Spacing: a two-way arrow beside lines. */
export const SpacingGlyph = glyph(
  <>
    <path d="M5 4v16M2.5 6.5 5 4l2.5 2.5M2.5 17.5 5 20l2.5-2.5" />
    <path d="M11 6h10M11 12h10M11 18h10" />
  </>,
);
/** List: rings beside lines. */
export const ListGlyph = glyph(
  <>
    <circle cx="4.5" cy="7" r="2" />
    <circle cx="4.5" cy="17" r="2" />
    <path d="M10 6h11M10 12h11M10 18h11" />
  </>,
);
/** Rotate a quarter turn: an arrow over a page. */
export const RotateGlyph = glyph(
  <>
    <rect x="11" y="4" width="9" height="16" rx="1" />
    <path d="M7.5 20.5A6.5 6.5 0 0 1 7.5 8.6" />
    <path d="M5 6.5 7.6 8.5 5.6 11" />
  </>,
);
/** The pages, stacked: shows the column of pages again. */
export const PagesGlyph = glyph(
  <>
    <path d="M2 9h12v14H2z" />
    <path d="M6 5h12v14" />
    <path d="M10 1h12v14" />
  </>,
);
/** Capitals: the letters themselves, as Pixart writes them. */
export function CapsGlyph(_props: GlyphProps) {
  return (
    <span className="text-[1.25rem] leading-none tracking-[-0.02em]" aria-hidden="true">
      AG
    </span>
  );
}
