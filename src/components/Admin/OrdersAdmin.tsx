import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarClock, Flag, Loader2, Mail, Phone, Printer, Search, Send, Truck, X } from 'lucide-react';
import { auth, db } from '../../firebase';
import { useAuth } from '../../App';
import type { Order } from '../../types';
import type { TranslationKey } from '../../lib/translations';
import {
  ORDER_STAGES,
  createdMs,
  filterOrders,
  priorityOf,
  sortOrders,
  stageLabelKey,
  paymentTitleOf,
  type OrderPriority,
  type OrderSort,
  type PaymentFilter,
} from '../../lib/orderQueue';
import { deliveryAddressOf } from '../../lib/deliveryAddress';
import { formatDateTime } from '../../lib/dateFormat';
import { cn, formatCurrency } from '../../lib/utils';
import NeoDateField from '../NeoDateField';
import InvoiceModal from '../InvoiceModal';
import ReceiptModal from '../ReceiptModal';
import ProductionWorkOrderModal from '../ProductionWorkOrderModal';
import PackingSlipModal from '../PackingSlipModal';
import LineChargesNote from '../LineChargesNote';
import PaymentBadge from '../PaymentBadge';
import { useConfirmDialog } from '../ConfirmDialog';
import StageBadge, { STAGE_DOT, stageColourKey } from '../StageBadge';
import { triggerFileDownload } from '../../lib/downloadHelper';
import { orderMoney } from '../../lib/orderMoney';
import type { OrderFeed } from '../../lib/useOrderFeed';

/**
 * THE ADMIN'S ORDERS — "تفاصيل الطلبات" (the client's own answer for item 1).
 *
 * The admin panel's subtitle has always said "Manage orders", and it had no
 * orders tab: orders lived only in the production queue, as expanded cards, the
 * newest 200, with no search. This is the list and the detail he asked for —
 * every order findable (search, stage, payment, priority, dates, and "older
 * orders" past the first 200), sortable the four ways the client named, and one
 * page per order with everything known about it, including the stage history
 * that was recorded on every order and shown nowhere.
 *
 * The orders come from the dashboard's one live listener (src/lib/useOrderFeed.ts)
 * — this tab used to open its own every time it was shown, 200 billed reads a
 * visit on a project whose free read quota has run out before — and the search,
 * filter and sort rules are the production queue's (src/lib/orderQueue.ts), so
 * the two screens can never disagree about which orders match.
 */

export interface OrdersPreset {
  stage?: string;
  payment?: PaymentFilter;
  sort?: OrderSort;
}

const STAGES = ORDER_STAGES;
const stageKey = stageLabelKey;
const priorityKey = (p: OrderPriority): TranslationKey =>
  p === 'urgent' ? 'sdPriorityUrgent' : p === 'high' ? 'sdPriorityHigh' : 'sdPriorityNormal';

const money = (n: unknown, currency = 'SEK') =>
  `${(Number(n) || 0).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function PriorityFlag({ order, t }: { order: Order; t: (k: TranslationKey) => string }) {
  const p = priorityOf(order);
  if (p === 'normal') return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[0.625rem] font-black uppercase',
        p === 'urgent' ? 'bg-red-600 text-white' : 'bg-orange-100 text-orange-800',
      )}
    >
      <Flag className="w-3 h-3" />
      {t(priorityKey(p))}
    </span>
  );
}

export default function OrdersAdmin({
  feed,
  preset,
  openOrderId,
}: {
  feed: OrderFeed;
  preset?: OrdersPreset | null;
  openOrderId?: string | null;
}) {
  const { t, user } = useAuth();
  const { orders, loading, error: loadError } = feed;
  // Bumped by "Clear filters": a date box holding a half-typed date has nothing
  // committed to clear, so it is remounted instead.
  const [dateKey, setDateKey] = useState(0);

  const [stage, setStage] = useState<string>(preset?.stage ?? 'all');
  const [payment, setPayment] = useState<PaymentFilter>(preset?.payment ?? 'all');
  const [priority, setPriority] = useState<OrderPriority | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<OrderSort>(preset?.sort ?? 'newest');

  const [selectedId, setSelectedId] = useState<string | null>(openOrderId ?? null);
  const [docOpen, setDocOpen] = useState<{ kind: 'invoice' | 'receipt' | 'work' | 'slip'; order: Order } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // A dashboard tile can open this screen with a filter already chosen.
  useEffect(() => {
    if (!preset) return;
    setStage(preset.stage ?? 'all');
    setPayment(preset.payment ?? 'all');
    if (preset.sort) setSort(preset.sort);
  }, [preset]);
  useEffect(() => {
    if (openOrderId) setSelectedId(openOrderId);
  }, [openOrderId]);

  // The order's page is a dialog: it takes the focus when it opens and Escape
  // closes it — unless a document is open over it, which Escape closes first.
  const panelRef = useRef<HTMLElement>(null);
  const panelOpen = !!selectedId && orders.some((o) => o.id === selectedId);
  useEffect(() => {
    if (!panelOpen) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !docOpen) setSelectedId(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelOpen, docOpen]);

  const visible = useMemo(
    () =>
      sortOrders(
        filterOrders(orders, { stage, payment, priority, q, from: from || undefined, to: to || undefined }),
        sort,
      ),
    [orders, stage, payment, priority, q, from, to, sort],
  );
  const selected = selectedId ? orders.find((o) => o.id === selectedId) ?? null : null;
  const canEdit = user?.role === 'admin' || user?.permissions?.canManageOrders === true;
  const filtersOn = stage !== 'all' || payment !== 'all' || priority !== 'all' || q || from || to;

  /** Plain merge writes; the rules keep staff off the money fields. */
  const writeOrder = async (orderId: string, patch: Record<string, unknown>, failKey: TranslationKey) => {
    if (!canEdit) return;
    setSavingId(orderId);
    setSaveError(null);
    try {
      await setDoc(doc(db, 'orders', orderId), { id: orderId, ...patch, updatedAt: new Date().toISOString() }, { merge: true });
      // An order from "Show older" is not live: show the write on it too.
      feed.patch(orderId, patch as Partial<Order>);
    } catch (err) {
      console.error('Error updating the order:', err);
      setSaveError(t(failKey));
    } finally {
      setSavingId(null);
    }
  };

  const selectCls = 'px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-700';

  return (
    <div className="space-y-5">
      {/* ---- the controls ---- */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[13.75rem]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('sdSearchOrders')}
              aria-label={t('sdSearchOrders')}
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label={t('oaColStage')} className={selectCls}>
            <option value="all">{t('sdAllStages')}</option>
            <option value="active">{t('activeOrders')}</option>
            <option value="production">{t('printerLoad')}</option>
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>{t(s.key)}</option>
            ))}
          </select>
          <select value={payment} onChange={(e) => setPayment(e.target.value as PaymentFilter)} aria-label={t('oaColPayment')} className={selectCls}>
            <option value="all">{t('sdPayFilterAll')}</option>
            <option value="paid">{t('sdPayFilterPaid')}</option>
            <option value="unpaid">{t('sdPayFilterUnpaid')}</option>
            <option value="reversed">{t('sdPayFilterReversed')}</option>
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value as OrderPriority | 'all')} aria-label={t('sdPriority')} className={selectCls}>
            <option value="all">{t('sdAllPriorities')}</option>
            <option value="urgent">{t('sdPriorityUrgent')}</option>
            <option value="high">{t('sdPriorityHigh')}</option>
            <option value="normal">{t('sdPriorityNormal')}</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[0.6875rem] font-black text-gray-500">
            {t('sdDateFrom')}
            <NeoDateField key={`from-${dateKey}`} value={from} onChange={setFrom} aria-label={t('sdDateFrom')} />
          </label>
          <label className="flex items-center gap-2 text-[0.6875rem] font-black text-gray-500">
            {t('sdDateTo')}
            <NeoDateField key={`to-${dateKey}`} value={to} onChange={setTo} aria-label={t('sdDateTo')} />
          </label>
          <label className="flex items-center gap-2 text-[0.6875rem] font-black text-gray-500">
            {t('sdSortLabel')}
            <select value={sort} onChange={(e) => setSort(e.target.value as OrderSort)} className={selectCls}>
              <option value="newest">{t('sdSortNewest')}</option>
              <option value="priority">{t('sdSortPriority')}</option>
              <option value="printDate">{t('sdSortPrintDate')}</option>
              <option value="dueDate">{t('sdSortDueDate')}</option>
            </select>
          </label>
          {filtersOn && (
            <button
              type="button"
              onClick={() => { setStage('all'); setPayment('all'); setPriority('all'); setQ(''); setFrom(''); setTo(''); setDateKey((k) => k + 1); }}
              className="px-3 py-2 rounded-xl text-[0.6875rem] font-black text-gray-500 hover:text-gray-900"
            >
              {t('sdClearFilters')}
            </button>
          )}
          <span className="ml-auto text-[0.6875rem] font-bold text-gray-400 tabular-nums">
            {t('sdShowingCount').replace('{0}', String(visible.length)).replace('{1}', String(orders.length))}
          </span>
        </div>
      </div>

      {saveError && (
        <p role="alert" className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-2xl px-3 py-2">{saveError}</p>
      )}

      {/* ---- the list ---- */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <p className="p-10 text-center text-xs font-bold text-gray-400">{t('rpLoading')}</p>
        ) : loadError ? (
          <p className="p-10 text-center text-xs font-bold text-red-600">{t('caLoadFailed')}</p>
        ) : visible.length === 0 ? (
          <p className="p-10 text-center text-xs font-bold text-gray-400">
            {orders.length === 0 ? t('oaNoOrdersYet') : t('sdNoOrdersMatch')}
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {visible.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelectedId(o.id)}
                data-order-row={o.id}
                className="w-full text-left px-4 py-3 hover:bg-blue-50/40 transition-colors grid grid-cols-2 md:grid-cols-[1.1fr_1fr_1.6fr_0.9fr_0.9fr_0.9fr_0.9fr] gap-x-3 gap-y-1 items-center"
              >
                <span className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-black text-gray-900 text-sm tabular-nums">{o.id}</span>
                  <PriorityFlag order={o} t={t} />
                </span>
                <span className="text-[0.6875rem] font-bold text-gray-500 md:text-xs">
                  {createdMs(o) ? formatDateTime(o.createdAt) : '—'}
                </span>
                <span className="min-w-0 col-span-2 md:col-span-1">
                  <span className="block text-xs font-black text-gray-800 truncate">{o.customerName || '—'}</span>
                  <span className="block text-[0.625rem] font-bold text-gray-400 truncate">{o.customerEmail}</span>
                </span>
                <span className="text-xs font-black text-gray-900 tabular-nums">
                  {o.grossTotal != null ? money(o.grossTotal, o.currency) : '—'}
                </span>
                <span><PaymentBadge order={o} t={t} /></span>
                <span><StageBadge status={o.status} t={t} /></span>
                <span className="text-[0.625rem] font-bold text-gray-500 leading-tight">
                  {o.printDate ? <span className="block">{t('sdPrintDate')}: {o.printDate}</span> : null}
                  {o.dueDate ? <span className="block">{t('sdDueDate')}: {o.dueDate}</span> : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!loading && !loadError && feed.hasMore && (
        <div className="text-center space-y-2">
          <button
            type="button"
            onClick={feed.loadOlder}
            disabled={feed.loadingOlder}
            className="px-5 py-2.5 rounded-2xl bg-white border border-gray-200 text-xs font-black text-gray-700 hover:border-blue-400 hover:text-blue-700 shadow-sm disabled:opacity-60"
          >
            {feed.loadingOlder ? t('sdLoadingOlder') : t('sdShowOlder')}
          </button>
          {feed.olderError && <p role="alert" className="text-xs font-bold text-red-600">{t('sdOlderFailed')}</p>}
        </div>
      )}

      {/* ---- one order ---- */}
      <AnimatePresence>
        {selected && (
          <div key={`order-${selected.id}`} className="fixed inset-0 z-50 flex justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedId(null)}
              className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            />
            <motion.aside
              ref={panelRef}
              tabIndex={-1}
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              role="dialog"
              aria-modal="true"
              aria-label={t('oaDetailsTitle').replace('{0}', selected.id)}
              className="relative w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto focus:outline-none"
            >
              <OrderDetails
                order={selected}
                t={t}
                canEdit={canEdit}
                saving={savingId === selected.id}
                onClose={() => setSelectedId(null)}
                onWrite={(patch, failKey) => writeOrder(selected.id, patch, failKey)}
                onOpenDoc={(kind) => setDocOpen({ kind, order: selected })}
                onPatch={(fields) => feed.patch(selected.id, fields)}
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <InvoiceModal isOpen={docOpen?.kind === 'invoice'} onClose={() => setDocOpen(null)} order={docOpen?.kind === 'invoice' ? docOpen.order : null} />
      <ReceiptModal isOpen={docOpen?.kind === 'receipt'} onClose={() => setDocOpen(null)} order={docOpen?.kind === 'receipt' ? docOpen.order : null} />
      <ProductionWorkOrderModal isOpen={docOpen?.kind === 'work'} onClose={() => setDocOpen(null)} order={docOpen?.kind === 'work' ? docOpen.order : null} />
      <PackingSlipModal isOpen={docOpen?.kind === 'slip'} onClose={() => setDocOpen(null)} order={docOpen?.kind === 'slip' ? docOpen.order : null} />
    </div>
  );
}

/**
 * WHETHER THE ORDER'S E-MAILS WENT OUT — written on every paid order (emailDetail)
 * and shown nowhere, so a failed send (the old SMTP password) was invisible. Client,
 * 2026-10-07: "when an order is created I must get an e-mail". "Send again" sends
 * what did not go out, through the addresses set in Payments & API keys — never the
 * customer's confirmation a second time; with both delivered, the shop's notice.
 */
function OrderEmails({ order, t }: { order: Order; t: (k: TranslationKey) => string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [detail, setDetail] = useState<Record<string, string> | null>(null);
  const paid = order.paymentStatus === 'paid';
  // An order to pay on delivery was e-mailed when it was placed.
  const emailed = paid || order.payOnDelivery === true;
  const awaitingPayment = !emailed && ['unpaid', 'failed', 'canceled', 'expired'].includes(String(order.paymentStatus ?? 'unpaid'));
  const d = (detail ?? (order as any).emailDetail ?? {}) as Record<string, string>;
  // A send that never reached a recipient (no mail server at all) leaves no line
  // per recipient — only the order's emailStatus says why.
  const status = String((order as any).emailStatus ?? '');
  /** The mail server's refusal, in words — not "smtp_not_configured" or a raw 535. */
  const why = (raw: string) => {
    const r = raw.replace(/^failed:\s*/, '');
    if (r === 'smtp_not_configured') return t('oaEmailNoSmtp');
    if (/\b535\b|Username and Password not accepted|Invalid login|BadCredentials/i.test(r)) return t('oaEmailBadLogin');
    return r;
  };
  const line = (who: 'customer' | 'shop') => {
    const v = d[who] ?? (!detail && status && status !== 'sent' ? status : undefined);
    if (!v) return { ok: null as boolean | null, text: t('oaEmailNone') };
    if (v === 'sent') return { ok: true, text: t('oaEmailSent') };
    if (v === 'no address') return { ok: null, text: t('oaEmailNoAddress') };
    return { ok: false, text: t('oaEmailFailed').replace('{0}', why(v)) };
  };
  return (
    <Section title={t('oaEmailsTitle')}>
      <div className="text-xs space-y-1.5" data-rx-order-emails>
        {(['customer', 'shop'] as const).map((who) => {
          const l = line(who);
          return (
            <p key={who} className="flex items-start justify-between gap-3" data-rx-order-email={who}>
              <span className="font-bold text-gray-500">{who === 'customer' ? t('oaEmailCustomer') : t('oaEmailShop')}</span>
              <span className={cn('font-black text-right', l.ok === true ? 'text-emerald-700' : l.ok === false ? 'text-red-700' : 'text-gray-500')}>{l.text}</span>
            </p>
          );
        })}
        {!emailed ? (
          // A refunded order WAS paid: its lines above say what went out then.
          awaitingPayment && <p className="font-bold text-gray-400">{t('oaEmailUnpaid')}</p>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNote(null);
              try {
                const token = await auth.currentUser?.getIdToken().catch(() => null);
                const resp = await fetch(`/api/admin/orders/${encodeURIComponent(order.id)}/resend-emails`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                  body: '{}',
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok) throw new Error(data?.error || `(${resp.status})`);
                if (data.emailDetail) setDetail(data.emailDetail);
                setNote(
                  data.sent
                    ? { ok: true, text: t('oaEmailResent') }
                    : { ok: false, text: t('oaEmailFailed').replace('{0}', why(String(data.reason ?? Object.values(data.results ?? {}).find((v) => v !== 'sent') ?? ''))) },
                );
              } catch (err: any) {
                setNote({ ok: false, text: String(err?.message ?? err) });
              } finally {
                setBusy(false);
              }
            }}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 text-xs font-black text-gray-700 hover:border-gray-400 disabled:opacity-50"
            data-rx-order-email-resend
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {t('oaEmailResend')}
          </button>
        )}
        {note && <p className={cn('font-bold', note.ok ? 'text-emerald-700' : 'text-red-700')} role="status">{note.text}</p>}
      </div>
    </Section>
  );
}

/**
 * PAY ON DELIVERY — the money, when it comes. The order went into production when it
 * was placed; this records how it was paid, and the customer's points and the
 * coupon's count follow on the server, exactly as after an online payment. It stays
 * until every one of those steps has finished: a step that failed is finished from
 * here, as the server asks.
 */
function RecordPayment({ order, t, onPatch }: { order: Order; t: (k: TranslationKey) => string; onPatch: (fields: Partial<Order>) => void }) {
  const [method, setMethod] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const { confirm, dialog } = useConfirmDialog();
  const se = ((order as any).sideEffects ?? {}) as Record<string, boolean>;
  const paid = order.paymentStatus === 'paid';
  const unfinished = paid && (se.pointsApplied !== true || se.couponCounted !== true);
  const cancelled = order.status === 'cancelled';
  if (paid && !unfinished && !note) return null;
  const money = orderMoney(order);
  const methodWords: Record<string, string> = {
    cash: t('oaPaidCash'), card: t('oaPaidCard'), swish: 'Swish', bank: t('oaPaidBank'), invoice: t('oaPaidInvoice'),
  };

  const send = async () => {
    setBusy(true);
    setNote(null);
    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      const resp = await fetch(`/api/admin/orders/${encodeURIComponent(order.id)}/record-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(paid ? {} : { method }),
      });
      const data = await resp.json().catch(() => ({}));
      // Recorded as paid even when a later step failed: the order says so at once,
      // and this panel stays to finish the rest.
      if (data?.paymentStatus === 'paid') {
        onPatch({ paymentStatus: 'paid', paymentMethodTitle: data.paymentMethodTitle ?? order.paymentMethodTitle, ...(data.sideEffects ? { sideEffects: data.sideEffects } : {}) } as Partial<Order>);
      }
      if (!resp.ok) throw new Error(data?.error || `(${resp.status})`);
      setNote({ ok: true, text: t('oaRecorded') });
    } catch (err: any) {
      setNote({ ok: false, text: String(err?.message ?? err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 space-y-2.5" data-rx-record-payment={paid ? 'finish' : 'record'}>
      {dialog}
      {!paid && (
        <p className="text-xs font-black text-sky-900">
          {t('oaOnDeliveryDue').replace('{0}', formatCurrency(money.gross, money.currency))}
        </p>
      )}
      {cancelled && !paid ? (
        <p className="text-[0.6875rem] font-bold text-sky-800">{t('oaOnDeliveryCancelled')}</p>
      ) : unfinished ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[0.6875rem] font-bold text-sky-900">{t('oaRecordUnfinished')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-black disabled:opacity-50"
            data-rx-record-payment-finish
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {t('oaRecordFinish')}
          </button>
        </div>
      ) : !paid ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[0.6875rem] font-black text-sky-900" htmlFor={`rx-pay-how-${order.id}`}>{t('oaRecordHow')}</label>
          <select
            id={`rx-pay-how-${order.id}`}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-sky-200 bg-white text-xs font-black text-gray-800"
            data-rx-record-method
          >
            <option value="">{t('oaRecordChoose')}</option>
            <option value="cash">{methodWords.cash}</option>
            <option value="card">{methodWords.card}</option>
            <option value="swish">Swish</option>
            <option value="bank">{methodWords.bank}</option>
            <option value="invoice">{methodWords.invoice}</option>
          </select>
          <button
            type="button"
            disabled={busy || !method}
            onClick={async () => {
              // Once recorded it cannot be undone from any screen: asked first.
              const ok = await confirm({
                title: t('oaRecordConfirmTitle'),
                message: t('oaRecordConfirmBody')
                  .replace('{0}', formatCurrency(money.gross, money.currency))
                  .replace('{1}', methodWords[method] ?? method),
                confirmLabel: t('oaRecordPayment'),
                // Money coming in, not a deletion: not the red warning.
                tone: 'primary',
              });
              if (ok) await send();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-black disabled:opacity-50"
            data-rx-record-payment-save
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {t('oaRecordPayment')}
          </button>
        </div>
      ) : null}
      {note && <p className={cn('text-[0.6875rem] font-bold', note.ok ? 'text-emerald-700' : 'text-red-700')} role="status" data-rx-record-payment-note={note.ok ? 'ok' : 'bad'}>{note.text}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{title}</h4>
      {children}
    </section>
  );
}

function OrderDetails({
  order,
  t,
  canEdit,
  saving,
  onClose,
  onWrite,
  onOpenDoc,
  onPatch,
}: {
  order: Order;
  t: (k: TranslationKey) => string;
  canEdit: boolean;
  saving: boolean;
  onClose: () => void;
  onWrite: (patch: Record<string, unknown>, failKey: TranslationKey) => void;
  onOpenDoc: (kind: 'invoice' | 'receipt' | 'work' | 'slip') => void;
  /** A server action's result on the order, for an older order the live listener does not watch. */
  onPatch: (fields: Partial<Order>) => void;
}) {
  const c: Record<string, any> = order.customerDetails ?? {};
  const m = orderMoney(order);
  const cur = m.currency;
  const pickup = order.shippingMethod === 'pickup';
  const dest = deliveryAddressOf(order);
  const billing = [c.address1, c.address2, [c.postcode, c.city].filter(Boolean).join(' '), c.country].filter(Boolean);
  const history = Array.isArray(order.stageHistory) ? [...order.stageHistory].reverse() : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <h3 className="text-xl font-black text-gray-900 tabular-nums">{t('oaDetailsTitle').replace('{0}', order.id)}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <PaymentBadge order={order} t={t} />
            <StageBadge status={order.status} t={t} />
            <PriorityFlag order={order} t={t} />
            {order.paymentMismatch && (
              <span className="px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase bg-red-600 text-white">{t('sdPaymentMismatch')}</span>
            )}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label={t('oaClose')} title={t('oaClose')} className="p-1.5 rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100">
          <X className="w-5 h-5" />
        </button>
      </div>

      {order.payOnDelivery === true && <RecordPayment order={order} t={t} onPatch={onPatch} />}

      {/* The three things staff set — priority, print day, promised day. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 rounded-2xl bg-gray-50 border border-gray-100">
        <label className="space-y-1">
          <span className="block text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{t('sdPriority')}</span>
          <select
            value={priorityOf(order)}
            disabled={!canEdit || saving}
            onChange={(e) => onWrite({ priority: e.target.value === 'normal' ? null : e.target.value }, 'sdPriorityFailed')}
            className="w-full px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-black text-gray-800"
          >
            <option value="normal">{t('sdPriorityNormal')}</option>
            <option value="high">{t('sdPriorityHigh')}</option>
            <option value="urgent">{t('sdPriorityUrgent')}</option>
          </select>
        </label>
        <div className="space-y-1">
          <span className="block text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{t('sdPrintDate')}</span>
          {/* Written when the box is left (or Enter), not on every keystroke:
              select-all + Backspace used to blank the date in the order at once.
              Not disabled while another field saves, or the focus is lost. */}
          <NeoDateField
            value={order.printDate || ''}
            disabled={!canEdit}
            commitOn="blur"
            onChange={(iso) => onWrite({ printDate: iso || null }, 'sdPrintDateFailed')}
            aria-label={t('sdPrintDate')}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <span className="block text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{t('sdDueDate')}</span>
          <NeoDateField
            value={order.dueDate || ''}
            disabled={!canEdit}
            commitOn="blur"
            onChange={(iso) => onWrite({ dueDate: iso || null }, 'sdDueDateFailed')}
            aria-label={t('sdDueDate')}
            className="w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Section title={t('sdCustomerBlock')}>
          <div data-rx-customer className="text-xs space-y-0.5">
            <p className="font-black text-gray-900">{order.customerName || '—'}</p>
            {c.company && <p className="font-bold text-gray-700">{c.company}{c.taxId ? ` · ${c.taxId}` : ''}</p>}
            {order.customerEmail && (
              <a href={`mailto:${order.customerEmail}`} className="flex items-center gap-1 font-bold text-blue-700 hover:underline break-all">
                <Mail className="w-3.5 h-3.5 shrink-0" />{order.customerEmail}
              </a>
            )}
            {c.phone && (
              <a href={`tel:${String(c.phone).replace(/\s+/g, '')}`} className="flex items-center gap-1 font-bold text-blue-700 hover:underline">
                <Phone className="w-3.5 h-3.5 shrink-0" />{c.phone}
              </a>
            )}
            {billing.map((line, i) => <p key={i} className="font-bold text-gray-500">{line}</p>)}
          </div>
        </Section>

        <Section title={t('sdDeliveryBlock')}>
          <div data-rx-customer className="text-xs space-y-0.5">
            <p className="font-black text-gray-900 flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" />{order.shippingMethodTitle || order.shippingMethod || '—'}
            </p>
            {pickup ? (
              <p className="font-bold text-amber-700">{t('sdCollectsInPerson')}</p>
            ) : (
              [dest.separate ? dest.name : '', dest.company, dest.address1, dest.address2, [dest.postcode, dest.city].filter(Boolean).join(' '), dest.country]
                .filter(Boolean)
                .map((line, i) => <p key={i} className="font-bold text-gray-600">{line}</p>)
            )}
            {order.shipment?.trackingNumber && (
              <p className="font-bold text-gray-500 break-all">
                {t('shipTrackingNumber')}: {order.shipment.trackingNumber}{order.shipment.carrier ? ` · ${order.shipment.carrier}` : ''}
              </p>
            )}
            {order.zendr?.portalUrl && (
              <a href={order.zendr.portalUrl} target="_blank" rel="noreferrer" className="font-black text-blue-700 hover:underline">
                {t('sdShipOpen')}
              </a>
            )}
          </div>
        </Section>
      </div>

      <Section title={t('oaItemsTitle')}>
        <div className="space-y-2">
          {(order.items ?? []).map((item, i) => {
            const file = item.fileSpecs?.fileUrl || (item as any).fileUrl;
            return (
              <div key={i} className="p-3 rounded-2xl border border-gray-100 bg-white text-xs space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-black text-gray-900">{item.productName}</span>
                  <span className="font-black text-gray-900 tabular-nums whitespace-nowrap">{money(item.price, cur)}</span>
                </div>
                <p className="font-bold text-gray-500 tabular-nums">
                  {item.quantity} × {item.unitPrice != null ? money(item.unitPrice, cur) : '—'}
                </p>
                {item.options && Object.keys(item.options).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(item.options).map(([k, v]) => (
                      <span key={k} className="px-1.5 py-0.5 rounded bg-gray-100 text-[0.625rem] font-bold text-gray-600">{k}: {String(v)}</span>
                    ))}
                  </div>
                )}
                <LineChargesNote item={item} currency={cur} t={t} />
                {/* A download, not a link: the artwork is usually a data: URL
                    (Storage is not enabled), and Chrome refuses to open a
                    data: URL in a new tab — the owner got a blank tab. The
                    production queue downloads the same way. */}
                {file ? (
                  <button
                    type="button"
                    onClick={() => triggerFileDownload(file, item.fileSpecs?.fileName || `order-${order.id}-${i + 1}`)}
                    className="inline-block font-black text-blue-700 hover:underline text-left break-all"
                  >
                    {item.fileSpecs?.fileName || t('sdAttachmentName')}
                  </button>
                ) : item.artworkPending ? (
                  <p className="font-black text-amber-700">{t('sdArtworkPending')}</p>
                ) : null}
                {item.artworkSource === 'reprint' && <p className="font-black text-sky-700" data-rx-artwork-source="reprint">{t('sdArtworkReprint')}</p>}
                {item.artworkSource === 'studio' && <p className="font-black text-sky-700" data-rx-artwork-source="studio">{t('sdArtworkStudio')}</p>}
              </div>
            );
          })}
        </div>
      </Section>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Section title={t('oaMoneyTitle')}>
          {/* The invoice's own rows (src/lib/orderMoney.ts), so they add up:
              goods − coupon − points + shipping = net; net + VAT = total. This
              showed the goods AFTER the coupon and then took it off again. */}
          <dl data-rx-money className="text-xs grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt className="font-bold text-gray-500">{t('oaGoods')}</dt><dd className="font-black tabular-nums text-right">{money(m.goodsBeforeDiscounts, cur)}</dd>
            {m.coupon > 0 && (<>
              <dt className="font-bold text-gray-500">{t('oaDiscount')}{order.discountCode ? ` (${order.discountCode})` : ''}</dt>
              <dd className="font-black tabular-nums text-right">−{money(m.coupon, cur)}</dd>
            </>)}
            {m.points > 0 && (<>
              <dt className="font-bold text-gray-500">{t('oaPoints')}</dt>
              <dd className="font-black tabular-nums text-right">−{money(m.points, cur)}</dd>
            </>)}
            <dt className="font-bold text-gray-500">{t('oaShipping')}</dt><dd className="font-black tabular-nums text-right">{money(m.shipping, cur)}</dd>
            <dt className="font-bold text-gray-500 border-t border-gray-100 pt-1">{t('oaNetTotal')}</dt><dd className="font-black tabular-nums text-right border-t border-gray-100 pt-1">{money(m.net, cur)}</dd>
            <dt className="font-bold text-gray-500">{t('oaVat')}</dt><dd className="font-black tabular-nums text-right">{money(m.vat, cur)}</dd>
            <dt className="font-black text-gray-900">{t('oaGross')}</dt><dd className="font-black tabular-nums text-right text-gray-900">{money(m.gross, cur)}</dd>
            {m.refunded > 0 && (<>
              <dt className="font-bold text-red-600">{t('oaRefunded')}</dt><dd className="font-black tabular-nums text-right text-red-600">−{money(m.refunded, cur)}</dd>
            </>)}
            <dt className="font-bold text-gray-500">{t('sdPaymentBlock')}</dt><dd className="font-bold text-right">{paymentTitleOf(order, t) || order.paymentMethod || '—'}</dd>
          </dl>
        </Section>

        <Section title={t('oaDatesTitle')}>
          <dl className="text-xs grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt className="font-bold text-gray-500">{t('oaPlaced')}</dt><dd className="font-bold text-right">{createdMs(order) ? formatDateTime(order.createdAt) : '—'}</dd>
            <dt className="font-bold text-gray-500">{t('oaPaid')}</dt><dd className="font-bold text-right">{order.paidAt ? formatDateTime(order.paidAt) : '—'}</dd>
            <dt className="font-bold text-gray-500">{t('sdPrintDate')}</dt><dd className="font-bold text-right">{order.printDate || t('sdPrintDateNotSet')}</dd>
            <dt className="font-bold text-gray-500">{t('sdDueDate')}</dt><dd className="font-bold text-right">{order.dueDate || t('sdDueDateNotSet')}</dd>
            <dt className="font-bold text-gray-500">{t('oaDelivered')}</dt><dd className="font-bold text-right">{order.deliveredAt ? formatDateTime(order.deliveredAt) : '—'}</dd>
          </dl>
        </Section>
      </div>

      {/* The stage history was written on every order and shown nowhere. */}
      <Section title={t('oaHistoryTitle')}>
        {history.length === 0 ? (
          <p className="text-xs font-bold text-gray-400">{t('oaHistoryEmpty')}</p>
        ) : (
          <ol className="relative border-l-2 border-gray-100 ml-1.5 space-y-2">
            {history.map((h, i) => (
              <li key={i} className="pl-4 text-xs">
                <span className={cn('absolute -left-[0.3125rem] mt-1 w-2 h-2 rounded-full', STAGE_DOT[stageColourKey(h.stage)])} />
                <span className="font-black text-gray-800">{t(stageKey(h.stage))}</span>
                <span className="font-bold text-gray-500"> · {formatDateTime(h.at)}</span>
                {h.by && <span className="font-bold text-gray-400"> · {t('oaBy').replace('{0}', h.by)}</span>}
              </li>
            ))}
          </ol>
        )}
        {order.nextStageAt && (
          <p className="text-[0.6875rem] font-bold text-blue-700 flex items-center gap-1">
            <CalendarClock className="w-3.5 h-3.5" />{formatDateTime(order.nextStageAt)}
          </p>
        )}
      </Section>

      {(order.notes || order.comments) && (
        <Section title={t('sdCustomerNote')}>
          <p data-rx-customer className="text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3 whitespace-pre-wrap">
            {order.notes || order.comments}
          </p>
        </Section>
      )}

      <OrderEmails key={order.id} order={order} t={t} />

      <Section title={t('oaDocumentsTitle')}>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenDoc('invoice')} className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-black hover:bg-black">{t('sdInvoice')}</button>
          <button type="button" onClick={() => onOpenDoc('receipt')} className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-black text-gray-700 hover:border-gray-400">{t('sdReceipt')}</button>
          <button type="button" onClick={() => onOpenDoc('work')} className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-black text-gray-700 hover:border-gray-400 inline-flex items-center gap-1"><Printer className="w-3.5 h-3.5" />{t('sdWorkOrder')}</button>
          <button type="button" onClick={() => onOpenDoc('slip')} className="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs font-black text-gray-700 hover:border-gray-400">{t('sdPackingSlip')}</button>
        </div>
      </Section>
    </div>
  );
}
