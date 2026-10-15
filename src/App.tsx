import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet, HelmetProvider } from 'react-helmet-async';
import { GeminiChatbot } from './components/GeminiChatbot';
import { 
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
  useLocation,
  useSearchParams
} from 'react-router-dom';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
  User as FirebaseUser
} from 'firebase/auth';
import AuthModal from './components/AuthModal';
import NeoNavPill from './components/NeoNavPill';
import PaymentIcons, { entriesFromMollieMethods } from './components/PaymentIcons';
import BuildWatcher from './components/BuildWatcher';
import CookieNotice from './components/CookieNotice';
import WelcomeQuestions from './components/WelcomeQuestions';
import SafeImage from './components/SafeImage';
import { hasMarketing, loadTags, readConsent, resetConsent } from './lib/gtag';
import { matchesCatalogueFilters, normaliseQuery } from './lib/catalogueQuery';
import { buildCategoryTree, descendantIds, breadcrumb } from './lib/categoryTree';
import ErrorBoundary from './components/ErrorBoundary';
import { getLegalDocument } from './lib/legal';
import { SEO_PAGES, SITE_DESCRIPTION, seoText, type SeoLang, type SeoSettings } from './lib/seoSettings';
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, Product, Category, Order } from './types';
import { Language, LANGUAGES, translations, detectBrowserLanguage, isSupportedLanguage, type TranslationKey } from './lib/translations';
import { CART_CHANGED_EVENT } from './lib/cart';
import { localized } from './lib/localizedText';
import { localeFor } from './lib/dateFormat';
// The one pricing authority. The shop grid prices through it so a card and
// the product page it opens can never quote different money.
import { cardPrices } from './lib/cardPrice';
import { installPrintFit } from './lib/printFit';
import { LOYALTY_DEFAULTS, loyaltySettingsFrom, type LoyaltySettings } from './lib/loyalty';
import { DEFAULT_SHIPPING, normaliseShipping, type ShippingSettings } from './lib/shipping';
import { startCartBeacon } from './lib/cartBeacon';
import { clearCustomerDrafts } from './components/product/designer/draftStore';
import { clearCheckoutDraft } from './lib/checkoutDraft';
import { productPath } from './lib/slug';
import { SiteSettingsProvider, useSiteSettings, type PaymentIconEntry } from './context/SiteSettingsContext';
import LaboPrintHome from './components/Home/LaboPrintHome';
import { 
  LayoutDashboard, 
  ShoppingBag, 
  Settings, 
  LogOut, 
  User as UserIcon, 
  Menu, 
  X, 
  Search, 
  ShoppingCart,
  ChevronRight,
  ChevronDown,
  Printer,
  Package,
  BarChart3,
  Users,
  Layers,
  Palette,
  CreditCard,
  Truck,
  Plus,
  ArrowRight,
  Star,
  Clock,
  CheckCircle2,
  Check,
  AlertCircle,
  Globe,
  Filter,
  SlidersHorizontal,
  Sliders,
  UploadCloud,
  Phone,
  Mail,
  Box,
  Coins,
  LayoutGrid,
  Tag,
  Flag,
  Coffee,
  Sparkles,
  Monitor
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from './lib/utils';
import { BRAND_LOGO_SIZE, hasOwnLogo, logoSrc } from './lib/brandLogo';
import { 
  CurrencyCode, 
  CurrencyInfo, 
  DEFAULT_CURRENCIES, 
  convertFromSEK, 
  formatCurrencyValue 
} from './lib/currency';
import PrintSettingsAdmin from './components/Admin/PrintSettingsAdmin';
import ProductPage from './pages/ProductPage';
import CartDrawer from './components/CartDrawer';
import VatTag from './components/VatTag';

// Routes loaded on demand.
//
// Everything used to arrive in one 2.7 MB file, so a customer opening the front
// page downloaded the whole back office, the fabric.js design editor and the PDF
// renderer before they could read a price. These are the pages not everyone
// visits; React fetches each the moment someone actually goes there.
const AdminLoginPage = React.lazy(() => import('./pages/AdminLoginPage'));
const AuthPage = React.lazy(() => import('./pages/AuthPage'));
const ResetPasswordPage = React.lazy(() => import('./pages/ResetPasswordPage'));
const OrderStatusPage = React.lazy(() => import('./pages/OrderStatusPage'));
const LegalPage = React.lazy(() => import('./pages/LegalPage'));
const DesignEditorPage = React.lazy(() => import('./pages/DesignEditorPage'));
const CustomFileUploadPage = React.lazy(() => import('./pages/CustomFileUploadPage'));
const CheckoutPage = React.lazy(() => import('./pages/CheckoutPage'));
const CustomerDashboard = React.lazy(() => import('./pages/CustomerDashboard'));
const StaffDashboard = React.lazy(() => import('./pages/StaffDashboard'));
const AdminDashboardPage = React.lazy(() => import('./pages/AdminDashboardPage'));
const ServicesPage = React.lazy(() => import('./pages/ServicesPage'));
const AboutUsPage = React.lazy(() => import('./pages/AboutUsPage'));
const ContactPage = React.lazy(() => import('./pages/ContactPage'));

/**
 * Shown while a route's code is on its way.
 *
 * min-h-screen is not decoration: at py-32 this stood about 290px tall, so the
 * FOOTER sat halfway up the first screen and then dropped out of sight the
 * instant the real page arrived. Measured on the live shop, that single jump
 * was CLS 0.3073 on /contact and 0.3558 on /checkout — both far past Google's
 * 0.1 "poor" line, on the contact page a customer is trying to read and the
 * checkout they are trying to pay on. Reserving a screen's worth keeps the
 * footer below the fold where it belongs, so its arrival moves nothing anybody
 * can see.
 */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen py-32" role="status" aria-live="polite">
      <div className="w-8 h-8 border-3 border-gray-200 border-t-gray-900 rounded-full animate-spin" />
      <span className="sr-only">Loading</span>
    </div>
  );
}


// --- Context ---
interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  login: () => void;
  openAuthModal: (mode?: 'signin' | 'signup') => void;
  closeAuthModal: () => void;
  isAuthModalOpen: boolean;
  /** Set when something asked for sign-in; AuthRedirector (inside the router) consumes it. */
  authRedirect: { mode: 'signin' | 'signup'; at: number } | null;
  clearAuthRedirect: () => void;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  registerWithEmail: (displayName: string, email: string, pass: string) => Promise<void>;
  loginAsDemoUser: (role: 'admin' | 'staff' | 'client') => Promise<void>;
  logout: () => Promise<void>;
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
  includeVat: boolean;
  setIncludeVat: (include: boolean) => void;
  vatRate: number;
  /**
   * 4.26 — the loyalty rates, as the owner set them.
   *
   * On the context rather than imported where they are used: `calcOrderTotals`
   * runs here AND on the server, and a rate the server read from settings while
   * the browser used a constant would quote one price and charge another.
   */
  loyalty: LoyaltySettings;
  /**
   * Round 16, item 2 — his shipping countries and prices, from the same document
   * (one read per visit). The checkout's country list comes from here; the
   * delivery menu and its fees come from the server's quote, which reads the
   * same document fresh.
   */
  shipping: ShippingSettings;
  /**
   * True once his settings have answered (or failed to). Until then `shipping`
   * is the compiled defaults — the checkout must not correct a restored country
   * against them, or a Dutch customer's saved 'NL' became 'SE' on a reload.
   */
  shippingLoaded: boolean;
  /** The Shipping tab hands over what it saved, so this visit's copy is current. */
  refreshShipping: (next: ShippingSettings) => void;
  currency: CurrencyCode;
  setCurrency: (code: CurrencyCode) => void;
  currencies: Record<CurrencyCode, CurrencyInfo>;
  updateExchangeRate: (code: CurrencyCode, newRate: number) => void;
  convertPrice: (netPriceSEK: number, targetCurrency?: CurrencyCode) => number;
  formatPriceWithVat: (netPriceSEK: number) => {
    netPrice: number;
    vatAmount: number;
    grossPrice: number;
    displayPrice: number;
    vatLabel: string;
    formatted: string;
    currencyCode: CurrencyCode;
    currencySymbol: string;
    rawNetSEK: number;
    rawGrossSEK: number;
  };
  /**
   * Format a SEK amount in the currency the visitor has selected.
   *
   * Several screens printed a CONVERTED number next to a hard-coded "SEK", so
   * with euros chosen the subtotal and VAT lines were euro amounts labelled SEK
   * while the total beneath them was formatted correctly — three rows that did
   * not add up.
   */
  formatMoney: (amountSEK: number) => string;
  /** @deprecated removed — points are the server's. Left out of the value below. */
  updateUserLoyaltyPoints?: (
    pointsDelta: number,
    transaction: { type: 'earned' | 'redeemed' | 'bonus'; orderId?: string; description: string }
  ) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

// --- Components ---

/**
 * "Moms ▾" — the VAT choice as ONE compact control with a menu (2026-10-13), in
 * place of a "Moms 25%" label and two 19px-tall Ja/Nej buttons: the bar was
 * crowded, and those buttons were far below a usable tap size. The two choices
 * read in full in the menu ("Med 25 %" / "Utan 25 %"), the current one ticked.
 * Closes on a choice, a press outside, or Escape.
 */
/**
 * VAT ("Moms") as a two-way switch at the top of the currency menu — the
 * header no longer has a menu of its own for it (2026-10-15): the first visit
 * answers it in WelcomeQuestions, and this is where it is changed afterwards.
 */
function VatToggle({ includeVat, setIncludeVat, t }: { includeVat: boolean; setIncludeVat: (v: boolean) => void; t: (key: string) => string }) {
  return (
    <div className="px-3 pt-2 pb-2.5 border-b border-gray-100">
      <span className="block text-[0.625rem] font-black uppercase text-gray-400 tracking-wider mb-1.5">{t('vatMenu')}</span>
      <div role="radiogroup" aria-label={t('vatMenu')} className="grid grid-cols-2 gap-0.5 p-0.5 rounded-xl bg-gray-100">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={includeVat === v}
            onClick={() => setIncludeVat(v)}
            className={cn(
              'min-h-[36px] px-2 rounded-lg text-[0.6875rem] font-black whitespace-nowrap transition-colors',
              includeVat === v ? 'bg-white text-orange-600 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-800',
            )}
          >
            {v ? t('vatWith') : t('vatWithout')}
          </button>
        ))}
      </div>
    </div>
  );
}

const Navbar = () => {
  const { 
    user, 
    login, 
    logout, 
    language, 
    setLanguage, 
    t, 
    includeVat, 
    setIncludeVat,
    currency,
    setCurrency,
    currencies
  } = useAuth();
  const { settings } = useSiteSettings();
  // The bar advertises a discount code; while that code cannot be used (off,
  // expired, used up) the bar stays down — see /api/announcement in server.ts.
  // With no linked code it shows as it always did. Hidden until the answer comes,
  // so a dead code is never on screen even for a moment.
  const linkedCode = (settings.announcementCouponCode || '').trim();
  const [announcementLive, setAnnouncementLive] = useState(!linkedCode);
  useEffect(() => {
    if (!linkedCode) { setAnnouncementLive(true); return; }
    let cancelled = false;
    const check = () => fetch('/api/announcement')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setAnnouncementLive(d?.show === true); })
      .catch(() => { if (!cancelled) setAnnouncementLive(false); });
    void check();
    const timer = window.setInterval(check, 5 * 60_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [linkedCode]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // The ☰ menu closes on a press anywhere outside it (or Escape), not only on its
  // own X: that is where a hand goes to dismiss a menu on a phone.
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (menuPanelRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      setIsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsMenuOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isMenuOpen]);
  const [langDropdownOpen, setLangDropdownOpen] = useState(false);
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartCount, setCartCount] = useState<number>(0);

  const updateCartCount = () => {
    try {
      const existing = JSON.parse(localStorage.getItem('reklamx_cart') || '[]');
      setCartCount(Array.isArray(existing) ? existing.length : 0);
    } catch {
      setCartCount(0);
    }
  };

  // Every cart write goes through src/lib/cart.ts and fires CART_CHANGED_EVENT;
  // `storage` still covers a second tab. The 1.5-second poll that used to keep
  // this honest ran forever on every page, JSON-parsing the whole basket each
  // time whether anything had happened or not.
  useEffect(() => {
    updateCartCount();
    window.addEventListener('storage', updateCartCount);
    window.addEventListener(CART_CHANGED_EVENT, updateCartCount);
    return () => {
      window.removeEventListener('storage', updateCartCount);
      window.removeEventListener(CART_CHANGED_EVENT, updateCartCount);
    };
  }, []);

  /*
   * CLOSING A DROPDOWN BY LOOKING AWAY FROM IT.
   *
   * None of the three header menus had any way to shut except pressing their
   * own button again. On a desktop that reads as untidy; on a phone it is a
   * trap — the language sheet covers the cart and the menu, and a tap outside
   * it (the thing everyone tries first) did nothing, so the panel simply
   * stayed there over the page.
   *
   * pointerdown rather than click, because a click that lands on a link would
   * navigate with the panel still open over the new page.
   */
  const navRef = useRef<HTMLElement | null>(null);
  const closeAllMenus = useCallback(() => {
    setLangDropdownOpen(false);
    setCurrencyDropdownOpen(false);
    setUserDropdownOpen(false);
  }, []);
  useEffect(() => {
    if (!langDropdownOpen && !currencyDropdownOpen && !userDropdownOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) closeAllMenus();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAllMenus(); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [langDropdownOpen, currencyDropdownOpen, userDropdownOpen, closeAllMenus]);

  return (
    <>
      {/* A signed-in account whose profile could not be read (the database refused):
          said plainly, with when it comes back — it used to show the owner a
          customer's account without a word. */}
      {user?.profileUnavailable && (
        <div
          role="status"
          className="px-4 py-2 text-[0.75rem] font-bold text-center bg-amber-100 text-amber-950 border-b border-amber-300"
          data-rx-profile-unavailable={user.profileUnavailable.quota ? 'quota' : 'other'}
        >
          {user.profileUnavailable.quota
            ? t('appProfileUnavailableQuota').replace(
                '{0}',
                user.profileUnavailable.backAt
                  ? new Date(user.profileUnavailable.backAt).toLocaleTimeString(localeFor(language), { hour: '2-digit', minute: '2-digit' })
                  : '—',
              )
            : t('appProfileUnavailable')}
        </div>
      )}

      {/* The soft-UI header from the client's reference: everything floats on
          the grey neumorphic surface — the nav capsule, and every control as a
          raised pill. One look for both old navbarBg variants on purpose. */}
      <nav ref={navRef} className="sticky top-0 z-50 bg-[#e8eaf1] text-gray-900 shadow-[0_10px_24px_rgba(163,177,198,0.35)] transition-colors">
        {/* Wider than the page below it from 2xl up, and ONLY from 2xl up: that
            is exactly where the phone number joins the toolbar, and the three
            groups stopped fitting in 1216px. See the logo comment below. */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-[4.25rem] gap-2 sm:gap-4 xl:grid xl:grid-cols-[1fr_auto_1fr]">

            {/* Left: Brand Logo & Quality Badge
                min-w-0 and a logo that shrinks: at 320px (iPhone SE, and the
                cheaper Androids that are still most of Sweden's second phones)
                a 170px logo plus the four action pills measured 335px against
                288px of room, and the WHOLE SITE scrolled sideways — every
                page, because this bar is on every page. The logo gives up the
                width, since it is the one thing here that is still legible
                smaller.

                ON DESKTOP IT MAY NOT. That same rule ate the logo: the three
                groups want 1279px of a 1216px row as a guest and 1371px once
                somebody signs in (the name badge is worth 92px), the logo was
                the only shrinkable one, and it was squeezed to 15px while the
                170px picture inside it overflowed by 155px — where the nav
                capsule, being `relative`, painted straight over it. All the
                owner could see of his own logo was a 31px sliver. So: it does
                not shrink from xl up (min-w-0 keeps the phone behaviour, which
                is the case the note above is about), the picture itself now has
                min-w-0 so it can never overflow its box again whatever happens,
                and the width to fit it comes from the three trims marked
                HEADER BUDGET below. */}
            <div className="flex items-center space-x-3 space-x-reverse min-w-0 xl:shrink-0">
              <Link to="/" className="flex items-center space-x-2.5 space-x-reverse group min-w-0">
                {/* The wordmark alone — the name is IN the logo (src/lib/brandLogo.ts). */}
                <img
                  src={logoSrc(settings, settings.navbarBg === 'dark')}
                  alt={settings.siteName || 'ReklamX'}
                  width={BRAND_LOGO_SIZE.width}
                  height={BRAND_LOGO_SIZE.height}
                  className="h-7 sm:h-9 w-auto min-w-0 max-w-[7.75rem] min-[360px]:max-w-[9.375rem] sm:max-w-[11.875rem] object-contain object-left transition-opacity group-hover:opacity-80"
                />
              </Link>
            </div>

            {/* Desktop Center Navigation — the animated neumorphic capsule:
                the extruded pill slides between links (reference video #3). */}
            <div className="hidden xl:block">
              <NeoNavPill
                items={[
                  { to: '/', label: t('home') },
                  { to: '/services', label: t('ourServices') },
                  { to: '/products', label: t('webShop') },
                  { to: '/about', label: t('aboutUs') },
                  { to: '/contact', label: t('contact') },
                ]}
              />
            </div>

            {/* Desktop Right Action Tools — every control the same raised pill,
                the same height, the same gaps: tidy, one visual language. */}
            <div className="hidden xl:flex items-center gap-2 shrink-0 justify-self-end">
              {/* Call us: the icon alone in its circle — the number is its title
                  and its accessible name, and is printed in the footer. */}
              <a
                href={`tel:${settings.contactPhone ? settings.contactPhone.replace(/\s+/g, '') : '+46406143030'}`}
                title={settings.contactPhone || '+46 40 614 30 30'}
                aria-label={`${t('contact')}: ${settings.contactPhone || '+46 40 614 30 30'}`}
                className="w-9 h-9 flex items-center justify-center text-gray-600 hover:text-orange-700 transition-colors bg-[#eceef4] rounded-full shadow-[5px_5px_12px_#c9cdd8,-5px_-5px_12px_#ffffff]"
              >
                <Phone className="w-4 h-4" />
              </a>

              {/* Currency Selector Dropdown */}
              <div className="relative">
                <button 
                  onClick={() => {
                    setCurrencyDropdownOpen(!currencyDropdownOpen);
                    setLangDropdownOpen(false);
                    setUserDropdownOpen(false);
                  }}
                  title={t('appSelectCurrencyTitle')}
                  className="h-9 flex items-center gap-1 text-gray-600 hover:text-orange-600 transition-colors px-3 rounded-full bg-[#eceef4] shadow-[5px_5px_12px_#c9cdd8,-5px_-5px_12px_#ffffff] text-xs font-black"
                >
                  <Coins className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                  <span className="font-extrabold uppercase">{currencies[currency]?.code || currency}</span>
                  <ChevronDown className="w-3 h-3 text-gray-400" />
                </button>

                <AnimatePresence>
                  {currencyDropdownOpen && (
                    <motion.div 
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-gray-200 py-1.5 z-50 overflow-hidden"
                    >
                      <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50/80 flex items-center justify-between">
                        <span className="text-[0.625rem] font-black uppercase text-gray-400 tracking-wider">Currency</span>
                        <span className="text-[0.5625rem] font-bold text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-md">Live Rates</span>
                      </div>
                      <VatToggle includeVat={includeVat} setIncludeVat={setIncludeVat} t={t} />
                      {(Object.keys(currencies) as CurrencyCode[]).map((code) => {
                        const curr = currencies[code];
                        const isSelected = currency === code;
                        return (
                          <button
                            key={code}
                            onClick={() => {
                              setCurrency(code);
                              setCurrencyDropdownOpen(false);
                            }}
                            className={cn(
                              "w-full text-right px-3 py-2 text-xs font-bold flex items-center justify-between space-x-2 space-x-reverse hover:bg-orange-50 transition-colors",
                              isSelected ? "bg-orange-50 text-orange-600 font-black" : "text-gray-700"
                            )}
                          >
                            <div className="flex items-center space-x-2 space-x-reverse">
                              <span className="font-extrabold">{curr.code}</span>
                              <span className="text-gray-400 font-medium">({curr.symbol})</span>
                            </div>
                            <span className="text-[0.625rem] font-mono text-gray-400 font-semibold">
                              {curr.code === 'SEK' ? 'Base' : `x${curr.rateFromSEK}`}
                            </span>
                          </button>
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Shopping Cart Button */}
              <button
                type="button"
                onClick={() => setIsCartOpen(true)}
                title={t('appShoppingCartTitle')}
                className="relative w-9 h-9 rounded-full text-gray-600 hover:text-orange-600 bg-[#eceef4] shadow-[5px_5px_12px_#c9cdd8,-5px_-5px_12px_#ffffff] transition-colors flex items-center justify-center shrink-0 group"
              >
                <ShoppingCart className="w-4.5 h-4.5 text-gray-600 group-hover:text-orange-600 transition-transform duration-200 group-hover:scale-110" />
                {cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-orange-600 text-white text-[0.625rem] font-black w-4 h-4 rounded-full flex items-center justify-center border-2 border-white shadow-2xs">
                    {cartCount}
                  </span>
                )}
              </button>

              {/* User Sign In / Profile Dropdown with expanded spacing from Cart button */}
              {user ? (
                /* HEADER BUDGET: was ms-4 sm:ms-5 (20px) beside a 100px name.
                   Both paid for the logo above; the name still truncates. */
                <div className="relative ms-2">
                  <button
                    onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                    data-rx-account-menu
                    className="h-9 flex items-center gap-2 px-1.5 pr-2.5 rounded-full bg-[#eceef4] shadow-[5px_5px_12px_#c9cdd8,-5px_-5px_12px_#ffffff] hover:text-orange-600 transition-colors"
                  >
                    <img 
                      src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=bb965b&color=fff`} 
                      alt={user.displayName} 
                      className="w-7 h-7 rounded-full border border-gray-200 object-cover" 
                    />
                    <span className="text-xs font-black text-gray-800 max-w-[5.75rem] truncate">{user.displayName || user.email}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  </button>

                  <AnimatePresence>
                    {userDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-gray-200 py-2 z-50 overflow-hidden"
                      >
                        {/* User Profile Info */}
                        <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
                          <p className="text-xs font-black text-gray-900 truncate">{user.displayName || t('appAccountFallbackName')}</p>
                          <p className="text-[0.6875rem] font-medium text-gray-500 truncate">{user.email}</p>
                          {/* No role while the profile is a stand-in: "CUSTOMER" on the owner's
                              own account read as a locked account. */}
                          {!user.profileUnavailable && (
                            <div className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded-full text-[0.625rem] font-black uppercase tracking-wider bg-orange-100 text-orange-700" data-rx-role-badge>
                              {user.role === 'admin' ? t('umRoleAdmin') : (user.role === 'staff' || user.role === 'production') ? t('umRoleStaff') : t('umRoleClient')}
                            </div>
                          )}
                        </div>

                        {/* Role-Based Portals */}
                        <div className="py-1">
                          {/* Customer Portal (Always accessible for logged-in users) */}
                          <Link
                            to="/customer-dashboard"
                            onClick={() => setUserDropdownOpen(false)}
                            className="flex items-center px-4 py-2.5 text-xs font-black text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition-colors"
                          >
                            <UserIcon className="w-4 h-4 ml-2.5 text-orange-600 shrink-0" />
                            <span>{t('customerPortal')}</span>
                          </Link>

                          {/* Staff Workspace (Staff / Production / Admin) */}
                          {(user.role === 'admin' || user.role === 'staff' || user.role === 'production') && (
                            <Link
                              to="/staff-dashboard"
                              onClick={() => setUserDropdownOpen(false)}
                              className="flex items-center px-4 py-2.5 text-xs font-black text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition-colors"
                            >
                              <Printer className="w-4 h-4 ml-2.5 text-purple-600 shrink-0" />
                              <span>{t('staffWorkspace')}</span>
                            </Link>
                          )}

                          {/* Admin Panel (Admin Only) */}
                          {user.role === 'admin' && (
                            <Link
                              to="/admin"
                              onClick={() => setUserDropdownOpen(false)}
                              className="flex items-center px-4 py-2.5 text-xs font-black text-gray-700 hover:bg-orange-50 hover:text-orange-600 transition-colors"
                            >
                              <LayoutDashboard className="w-4 h-4 ml-2.5 text-orange-600 shrink-0" />
                              <span>{t('adminPanel')}</span>
                            </Link>
                          )}
                        </div>

                        {/* Logout Option */}
                        <div className="pt-1 border-t border-gray-100">
                          <button
                            onClick={() => {
                              setUserDropdownOpen(false);
                              logout();
                            }}
                            className="w-full flex items-center px-4 py-2 text-xs font-black text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <LogOut className="w-4 h-4 ml-2.5 shrink-0" />
                            <span>{t('signOut')}</span>
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <button
                  onClick={login}
                  title={t('signIn')}
                  aria-label={t('signIn')}
                  className="w-9 h-9 shrink-0 flex items-center justify-center bg-gradient-to-br from-orange-500 to-orange-700 hover:from-orange-600 hover:to-orange-800 text-white rounded-full transition-all shadow-[5px_5px_12px_rgba(194,65,12,.3),-5px_-5px_12px_#ffffff]"
                >
                  <UserIcon className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Mobile View Toggle & Actions */}
            <div className="flex xl:hidden items-center gap-1 min-[380px]:gap-1.5 sm:gap-2">
              {/* Mobile Shopping Cart Button */}
              <button
                type="button"
                onClick={() => setIsCartOpen(true)}
                title={t('appShoppingCartTitle')}
                className="relative w-9 h-9 rounded-full text-gray-700 bg-[#eceef4] shadow-[5px_5px_12px_#c9cdd8,-5px_-5px_12px_#ffffff] flex items-center justify-center shrink-0"
              >
                <ShoppingCart className="w-4.5 h-4.5 text-gray-700" />
                {cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 bg-orange-600 text-white text-[0.625rem] font-black w-4 h-4 rounded-full flex items-center justify-center border-2 border-white shadow-2xs">
                    {cartCount}
                  </span>
                )}
              </button>

              {/*
                CURRENCY AND LANGUAGE ON A PHONE: A LIST, NOT A GUESSING GAME.

                Both of these used to be "fast toggles" that advanced to the
                next item in a hidden list on every tap. With four currencies
                and four languages that meant a Norwegian visitor tapped three
                times to reach NOK, with nothing on screen saying that NOK was
                even offered, or which tap would land on it — and one tap too
                many started the loop again. The desktop header has shown the
                full list from the beginning; there is no reason the phone
                should be given a worse control for the same job.
              */}
              <div className="relative shrink-0">
                <button
                  onClick={() => { setCurrencyDropdownOpen(!currencyDropdownOpen); setLangDropdownOpen(false); setUserDropdownOpen(false); }}
                  aria-haspopup="listbox"
                  aria-expanded={currencyDropdownOpen}
                  title={t('appSelectCurrencyTitle')}
                  className="h-9 px-1.5 min-[380px]:px-2 sm:px-3 bg-[#eceef4] shadow-[5px_5px_12px_#c9cdd8,-5px_-5px_12px_#ffffff] rounded-full text-xs font-black text-gray-700 flex items-center gap-0.5 shrink-0"
                >
                  <span className="uppercase font-black">{currency}</span>
                  <ChevronDown className={cn('w-3 h-3 text-gray-400 transition-transform', currencyDropdownOpen && 'rotate-180')} />
                </button>
                <AnimatePresence>
                  {currencyDropdownOpen && (
                    <motion.div
                      role="listbox"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-gray-200 py-1.5 z-50 overflow-hidden"
                    >
                      <VatToggle includeVat={includeVat} setIncludeVat={setIncludeVat} t={t} />
                      {(Object.keys(currencies) as CurrencyCode[]).map((code) => (
                        <button
                          key={code}
                          role="option"
                          aria-selected={currency === code}
                          onClick={() => { setCurrency(code); setCurrencyDropdownOpen(false); }}
                          className={cn(
                            'w-full px-3 py-2.5 text-xs font-bold flex items-center justify-between hover:bg-orange-50 transition-colors',
                            currency === code ? 'bg-orange-50 text-orange-600 font-black' : 'text-gray-700',
                          )}
                        >
                          <span className="font-extrabold">{currencies[code].code}</span>
                          <span className="text-gray-400 font-medium">{currencies[code].symbol}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Mobile Menu Hamburger Toggle */}
              <button
                ref={menuButtonRef}
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                aria-label="Toggle Navigation Menu"
                className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 text-white hover:from-orange-600 hover:to-orange-800 transition-colors shadow-[5px_5px_12px_rgba(194,65,12,.3),-5px_-5px_12px_#ffffff] flex items-center justify-center"
              >
                {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>

          </div>
        </div>

        {/* Mobile Navigation Drawer / Dropdown
            xl:hidden, NOT lg:hidden — the button that opens this is `xl:hidden`
            too, and the two used to disagree. Between 1024px and 1279px — iPad
            in landscape, a 13" laptop with the browser not maximised — the
            hamburger was on screen and this drawer was `display:none`, so
            tapping the menu did nothing at all and there was no other way to
            reach Services, About or Contact. */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              ref={menuPanelRef}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="xl:hidden border-t border-gray-200/80 bg-white/98 backdrop-blur-xl shadow-2xl overflow-hidden"
            >
              <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
                
                {/* Navigation Links Grid */}
                <div className="grid grid-cols-1 gap-2">
                  <Link 
                    to="/" 
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 hover:bg-orange-50 text-gray-900 font-extrabold text-xs transition-colors border border-gray-200/60"
                  >
                    <span>{t('home').toUpperCase()}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  </Link>

                  <Link 
                    to="/services" 
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 hover:bg-orange-50 text-gray-900 font-extrabold text-xs transition-colors border border-gray-200/60"
                  >
                    <span>{t('ourServices').toUpperCase()}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  </Link>

                  <Link 
                    to="/products" 
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-orange-500 text-white font-extrabold text-xs shadow-md transition-colors"
                  >
                    <span>{t('webShop').toUpperCase()}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>

                  <Link
                    to="/about"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 hover:bg-orange-50 text-gray-900 font-extrabold text-xs transition-colors border border-gray-200/60"
                  >
                    <span>{t('aboutUs').toUpperCase()}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  </Link>

                  <Link 
                    to="/contact" 
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 hover:bg-orange-50 text-gray-900 font-extrabold text-xs transition-colors border border-gray-200/60"
                  >
                    <span>{t('contact').toUpperCase()}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  </Link>

                  {/* Staff Workspace (Staff / Production / Admin) */}
                  {user && (user.role === 'admin' || user.role === 'staff' || user.role === 'production') && (
                    <Link 
                      to="/staff-dashboard" 
                      onClick={() => setIsMenuOpen(false)}
                      className="flex items-center justify-between p-3 rounded-2xl bg-gray-50 hover:bg-orange-50 text-gray-900 font-extrabold text-sm transition-colors border border-gray-200/60"
                    >
                      <span className="flex items-center">
                        <Printer className="w-4 h-4 text-purple-600 mr-2.5 shrink-0" />
                        {t('staffWorkspace')}
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </Link>
                  )}

                  {/* Admin Panel (Admin Only) */}
                  {user && user.role === 'admin' && (
                    <Link 
                      to="/admin" 
                      onClick={() => setIsMenuOpen(false)}
                      className="flex items-center justify-between p-3 rounded-2xl bg-gray-900 text-white font-extrabold text-sm transition-colors"
                    >
                      <span className="flex items-center">
                        <LayoutDashboard className="w-4 h-4 text-orange-500 mr-2.5 shrink-0" />
                        {t('adminPanel')}
                      </span>
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </Link>
                  )}
                </div>

                {/* Mobile Quick Contact */}
                <div className="pt-2 border-t border-gray-100 flex flex-col sm:flex-row gap-2">
                  <a 
                    href={`tel:${settings.contactPhone ? settings.contactPhone.replace(/\s+/g, '') : '+46406143030'}`}
                    className="flex-1 flex items-center justify-center p-3 bg-gray-100 rounded-2xl text-xs font-black text-gray-800 border border-gray-200"
                  >
                    <Phone className="w-4 h-4 text-orange-600 mr-2 shrink-0" />
                    <span dir="ltr">{settings.contactPhone || '+46 40 614 30 30'}</span>
                  </a>
                  <a 
                    href={`mailto:${settings.contactEmail || 'info@reklamx.se'}`}
                    className="flex-1 flex items-center justify-center p-3 bg-gray-100 rounded-2xl text-xs font-black text-gray-800 border border-gray-200"
                  >
                    <Mail className="w-4 h-4 text-orange-600 mr-2 shrink-0" />
                    <span>{settings.contactEmail || 'info@reklamx.se'}</span>
                  </a>
                </div>

                {/* Mobile Auth (language and VAT are chosen in WelcomeQuestions) */}
                <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-3">
                  {user ? (
                    <button 
                      onClick={() => { logout(); setIsMenuOpen(false); }}
                      className="px-4 py-2 bg-red-50 text-red-600 text-xs font-black rounded-xl border border-red-200 whitespace-nowrap"
                    >
                      {t('signOut')}
                    </button>
                  ) : (
                    <button 
                      onClick={() => { login(); setIsMenuOpen(false); }}
                      className="px-5 py-2 bg-gray-900 text-white text-xs font-black rounded-xl shadow-md whitespace-nowrap"
                    >
                      {t('signIn')}
                    </button>
                  )}
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Dynamic Announcement Bar — under the navbar, not above it (owner, 2026-10-15). */}
      {settings.showAnnouncementBar && settings.announcementText && announcementLive && (
        <div 
          className="px-4 py-1.5 text-[0.6875rem] font-extrabold text-center text-white transition-all shadow-2xs flex items-center justify-center space-x-2 space-x-reverse"
          style={{ backgroundColor: settings.announcementBg || '#1e293b' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
          <span>{localized(settings.announcementText, settings.announcementTextI18n, language)}</span>
        </div>
      )}

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onCartUpdated={updateCartCount}
      />
    </>
  );
};

// The demo product that used to live here is gone. The dashboard still ships it
// (ProductsAdmin's "Restore roll labels" seed) so the owner can add it back on
// purpose — which is the difference between a starting point and a catalogue that
// refuses to stay deleted.

const ProductsPage = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // True once the categories have been asked for, whatever the answer.
  const [categoriesReady, setCategoriesReady] = useState(false);
  // Both the server and the direct read failed: the page says so (2026-10-13)
  // instead of a silent "0 categories" over an empty page.
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // Paging state. `products` is now ONE PAGE of the current filter, not the
  // catalogue — see the fetch below. `productTotal` is how many match the filter
  // in the database, which is the number to show the customer; products.length
  // is only how many have been fetched so far.
  const [productTotal, setProductTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [productsLoading, setProductsLoading] = useState(false);
  // False only when the endpoint failed and the browser is on its Firestore
  // fallback, which returns an unfiltered 60 and must be filtered here.
  const [serverFiltered, setServerFiltered] = useState(true);
  // How many products each category holds, keyed by the raw categoryId. Counting
  // used to mean holding the whole catalogue in memory.
  const [catalogueCounts, setCatalogueCounts] = useState<Record<string, number>>({});
  const [catalogueTotal, setCatalogueTotal] = useState(0);
  const { language, formatPriceWithVat, t } = useAuth();
  const { settings: siteSettings } = useSiteSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategoryParam = searchParams.get('category') || 'all';
  const [selectedCategory, setSelectedCategory] = useState<string>(activeCategoryParam);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryDrawerOpen, setCategoryDrawerOpen] = useState(false);
  const [drawerCategorySearch, setDrawerCategorySearch] = useState('');

  /**
   * EVERY form of every category the selection covers.
   *
   * Two things stack here. Products are filed under a category's document id OR
   * its canonical name — both forms are in the live data — and categories now
   * nest, so choosing a parent means its whole subtree (D4: a parent leads to
   * its descendants' PRODUCTS, not to another list of categories to click).
   *
   * Computed once and used by both the first page and Show more, because two
   * copies of this is how the second page of a category quietly becomes the
   * second page of something else.
   */
  const categoryFilterForms = useMemo(() => {
    if (selectedCategory === 'all') return [];
    const forms = new Set<string>([selectedCategory]);
    for (const id of descendantIds(categories, selectedCategory)) {
      forms.add(id);
      const cat = categories.find((c) => c.id === id);
      if (cat?.name) forms.add(cat.name);
    }
    // A selection made by NAME (an old bookmark) resolves to the same subtree.
    const byName = categories.find((c) => c.name === selectedCategory);
    if (byName) {
      for (const id of descendantIds(categories, byName.id)) {
        forms.add(id);
        const cat = categories.find((c) => c.id === id);
        if (cat?.name) forms.add(cat.name);
      }
    }
    return [...forms].filter(Boolean);
  }, [selectedCategory, categories]);

  /**
   * The category whose ARRANGED product order this page follows — the owner
   * drags a category's products into order in the dashboard and the server
   * sorts by it (src/lib/ownerOrder.ts). A search across the shop sends none.
   */
  const orderCategoryId = useMemo(() => {
    if (selectedCategory === 'all') return null;
    const cat = categories.find((c) => c.id === selectedCategory) ?? categories.find((c) => c.name === selectedCategory);
    return cat?.id ?? null;
  }, [selectedCategory, categories]);

  /** Only the top of the tree gets a tile; the rest are reached by opening one. */
  const rootCategories = useMemo(
    () => buildCategoryTree(categories).map((n) => n.category),
    [categories],
  );

  /** Root → … → here, so a shopper three levels down can see where they are. */
  const categoryTrail = useMemo(() => {
    if (selectedCategory === 'all') return [];
    const byId = categories.find((c) => c.id === selectedCategory)
      ?? categories.find((c) => c.name === selectedCategory);
    return byId ? breadcrumb(categories, byId.id) : [];
  }, [selectedCategory, categories]);

  useEffect(() => {
    if (activeCategoryParam !== selectedCategory) {
      setSelectedCategory(activeCategoryParam);
    }
  }, [activeCategoryParam]);

  useEffect(() => {
    const fetchData = async () => {
      // THE CATEGORIES COME FROM THE SERVER NOW.
      //
      // Every visitor used to read this collection out of Firestore himself, and
      // the home page reads it too — so two reads of the whole collection per
      // person. On 2026-09-12 the project's free daily read quota ran out: 20 of
      // 20 probe reads came back refused and this page rendered "0 categories",
      // an empty shop, for everyone. /api/categories reads them once every five
      // minutes on the server and hands the same answer to everybody, which is
      // what /api/catalogue has done for the products since round 12.
      //
      // The Firestore read stays as the fallback, so if the endpoint is down the
      // shop behaves exactly as it did before rather than showing nothing.
      try {
        const resp = await fetch('/api/categories');
        const data = resp.ok ? await resp.json() : null;
        if (Array.isArray(data?.categories) && data.categories.length > 0) {
          setCategories(data.categories as Category[]);
        } else {
          throw new Error('categories unavailable');
        }
      } catch {
        try {
          const catSnapshot = await getDocs(collection(db, 'categories'));
          // isHidden lets junk or not-yet-ready entries (test categories, broken
          // imports) be taken off the storefront without deleting the data —
          // clearing the flag in Firestore brings them straight back.
          const catData = catSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() } as Category))
            .filter((c) => c.isHidden !== true);
          if (catData.length > 0) {
            setCategories(catData);
          }
        } catch (e) {
          console.warn('Notice fetching categories (using defaults):', e);
          setCategoriesFailed(true);
        }
      }
      setCategoriesReady(true);

      // The COUNTS, not the catalogue.
      //
      // The sidebar and the category tiles each need "how many products are in
      // this category", and the only way the page had to answer that was to hold
      // every product in memory and count them. That is the thing this task
      // exists to stop: 33 products is 30 KB, but midocean alone is 2519, and
      // the browser would be downloading the whole shop in order to render a
      // number beside each tile.
      //
      // /api/catalogue/counts is a few hundred bytes whatever the catalogue
      // holds. It is keyed by the RAW categoryId stored on the product, because
      // live data files products under the category's id AND under its canonical
      // name; the tiles add both together, the way every other join here does.
      try {
        const resp = await fetch('/api/catalogue/counts');
        const data = resp.ok ? await resp.json() : null;
        if (data && typeof data.total === 'number') {
          setCatalogueCounts(data.byCategory ?? {});
          setCatalogueTotal(data.total);
        }
      } catch {
        // Not fatal: with no counts the tiles show nothing rather than a wrong
        // number, and the products themselves still load.
      }
    };

    fetchData();
  }, []);

  // THE PRODUCTS, ONE PAGE AT A TIME, AND RE-FETCHED WHEN THE FILTER CHANGES.
  //
  // WHAT THIS USED TO DO, AND WHY IT WAS WRONG
  // If the shop had no products, the browser injected eight hard-coded demo
  // items and wrote one of them back into Firestore from the visitor's own
  // session. The owner deleted every product, reloaded, and the demo catalogue
  // was back; he assumed the delete had failed. It had not — the shop was
  // re-seeding itself from a customer's browser on every visit. The catalogue is
  // now exactly what is in the database.
  //
  // Then it fetched ALL of it, filtered in the browser, and rendered the lot.
  // That was already the wrong shape at 111 products and is unusable at the
  // thousands the supplier feeds bring. The server now does the filtering and
  // the paging: the category and the search text go to it, and one page comes
  // back with a cursor for the next.
  //
  // The Firestore read stays as the fallback, capped at 60 exactly as before, so
  // an unreachable endpoint degrades the shop to its old behaviour instead of to
  // an empty page. The fallback filters in the browser — with the SAME rules the
  // server uses, imported from src/lib/catalogueQuery.ts, so the two can never
  // disagree about what matches.
  // ONE REQUEST PER FILTER. The catalogue is asked for when what is asked for
  // changes — not every time the categories list does. And a category page waits
  // for the categories, because its filter names the category's whole subtree
  // (ids and names) and that is only known once they are here: asking first
  // fetched the catalogue twice, "Banners" and then "Banners,BANNERS" (the
  // client's audit, 2026-10-10).
  const catalogueParams = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedCategory !== 'all') params.set('category', categoryFilterForms.join(','));
    if (orderCategoryId) params.set('order', orderCategoryId);
    const needle = searchQuery.trim();
    if (needle) params.set('q', needle);
    return params.toString();
  }, [selectedCategory, categoryFilterForms, orderCategoryId, searchQuery]);
  const catalogueReady = selectedCategory === 'all' || categoriesReady;

  useEffect(() => {
    if (!catalogueReady) return;
    let cancelled = false;

    // A keystroke is not a search. Without this, typing "rollup" is six requests
    // and the answers can arrive out of order.
    const timer = setTimeout(() => {
      void (async () => {
        setProductsLoading(true);
        try {
          const resp = await fetch(`/api/catalogue?${catalogueParams}`);
          const data = resp.ok ? await resp.json() : null;
          if (!Array.isArray(data?.products)) throw new Error('catalogue unavailable');
          if (cancelled) return;
          setProducts(data.products as Product[]);
          setProductTotal(typeof data.total === 'number' ? data.total : data.products.length);
          setNextCursor(data.nextCursor ?? null);
          setServerFiltered(true);
        } catch {
          try {
            const q = query(collection(db, 'products'), limit(60));
            const snapshot = await getDocs(q);
            if (cancelled) return;
            const finalProducts = snapshot.docs
              .map((d) => ({ id: d.id, ...d.data() } as Product))
              .filter((p) => p.isHidden !== true);
            setProducts(finalProducts);
            setProductTotal(finalProducts.length);
            setNextCursor(null);
            setServerFiltered(false);
          } catch (e) {
            console.warn('Notice fetching products (using defaults):', e);
          }
        } finally {
          if (!cancelled) { setProductsLoading(false); setLoading(false); }
        }
      })();
    }, searchQuery.trim() ? 300 : 0);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [catalogueParams, catalogueReady]);

  /** The next page, appended. Only ever reachable when the server answered. */
  const loadMoreProducts = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.set('category', categoryFilterForms.join(','));
      // The SAME order as the first page, or the cursor would point into a
      // differently sorted list and the next page would skip or repeat.
      if (orderCategoryId) params.set('order', orderCategoryId);
      const needle = searchQuery.trim();
      if (needle) params.set('q', needle);
      params.set('cursor', nextCursor);

      const resp = await fetch(`/api/catalogue?${params.toString()}`);
      const data = resp.ok ? await resp.json() : null;
      if (Array.isArray(data?.products)) {
        // Merged by id. The cursor names the last product served rather than an
        // offset precisely so a page cannot be skipped, but a product that moved
        // could still arrive twice, and React would warn on the duplicate key.
        setProducts((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...(data.products as Product[]).filter((p) => !seen.has(p.id))];
        });
        setNextCursor(data.nextCursor ?? null);
      }
    } catch {
      // Leaving the button in place is the honest outcome: nothing was added and
      // pressing it again is a reasonable thing to do.
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSelectCategory = (catId: string) => {
    setSelectedCategory(catId);
    if (catId === 'all') {
      setSearchParams({});
    } else {
      setSearchParams({ category: catId });
    }
  };

  // The selection arrives in either form: the sidebar sends the document id,
  // while a bookmarked or shared ?category= link can still carry the NAME, which
  // is also what older products file themselves under. Resolve it to the
  // category once, on its CANONICAL name — a translated name must never reach a
  // comparison, see the note on Category.nameI18n in src/types/index.ts.
  const activeCategory = categories.find(c => c.id === selectedCategory || c.name === selectedCategory);

  // The SERVER filtered these. Filtering them again here would be a second,
  // slightly different implementation of the same rule — which is exactly how
  // the old category test drifted into a lowercase substring hunt where
  // 'beachflags'.includes('flags') was true, so clicking FLAGS listed the beach
  // flags while the count beside it said 0.
  //
  // The one case that still needs filtering is the Firestore fallback, which
  // returns an unfiltered 60. It uses the very same functions the server uses.
  const filteredProducts = serverFiltered
    ? products
    : products.filter((p) => matchesCatalogueFilters(
        p,
        selectedCategory === 'all'
          ? null
          : [selectedCategory, activeCategory?.id, activeCategory?.name].filter(Boolean) as string[],
        normaliseQuery(searchQuery),
      ));

  /**
   * A category's products, INCLUDING everything nested under it.
   *
   * Counted the way every join in the shop counts them — the id OR the canonical
   * name, because both forms are in the live data — and summed across the
   * subtree, because a parent tile that leads to 300 products must not say 0
   * just because they are all filed under its children.
   */
  const countForCategory = (cat: Category) =>
    descendantIds(categories, cat.id).reduce((sum, id) => {
      const child = categories.find((c) => c.id === id);
      return sum
        + (catalogueCounts[id] ?? 0)
        + (child?.name && child.name !== id ? (catalogueCounts[child.name] ?? 0) : 0);
    }, 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8" dir="ltr">
      
      {/* Header Title */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          {/* THE HEADING SAYS WHERE YOU ARE (2026-10-13): inside a category it is
              that category's own name and description, with its parent (or the
              shop) above it — not "Our products & categories" on every page. */}
          {(() => {
            const openCat = selectedCategory === 'all'
              ? null
              : categories.find((c) => c.id === selectedCategory) ?? categories.find((c) => c.name === selectedCategory) ?? null;
            const parentCat = openCat?.parentId ? categories.find((c) => c.id === openCat.parentId) ?? null : null;
            const openName = openCat ? localized(openCat.name, openCat.nameI18n, language) : '';
            const openDesc = openCat ? localized(openCat.description || '', openCat.descriptionI18n, language) : '';
            return (
              <>
                <div className="flex items-center space-x-2.5 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-orange-600 inline-block" />
                  <span className="text-xs font-black uppercase tracking-widest text-orange-700">
                    {openCat ? (parentCat ? localized(parentCat.name, parentCat.nameI18n, language) : t('webShop')) : t('shopEyebrow')}
                  </span>
                </div>
                <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight">
                  {openCat ? openName : t('shopTitle')}
                </h1>
                {(openCat ? openDesc : t('shopSubtitle')) && (
                  <p className="text-xs sm:text-sm text-gray-500 mt-1 font-medium">
                    {openCat ? openDesc : t('shopSubtitle')}
                  </p>
                )}
              </>
            );
          })()}
        </div>

        {/* Search Input */}
        <div className="w-full md:w-80 relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('shopSearchPlaceholder')}
            // A placeholder is not a label: it vanishes as he types and screen
            // readers do not announce it reliably.
            aria-label={t('shopSearchPlaceholder')}
            className="w-full pl-10 pr-4 py-3 bg-white rounded-2xl text-xs font-bold border border-gray-200 shadow-2xs focus:outline-hidden focus:border-orange-500 transition-colors"
          />
        </div>
      </div>

      {categoriesFailed && categories.length === 0 && (
        <div className="rounded-3xl border border-gray-200/90 bg-white px-6 py-12 text-center" role="status">
          <p className="text-base font-semibold text-gray-900">{t('homeCategoriesFailed')}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 inline-flex items-center gap-2 bg-gray-900 hover:bg-orange-700 text-white text-sm font-bold px-5 py-3 rounded-full transition-colors"
          >
            {t('homeCategoriesRetry')}
          </button>
        </div>
      )}

      {/* Category Side Drawer Bar */}
      <div className="bg-white p-3.5 sm:p-4 rounded-3xl border border-gray-200/80 shadow-xs flex items-center justify-between gap-3">
        <div className="flex items-center space-x-2.5 space-x-reverse">
          {/* Side Drawer Toggle Button */}
          <button
            onClick={() => setCategoryDrawerOpen(true)}
            className="px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl text-xs font-black transition-all flex items-center space-x-2 space-x-reverse shadow-md shadow-orange-600/20 cursor-pointer active:scale-95"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>{t('shopCategoryDrawer')}</span>
            <span className="bg-white/20 px-2 py-0.5 rounded-full text-[0.625rem]">
              {selectedCategory === 'all' 
                ? t('shopCategoriesCount').replace('{0}', String(categories.length))
                : (() => {
                    const active = categories.find(c => c.id === selectedCategory || c.name === selectedCategory);
                    return active ? localized(active.name, active.nameI18n, language) : selectedCategory;
                  })()}
            </span>
          </button>

          {selectedCategory !== 'all' && (
            <button
              onClick={() => handleSelectCategory('all')}
              className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-2xl text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer"
              title={t('shopClearFilter')}
            >
              <X className="w-3.5 h-3.5" />
              <span>{t('shopReset')}</span>
            </button>
          )}
        </div>
      </div>

      {/* SLIDE-OUT SIDE DRAWER FOR FILTER BY CATEGORY */}
      <AnimatePresence>
        {categoryDrawerOpen && (
          <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
            {/* Overlay Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCategoryDrawerOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            />

            {/* Sliding Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 220 }}
              className="relative w-full max-w-sm sm:max-w-md bg-white h-full shadow-2xl flex flex-col z-10 border-l border-gray-200"
            >
              {/* Drawer Header */}
              <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-orange-50/50 to-amber-50/30">
                <div className="flex items-center space-x-3 space-x-reverse">
                  <div className="p-2.5 bg-orange-600 text-white rounded-2xl shadow-md shadow-orange-600/20">
                    <SlidersHorizontal className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-gray-900">
                      {t('shopCategoryDrawer')}
                    </h2>
                    <p className="text-xs text-gray-500 font-medium">
                      {t('shopCategoryDrawerHint')}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setCategoryDrawerOpen(false)}
                  className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-2xl transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Category Search */}
              <div className="p-4 border-b border-gray-100 bg-gray-50/50">
                <div className="relative">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={drawerCategorySearch}
                    onChange={(e) => setDrawerCategorySearch(e.target.value)}
                    placeholder={t('shopSearchCategories')}
                    className="w-full pl-10 pr-4 py-2.5 bg-white rounded-xl text-xs font-bold border border-gray-200 shadow-2xs focus:outline-hidden focus:border-orange-500 transition-colors"
                  />
                  {drawerCategorySearch && (
                    <button 
                      onClick={() => setDrawerCategorySearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Category List Scroll View */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {/* All Categories Option */}
                <button
                  onClick={() => {
                    handleSelectCategory('all');
                    setCategoryDrawerOpen(false);
                  }}
                  className={cn(
                    "w-full p-3.5 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer group",
                    selectedCategory === 'all'
                      ? "bg-orange-600 text-white border-orange-600 shadow-md shadow-orange-600/20"
                      : "bg-white hover:bg-orange-50/50 border-gray-200/80 hover:border-orange-200 text-gray-800"
                  )}
                >
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className={cn(
                      "p-2.5 rounded-xl transition-colors",
                      selectedCategory === 'all' ? "bg-white/20 text-white" : "bg-orange-100 text-orange-600 group-hover:bg-orange-200"
                    )}>
                      <LayoutGrid className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="font-extrabold text-sm block">
                        {t('shopAllCategories')}
                      </span>
                      <span className={cn(
                        "text-xs block font-medium mt-0.5",
                        selectedCategory === 'all' ? "text-white/80" : "text-gray-400"
                      )}>
                        {t('shopTotalItems').replace('{0}', String(catalogueTotal))}
                      </span>
                    </div>
                  </div>

                  {selectedCategory === 'all' && (
                    <CheckCircle2 className="w-5 h-5 text-white shrink-0 ml-2" />
                  )}
                </button>

                {/* Filtered Categories List */}
                {categories
                  .filter(cat => {
                    const term = drawerCategorySearch.trim().toLowerCase();
                    if (!term) return true;
                    return (
                      cat.name.toLowerCase().includes(term) ||
                      cat.id.toLowerCase().includes(term) ||
                      localized(cat.name, cat.nameI18n, language).toLowerCase().includes(term)
                    );
                  })
                  .map((cat) => {
                    const isSelected = selectedCategory === cat.id || selectedCategory === cat.name;
                    const count = countForCategory(cat);

                    // Resolve icon helper.
                    // CANONICAL name on purpose: the tests below are English
                    // keywords, so a Swedish name would match none of them and
                    // every category would fall back to the generic icon.
                    const nameLower = (cat.name || cat.id).toLowerCase();
                    const catLabel = localized(cat.name, cat.nameI18n, language);
                    let catIcon = <Layers className="w-5 h-5" />;
                    if (nameLower.includes('card')) catIcon = <CreditCard className="w-5 h-5" />;
                    else if (nameLower.includes('banner') || nameLower.includes('format')) catIcon = <Flag className="w-5 h-5" />;
                    else if (nameLower.includes('box') || nameLower.includes('packag')) catIcon = <Box className="w-5 h-5" />;
                    else if (nameLower.includes('label') || nameLower.includes('sticker')) catIcon = <Tag className="w-5 h-5" />;
                    else if (nameLower.includes('exhibition') || nameLower.includes('display')) catIcon = <Monitor className="w-5 h-5" />;
                    else if (nameLower.includes('cup')) catIcon = <Coffee className="w-5 h-5" />;
                    else if (nameLower.includes('illuminat') || nameLower.includes('sign')) catIcon = <Sparkles className="w-5 h-5" />;

                    return (
                      <button
                        key={cat.id}
                        onClick={() => {
                          handleSelectCategory(cat.id);
                          setCategoryDrawerOpen(false);
                        }}
                        className={cn(
                          "w-full p-3.5 rounded-2xl border text-left flex items-center justify-between transition-all cursor-pointer group",
                          isSelected
                            ? "bg-gradient-to-r from-orange-600 to-amber-600 text-white border-orange-600 shadow-md shadow-orange-600/20"
                            : "bg-white hover:bg-orange-50/50 border-gray-200/80 hover:border-orange-200 text-gray-800"
                        )}
                      >
                        <div className="flex items-center space-x-3 space-x-reverse">
                          {cat.image ? (
                            <img
                              src={cat.image}
                              alt={catLabel}
                              // contain, like the home grid and the dashboard:
                              // this thumbnail identifies a category, and a
                              // centre-crop of a tall picture identifies nothing.
                              className="w-10 h-10 rounded-xl object-contain bg-white p-0.5 border border-gray-200 shrink-0"
                            />
                          ) : (
                            <div className={cn(
                              "p-2.5 rounded-xl transition-colors shrink-0",
                              isSelected ? "bg-white/20 text-white" : "bg-gray-100 text-gray-700 group-hover:bg-orange-100 group-hover:text-orange-600"
                            )}>
                              {catIcon}
                            </div>
                          )}

                          <div>
                            <span className="font-extrabold text-sm block">
                              {catLabel}
                            </span>
                            <span className={cn(
                              "text-xs block font-medium mt-0.5",
                              isSelected ? "text-white/80" : "text-gray-400"
                            )}>
                              {t('shopProductsAvailable').replace('{0}', String(count))}
                            </span>
                          </div>
                        </div>

                        {isSelected && (
                          <CheckCircle2 className="w-5 h-5 text-white shrink-0 ml-2" />
                        )}
                      </button>
                    );
                  })}
              </div>

              {/* Drawer Footer Actions */}
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center gap-3">
                <button
                  onClick={() => {
                    handleSelectCategory('all');
                    setCategoryDrawerOpen(false);
                  }}
                  className="flex-1 py-3 bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 rounded-2xl text-xs font-bold transition-colors cursor-pointer"
                >
                  {t('shopResetAllFilters')}
                </button>
                <button
                  onClick={() => setCategoryDrawerOpen(false)}
                  className="flex-1 py-3 bg-gray-900 hover:bg-black text-white rounded-2xl text-xs font-black transition-colors cursor-pointer"
                >
                  {t('shopCloseDrawer')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* THE SHOP OPENS ON THE CATEGORIES, NOT ON EVERY PRODUCT AT ONCE.
          The page has always said "Browse everything we print, by category" and
          then listed products, so a visitor met a flat wall of whatever happened
          to sort first — 111 products today and thousands coming from the
          supplier feeds. The owner asked for this twice, in a screenshot and in
          a screen recording. Pick a category, then see what is in it.
          A search still searches the WHOLE catalogue: typing is asking for a
          product, not for a category. */}
      {/* WHERE THE SHOPPER IS. Categories nest now, and three levels down with
          no trail is the point at which people press Back instead of buying. */}
      {categoryTrail.length > 0 && !searchQuery.trim() && (
        <nav className="flex items-center gap-1.5 flex-wrap text-xs font-bold" aria-label="breadcrumb">
          <button
            type="button"
            onClick={() => { setSelectedCategory('all'); setSearchParams({}); }}
            className="text-gray-500 hover:text-orange-600 transition-colors"
          >
            {t('shopAllCategories')}
          </button>
          {categoryTrail.map((cat, i) => (
            <span key={cat.id} className="flex items-center gap-1.5">
              <span className="text-gray-300">/</span>
              {i === categoryTrail.length - 1 ? (
                <span className="text-gray-900">{localized(cat.name, cat.nameI18n, language)}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => { setSelectedCategory(cat.id); setSearchParams({ category: cat.id }); }}
                  className="text-gray-500 hover:text-orange-600 transition-colors"
                >
                  {localized(cat.name, cat.nameI18n, language)}
                </button>
              )}
            </span>
          ))}
        </nav>
      )}

      {/* The children of wherever he is. A parent still shows all of its
          descendants' products below (D4) — these are a shortcut, not a wall he
          has to click through first. */}
      {selectedCategory !== 'all' && !searchQuery.trim() && (() => {
        const here = categories.find((c) => c.id === selectedCategory || c.name === selectedCategory);
        const children = here ? categories.filter((c) => c.parentId === here.id) : [];
        if (children.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-2">
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => { setSelectedCategory(child.id); setSearchParams({ category: child.id }); }}
                className="px-4 py-2 bg-white border border-gray-200 rounded-2xl text-xs font-black text-gray-700 hover:border-orange-400 hover:text-orange-600 transition-colors"
              >
                {localized(child.name, child.nameI18n, language)}
                <span className="ml-1.5 text-[0.625rem] text-gray-400">{countForCategory(child)}</span>
              </button>
            ))}
          </div>
        );
      })()}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="bg-white rounded-3xl border border-gray-100 p-6 h-80 animate-pulse" />
          ))}
        </div>
      ) : selectedCategory === 'all' && !searchQuery.trim() ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {rootCategories.map((cat, i) => {
            // Its own products, counted the way every other join in the shop
            // counts them: the id OR the canonical name, because both forms are
            // in the live data. A translated name never enters this.
            const count = countForCategory(cat);
            const label = localized(cat.name, cat.nameI18n, language);
            return (
              <motion.button
                key={cat.id}
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.4) }}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  setSearchParams({ category: cat.id });
                }}
                className="group bg-white rounded-3xl border border-gray-200/80 shadow-xs hover:shadow-xl hover:border-orange-200 transition-all overflow-hidden text-left flex flex-col"
              >
                {/* Square + contain, the framing the dashboard and the home page
                    both use — a centre-crop hid half of the ROLLUPS picture and
                    the owner reported it as a broken image. */}
                <div className="aspect-square bg-gray-50 p-3 overflow-hidden">
                  {/* Rounded to match the card: 12px = its 24px corner less the 12px padding. */}
                  <div className="w-full h-full rounded-xl overflow-hidden">
                    <SafeImage
                      src={cat.image || '/placeholder-print.svg'}
                      alt={label}
                      fallbackLabel={label}
                      className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>
                <div className="p-5 flex-1 flex flex-col justify-between gap-2">
                  <div>
                    <h3 className="text-base font-black text-gray-900 group-hover:text-orange-600 transition-colors">
                      {label}
                    </h3>
                    {localized(cat.description || '', cat.descriptionI18n, language) && (
                      <p className="text-xs font-medium text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                        {localized(cat.description || '', cat.descriptionI18n, language)}
                      </p>
                    )}
                  </div>
                  {/* The count is on the tile so an empty category cannot look
                      like a full one. The owner asked for them NOT to be hidden
                      — "لا تخفيها" — so they are shown and labelled instead. */}
                  <span className="text-[0.6875rem] font-black uppercase tracking-wider text-gray-400 group-hover:text-orange-600 transition-colors">
                    {t('shopProductsAvailable').replace('{0}', String(count))}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-gray-200 space-y-4">
          <Package className="w-12 h-12 text-gray-300 mx-auto" />
          <h3 className="text-lg font-bold text-gray-800">
            {t('shopEmptyTitle')}
          </h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto">
            {t('shopEmptyBody')}
          </p>
          <button
            onClick={() => {
              setSelectedCategory('all');
              setSearchQuery('');
              setSearchParams({});
            }}
            className="px-5 py-2.5 bg-orange-600 text-white text-xs font-black rounded-2xl hover:bg-orange-500 transition-colors inline-block"
          >
            {t('shopShowAll')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {filteredProducts.map((product, i) => {
            // THE CARD ASKS THE SAME FUNCTION THE PRODUCT PAGE ASKS — the
            // minimum-price floor can lift an offer straight back to the list
            // price, and a card advertising "−19%, from 120 kr" for a product
            // its page charged 149 for was this grid's bug. The rule lives in
            // src/lib/cardPrice.ts now, because the suggestions under a product
            // show the same cards and must say the same thing.
            const card = cardPrices(product);
            const cardOnSale = card.onSale;
            const cardOffPercent = card.offPercent;
            const priceInfo = formatPriceWithVat(card.price);
            const listPriceInfo = card.listPrice !== null ? formatPriceWithVat(card.listPrice) : null;
            const productName = localized(product.name, product.nameI18n, language);
            const categoryObj = categories.find(c => c.id === product.categoryId || c.name === product.categoryId);

            return (
              <motion.div 
                key={product.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="group bg-white rounded-3xl border border-gray-200/80 shadow-2xs hover:shadow-2xl hover:border-orange-300 transition-all overflow-hidden flex flex-col"
              >
                {/* The card opens the product's own page — that is the address a
                    shopper can bookmark or send on. "Customize" below is the
                    shortcut for someone who only wants to configure and buy. */}
                {/* The square is kept here, and only here: a grid of cards has
                    to line up, and a card whose height follows its picture
                    breaks every row it is in. What changes is object-cover ->
                    object-contain, so the square decides the SPACE and never
                    the crop — the shopper sees the whole product on the card
                    and the same whole product on its page. */}
                <Link to={productPath(product)} className="aspect-square overflow-hidden relative bg-gray-50 block p-3">
                  <div className="w-full h-full rounded-xl overflow-hidden">
                    <SafeImage
                      src={product.images && product.images.length > 0 ? product.images[0] : '/placeholder-print.svg'}
                      alt={productName}
                      fallbackLabel={productName}
                      className="w-full h-full object-contain group-hover:scale-[1.04] transition-transform duration-500"
                    />
                  </div>
                  
                  {/* Category Tag */}
                  {categoryObj && (
                    <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-md text-white text-[0.5625rem] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider">
                      {localized(categoryObj.name, categoryObj.nameI18n, language)}
                    </div>
                  )}

                  {/* Two badges share the top-left corner. The offer goes on
                      top because it is the one that decides whether someone
                      stops scrolling; Web2Print drops below it rather than
                      being replaced, since a product can be both. */}
                  {cardOnSale && (
                    <div className="absolute top-3 left-3 bg-red-600 text-white text-[0.5625rem] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider shadow-sm">
                      {t('shopSaleBadge').replace('{0}', String(cardOffPercent))}
                    </div>
                  )}
                  {product.isWeb2Print && (
                    <div className={cn(
                      'absolute left-3 bg-orange-600 text-white text-[0.5625rem] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider shadow-sm',
                      cardOnSale ? 'top-11' : 'top-3',
                    )}>
                      Web2Print
                    </div>
                  )}
                </Link>

                {/* The whole card opens the product page — no "Customise" button:
                    a product is configured and ordered on its own page, and a
                    shortcut that opened the configurator over the list only
                    duplicated it. */}
                <Link to={productPath(product)} className="p-6 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <h3 className="text-base font-black text-gray-900 group-hover:text-orange-600 transition-colors leading-snug">
                      {productName}
                    </h3>
                    <p className="text-xs font-medium text-gray-500 mt-1.5 line-clamp-2">
                      {localized(product.description, product.descriptionI18n, language)}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-gray-100 flex items-center justify-between">
                    <div>
                      <span className="text-[0.625rem] text-gray-400 block uppercase font-black tracking-widest">
                        {t('shopPriceFrom')}
                      </span>
                      <span className="flex items-baseline gap-1.5 leading-tight">
                        <span className={cn(
                          'text-lg font-black block leading-tight',
                          cardOnSale ? 'text-red-600' : 'text-gray-900',
                        )}>
                          {priceInfo.formatted}
                        </span>
                        {listPriceInfo && (
                          <span className="text-xs font-bold text-gray-400 line-through">
                            {listPriceInfo.formatted}
                          </span>
                        )}
                      </span>
                      {/* Same slot the verbose vatLabel ("Tax 25% Yes") used to
                          occupy — the tiny mode tag replaces it. */}
                      <VatTag className="block" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* MORE, on request.
          The page holds one server page of products; this asks for the next and
          appends it. It appears only when the server said there IS a next page,
          so it can never be a button that does nothing. The count beside it is
          the honest pair — how many are on screen, out of how many match — which
          is also the only place the customer can see that the list is partial. */}
      {!loading && filteredProducts.length > 0 && !(selectedCategory === 'all' && !searchQuery.trim()) && (
        <div className="flex flex-col items-center gap-3 pt-2">
          <span className="text-xs font-bold text-gray-400">
            {t('shopShowingCount')
              .replace('{0}', String(filteredProducts.length))
              .replace('{1}', String(Math.max(productTotal, filteredProducts.length)))}
          </span>
          {nextCursor && (
            <button
              type="button"
              onClick={() => void loadMoreProducts()}
              disabled={loadingMore}
              className="px-6 py-3 bg-gray-900 text-white text-xs font-black rounded-2xl hover:bg-orange-600 transition-colors disabled:opacity-60"
            >
              {loadingMore ? t('shopLoadingMore') : t('shopLoadMore')}
            </button>
          )}
        </div>
      )}

    </div>
  );
};

// --- Pages ---

const Home = () => {
  return <LaboPrintHome />;
};

// OldHome and AdminDashboard used to sit here: ~310 lines of an earlier home
// page and an earlier admin screen, neither referenced from any route or any
// other file. The admin one rendered a table of invented orders — "John Doe",
// "#ORD-7821", "149.00 SEK" — which is exactly the kind of thing that gets
// mistaken for live data when somebody goes looking. The screens actually in
// use are LaboPrintHome and pages/AdminDashboardPage.

// --- Auth Provider ---

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<Language>(() => {
    // A visitor who has picked a language keeps it. A first-time visitor gets the
    // language their browser asks for, narrowed to the four the shop sells in —
    // a Swedish customer should land on Svenska, not on English.
    // Any stale or unsupported value (an old 'ar' from before, a hand-edited
    // localStorage) is ignored rather than trusted.
    const saved = localStorage.getItem('reklamx_language');
    if (isSupportedLanguage(saved)) return saved;
    return detectBrowserLanguage();
  });

  const handleSetLanguage = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('reklamx_language', lang);
  };
  
  // VAT State (Default: false = excl. VAT, 25% VAT rate)
  const [includeVat, setIncludeVat] = useState<boolean>(() => {
    const saved = localStorage.getItem('reklamx_include_vat');
    return saved ? JSON.parse(saved) : false;
  });

  const handleSetIncludeVat = (include: boolean) => {
    setIncludeVat(include);
    localStorage.setItem('reklamx_include_vat', JSON.stringify(include));
  };

  // Currency & Exchange Rates State
  const [currency, setCurrencyState] = useState<CurrencyCode>(() => {
    const saved = localStorage.getItem('reklamx_currency');
    if (saved && ['SEK', 'DKK', 'EUR', 'NOK'].includes(saved)) {
      return saved as CurrencyCode;
    }
    return 'SEK';
  });

  const [currencies, setCurrencies] = useState<Record<CurrencyCode, CurrencyInfo>>(() => {
    try {
      const saved = localStorage.getItem('reklamx_exchange_rates');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.SEK && parsed.DKK && parsed.EUR && parsed.NOK) {
          return {
            SEK: parsed.SEK,
            DKK: parsed.DKK,
            EUR: parsed.EUR,
            NOK: parsed.NOK
          };
        }
      }
      return DEFAULT_CURRENCIES;
    } catch {
      return DEFAULT_CURRENCIES;
    }
  });

  const handleSetCurrency = (code: CurrencyCode) => {
    setCurrencyState(code);
    localStorage.setItem('reklamx_currency', code);
  };

  const updateExchangeRate = async (code: CurrencyCode, newRate: number) => {
    // The admin edits a rate for EVERY customer, so it has to be stored for
    // every customer. This wrote to localStorage alone, which meant the new rate
    // existed only in the browser of the person who typed it — the shop kept
    // quoting the old one to everyone else, and the admin had no way to tell.
    const updated = {
      ...currencies,
      [code]: {
        ...(currencies[code] || DEFAULT_CURRENCIES[code]),
        rateFromSEK: newRate,
      },
    };
    setCurrencies(updated);
    localStorage.setItem('reklamx_exchange_rates', JSON.stringify(updated));

    await setDoc(
      doc(db, 'settings', 'printSettings'),
      { exchangeRates: updated, exchangeRatesUpdatedAt: new Date().toISOString() },
      { merge: true },
    );
  };

  const convertPrice = (netPriceSEK: number, targetCurrency?: CurrencyCode) => {
    return convertFromSEK(netPriceSEK, targetCurrency || currency, currencies);
  };

  // VAT comes from the shop's own settings, not from a literal. It was hardcoded
  // at 0.25 in three files, so a reduced Swedish rate (12% or 6% on printed
  // matter) or a 0% export rate meant editing code. 25% remains the fallback for
  // the moment before the settings document has loaded.
  const [vatRate, setVatRate] = useState(0.25);
  // Until the settings document lands, the rates that were compiled in before
  // 4.26 — so the first paint is the old behaviour rather than a wrong one.
  const [loyalty, setLoyalty] = useState<LoyaltySettings>(LOYALTY_DEFAULTS);
  const [shipping, setShipping] = useState<ShippingSettings>(DEFAULT_SHIPPING);
  const [shippingLoaded, setShippingLoaded] = useState(false);

  // 5.7c — tell the server a basket exists, so "how much money walked away" can
  // be answered. Signed-in customers only, debounced, and fire-and-forget: see
  // src/lib/cartBeacon.ts, which explains why it listens to the cart EVENT rather
  // than to writeCart().
  useEffect(() => startCartBeacon(async () => {
    try {
      return (await auth.currentUser?.getIdToken()) ?? null;
    } catch {
      return null;
    }
  }), []);

  useEffect(() => {
    let cancelled = false;
    // Shop-wide settings, for every visitor: the VAT rate and the exchange rates.
    getDoc(doc(db, 'settings', 'printSettings'))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setShippingLoaded(true);
          return;
        }
        const pct = Number(snap.data()?.vatRatePercent);
        if (Number.isFinite(pct) && pct >= 0 && pct <= 100) setVatRate(pct / 100);

        const rates = snap.data()?.exchangeRates;
        if (rates && typeof rates === 'object') {
          setCurrencies((prev) => ({ ...prev, ...rates }));
          localStorage.setItem('reklamx_exchange_rates', JSON.stringify(rates));
        }

        // 4.26 — the same document carries the loyalty rates. Clamped by
        // loyaltySettingsFrom, so a half-typed value cannot make points free.
        setLoyalty(loyaltySettingsFrom(snap.data()));
        setShipping(normaliseShipping(snap.data()?.shipping));
        setShippingLoaded(true);
      })
      .catch((err) => {
        console.warn('Could not load the VAT rate, using 25%:', err);
        // The defaults stand; the server's quote still draws the real menu.
        if (!cancelled) setShippingLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const vatPercentLabel = Math.round(vatRate * 1000) / 10;

  const formatPriceWithVat = (netPriceSEK: number) => {
    const net = Number(netPriceSEK) || 0;
    const convertedNet = convertFromSEK(net, currency, currencies);
    const vatAmountSEK = net * vatRate;
    const convertedVatAmount = convertFromSEK(vatAmountSEK, currency, currencies);
    const grossSEK = net + vatAmountSEK;
    const convertedGross = convertFromSEK(grossSEK, currency, currencies);
    const displayPrice = includeVat ? convertedGross : convertedNet;

    const vatLabel = includeVat
      ? (translations[language]?.vatIncl || 'Tax Yes').replace('25', String(vatPercentLabel))
      : (translations[language]?.vatExcl || 'Tax No').replace('25', String(vatPercentLabel));

    const formatted = formatCurrencyValue(displayPrice, currency, currencies);

    return {
      netPrice: convertedNet,
      vatAmount: convertedVatAmount,
      grossPrice: convertedGross,
      displayPrice,
      vatLabel,
      formatted,
      currencyCode: currency,
      currencySymbol: currencies[currency]?.symbol || currency,
      rawNetSEK: net,
      rawGrossSEK: grossSEK
    };
  };

  /** See the interface: one place that turns a SEK amount into what to print. */
  const formatMoney = (amountSEK: number) =>
    formatCurrencyValue(convertFromSEK(Number(amountSEK) || 0, currency, currencies), currency, currencies);

  useEffect(() => {
    document.dir = 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: TranslationKey) => {
    const langDict = translations[language] || translations['en'];
    return langDict[key] || translations['en'][key] || key;
  };

  useEffect(() => {
    // Complete a redirect-based Google sign-in (and surface any error).
    getRedirectResult(auth).catch((e) => console.warn('Google redirect sign-in error:', e));

    // A profile that could not be read (the database refused): read again every
    // minute — more slowly as it goes on — until it answers, so the owner's role,
    // name and points arrive by themselves. A refused read is not billed.
    let retry: ReturnType<typeof setTimeout> | null = null;
    const stopRetry = () => {
      if (retry) clearTimeout(retry);
      retry = null;
    };

    // Role is NEVER derived from the email address. New accounts are always 'client';
    // elevation to staff/admin happens only via an existing admin (enforced by Firestore rules).
    const defaultRole = 'client';

    /** Read the profile and put it in place; throws when the database does not answer. */
    const loadProfile = async (firebaseUser: FirebaseUser): Promise<void> => {
      const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
      if (userDoc.exists()) {
        const uData = userDoc.data() as UserProfile;
        // The uid comes from the AUTH TOKEN, never trusted to the document.
        // A users doc without a uid field (hand-written, migrated, or from
        // an older tool) made user.uid undefined, and the first
        // where('userId','==',undefined) crashed the entire dashboard for
        // that account with an error page. The doc stores a copy; the
        // token is the truth.
        uData.uid = firebaseUser.uid;

        // A suspended account is signed straight back out. Blocking only the
        // routes would still leave them able to order and to use their points.
        if (uData.status === 'suspended') {
          console.warn('Suspended account signed out:', uData.email);
          await signOut(auth);
          setUser(null);
          return;
        }
        // THE PHANTOM BALANCE, removed.
        //
        // This used to hand any account with no `loyaltyPoints` field 250
        // points and a "Welcome Bonus" row — in LOCAL STATE — and then try
        // to write them. firestore.rules refuses a customer changing their
        // own balance, so the write failed and `.catch(() => {})` swallowed
        // it. Every legacy customer saw 250 points on their dashboard that
        // the server does not have: priceCart reads the stored value through
        // realPointsBalance, so redeeming them simply did nothing and the
        // customer had no way to understand why.
        //
        // A balance nobody has is worse than a balance of zero. Showing the
        // truth is the fix; whether those customers should be GIVEN 250 is
        // the owner's decision, and it would be granted by the server.
        if (uData.loyaltyPoints === undefined) {
          uData.loyaltyPoints = 0;
        }
        setUser(uData);
      } else {
        const newUser: UserProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || 'User',
          photoURL: firebaseUser.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(firebaseUser.displayName || 'User')}&background=ea580c&color=fff`,
          role: defaultRole,
          accountType: 'business',
          status: 'active',
          // A new account used to start on 1000 points and Platinum. At the
          // shop's own rate of 10 points to the krona that is 100 kr of free
          // discount for anyone who signs up, repeatable with a new email
          // address, and a loyalty tier the customer has not earned. Points
          // are granted by the payment webhook, against money that arrived.
          loyaltyPoints: 0,
          loyaltyTier: 'Silver',
          pointsHistory: [],
          createdAt: new Date().toISOString(),
        };
        await setDoc(doc(db, 'users', firebaseUser.uid), newUser).catch(() => {});
        setUser(newUser);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      stopRetry();
      if (firebaseUser) {
        // AN ANONYMOUS SESSION IS NOT A CUSTOMER.
        //
        // The artwork uploader signs a guest in anonymously so the Storage rules
        // have an owner to key the file on — it is a technicality, not a sign-up.
        // Without this guard the branch below finds no profile document, creates
        // one, and the shop accumulates a junk user (email '', displayName
        // 'User', 250 loyalty points) for every guest who ever attaches a file.
        // On a public domain that is a Firestore write per upload, a growing
        // bill on a project whose read quota has already taken the shop offline,
        // and a Users screen the owner cannot use.
        if (firebaseUser.isAnonymous) {
          setUser(null);
          setLoading(false);
          return;
        }

        try {
          await loadProfile(firebaseUser);
        } catch (err) {
          // NOT A CUSTOMER — A STAND-IN. This used to put a plain customer profile
          // in place without a word, and the owner, signed in while the database
          // had used up its daily reads, found his admin account showing
          // "CUSTOMER" and asked whether his account had been locked (2026-10-07).
          // The stand-in is marked: the header says why, the account form will not
          // save its blanks over his real details, and the real profile replaces
          // it the moment the database answers.
          console.warn("Firestore error in auth state change listener, falling back to local user profile:", err);
          const fallbackUser: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'User',
            photoURL: firebaseUser.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(firebaseUser.displayName || 'User')}&background=ea580c&color=fff`,
            role: defaultRole,
            accountType: 'business',
            status: 'active',
            // See above: no welcome fortune here either.
            loyaltyPoints: 0,
            loyaltyTier: 'Silver',
            pointsHistory: [],
            createdAt: new Date().toISOString(),
            profileUnavailable: { quota: false, backAt: null },
          };
          setUser(fallbackUser);
          // WHY, from the server: it knows when the database refuses for its daily
          // limit, and when that comes back.
          fetch('/api/health?database=1')
            .then((r) => (r.ok ? r.json() : null))
            .then((h) => {
              if (h?.database !== 'quota') return;
              setUser((u) =>
                u && u.uid === firebaseUser.uid && u.profileUnavailable
                  ? { ...u, profileUnavailable: { quota: true, backAt: typeof h.databaseBackAt === 'string' ? h.databaseBackAt : null } }
                  : u,
              );
            })
            .catch(() => {});
          const again = (delay: number) => {
            retry = setTimeout(async () => {
              retry = null;
              if (auth.currentUser?.uid !== firebaseUser.uid) return;
              try {
                await loadProfile(firebaseUser);
              } catch {
                again(Math.min(delay * 2, 5 * 60_000));
              }
            }, delay);
          };
          again(60_000);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      stopRetry();
      unsubscribe();
    };
  }, []);

  // updateUserLoyaltyPoints() used to live here: it recomputed a balance, a tier
  // and a history entry in the browser and wrote all three to the user document.
  //
  // It was DEAD and it was BROKEN. Nothing called it — CheckoutPage destructured
  // it and never used it — and firestore.rules refuses a customer changing their
  // own `loyaltyPoints` or `pointsHistory`, so any call would have updated the
  // screen and silently failed to persist, exactly like the phantom welcome
  // bonus above it.
  //
  // Points are the server's: the payment webhook awards them against money that
  // actually arrived, writes them to users/<uid>/pointsLedger, and takes them
  // back on a refund. See clawBackPointsForRefund in server.ts.

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup'>('signin');

  // Signing in is a PAGE now (/login, the neumorphic circle), not a popup.
  // Every caller of openAuthModal all over the site is redirected there in one
  // move. The provider sits OUTSIDE the router, so it cannot navigate itself —
  // it records the intent, and the little AuthRedirector inside the router
  // watches this value and performs the actual navigation.
  const [authRedirect, setAuthRedirect] = useState<{ mode: 'signin' | 'signup'; at: number } | null>(null);

  const openAuthModal = (mode?: 'signin' | 'signup') => {
    setAuthModalMode(mode ?? 'signin');
    setAuthRedirect({ mode: mode ?? 'signin', at: Date.now() });
  };

  const closeAuthModal = () => {
    setIsAuthModalOpen(false);
  };

  const login = () => {
    openAuthModal('signin');
  };

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e: any) {
      // signInWithRedirect silently drops the session in browsers that partition or block
      // third-party cookies, so it is only a fallback for when the popup never opens.
      if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, provider);
        return;
      }
      if (e?.code === 'auth/cancelled-popup-request') return;
      throw e;
    }
  };

  const loginWithEmail = async (email: string, pass: string) => {
    // A failed sign-in MUST surface as an error. Never fabricate a session, and never
    // derive a role from the email address. The UI shows the error to the user.
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const resetPassword = async (email: string) => {
    // Deliberately does not report whether the address is registered: telling an
    // anonymous caller which emails have accounts is an account-enumeration leak.
    // The UI says "if that address has an account, we've sent a link" either way.
    await sendPasswordResetEmail(auth, email);
  };

  const registerWithEmail = async (displayName: string, email: string, pass: string) => {
    try {
      const res = await createUserWithEmailAndPassword(auth, email, pass);
      if (res.user) {
        await updateProfile(res.user, { displayName });
        sendEmailVerification(res.user).catch(() => {});
        const newUser: UserProfile = {
          uid: res.user.uid,
          email: res.user.email || email,
          displayName,
          photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=bb965b&color=fff`,
          role: 'client',
          accountType: 'individual',
          status: 'active',
          // ZERO. THIS IS WHY SIGN-UP WAS BROKEN.
          //
          // firestore.rules pins `loyaltyPoints == 0` and an empty pointsHistory
          // on CREATE, deliberately: a client that can write its own balance can
          // write 100 000, which is 10 000 kr of discount at the shop's rate. So
          // this document — which set 250 and a "Welcome Bonus" row — was
          // REFUSED, the setDoc threw, and the catch below rethrew it to the
          // registration form.
          //
          // Proven against the live rules on 2026-09-12 with a throwaway account:
          //   create with 250 → 403 PERMISSION_DENIED
          //   create with 0   → 200
          //
          // Every customer who tried to register with an email and a password
          // got an error — and the Firebase AUTH account had already been
          // created by then, so trying again answered "email already in use".
          //
          // A welcome bonus is not impossible; it simply cannot be self-awarded.
          // It has to be granted by the server, which is a decision for the
          // owner and not something to reinstate here.
          loyaltyPoints: 0,
          // The lowest tier the type allows. There is no Bronze.
          loyaltyTier: 'Silver',
          pointsHistory: [],
          createdAt: new Date().toISOString(),
        };
        await setDoc(doc(db, 'users', res.user.uid), newUser);
        setUser(newUser);
      }
    } catch (err: any) {
      // Surface real registration errors (e.g. email already in use, weak password)
      // to the UI. Never fabricate a local session when sign-up fails.
      throw err;
    }
  };

  const loginAsDemoUser = async (role: 'admin' | 'staff' | 'client') => {
    // Passwordless demo login is a development-only convenience. It is disabled in
    // production builds so no visitor can obtain a privileged session by one click.
    if (!import.meta.env.DEV) {
      console.warn('Demo login is disabled in production.');
      return;
    }

    const demoConfigs = {
      admin: {
        uid: 'demo-admin-id',
        email: 'admin@reklamx.se',
        displayName: t('appDemoAdminName'),
        role: 'admin' as const,
        loyaltyPoints: 5000,
        loyaltyTier: 'Platinum' as const
      },
      staff: {
        uid: 'demo-staff-id',
        email: 'staff@reklamx.se',
        displayName: t('appDemoStaffName'),
        role: 'staff' as const,
        loyaltyPoints: 1200,
        loyaltyTier: 'Gold' as const
      },
      client: {
        uid: 'demo-client-id',
        email: 'vip.customer@reklamx.se',
        displayName: t('appDemoClientName'),
        role: 'client' as const,
        loyaltyPoints: 850,
        loyaltyTier: 'Gold' as const
      }
    };

    const cfg = demoConfigs[role];
    const demoUser: UserProfile = {
      uid: cfg.uid,
      email: cfg.email,
      displayName: cfg.displayName,
      photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(cfg.displayName)}&background=bb965b&color=fff`,
      role: cfg.role,
      accountType: 'business',
      status: 'active',
      loyaltyPoints: cfg.loyaltyPoints,
      loyaltyTier: cfg.loyaltyTier,
      pointsHistory: [
        {
          id: 'tx-demo-1',
          date: new Date().toISOString(),
          points: cfg.loyaltyPoints,
          type: 'bonus',
          description: `Welcome Bonus for ${cfg.displayName}`,
        }
      ],
      createdAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'users', cfg.uid), demoUser, { merge: true });
    } catch (e) {
      console.warn("Could not save demo user to firestore:", e);
    }
    setUser(demoUser);
  };

  const logout = async () => {
    // A SHARED COMPUTER: nothing of the person stays behind. The designs kept on this
    // device go with him — the next one to use it was offered them (code review
    // DSN-04); the owner's templates stay — and so does the half-typed checkout, with
    // his name, address and telephone (code review 2026-10-11, M).
    clearCheckoutDraft();
    // Waited for, briefly: the page is replaced below, and a delete still running in
    // IndexedDB could be cut off with it.
    await Promise.race([clearCustomerDrafts(), new Promise((done) => setTimeout(done, 2000))]);
    await signOut(auth).catch(() => {});
    setUser(null);
    // …and nothing in this tab: a design open on a product page, a file attached in
    // the configurator, a form half-filled all lived on in memory for the next person
    // (code review 2026-10-11, M / designer #5). A full load of the home page keeps
    // none of it. The basket stays as it is: whether it goes too is the shop's call.
    // REPLACED, not added: with assign(), Back could bring the signed-out page back
    // from the browser's page cache, typed fields and all (final review).
    window.location.replace('/');
  };

  return (
    <AuthContext.Provider value={{ 
      user,
      loading,
      login,
      openAuthModal,
      closeAuthModal,
      isAuthModalOpen,
      authRedirect,
      clearAuthRedirect: () => setAuthRedirect(null),
      loginWithGoogle,
      loginWithEmail,
    resetPassword,
      registerWithEmail,
      loginAsDemoUser,
      logout, 
      language, 
      setLanguage: handleSetLanguage, 
      t, 
      includeVat, 
      setIncludeVat: handleSetIncludeVat,
      vatRate,
      loyalty,
      shipping,
      shippingLoaded,
      refreshShipping: setShipping,
      currency,
      setCurrency: handleSetCurrency,
      currencies,
      updateExchangeRate,
      convertPrice,
      formatPriceWithVat,
      formatMoney,
    }}>
      {/* The AuthModal is retired: openAuthModal now routes to the /login page
          (the client's neumorphic circle design). The modal component stays in
          the tree only as a fallback that never opens. */}
      <AuthModal isOpen={isAuthModalOpen} onClose={closeAuthModal} initialMode={authModalMode} />
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Lives INSIDE the router and performs the navigation the AuthProvider cannot:
 * whenever something calls openAuthModal(), the recorded intent lands here and
 * the visitor is taken to the auth page, remembering where they stood.
 */
const AuthRedirector = () => {
  const { authRedirect, clearAuthRedirect, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  React.useEffect(() => {
    if (!authRedirect) return;
    clearAuthRedirect();
    if (user) return; // already signed in — nothing to do
    if (location.pathname === '/login') return;
    navigate('/login', { state: { mode: authRedirect.mode, from: location.pathname + location.search } });
  }, [authRedirect]);
  return null;
};

// --- Route guard ---
// Blocks a page from rendering unless the visitor is signed in (and, when `roles`
// is given, holds one of those roles). Unauthorized visitors are redirected home.
// Data access is independently enforced by Firestore security rules.
const NotFoundPage = () => {
  const { t } = useAuth();
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-20">
      <p className="text-6xl font-black text-gray-200 mb-2">404</p>
      <h1 className="text-2xl font-black text-gray-900 mb-2">{t('notFoundTitle')}</h1>
      <p className="text-gray-500 max-w-md mb-8">{t('notFoundBody')}</p>
      <Link
        to="/"
        className="px-6 py-3 bg-gray-900 text-white font-black rounded-xl hover:bg-orange-600 transition-colors"
      >
        {t('notFoundCta')}
      </Link>
    </div>
  );
};

const STAFF_ONLY_ROLES = ['admin', 'staff', 'production'];

const RequireRole = ({ roles, children }: { roles?: string[]; children: React.ReactNode }) => {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;

  if (!user) {
    // A staff route sends you to the staff sign-in, carrying where you were
    // headed so you land there afterwards. Customer routes now do the same —
    // to the customer auth page instead of a silent bounce to the home page.
    const isStaffRoute = roles?.some((r) => STAFF_ONLY_ROLES.includes(r));
    return isStaffRoute
      ? <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
      : <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  // Suspending an account did nothing at all: `status` was written by the admin
  // screen, stored, displayed — and never checked anywhere. A suspended person
  // kept full access until their password changed.
  if (user.status === 'suspended') return <Navigate to="/?suspended=1" replace />;

  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
};

// --- Main App ---

/**
 * The shell renders outside AuthProvider's consumers, so it has no translator of
 * its own. This one-line component is where the watcher picks one up.
 */
/**
 * Loads Google's tag — and only when BOTH halves are true: the owner has
 * configured an id in the dashboard, and this visitor has pressed Accept on the
 * consent banner. A visitor who refused, or who has not answered yet, sends
 * Google nothing at all; no script element is ever created for them.
 *
 * It re-checks on every settings change so switching Ads on in the dashboard
 * reaches an already-open tab, and on a `storage` event so accepting in one tab
 * starts the tag in the others too.
 */
const MarketingTags = () => {
  const { settings } = useSiteSettings();
  const marketing = settings.marketing;
  const [consent, setConsent] = useState<ReturnType<typeof readConsent>>(() => readConsent());

  useEffect(() => {
    const sync = () => setConsent(readConsent());
    window.addEventListener('storage', sync);
    window.addEventListener('reklamx:consent', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('reklamx:consent', sync);
    };
  }, []);

  useEffect(() => {
    if (consent !== 'granted') return;
    if (!hasMarketing(marketing)) return;
    loadTags(marketing!);
  }, [consent, marketing]);

  return null;
};

const BuildWatcherMount = () => {
  const { t } = useAuth();
  return <BuildWatcher t={t} />;
};

const Footer = () => {
  const { settings } = useSiteSettings();
  const { language, t } = useAuth();

  /**
   * THE PAYMENT BADGES, FROM MOLLIE.
   *
   * The owner asked for the logos to appear by themselves — the ones Mollie
   * shows — instead of a list somebody has to keep. That list is how the footer
   * came to advertise Klarna but not PayPal while both were live, and how a
   * Swish logo borrowed from an unrelated charity's website ended up on the page.
   *
   * A nominal 1000 SEK is sent, and it matters: Mollie answers with its
   * Euro-only default set when no amount is given, and Swish is SEK-only. The
   * amount is not the shopper's basket — this row says what the shop accepts,
   * not what this particular order can use.
   *
   * The stored list stays the fallback, so the footer looks exactly as it does
   * today whenever the switch is off, Mollie is unreachable, or no key is set.
   */
  const [mollieEntries, setMollieEntries] = useState<PaymentIconEntry[] | null>(null);
  const auto = settings.footerPaymentIconsAuto === true;

  useEffect(() => {
    if (!auto) { setMollieEntries(null); return; }
    let cancelled = false;
    const controller = new AbortController();
    fetch(`/api/payment-methods?amount=1000&locale=${encodeURIComponent(language)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !Array.isArray(d?.methods) || d.methods.length === 0) return;
        setMollieEntries(entriesFromMollieMethods(d.methods));
      })
      // Silent. A footer decoration must never put an error on the page.
      .catch(() => {});
    return () => { cancelled = true; controller.abort(); };
  }, [auto, language]);

  const paymentEntries = (auto && mollieEntries?.length) ? mollieEntries : settings.footerPaymentIcons;

  return (
    <footer id="contact" className="bg-gray-950 text-white py-16 border-t border-gray-900 scroll-mt-10">
      <div id="about" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              {/* The footer is near-black. The shop's own mark has a light
                  version (white letters, the gold X kept); a logo the owner
                  uploads himself is flattened to white by the filter instead,
                  which works for any picture without a second file. */}
              <img
                src={logoSrc(settings, true)}
                alt={settings.siteName || 'ReklamX'}
                width={BRAND_LOGO_SIZE.width}
                height={BRAND_LOGO_SIZE.height}
                loading="lazy"
                className={cn('h-9 w-auto max-w-[11.875rem] object-contain object-left', hasOwnLogo(settings) && 'brightness-0 invert')}
              />
            </div>
            <p className="text-gray-400 text-xs leading-relaxed">
              {localized(settings.siteTagline, settings.siteTaglineI18n, language) || t('appFooterTagline')}
            </p>
          </div>

          <div>
            <h4 className="text-sm font-black mb-4 text-white">{t('footerServicesHeading')}</h4>
            <ul className="space-y-2 text-xs text-gray-400 font-bold">
              <li><Link to="/products" className="inline-block py-1 hover:text-white transition-colors">{t('appCategoryPremiumBusinessCards')}</Link></li>
              <li><Link to="/products" className="inline-block py-1 hover:text-white transition-colors">{t('appCategoryPackagingGiftBoxes')}</Link></li>
              <li><Link to="/products" className="inline-block py-1 hover:text-white transition-colors">{t('appCategoryBrochuresPosters')}</Link></li>
              <li><Link to="/custom-upload" className="inline-block py-1 hover:text-white transition-colors">{t('footerCustomPdfPrinting')}</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-black mb-4 text-white">{t('footerQuickLinksHeading')}</h4>
            {/* Customer-facing links only. This list used to advertise the
                staff workspace and the admin panel to every visitor — staff
                know their own door, and pointing strangers at it invites
                knocking. The dead newsletter form that sat next to it (an
                input and a Subscribe button wired to nothing) is gone too:
                a form that silently swallows email addresses is a broken
                promise, and there is no mailing list to subscribe to. */}
            <ul className="space-y-2 text-xs text-gray-400 font-bold">
              <li><Link to="/customer-dashboard" className="inline-block py-1 hover:text-white transition-colors">{t('footerCustomerPortal')}</Link></li>
              <li><Link to="/editor" className="inline-block py-1 hover:text-white transition-colors">{t('footerDesignEditor')}</Link></li>
              <li><Link to="/custom-upload" className="inline-block py-1 hover:text-white transition-colors">{t('footerUploadFile')}</Link></li>
            </ul>
          </div>
        </div>

        {/* A shop trading in the EU has to make these reachable from every page,
            not buried. The footer is where customers and payment providers look. */}
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="space-y-1 text-center sm:text-left">
            <p className="text-gray-500 text-xs font-bold">
              {localized(settings.footerText, settings.footerTextI18n, language) ||
                `© ${new Date().getFullYear()} ${settings.siteName}. ${t('footerRightsReserved')}`}
            </p>
            {/* Who the seller is, on every page. A Swedish web shop is expected to
                show its company name and organisation number (and here the VAT
                number) where a customer can find them; they were typed into the
                dashboard and printed only on invoices (the client's audit,
                2026-10-10). */}
            {(settings.companyLegalName || settings.orgNumber || settings.vatNumber) && (
              <p className="text-gray-500 text-[0.6875rem] font-bold" data-rx-footer-company>
                {[
                  settings.companyLegalName?.trim(),
                  settings.orgNumber?.trim() && `${t('footerOrgNumber')} ${settings.orgNumber.trim()}`,
                  settings.vatNumber?.trim() && `${t('footerVatNumber')} ${settings.vatNumber.trim()}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-bold">
            <Link to="/privacy" className="inline-block py-1 text-gray-400 hover:text-white transition-colors">
              {getLegalDocument('privacy', language).title}
            </Link>
            <Link to="/terms" className="inline-block py-1 text-gray-400 hover:text-white transition-colors">
              {getLegalDocument('terms', language).title}
            </Link>
            <Link to="/cookies" className="inline-block py-1 text-gray-400 hover:text-white transition-colors">
              {getLegalDocument('cookies', language).title}
            </Link>
            {/* The header no longer has a language or VAT menu — both are
                answered in WelcomeQuestions, which this reopens. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('reklamx:welcome'))}
              className="inline-block py-1 text-left text-gray-400 hover:text-white transition-colors"
            >
              {({ sv: 'Språk & priser', en: 'Language & prices', da: 'Sprog & priser', no: 'Språk & priser' } as Record<string, string>)[language] ?? 'Language & prices'}
            </button>
            {/* Withdrawing consent must be as easy as giving it. Shown only
                where there is something to withdraw — with no measurement
                configured the banner is an information notice with no answer
                to change. */}
            {hasMarketing(settings.marketing) && (
              <button
                type="button"
                onClick={resetConsent}
                className="inline-block py-1 text-left text-gray-400 hover:text-white transition-colors"
              >
                {t('cookieChoicesLink')}
              </button>
            )}
          </nav>
        </div>

        {/* Payment marks in their customary spot: bottom-right, under the legal
            row, controlled from the admin dashboard. Renders nothing when empty.
            The right padding keeps them clear of the floating AI launcher pill. */}
        <div className="mt-4 pb-6 flex justify-center sm:justify-end lg:pr-44">
          <PaymentIcons entries={paymentEntries} />
        </div>

      </div>
    </footer>
  );
};

/**
 * THE STOREFRONT SCALES WITH THE SCREEN (2026-10-14). On a monitor wider than
 * the 1280px layout, the whole page grows — type, spacing, cards — like zooming
 * in, instead of floating in a narrow column (index.css, html.rx-fluid). The
 * dashboards and the design editor keep their working density.
 */
const FluidScale: React.FC = () => {
  const { pathname } = useLocation();
  const tool = /^\/(admin|admin-dashboard|staff-dashboard|editor)(\/|$)/.test(pathname);
  useEffect(() => {
    document.documentElement.classList.toggle("rx-fluid", !tool);
  }, [tool]);
  return null;
};

const DynamicHead: React.FC = () => {
  const { settings } = useSiteSettings();
  // 15.4.10 — IN THE VISITOR'S LANGUAGE. Both strings below have carried a
  // per-language map for rounds, and this — the only place either of them
  // reaches a browser tab or a search result — read the raw English. The
  // dashboard grew boxes for them, the owner filled them in, and nothing
  // anywhere rendered what he typed.
  const { language } = useAuth();
  const location = useLocation();

  const getPageSEO = (pathname: string) => {
    const siteName = settings.siteName || 'ReklamX';
    // THE HOME PAGE KEEPS THE TITLE GOOGLE WAS SENT.
    //
    // The server writes the front page's head from the SEO settings — his own
    // title when he wrote one, else the shipped "ReklamX — Printing, signs and
    // branded merchandise in Sweden" — and this used to replace it, once the app
    // ran, with "name | tagline": "ReklamX | An Tivaro Group AB", a weaker title
    // than the one indexed (the client's audit, 2026-10-10). Same source and
    // same suffix rule as server-seo.ts now; only the language is the visitor's.
    const seoSettings = settings.seo as Partial<SeoSettings> | undefined;
    const seoLang: SeoLang = (['sv', 'en', 'da', 'no'] as const).includes(language as SeoLang) ? (language as SeoLang) : 'en';
    const suffix = typeof seoSettings?.titleSuffix === 'string' ? seoSettings.titleSuffix : ` | ${siteName}`;
    const withSuffix = (title: string) => {
      const s = suffix.trim();
      return !s || title.includes(s) ? title : `${title}${suffix}`;
    };
    const ownHome = seoSettings?.pages?.['/'];
    const ownHomeTitle = seoText(ownHome?.title, seoLang);
    const homeTitle = ownHomeTitle ? withSuffix(ownHomeTitle) : (SEO_PAGES.find((p) => p.path === '/')?.title ?? siteName);
    const homeDescription = seoText(ownHome?.description, seoLang) || seoText(seoSettings?.defaultDescription, seoLang, SITE_DESCRIPTION);

    // Dynamic routes never match a switch case; without this, the page a
    // customer stares at longest (their order) carried the fallback title.
    if (pathname.startsWith('/order/')) {
      return {
        title: `Your Order | ${siteName}`,
        description: 'Follow the status of your print order.',
      };
    }

    switch (pathname) {
      case '/':
        return { title: homeTitle, description: homeDescription };
      case '/privacy':
        return {
          title: `Privacy Policy | ${siteName}`,
          description: 'How we handle your personal data, what we keep, for how long, and your rights.',
        };
      case '/terms':
        return {
          title: `Terms & Conditions | ${siteName}`,
          description: 'The terms that apply when you order printed products from us.',
        };
      case '/cookies':
        return {
          title: `Cookies | ${siteName}`,
          description: 'What this shop stores in your browser and why.',
        };
      case '/products':
        return {
          title: `Products & Printing Catalog | ${siteName}`,
          description: 'Browse our full catalog of custom print products: roll banners, business cards, rigid packaging, labels, exhibition stands, paper cups, and more.',
        };
      case '/services':
        return {
          title: `Our Services | ${siteName}`,
          description: settings.servicesPageSettings?.heroSubtitle || 'Discover our digital offset, packaging, large format, labels, and prepress printing services.',
        };
      case '/about':
        return {
          title: `About Us | ${siteName}`,
          description: settings.aboutUsPageSettings?.heroSubtitle || 'Learn about our heritage, mission, vision, and team of printing specialists.',
        };
      case '/contact':
        return {
          title: `Contact Us | ${siteName}`,
          description: settings.contactPageSettings?.heroSubtitle || 'Get in touch with our printing specialists for custom orders, quotes, and support.',
        };
      case '/custom-upload':
        return {
          title: `Upload Custom File for Printing | ${siteName}`,
          description: 'Upload your vector design files (PDF, AI, EPS, SVG, TIFF) for instant 300 DPI high-precision printing with automatic resolution checks.',
        };
      case '/checkout':
        return {
          title: `Checkout & Secure Order | ${siteName}`,
          description: 'Complete your printing order securely with flexible delivery and invoice options.',
        };
      case '/customer-dashboard':
        return {
          title: `Customer Portal & Order Tracking | ${siteName}`,
          description: 'Track your printing order status in real-time (Placed, Processing, In Print, Shipped) and manage your profile settings.',
        };
      case '/staff-dashboard':
        return {
          title: `Staff Production Hub | ${siteName}`,
          description: 'Internal workspace for print shop technicians to monitor queue, review file proofs, and update order stages.',
        };
      case '/admin':
      case '/admin-dashboard':
        return {
          title: `Admin Control Panel | ${siteName}`,
          description: 'Manage products, categories, custom orders, site settings, and user roles.',
        };
      case '/editor':
        return {
          title: `Online Design Editor | ${siteName}`,
          description: 'Create and edit custom print layouts directly in your browser with our interactive drag-and-drop design tool.',
        };
      default:
        return {
          title: homeTitle,
          description: 'Professional Web2Print platform for custom digital printing.',
        };
    }
  };

  const seo = getPageSEO(location.pathname);

  return (
    <Helmet>
      <title>{seo.title}</title>
      <meta name="description" content={seo.description} />
      <meta property="og:title" content={seo.title} />
      <meta property="og:description" content={seo.description} />
      <meta property="og:type" content="website" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={seo.title} />
      <meta name="twitter:description" content={seo.description} />
    </Helmet>
  );
};

export default function App() {
  // ONE A4 PAGE for every printed document — see src/lib/printFit.ts.
  useEffect(() => installPrintFit(), []);
  return (
    <HelmetProvider>
      {/* Site settings sit OUTSIDE the auth provider on purpose. AuthProvider
          renders the sign-in modal itself, so anything the modal reads has to be
          available above it — nesting it the other way round threw
          "useSiteSettings must be used within a SiteSettingsProvider" and took
          the whole app down with it. Site settings do not depend on auth. */}
      <SiteSettingsProvider>
        <AuthProvider>
          <Router>
            <DynamicHead />
            <FluidScale />
            <AuthRedirector />
            <div className="min-h-screen bg-white font-sans text-gray-900">
              <Navbar />
              <main>
                {/* A crash in one page must not take the header, the footer and
                    the whole shop with it. */}
                <ErrorBoundary>
                <React.Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/login" element={<AuthPage />} />
                  <Route path="/register" element={<AuthPage />} />
                  <Route path="/reset-password" element={<ResetPasswordPage />} />
                  <Route path="/products" element={<ProductsPage />} />
                  {/* One product, one address — linkable, shareable, indexable. */}
                  <Route path="/products/:productId" element={<ProductPage />} />
                  <Route path="/services" element={<ServicesPage />} />
                  <Route path="/about" element={<AboutUsPage />} />
                  <Route path="/contact" element={<ContactPage />} />
                  <Route path="/custom-upload" element={<CustomFileUploadPage />} />
                  <Route path="/checkout" element={<CheckoutPage />} />
                  <Route path="/customer-dashboard" element={<RequireRole><CustomerDashboard /></RequireRole>} />
                  <Route path="/staff-dashboard" element={<RequireRole roles={['staff', 'production', 'admin']}><StaffDashboard /></RequireRole>} />
                  <Route path="/order/:orderId" element={<OrderStatusPage />} />
                  {/* Required by law for a shop trading in the EU. */}
                  <Route path="/privacy" element={<LegalPage />} />
                  <Route path="/terms" element={<LegalPage />} />
                  <Route path="/cookies" element={<LegalPage />} />
                  <Route path="/admin/login" element={<AdminLoginPage />} />
                  <Route path="/admin" element={<RequireRole roles={['admin']}><AdminDashboardPage /></RequireRole>} />
                  <Route path="/admin-dashboard" element={<RequireRole roles={['admin']}><AdminDashboardPage /></RequireRole>} />
                  <Route path="/editor" element={<DesignEditorPage />} />
                  {/* Anything unmatched rendered an empty <main> under the header,
                      which reads as a broken site rather than a wrong address. */}
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
                </React.Suspense>
                </ErrorBoundary>
              </main>
              <GeminiChatbot />
              <CookieNotice />
              <WelcomeQuestions />
              <MarketingTags />
              <BuildWatcherMount />
              <Footer />
            </div>
          </Router>
        </AuthProvider>
      </SiteSettingsProvider>
    </HelmetProvider>
  );
}
