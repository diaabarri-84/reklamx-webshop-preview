import React, { useState, useEffect } from 'react';
import { previewOf } from '../lib/designFileSpecs';
import { collection, query, where, getDocs, doc, setDoc, getDoc, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../App';
import { useSiteSettings } from '../context/SiteSettingsContext';
import NeumorphicSidebar, { NEO } from '../components/NeumorphicSidebar';
import { STAGE_PILL } from '../components/StageBadge';
import { Order, UserProfile } from '../types';
import { triggerFileDownload } from '../lib/downloadHelper';
import { shipmentStatusKey } from '../lib/shipmentStatus';
import ArtworkUploadBox from '../components/ArtworkUploadBox';
import OrderDesignLater from '../components/OrderDesignLater';
import { cleanDesignLaterMarker } from '../lib/designLater';
import { useConfirmDialog } from '../components/ConfirmDialog';
import { tierForSpend } from '../lib/loyalty';
import OrderTrackingVisualizer, { getStepIndexForStatus, getEstimatedCompletionTime } from '../components/OrderTrackingVisualizer';
// Dates a CUSTOMER reads follow the shop language they chose — never the locale
// of the machine they happen to be sitting at. See src/lib/dateFormat.ts.
import { formatDate, formatDateTime, formatShortDate, formatTime, localeFor } from '../lib/dateFormat';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Award,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Download,
  FileText,
  FileUp,
  Gift,
  HelpCircle,
  History,
  Key,
  Mail,
  MapPin,
  PackageCheck,
  Phone,
  Play,
  Printer,
  Radio,
  Receipt,
  RefreshCw,
  Ruler,
  Save,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  TrendingUp,
  Truck,
  UploadCloud,
  User,
  X,
  Zap,
  PenTool,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../lib/utils';
import { logoSrc } from '../lib/brandLogo';
import { Link } from 'react-router-dom';
import InvoiceModal from '../components/InvoiceModal';
import CreditNoteModal, { type CreditNoteDoc } from '../components/CreditNoteModal';
import ReceiptModal from '../components/ReceiptModal';
import { isOnDeliveryOpen, paymentTitleOf } from '../lib/orderQueue';

const PAY_STATUS_KEYS = {
  paid: 'custPayStatusPaid',
  unpaid: 'custPayStatusUnpaid',
  pending: 'custStepStatePending',
  refunded: 'docRefunded',
  failed: 'custPayStatusFailed',
  canceled: 'shipStatusCancelled',
  expired: 'custPayStatusExpired',
  chargeback: 'custPayStatusChargeback',
} as const;

export default function CustomerDashboard() {
  // 4.26 — the rates the owner set, off the context. They were constants here.
  const { user, t, formatMoney, language, loyalty } = useAuth();
  // window.alert is silenced by the browser switch that also silences confirm,
  // and a Download button that reports nothing at all is how the owner came to
  // believe features were dead. See src/components/ConfirmDialog.tsx.
  const { notify, dialog: noticeDialog } = useConfirmDialog();
  const { settings: siteSettings } = useSiteSettings();

  // 4.25 — the tier follows LIFETIME SPEND. The stored value is preferred: the
  // server writes it on every paid order. Computed here when it is absent, so an
  // account that has not ordered since this landed still reads correctly rather
  // than being silently demoted to Silver.
  const lifetimeSpend = Math.max(0, Number((user as any)?.lifetimeSpend) || 0);
  const tier = (user?.loyaltyTier as 'Silver' | 'Gold' | 'Platinum' | undefined)
    || tierForSpend(lifetimeSpend, loyalty);
  const [activeTab, setActiveTab] = useState<'track' | 'orders' | 'files' | 'loyalty' | 'profile'>('track');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  /*
   * WHY A FAILURE HAS TO LOOK DIFFERENT FROM AN EMPTY SHELF.
   *
   * Both listeners caught their errors, logged a warning, set their slice to []
   * and published — so a Firestore outage, a rules change or an expired token
   * rendered a paying customer's order history as the cheerful "No orders yet"
   * empty state. No spinner, no error, nothing to retry: the shop simply told
   * someone who had bought from it that they never had.
   *
   * Counted rather than flagged, because ONE listener failing is normal here
   * (the customerAccountId query has no composite index and the comment below
   * explains why it must not have one). Only when BOTH have failed is there
   * genuinely nothing behind the screen.
   */
  const [ordersFailed, setOrdersFailed] = useState(false);

  // Document Modal States
  const [selectedInvoiceOrder, setSelectedInvoiceOrder] = useState<Order | null>(null);
  // The customer's own credit notes, keyed by the order they credit. Loaded once
  // beside the orders rather than per card: a customer with twenty orders would
  // otherwise make twenty queries to show a button on one of them.
  const [creditNotesByOrder, setCreditNotesByOrder] = useState<Record<string, CreditNoteDoc[]>>({});
  const [selectedCreditNote, setSelectedCreditNote] = useState<CreditNoteDoc | null>(null);
  const [selectedReceiptOrder, setSelectedReceiptOrder] = useState<Order | null>(null);

  // Track Order State
  const [searchOrderId, setSearchOrderId] = useState('ORD-2026-8801');
  const [searchedOrder, setSearchedOrder] = useState<Order | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Profile Form State
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [accountType, setAccountType] = useState<'individual' | 'business'>(user?.accountType || 'individual');
  const [companyName, setCompanyName] = useState(user?.companyName || '');
  const [taxNumber, setTaxNumber] = useState(user?.taxNumber || '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [postcode, setPostcode] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('Sverige');
  const [email, setEmail] = useState(user?.email || '');
  const [billingEmail, setBillingEmail] = useState('');
  const [phone, setPhone] = useState(user?.phone || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [notifyCampaigns, setNotifyCampaigns] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSavedSuccess, setProfileSavedSuccess] = useState(false);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName || '');
      const parts = (user.displayName || '').split(' ');
      // Prefer the stored names; fall back to splitting the display name only
      // when they have never been saved.
      setFirstName(user.firstName || parts[0] || '');
      setLastName(user.lastName || parts.slice(1).join(' ') || '');
      setAccountType(user.accountType || 'individual');
      setCompanyName(user.companyName || '');
      setTaxNumber(user.taxNumber || '');
      setEmail(user.email || '');
      setPhone(user.phone || '');
      // These are all written by the save below. Not loading them meant the form
      // opened empty on every visit, and saving anything at all — a new phone
      // number, a company name — wrote those blanks over the customer's address.
      setAddress1(user.address1 || '');
      setAddress2(user.address2 || '');
      setPostcode(user.postcode || '');
      setCity(user.city || '');
      setCountry(user.country || 'Sverige');
      setBillingEmail(user.billingEmail || '');
      setNotifyCampaigns(Boolean(user.notifyCampaigns));
    }
  }, [user]);

  /**
   * The customer's orders, live.
   *
   * TWO listeners, not one, and this is the whole reason a paying customer saw
   * "No orders yet":
   *
   *   userId            — the account that was PROVEN by an ID token at checkout.
   *   customerAccountId — the account this order belongs to, which the server
   *                       also fills in by matching the email on a guest
   *                       checkout.
   *
   * Order 202600002 was paid for by a registered customer whose browser sent no
   * token, so it was stored as `guest-202600002`; a query on userId alone could
   * never find it, and the dashboard told them they had never ordered anything.
   * Old orders carry only userId, new ones carry both, so both are watched and
   * the results merged by id.
   */
  useEffect(() => {
    if (!user) return;
    setLoadingOrders(true);

    // Each listener owns its own slice; a merge of the two is what reaches state,
    // so one arriving late cannot wipe the other's rows.
    const byField: Record<string, Order[]> = { userId: [], customerAccountId: [] };
    const failed = new Set<string>();

    const publish = () => {
      const merged = new Map<string, Order>();
      for (const list of Object.values(byField)) {
        for (const order of list) merged.set(order.id, order);
      }
      const data = [...merged.values()].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setOrders(data);
      setLoadingOrders(false);
      // Only a total blackout is an error worth showing. If either query
      // answered, what the customer sees is real, whether or not it is empty.
      setOrdersFailed(failed.size === 2 && data.length === 0);
    };

    /**
     * Only the userId query sorts in Firestore.
     *
     * A filter on one field plus a sort on another needs a COMPOSITE index, and
     * an undeployed index does not degrade — the query throws. The userId one is
     * declared and deployed already; adding a second would mean the fix does
     * nothing until somebody runs `firebase deploy --only firestore:indexes`,
     * which is exactly the sort of hidden step that leaves a customer staring at
     * an empty dashboard. An equality filter on its own rides the automatic
     * single-field index, so the second listener simply does not sort and the
     * merge below orders everything by date anyway.
     */
    const listen = (field: 'userId' | 'customerAccountId') =>
      onSnapshot(
        query(
          collection(db, 'orders'),
          where(field, '==', user.uid),
          ...(field === 'userId' ? [orderBy('createdAt', 'desc')] : []),
          limit(100),
        ),
        (snapshot) => {
          byField[field] = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Order));
          publish();
        },
        (err) => {
          // A missing composite index fails ONE of the two queries; the other
          // still delivers, so this must not clear the list.
          console.warn(`Could not load orders by ${field}:`, err);
          byField[field] = [];
          failed.add(field);
          publish();
        },
      );

    const unsubscribers = [listen('userId'), listen('customerAccountId')];
    return () => unsubscribers.forEach((off) => off());
  }, [user]);

  /**
   * The customer's own credit notes.
   *
   * Read the same two ways the orders are, because a guest checkout that later
   * matched an account carries customerAccountId and not userId — a note read by
   * one field only would be invisible on exactly the orders that most need it.
   * firestore.rules allows both.
   *
   * One query for all of them, grouped by order here. Twenty orders must not
   * become twenty queries to show a button on one.
   */
  useEffect(() => {
    if (!user?.uid) { setCreditNotesByOrder({}); return; }
    let cancelled = false;

    const load = async () => {
      const byOrder: Record<string, CreditNoteDoc[]> = {};
      for (const field of ['userId', 'customerAccountId'] as const) {
        try {
          const snap = await getDocs(query(collection(db, 'creditNotes'), where(field, '==', user.uid), limit(100)));
          for (const d of snap.docs) {
            const note = d.data() as CreditNoteDoc;
            const list = byOrder[note.orderId] ?? [];
            // Both queries can return the same document; the number is its id.
            if (!list.some((n) => n.creditNoteNumber === note.creditNoteNumber)) list.push(note);
            byOrder[note.orderId] = list;
          }
        } catch (err) {
          // A missing document or a rule refusal must not take the dashboard
          // down — the orders themselves are the point of this screen.
          console.warn(`Could not load credit notes by ${field}:`, err);
        }
      }
      for (const list of Object.values(byOrder)) {
        list.sort((a, b) => String(a.issuedAt).localeCompare(String(b.issuedAt)));
      }
      if (!cancelled) setCreditNotesByOrder(byOrder);
    };

    void load();
    return () => { cancelled = true; };
  }, [user]);

  // Sync initial searchedOrder when orders load
  useEffect(() => {
    if (orders.length > 0 && !searchedOrder) {
      setSearchedOrder(orders[0]);
      setSearchOrderId(orders[0].id);
    }
  }, [orders]);

  // Handler for track order lookup
  const handleTrackOrderSearch = async (targetId?: string) => {
    const term = (targetId !== undefined ? targetId : searchOrderId).trim();
    if (!term) return;

    setSearchLoading(true);
    setSearchError(null);

    // 1. Check in loaded orders list
    const foundInList = orders.find(o => o.id.toLowerCase() === term.toLowerCase());
    if (foundInList) {
      setSearchedOrder(foundInList);
      setSearchLoading(false);
      return;
    }

    // 2. Try Firestore lookup
    try {
      const docRef = doc(db, 'orders', term);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const oData = { id: snap.id, ...snap.data() } as Order;
        setSearchedOrder(oData);
        setSearchLoading(false);
        return;
      }

      const q = query(collection(db, 'orders'), where('id', '==', term));
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        const oData = { id: qSnap.docs[0].id, ...qSnap.docs[0].data() } as Order;
        setSearchedOrder(oData);
        setSearchLoading(false);
        return;
      }
    } catch (e) {
      console.warn('Firestore order lookup notice:', e);
    }

    // Not found — never fabricate a fake order. Only real orders (that belong to the
    // signed-in customer) are ever shown; Firestore rules also enforce this.
    setSearchError(t('custOrderNotFound'));
    setSearchedOrder(null);
    setSearchLoading(false);
  };

  /**
   * The "Advance status (simulate)" button that used to live on the tracker is
   * gone, and the handler that backed it with it: the owner asked for the
   * customer to SEE the stages and nothing more. Production moves a job from the
   * Stage dropdown on the staff card, and the auto-stage sweep in server.ts moves
   * it when nobody does.
   */

  const handleUpdateProfile = async () => {
    if (!user) return;
    // A stand-in profile (the database did not answer): its blanks must never be
    // saved over the customer's real address, company and phone.
    if (user.profileUnavailable) {
      setProfileError(t('custProfileUnavailableSave'));
      return;
    }
    setSavingProfile(true);
    setProfileSavedSuccess(false);
    setProfileError(null);

    try {
      // The password fields were decorative: the values were captured into state
      // and never used, while the form reported "Saved!". Someone who changed
      // their password here and signed out could not get back in with the new
      // one, because nothing had changed.
      if (password || confirmPassword) {
        if (password !== confirmPassword) {
          setProfileError(t('custPasswordMismatch'));
          setSavingProfile(false);
          return;
        }
        if (password.length < 8) {
          setProfileError(t('custPasswordTooShort'));
          setSavingProfile(false);
          return;
        }
        try {
          const { updatePassword } = await import('firebase/auth');
          await updatePassword(auth.currentUser!, password);
          setPassword('');
          setConfirmPassword('');
        } catch (err: any) {
          // Firebase refuses a password change on an old session, which is the
          // right thing for it to do — say so instead of failing silently.
          setProfileError(
            err?.code === 'auth/requires-recent-login'
              ? t('custPasswordRecentLogin')
              : t('custPasswordChangeFailed'),
          );
          setSavingProfile(false);
          return;
        }
      }

      const computedName = `${firstName} ${lastName}`.trim() || displayName || user.email;
      const userRef = doc(db, 'users', user.uid);
      await setDoc(userRef, {
        displayName: computedName,
        firstName,
        lastName,
        accountType,
        companyName: accountType === 'business' ? companyName : '',
        taxNumber: accountType === 'business' ? taxNumber : '',
        address1,
        address2,
        postcode,
        city,
        country,
        // `email` is deliberately not written. The security rules pin it to the
        // Firebase Auth identity, so a customer who edited this box had their
        // entire profile save rejected with a generic "Failed to update
        // profile" — losing the address and phone number they had just typed.
        // Changing a sign-in address is an Auth operation, not a profile edit.
        billingEmail,
        phone,
        notifyCampaigns,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      setProfileSavedSuccess(true);
      setTimeout(() => setProfileSavedSuccess(false), 4000);
    } catch (err: any) {
      console.error('Error updating profile:', err);
      setProfileError(err?.message || t('custProfileSaveFailed'));
    } finally {
      setSavingProfile(false);
    }
  };

  // The same colours as the shop's own order screens (StageBadge) — and a cancelled
  // order is red and SAYS "Cancelled" (it fell through to a grey, untranslated word).
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'cancelled':
      case 'canceled':
        return <span className={`px-3 py-1 ${STAGE_PILL.cancelled} rounded-full text-xs font-bold`} data-rx-stage="cancelled">{t('custStatusCancelled')}</span>;
      case 'pending':
      case 'placed':
        return <span className={`px-3 py-1 ${STAGE_PILL.pending} rounded-full text-xs font-bold`}>{t('custStatusPlaced')}</span>;
      case 'in_design':
      case 'processing':
        return <span className="px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-bold">{t('custStatusProcessing')}</span>;
      case 'in_print':
      case 'printing':
        return <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-bold flex items-center"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />{t('custStatusPrinting')}</span>;
      case 'finishing':
        return <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">{t('custStatusFinishing')}</span>;
      case 'shipped':
        return <span className="px-3 py-1 bg-indigo-100 text-indigo-800 rounded-full text-xs font-bold flex items-center"><Truck className="w-3 h-3 mr-1" />{t('custStatusShipped')}</span>;
      case 'completed':
        return <span className={`px-3 py-1 ${STAGE_PILL.completed} rounded-full text-xs font-bold flex items-center`}><CheckCircle2 className="w-3 h-3 mr-1" />{t('custStatusCompleted')}</span>;
      default:
        return <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-bold">{status}</span>;
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
        tagline={siteSettings.siteTagline || 'Din vision, vår expertis'}
        logoUrl={logoSrc(siteSettings)}
        activeId={activeTab}
        onSelect={(id) => setActiveTab(id as typeof activeTab)}
        sections={[
          {
            label: t('custSectionMyAccount'),
            items: [
              { id: 'track', label: t('custTabTrackOrder'), icon: <Search /> },
              { id: 'orders', label: t('custTabMyOrders'), icon: <ShoppingBag />, badge: orders.length || undefined },
              { id: 'files', label: t('custTabPrintFiles'), icon: <FileText /> },
              { id: 'loyalty', label: t('custTabLoyalty'), icon: <Coins />, badge: user?.loyaltyPoints ? `${user.loyaltyPoints}` : undefined },
            ],
          },
          {
            label: t('custSectionSettings'),
            items: [{ id: 'profile', label: t('custTabAccount'), icon: <User /> }],
          },
        ]}
      />

      <div className="flex-1 min-w-0">
      {/* Welcome Banner */}
      <div className="bg-white rounded-3xl p-6 md:p-8 border border-gray-100 shadow-sm mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 rounded-2xl bg-orange-600 text-white flex items-center justify-center font-black text-2xl shadow-lg shadow-orange-500/20 shrink-0">
            {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900">
              {t('custWelcomeBack').replace('{0}', user?.displayName || t('custDefaultCustomerName'))}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {user?.email} • {user?.accountType === 'business' ? t('custBusinessAccount') : t('custIndividualAccount')}
            </p>
          </div>
        </div>

        {/* Loyalty Quick Pill in Header */}
        <div className="flex items-center space-x-3 bg-amber-50 border border-amber-200/90 rounded-2xl p-3.5 shadow-2xs">
          <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm shrink-0">
            <Coins className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-black text-amber-900 uppercase tracking-wide">{t('custLoyaltyBalance')}</span>
              <span className="bg-amber-500 text-white text-[0.625rem] font-black px-2 py-0.5 rounded-full uppercase">
                {user?.loyaltyTier || 'Silver'} {t('custMemberLabel')}
              </span>
            </div>
            <p className="text-xl font-black text-amber-900">
              {user?.loyaltyPoints ?? 0} <span className="text-xs font-bold text-amber-700">PTS</span>
              <span className="text-xs font-semibold text-amber-600 ml-2">(= {((user?.loyaltyPoints ?? 0) / 10).toFixed(0)} {t('custKrDiscount')}</span>
            </p>
          </div>
        </div>

        <Link 
          to="/custom-upload" 
          className="bg-orange-600 text-white px-6 py-3 rounded-2xl font-bold text-sm hover:bg-orange-500 transition-all shadow-md shadow-orange-500/20 flex items-center shrink-0"
        >
          <UploadCloud className="w-4 h-4 mr-2" />
          {t('custNewCustomUpload')}
        </Link>
      </div>

      {/* Navigation moved into the neumorphic sidebar — the tab strip that
          lived here is gone, the activeTab state is unchanged. */}

      {/* Tab Content: Track Order */}
      {activeTab === 'track' && (
        <div className="space-y-8">
          {/* Search Hero Card */}
          <div className="bg-gradient-to-br from-gray-900 via-gray-900 to-orange-950 text-white rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border border-gray-800">
            <div className="absolute top-0 right-0 w-96 h-96 bg-orange-600/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10 max-w-2xl">
              <div className="flex items-center space-x-2 text-orange-400 text-xs font-black uppercase tracking-wider mb-2">
                <Radio className="w-4 h-4 animate-pulse text-orange-500" />
                <span>{t('custTrackEyebrow')}</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-black text-white">
                {t('custTrackHeroTitle')}
              </h2>
              <p className="text-sm text-gray-300 mt-1 leading-relaxed">
                {t('custTrackHeroSubtitle')}
              </p>

              {/* Form Input */}
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTrackOrderSearch();
                }}
                className="mt-6 flex flex-col sm:flex-row items-stretch gap-2"
              >
                <div className="relative flex-1">
                  <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input 
                    type="text"
                    value={searchOrderId}
                    onChange={(e) => setSearchOrderId(e.target.value)}
                    placeholder={t('custTrackPlaceholder')}
                    className="w-full bg-gray-800/90 border border-gray-700/80 rounded-2xl pl-11 pr-10 py-3.5 text-sm text-white placeholder-gray-400 font-mono focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all"
                  />
                  {searchOrderId && (
                    <button
                      type="button"
                      onClick={() => setSearchOrderId('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={searchLoading}
                  className="bg-orange-600 hover:bg-orange-500 text-white font-black px-6 py-3.5 rounded-2xl text-sm transition-all shadow-lg shadow-orange-600/30 flex items-center justify-center space-x-2 disabled:opacity-50 shrink-0 active:scale-95 cursor-pointer"
                >
                  {searchLoading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Search className="w-4 h-4" />
                  )}
                  <span>{t('custTrackButton')}</span>
                </button>
              </form>

              {/* Quick Select Recent Orders Pills */}
              {orders.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-400 font-bold">{t('custQuickSelect')}</span>
                  {orders.slice(0, 4).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => {
                        setSearchOrderId(o.id);
                        handleTrackOrderSearch(o.id);
                      }}
                      className={cn(
                        "px-3 py-1 rounded-xl text-xs font-mono font-bold transition-all border cursor-pointer",
                        searchedOrder?.id === o.id
                          ? "bg-orange-600 text-white border-orange-500 shadow-sm"
                          : "bg-gray-800/80 hover:bg-gray-700 text-gray-300 border-gray-700"
                      )}
                    >
                      {o.id}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Search Error Message */}
          {searchError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-xs font-bold flex items-center space-x-2">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          {/* Tracked Order View */}
          {searchedOrder && (
            <motion.div 
              key={searchedOrder.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              {/* Order Meta Header */}
              <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-2xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl font-black text-gray-900 font-mono">{searchedOrder.id}</span>
                    {getStatusBadge(searchedOrder.status)}
                  </div>
                  <p className="text-xs text-gray-500 mt-1.5 flex flex-wrap items-center gap-2">
                    <span>{t('custLabelCustomer')} <strong className="text-gray-800">{searchedOrder.customerName || t('custDefaultCustomerName')}</strong></span>
                    <span>•</span>
                    <span>{t('custOrderDateLabel')} <strong className="text-gray-800">{formatDate(searchedOrder.createdAt, localeFor(language))}</strong></span>
                    {searchedOrder.assignedStaffName && (
                      <>
                        <span>•</span>
                        <span className="text-orange-700 font-bold bg-orange-50 px-2.5 py-0.5 rounded-md border border-orange-200/60">
                          {t('custLabelTechnician')} {searchedOrder.assignedStaffName}
                        </span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-end md:items-center gap-3 shrink-0">
                  <div className="flex items-center space-x-2 space-x-reverse">
                    <button
                      onClick={() => setSelectedReceiptOrder(searchedOrder)}
                      className="px-3.5 py-2 bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-colors rounded-xl font-extrabold text-xs flex items-center space-x-1.5 space-x-reverse cursor-pointer shadow-2xs active:scale-95"
                      title={t('custViewReceiptTitle')}
                    >
                      <Receipt className="w-4 h-4 text-emerald-600" />
                      <span>{t('custReceipt')}</span>
                    </button>

                    <button
                      onClick={() => setSelectedInvoiceOrder(searchedOrder)}
                      className="px-3.5 py-2 bg-orange-50 text-orange-900 border border-orange-200 hover:bg-orange-100 transition-colors rounded-xl font-extrabold text-xs flex items-center space-x-1.5 space-x-reverse cursor-pointer shadow-2xs active:scale-95"
                      title={t('custViewInvoiceTitle')}
                    >
                      <FileText className="w-4 h-4 text-orange-600" />
                      <span>{t('custTaxInvoice')}</span>
                    </button>
                  </div>

                  <div className="text-right">
                    <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block">{t(searchedOrder.paymentStatus === 'paid' ? 'custTotalPaid' : 'custTotalAmount')}</span>
                    <span className="text-2xl font-black text-orange-600">
                      {formatCurrency(searchedOrder.totalAmount, searchedOrder.currency || 'SEK')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Real-time Order Visualizer Component — read only. The stages
                  advance on their own; see the auto-stage sweep in server.ts. */}
              <OrderTrackingVisualizer order={searchedOrder} />

              {/* Detailed Grid: Production Logs & Items + Estimated Completion */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left 2 Cols: Milestone Logs & Print Items */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Timeline Logs Card */}
                  <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-2xs space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <h3 className="font-extrabold text-base text-gray-900 flex items-center space-x-2">
                        <Clock className="w-5 h-5 text-orange-600" />
                        <span>{t('custMilestoneFeedTitle')}</span>
                      </h3>
                      <span className="text-xs text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-xl flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        {t('custLiveAuditLog')}
                      </span>
                    </div>

                    {/* Milestone Timeline */}
                    <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
                      {/* Milestone 1: Placed */}
                      <div className="relative">
                        <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[0.625rem] font-bold">
                          ✓
                        </div>
                        <div className="text-xs">
                          <span className="font-bold text-gray-900 block text-sm">
                            {searchedOrder.paymentStatus === 'paid' ? t('custStepPlacedDesc') : t('custOrderReceived')}
                          </span>
                          <span className="text-gray-500 block mt-0.5">
                            {/* Said "Stripe Payment Processed" on every order,
                                including unpaid ones, in a shop that has never
                                been connected to Stripe. */}
                            {formatDateTime(searchedOrder.createdAt, localeFor(language))}
                            {paymentTitleOf(searchedOrder, t) ? ` • ${paymentTitleOf(searchedOrder, t)}` : ''}
                          </span>
                        </div>
                      </div>

                      {/* Milestone 2: Prepress */}
                      <div className="relative">
                        <div className={cn(
                          "absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[0.625rem] font-bold",
                          getStepIndexForStatus(searchedOrder.status) >= 1 ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-500"
                        )}>
                          {getStepIndexForStatus(searchedOrder.status) >= 1 ? '✓' : '2'}
                        </div>
                        <div className="text-xs">
                          <span className="font-bold text-gray-900 block text-sm">{t('custMilestonePrepress')}</span>
                          <span className="text-gray-500 block mt-0.5">
                            {t('custMilestonePrepressDesc')}
                          </span>
                        </div>
                      </div>

                      {/* Milestone 3: Print Production */}
                      <div className="relative">
                        <div className={cn(
                          "absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[0.625rem] font-bold",
                          getStepIndexForStatus(searchedOrder.status) >= 2 ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-500"
                        )}>
                          {getStepIndexForStatus(searchedOrder.status) >= 2 ? '✓' : '3'}
                        </div>
                        <div className="text-xs">
                          <span className="font-bold text-gray-900 block text-sm">{t('custMilestonePrinting')}</span>
                          <span className="text-gray-500 block mt-0.5">
                            {getStepIndexForStatus(searchedOrder.status) >= 2 
                              ? t('custMilestonePrintingActive')
                              : t('custMilestonePrintingQueued')}
                          </span>
                        </div>
                      </div>

                      {/* Milestone 4: Shipping */}
                      <div className="relative">
                        <div className={cn(
                          "absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[0.625rem] font-bold",
                          getStepIndexForStatus(searchedOrder.status) >= 3 ? "bg-emerald-600 text-white" : "bg-gray-200 text-gray-500"
                        )}>
                          {getStepIndexForStatus(searchedOrder.status) >= 3 ? '✓' : '4'}
                        </div>
                        <div className="text-xs">
                          <span className="font-bold text-gray-900 block text-sm">{t('custMilestoneDispatch')}</span>
                          <span className="text-gray-500 block mt-0.5">
                            {getStepIndexForStatus(searchedOrder.status) >= 3
                              ? t('custMilestoneDispatchDone')
                              : t('custMilestoneDispatchPending')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Print Items */}
                  <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-2xs space-y-4">
                    <h3 className="font-extrabold text-base text-gray-900 flex items-center space-x-2">
                      <FileText className="w-5 h-5 text-orange-600" />
                      <span>{t('custItemsInOrder')}</span>
                    </h3>

                    <div className="space-y-3">
                      {searchedOrder.items.map((item, idx) => (
                        <div key={idx} className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-xs">
                          <div className="flex items-start gap-3">
                            {/* His own design (designer v2): its first page, small. */}
                            {previewOf(item.fileSpecs) && (
                              <img src={previewOf(item.fileSpecs)!} alt="" className="w-12 h-12 rounded-lg object-contain bg-white border border-gray-200 shrink-0" />
                            )}
                            <div>
                            <h4 className="font-bold text-gray-900 text-sm">{item.productName}</h4>
                            {item.fileSpecs && (
                              <p className="text-gray-500 font-semibold mt-0.5 flex flex-wrap items-center gap-2">
                                <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold uppercase text-[0.625rem]">{item.fileSpecs.fileType}</span>
                                {/* 15.6.6 — printed only when there IS a size.
                                    The server used to store 0 for every file
                                    that arrived after payment, so this line
                                    told the customer his job was 0×0 cm. */}
                                {(Number(item.fileSpecs.widthCm) || Number((item as any).widthCm) || 0) > 0 && (
                                  <span className="flex items-center"><Ruler className="w-3 h-3 mr-1 text-gray-400" />{Number(item.fileSpecs.widthCm) || Number((item as any).widthCm)}×{Number(item.fileSpecs.heightCm) || Number((item as any).heightCm)} cm</span>
                                )}
                                <span>• {item.fileSpecs.fileName}</span>
                              </p>
                            )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-gray-700 block">{t('cfgQuantity')} {item.quantity}</span>
                            {/* item.price is already the whole line; multiplying by
                                the quantity again showed 10x the real figure. */}
                            <span className="font-black text-gray-900 text-sm">{(Number(item.price) || 0).toFixed(2)} kr</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Col: Estimated Completion Card & Assistance */}
                <div className="space-y-6">
                  {/* Estimated Completion Card */}
                  {(() => {
                    const est = getEstimatedCompletionTime(searchedOrder.createdAt, searchedOrder.status, localeFor(language), searchedOrder.deliveredAt, searchedOrder.dueDate);
                    const deliveredTs = searchedOrder.deliveredAt || searchedOrder.updatedAt;
                    const deliveredDate = est.isCompleted && deliveredTs ? new Date(deliveredTs) : null;
                    return (
                      <div className="bg-gradient-to-br from-orange-600 via-orange-500 to-amber-600 text-white rounded-3xl p-6 shadow-lg space-y-4">
                        <div className="flex items-center justify-between text-orange-100 text-xs font-black uppercase tracking-wider">
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4 text-white" />
                            {t('custProductionSla')}
                          </span>
                          <span className="bg-white/20 px-2 py-0.5 rounded-full text-[0.625rem]">{t('custGuaranteed')}</span>
                        </div>
                        <div>
                          <span className="text-xs text-orange-100 font-bold block uppercase tracking-wide">
                            {est.isCompleted ? (deliveredDate ? t('custDeliveredOn') : t('custStepDelivered')) : t('custEstimatedCompletion')}
                          </span>
                          {est.isCompleted ? (
                            deliveredDate && (
                              <>
                                <span className="text-2xl font-black block mt-0.5">{formatShortDate(deliveredDate, localeFor(language))}</span>
                                <span className="text-lg font-bold text-orange-100 block mt-0.5">{t('custAtTime')} {formatTime(deliveredDate, localeFor(language))}</span>
                              </>
                            )
                          ) : (
                            <>
                              <span className="text-2xl font-black block mt-0.5">{est.dateString}</span>
                              <span className="text-lg font-bold text-orange-100 block mt-0.5">{t('custAtTime')} {est.timeString}</span>
                            </>
                          )}
                        </div>
                        <div className="bg-white/15 backdrop-blur-md rounded-2xl p-3.5 border border-white/20 flex items-center justify-between">
                          <div>
                            <span className="text-[0.625rem] font-black text-orange-100 uppercase block">{t('custRemainingTime')}</span>
                            <span className="text-sm font-extrabold text-white block">{est.badgeText}</span>
                          </div>
                          <ShieldCheck className="w-6 h-6 text-orange-100" />
                        </div>
                      </div>
                    );
                  })()}

                  {/* Customer Support Card */}
                  <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-2xs space-y-3">
                    <h4 className="font-bold text-sm text-gray-900 flex items-center space-x-2">
                      <HelpCircle className="w-4 h-4 text-orange-600" />
                      <span>{t('custAssistanceTitle')}</span>
                    </h4>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {t('custAssistanceBody')}
                    </p>
                    <div className="pt-2 space-y-2 text-xs font-bold text-gray-700 border-t border-gray-100">
                      {/* From site settings, never hardcoded: this card once showed
                          an invented phone number to every signed-in customer. No
                          number configured → no phone row, rather than a fake one. */}
                      {siteSettings.contactPhone && (
                        <div className="flex items-center space-x-2">
                          <Phone className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                          <span dir="ltr">{siteSettings.contactPhone}</span>
                        </div>
                      )}
                      <div className="flex items-center space-x-2">
                        <Mail className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                        <span>{siteSettings.contactEmail || 'info@reklamx.se'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Tab Content: Orders */}
      {activeTab === 'orders' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-extrabold text-gray-900">
                {t('custOrderHistoryTitle')}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('custOrderHistorySubtitle')}
              </p>
            </div>

            <div className="flex items-center space-x-2 bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-xl text-xs font-bold self-start sm:self-auto">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              <span>{t('custAutoSyncActive')}</span>
            </div>
          </div>

          {/* A fresh customer used to see just the heading and then the footer —
              no hint that having zero orders is a state rather than a glitch. */}
          {/* THREE STATES, NOT ONE. Loading, failed, and genuinely empty used to
              collapse into the last of them — so a customer whose orders simply
              had not arrived yet, or could not be read at all, was told they had
              never ordered anything. */}
          {loadingOrders && orders.length === 0 && (
            <div className="bg-white rounded-3xl p-10 border border-gray-200/90 shadow-2xs text-center space-y-4">
              <RefreshCw className="w-10 h-10 text-gray-300 mx-auto animate-spin" />
              <p className="font-black text-gray-900">{t('dashOrdersLoading')}</p>
            </div>
          )}

          {ordersFailed && (
            <div className="bg-amber-50 rounded-3xl p-10 border border-amber-200 shadow-2xs text-center space-y-4">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto" />
              <p className="font-black text-gray-900">{t('dashOrdersFailedTitle')}</p>
              <p className="text-sm text-gray-600 max-w-md mx-auto leading-relaxed">{t('dashOrdersFailedBody')}</p>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gray-900 text-white text-sm font-black rounded-2xl hover:bg-orange-600 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {t('dashOrdersRetry')}
              </button>
            </div>
          )}

          {!loadingOrders && !ordersFailed && orders.length === 0 && (
            <div className="bg-white rounded-3xl p-10 border border-gray-200/90 shadow-2xs text-center space-y-4">
              <PackageCheck className="w-10 h-10 text-gray-300 mx-auto" />
              <p className="font-black text-gray-900">{t('dashNoOrdersTitle')}</p>
              <p className="text-sm text-gray-500">{t('dashNoOrdersBody')}</p>
              <Link to="/products" className="inline-block px-6 py-3 bg-gray-900 text-white text-sm font-black rounded-2xl hover:bg-orange-600 transition-colors">
                {t('orderKeepShopping')}
              </Link>
            </div>
          )}

          {orders.map((order) => {
            const currentStepIdx = getStepIndexForStatus(order.status);
            // The raw Firestore value was printed verbatim, so a Swedish
            // customer read "PAID"/"UNPAID". Unknown values still fall through.
            const payStatusRaw = String(order.paymentStatus || 'unpaid');
            const payStatusMappedKey = PAY_STATUS_KEYS[payStatusRaw as keyof typeof PAY_STATUS_KEYS];
            // Agreed to be paid on delivery: said so, not "unpaid" (until cancelled).
            const onDelivery = isOnDeliveryOpen(order);
            const payStatusLabel = onDelivery ? t('payStatusOnDelivery') : payStatusMappedKey ? t(payStatusMappedKey) : payStatusRaw;
            const progressPercent = currentStepIdx === 0 ? 0 : currentStepIdx === 1 ? 33 : currentStepIdx === 2 ? 66 : 100;

            return (
              <motion.div 
                key={order.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-2xs space-y-6"
              >
                {/* Order Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-gray-100 pb-4 gap-2">
                  <div>
                    <div className="flex items-center space-x-3">
                      <span className="font-black text-gray-900 text-lg">{order.id}</span>
                      {getStatusBadge(order.status)}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      {t('custOrderDateLabel')} {formatDate(order.createdAt, localeFor(language))}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-end md:items-center gap-3">
                    <div className="flex items-center space-x-2 space-x-reverse">
                      <button
                        onClick={() => setSelectedReceiptOrder(order)}
                        className="px-3 py-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition-colors rounded-xl font-bold text-xs flex items-center space-x-1 space-x-reverse cursor-pointer shadow-2xs active:scale-95"
                        title={t('custViewReceiptTitle')}
                      >
                        <Receipt className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{t('custReceipt')}</span>
                      </button>

                      <button
                        onClick={() => setSelectedInvoiceOrder(order)}
                        className="px-3 py-1.5 bg-orange-50 text-orange-900 border border-orange-200 hover:bg-orange-100 transition-colors rounded-xl font-bold text-xs flex items-center space-x-1 space-x-reverse cursor-pointer shadow-2xs active:scale-95"
                        title={t('custViewInvoiceTitle')}
                      >
                        <FileText className="w-3.5 h-3.5 text-orange-600" />
                        <span>{t('custTaxInvoice')}</span>
                      </button>

                      {/* One button per credit note, not one for "credit notes":
                          each is a separate accounting document with its own
                          number, and the customer's bookkeeper needs the number
                          before opening it. */}
                      {(creditNotesByOrder[order.id] ?? []).map((note) => (
                        <button
                          key={note.creditNoteNumber}
                          onClick={() => setSelectedCreditNote(note)}
                          className="px-3 py-1.5 bg-gray-100 text-gray-800 border border-gray-300 hover:bg-gray-200 transition-colors rounded-xl font-bold text-xs flex items-center space-x-1 space-x-reverse cursor-pointer shadow-2xs active:scale-95"
                          title={t('cnOpen')}
                        >
                          <FileText className="w-3.5 h-3.5 text-gray-600" />
                          <span>{note.creditNoteNumber}</span>
                        </button>
                      ))}
                    </div>

                    <div className="text-right">
                      <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block">
                        {t('custTotalAmount')}
                      </span>
                      <span className="text-2xl font-black text-orange-600">
                        {formatCurrency(order.totalAmount, order.currency || 'SEK')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* REAL-TIME ORDER STATUS TRACKER COMPONENT (Placed -> Processing -> In Print -> Shipped -> Delivered) */}
                {/* Read only. Nobody moves production from a customer screen. */}
                <OrderTrackingVisualizer order={order} />

                {/* Items List */}
              <div className="space-y-4">
                {(order.items ?? []).map((item, idx) => (
                  <div key={idx} className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                      <h4 className="font-bold text-gray-900 text-base">{item.productName}</h4>
                      {item.options && Object.keys(item.options).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 text-xs text-gray-600 mt-1">
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
                      {item.fileSpecs && (
                        <div className="flex items-center space-x-3 text-xs text-gray-600 mt-1 font-semibold">
                          {previewOf(item.fileSpecs) && (
                            <img src={previewOf(item.fileSpecs)!} alt="" className="w-10 h-10 rounded-md object-contain bg-white border border-gray-200 shrink-0" data-rx-order-design />
                          )}
                          <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-bold uppercase">{item.fileSpecs.fileType}</span>
                          {(Number(item.fileSpecs.widthCm) || Number((item as any).widthCm) || 0) > 0 && (
                            <span className="flex items-center"><Ruler className="w-3.5 h-3.5 mr-1" />{Number(item.fileSpecs.widthCm) || Number((item as any).widthCm)}×{Number(item.fileSpecs.heightCm) || Number((item as any).heightCm)} cm</span>
                          )}
                          <span>• {item.fileSpecs.fileName}</span>
                        </div>
                      )}

                      {/* Still owed a print file. The order listener is live, so
                          this disappears of its own accord the moment the server
                          records the upload. */}
                      {(item as any).artworkPending === true && order.status !== 'completed' && order.status !== 'cancelled' && (
                        <div className="mt-3 max-w-xs">
                          {/* Bought as "Design online" without the design (designer v2):
                              made here, in the same designer. */}
                          {typeof (item as any).productId === 'string' && cleanDesignLaterMarker((item as any).designLater) ? (
                            // Only once it is paid, as on the order page: a design made on an
                            // order whose payment failed belongs to no order that will be printed.
                            ((order as any).paymentStatus === 'paid' || isOnDeliveryOpen(order)) && (
                            <>
                              <p className="text-[0.6875rem] font-black text-amber-700 mb-1.5 flex items-center gap-1">
                                <PenTool className="w-3.5 h-3.5" />
                                {t('stDlTitle')}
                              </p>
                              <OrderDesignLater
                                orderId={order.id}
                                token={(order as any).publicToken}
                                itemIndex={idx}
                                productId={(item as any).productId}
                                productName={item.productName}
                                marker={cleanDesignLaterMarker((item as any).designLater)!}
                                widthCm={Number((item as any).widthCm) || Number((item as any).printWidthCm) || undefined}
                                heightCm={Number((item as any).heightCm) || Number((item as any).printHeightCm) || undefined}
                              />
                            </>
                            )
                          ) : (
                          <>
                          <p className="text-[0.6875rem] font-black text-amber-700 mb-1.5 flex items-center gap-1">
                            <FileUp className="w-3.5 h-3.5" />
                            {t('auTitle')}
                          </p>
                          <ArtworkUploadBox
                            orderId={order.id}
                            token={(order as any).publicToken}
                            itemIndex={idx}
                            // 15.6.4 — see OrderStatusPage: the same pair, so
                            // the box states the size on both screens a
                            // customer can reach it from.
                            widthCm={Number(item.fileSpecs?.widthCm) || Number((item as any).widthCm) || Number((item as any).printWidthCm) || undefined}
                            heightCm={Number(item.fileSpecs?.heightCm) || Number((item as any).heightCm) || Number((item as any).printHeightCm) || undefined}
                          />
                          </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <span className="text-xs font-bold text-gray-700">{t('cfgQuantity')} {item.quantity}</span>
                      {(item.fileSpecs || (item as any).fileUrl) && (
                        <button
                          onClick={async () => {
                            const ok = await triggerFileDownload(
                              item.fileSpecs?.fileUrl || (item as any).fileUrl,
                              item.fileSpecs?.fileName || (item as any).fileName || 'uploaded_print_file.pdf',
                              item.fileSpecs || item
                            );
                            if (!ok) void notify({ title: t('custArtworkUnavailable'), tone: 'primary' });
                          }}
                          className="px-2.5 py-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-[0.6875rem] font-bold rounded-lg hover:bg-blue-100 transition-colors flex items-center shadow-xs cursor-pointer active:scale-95"
                        >
                          <Download className="w-3 h-3 mr-1" />
                          {t('custDownloadFile')}
                        </button>
                      )}
                      <Link 
                        to="/custom-upload"
                        className="px-2.5 py-1.5 bg-white border border-gray-200 text-gray-800 text-[0.6875rem] font-bold rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        {t('custReorderPrint')}
                      </Link>
                    </div>
                  </div>
                ))}
              </div>

              {/* Order Meta: Customer, Shipping, Payment Details */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-gray-100 text-xs">
                {/* Customer Details */}
                <div className="bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/60 space-y-1">
                  <span className="font-black text-gray-800 uppercase text-[0.625rem] tracking-wider block text-orange-600">
                    {t('custCustomerInfo')}
                  </span>
                  <p className="font-bold text-gray-900">{order.customerName}</p>
                  <p className="text-gray-500">{order.customerEmail}</p>
                  {(order as any).customerDetails?.phone && (
                    <p className="text-gray-500">{t('custPhoneLabel')} {(order as any).customerDetails.phone}</p>
                  )}
                  {(order as any).customerDetails?.address1 && (
                    <p className="text-gray-500">{(order as any).customerDetails.address1}, {(order as any).customerDetails.city}</p>
                  )}
                </div>

                {/* Shipping Details */}
                <div className="bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/60 space-y-1">
                  <span className="font-black text-gray-800 uppercase text-[0.625rem] tracking-wider block text-blue-600">
                    {t('custShippingMethod')}
                  </span>
                  <p className="font-bold text-gray-900">{(order as any).shippingMethodTitle || t('custShippingDefault')}</p>
                  <p className="text-gray-500">{t('custFeeLabel')} {(order as any).shippingCost ? `${(order as any).shippingCost} SEK` : t('cfgPriceIncluded')}</p>
                  {/* Tracking, once the shipment has been booked in Zendr. The
                      customer asking "where is it?" is the single most common
                      message a print shop gets. */}
                  {order.shipment?.status && (
                    <div className="pt-1.5 mt-1.5 border-t border-gray-200 space-y-0.5">
                      <p className="font-black text-gray-900">
                        {t(shipmentStatusKey(order.shipment.status) ?? 'shipTrackingTitle')}
                      </p>
                      {order.shipment.trackingNumber && (
                        <p className="text-gray-500 break-all">
                          {t('shipTrackingNumber')}:{' '}
                          <span className="font-mono font-bold text-gray-700">
                            {order.shipment.trackingNumber}
                          </span>
                        </p>
                      )}
                      {order.shipment.carrier && (
                        <p className="text-gray-500">{t('shipCarrier')}: {order.shipment.carrier}</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Payment Details */}
                <div className="bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/60 space-y-1">
                  <span className="font-black text-gray-800 uppercase text-[0.625rem] tracking-wider block text-emerald-600">
                    {t('custPaymentMethod')}
                  </span>
                  <p className="font-bold text-gray-900">{paymentTitleOf(order, t) || '\u2014'}</p>
                  {/* Was `paymentStatus || 'paid'` in permanent green — an unpaid
                      order displayed as PAID to the person who had not paid. */}
                  <p className="text-gray-500">{t('status')}: <span className={cn(
                    'font-bold uppercase',
                    order.paymentStatus === 'paid' ? 'text-emerald-600'
                      : onDelivery ? 'text-sky-700'
                      : order.paymentStatus === 'refunded' ? 'text-gray-600'
                        // Terminal failures are red, not amber: amber says "still
                        // waiting", and these are not going to resolve themselves.
                        : ['failed', 'canceled', 'expired', 'chargeback'].includes(String(order.paymentStatus)) ? 'text-red-600'
                          : 'text-amber-600'
                  )}>{payStatusLabel}</span></p>
                </div>
              </div>

              {/* Production Staff Assigned Info */}
              {order.assignedStaffName && (
                <div className="p-3 bg-blue-50/70 border border-blue-100 rounded-2xl flex items-center justify-between text-xs text-blue-800 font-semibold">
                  <div className="flex items-center">
                    <ShieldCheck className="w-4 h-4 text-blue-600 mr-2" />
                    <span>
                      {t('custAssignedSpecialist').replace('{0}', order.assignedStaffName || '')}
                    </span>
                  </div>
                  <span className="text-blue-600 font-bold">{t('custActivelyMonitored')}</span>
                </div>
              )}
            </motion.div>
            );
          })}
        </div>
      )}

      {/* Tab Content: Files */}
      {activeTab === 'files' && (
        <div className="space-y-6">
          <h2 className="text-xl font-extrabold text-gray-900">
            {t('custMyPrintFilesTitle')}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {(() => {
              // Extract all files attached to items across customer's orders
              const orderFiles = orders.flatMap(order => 
                order.items
                  .filter(item => item.fileSpecs || (item as any).fileUrl || (item as any).fileName)
                  .map(item => ({
                    name: item.fileSpecs?.fileName || (item as any).fileName || 'uploaded_design.pdf',
                    size: (item.fileSpecs as any)?.fileSizeMb ? `${(item.fileSpecs as any).fileSizeMb} MB` : '4.2 MB',
                    type: item.fileSpecs?.fileType || 'PDF',
                    // 15.6.6 — NO INVENTED SIZE. `|| 28` drew a 28 × 35 cm
                    // preview for every line whose file arrived after payment,
                    // because the server recorded those as 0 × 0. A missing size
                    // is now missing, and the preview falls back to a square.
                    width: Number(item.fileSpecs?.widthCm) || Number((item as any).widthCm) || Number((item as any).printWidthCm) || 0,
                    height: Number(item.fileSpecs?.heightCm) || Number((item as any).heightCm) || Number((item as any).printHeightCm) || 0,
                    date: formatDate(order.createdAt, localeFor(language)),
                    fileUrl: item.fileSpecs?.fileUrl || (item as any).fileUrl || null,
                    fileSpecs: item.fileSpecs || item
                  }))
              );

              // Three invented files used to be shown to anyone who had never
              // uploaded anything — logo_banner_print.ai, sticker_design.pdf,
              // business_card_front.png, with sizes and dates. A customer could
              // reasonably believe the shop was holding artwork it had never
              // received.
              const fileList = orderFiles;
              if (fileList.length === 0) {
                return (
                  <div className="bg-white rounded-3xl p-10 border border-gray-100 shadow-sm text-center space-y-2">
                    <UploadCloud className="w-8 h-8 text-gray-300 mx-auto" />
                    <p className="text-sm font-bold text-gray-700">{t('custNoFilesTitle')}</p>
                    <p className="text-xs text-gray-400">
                      {t('custNoFilesBody')}
                    </p>
                  </div>
                );
              }

              return fileList.map((file, i) => (
                <div key={i} className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl font-black text-sm uppercase">
                      {file.type}
                    </div>
                    <div className="overflow-hidden">
                      <h4 className="font-bold text-gray-900 text-sm truncate" title={file.name}>{file.name}</h4>
                      <p className="text-xs text-gray-400">{file.size} • {file.date}</p>
                    </div>
                  </div>

                  {/* 15.6.6 — ONLY WHEN THERE IS A SIZE. The two sibling rows
                      in this file were guarded and this third one was not, so a
                      file whose line carries no size printed "0 cm (W) × 0 cm
                      (H)" to the customer — a measurement of nothing, asserted
                      as a fact, on the card he opens to check his own artwork.
                      It replaced an older lie: a hardcoded 28 × 35. */}
                  {file.width > 0 && file.height > 0 && (
                    <div className="bg-gray-50 p-3 rounded-2xl text-xs font-bold text-gray-700 flex justify-between">
                      <span>{t('custPrintDimensions')}</span>
                      <span className="text-blue-600">{file.width} {t('custDimWidth')} × {file.height} {t('custDimHeight')}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      onClick={async () => {
                        const ok = await triggerFileDownload(file.fileUrl, file.name, file.fileSpecs || { widthCm: file.width, heightCm: file.height, fileType: file.type });
                        if (!ok) window.alert(t('custArtworkUnavailable'));
                      }}
                      className="py-2 bg-blue-600 text-white rounded-lg text-[0.6875rem] font-bold hover:bg-blue-700 transition-colors flex items-center justify-center shadow-xs cursor-pointer active:scale-95"
                    >
                      <Download className="w-3 h-3 mr-1" />
                      {t('custDownloadFile')}
                    </button>
                    <Link 
                      to="/custom-upload"
                      className="py-2 bg-gray-900 text-white rounded-lg text-[0.6875rem] font-bold hover:bg-gray-800 transition-colors flex items-center justify-center"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      {t('custReprint')}
                    </Link>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Tab Content: Loyalty Points */}
      {activeTab === 'loyalty' && (
        <div className="space-y-8">
          {/* Top Headline */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
                <Coins className="w-6 h-6 text-amber-500" />
                <span>{t('custLoyaltyTitle')}</span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('custLoyaltyEarnPrefix')} {loyalty.pointsEarnedPerSek} {t('custLoyaltyEarnSuffix')}
              </p>
            </div>

            <Link
              to="/products"
              className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2.5 rounded-2xl font-black text-xs transition-all shadow-md flex items-center space-x-1.5 self-start sm:self-auto shrink-0"
            >
              <Gift className="w-4 h-4" />
              <span>{t('custRedeemAtCheckout')}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* 3 Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Card 1: Balance */}
            <div className="bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-3xl p-6 shadow-md relative overflow-hidden">
              <div className="absolute -right-4 -bottom-4 opacity-15">
                <Coins className="w-32 h-32" />
              </div>
              <div className="flex justify-between items-start mb-4">
                <span className="text-xs font-black uppercase tracking-wider bg-white/20 backdrop-blur-md px-2.5 py-1 rounded-full">
                  {t('custAvailablePoints')}
                </span>
                <Sparkles className="w-5 h-5 text-amber-200 animate-pulse" />
              </div>
              <p className="text-4xl font-black mb-1">
                {user?.loyaltyPoints ?? 0} <span className="text-sm font-bold opacity-80">PTS</span>
              </p>
              <p className="text-xs text-amber-100 font-medium">
                {t('custWorthPrefix')} <span className="font-black text-white">{formatMoney((user?.loyaltyPoints ?? 0) / 10)}</span> {t('custWorthSuffix')}
              </p>
            </div>

            {/* Card 2: Tier Status */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-2xs space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-black text-gray-400 uppercase tracking-wider">
                  {t('custMemberTier')}
                </span>
                <span className="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-black uppercase flex items-center gap-1">
                  <Award className="w-3.5 h-3.5 text-amber-600" />
                  {tier}
                </span>
              </div>
              <div>
                <p className="text-2xl font-black text-gray-900">
                  {tier === 'Platinum' ? t('custTierPlatinum') : tier === 'Gold' ? t('custTierGold') : t('custTierSilver')}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {tier === 'Platinum'
                    ? t('custTierPlatinumDesc')
                    : tier === 'Gold'
                    ? t('custTierGoldDesc')
                    : t('custTierSilverDesc').replace('{0}', String(loyalty.pointsEarnedPerSek))}
                </p>
              </div>

              {/* 4.25 — THE BAR MEASURES SPEND, NOT THE BALANCE.
                  It measured points, so a customer who redeemed watched his own
                  progress bar go backwards — the programme punishing him for
                  using it. Spend only ever goes up, and the thresholds are the
                  owner's to set. */}
              <div className="pt-2">
                <div className="flex justify-between text-[0.625rem] font-extrabold text-gray-400 mb-1">
                  <span>{Math.round(lifetimeSpend).toLocaleString('sv-SE')} kr</span>
                  <span>
                    {tier === 'Platinum'
                      ? t('custMaxTier')
                      : t('custNextTier')
                          .replace('{0}', String(tier === 'Gold' ? loyalty.tierPlatinumSpend : loyalty.tierGoldSpend))
                          .replace('{1}', tier === 'Gold' ? t('custTierPlatinum') : t('custTierGold'))}
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full transition-all duration-500"
                    style={{
                      // Guarded against a threshold of zero: it is a setting, and
                      // dividing by it would render a NaN width.
                      width: `${tier === 'Platinum' ? 100 : Math.min(100, Math.max(0,
                        (lifetimeSpend / Math.max(1, tier === 'Gold' ? loyalty.tierPlatinumSpend : loyalty.tierGoldSpend)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Card 3: Earning Rate */}
            <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-2xs space-y-3">
              <span className="text-xs font-black text-gray-400 uppercase tracking-wider block">
                {t('custEarningRateTitle')}
              </span>
              <div className="space-y-2">
                <div className="flex items-center space-x-2 text-xs font-bold text-gray-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{loyalty.pointsEarnedPerSek} {t('custPerkEarnRate')}</span>
                </div>
                <div className="flex items-center space-x-2 text-xs font-bold text-gray-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{t('custPerkRedeemRate').replace('{0}', String(loyalty.pointsPerSek))}</span>
                </div>
                <div className="flex items-center space-x-2 text-xs font-bold text-gray-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>{t('custPerkStackable')}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Points History Section */}
          <div className="bg-white rounded-3xl p-6 border border-gray-200/90 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                <History className="w-4 h-4 text-amber-500" />
                <span>{t('custPointsHistoryTitle')}</span>
              </h3>
              <span className="text-xs font-bold text-gray-400">
                {(user?.pointsHistory || []).length} {t('custRecords')}
              </span>
            </div>

            {(!user?.pointsHistory || user.pointsHistory.length === 0) ? (
              <div className="p-8 text-center space-y-2">
                <Coins className="w-8 h-8 text-gray-300 mx-auto" />
                <p className="text-sm font-bold text-gray-700">{t('custNoPointsYet')}</p>
                <p className="text-xs text-gray-400">{t('custNoPointsYetDesc')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(user.pointsHistory ?? []).map((tx) => (
                  <div 
                    key={tx.id} 
                    className="flex items-center justify-between p-3.5 bg-gray-50/80 rounded-2xl border border-gray-100 hover:bg-gray-100/80 transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <div className={cn(
                        "w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs shrink-0 text-white",
                        tx.points > 0 ? "bg-emerald-500" : "bg-orange-500"
                      )}>
                        {tx.points > 0 ? '+' : '-'}
                      </div>
                      <div>
                        <p className="text-xs font-black text-gray-900">{tx.description}</p>
                        <p className="text-[0.625rem] font-medium text-gray-400">
                          {formatDate(tx.date, localeFor(language))} {tx.orderId ? `• ${t('custTxOrder')}${tx.orderId}` : ''}
                        </p>
                      </div>
                    </div>
                    <span className={cn(
                      "text-sm font-black",
                      tx.points > 0 ? "text-emerald-600" : "text-orange-600"
                    )}>
                      {tx.points > 0 ? `+${tx.points}` : `${tx.points}`} PTS
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Content: Profile Settings */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-gray-200/90 shadow-2xs max-w-2xl space-y-5">
          {/* This heading read "Create Account" — to a signed-in customer that
              says they have no account yet. It is their profile. */}
          <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
            {t('accountSettings')}
          </h2>

          {/* Individual / Business Segmented Switcher */}
          <div className="bg-gray-200/80 p-1 rounded-xl grid grid-cols-2 text-center text-xs font-semibold">
            <button
              type="button"
              onClick={() => setAccountType('individual')}
              className={cn(
                "py-2.5 rounded-lg transition-all",
                accountType === 'individual'
                  ? "bg-white text-gray-900 shadow-2xs font-bold"
                  : "text-gray-600 hover:text-gray-900"
              )}
            >
              {t('cpIndividual')}
            </button>
            <button
              type="button"
              onClick={() => setAccountType('business')}
              className={cn(
                "py-2.5 rounded-lg transition-all",
                accountType === 'business'
                  ? "bg-white text-gray-900 shadow-2xs font-bold"
                  : "text-gray-600 hover:text-gray-900"
              )}
            >
              {t('umBusiness')}
            </button>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); handleUpdateProfile(); }} className="space-y-3.5 text-xs">
            {/* If Business, Company Name & Tax ID */}
            {accountType === 'business' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-gray-700 font-medium mb-1">
                    {t('companyName')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-[#f8f9fa] border border-gray-200 rounded-lg text-gray-900 text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 font-medium mb-1">
                    {t('custTaxIdLabel')}
                  </label>
                  <input
                    type="text"
                    value={taxNumber}
                    onChange={(e) => setTaxNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-[#f8f9fa] border border-gray-200 rounded-lg text-gray-900 text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500"
                  />
                </div>
              </div>
            )}

            {/* First Name & Last Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('checkoutShipFirstName')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-[#f8f9fa] border border-gray-200 rounded-lg text-gray-900 text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('checkoutShipLastName')} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-[#f8f9fa] border border-gray-200 rounded-lg text-gray-900 text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500"
                />
              </div>
            </div>

            {/* Address 1 & Do not fill in */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('custAddress1')}
                </label>
                <input
                  type="text"
                  value={address1}
                  onChange={(e) => setAddress1(e.target.value)}
                  className="w-full px-3 py-2 bg-[#f8f9fa] border border-gray-200 rounded-lg text-gray-900 text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('checkoutAddress2Label')}
                </label>
                <input
                  type="text"
                  value={address2}
                  onChange={(e) => setAddress2(e.target.value)}
                  className="w-full px-3 py-2 bg-[#f8f9fa] border border-gray-200 rounded-lg text-gray-900 text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500"
                />
              </div>
            </div>

            {/* Postcode & City */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('checkoutShipPostcode')}
                </label>
                <input
                  type="text"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  className="w-full px-3 py-2 bg-[#f8f9fa] border border-gray-200 rounded-lg text-gray-900 text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500"
                />
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('checkoutShipCity')}
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 bg-[#f8f9fa] border border-gray-200 rounded-lg text-gray-900 text-xs focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500"
                />
              </div>
            </div>

            {/* Country Dropdown */}
            <div>
              <label className="block text-gray-700 font-medium mb-1">
                {t('custCountry')} <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  required
                  className="w-full px-3 py-2 bg-[#f8f9fa] border border-gray-200 rounded-lg text-gray-900 text-xs appearance-none focus:outline-none focus:bg-white focus:ring-1 focus:ring-orange-500 pr-8"
                >
                  <option value="Sverige">Sverige</option>
                  <option value="Norge">Norge</option>
                  <option value="Danmark">Danmark</option>
                  <option value="Finland">Finland</option>
                  <option value="Tyskland">Tyskland</option>
                  <option value="United Kingdom">United Kingdom</option>
                  <option value="United States">United States</option>
                </select>
                <ChevronDown className="w-4 h-4 text-gray-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Email & Billing Email with Mail icons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('custEmailLabel')} <span className="text-red-500">*</span>
                </label>
                <div className="flex bg-[#f8f9fa] border border-gray-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-orange-500 focus-within:bg-white">
                  <div className="w-9 flex items-center justify-center border-r border-gray-200 text-gray-500 shrink-0">
                    <Mail className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="email"
                    value={email}
                    readOnly
                    aria-describedby="signin-email-note"
                    className="w-full px-3 py-2 bg-transparent text-gray-500 text-xs focus:outline-none cursor-not-allowed"
                  />
                </div>
                <p id="signin-email-note" className="text-[0.625rem] text-gray-400 mt-1">
                  {t('custSignInEmailNote')}
                </p>
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('custBillingEmail')}
                </label>
                <div className="flex bg-[#f8f9fa] border border-gray-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-orange-500 focus-within:bg-white">
                  <div className="w-9 flex items-center justify-center border-r border-gray-200 text-gray-500 shrink-0">
                    <Mail className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="email"
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-transparent text-gray-900 text-xs focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Phone Number with Phone icon */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('phone')}
                </label>
                <div className="flex bg-[#f8f9fa] border border-gray-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-orange-500 focus-within:bg-white">
                  <div className="w-9 flex items-center justify-center border-r border-gray-200 text-gray-500 shrink-0">
                    <Phone className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-transparent text-gray-900 text-xs focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Desired Password & Confirm Password with Key icons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('custDesiredPassword')} <span className="text-red-500">*</span>
                </label>
                <div className="flex bg-[#f8f9fa] border border-gray-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-orange-500 focus-within:bg-white">
                  <div className="w-9 flex items-center justify-center border-r border-gray-200 text-gray-500 shrink-0">
                    <Key className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-transparent text-gray-900 text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  {t('custConfirmPassword')} <span className="text-red-500">*</span>
                </label>
                <div className="flex bg-[#f8f9fa] border border-gray-200 rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-orange-500 focus-within:bg-white">
                  <div className="w-9 flex items-center justify-center border-r border-gray-200 text-gray-500 shrink-0">
                    <Key className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-transparent text-gray-900 text-xs focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Checkbox */}
            <div className="pt-2">
              <label className="flex items-start space-x-2 space-x-reverse cursor-pointer text-xs text-gray-700 font-normal">
                <input
                  type="checkbox"
                  checked={notifyCampaigns}
                  onChange={(e) => setNotifyCampaigns(e.target.checked)}
                  className="rounded text-orange-600 focus:ring-orange-500 mt-0.5 shrink-0"
                />
                <span>
                  {t('custNotifyCampaigns')}
                </span>
              </label>
            </div>

            {profileError && (
              <div role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-300 px-3 py-2.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-[0.6875rem] font-bold text-amber-900 leading-relaxed">{profileError}</p>
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-3">
              <button
                type="submit"
                disabled={savingProfile || Boolean(user?.profileUnavailable)}
                data-rx-profile-save
                className="px-6 py-2.5 bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800 font-semibold rounded-lg text-xs transition-colors shadow-2xs flex items-center justify-center"
              >
                {profileSavedSuccess ? (
                  <>
                    <Check className="w-4 h-4 mr-1.5" />
                    <span>{t('saved')}</span>
                  </>
                ) : (
                  <span>{t('saveChanges')}</span>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Official Tax Invoice Modal */}
      <InvoiceModal
        isOpen={!!selectedInvoiceOrder}
        onClose={() => setSelectedInvoiceOrder(null)}
        order={selectedInvoiceOrder}
      />

      {/* The kreditnota itself — its own document, with its own number. An
          issued invoice cannot be edited under Swedish rules, so this is a
          separate paper and not a line on the invoice. */}
      <CreditNoteModal
        isOpen={!!selectedCreditNote}
        onClose={() => setSelectedCreditNote(null)}
        note={selectedCreditNote}
      />

      {/* Payment Receipt Modal */}
      <ReceiptModal
        isOpen={!!selectedReceiptOrder}
        onClose={() => setSelectedReceiptOrder(null)}
        order={selectedReceiptOrder}
      />
      </div>
    </div>
    {noticeDialog}
    </div>
  );
}
