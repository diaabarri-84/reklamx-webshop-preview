// THE SHOP'S LOGO, everywhere one is drawn (2026-10-13).
//
// public/logo.png is the wordmark — "REKLAMX" with the gold X — so it is shown
// ALONE: no name typed beside it, no icon tile, which is what the old
// "text_and_icon" default drew. public/logo-light.png is the same mark for a
// dark ground (the footer, a dark navbar): white letters, the gold X kept.
//
// An image the owner uploads himself (UI Customizer → logo "image") still wins.

export const BRAND_LOGO = '/logo.png';
export const BRAND_LOGO_ON_DARK = '/logo-light.png';
/** The file's own size, so the box is reserved before it loads (no layout shift). */
export const BRAND_LOGO_SIZE = { width: 1164, height: 237 } as const;

type LogoSettings = { logoType?: string; logoUrl?: string } | null | undefined;

/** True when the owner has uploaded a logo of his own. */
export function hasOwnLogo(settings: LogoSettings): boolean {
  return settings?.logoType === 'image' && !!settings.logoUrl?.trim();
}

export function logoSrc(settings: LogoSettings, onDark = false): string {
  if (hasOwnLogo(settings)) return settings!.logoUrl!.trim();
  return onDark ? BRAND_LOGO_ON_DARK : BRAND_LOGO;
}
