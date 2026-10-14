import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X, Sliders, ArrowUpRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Product } from '../types';
import { productPath } from '../lib/slug';
import { useAuth } from '../App';
import { localized } from '../lib/localizedText';
import { cn } from '../lib/utils';
import { NEO } from './NeumorphicSidebar';
import ProductConfigurator, { ConfiguredCartLine } from './product/ProductConfigurator';

/**
 * The quick-configure modal: the shop's product configurator wearing modal chrome.
 *
 * Everything that used to live here — option state, pricing, the artwork checks,
 * the cart payload — moved into components/product/ProductConfigurator when the
 * product PAGE arrived, because two copies of that logic would have drifted the
 * first time either was touched. What is left is the frame: a backdrop, a header
 * with the product's name, a close button, and a link out to the full page for
 * the shopper who wants the specification table and the FAQ.
 */

interface ProductConfiguratorModalProps {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
  onAddToCart?: (configuredProduct: ConfiguredCartLine) => boolean | void;
}

/** A small round neumorphic icon button. */
const NEO_CIRCLE_BTN = cn(
  'w-9 h-9 rounded-full flex items-center justify-center text-gray-600 transition-all duration-300',
  'bg-[#eceef4] shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff]',
  'hover:text-orange-600 active:shadow-[inset_4px_4px_10px_#c9cdd8,inset_-4px_-4px_10px_#ffffff]',
  NEO.ease,
);

export default function ProductConfiguratorModal({
  product,
  isOpen,
  onClose,
  onAddToCart,
}: ProductConfiguratorModalProps) {
  const { language, t } = useAuth();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusTo = useRef<Element | null>(null);
  // Held in a ref: the page behind passes a fresh function on every render, and
  // as an effect dependency that re-ran the effect below. Every Back (closing
  // the online designer is one) re-rendered the page, so focus jumped to the
  // product card BEHIND the dialog and back, and could scroll the page.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /**
   * The dialog behaviour this modal never had: it announced aria-modal and then
   * ignored Escape, ignored a click on the backdrop, left focus behind on the
   * page underneath, and let Tab walk out of the dialog into the shop while the
   * overlay covered it. All four are handled here, in the frame, so the
   * configurator itself stays a plain component.
   */
  useEffect(() => {
    if (!isOpen) return;
    returnFocusTo.current = document.activeElement;

    // Focus the panel itself rather than the first control: dropping the caret
    // straight into "Paper type" reads as a jump for someone who only wanted to
    // look at the price.
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    // The page behind must not scroll away under the dialog.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      (returnFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [isOpen]);

  // The early return sits below every hook. It used to sit above a dozen
  // useState calls, so React counted a different number of hooks depending on
  // whether the modal was open and any prop change while closed threw
  // "Rendered fewer hooks than expected", unmounting the whole tree.
  if (!isOpen) return null;

  const name = localized(product.name, product.nameI18n, language);

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-3 md:p-6 overflow-y-auto"
        // Only a press that both starts and ends on the backdrop closes it —
        // a drag that began inside the panel and released outside was closing
        // the dialog and losing the whole configuration.
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          ref={panelRef}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          role="dialog"
          aria-modal="true"
          aria-label={name}
          className={cn(
            'outline-none',
            'w-full max-w-5xl rounded-[2rem] overflow-hidden my-auto max-h-[92vh] flex flex-col shadow-2xl',
            NEO.page,
          )}
        >
          <div className="px-6 py-4 flex items-center justify-between gap-3 border-b border-white/60">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className={cn(
                  'w-10 h-10 rounded-2xl flex items-center justify-center text-orange-600 flex-shrink-0',
                  NEO.card,
                  NEO.raisedSm,
                )}
              >
                <Sliders className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-black text-gray-900 tracking-tight truncate">{name}</h2>
                <p className="text-[0.6875rem] text-gray-500 font-bold uppercase tracking-wider">
                  {t('cfgModalSubtitle')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* The modal is the fast path; the page is where the specification
                  table, the artwork guidelines and the FAQ live. */}
              <Link
                to={productPath(product)}
                onClick={onClose}
                className={cn(
                  'hidden sm:flex items-center gap-1.5 px-3.5 h-9 rounded-full text-[0.6875rem] font-black text-gray-600 transition-all duration-300',
                  'bg-[#eceef4] shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff] hover:text-orange-600',
                  NEO.ease,
                )}
              >
                <span>{t('ppOpenFullPage')}</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
              <button onClick={onClose} className={NEO_CIRCLE_BTN} aria-label={t('cfgClose')}>
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 p-6">
            <ProductConfigurator
              product={product}
              variant="modal"
              onAddToCart={onAddToCart}
              onAdded={onClose}
            />
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
