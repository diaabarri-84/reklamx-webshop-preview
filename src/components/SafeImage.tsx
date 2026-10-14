import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

/**
 * An <img> that fails quietly instead of leaving a torn-page icon on the page.
 *
 * Nearly every picture in the shop comes from somewhere that can stop answering:
 * a product photo the owner pasted a URL for, the stock imagery the theme ships
 * with, or a base64 image that was truncated on its way into Firestore — which
 * has already happened once here, to a category tile. When any of those fail the
 * browser draws its broken-image glyph, alt text spills across the layout, and
 * the card around it collapses to nothing.
 *
 * This keeps the box, keeps the layout, and shows a neutral placeholder.
 */

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null;
  /** Drawn in place of the image when it will not load. */
  fallbackLabel?: string;
  /**
   * Render NOTHING when the image fails, instead of the placeholder box.
   *
   * For a product photo the box is right — the layout needs the space and the
   * missing picture is worth reporting. For decoration, like the little
   * illustration on an option card, a grey "broken image" tile is worse than no
   * tile at all: the card should simply look like the cards that never had one.
   */
  hideOnError?: boolean;
  /**
   * This picture is what the page is ABOUT — load it first, not last.
   *
   * Every image here is lazy by default, which is right for a grid of tiles and
   * wrong for the one image the visitor came to look at: the home hero measured
   * as the LCP element with loading="lazy" on it, so the browser deliberately
   * deferred the single thing Google times the page by.
   */
  priority?: boolean;
  /**
   * Classes for the FAILURE box, when the image's own classes would not give a
   * div any size. `w-full h-full object-contain` sizes an img against its
   * intrinsic dimensions and a div against nothing at all.
   */
  fallbackClassName?: string;
};

export default function SafeImage({ src, alt = '', className, fallbackLabel, fallbackClassName, hideOnError, priority, ...rest }: Props) {
  const [failed, setFailed] = useState(false);

  // A new src deserves a fresh attempt — otherwise fixing a product photo in the
  // dashboard leaves the placeholder until a full reload.
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    if (hideOnError) return null;
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 bg-gray-100 text-gray-400 ${fallbackClassName ?? className ?? ''}`}
        role="img"
        aria-label={fallbackLabel || alt || 'No image'}
      >
        <ImageOff className="w-5 h-5" aria-hidden="true" />
        {fallbackLabel && <span className="text-[0.625rem] font-bold px-2 text-center leading-tight">{fallbackLabel}</span>}
      </div>
    );
  }

  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      // Stock photography is served from third parties; there is no reason to
      // hand them the page the customer is on.
      referrerPolicy={rest.referrerPolicy ?? 'no-referrer'}
      loading={rest.loading ?? (priority ? 'eager' : 'lazy')}
      fetchPriority={rest.fetchPriority ?? (priority ? 'high' : undefined)}
      decoding={rest.decoding ?? (priority ? 'sync' : 'async')}
    />
  );
}
