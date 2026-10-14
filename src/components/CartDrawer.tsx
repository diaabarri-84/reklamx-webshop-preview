import React, { useState, useEffect, useRef } from 'react';
// Aliased: a local handler below is called clearCart too, and an unaliased
// import would be shadowed by it — silently, into infinite recursion.
import { writeCart, clearCart as clearStoredCart, attachDesignToCartLine } from '../lib/cart';
import { motion, AnimatePresence } from 'motion/react';
import { X, ShoppingBag, Trash2, ArrowRight, CheckCircle2, ShieldCheck, Ruler, FileText, Package, PenTool } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../App';
import SafeImage from './SafeImage';
import { previewOf } from '../lib/designFileSpecs';
import VatTag from './VatTag';
import { optionUnavailableMessage } from '../lib/optionUnavailable';
import { cleanDesignLaterMarker, type DesignLaterMarker, type UploadedDesign } from '../lib/designLater';
import { deleteUploadedFile } from '../lib/uploadFile';
import DesignLater, { DesignAttachError, cancelDesignSave, useDesignSaving } from './product/designer/DesignLater';
import { CART_CHANGED_EVENT } from '../lib/cartKeys';
import type { TranslationKey } from '../lib/translations';

/**
 * A line bought as "Design online" without its design (designer v2, design later):
 * what the designer needs to open on it — only while it has no file.
 */
export function designLaterOf(item: CartItem): DesignLaterMarker | null {
  if (item.fileName || item.fileUrl || item.fileSpecs?.fileUrl || !item.productId) return null;
  return cleanDesignLaterMarker(item.designLater);
}

/**
 * The design he just made, onto the line in the basket. A line that is gone (another
 * tab) or that has a file already takes nothing: the upload is tidied away and he is
 * told. A browser that refuses the write says so the same way.
 */
export function attachDesignOrSay(lineId: string, design: UploadedDesign, t: (key: TranslationKey) => string): void {
  let outcome: 'attached' | 'gone' | 'has-file' | 'refused';
  try {
    outcome = attachDesignToCartLine(lineId, design);
  } catch {
    outcome = 'refused';
  }
  if (outcome === 'attached') return;
  for (const path of [design.storagePath, ...design.previewPaths]) void deleteUploadedFile(path).catch(() => {});
  throw new DesignAttachError(t(outcome === 'refused' ? 'shopCartSaveError' : outcome === 'has-file' ? 'stDlAlready' : 'stDlLineGone'));
}

/**
 * The lines of the order just placed from this basket, while that order is not yet
 * seen paid: the checkout's marker, and the lines it noted for this tab (DSN-13).
 * From this browser only — nothing is asked of the database.
 */
function linesOfPendingOrder(): Set<string> {
  try {
    const pending = localStorage.getItem('reklamx_pending_order');
    const noted = JSON.parse(sessionStorage.getItem('reklamx_ordered_lines') || 'null');
    if (!pending || noted?.orderId !== pending || !Array.isArray(noted.ids)) return new Set();
    return new Set(noted.ids.map(String));
  } catch {
    return new Set();
  }
}

export interface CartItem {
  id: string;
  productId?: string;
  productName?: string;
  fileName?: string;
  fileSize?: string;
  fileType?: string;
  fileUrl?: string;
  fileSpecs?: {
    fileName?: string;
    fileUrl?: string;
    widthCm?: number;
    heightCm?: number;
    calculatedHeightCm?: number;
    fileType?: string;
    previewUrl?: string;
    /** A studio design's page pictures (designer v2): shown as the line's picture. */
    previews?: Array<{ side: 'front' | 'back'; url: string }> | null;
    pages?: number | null;
  };
  image?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  widthCm?: number;
  heightCm?: number;
  selectedOptions?: Record<string, string>;
  isMinPriceApplied?: boolean;
  /** "Design online", not designed yet (src/lib/designLater.ts). */
  designLater?: DesignLaterMarker | null;
}

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onCartUpdated: () => void;
}

export default function CartDrawer({ isOpen, onClose, onCartUpdated }: CartDrawerProps) {
  const navigate = useNavigate();
  const { user, login, formatPriceWithVat, includeVat, t, formatMoney, language } = useAuth();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [orderSuccessId, setOrderSuccessId] = useState<string | null>(null);
  // Lines of an order just placed and not confirmed paid yet: the basket is kept
  // for a retry, and a design made here would stay here — the order's design
  // belongs on its order page (code review DSN-13).
  const [orderedLines, setOrderedLines] = useState<Set<string>>(() => new Set());

  // Load items from localStorage
  const loadCart = () => {
    try {
      const items = JSON.parse(localStorage.getItem('reklamx_cart') || '[]');
      setCartItems(items);
      setOrderedLines(linesOfPendingOrder());
    } catch (e) {
      console.error('Error parsing cart:', e);
      setCartItems([]);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCart();
      setOrderSuccessId(null);
    }
  }, [isOpen]);

  // Every change to the basket while it is open — a design saved on a line (perhaps
  // from a drawer that was closed and opened meanwhile), another tab.
  useEffect(() => {
    if (!isOpen) return;
    const reload = () => loadCart();
    window.addEventListener(CART_CHANGED_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(CART_CHANGED_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, [isOpen]);
  // A design still uploading: the way to checkout waits for it.
  const designSaving = useDesignSaving();

  /*
   * THE BASKET STORES QUANTITIES. IT DOES NOT PRICE ANYTHING.
   *
   * Changing the quantity here used to multiply the stored unit price by the new
   * quantity. That unit price is the one calculated for the OLD quantity, with
   * whatever volume-discount tier that quantity had earned already taken off it,
   * and the multiplication dropped the per-line setup fee as well. So a shopper
   * who nudged the quantity of a discounted item was shown a total the shop was
   * never going to charge — the wrong tier, and 49 kr short of it.
   *
   * Nothing on a basket line carries what an honest recalculation needs: the
   * pre-discount unit price, the product's own discount tiers, its setup fee.
   * The browser therefore cannot do this sum at all. It stores the quantity and
   * asks /api/checkout/quote for the price — the same endpoint the checkout page
   * and the payment itself run on, so the three cannot disagree.
   */
  const updateQuantity = (id: string, delta: number) => {
    const updated = cartItems.map(item => {
      if (item.id !== id) return item;
      // 0 means "this browser no longer knows what this line costs", not "free".
      // Every reader below treats a missing price as a question for the server
      // rather than as an amount.
      return {
        ...item,
        quantity: Math.max(1, item.quantity + delta),
        unitPrice: 0,
        totalPrice: 0,
      };
    });
    setCartItems(updated);
    writeCart(updated);
    onCartUpdated();
  };

  // A line taken out takes its design save with it: left running, it held the way
  // to checkout until Storage gave up, ten minutes later (code review DSN-12).
  const removeItem = (id: string) => {
    cancelDesignSave(`line:${id}`);
    const updated = cartItems.filter(item => item.id !== id);
    setCartItems(updated);
    writeCart(updated);
    onCartUpdated();
  };

  const clearCart = () => {
    for (const item of cartItems) cancelDesignSave(`line:${item.id}`);
    setCartItems([]);
    clearStoredCart();
    onCartUpdated();
  };

  // Line totals as the server calculated them, in basket order — the quote
  // endpoint walks the items it is sent and answers one line for each.
  const [quotedLines, setQuotedLines] = useState<{ totalPrice?: number }[] | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  // A line holding an option the owner has since hidden — the server refuses the
  // whole quote (409) and says which. Said HERE, where the basket is, instead of
  // a normal-looking basket that fails at the till.
  // The server's answer is kept, and worded at render time in the current
  // language — not inside the effect, whose dependencies stay the basket's.
  const [unavailableBody, setUnavailableBody] = useState<unknown>(null);
  const unavailable = optionUnavailableMessage(unavailableBody, language, t('checkoutOptionUnavailable'));

  // Every line is re-priced by the server when the drawer opens.
  //
  // This used to ask only about lines whose price the browser did not know,
  // because every line had been priced by the same shared formula on its way
  // into the basket. That reasoning stopped holding the moment products could go
  // on special offer: the stored price is what the product cost WHEN IT WAS
  // ADDED, and a basket left open across the start or end of an offer keeps
  // quoting the old figure while the server charges the new one. The shopper
  // sees one number in the drawer, another at the till, and nothing explains it.
  //
  // Asking every time costs one request per drawer opening, against a quote
  // endpoint that already exists, is rate-limited for exactly this traffic, and
  // reads its products through a field mask. The price being right is worth more.
  const needsQuote = cartItems.length > 0;

  useEffect(() => {
    if (!isOpen || !needsQuote || cartItems.length === 0) return;

    let cancelled = false;
    const controller = new AbortController();
    setQuoteFailed(false);
    setUnavailableBody(null);
    // Drop the previous answer before asking again: it was priced for the
    // quantities the basket had a moment ago, and lines are matched by position,
    // so keeping it would show yesterday's price against today's line.
    setQuotedLines(null);

    fetch('/api/checkout/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // No coupon, no points, no shipping method: this panel shows the sum of the
      // lines and nothing else. Those three are the checkout page's business.
      body: JSON.stringify({
        items: cartItems.map((item: any) => ({
          productId: item.productId,
          quantity: item.quantity,
          kind: item.isCustomUpload ? 'linear' : 'configured',
          optionIds: item.selectedOptionIds ?? [],
          widthCm: item.widthCm,
          heightCm: item.heightCm,
        })),
      }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        // The lines are matched by position, so a short answer is not a partial
        // answer — it is one we cannot line up, and guessing which line is which
        // would put the wrong price against the wrong item.
        if (!res.ok || !Array.isArray(data?.items) || data.items.length !== cartItems.length) {
          setQuotedLines(null);
          setQuoteFailed(true);
          setUnavailableBody(data?.code === 'option_unavailable' ? data : null);
          return;
        }
        setQuotedLines(data.items);
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return;
        setQuotedLines(null);
        setQuoteFailed(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isOpen, needsQuote, cartItems]);

  /**
   * What one line costs. The server's figure wins wherever we had to ask for
   * one; otherwise it is the price stored when the line was added. `null` means
   * nobody knows yet, and the drawer prints a dash instead of inventing a
   * number the till would then contradict.
   */
  const lineTotals: (number | null)[] = cartItems.map((item, idx) => {
    const quoted = Number(quotedLines?.[idx]?.totalPrice);
    if (Number.isFinite(quoted) && quoted > 0) return quoted;
    const stored = Number(item.totalPrice);
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  });

  // One unknown line makes the whole summary unknown: a subtotal that quietly
  // leaves an item out is worse than no subtotal at all.
  const subtotalKnown = lineTotals.every((total) => total !== null);
  const rawSubtotal = lineTotals.reduce((sum, total) => sum + (total ?? 0), 0);
  const priceInfo = formatPriceWithVat(rawSubtotal);
  const UNKNOWN_AMOUNT = '—';

  const handleCheckout = () => {
    if (cartItems.length === 0 || designSaving) return;
    onClose();
    navigate('/checkout');
  };

  /*
   * A DRAWER THAT COVERS THE PAGE IS A DIALOG, AND HAS TO BEHAVE LIKE ONE.
   *
   * This was a plain <div> over the whole viewport. Nothing told assistive
   * technology it had opened or what it was; Escape — the one key everybody
   * tries — did nothing; and Tab walked straight out of the drawer and through
   * the page behind it, which is still on screen and still focusable, so a
   * keyboard user ended up operating a page they could not see.
   *
   * Three things, all of them the minimum: the panel announces itself
   * (role="dialog" aria-modal with a label), Escape closes it, and focus is kept
   * inside while it is open and handed back to whatever opened it afterwards.
   */
  const panelRef = useRef<HTMLDivElement | null>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    returnFocusTo.current = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    // Focus the panel itself rather than its first control: landing on the
    // Empty-cart button would be a strange place to start, and a screen reader
    // reads the dialog's label from here.
    const t = window.setTimeout(() => panelRef.current?.focus(), 50);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      returnFocusTo.current?.focus?.();
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
            className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
          />

          <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('authCartTitle')}
              tabIndex={-1}
              className="w-screen max-w-md bg-white shadow-2xl flex flex-col outline-none"
            >
              {/* Header */}
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
                <div className="flex items-center space-x-2 space-x-reverse">
                  <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 font-bold">
                    <ShoppingBag className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-gray-900 text-base">{t('authCartTitle')}</h3>
                    <p className="text-xs text-gray-500 font-bold">
                      {cartItems.length} {cartItems.length === 1 ? t('authCartItemCountSingular') : t('authCartItemCountPlural')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2 space-x-reverse">
                  {cartItems.length > 0 && (
                    <button
                      onClick={clearCart}
                      className="text-xs text-red-500 hover:text-red-700 font-bold px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                      title={t('authCartClearTooltip')}
                    >
                      {t('authCartClearButton')}
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    aria-label={t('authCartClose')}
                    title={t('authCartClose')}
                    className="p-2 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-200/60 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {orderSuccessId ? (
                  <div className="py-16 text-center space-y-4">
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-10 h-10" />
                    </div>
                    <h4 className="text-xl font-black text-gray-900">{t('authCartOrderSuccessTitle')}</h4>
                    <p className="text-xs text-gray-500 font-bold max-w-xs mx-auto">
                      {t('authCartOrderNumberLabel')} <span className="font-black text-orange-600">{orderSuccessId}</span>
                    </p>
                    <p className="text-xs text-emerald-700 font-bold">
                      {t('authCartRedirectNotice')}
                    </p>
                  </div>
                ) : cartItems.length === 0 ? (
                  <div className="py-20 text-center space-y-4">
                    <div className="w-16 h-16 bg-gray-100 text-gray-400 rounded-2xl flex items-center justify-center mx-auto">
                      <ShoppingBag className="w-8 h-8" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-base font-black text-gray-900">{t('authCartEmptyTitle')}</h4>
                      <p className="text-xs text-gray-500 font-bold max-w-xs mx-auto">
                        {t('authCartEmptyDescription')}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        onClose();
                        navigate('/products');
                      }}
                      className="mt-4 px-6 py-2.5 bg-orange-600 text-white font-black text-xs rounded-xl shadow-md hover:bg-orange-500 transition-colors"
                    >
                      {t('authCartBrowseProducts')}
                    </button>
                  </div>
                ) : (
                  cartItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="bg-gray-50/80 border border-gray-200/80 rounded-2xl p-4 flex flex-col space-y-3 relative group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center space-x-3 space-x-reverse">
                          <div className="w-12 h-12 bg-white rounded-xl border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center" data-rx-cart-thumb={previewOf(item.fileSpecs) ? 'design' : 'product'}>
                            {/* A design he made: HIS design is the line's picture, not the product photo. */}
                            {previewOf(item.fileSpecs) ? (
                              <SafeImage src={previewOf(item.fileSpecs)!} alt="" className="w-full h-full object-contain bg-white" />
                            ) : item.image ? (
                              <SafeImage src={item.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Package className="w-6 h-6 text-orange-500" />
                            )}
                          </div>
                          <div>
                            <h5 className="font-black text-gray-900 text-sm line-clamp-1">
                              {item.productName || item.fileName || t('authCartCustomPrintJob')}
                            </h5>
                            {item.widthCm && item.heightCm && (
                              <div className="flex items-center text-[0.6875rem] text-gray-500 font-bold mt-0.5">
                                <Ruler className="w-3 h-3 ml-1 text-gray-400" />
                                <span>{item.widthCm} × {item.heightCm} {t('authCartUnitCm')}</span>
                              </div>
                            )}
                            {item.fileName && (
                              <div className="flex items-center text-[0.6875rem] text-blue-600 font-bold mt-0.5">
                                <FileText className="w-3 h-3 ml-1" />
                                <span className="truncate max-w-[9.375rem]">{item.fileName}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-gray-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors"
                          title={t('authCartRemoveItemTooltip')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Bought as "Design online" without the design: made here, now or
                          after paying — the order waits for it either way. */}
                      {designLaterOf(item) && (
                        <div className="space-y-1.5" data-rx-cart-design-later>
                          <p className="flex items-center gap-1 text-[0.6875rem] font-black text-amber-700">
                            <PenTool className="w-3.5 h-3.5" />
                            {t('stDlPending')}
                          </p>
                          {orderedLines.has(item.id) && (
                            <p className="text-[0.6875rem] font-semibold text-gray-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-cart-design-ordered>
                              {t('stDlOrderPlaced')}
                            </p>
                          )}
                          <DesignLater
                            marker={designLaterOf(item)!}
                            productId={item.productId!}
                            productName={item.productName || ''}
                            saveKey={`line:${item.id}`}
                            onDesigned={(design) => {
                              try {
                                attachDesignOrSay(item.id, design, t);
                              } finally {
                                loadCart();
                                onCartUpdated();
                              }
                            }}
                          />
                        </div>
                      )}

                      {/* Display Selected Specs/Options if present */}
                      {item.selectedOptions && Object.keys(item.selectedOptions).length > 0 && (
                        <div className="bg-white/80 p-2 rounded-xl border border-gray-100 text-[0.6875rem] space-y-0.5">
                          {Object.entries(item.selectedOptions).map(([key, val]) => {
                            const displayVal = typeof val === 'object' && val !== null
                              ? ((val as any).label || (val as any).value || String(val))
                              : String(val);
                            // Keys arrive as raw field ids (num_upload_files,
                            // front_back_sides) — print them as words, not code.
                            const displayKey = key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                            return (
                              <div key={key} className="flex justify-between text-gray-600">
                                <span className="font-bold">{displayKey}:</span>
                                <span className="font-black text-gray-800">{displayVal}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Quantity & Item Total */}
                      <div className="flex items-center justify-between pt-2 border-t border-gray-200/60">
                        <div className="flex items-center space-x-1 space-x-reverse bg-white border border-gray-200 rounded-lg p-0.5">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            className="w-6 h-6 flex items-center justify-center font-black text-gray-600 hover:bg-gray-100 rounded text-xs"
                          >
                            -
                          </button>
                          <span className="w-8 text-center text-xs font-black text-gray-900">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="w-6 h-6 flex items-center justify-center font-black text-gray-600 hover:bg-gray-100 rounded text-xs"
                          >
                            +
                          </button>
                        </div>

                        <div className="text-left">
                          <span className="text-sm font-black text-orange-600">
                            {lineTotals[idx] === null ? UNKNOWN_AMOUNT : formatMoney(lineTotals[idx] as number)}
                          </span>
                          {/* Line items are stored and shown net, whatever the
                              header toggle says — hence the fixed mode. */}
                          <VatTag mode="excl" className="ml-1" />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer Checkout Section */}
              {cartItems.length > 0 && !orderSuccessId && (
                <div className="p-5 border-t border-gray-200 bg-white space-y-4">
                  {/* Summary Rows */}
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-gray-500 font-bold">
                      <span>{t('authCartSubtotalExclVat')}</span>
                      <span>{subtotalKnown ? formatMoney(priceInfo.rawNetSEK) : UNKNOWN_AMOUNT}</span>
                    </div>
                    <div className="flex justify-between text-gray-500 font-bold">
                      <span>{t('authCartVatLabel')}</span>
                      <span>
                        {subtotalKnown
                          ? formatMoney(priceInfo.rawGrossSEK - priceInfo.rawNetSEK)
                          : UNKNOWN_AMOUNT}
                      </span>
                    </div>
                    <div className="flex justify-between text-base font-black text-gray-900 pt-1 border-t border-gray-100">
                      <span>{t('authCartGrandTotal')}</span>
                      <span className="text-orange-600">
                        {subtotalKnown ? priceInfo.formatted : UNKNOWN_AMOUNT}
                        <VatTag className="ml-1" />
                      </span>
                    </div>
                    {/* Why the dashes: the price for a re-quantified line comes
                        from the server, and the server did not answer. Saying so
                        is better than a total that would not survive checkout. */}
                    {unavailable ? (
                      <p role="alert" className="text-[0.6875rem] text-red-600 font-bold text-center pt-1" data-rx-cart-unavailable>
                        {unavailable}
                      </p>
                    ) : !subtotalKnown && quoteFailed && (
                      <p className="text-[0.625rem] text-red-500 font-bold text-center pt-1">
                        {t('checkoutQuoteUnreachable')}
                      </p>
                    )}
                    <p className="text-[0.625rem] text-gray-400 font-bold text-center pt-1">
                      {includeVat ? t('authCartPricesInclVat') : t('authCartPricesExclVat')}
                    </p>
                  </div>

                  {/* Checkout Button */}
                  <button
                    onClick={handleCheckout}
                    disabled={isPlacingOrder || designSaving}
                    className="w-full py-3.5 px-4 bg-orange-600 hover:bg-orange-500 text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-orange-600/20 active:scale-98 flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50"
                  >
                    {isPlacingOrder ? (
                      <span>{t('authCartPlacingOrder')}</span>
                    ) : (
                      <>
                        <span>
                          {t('authCartCheckoutButton').replace(
                            '{0}',
                            subtotalKnown ? priceInfo.formatted : UNKNOWN_AMOUNT,
                          )}
                        </span>
                        <ArrowRight className="w-4 h-4 rotate-180" />
                      </>
                    )}
                  </button>

                  <div className="flex items-center justify-center space-x-1.5 space-x-reverse text-[0.6875rem] text-gray-400 font-bold">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                    <span>{t('authCartQualityGuarantee')}</span>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
