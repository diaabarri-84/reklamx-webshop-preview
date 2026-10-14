import React, { useEffect, useState, useCallback } from 'react';
import { clearCart } from '../lib/cart';
import { forgetPodAttemptOf, tabStorage } from '../lib/checkoutDraft';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle, Loader2, ArrowLeft, RotateCw, FileUp, Truck, WifiOff, PenTool } from 'lucide-react';
import { useAuth } from '../App';
import { formatCurrency } from '../lib/utils';
import ArtworkUploadBox from '../components/ArtworkUploadBox';
import OrderDesignLater from '../components/OrderDesignLater';
import { cleanDesignLaterMarker, type DesignLaterMarker } from '../lib/designLater';
import { shipmentStatusKey } from '../lib/shipmentStatus';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { readConsent, trackPurchase } from '../lib/gtag';

/**
 * Where the customer lands after the payment page.
 *
 * The important detail: arriving here does NOT mean the payment succeeded. The
 * customer returns the moment their bank hands them back, which can be before
 * Mollie has told our webhook anything — and they arrive just the same if they
 * pressed cancel. So this page asks our own server what the order says, and keeps
 * asking for a short while, rather than congratulating anyone on arrival.
 */

type OrderStatus = {
  id: string;
  status: string;
  paymentStatus: 'paid' | 'unpaid' | 'refunded' | 'chargeback' | 'failed' | 'canceled' | 'expired';
  /** Placed to pay on delivery (a customer the owner chose): in production, paid when it arrives. */
  payOnDelivery?: boolean;
  grossTotal: number;
  currency: string;
  customerName: string;
  createdAt: string;
  /** True while any line of this order is still waiting for a print file. */
  artworkPending?: boolean;
  /** Where the parcel is. Null until the shipment has been booked in Zendr. */
  shipment?: {
    trackingNumber?: string | null;
    status?: string | null;
    carrier?: string | null;
    lastUpdated?: string | null;
  } | null;
  items: {
    productName: string;
    quantity: number;
    price: number;
    artworkPending?: boolean;
    fileName?: string | null;
    /** A studio design's first page, small. */
    preview?: string | null;
    /** Bought as "Design online" and still waiting for the design (designer v2). */
    designLater?: DesignLaterMarker | null;
    productId?: string | null;
  }[];
};

const POLL_INTERVAL_MS = 2500;
const POLL_FOR_MS = 45_000;
/** Ceiling for the retry backoff, so a server that is down is asked politely. */
const MAX_BACKOFF_MS = 15_000;
/**
 * …and after that, an order still unpaid is asked about slowly, for ten more
 * minutes. A bank's answer can reach the webhook minutes late: the page used to
 * stop at 45 s on "Payment not completed" and a "Try again" that sent a customer
 * who HAD paid to pay a second time (code review WEB-21). A paid order, or one
 * to pay on delivery, is never asked again.
 */
const SLOW_POLL_MS = 15_000;
const SLOW_POLL_FOR_MS = 10 * 60_000;

/**
 * The server ANSWERED, and the answer is that this link points at no order we
 * will show. Only 404 (no such order) and 403 (wrong token) mean this.
 *
 * Everything else — no response at all, a 502 while the app restarts — is a
 * failure to GET an answer, and must never be reported as one: this page is
 * where people land straight from their bank, and telling someone who has just
 * paid that their order does not exist because one packet was lost is the worst
 * thing the shop can say.
 */
class OrderNotFoundError extends Error {}

export default function OrderStatusPage() {
  const { orderId } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const again = params.get('again') === '1';
  const { t } = useAuth();
  const { settings: siteSettings } = useSiteSettings();
  // Answering the cookie banner is not a re-render of this page on its own, so
  // the conversion effect below would never learn that consent had arrived.
  const [consent, setConsent] = useState(() => readConsent());
  useEffect(() => {
    const sync = () => setConsent(readConsent());
    window.addEventListener('reklamx:consent', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('reklamx:consent', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The server could not be reached at all within the window — a different
  // thing entirely from it telling us the order is not there.
  const [unreachable, setUnreachable] = useState(false);
  // Bumped by the Try again button to restart the polling effect.
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(true);
  // Lines whose file arrived during this visit. The polled order is not
  // re-read to find out: each box reports its own success, and a refetch would
  // only race the write that just happened.
  const [resolved, setResolved] = useState<number[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId ?? '')}/status?t=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => null);
    if (res.status === 404 || res.status === 403) {
      throw new OrderNotFoundError(data?.error || 'Could not load that order.');
    }
    if (!res.ok) throw new Error(data?.error || `Order lookup failed (${res.status}).`);
    return data as OrderStatus;
  }, [orderId, token]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    // Consecutive failures to reach the server, and whether any poll at all has
    // come back — a customer we DID answer once must not be shown a connection
    // panel just because the last poll dropped.
    let failures = 0;
    let answered = false;
    // Still worth asking about: not yet known to be paid, failed, on delivery or missing.
    let open = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const after = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = null;
      // Not asked while out of sight — every ask is a read of the order: coming
      // back to the tab asks at once (onVisible, below).
      if (document.visibilityState === 'hidden') return;
      timer = setTimeout(() => void tick(), ms);
    };

    const tick = async () => {
      timer = null;
      busy = true;
      try {
        const data = await load();
        if (cancelled) return;
        failures = 0;
        answered = true;
        setOrder(data);
        setError(null);
        setUnreachable(false);

        // Settled. An order to pay on delivery is settled the moment it exists:
        // no payment page is coming back with an answer.
        if (data.paymentStatus !== 'unpaid' || data.payOnDelivery === true) {
          open = false;
          setWaiting(false);
          return;
        }
        const elapsed = Date.now() - startedAt;
        if (elapsed <= POLL_FOR_MS) {
          after(POLL_INTERVAL_MS);
          return;
        }
        // Waited long enough that the customer deserves an answer rather than a
        // spinner — but a late payment still turns the page to "paid" by itself.
        setWaiting(false);
        if (elapsed <= POLL_FOR_MS + SLOW_POLL_FOR_MS) after(SLOW_POLL_MS);
      } catch (err: any) {
        if (cancelled) return;

        if (err instanceof OrderNotFoundError) {
          open = false;
          setError(err.message);
          setWaiting(false);
          return;
        }

        // We never got an answer. Keep asking until the window runs out, backing
        // off so a restarting server is given room to come back.
        failures += 1;
        const elapsed = Date.now() - startedAt;
        if (elapsed <= POLL_FOR_MS) {
          after(Math.min(POLL_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS));
          return;
        }
        setUnreachable(!answered);
        setWaiting(false);
        // The order is on screen already: one dropped poll is not news.
        if (answered && elapsed <= POLL_FOR_MS + SLOW_POLL_FOR_MS) after(SLOW_POLL_MS);
      } finally {
        busy = false;
      }
    };

    // Back from the bank's app or another tab: ask at once, while it is still open.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && open && !busy && !cancelled) after(0);
    };
    document.addEventListener('visibilitychange', onVisible);

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, attempt]);

  // The checkout no longer empties the basket — a failed payment needs it to
  // retry with. It is emptied here instead, only once payment is CONFIRMED, and
  // only if the basket still belongs to THIS order (the marker the checkout
  // left), so a new basket started after paying is never destroyed.
  useEffect(() => {
    // …or once an order to pay on delivery is placed: that is its confirmation.
    const confirmed = order?.paymentStatus === 'paid' || (order?.payOnDelivery === true && order?.status !== 'cancelled');
    if (order && confirmed && localStorage.getItem('reklamx_pending_order') === order.id) {
      clearCart();
      localStorage.removeItem('reklamx_pending_order');
      // The remembered checkout form goes with it — the purchase is complete,
      // and a failed payment (which never reaches here) keeps both.
      localStorage.removeItem('reklamx_checkout_form');
      // …and this tab's attempt to pay it on delivery, with the basket it was made
      // for: the same basket ordered again from now on is a new order. Until this
      // moment Back and Place order answered with THIS order (code review REVIEW-3
      // #1). Only the attempt that names this order.
      forgetPodAttemptOf(tabStorage(), order.id);
      window.dispatchEvent(new Event('storage'));
    }
  }, [order?.paymentStatus, order?.payOnDelivery, order?.id]);

  // An order to pay on delivery that the shop cancelled is not the answer to
  // pressing again: the basket it leaves may be ordered anew.
  useEffect(() => {
    if (order?.id && order.payOnDelivery === true && order.status === 'cancelled') forgetPodAttemptOf(tabStorage(), order.id);
  }, [order?.payOnDelivery, order?.status, order?.id]);

  // THE CONVERSION. Fired here and nowhere else: the checkout button only means
  // the customer left for their bank, and they land back on this page whether
  // they paid, cancelled or timed out. paymentStatus is our own server's word,
  // taken from the Mollie webhook — the one fact worth reporting to a campaign.
  // trackPurchase itself is a no-op unless the owner configured an id AND this
  // visitor accepted, and it remembers the order id so a refresh cannot bill
  // the campaign twice.
  //
  // IT MUST STAY ABOVE THE EARLY RETURNS BELOW. Placed under them, this hook
  // was skipped as soon as `error` or `unreachable` became true — one fewer
  // hook than the previous render, which React answers with "Rendered fewer
  // hooks than expected" and the ErrorBoundary answers with a generic English
  // panel. That turned the two most carefully written screens on this page —
  // the 403/404 one and the offline one that hands a just-paid customer their
  // order number — into a crash loop.
  //
  // `consent` is in the dependencies because a buyer can answer the banner ON
  // this page: without it, the one visitor who accepted right here would be the
  // one whose purchase Google never heard about.
  useEffect(() => {
    // An order to pay on delivery is the purchase the moment it is placed: the money
    // comes later, outside the shop, where no page can report it.
    const bought = order?.paymentStatus === 'paid' || (order?.payOnDelivery === true && order?.status !== 'cancelled');
    if (!order || !bought) return;
    trackPurchase(siteSettings.marketing || {}, {
      id: order.id,
      value: order.grossTotal,
      currency: order.currency,
    });
  }, [order?.paymentStatus, order?.payOnDelivery, order?.status, order?.id, order?.grossTotal, order?.currency, siteSettings.marketing, consent]);

  // Could not reach the shop at all. The payment may well have succeeded — Mollie
  // and our webhook do not care whether this browser can talk to us — so this
  // says so, and hands over the reference to quote if it keeps failing.
  if (unreachable) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <WifiOff className="w-12 h-12 text-amber-500 mx-auto mb-4" />
        <h1 className="text-2xl font-black text-gray-900 mb-2">{t('orderUnreachableTitle')}</h1>
        <p className="text-gray-500 mb-6 leading-relaxed">{t('orderUnreachableBody')}</p>
        {orderId && (
          <p className="text-sm font-bold text-gray-500 mb-8">
            {t('orderNumberLabel')}:{' '}
            <span className="font-mono font-black text-gray-900">#{orderId}</span>
          </p>
        )}
        <div className="flex flex-wrap gap-3 justify-center">
          <button
            onClick={() => {
              setUnreachable(false);
              setWaiting(true);
              setAttempt((n) => n + 1);
            }}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white font-black rounded-2xl hover:bg-orange-600 transition-colors"
          >
            <RotateCw className="w-4 h-4" />
            {t('orderFailedRetry')}
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 px-6 py-3 bg-gray-100 text-gray-900 font-black rounded-2xl hover:bg-gray-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('notFoundCta')}
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-black text-gray-900 mb-2">{t('orderNotFoundTitle')}</h1>
        {/* The raw server string ("Not allowed.") is English in every locale and
            written for logs, not people — show translated guidance instead. */}
        <p className="text-gray-500 mb-8">{t('orderNotFoundBody')}</p>
        <Link to="/" className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white font-black rounded-2xl hover:bg-orange-600 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {t('notFoundCta')}
        </Link>
      </div>
    );
  }

  // Which lines are still waiting for artwork — the shop sells without it on
  // purpose, so this is an ordinary state to be in, not an error.
  const awaitingArtwork = (order?.items ?? [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.artworkPending === true);
  const stillAwaiting = awaitingArtwork.filter(({ index }) => !resolved.includes(index)).length;
  // A line bought as "Design online" is designed here, not uploaded (designer v2).
  const laterOf = (item: OrderStatus['items'][number]) => (item.productId ? cleanDesignLaterMarker(item.designLater) : null);
  const onlyDesigns = awaitingArtwork.filter(({ index }) => !resolved.includes(index)).every(({ item }) => !!laterOf(item));
  // A design arrived: the line shows its picture at once. Not read again from the
  // server — that would only race the write that just happened (see `resolved`).
  const designDone = (index: number, preview?: string) => {
    setResolved((prev) => (prev.includes(index) ? prev : [...prev, index]));
    if (preview) setOrder((o) => (o ? { ...o, items: o.items.map((it, i) => (i === index ? { ...it, preview } : it)) } : o));
  };

  const paid = order?.paymentStatus === 'paid';
  // Placed to pay on delivery and not paid yet: confirmed, in production — not a
  // payment that failed or is still on its way.
  const onDelivery = order?.payOnDelivery === true && order?.paymentStatus === 'unpaid' && order?.status !== 'cancelled';
  // …and cancelled by the shop: said so — not "in production", nothing to upload.
  const onDeliveryCancelled = order?.payOnDelivery === true && order?.paymentStatus === 'unpaid' && order?.status === 'cancelled';
  // A chargeback is money clawed back after payment — for the customer the
  // outcome reads the same as a refund.
  const refunded = order?.paymentStatus === 'refunded' || order?.paymentStatus === 'chargeback';
  // The payment definitively did not happen. Saying "we are confirming your
  // payment" forever, which is what the page used to do, leaves the customer
  // believing an order exists when it does not.
  const failed =
    order?.paymentStatus === 'failed' ||
    order?.paymentStatus === 'canceled' ||
    order?.paymentStatus === 'expired';

  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-8 text-center border-b border-gray-100">
          {waiting ? (
            <>
              <Loader2 className="w-12 h-12 text-gray-400 mx-auto mb-4 animate-spin" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">{t('orderConfirmingTitle')}</h1>
              <p className="text-gray-500 text-sm">{t('orderConfirmingBody')}</p>
            </>
          ) : paid ? (
            <>
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">{t('orderPaidTitle')}</h1>
              <p className="text-gray-500 text-sm">{t('orderPaidBody')}</p>
            </>
          ) : onDeliveryCancelled ? (
            <div data-rx-order-on-delivery-cancelled>
              <XCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">{t('orderCancelledTitle')}</h1>
              <p className="text-gray-500 text-sm">{t('orderCancelledBody')}</p>
            </div>
          ) : onDelivery && order ? (
            <div data-rx-order-on-delivery>
              <Truck className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">{t('orderOnDeliveryTitle')}</h1>
              <p className="text-gray-500 text-sm">
                {t('orderOnDeliveryBody').replace('{0}', formatCurrency(order.grossTotal, order.currency || 'SEK'))}
              </p>
              {again && (
                <p className="mt-3 text-sm font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="status" data-rx-order-again>
                  {t('orderAgainNotice')}
                </p>
              )}
            </div>
          ) : failed ? (
            <>
              <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">{t('orderFailedTitle')}</h1>
              <p className="text-gray-500 text-sm">{t('orderFailedBody')}</p>
              <Link
                to="/checkout"
                className="inline-flex items-center gap-2 mt-5 px-6 py-3 bg-gray-900 text-white text-sm font-black rounded-2xl hover:bg-orange-600 transition-colors"
              >
                {t('orderFailedRetry')}
              </Link>
            </>
          ) : refunded ? (
            <>
              <RotateCw className="w-12 h-12 text-gray-500 mx-auto mb-4" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">{t('orderRefundedTitle')}</h1>
            </>
          ) : (
            <>
              <Clock className="w-12 h-12 text-amber-500 mx-auto mb-4" />
              <h1 className="text-2xl font-black text-gray-900 mb-1">{t('orderUnpaidTitle')}</h1>
              <p className="text-gray-500 text-sm">{t('orderUnpaidBody')}</p>
              {/* The basket is preserved until payment confirms, so an unpaid
                  order — abandoned or declined at the bank — can simply be
                  retried instead of rebuilt from nothing. */}
              <Link
                to="/checkout"
                className="inline-flex items-center gap-2 mt-5 px-6 py-3 bg-gray-900 text-white text-sm font-black rounded-2xl hover:bg-orange-600 transition-colors"
              >
                {t('orderFailedRetry')}
              </Link>
            </>
          )}
        </div>

        {/* The print file, if one is still owed.
            Placed above the receipt because it is the only thing on this page
            the customer still has to DO — under the totals it would be read as
            a footnote, and the job would sit waiting. */}
        {order && (paid || onDelivery) && awaitingArtwork.length > 0 && (
          <div className="mx-8 mt-8 rounded-2xl border border-amber-200 bg-amber-50/70 p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 shrink-0 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center">
                {stillAwaiting > 0 ? onlyDesigns ? <PenTool className="w-5 h-5" /> : <FileUp className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-black text-gray-900">
                  {stillAwaiting > 0 ? t(onlyDesigns ? 'stDlTitle' : 'auTitle') : t('auAllReceived')}
                </h2>
                {stillAwaiting > 0 && (
                  <p className="text-xs font-semibold text-gray-600 mt-1 leading-relaxed">{t(onlyDesigns ? 'stDlBody' : 'auBody')}</p>
                )}
                {awaitingArtwork.length > 1 && stillAwaiting > 0 && (
                  <p className="text-[0.6875rem] font-bold text-amber-800 mt-2">
                    {t('auPendingCount').replace('{0}', String(stillAwaiting))}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {awaitingArtwork.map(({ item, index }) =>
                laterOf(item) ? (
                  <OrderDesignLater
                    key={index}
                    orderId={order.id}
                    token={token}
                    itemIndex={index}
                    productId={item.productId!}
                    productName={item.productName}
                    showName={awaitingArtwork.length > 1}
                    marker={laterOf(item)!}
                    widthCm={Number((item as any).widthCm) || Number((item as any).printWidthCm) || undefined}
                    heightCm={Number((item as any).heightCm) || Number((item as any).printHeightCm) || undefined}
                    onDone={(preview) => designDone(index, preview)}
                  />
                ) : (
                <ArtworkUploadBox
                  key={index}
                  orderId={order.id}
                  token={token}
                  itemIndex={index}
                  productName={awaitingArtwork.length > 1 ? item.productName : undefined}
                  // 15.6.4 — the size this line is printed at, so the box can
                  // say it. fileSpecs first (a line that already carried a
                  // file), then the size the server priced the line on.
                  widthCm={Number((item as any).fileSpecs?.widthCm) || Number((item as any).widthCm) || Number((item as any).printWidthCm) || undefined}
                  heightCm={Number((item as any).fileSpecs?.heightCm) || Number((item as any).heightCm) || Number((item as any).printHeightCm) || undefined}
                  onUploaded={() => setResolved((prev) => (prev.includes(index) ? prev : [...prev, index]))}
                />
                ),
              )}
            </div>
          </div>
        )}

        {/* WHERE THE PARCEL IS.
            Written by the server from Zendr's tracking, so the customer stops
            having to email and ask. Nothing shows until a shipment has actually
            been booked — an empty "Shipment" heading answers no question. */}
        {order && order.shipment?.status && (
          <div className="mx-8 mt-8 rounded-2xl border border-blue-200 bg-blue-50/70 p-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 shrink-0 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center">
                <Truck className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-black text-gray-900">{t('shipTrackingTitle')}</h2>
                <p className="text-sm font-bold text-blue-900 mt-0.5">
                  {t(shipmentStatusKey(order.shipment.status) ?? 'shipTrackingTitle')}
                </p>
                {order.shipment.trackingNumber && (
                  <p className="text-xs font-semibold text-gray-600 mt-2 break-all">
                    {t('shipTrackingNumber')}:{' '}
                    <span className="font-mono font-black text-gray-900">
                      {order.shipment.trackingNumber}
                    </span>
                  </p>
                )}
                {order.shipment.carrier && (
                  <p className="text-xs font-semibold text-gray-600">
                    {t('shipCarrier')}: {order.shipment.carrier}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {order && (
          <div className="p-8 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="font-bold text-gray-500">{t('orderNumberLabel')}</span>
              <span className="font-mono font-black text-gray-900">#{order.id}</span>
            </div>

            <div className="border-t border-gray-100 pt-4 space-y-2">
              {(order.items ?? []).map((item, i) => (
                <div key={i} className="flex justify-between items-center gap-3 text-sm">
                  <span className="flex items-center gap-2.5 min-w-0 text-gray-700">
                    {item.preview && (
                      <img src={item.preview} alt="" className="w-10 h-10 rounded-md object-contain bg-white border border-gray-200 shrink-0" data-rx-status-design />
                    )}
                    <span className="truncate">{item.productName} × {item.quantity}</span>
                  </span>
                  <span className="font-mono text-gray-900 tabular-nums">
                    {formatCurrency(item.price, order.currency)}
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-gray-200 pt-4 flex justify-between items-center">
              <span className="font-black text-gray-900 uppercase text-sm">{t('orderTotalLabel')}</span>
              <span className="font-mono font-black text-lg text-gray-900 tabular-nums">
                {formatCurrency(order.grossTotal, order.currency)}
              </span>
            </div>
          </div>
        )}

        <div className="px-8 pb-8">
          <Link to="/products" className="block w-full text-center py-3.5 bg-gray-900 text-white font-black rounded-2xl hover:bg-orange-600 transition-colors">
            {t('orderKeepShopping')}
          </Link>
        </div>
      </div>
    </div>
  );
}
