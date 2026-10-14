import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../App';
import { UserProfile, UserRole } from '../types';
import LegalPagesAdmin from '../components/Admin/LegalPagesAdmin';
import PrintSettingsAdmin from '../components/Admin/PrintSettingsAdmin';
import ProductsAdmin from '../components/Admin/ProductsAdmin';
import PrintingFieldsAdmin from '../components/Admin/PrintingFieldsAdmin';
import SiteCustomizerAdmin from '../components/Admin/SiteCustomizerAdmin';
import IntegrationsAdmin from '../components/Admin/IntegrationsAdmin';
import GoogleHubAdmin from '../components/Admin/GoogleHubAdmin';
import InquiriesAdmin from '../components/Admin/InquiriesAdmin';
import CategoryAdmin from '../components/Admin/CategoryAdmin';
import CouponsLoyaltyAdmin from '../components/Admin/CouponsLoyaltyAdmin';
import OrdersAdmin, { type OrdersPreset } from '../components/Admin/OrdersAdmin';
import PaymentBadge from '../components/PaymentBadge';
import { isOnDeliveryOpen } from '../lib/orderQueue';
import StageBadge from '../components/StageBadge';
import ShippingAdmin from '../components/Admin/ShippingAdmin';
import { useOrderFeed } from '../lib/useOrderFeed';
import { formatDateTime } from '../lib/dateFormat';
// Lazy: this screen pulls in recharts and its d3 dependencies. Imported
// eagerly they would land in the chunk every SHOPPER downloads, to draw charts
// only an admin ever sees.
const ReportsAdmin = React.lazy(() => import('../components/Admin/ReportsAdmin'));
// The overview's charts (recharts) load with it, not with the dashboard's first paint.
const DashboardInsights = React.lazy(() => import('../components/Admin/DashboardInsights'));
// Lazy for the same reason: an import screen the owner opens a few times a
// year has no business in the bundle every visitor downloads.
const SupplierImportAdmin = React.lazy(() => import('../components/Admin/SupplierImportAdmin'));
const MediaLibrary = React.lazy(() => import('../components/Admin/MediaLibrary'));
const SupplierPicker = React.lazy(() => import('../components/Admin/SupplierPicker'));
// Lazy: it opens the online designer (fabric) in the owner's mode.
const DesignTemplatesAdmin = React.lazy(() => import('../components/Admin/DesignTemplatesAdmin'));
import UserManagementAdmin from '../components/Admin/UserManagementAdmin';
import NeumorphicSidebar, { NEO } from '../components/NeumorphicSidebar';
import { useSiteSettings, useLiveSiteSettings } from '../context/SiteSettingsContext';
import {
  BarChart3,
  LayoutDashboard,
  ShoppingBag,
  Users, 
  Printer, 
  Settings, 
  Truck,
  Package,
  Sliders,
  Palette,
  KeyRound,
  Inbox,
  Megaphone,
  Layers,
  Tag,
  Coins,
  ShieldAlert, 
  ShieldCheck, 
  UserCheck, 
  UserPlus, 
  CheckCircle2, 
  Sparkles, 
  Search, 
  Edit, 
  Trash2,
  DollarSign,
  TrendingUp,
  FileText,
  Download,
  Image as ImageIcon,
  LayoutTemplate,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { logoSrc } from '../lib/brandLogo';
import { StaffPermissions } from '../types';

/**
 * SCREENS THAT ARE BUILT BUT NOT SHOWN.
 *
 * Put a tab id in here and it disappears from the dashboard — from the sidebar
 * AND from the panel area, so a stale link or a leftover tab in state cannot
 * reach it either. Take the id out again and it is back, exactly as it was.
 * Nothing is deleted: the screens, their endpoints and their translations all
 * stay in the build.
 *
 * Emptied on 2026-09-12 at the owner's request, for three screens he did not
 * want his own client to see yet:
 *   supplierImport — mid-build, and it will be rebuilt for four more suppliers
 *   reports        — every figure reads 0 because the shop has no paid order yet
 *   google         — nothing is connected, so it advertises what it cannot do
 *
 * GOOGLE CAME BACK on 2026-09-13, because the client asked for it by name
 * ("Where is Google? There is no Drive, GOOGLE ADS, SEO") and because the reason
 * it was hidden was addressed rather than waived. An audit of all six rooms
 * behind it found four honest and two not:
 *   · robots & sitemap is finished and live — /robots.txt matches the code and
 *     /sitemap.xml carries 42 real URLs. It needs nothing from anybody.
 *   · Page text works server-side; a crawler gets the title the owner typed.
 *   · Ads & Analytics is a settings screen with nothing to lie about until an id
 *     is pasted — and the badge that would then have said "Connected" over a
 *     format check now says what is actually known.
 *   · Search Console printed an emerald GOOGLE VERIFIED on the UNSAVED box, one
 *     keystroke in. Fixed: it reports the saved value and never claims Google
 *     checked anything.
 *   · Drive showed a green tick and "Filing to <account>" directly under its own
 *     red "Not working". Fixed: the success card requires a healthy connection.
 *   · Shopping would have published 33 products at 201.25 SEK against a page
 *     showing 161.00 — a 25% mismatch Merchant Center suspends accounts over,
 *     while the warning box said the two agreed. The feed stays locked until the
 *     shop decides which figure a crawler sees.
 *
 * The other two stay hidden, and for their original reasons.
 *
 * To put one back: delete its line. That is the whole procedure.
 */
// 'reports' came back on 2026-10-07: the shop has paid orders now, and the
// overview's insights link to it ("the dashboard is incomplete").
const HIDDEN_ADMIN_TABS = new Set<string>([
  'supplierImport',
]);

export default function AdminDashboardPage() {
  const { t } = useAuth();
  const { settings: siteSettings } = useSiteSettings();
  // The settings LIVE here (the shop's visitors read the server's copy) — an edit
  // made in another tab shows at once, as it always did.
  useLiveSiteSettings();

  const [activeTab, setActiveTab] = useState<'overview' | 'orders' | 'shipping' | 'users' | 'categories' | 'couponsLoyalty' | 'products' | 'printingFields' | 'siteCustomizer' | 'printSettings' | 'legalPages' | 'integrations' | 'google' | 'marketing' | 'inquiries' | 'reports' | 'supplierImport' | 'media' | 'supplierPicker' | 'designTemplates'>('overview');
  
  // Data State
  const [users, setUsers] = useState<UserProfile[]>([]);
  // ONE live listener for the whole dashboard (src/lib/useOrderFeed.ts): the
  // overview's latest orders and the Orders tab share it. The overview used to
  // read the same 200 orders again, and the Orders tab opened a new listener —
  // 200 more billed reads — every time it was shown.
  const orderFeed = useOrderFeed();
  const orders = orderFeed.orders;
  // All-time aggregates from the server. null until it answers, or if it cannot.
  const [stats, setStats] = useState<any | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // User role modal / inline edit
  const [editingUserId, setEditingUserId] = useState<string | null>(null);

  /**
   * THE TILES OPEN THE ORDERS BEHIND THEM — "more details", the client's item 1.
   * A fresh object every click, so clicking the same tile twice still re-applies
   * its filter after he changed it by hand.
   */
  const [ordersPreset, setOrdersPreset] = useState<OrdersPreset | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  // The "Staff Members" tile opens the users it counted (staff and production).
  const [usersRole, setUsersRole] = useState<string | null>(null);
  const openOrders = (preset: OrdersPreset) => {
    setOrdersPreset({ ...preset });
    setOpenOrderId(null);
    setActiveTab('orders');
  };
  const openOrder = (id: string) => {
    setOrdersPreset({ stage: 'all', payment: 'all' });
    setOpenOrderId(id);
    setActiveTab('orders');
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch Users
        const usersSnap = await getDocs(collection(db, 'users'));
        const usersData = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
        
        // Show real users exactly as stored — no mock users, no injected admin email.
        setUsers(usersData);

        // THE TILES COME FROM THE SERVER, over ALL TIME.
        //
        // They used to be computed in the browser from the newest 200 order
        // documents. "Total Revenue" was therefore never total — it was the last
        // 200 orders, and the moment this shop passed that number the figure the
        // owner circled and asked us to reset would start quietly losing money
        // again, with nothing on screen to say so. It also cost one billed
        // Firestore read per order, per visit to any admin tab.
        //
        // /api/admin/reports has no cap, is field-masked, caches for five
        // minutes and already computes exactly these numbers — correctly, with
        // refunds subtracted and test payments excluded.
        try {
          const token = await auth.currentUser?.getIdToken().catch(() => null);
          const resp = await fetch(`/api/admin/reports?slim=1&from=2000-01-01&to=${new Date().toISOString().slice(0, 10)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (resp.ok) setStats(await resp.json());
        } catch {
          // Falls through to the order-based tiles below.
        }

        // The orders themselves come from orderFeed (above), which the tiles
        // fall back to when the reports endpoint is unavailable.

      } catch (err) {
        console.warn('Error loading admin data:', err);
      } finally {
        setLoadingData(false);
      }
    };

    fetchData();
  }, []);

  const handleRoleChange = async (uid: string, newRole: UserRole) => {
    try {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { role: newRole }, { merge: true });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    } catch (err) {
      console.error('Error updating user role:', err);
      alert(t('umChangeFailed'));
    }
  };

  const handleStatusToggle = async (uid: string, currentStatus: 'active' | 'suspended') => {
    const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
    try {
      const userRef = doc(db, 'users', uid);
      await setDoc(userRef, { status: nextStatus }, { merge: true });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, status: nextStatus } : u));
    } catch (err) {
      console.error('Error updating user status:', err);
      alert(t('umChangeFailed'));
    }
  };

  const handlePermissionToggle = async (uid: string, permKey: keyof StaffPermissions) => {
    const targetUser = users.find(u => u.uid === uid);
    if (!targetUser) return;

    // A MISSING permissions map means no permissions, not all of them.
    //
    // Promoting a customer with the Role dropdown writes only { role: 'staff' },
    // so the map is absent — and this used to invent one with four trues. The
    // chips then showed four green permissions the staff dashboard, which tests
    // for === true, did not actually grant. Worse, clicking ONE chip rebuilt the
    // whole invented object and wrote three unrelated permissions as true for
    // real. Defaulting to false makes the chips tell the truth, and the write
    // below names one key so a click can only ever change the one it is on.
    const currentPermissions: StaffPermissions = targetUser.permissions || {
      canManageCategories: false,
      canManageProducts: false,
      canManageOrders: false,
      canManageSiteCustomizer: false,
      canManagePrintSettings: false,
    };

    const nextValue = !currentPermissions[permKey];
    const updatedPermissions: StaffPermissions = { ...currentPermissions, [permKey]: nextValue };

    try {
      const userRef = doc(db, 'users', uid);
      // One key, by field path — not the whole rebuilt map.
      await updateDoc(userRef, { [`permissions.${permKey}`]: nextValue });
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, permissions: updatedPermissions } : u));
    } catch (err) {
      console.error('Error updating staff permission:', err);
      alert(t('umChangeFailed'));
    }
  };

  return (
    // The soft-UI shell from the client's reference video: a grey surface that
    // everything else appears pressed out of, with the neumorphic sidebar as
    // the navigation instead of the old tab strip.
    <div className={cn('min-h-screen', NEO.page)}>
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex items-start gap-6">
      <NeumorphicSidebar
        title={siteSettings.siteName || 'ReklamX'}
        tagline="Admin Panel"
        logoUrl={logoSrc(siteSettings)}
        activeId={activeTab}
        onSelect={(id) => {
          // A tile's filter, or the order a "Latest orders" row opened, belongs
          // to that click. Kept, every later visit to Orders from here re-opened
          // the same order or came up still filtered to that tile.
          setOrdersPreset(null);
          setOpenOrderId(null);
          setUsersRole(null);
          setActiveTab(id as typeof activeTab);
        }}
        sections={([
          {
            label: 'Overview',
            items: [
              { id: 'overview', label: t('tabOverview'), icon: <LayoutDashboard /> },
            ],
          },
          {
            label: 'Catalog',
            items: [
              { id: 'products', label: t('tabProducts'), icon: <Package /> },
              { id: 'categories', label: t('navCategoriesShort'), icon: <Layers /> },
              { id: 'printingFields', label: t('navPrintingFields'), icon: <Sliders /> },
              { id: 'designTemplates', label: t('navDesignTemplates'), icon: <LayoutTemplate /> },
              { id: 'media', label: t('mlTitle'), icon: <ImageIcon /> },
              { id: 'supplierPicker', label: t('spTitle'), icon: <Download /> },
              { id: 'supplierImport', label: t('siNavLabel'), icon: <Download /> },
            ],
          },
          {
            label: 'Sales',
            items: [
              { id: 'orders', label: t('tabOrders'), icon: <ShoppingBag /> },
              // "There is no place to edit shipping prices and countries" — the
              // client's item 2.
              { id: 'shipping', label: t('tabShipping'), icon: <Truck /> },
              { id: 'reports', label: t('rpTitle'), icon: <BarChart3 /> },
              { id: 'couponsLoyalty', label: t('navCouponsLoyalty'), icon: <Tag /> },
            ],
          },
          {
            label: 'Site',
            items: [
              { id: 'siteCustomizer', label: 'UI Customizer', icon: <Palette /> },
              { id: 'printSettings', label: t('tabPrintRules'), icon: <Settings /> },
              { id: 'legalPages', label: t('navLegalPages'), icon: <ShieldCheck /> },
              { id: 'integrations', label: t('navIntegrations'), icon: <KeyRound /> },
              // One door for Ads, Analytics, Tag Manager, Search Console, the
              // page text, robots/sitemap, Shopping and Drive — the owner asked
              // for all of it in the dashboard, in one place.
              { id: 'google', label: 'Google', icon: <Megaphone /> },
            ],
          },
          {
            label: 'People',
            items: [
              { id: 'inquiries', label: t('navMessages'), icon: <Inbox /> },
              { id: 'users', label: t('tabUsers'), icon: <Users /> },
            ],
          },
        ]
          // Hidden tabs leave the sidebar, and a section that ends up empty
          // leaves with them rather than sitting there as a bare heading.
          .map((sec) => ({ ...sec, items: sec.items.filter((i) => !HIDDEN_ADMIN_TABS.has(i.id)) }))
          .filter((sec) => sec.items.length > 0))}
      />

      <div className="flex-1 min-w-0 space-y-8">
      {/* Admin Title & Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div>
          <div className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-full mb-2">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            {t('adminTitle')}
          </div>
          {/* Sized down on narrow screens: the Swedish and Danish adminTitle is
              "Central Administrationspanel", whose 20-character second word cannot
              break and ran straight out of the card on a phone at text-3xl. */}
          <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-gray-900 break-words">
            {t('adminTitle')}
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {t('adminSubtitle')}
          </p>
        </div>

        {/* Navigation moved into the neumorphic sidebar — the tab strip that
            lived here is gone, the activeTab state is unchanged. */}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <button
              type="button"
              onClick={() => openOrders({ payment: 'paid' })}
              className="text-left w-full bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
            >
              <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl w-fit mb-3">
                <DollarSign className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-gray-400">{t('totalRevenue')}</p>
              {/* Real revenue: paid orders only. This tile used to read a
                  hardcoded 45,230 SEK regardless of what the shop had sold.
                  Then it read 65,020 SEK, which was five test payments — the
                  owner asked why, and he was right to. Three rules now:

                  1. Test-mode orders never count. A Mollie test key produces a
                     perfectly ordinary paid order; nothing but paymentMode
                     separates it from money.
                  2. Refunds come off. A PARTIAL refund leaves paymentStatus at
                     'paid' and only moves refundedAmount, so filtering on
                     status alone overstates income.
                  3. The filtering happens here, in JS, on the already-fetched
                     array — never as a Firestore where(). An inequality filter
                     excludes documents that LACK the field, and a real order
                     whose Mollie call failed never gets a paymentMode at all. */}
              <p className="text-2xl font-black text-gray-900 mt-1">
                {(stats
                  ? Number(stats.totals?.grossRevenue) || 0
                  : orders
                    .filter((o: any) => o.paymentStatus === 'paid' && o.paymentMode !== 'test')
                    .reduce(
                      (sum: number, o: any) =>
                        sum + (Number(o.grossTotal ?? o.totalAmount) || 0) - (Number(o.refundedAmount) || 0),
                      0,
                    )
                ).toLocaleString('sv-SE', { maximumFractionDigits: 0 })} SEK
              </p>
            </button>

            <button
              type="button"
              onClick={() => openOrders({ stage: 'active', sort: 'dueDate' })}
              className="text-left w-full bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
            >
              <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl w-fit mb-3">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-gray-400">{t('activeOrders')}</p>
              {/* "Active" used to mean orders.length — every document the query
                  returned, which included six abandoned checkouts Mollie had
                  marked expired and one test order from three weeks ago. An
                  active order is one that has been paid for and is not yet
                  finished; that is the number a workshop plans its day around. */}
              <p className="text-2xl font-black text-gray-900 mt-1">
                {stats
                  ? (stats.byStatus ?? [])
                    .filter((r: any) => !['completed', 'cancelled'].includes(r.key))
                    .reduce((n: number, r: any) => n + (Number(r.count) || 0), 0)
                  : orders.filter((o: any) =>
                    ((o.paymentStatus === 'paid' && o.paymentMode !== 'test') || isOnDeliveryOpen(o))
                    && !['completed', 'cancelled'].includes(o.status),
                  ).length}
              </p>
            </button>

            <button
              type="button"
              onClick={() => { setUsersRole('team'); setActiveTab('users'); }}
              className="text-left w-full bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
            >
              <div className="p-3 bg-green-50 text-green-600 rounded-2xl w-fit mb-3">
                <Users className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-gray-400">{t('staffMembers')}</p>
              <p className="text-2xl font-black text-gray-900 mt-1">
                {users.filter(u => u.role === 'staff' || u.role === 'production').length}
              </p>
            </button>

            <button
              type="button"
              onClick={() => openOrders({ stage: 'production', sort: 'priority' })}
              className="text-left w-full bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all cursor-pointer"
            >
              <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl w-fit mb-3">
                <Printer className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-gray-400">{t('printerLoad')}</p>
              {/* Orders actually on the press right now. The old 82% was a
                  literal — it never moved, whatever the workshop was doing.
                  Test orders are excluded here too, or the four tiles tell four
                  different stories about the same eleven documents. */}
              <p className="text-2xl font-black text-gray-900 mt-1">
                {stats
                  ? (stats.byStatus ?? [])
                    .filter((r: any) => ['in_design', 'in_print', 'finishing'].includes(r.key))
                    .reduce((n: number, r: any) => n + (Number(r.count) || 0), 0)
                  : orders.filter((o: any) =>
                    ((o.paymentStatus === 'paid' && o.paymentMode !== 'test') || isOnDeliveryOpen(o))
                    && ['in_design', 'in_print', 'finishing'].includes(o.status),
                  ).length}
              </p>
            </button>
          </div>

          {/* The insights the owner asked for (2026-10-07) — figures vs the period
              before, revenue and orders over time, a goal, the categories. */}
          <React.Suspense fallback={<div className="h-40 rounded-3xl bg-white border border-gray-100 animate-pulse" />}>
            <DashboardInsights onOpenReports={() => setActiveTab('reports')} />
          </React.Suspense>

          {/* LATEST ORDERS — the overview had four numbers and nothing to open. */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-gray-900">{t('oaLatestOrders')}</h3>
              <button type="button" onClick={() => openOrders({ stage: 'all', payment: 'all' })} className="text-xs font-black text-blue-600 hover:text-blue-800">
                {t('oaSeeAll')} →
              </button>
            </div>
            {orders.length === 0 ? (
              <p className="px-6 py-8 text-center text-xs font-bold text-gray-400">
                {orderFeed.loading ? t('rpLoading') : orderFeed.error ? t('caLoadFailed') : t('oaNoOrdersYet')}
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {orders.slice(0, 6).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => openOrder(o.id)}
                    className="w-full text-left px-6 py-3 hover:bg-blue-50/40 transition-colors flex flex-wrap items-center gap-x-4 gap-y-1"
                  >
                    <span className="font-black text-gray-900 text-sm tabular-nums">{o.id}</span>
                    <span className="text-xs font-bold text-gray-600 flex-1 min-w-[8.75rem] truncate">{o.customerName || o.customerEmail}</span>
                    <span className="text-[0.6875rem] font-bold text-gray-400">{o.createdAt ? formatDateTime(o.createdAt) : ''}</span>
                    <span className="text-xs font-black text-gray-900 tabular-nums">
                      {o.grossTotal != null ? `${Number(o.grossTotal).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} ${o.currency || 'SEK'}` : ''}
                    </span>
                    <PaymentBadge order={o} t={t} />
                    <StageBadge status={o.status} t={t} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'orders' && <OrdersAdmin feed={orderFeed} preset={ordersPreset} openOrderId={openOrderId} />}

      {activeTab === 'shipping' && <ShippingAdmin />}

      {activeTab === 'supplierImport' && !HIDDEN_ADMIN_TABS.has('supplierImport') && (
        <React.Suspense fallback={<div className="bg-white p-12 rounded-3xl border border-gray-100 text-center text-xs font-bold text-gray-400">{t('rpLoading')}</div>}>
          <SupplierImportAdmin />
        </React.Suspense>
      )}

      {activeTab === 'supplierPicker' && !HIDDEN_ADMIN_TABS.has('supplierPicker') && (
        <React.Suspense fallback={<div className="bg-white p-12 rounded-3xl border border-gray-100 text-center text-xs font-bold text-gray-400">{t('rpLoading')}</div>}>
          <SupplierPicker />
        </React.Suspense>
      )}

      {activeTab === 'designTemplates' && !HIDDEN_ADMIN_TABS.has('designTemplates') && (
        <React.Suspense fallback={<div className="bg-white p-12 rounded-3xl border border-gray-100 text-center text-xs font-bold text-gray-400">{t('rpLoading')}</div>}>
          <DesignTemplatesAdmin />
        </React.Suspense>
      )}

      {activeTab === 'media' && !HIDDEN_ADMIN_TABS.has('media') && (
        <React.Suspense fallback={<div className="bg-white p-12 rounded-3xl border border-gray-100 text-center text-xs font-bold text-gray-400">{t('rpLoading')}</div>}>
          <MediaLibrary />
        </React.Suspense>
      )}

      {activeTab === 'reports' && !HIDDEN_ADMIN_TABS.has('reports') && (
        <React.Suspense fallback={<div className="bg-white p-12 rounded-3xl border border-gray-100 text-center text-xs font-bold text-gray-400">{t('rpLoading')}</div>}>
          <ReportsAdmin />
        </React.Suspense>
      )}

      {/* Payments & API keys */}
      {activeTab === 'integrations' && (
        <IntegrationsAdmin />
      )}

      {/* Ads, Analytics, Tag Manager, Search Console, page text, robots &
          sitemap, Shopping and Drive. 'marketing' is kept as an alias so a
          bookmark or a saved tab from the old two-tab layout still lands
          somewhere sensible rather than on a blank screen. */}
      {(activeTab === 'google' || activeTab === 'marketing') && !HIDDEN_ADMIN_TABS.has('google') && <GoogleHubAdmin />}

      {/* Contact-form messages */}
      {activeTab === 'inquiries' && <InquiriesAdmin />}

      {/* Users & Staff Permissions Tab */}
      {activeTab === 'users' && (
        <UserManagementAdmin key={usersRole ?? 'all'} initialRole={usersRole ?? undefined} />
      )}

      {/* Categories Management Tab */}
      {activeTab === 'categories' && (
        <CategoryAdmin />
      )}

      {/* Coupons & Loyalty Tab (Main Admin Exclusive) */}
      {activeTab === 'couponsLoyalty' && (
        <CouponsLoyaltyAdmin />
      )}

      {/* Products Tab */}
      {activeTab === 'products' && (
        <ProductsAdmin />
      )}

      {/* Site Customizer & Theme Tab */}
      {activeTab === 'siteCustomizer' && (
        <SiteCustomizerAdmin />
      )}

      {/* Printing Fields Management Tab */}
      {activeTab === 'printingFields' && (
        <PrintingFieldsAdmin />
      )}

      {/* Custom Rules & Settings Tab */}
      {activeTab === 'legalPages' && (
        <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <LegalPagesAdmin />
        </div>
      )}

      {activeTab === 'printSettings' && (
        <PrintSettingsAdmin />
      )}
      </div>
    </div>
    </div>
  );
}
