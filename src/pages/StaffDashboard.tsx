import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuth } from '../App';
import { Order, OrderStatus } from '../types';
import SiteCustomizerAdmin from '../components/Admin/SiteCustomizerAdmin';
import ProductsAdmin from '../components/Admin/ProductsAdmin';
import CategoryAdmin from '../components/Admin/CategoryAdmin';
import { triggerFileDownload } from '../lib/downloadHelper';
import { nextStageAtFor, replanFrom, sanitizeAutoStageSettings } from '../lib/orderStages';
import { formatDateTime, formatRelativeToNow } from '../lib/dateFormat';
import { shipmentStatusKey } from '../lib/shipmentStatus';
import { 
  Printer, 
  Ruler, 
  Download, 
  CheckCircle2, 
  Clock, 
  ArrowRight, 
  Filter, 
  Search, 
  FileCheck, 
  Sparkles, 
  Check, 
  User, 
  Send,
  AlertTriangle,
  Scissors,
  Truck,
  RefreshCw,
  ImageIcon,
  LayoutGrid,
  Package,
  Layers,
  FileText,
  Receipt,
  ZoomIn,
  Eye,
  FileImage,
  X,
  Flag
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn, isDisplayableImage } from '../lib/utils';
import { logoSrc } from '../lib/brandLogo';
import { previewOf } from '../lib/designFileSpecs';
import InvoiceModal from '../components/InvoiceModal';
import ReceiptModal from '../components/ReceiptModal';
import ProductionWorkOrderModal from '../components/ProductionWorkOrderModal';
import PackingSlipModal from '../components/PackingSlipModal';
import NeoDateField from '../components/NeoDateField';
import DesignAttachmentModal from '../components/DesignAttachmentModal';
import SafeImage from '../components/SafeImage';
import { useSiteSettings, useLiveSiteSettings } from '../context/SiteSettingsContext';
import NeumorphicSidebar, { NEO } from '../components/NeumorphicSidebar';
import { printSizeOf } from '../lib/printSize';
import { deliveryAddressOf } from '../lib/deliveryAddress';
import { filterOrders, isOnDeliveryOpen, priorityOf, sortOrders, stageOf, type OrderPriority, type OrderSort, type PaymentFilter } from '../lib/orderQueue';
import { useOrderFeed } from '../lib/useOrderFeed';
import PaymentBadge from '../components/PaymentBadge';

/** Per-browser memory of how the queue was last looked at. Storage may be blocked. */
const QUEUE_SORT_KEY = 'reklamx_queue_sort';
const QUEUE_PAY_KEY = 'reklamx_queue_payment';
const readPref = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const writePref = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* private window */ }
};
/** How many orders the queue loads per step — see the listener below. */
const QUEUE_PAGE = 200;

export default function StaffDashboard() {
  // Live settings for the screens he may edit here (the customizer).
  useLiveSiteSettings();
  const { user, t } = useAuth();
  const { settings: siteSettings } = useSiteSettings();
  const [activeTab, setActiveTab] = useState<'orders' | 'categories' | 'products' | 'customizer'>('orders');
  // The queue's orders: one live listener on the newest page, older pages read
  // once each (src/lib/useOrderFeed.ts). "Show older" raised the listener's cap,
  // which re-read every order from the first one each time.
  const feed = useOrderFeed(QUEUE_PAGE, !!user);
  const { orders, loading } = feed;
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  // THE QUEUE'S OWN CONTROLS — the client asked to sort by priority, print date
  // and delivery date (src/lib/orderQueue.ts). Sort and payment filter are
  // remembered per browser: the person at the press sets them once.
  const [sortMode, setSortMode] = useState<OrderSort>(() =>
    readPref(QUEUE_SORT_KEY, ['newest', 'priority', 'printDate', 'dueDate'] as const, 'newest'));
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>(() =>
    readPref(QUEUE_PAY_KEY, ['all', 'paid', 'unpaid', 'reversed'] as const, 'all'));
  const [searchText, setSearchText] = useState('');
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Zendr: which order is mid-request, and what went wrong on the last one.
  const [zendrBusyId, setZendrBusyId] = useState<string | null>(null);
  const [zendrError, setZendrError] = useState<string | null>(null);

  // Document modal state
  const [selectedInvoiceOrder, setSelectedInvoiceOrder] = useState<Order | null>(null);
  const [selectedReceiptOrder, setSelectedReceiptOrder] = useState<Order | null>(null);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<Order | null>(null);
  const [selectedPackingSlip, setSelectedPackingSlip] = useState<Order | null>(null);

  // Large Design Preview Lightbox State
  const [selectedDesignModalItem, setSelectedDesignModalItem] = useState<{
    fileUrl?: string;
    fileName?: string;
    fileType?: string;
    widthCm?: number;
    heightCm?: number;
    productName?: string;
    orderId?: string;
    previews?: Array<{ side: 'front' | 'back'; url: string }> | null;
  } | null>(null);

  // (The listener that lived here is useOrderFeed, above.)

  // `canManageOrders` was stored on every staff account and read by nothing, so
  // an account with it switched off could still move any order through
  // production. Checked here, and the controls are hidden below.
  const canManageOrders = user?.role === 'admin' || user?.permissions?.canManageOrders === true;

  /**
   * Move an order's promised date.
   *
   * The server sets one from the shop's lead times when the order is placed, but
   * a real print shop re-promises jobs constantly — the paper is late, the
   * customer changed the artwork, the press is full. A date nobody can move is
   * worse than no date, because the customer's dashboard shows it as a promise.
   *
   * Written with merge, so the security rule that forbids staff to touch
   * paymentStatus / grossTotal / netTotal still sees them unchanged.
   */
  const handleUpdateDueDate = async (orderId: string, dueDate: string) => {
    if (!canManageOrders) return;
    setUpdatingOrderId(orderId);
    try {
      await setDoc(
        doc(db, 'orders', orderId),
        { id: orderId, dueDate: dueDate || null, updatedAt: new Date().toISOString() },
        { merge: true },
      );
      feed.patch(orderId, { dueDate });
    } catch (err) {
      console.error('Error updating the due date:', err);
      setStatusError(t('sdDueDateFailed'));
      setTimeout(() => setStatusError(null), 5000);
    } finally {
      setUpdatingOrderId(null);
    }
  };

  /**
   * PRIORITY and PRINT DATE — set by the staff, the client's own answer.
   *
   * Merge writes of two plain fields; the rule that forbids staff to touch the
   * money (paymentStatus / grossTotal / netTotal) sees those unchanged. Normal
   * priority and "not planned" are stored as null, which every reader treats as
   * absent.
   */
  const updateOrderField = async (orderId: string, patch: Record<string, unknown>, failKey: 'sdPriorityFailed' | 'sdPrintDateFailed') => {
    if (!canManageOrders) return;
    setUpdatingOrderId(orderId);
    try {
      await setDoc(doc(db, 'orders', orderId), { id: orderId, ...patch, updatedAt: new Date().toISOString() }, { merge: true });
      feed.patch(orderId, patch as Partial<Order>);
    } catch (err) {
      console.error('Error updating the order:', err);
      setStatusError(t(failKey));
      setTimeout(() => setStatusError(null), 5000);
    } finally {
      setUpdatingOrderId(null);
    }
  };
  const handleUpdatePriority = (orderId: string, priority: OrderPriority) =>
    updateOrderField(orderId, { priority: priority === 'normal' ? null : priority }, 'sdPriorityFailed');
  const handleUpdatePrintDate = (orderId: string, printDate: string) =>
    updateOrderField(orderId, { printDate: printDate || null }, 'sdPrintDateFailed');

  /**
   * Ask the server to talk to Zendr about one order.
   *
   * Both calls go through the API rather than the browser, because the Zendr key
   * must never leave the server — and the server is also what writes the result
   * onto the order, which arrives back here through the snapshot listener. So
   * these handlers only have to report a failure.
   */
  const callZendr = async (orderId: string, path: 'zendr-draft' | 'tracking' | 'drive') => {
    if (!canManageOrders) return;
    setZendrBusyId(orderId);
    setZendrError(null);
    try {
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      const resp = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: '{}',
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status}).`);
      if (data?.note) setZendrError(data.note);
    } catch (err: any) {
      setZendrError(String(err?.message ?? err));
      setTimeout(() => setZendrError(null), 10000);
    } finally {
      setZendrBusyId(null);
    }
  };

  /**
   * Move a job by hand.
   *
   * THE HAND ALWAYS WINS. Orders walk themselves along the schedule in
   * settings/siteConfig.autoStages, but a schedule is a guess and the person
   * standing at the press is not — the paper is late, the press finished early,
   * the customer changed the artwork. So a manual move does two things: it sets
   * the stage, and it RE-MEASURES everything still to come from this moment, so
   * the sweep does not drag the job back to a plan written at midnight. Pushing
   * an order backwards re-runs the stages it repeats, for the same reason.
   */
  const handleUpdateStatus = async (orderId: string, newStatus: OrderStatus) => {
    if (!canManageOrders) return;
    setUpdatingOrderId(orderId);
    try {
      const docRef = doc(db, 'orders', orderId);
      const now = new Date().toISOString();
      const autoStages = sanitizeAutoStageSettings(siteSettings.autoStages);
      const order = orders.find((o) => o.id === orderId) as any;
      // A PAID order gets a schedule — and one placed to pay on delivery, which is
      // produced before it is paid. Any other unpaid one moved by hand stays exactly
      // where the hand put it: the clock has no business in production that has not
      // been bought.
      const paid = String(order?.paymentStatus || '').toLowerCase() === 'paid' || isOnDeliveryOpen(order);
      // A production speed's days carry over (src/lib/productionSpeed.ts); absent, as before.
      const plan = paid ? replanFrom(newStatus, now, autoStages, order?.shippingMethod, order?.productionDays ?? null) : {};

      await setDoc(docRef, {
        id: orderId,
        status: newStatus,
        assignedStaffName: user?.displayName || t('sdProductionCrew'),
        stageSource: 'manual',
        stageChangedAt: now,
        // Whatever was holding it (no artwork, not paid) is the sweep's note to
        // itself, and a human has just overruled it.
        stageHold: null,
        stagePlan: Object.keys(plan).length ? plan : null,
        nextStageAt: nextStageAtFor(newStatus, plan),
        stageHistory: [
          ...((order?.stageHistory as any[]) ?? []),
          { stage: newStatus, at: now, by: user?.displayName || 'staff' },
        ].slice(-20),
        updatedAt: now,
        ...(newStatus === 'completed' ? { deliveredAt: now } : {})
      }, { merge: true });

      feed.patch(orderId, { status: newStatus, assignedStaffName: user?.displayName || t('sdProductionCrew') } as Partial<Order>);
    } catch (err) {
      console.error('Error updating status:', err);
      // Security rules can reject this. Silently swallowing it left the new
      // status on screen while the order never moved.
      setStatusError(t('sdStatusUpdateFailed'));
      setTimeout(() => setStatusError(null), 5000);
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const filteredOrders = sortOrders(
    filterOrders(orders, { stage: selectedStatusFilter, payment: paymentFilter, q: searchText }),
    sortMode,
  );
  // The sidebar's numbers count what a click on them shows: under the payment
  // filter this browser remembers. They counted every order, so "Pending 7"
  // opened "No order matches" while yesterday's "Paid only" was still on.
  const countable = filterOrders(orders, { payment: paymentFilter });
  const countIn = (stage: string) => countable.filter((o) => stageOf(o) === stage).length || undefined;

  return (
    // The soft-UI shell from the client's reference video: a grey surface that
    // everything else appears pressed out of, with the neumorphic sidebar
    // carrying the production-stage filters instead of the old button row.
    <div className={cn('min-h-screen', NEO.page)}>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex items-start gap-6">
      <NeumorphicSidebar
        title={siteSettings.siteName || 'ReklamX'}
        tagline="Production Workspace"
        logoUrl={logoSrc(siteSettings)}
        activeId={selectedStatusFilter}
        onSelect={(id) => setSelectedStatusFilter(id)}
        sections={[
          {
            label: 'Print Queue',
            items: [
              { id: 'all', label: t('sdAllStages'), icon: <LayoutGrid />, badge: countable.length || undefined },
              { id: 'pending', label: t('sdStatusPending'), icon: <Clock />, badge: countIn('pending') },
              { id: 'in_design', label: t('sdStatusInDesign'), icon: <Sparkles />, badge: countIn('in_design') },
              { id: 'in_print', label: t('sdStatusInPrint'), icon: <Printer />, badge: countIn('in_print') },
              { id: 'finishing', label: t('sdStatusFinishing'), icon: <Scissors />, badge: countIn('finishing') },
              { id: 'shipped', label: t('sdStatusShipped'), icon: <Truck />, badge: countIn('shipped') },
              { id: 'completed', label: t('sdStatusCompleted'), icon: <CheckCircle2 />, badge: countIn('completed') },
              // Cancelled orders had no filter at all: they sat in "All" and
              // nowhere else.
              { id: 'cancelled', label: t('sdStatusCancelled'), icon: <X />, badge: countIn('cancelled') },
            ],
          },
        ]}
      />

      <div className="flex-1 min-w-0 space-y-8">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-gray-900 via-indigo-950 to-gray-900 text-white rounded-3xl p-8 shadow-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <div className="inline-flex items-center px-3.5 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-400/30 text-xs font-bold mb-3 uppercase tracking-wider">
            <Printer className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
            {'Production Staff Workspace'}
          </div>
          {/* Same overflow as the admin panel's heading: a long unbreakable title at
              text-3xl inside the p-8 banner ran off a phone viewport, so it steps up
              with the breakpoints and is allowed to wrap mid-word. */}
          <h1 className="text-xl sm:text-2xl md:text-3xl font-black tracking-tight break-words">
            {'Print Jobs & Production Workspace'}
          </h1>
          <p className="text-sm text-gray-300 mt-1">
            {'Manage production queue, replace site banner images, and control store settings.'}
          </p>

          {/* Navigation Tabs for Staff */}
          <div className="flex flex-wrap items-center gap-2 mt-4 bg-white/10 p-1.5 rounded-2xl border border-white/10 w-fit">
            <button
              onClick={() => setActiveTab('orders')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2",
                activeTab === 'orders' ? "bg-orange-600 text-white shadow-md font-black" : "text-gray-300 hover:text-white"
              )}
            >
              <Printer className="w-3.5 h-3.5 mr-1" />
              <span>{'Production Queue'}</span>
            </button>

            {/* Fails closed: a staff account with no permissions set gets nothing.
                The `!== false` form granted access whenever the flag was simply absent. */}
            {(user?.role === 'admin' || user?.permissions?.canManageCategories === true) && (
              <button
                onClick={() => setActiveTab('categories')}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2",
                  activeTab === 'categories' ? "bg-orange-600 text-white shadow-md font-black" : "text-gray-300 hover:text-white"
                )}
              >
                <Layers className="w-3.5 h-3.5 mr-1" />
                <span>{t('navCategories')}</span>
              </button>
            )}

            {/* Products and the site customiser were shown to every staff and
                production account regardless of permissions — the categories tab
                beside them was gated, these two were not. */}
            {(user?.role === 'admin' || user?.permissions?.canManageProducts === true) && (
            <button
              onClick={() => setActiveTab('products')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2",
                activeTab === 'products' ? "bg-orange-600 text-white shadow-md font-black" : "text-gray-300 hover:text-white"
              )}
            >
              <Package className="w-3.5 h-3.5 mr-1" />
              <span>{'Products, Prices & Options'}</span>
            </button>
            )}

            {(user?.role === 'admin' || user?.permissions?.canManageSiteCustomizer === true) && (
            <button
              onClick={() => setActiveTab('customizer')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2",
                activeTab === 'customizer' ? "bg-orange-600 text-white shadow-md font-black" : "text-gray-300 hover:text-white"
              )}
            >
              <ImageIcon className="w-3.5 h-3.5 mr-1" />
              <span>{'Banners & Image Replacement'}</span>
            </button>
            )}
          </div>
        </div>

        {/* Counter Pills */}
        <div className="flex items-center space-x-3 text-xs font-bold">
          <div className="bg-white/10 px-4 py-2.5 rounded-2xl border border-white/10 backdrop-blur-md">
            <span className="text-gray-400 block">{'Total Jobs'}</span>
            <span className="text-xl font-black text-white">{countable.length}</span>
          </div>
          <div className="bg-orange-500/20 text-orange-200 px-4 py-2.5 rounded-2xl border border-orange-400/30 backdrop-blur-md">
            <span className="text-orange-300 block">{'In Printing'}</span>
            <span className="text-xl font-black text-orange-300">
              {countable.filter((o) => stageOf(o) === 'in_print').length}
            </span>
          </div>
        </div>
      </div>

      {/* Gated again here: hiding a button is not access control — activeTab can
          be reached without clicking it. */}
      {activeTab === 'categories' && (user?.role === 'admin' || user?.permissions?.canManageCategories === true) ? (
        <CategoryAdmin />
      ) : activeTab === 'customizer' && (user?.role === 'admin' || user?.permissions?.canManageSiteCustomizer === true) ? (
        <SiteCustomizerAdmin />
      ) : activeTab === 'products' && (user?.role === 'admin' || user?.permissions?.canManageProducts === true) ? (
        <ProductsAdmin />
      ) : (
        <>

      {/* Stage filters moved into the neumorphic sidebar — the button row that lived here is gone; selectedStatusFilter state is unchanged. */}

      {(statusError || downloadError || zendrError) && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-800 font-bold flex items-center">
          <AlertTriangle className="w-4 h-4 text-red-600 mr-2 shrink-0" />
          <span>{statusError || downloadError || zendrError}</span>
        </div>
      )}

      {/* THE QUEUE'S CONTROLS: find an order, hide the unpaid, choose the sort. */}
      <div className="bg-white rounded-3xl p-4 border border-gray-100 shadow-sm flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[13.75rem]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={t('sdSearchOrders')}
            aria-label={t('sdSearchOrders')}
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <select
          value={paymentFilter}
          onChange={(e) => { const v = e.target.value as PaymentFilter; setPaymentFilter(v); writePref(QUEUE_PAY_KEY, v); }}
          aria-label={t('sdPaymentBlock')}
          className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-700"
        >
          <option value="all">{t('sdPayFilterAll')}</option>
          <option value="paid">{t('sdPayFilterPaid')}</option>
          <option value="unpaid">{t('sdPayFilterUnpaid')}</option>
          <option value="reversed">{t('sdPayFilterReversed')}</option>
        </select>
        <label className="flex items-center gap-2 text-xs font-black text-gray-500">
          {t('sdSortLabel')}
          <select
            value={sortMode}
            onChange={(e) => { const v = e.target.value as OrderSort; setSortMode(v); writePref(QUEUE_SORT_KEY, v); }}
            className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-xs font-black text-gray-700"
          >
            <option value="newest">{t('sdSortNewest')}</option>
            <option value="priority">{t('sdSortPriority')}</option>
            <option value="printDate">{t('sdSortPrintDate')}</option>
            <option value="dueDate">{t('sdSortDueDate')}</option>
          </select>
        </label>
        <span className="text-[0.6875rem] font-bold text-gray-400 tabular-nums">
          {t('sdShowingCount').replace('{0}', String(filteredOrders.length)).replace('{1}', String(orders.length))}
        </span>
      </div>

      {filteredOrders.length === 0 && !loading && (
        <p className="text-xs font-bold text-gray-400 text-center py-8">{t('sdNoOrdersMatch')}</p>
      )}

      {/* Orders Queue List */}
      <div className="space-y-6">
        {filteredOrders.map((order) => (
          <motion.div 
            key={order.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-6"
          >
            {/* Top Bar */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-100 pb-4 gap-4">
              <div>
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1">
                  <span className="font-black text-gray-900 text-xl">{order.id}</span>
                  {/* Priority and print day, readable at a glance — set by staff below. */}
                  {priorityOf(order) !== 'normal' && (
                    <span className={cn(
                      'px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase tracking-wide flex items-center gap-1',
                      priorityOf(order) === 'urgent' ? 'bg-red-600 text-white' : 'bg-orange-100 text-orange-800',
                    )}>
                      <Flag className="w-3 h-3" />
                      {t(priorityOf(order) === 'urgent' ? 'sdPriorityUrgent' : 'sdPriorityHigh')}
                    </span>
                  )}
                  {order.printDate && (
                    <span className="px-2 py-0.5 rounded-md text-[0.625rem] font-black bg-indigo-50 text-indigo-700 flex items-center gap-1">
                      <Printer className="w-3 h-3" />
                      {t('sdPrintDate')}: {order.printDate}
                    </span>
                  )}
                  {/* Paid or not, visible at a glance — this used to hide inside
                      the receipt modal, so staff could not tell a paid order
                      from an abandoned one without opening each. */}
                  <PaymentBadge order={order} t={t} />
                  <span className="font-mono font-bold text-xs text-gray-600 tabular-nums">
                    {order.grossTotal != null ? `${order.grossTotal} ${order.currency || 'SEK'}` : ''}
                  </span>
                  {/* Money arrived but does not match the order — a human must
                      look before anything is printed. The flag was recorded by
                      the webhook and rendered nowhere until now. */}
                  {(order as any).paymentMismatch && (
                    <span className="px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase bg-red-600 text-white flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {t('sdPaymentMismatch')}
                    </span>
                  )}
                  {/* A partial refund no longer flips the order off 'paid';
                      staff still need to see it happened. */}
                  {order.paymentStatus === 'paid' && Number((order as any).refundedAmount) > 0 && (
                    <span className="px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase bg-amber-100 text-amber-800">
                      {t('sdPartialRefund').replace('{0}', String((order as any).refundedAmount))}
                    </span>
                  )}
                  {/* Artwork is optional on most products now, so an order with
                      no file is a normal state that production must SEE, not a
                      blank thumbnail they mistake for a broken image. */}
                  {((order as any).artworkPending || (order.items ?? []).some((i: any) => i?.artworkPending)) && (
                    <span className="px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase bg-amber-500 text-white flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {t('sdArtworkPending')}
                    </span>
                  )}
                  {(order.items ?? []).some((i: any) => i?.artworkSource === 'reprint') && (
                    <span className="px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase bg-sky-600 text-white" data-rx-artwork-source="reprint">
                      {t('sdArtworkReprint')}
                    </span>
                  )}
                  {(order.items ?? []).some((i: any) => i?.artworkSource === 'studio') && (
                    <span className="px-2 py-0.5 rounded-md text-[0.625rem] font-black uppercase bg-sky-600 text-white" data-rx-artwork-source="studio">
                      {t('sdArtworkStudio')}
                    </span>
                  )}
                  <span className="text-xs font-bold text-gray-500">• {order.customerName} ({order.customerEmail})</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {t('sdReceivedOn')}: {formatDateTime(order.createdAt)}
                </p>
              </div>

              {/* Status Selector dropdown & Document Buttons for staff */}
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <button
                  onClick={() => setSelectedWorkOrder(order)}
                  className="px-3.5 py-2 bg-blue-600 text-white hover:bg-blue-700 transition-colors rounded-xl font-extrabold text-xs flex items-center space-x-1.5 space-x-reverse cursor-pointer shadow-md active:scale-95"
                  title={t('sdWorkOrderTip')}
                >
                  <Printer className="w-4 h-4" />
                  <span>{t('sdWorkOrder')}</span>
                </button>

                {/* The sheet that travels with the box: every choice the
                    customer made, the file they sent, no prices. Modelled on the
                    supplier slip the owner works from. */}
                <button
                  onClick={() => setSelectedPackingSlip(order)}
                  className="px-3.5 py-2 bg-emerald-600 text-white hover:bg-emerald-700 transition-colors rounded-xl font-extrabold text-xs flex items-center space-x-1.5 space-x-reverse cursor-pointer shadow-md active:scale-95"
                  title={t('sdPackingSlipTip')}
                >
                  <Package className="w-4 h-4" />
                  <span>{t('sdPackingSlip')}</span>
                </button>

                <button
                  onClick={() => setSelectedReceiptOrder(order)}
                  className="px-3 py-2 bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-colors rounded-xl font-bold text-xs flex items-center space-x-1.5 space-x-reverse cursor-pointer shadow-2xs active:scale-95"
                  title={t('sdReceiptTip')}
                >
                  <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{t('sdReceipt')}</span>
                </button>

                <button
                  onClick={() => setSelectedInvoiceOrder(order)}
                  className="px-3 py-2 bg-orange-50 text-orange-900 border border-orange-200 hover:bg-orange-100 transition-colors rounded-xl font-bold text-xs flex items-center space-x-1.5 space-x-reverse cursor-pointer shadow-2xs active:scale-95"
                  title={t('sdInvoiceTip')}
                >
                  <FileText className="w-3.5 h-3.5 text-orange-600" />
                  <span>{t('sdInvoice')}</span>
                </button>

                <div className="flex items-center space-x-2 space-x-reverse">
                  <span className="text-xs font-bold text-gray-500">{'Stage:'}</span>
                  <select 
                    value={order.status}
                    onChange={(e) => handleUpdateStatus(order.id, e.target.value as OrderStatus)}
                    disabled={updatingOrderId === order.id}
                    className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl font-bold text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="pending">{t('sdStatusPending')}</option>
                    <option value="in_design">{t('sdStatusInDesign')}</option>
                    <option value="in_print">{t('sdStatusInPrint')}</option>
                    <option value="finishing">{t('sdStatusFinishing')}</option>
                    <option value="shipped">{t('sdStatusShipped')}</option>
                    <option value="completed">{t('sdStatusCompleted')}</option>
                    <option value="cancelled">{t('sdStatusCancelled')}</option>
                  </select>
                </div>

                {/* WHAT THE CLOCK IS ABOUT TO DO TO THIS JOB.
                    The stages move by themselves now. Automation nobody can see
                    is automation nobody trusts — and the two cases that STOP it
                    (no money, no artwork) are exactly the two a production
                    manager has to know about, so they are stated, not hidden. */}
                {(() => {
                  const o = order as any;
                  if (o.stageHold === 'artwork_pending') {
                    return (
                      <span
                        className="text-[0.625rem] font-black uppercase tracking-wide bg-amber-100 text-amber-900 border border-amber-200 px-2.5 py-1.5 rounded-xl"
                        title="Automatic stages are paused: this job has no artwork. Move it by hand once the file arrives."
                      >
                        Auto paused — awaiting artwork
                      </span>
                    );
                  }
                  if (o.stageHold === 'artwork_by_shop') {
                    return (
                      <span
                        className="text-[0.625rem] font-black uppercase tracking-wide bg-amber-100 text-amber-900 border border-amber-200 px-2.5 py-1.5 rounded-xl"
                        title="Automatic stages are paused at design: the artwork comes from the shop (a reprint of an earlier order, or the studio's design). Move it to print by hand once the file is ready."
                      >
                        Auto paused — artwork from the shop
                      </span>
                    );
                  }
                  // An order to pay on delivery is produced before it is paid.
                  if (o.stageHold === 'unpaid' || (order.paymentStatus !== 'paid' && !isOnDeliveryOpen(order))) {
                    return (
                      <span
                        className="text-[0.625rem] font-black uppercase tracking-wide bg-gray-100 text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-xl"
                        title="Automatic stages start when the payment is confirmed."
                      >
                        Auto off — not paid
                      </span>
                    );
                  }
                  if (o.nextStageAt) {
                    return (
                      <span
                        className="text-[0.625rem] font-black uppercase tracking-wide bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1.5 rounded-xl"
                        title={`Moves on automatically at ${formatDateTime(o.nextStageAt)}`}
                      >
                        Auto — next stage {formatRelativeToNow(o.nextStageAt)}
                      </span>
                    );
                  }
                  // Paid, live, and carrying no schedule — which is every order
                  // placed BEFORE the automatic stages existed. Saying nothing
                  // here would leave production wondering why one job moves on
                  // its own and the one above it does not. Moving the stage by
                  // hand once writes a schedule and it runs from there.
                  if (order.status !== 'completed' && order.status !== 'cancelled') {
                    return (
                      <span
                        className="text-[0.625rem] font-black uppercase tracking-wide bg-gray-100 text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-xl"
                        title="This order has no automatic schedule — it was placed before the stages became automatic. Move the stage once and it will run on from there."
                      >
                        Auto — not scheduled
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
            </div>

            {/* WHO, WHERE, HOW PAID, WHEN DUE.
                This card used to carry an order number, an email address and the
                items — everything else a production worker needs to actually
                despatch the job (the phone number to ring, the address it goes
                to, whether the customer is collecting it, when it was promised)
                lived behind the work-order modal or nowhere at all. */}
            {(() => {
              const c: any = (order as any).customerDetails ?? {};
              const isPickup = order.shippingMethod === 'pickup';
              // Where it is GOING — the separate delivery address when the
              // customer gave one (src/lib/deliveryAddress.ts).
              const dest = deliveryAddressOf(order);
              const addressLines = [
                dest.separate ? dest.name : '',
                dest.company,
                dest.address1,
                dest.address2,
                [dest.postcode, dest.city].filter(Boolean).join(' '),
                dest.country,
              ].filter((line) => typeof line === 'string' && line.trim());

              return (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  {/* data-rx-customer marks text the CUSTOMER wrote. The shop's
                      own words are English/Swedish/Danish/Norwegian; a customer's
                      name and address are whatever they typed, in whatever
                      script, and are printed exactly as given. The Arabic check
                      in the end-to-end suite reads this attribute to tell the
                      two apart. */}
                  <div data-rx-customer className="bg-gray-50 rounded-2xl border border-gray-100 p-4 space-y-1">
                    <p className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">
                      {t('sdCustomerBlock')}
                    </p>
                    <p className="font-black text-gray-900">{order.customerName || '—'}</p>
                    <p className="font-bold text-gray-600 break-all">{order.customerEmail}</p>
                    {c.phone && (
                      <a href={`tel:${String(c.phone).replace(/\s+/g, '')}`} className="font-black text-blue-700 hover:underline block">
                        {c.phone}
                      </a>
                    )}
                    {c.taxId && <p className="font-bold text-gray-500">{c.taxId}</p>}
                  </div>

                  <div data-rx-customer className="bg-gray-50 rounded-2xl border border-gray-100 p-4 space-y-1">
                    <p className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">
                      {t('sdDeliveryBlock')}
                    </p>
                    <p className="font-black text-gray-900">
                      {order.shippingMethodTitle || order.shippingMethod || '—'}
                    </p>
                    {isPickup ? (
                      <p className="font-bold text-amber-700">{t('sdCollectsInPerson')}</p>
                    ) : addressLines.length > 0 ? (
                      addressLines.map((line, i) => (
                        <p key={i} className="font-bold text-gray-600">
                          {line}
                        </p>
                      ))
                    ) : (
                      <p className="font-bold text-gray-400">—</p>
                    )}

                    {/* THE SHIPMENT.
                        Zendr's API can create the draft and report tracking; it
                        cannot book. So this shows where the parcel is and hands
                        the staff member the one link that matters — the draft,
                        open in the portal, ready to book. */}
                    {!isPickup && (
                      <div className="pt-2 mt-2 border-t border-gray-200 space-y-1">
                        <p className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">
                          {t('sdShipTitle')}
                        </p>

                        {order.shipment?.status ? (
                          <p className="font-black text-gray-900">
                            {t(shipmentStatusKey(order.shipment.status) ?? 'sdShipNoTracking')}
                          </p>
                        ) : order.zendr?.importedOrderId ? (
                          <p className="font-bold text-gray-500">{t('sdShipNoTracking')}</p>
                        ) : (
                          <p className="font-bold text-gray-400">{t('sdShipNotSent')}</p>
                        )}

                        {order.shipment?.trackingNumber && (
                          <p className="font-bold text-gray-600 break-all">
                            {t('shipTrackingNumber')}: {order.shipment.trackingNumber}
                            {order.shipment.carrier ? ` · ${order.shipment.carrier}` : ''}
                          </p>
                        )}

                        {order.zendr?.error && (
                          <p className="font-bold text-red-600 break-words">{order.zendr.error}</p>
                        )}

                        {canManageOrders && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {order.zendr?.portalUrl ? (
                              <>
                                <a
                                  href={order.zendr.portalUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-2.5 py-1 bg-gray-900 text-white text-[0.625rem] font-black rounded-lg hover:bg-gray-800 transition-colors"
                                >
                                  {t('sdShipOpen')}
                                </a>
                                <button
                                  type="button"
                                  onClick={() => callZendr(order.id, 'tracking')}
                                  disabled={zendrBusyId === order.id}
                                  className="px-2.5 py-1 bg-white border border-gray-300 text-gray-700 text-[0.625rem] font-black rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                                >
                                  {zendrBusyId === order.id ? t('sdShipSending') : t('sdShipRefresh')}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => callZendr(order.id, 'zendr-draft')}
                                disabled={zendrBusyId === order.id}
                                className="px-2.5 py-1 bg-blue-600 text-white text-[0.625rem] font-black rounded-lg hover:bg-blue-500 disabled:opacity-50 transition-colors"
                              >
                                {zendrBusyId === order.id ? t('sdShipSending') : t('sdShipSend')}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* THE CUSTOMER'S FILE AND THEIR ORDER, IN THE OWNER'S DRIVE.
                        Filed automatically the moment the order is paid — this
                        is the link to it, and the retry when Drive was down. */}
                    <div className="pt-2 mt-2 border-t border-gray-200 space-y-1">
                      <p className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">
                        Google Drive
                      </p>
                      {order.drive?.folderUrl ? (
                        <>
                          <p className="font-bold text-emerald-700">
                            Filed{order.drive.files ? ` — ${order.drive.files} files` : ''}
                          </p>
                          <a
                            href={order.drive.folderUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block px-2.5 py-1 bg-gray-900 text-white text-[0.625rem] font-black rounded-lg hover:bg-gray-800 transition-colors"
                          >
                            Open folder
                          </a>
                        </>
                      ) : (
                        <p className="font-bold text-gray-400">Not filed yet</p>
                      )}
                      {order.drive?.error && (
                        <p className="font-bold text-red-600 break-words">{order.drive.error}</p>
                      )}
                      {canManageOrders && (
                        <button
                          type="button"
                          onClick={() => callZendr(order.id, 'drive')}
                          disabled={zendrBusyId === order.id}
                          className="px-2.5 py-1 bg-white border border-gray-300 text-gray-700 text-[0.625rem] font-black rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        >
                          {zendrBusyId === order.id ? t('sdShipSending') : order.drive?.folderUrl ? 'Send again' : 'Send to Drive'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4 space-y-2">
                    <p className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">
                      {t('sdPaymentBlock')}
                    </p>
                    <p className="font-black text-gray-900">
                      {order.paymentMethodTitle || order.paymentMethod || '—'}
                    </p>
                    {order.paidAt && (
                      <p className="font-bold text-gray-600">{formatDateTime(order.paidAt)}</p>
                    )}

                    {/* The promised date, editable in place. */}
                    <div className="pt-1.5 border-t border-gray-200">
                      <label className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400 block mb-1">
                        {t('sdDueDate')}
                      </label>
                      {canManageOrders ? (
                        /* NOT `<input type="date">`. Chrome renders that
                           control's placeholder and calendar in the BROWSER's
                           language, which on this shop's own machine is Arabic —
                           the box read `موي /ر هش /قتس`. NeoDateField draws its
                           own, in English, and speaks the same ISO strings. */
                        <NeoDateField
                          value={order.dueDate || ''}
                          commitOn="blur"
                          onChange={(iso) => handleUpdateDueDate(order.id, iso)}
                          aria-label={t('sdDueDate')}
                          className="w-full"
                        />
                      ) : (
                        <p className="font-black text-gray-900">{order.dueDate || t('sdDueDateNotSet')}</p>
                      )}
                    </div>

                    {/* PRIORITY and PRINT DATE — the staff decide both. */}
                    <div className="pt-1.5 border-t border-gray-200 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400 block mb-1">
                          {t('sdPriority')}
                        </label>
                        {canManageOrders ? (
                          <select
                            value={priorityOf(order)}
                            disabled={updatingOrderId === order.id}
                            onChange={(e) => handleUpdatePriority(order.id, e.target.value as OrderPriority)}
                            aria-label={t('sdPriority')}
                            className={cn(
                              'w-full px-2 py-1.5 rounded-lg border text-xs font-black',
                              priorityOf(order) === 'urgent' ? 'border-red-300 bg-red-50 text-red-700'
                                : priorityOf(order) === 'high' ? 'border-orange-300 bg-orange-50 text-orange-800'
                                  : 'border-gray-200 bg-white text-gray-700',
                            )}
                          >
                            <option value="normal">{t('sdPriorityNormal')}</option>
                            <option value="high">{t('sdPriorityHigh')}</option>
                            <option value="urgent">{t('sdPriorityUrgent')}</option>
                          </select>
                        ) : (
                          <p className="font-black text-gray-900">
                            {t(priorityOf(order) === 'urgent' ? 'sdPriorityUrgent' : priorityOf(order) === 'high' ? 'sdPriorityHigh' : 'sdPriorityNormal')}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400 block mb-1">
                          {t('sdPrintDate')}
                        </label>
                        {canManageOrders ? (
                          <NeoDateField
                            value={order.printDate || ''}
                            commitOn="blur"
                            onChange={(iso) => handleUpdatePrintDate(order.id, iso)}
                            aria-label={t('sdPrintDate')}
                            className="w-full"
                          />
                        ) : (
                          <p className="font-black text-gray-900">{order.printDate || t('sdPrintDateNotSet')}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Print Items with Dimensions Specs */}
            <div className="space-y-4">
              {(order.items ?? []).map((item, idx) => {
                const itemFileUrl = item.fileSpecs?.fileUrl || (item as any).fileUrl || item.designData;
                // No made-up name: a line with no file must not look as if it had one.
                const itemFileName = item.fileSpecs?.fileName || (item as any).fileName || '';
                const itemFileType = item.fileSpecs?.fileType || 'PNG';
                // A studio design's page pictures: shown instead of loading the print file.
                const itemPages = item.fileSpecs?.previews ?? null;
                const itemThumb = previewOf(item.fileSpecs);
                // 15.6.6 — both axes, one rule. See printSizeOf.
                const itemSize = printSizeOf(item);
                const itemWidth = itemSize?.widthCm;
                const itemHeight = itemSize?.heightCm;

                return (
                  <div key={idx} className="bg-gray-50 p-5 rounded-2xl border border-gray-100 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                    
                    {/* Item Image Thumbnail Box */}
                    <div className="md:col-span-3 flex flex-col items-center justify-center">
                      <div 
                        onClick={() => itemFileUrl && setSelectedDesignModalItem({
                          fileUrl: itemFileUrl,
                          fileName: itemFileName || 'Print file',
                          fileType: itemFileType,
                          widthCm: itemWidth,
                          heightCm: itemHeight,
                          productName: item.productName,
                          orderId: order.id,
                          previews: itemPages,
                        })}
                        className="w-full h-32 bg-slate-900 rounded-xl overflow-hidden border border-slate-300 relative flex items-center justify-center p-2 group shadow-inner cursor-pointer hover:border-blue-500 transition-all"
                        title={'Click to view large design picture'}
                      >
                        {itemFileUrl && itemThumb ? (
                          <SafeImage
                            src={itemThumb}
                            alt="Attachment Preview"
                            className="max-h-full max-w-full object-contain rounded group-hover:scale-105 transition-transform"
                          />
                        ) : isDisplayableImage(itemFileUrl, itemFileName, itemFileType) ? (
                          <SafeImage 
                            src={itemFileUrl} 
                            alt="Attachment Preview" 
                            className="max-h-full max-w-full object-contain rounded group-hover:scale-105 transition-transform"
                          />
                        ) : itemFileUrl ? (
                          <div className="text-center p-2 text-slate-300 space-y-1">
                            <FileText className="w-8 h-8 mx-auto text-blue-400" />
                            <span className="font-mono text-[0.6875rem] font-bold block text-white truncate max-w-[8.75rem]">{itemFileName || 'Print file'}</span>
                          </div>
                        ) : (
                          <div data-rx-thumb-no-file className="text-center p-2 space-y-1">
                            <FileText className="w-8 h-8 mx-auto text-slate-600" />
                            <span className="text-[0.6875rem] font-bold block text-slate-500">—</span>
                          </div>
                        )}

                        {itemFileUrl && (
                          <div className="absolute inset-0 bg-blue-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white font-extrabold text-xs">
                            <ZoomIn className="w-4 h-4 text-white" />
                            <span>{'Expand'}</span>
                          </div>
                        )}
                      </div>

                      {itemFileUrl && (
                        <button
                          type="button"
                          onClick={() => setSelectedDesignModalItem({
                            fileUrl: itemFileUrl,
                            fileName: itemFileName,
                            fileType: itemFileType,
                            widthCm: itemWidth,
                            heightCm: itemHeight,
                            productName: item.productName,
                            orderId: order.id,
                            previews: itemPages,
                          })}
                          className="mt-2 text-xs text-blue-700 hover:text-blue-900 font-extrabold flex items-center gap-1 cursor-pointer"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                          <span>{'Large Preview'}</span>
                        </button>
                      )}
                    </div>

                    {/* Item Details */}
                    <div className="md:col-span-5 space-y-2">
                      <h4 className="font-black text-gray-900 text-base">{item.productName}</h4>
                      {item.options && Object.keys(item.options).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 text-xs text-gray-600">
                          {Object.entries(item.options).map(([k, v]) => {
                            const displayVal = typeof v === 'object' && v !== null
                              ? ((v as any).label || (v as any).value || JSON.stringify(v))
                              : String(v);
                            return (
                              <span key={k} className="bg-gray-200/80 text-gray-800 px-2 py-0.5 rounded font-bold">
                                {k}: {displayVal}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <div className="space-y-1 text-xs">
                        {(item as any).sku && (
                          <div className="flex items-center space-x-2 space-x-reverse font-black text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg w-fit border border-slate-200">
                            <Layers className="w-3.5 h-3.5 text-slate-500" />
                            <span>{t('sdSku')}: {(item as any).sku}</span>
                          </div>
                        )}

                        {itemFileUrl ? (
                          <div className="flex items-center space-x-2 space-x-reverse font-bold text-blue-900 bg-blue-50 px-2.5 py-1 rounded-lg w-fit border border-blue-100">
                            <FileImage className="w-3.5 h-3.5 text-blue-600" />
                            <span>{t('sdAttachmentName')} <strong>{itemFileName}</strong> ({itemFileType})</span>
                          </div>
                        ) : (item as any).artworkSource === 'reprint' || (item as any).artworkSource === 'studio' ? (
                          /* The shop makes this line's artwork — said on the LINE,
                             so on an order of several the reprint is the one marked. */
                          <div
                            data-rx-line-shop-artwork={(item as any).artworkSource}
                            className="flex items-center space-x-2 space-x-reverse font-black text-sky-900 bg-sky-50 px-2.5 py-1 rounded-lg w-fit border border-sky-200"
                          >
                            <FileImage className="w-3.5 h-3.5 text-sky-600" />
                            <span>{t((item as any).artworkSource === 'reprint' ? 'sdArtworkReprint' : 'sdArtworkStudio')}</span>
                          </div>
                        ) : (
                          /* The old code printed a made-up file name
                             ("Uploaded_Print_Design.png") for a line that had no
                             file at all, which is how a job could sit in the
                             queue looking complete while nothing had arrived.
                             Every line with no file and no shop-made artwork
                             still warns: with the upload box off (the default),
                             a printed line is never recorded as waiting, and
                             this badge is the one signal left. */
                          <div className="flex items-center space-x-2 space-x-reverse font-black text-amber-900 bg-amber-50 px-2.5 py-1 rounded-lg w-fit border border-amber-200">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                            <span>{t('sdNoFileYet')}</span>
                          </div>
                        )}

                        {itemWidth && itemHeight && (
                          <div className="flex items-center space-x-2 space-x-reverse font-extrabold text-slate-800 bg-white p-2 rounded-xl border border-gray-200 w-fit">
                            <Ruler className="w-4 h-4 text-blue-600" />
                            <span>{t('sdPrintSize')}: {itemWidth} × {itemHeight} cm</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Quantity & Actions */}
                    <div className="md:col-span-4 flex flex-col items-end justify-center space-y-2">
                      <span className="text-xs font-black text-slate-900 bg-amber-100 text-amber-900 px-3.5 py-1.5 rounded-xl border border-amber-200">
                        {t('sdQuantityNeeded')}: {item.quantity}
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            const downloaded = await triggerFileDownload(
                              itemFileUrl,
                              itemFileName,
                              item.fileSpecs || item
                            );
                            if (!downloaded) {
                              setDownloadError(t('sdDownloadFailed'));
                              setTimeout(() => setDownloadError(null), 5000);
                            }
                          }}
                          disabled={!itemFileUrl}
                          title={!itemFileUrl ? t('sdNoArtwork') : undefined}
                          className="px-4 py-2 bg-blue-600 text-white text-xs font-extrabold rounded-xl hover:bg-blue-700 transition-colors flex items-center shadow-md shadow-blue-500/20 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Download className="w-3.5 h-3.5 mr-1.5" />
                          {'Download File'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Production Notes */}
            {order.notes && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 font-semibold flex items-center">
                <AlertTriangle className="w-4 h-4 text-amber-600 mr-2 shrink-0" />
                <span>{t('sdCustomerNote')}: {order.notes}</span>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Only offered when the last page read was full — otherwise there is
          nothing older to show. */}
      {!loading && feed.hasMore && (
        <div className="text-center space-y-2">
          <button
            type="button"
            onClick={feed.loadOlder}
            disabled={feed.loadingOlder}
            className="px-5 py-2.5 rounded-2xl bg-white border border-gray-200 text-xs font-black text-gray-700 hover:border-orange-400 hover:text-orange-600 shadow-sm disabled:opacity-60"
          >
            {feed.loadingOlder ? t('sdLoadingOlder') : t('sdShowOlder')}
          </button>
          {feed.olderError && <p role="alert" className="text-xs font-bold text-red-600">{t('sdOlderFailed')}</p>}
        </div>
      )}
      </>
      )}

      {/* Official Tax Invoice Modal */}
      <InvoiceModal
        isOpen={!!selectedInvoiceOrder}
        onClose={() => setSelectedInvoiceOrder(null)}
        order={selectedInvoiceOrder}
      />

      {/* Payment Receipt Modal */}
      <ReceiptModal
        isOpen={!!selectedReceiptOrder}
        onClose={() => setSelectedReceiptOrder(null)}
        order={selectedReceiptOrder}
      />

      {/* A4 Employee Production Work Order Modal (No Prices) */}
      <ProductionWorkOrderModal
        isOpen={!!selectedWorkOrder}
        onClose={() => setSelectedWorkOrder(null)}
        order={selectedWorkOrder}
      />

      {/* Packing slip / delivery note — goes in the box. */}
      <PackingSlipModal
        isOpen={!!selectedPackingSlip}
        onClose={() => setSelectedPackingSlip(null)}
        order={selectedPackingSlip}
      />

      {/* Large Design Attachment Preview Lightbox Modal */}
      <DesignAttachmentModal
        isOpen={!!selectedDesignModalItem}
        onClose={() => setSelectedDesignModalItem(null)}
        fileUrl={selectedDesignModalItem?.fileUrl}
        fileName={selectedDesignModalItem?.fileName}
        fileType={selectedDesignModalItem?.fileType}
        widthCm={selectedDesignModalItem?.widthCm}
        heightCm={selectedDesignModalItem?.heightCm}
        productName={selectedDesignModalItem?.productName}
        orderId={selectedDesignModalItem?.orderId}
        previews={selectedDesignModalItem?.previews}
      />
      </div>
    </div>
    </div>
  );
}
