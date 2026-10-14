import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { NEO } from '../NeumorphicSidebar';
import { cn } from '../../lib/utils';
import SafeImage from '../SafeImage';
import type { TranslationKey } from '../../lib/translations';

/**
 * The product image gallery — one large frame with round prev/next buttons and
 * a thumbnail strip beneath it, in the shop's neumorphic language:
 *
 *  - the main frame is a raised card, not a bordered white box, and the photo
 *    creeps to 105% while the pointer rests on it;
 *  - the arrows are the same round pressed-out buttons as the rest of the shop
 *    and press IN (inset shadow) while held;
 *  - the selected thumbnail wears an orange ring and lifts off the surface;
 *    the others sit back at 60% opacity until hovered.
 *
 * It was inlined in ProductConfiguratorModal, where the product page could not
 * reach it, so it now owns its own selected index and is driven purely by the
 * `images` prop — the modal and the page get the identical gallery.
 *
 * Every variant class below is a complete literal: Tailwind's scanner cannot
 * see a class name assembled by string concatenation, and the shadow silently
 * disappears from the production CSS when one is.
 */

/** Shown when a product has no usable photo, so the frame never renders empty. */
const PLACEHOLDER_IMAGE = '/placeholder-print.svg';

/** The round neo button shared by both arrows. */
const ARROW_BUTTON = cn(
  'w-9 h-9 rounded-full flex items-center justify-center text-gray-600 bg-[#eceef4]',
  'hover:text-orange-600 transition-all duration-300',
  // Pressed IN while held — the same physical metaphor as the wells elsewhere.
  'active:shadow-[inset_6px_6px_12px_#c9cdd8,inset_-6px_-6px_12px_#ffffff]',
  NEO.raisedSm,
  NEO.ease,
);

interface NeoProductGalleryProps {
  images: string[];
  alt: string;
  /** Optional ribbon in the top-left corner of the main image (e.g. a Web2Print tag). */
  badge?: React.ReactNode;
  t: (key: TranslationKey) => string;
  /** 'page' gives a taller frame and larger thumbs; 'modal' is more compact. Default 'modal'. */
  variant?: 'page' | 'modal';
  className?: string;
}

export default function NeoProductGallery({
  images,
  alt,
  badge,
  t,
  variant = 'modal',
  className,
}: NeoProductGalleryProps) {
  const [index, setIndex] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // A blank entry in `images` is not a photo — it would draw SafeImage's
  // "no image" box as if it were one, and give the customer a thumbnail that
  // shows nothing. Products saved with an empty slot do exist in Firestore.
  // Array.isArray guards the JS callers, which are not held to the prop type.
  const list = useMemo<string[]>(() => {
    const cleaned = Array.isArray(images) ? images.filter((src) => typeof src === 'string' && src.trim() !== '') : [];
    return cleaned.length > 0 ? cleaned : [PLACEHOLDER_IMAGE];
  }, [images]);

  const count = list.length;
  const hasMany = count > 1;

  // Clamp for THIS render: the reset effect below only runs after paint, so a
  // switch from a 7-image product to a 2-image one would otherwise draw image 5
  // of 2 — an empty frame — for one frame.
  const current = Math.min(index, count - 1);

  // Reset on a new product. Keyed on the contents rather than the array
  // identity because most callers pass `product.images` through a fresh array
  // literal every render, and an identity dependency would snap the customer
  // back to image 1 on every keystroke elsewhere in the configurator.
  const signature = list.join('|');
  useEffect(() => {
    setIndex(0);
  }, [signature]);

  const step = useCallback(
    (delta: number) => {
      setIndex((prev) => {
        const from = Math.min(prev, count - 1);
        return (from + delta + count) % count;
      });
    },
    [count],
  );

  // Keep the selected thumbnail in view when the arrows or the keyboard move the
  // selection. scrollIntoView would drag the whole page along with the strip, so
  // the strip is scrolled directly — the thumbs' offsetLeft is measured against
  // it because the strip is the positioned ancestor.
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = thumbRefs.current[current];
    if (!strip || !thumb) return;
    const target = thumb.offsetLeft - (strip.clientWidth - thumb.clientWidth) / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [current]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasMany) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault(); // otherwise the browser also scrolls the strip
      step(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    }
  };

  return (
    <div
      role="group"
      aria-label={t('ppGalleryLabel')}
      // Focusable only when there is something to move between, so a
      // single-image product does not add a dead stop to the tab order.
      tabIndex={hasMany ? 0 : undefined}
      onKeyDown={handleKeyDown}
      className={cn(
        'w-full rounded-3xl outline-none',
        'focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-4 focus-visible:ring-offset-[#e8eaf1]',
        className,
      )}
    >
      {/* THE PICTURE'S OWN SHAPE — no fixed frame.

          This was a locked aspect box (4/3 on the page, 1/1 in the modal) with
          object-cover, which scales by max() and lets overflow-hidden cut the
          rest away. The owner's own uploads are wide — 800x335, 800x402,
          800x436 — so a 4:3 frame threw away about 44% of their WIDTH, and the
          part that survived was blown up to fill the box. His words for it:
          "it is not showing complete, it shows as if something is wrong with
          the product... it should size the image to the screen by itself".

          So: the frame no longer dictates a shape. The picture is contained,
          never cropped, never stretched, capped by the viewport's height so a
          tall rollup cannot run away with the page, and never enlarged past its
          own pixels so a small source stays sharp instead of going soft. The
          min-height stops the card collapsing while mode="wait" has one image
          out and the next not yet in, and centres a small picture rather than
          stranding it in a corner. Same rule the option cards already use — the
          one the owner signed off on. */}
      <div
        className={cn(
          'relative overflow-hidden rounded-3xl group flex items-center justify-center p-3',
          NEO.card,
          NEO.raised,
          // The min-height is what the frame reserves BEFORE the picture has
          // decoded, and the picture then sets the real height — so the gap
          // between the two is a layout shift. Sized against a square source
          // (the shape of every /product-art placeholder this shop ships, and
          // of a good many supplier photos) at each breakpoint's column width,
          // so the common case barely moves and a wide one merely leaves a
          // little room above and below.
          variant === 'page'
            ? 'min-h-[20rem] sm:min-h-[23.75rem] lg:min-h-[27.5rem]'
            : 'min-h-[15rem] sm:min-h-[18.75rem]',
        )}
      >
        {/* Cross-fade rather than a hard swap. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={current}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="w-full flex items-center justify-center"
          >
            <SafeImage
              src={list[current]}
              alt={alt}
              // Without these, a photo that fails to load renders SafeImage's
              // placeholder DIV with the IMAGE's classes — max-w-full h-auto,
              // which give a div no size at all — so a broken product photo
              // became a 20px grey dot adrift in the frame, with nothing to say
              // what was missing.
              fallbackLabel={alt}
              fallbackClassName={cn(
                'w-full rounded-2xl',
                variant === 'page' ? 'min-h-[18.75rem] lg:min-h-[26.25rem]' : 'min-h-[13.75rem] sm:min-h-[17.5rem]',
              )}
              // The first thing a shopper looks at on a product page, and the
              // page's LCP element: SafeImage lazy-loads by default, which
              // delays exactly the picture that should arrive first.
              loading={variant === 'page' ? 'eager' : undefined}
              className={cn(
                'max-w-full h-auto object-contain transition-transform duration-500 group-hover:scale-[1.03]',
                variant === 'page' ? 'max-h-[62vh]' : 'max-h-[46vh]',
              )}
            />
          </motion.div>
        </AnimatePresence>

        {badge && <div className="absolute top-3 left-3 z-10">{badge}</div>}

        {hasMany && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={t('ppGalleryPrevImage')}
              className={cn('absolute left-3 top-1/2 -translate-y-1/2 z-10', ARROW_BUTTON)}
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label={t('ppGalleryNextImage')}
              className={cn('absolute right-3 top-1/2 -translate-y-1/2 z-10', ARROW_BUTTON)}
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>

            <span
              className={cn(
                'absolute bottom-3 right-3 z-10 px-2.5 py-1 rounded-full bg-[#eceef4] text-[0.625rem] font-black text-gray-500',
                NEO.raisedSm,
              )}
            >
              {t('ppGalleryImageCounter')
                .replace('{0}', String(current + 1))
                .replace('{1}', String(count))}
            </span>
          </>
        )}
      </div>

      {hasMany && (
        <div
          ref={stripRef}
          role="group"
          aria-label={t('ppGalleryThumbnails')}
          // relative: the scroll maths above measures each thumb against this
          // element. overflow-x-auto: the strip scrolls inside itself, never the
          // page — the shop has no horizontal overflow anywhere and keeps none.
          className="relative mt-4 flex gap-3 overflow-x-auto px-1 pt-2 pb-2"
        >
          {list.map((src, idx) => (
            <button
              key={`${idx}-${src}`}
              type="button"
              ref={(el) => {
                thumbRefs.current[idx] = el;
              }}
              onClick={() => setIndex(idx)}
              aria-pressed={idx === current}
              aria-label={t('ppGalleryViewImage').replace('{0}', String(idx + 1))}
              className={cn(
                'flex-shrink-0 overflow-hidden rounded-xl transition-all duration-300',
                NEO.card,
                NEO.ease,
                variant === 'page' ? 'w-20 h-20' : 'w-14 h-14',
                idx === current
                  ? 'ring-2 ring-orange-500 opacity-100 -translate-y-0.5 shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff]'
                  : 'opacity-60 hover:opacity-100 shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff]',
              )}
            >
              {/* contain, like the frame above — a thumbnail that crops shows
                  a different picture from the one it selects. */}
              <SafeImage src={src} alt="" className="w-full h-full object-contain p-1" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
