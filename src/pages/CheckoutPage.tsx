import React, { useState, useEffect } from 'react';
import { writeCart } from '../lib/cart';
import { useNavigate, Link } from 'react-router-dom';
import { doc, setDoc, getDocs, collection, query, where } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../App';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { trackBeginCheckout } from '../lib/gtag';
import { calcOrderTotals, pointsEarnedFor } from '../lib/pricing';
import { countryOf, countryLabel, feeFor, methodName, methodNote, shippingOptions, type ShippingOption } from '../lib/shipping';
import {
  CHECKOUT_DRAFT_KEY,
  draftIsFresh,
  draftHasPersonalData,
  stampDraft,
  notePodAttemptOrder,
  podAttemptIdFor,
  tabStorage,
} from '../lib/checkoutDraft';
import { markCartConverted } from '../lib/cartBeacon';
import { CartItem, attachDesignOrSay, designLaterOf } from '../components/CartDrawer';
import DesignLater, { cancelDesignSave, useDesignSaving } from '../components/product/designer/DesignLater';
import { CART_CHANGED_EVENT } from '../lib/cartKeys';
import { 
  ArrowLeft,
  Check,
  ShoppingCart, 
  Truck, 
  CreditCard, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  Trash2, 
  RefreshCw, 
  User, 
  Building2,
  Zap, 
  Mail, 
  Phone, 
  MapPin, 
  Tag, 
  FileText,
  Printer,
  Coins,
  Gift,
  Sparkles,
  Award,
  Eye,
  FileCheck,
  Receipt,
  PenTool
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import PdfPreviewModal from '../components/PdfPreviewModal';
import DesignPagesModal from '../components/DesignPagesModal';
import InvoiceModal from '../components/InvoiceModal';
import ReceiptModal from '../components/ReceiptModal';
import SafeImage from '../components/SafeImage';
import VatTag from '../components/VatTag';
import { optionUnavailableMessage } from '../lib/optionUnavailable';
import { orderProductionDays, promiseNumbers, transitDaysFor } from '../lib/productionSpeed';

/*
 * THE COUNTRIES are the owner's now (Admin → Shipping, src/lib/shipping.ts):
 * the billing list is every country he has, the delivery list the ones he has
 * switched on. The form holds ISO codes; the order is filed under the name he
 * gave each country ('Sverige'), as orders always have been.
 */

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { user, login, t, language, formatPriceWithVat, includeVat, loyalty, shipping, shippingLoaded } = useAuth();

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  // Cart State
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  
  // Loyalty Points Redemption
  const [pointsToRedeem, setPointsToRedeem] = useState<number>(0);
  
  // Customer Details Form
  const [company, setCompany] = useState('');
  const [taxId, setTaxId] = useState('');
  // WHETHER THIS IS A BUSINESS, asked rather than guessed.
  // A company name in the box is not the same statement: people put their
  // employer there on a private order. The answer decides the VAT treatment on a
  // cross-border sale, so it has to be the customer's own.
  const [isBusiness, setIsBusiness] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [postcode, setPostcode] = useState('');
  const [city, setCity] = useState('');
  // ISO codes — see the note above the component.
  const [country, setCountry] = useState('');
  const [email, setEmail] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Checkboxes
  const [differentShippingAddress, setDifferentShippingAddress] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(false);

  // Different Shipping Address details
  const [shipCompany, setShipCompany] = useState('');
  const [shipFirstName, setShipFirstName] = useState('');
  const [shipLastName, setShipLastName] = useState('');
  const [shipAddress1, setShipAddress1] = useState('');
  const [shipPostcode, setShipPostcode] = useState('');
  const [shipCity, setShipCity] = useState('');
  const [shipCountry, setShipCountry] = useState('');

  // Shipping Selection
  // The customer picks a SPEED; the shop picks the carrier when it books the
  // freight in Zendr. The old ids named DSV, which was one of three carriers
  // the shop actually uses (DHL, DSV, UPS). What is offered, and at what price,
  // is the owner's (src/lib/shipping.ts) and comes back with the server's quote.
  const [shippingMethod, setShippingMethod] = useState<'standard' | 'express' | 'pickup'>('standard');

  // The collection address, from the owner's Site Settings. `enabled` is his
  // switch; the rest is a guard against a half-filled settings document putting
  // an empty box under the Pickup option.
  const { settings } = useSiteSettings();
  const pickup = settings.pickupLocation ?? {
    enabled: false,
    companyName: '',
    address: '',
    phone: '',
    mapsUrl: '',
    openingHours: [],
    note: '',
  };
  const pickupHours = (pickup.openingHours ?? []).filter(
    (row) => (row?.days ?? '').trim() || (row?.hours ?? '').trim(),
  );
  const pickupHasDetails =
    pickup.enabled !== false &&
    Boolean(
      (pickup.companyName ?? '').trim() ||
        (pickup.address ?? '').trim() ||
        (pickup.phone ?? '').trim() ||
        (pickup.note ?? '').trim() ||
        pickupHours.length > 0,
    );
  
  // Payment Selection
  // Mollie is the shop's payment provider, and the only one that is connected.
  // The customer picks card / Swish / bank on Mollie's own page after this one.
  //
  // There used to be three tiles here — Swish, "Stripe Checkout" and "Billogram
  // (Invoice)". Neither Stripe nor Billogram exists in this codebase: whichever
  // one was chosen, /api/checkout/pay created a Mollie payment and charged the
  // card at once, then filed the order as "Invoice (Billogram)". A business
  // customer picking 30-day terms was charged on the spot, and the bookkeeping
  // named a provider that had never been used.
  const paymentMethod = 'mollie' as const;

  // What Mollie says this shop can be paid with, for THIS basket and language.
  // Decoration, not a choice: the customer still picks on Mollie's own page.
  const [paymentMethods, setPaymentMethods] = useState<
    { id: string; description: string; imageSvg: string | null }[]
  >([]);

  // Discount Code & Comments
  const [discountCode, setDiscountCode] = useState('');
  // `maxDiscountAmount` and `includesShipping` ride along so the instant local
  // preview reaches the same figure the server does. Without them a capped code
  // previewed the uncapped saving, and a shipping-inclusive one previewed a
  // smaller one — either way the total jumped when the quote landed.
  const [appliedDiscount, setAppliedDiscount] = useState<{
    code: string;
    percent: number;
    maxDiscountAmount?: number | null;
    includesShipping?: boolean;
  } | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [comments, setComments] = useState('');

  // Momentary "your details are stored" acknowledgement under the address form.
  const [detailsSaved, setDetailsSaved] = useState(false);

  // ── Form survival across reloads ──────────────────────────────────────────
  // The basket survived a reload but every typed field vanished — a customer
  // interrupted mid-checkout (tab crash, phone call, accidental refresh)
  // retyped the whole address form. The details now live in localStorage until
  // the order is placed. This is the customer's own browser and their own
  // address; nothing sensitive beyond what any autofill keeps.
  const FORM_KEY = CHECKOUT_DRAFT_KEY;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FORM_KEY) || 'null');
      if (!saved) return;
      // IT USED TO BE KEPT FOR EVER.
      //
      // This form is the customer's name, company, organisation number, full
      // address, both e-mail addresses, telephone and free-text comments, and it
      // was written on every keystroke and deleted in ONE place: after a payment
      // was confirmed. A customer who filled it in and did not pay left all of
      // that in the browser indefinitely — and on a shared machine the next
      // person to open the checkout found it typed in for them.
      //
      // The recall is worth keeping; a failed card should not cost somebody
      // their address twice. Keeping it for ever is what was wrong.
      if (!draftIsFresh(saved, Date.now())) {
        localStorage.removeItem(FORM_KEY);
        return;
      }
      setCompany(saved.company ?? ''); setTaxId(saved.taxId ?? '');
      setIsBusiness(saved.isBusiness === true);
      setFirstName(saved.firstName ?? ''); setLastName(saved.lastName ?? '');
      setAddress1(saved.address1 ?? ''); setAddress2(saved.address2 ?? '');
      setPostcode(saved.postcode ?? ''); setCity(saved.city ?? '');
      setCountry(String(saved.country ?? ''));
      setEmail(saved.email ?? ''); setBillingEmail(saved.billingEmail ?? '');
      setPhone(saved.phone ?? ''); setComments(saved.comments ?? '');
    } catch { /* corrupt or blocked storage — start blank, as before */ }
  }, []);
  useEffect(() => {
    try {
      const fields = {
        company, taxId, isBusiness, firstName, lastName, address1, address2,
        postcode, city, country, email, billingEmail, phone, comments,
      };
      // NOTHING TYPED YET, NOTHING STORED. This effect runs on mount, so an
      // empty form used to write an empty draft on every visit to the checkout —
      // a key in storage for a customer who had not entered anything.
      if (!draftHasPersonalData(fields)) {
        localStorage.removeItem(FORM_KEY);
        return;
      }
      // Stamped, so it can be forgotten. See src/lib/checkoutDraft.ts.
      localStorage.setItem(FORM_KEY, JSON.stringify(stampDraft(fields, new Date().toISOString())));
    } catch { /* storage full/blocked — the page still works without recall */ }
  }, [company, taxId, isBusiness, firstName, lastName, address1, address2, postcode, city, country, email, billingEmail, phone, comments]);

  // ONE OF HIS COUNTRIES, ALWAYS. The form starts empty, a draft from yesterday
  // may hold a name ('Sverige') or a country he has since renamed or removed, and
  // his settings arrive a moment after the page. Whatever is there is matched
  // by code, then by name; anything else becomes his home country — never the
  // first in his list, which he may have dragged Germany to the top of. The
  // delivery country must also be one he delivers to.
  //
  // NOT BEFORE HIS SETTINGS HAVE ANSWERED. Until then `shipping` is the compiled
  // five countries, and correcting against them turned a Dutch customer's saved
  // 'NL' into 'SE' on a reload — then saved it, then charged and labelled the
  // parcel as Swedish.
  useEffect(() => {
    if (!shippingLoaded) return;
    setCountry((v) => countryOf(shipping, v)?.code ?? shipping.homeCountry);
    setShipCountry((v) => {
      const c = countryOf(shipping, v);
      return c && c.enabled ? c.code : shipping.homeCountry;
    });
  }, [shipping, shippingLoaded]);
  // Order Placement State
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Distance selling in the EU requires the buyer to actively accept the terms
  // before ordering — a link in the footer is not acceptance. Unticked by
  // default, because a pre-ticked box is not consent either.
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    auth.currentUser?.getIdToken()
      .then(tok => { if (!cancelled) setAuthToken(tok); })
      .catch(() => { if (!cancelled) setAuthToken(null); });
    return () => { cancelled = true; };
  }, [user]);

  /**
   * One id per basket for an order paid on delivery, kept for this tab: pressing
   * again with the same basket — after a timeout, a reload, Back from a slow order
   * page — names the same attempt, and the server answers with the order it already
   * made. A changed basket is a new attempt, and so is the same basket once the
   * order page has emptied it (src/lib/checkoutDraft.ts).
   */
  const onDeliveryAttemptId = (): string =>
    podAttemptIdFor(
      tabStorage(),
      JSON.stringify(
        cartItems.map((i: any) => [i.productId, i.quantity, i.selectedOptionIds ?? [], i.widthCm ?? null, i.heightCm ?? null]),
      ),
      () =>
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID().replace(/-/g, '')
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`,
    );

  // PAY ON DELIVERY — offered only to a customer the owner chose (client, 2026-10-07).
  // The SERVER says so, from this customer's own sign-in; everyone else sees the
  // checkout exactly as it always was, and the server refuses the choice for them
  // even if a page sends it.
  const [onDeliveryAllowed, setOnDeliveryAllowed] = useState(false);
  const [payOnDelivery, setPayOnDelivery] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!authToken || !user) {
      setOnDeliveryAllowed(false);
      setPayOnDelivery(false);
      return;
    }
    // A fresh token, as for every quote: the one from sign-in may be an hour old
    // by the time the customer's profile changes and this asks again.
    (auth.currentUser ? auth.currentUser.getIdToken().catch(() => null) : Promise.resolve(null))
      .then((token) => (cancelled ? null : fetch('/api/checkout/options', { headers: { Authorization: `Bearer ${token ?? authToken}` } })))
      .then((r) => (r?.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const allowed = j?.payOnDelivery === true;
        setOnDeliveryAllowed(allowed);
        if (!allowed) setPayOnDelivery(false);
      })
      .catch(() => {
        if (cancelled) return;
        setOnDeliveryAllowed(false);
        setPayOnDelivery(false);
      });
    return () => { cancelled = true; };
  }, [authToken, user]);
  // Points and discount codes are spent when the money arrives — days later on
  // delivery — so they are for paying online (the server refuses them too).
  const onDeliveryBlockedByDiscounts = payOnDelivery && (pointsToRedeem > 0 || !!appliedDiscount);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<any | null>(null);

  // PDF Previewer State
  // A studio design's pages (designer v2), shown from their pictures.
  const [designPagesModal, setDesignPagesModal] = useState<{ name: string; pages: Array<{ side: 'front' | 'back'; url: string }> } | null>(null);
  const [previewPdfModal, setPreviewPdfModal] = useState<{
    isOpen: boolean;
    fileUrl: string | null;
    fileName: string;
    widthCm?: number;
    heightCm?: number;
  }>({
    isOpen: false,
    fileUrl: null,
    fileName: '',
  });

  // Auto-fill user profile if logged in
  useEffect(() => {
    if (user) {
      setEmail(user.email || '');
      const parts = (user.displayName || '').split(' ');
      setFirstName(parts[0] || '');
      if (parts.length > 1) setLastName(parts.slice(1).join(' '));
    }
  }, [user]);

  // Load items from localStorage
  const loadCart = () => {
    try {
      const items = JSON.parse(localStorage.getItem('reklamx_cart') || '[]');
      setCartItems(items);
    } catch (e) {
      console.error('Error loading cart:', e);
      setCartItems([]);
    }
  };

  useEffect(() => {
    loadCart();
  }, []);

  // THE BASKET AS IT IS NOW, not as it was when the page opened. A design saved on a
  // line (here, or from the drawer a moment before) changes it behind this page: read
  // once, the checkout paid for the line without its design, and a "+" wrote the old
  // copy back over it. Only a real change is taken — this page's own writes announce
  // themselves too, and an identical copy would only ask for a new quote.
  useEffect(() => {
    const reload = () => {
      try {
        const raw = localStorage.getItem('reklamx_cart') || '[]';
        setCartItems((cur) => (JSON.stringify(cur) === raw ? cur : JSON.parse(raw)));
      } catch {
        /* the next change will try again */
      }
    };
    window.addEventListener(CART_CHANGED_EVENT, reload);
    window.addEventListener('storage', reload);
    return () => {
      window.removeEventListener(CART_CHANGED_EVENT, reload);
      window.removeEventListener('storage', reload);
    };
  }, []);
  // A design still uploading: Pay waits for it (leaving for the bank would cut it off).
  const designSaving = useDesignSaving();

  // Quantity modification.
  //
  // Only the quantity is stored. This used to multiply the stored unit price by
  // the new quantity, but that unit price already had the OLD quantity's volume
  // discount taken off it and the multiplication dropped the per-line setup fee,
  // so the screen showed a total the shop would not charge. The quote below
  // re-prices the basket from the product documents whenever cartItems changes,
  // and that answer is the one the payment uses.
  const updateQuantity = (id: string, delta: number) => {
    const updated = cartItems.map(item => {
      if (item.id !== id) return item;
      // 0 is "this browser no longer knows the price", not "free" — the readers
      // below fall through to the server's figure when it is missing.
      return {
        ...item,
        quantity: Math.max(1, item.quantity + delta),
        unitPrice: 0,
        totalPrice: 0,
      };
    });
    setCartItems(updated);
    writeCart(updated);
    window.dispatchEvent(new Event('storage'));
  };

  const removeItem = (id: string) => {
    // Its design save goes with it, or Pay waits for a line that is gone (DSN-12).
    cancelDesignSave(`line:${id}`);
    const updated = cartItems.filter(item => item.id !== id);
    setCartItems(updated);
    writeCart(updated);
    window.dispatchEvent(new Event('storage'));
  };

  const [isValidatingCoupon, setIsValidatingCoupon] = useState(false);

  /**
   * Ask the SERVER whether this code is good.
   *
   * This used to query the coupons collection straight from the browser, which
   * meant the rules had to leave every discount code in the shop readable by any
   * visitor — `allow read: if true` — and anyone could list the collection and
   * help themselves. It also checked a different set of conditions from the
   * server (active and expiry here; usage count and one-per-customer there), so
   * a code could be accepted on this screen and refused at the till.
   *
   * The quote endpoint is the authority on price, so it is the authority on
   * discounts too. One set of rules, applied once.
   */
  const handleApplyDiscount = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setDiscountError(null);
    const codeClean = discountCode.trim().toUpperCase();
    if (!codeClean) return;

    setIsValidatingCoupon(true);
    try {
      // Fresh, else the one this page holds — as every other quote asks.
      const token = auth.currentUser ? ((await auth.currentUser.getIdToken().catch(() => null)) ?? authToken) : null;
      const res = await fetch('/api/checkout/quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          items: cartItems.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            kind: item.isCustomUpload ? 'linear' : 'configured',
            optionIds: item.selectedOptionIds ?? [],
            widthCm: item.widthCm,
            heightCm: item.heightCm,
          })),
          shippingMethod,
          deliveryCountry: deliveryCode,
          customer: quoteCustomer,
          couponCode: codeClean,
          pointsToRedeem,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        // A basket holding an option he has since hidden is not a bad code: say
        // what it is, in the shopper's language.
        setDiscountError(unavailableMessage(data) ?? (data?.error || t('checkoutInvalidCoupon')));
      } else if (data?.couponError || data?.couponErrorCode) {
        // The server's reason — expired, fully redeemed, minimum not met, on
        // special offer, already used — in the shopper's own language.
        setDiscountError(
          translateCouponError(data.couponErrorCode, data.couponErrorValue, data.couponError)
          || t('checkoutInvalidCoupon'),
        );
      } else if (data?.coupon?.percent) {
        setAppliedDiscount({
          code: data.coupon.code,
          percent: data.coupon.percent,
          maxDiscountAmount: data.coupon.maxDiscountAmount ?? null,
          includesShipping: data.coupon.includesShipping === true,
        });
      } else {
        setDiscountError(t('checkoutInvalidCoupon'));
      }
    } catch (err) {
      console.error('Error validating coupon:', err);
      // Failing closed matters here: an older version of this code granted
      // 10-20% off whenever Firestore was merely slow.
      setDiscountError(t('checkoutCouponUnavailable'));
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const handleRemoveDiscount = () => {
    setAppliedDiscount(null);
    setDiscountCode('');
    setDiscountError(null);
  };

  // ---------------------------------------------------------------------------
  // Price authority.
  //
  // The browser sends WHAT was ordered — product ids, quantities, chosen option
  // ids, configured size — and the server answers with the price, recomputed from
  // the product documents. It never sends a price up. The figures below are a
  // local preview so the page renders instantly; the server's answer replaces
  // them the moment it arrives, and that is the number the order is written with.
  // ---------------------------------------------------------------------------
  const [serverQuote, setServerQuote] = useState<any>(null);
  // Where the parcel goes: the separate address's country when ticked. Decides
  // the delivery menu; the server decides it again from the address at Pay.
  const deliveryCode = differentShippingAddress ? shipCountry : country;
  /** The server's "this option is no longer offered" refusal, in the shopper's language. */
  const unavailableMessage = (data: any): string | null =>
    optionUnavailableMessage(data, language, t('checkoutOptionUnavailable'));
  // Bumped to fetch a fresh quote when Pay was refused because a price changed,
  // or to try again after a quote failed.
  const [quoteNonce, setQuoteNonce] = useState(0);
  // Automatic retries after a failed quote (a 503 while Firestore is briefly
  // unavailable, a host 502): without them one failure left the delivery menu
  // "loading" for good and Pay disabled, with nothing to press.
  const quoteRetries = React.useRef(0);
  const quoteRetryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (quoteRetryTimer.current) clearTimeout(quoteRetryTimer.current); }, []);
  // The VAT number reaches the quote half a second after the last keystroke —
  // every quote costs reads, and typing a number is not a dozen price changes.
  const [quoteTaxId, setQuoteTaxId] = useState(taxId);
  useEffect(() => {
    const timer = setTimeout(() => setQuoteTaxId(taxId), 600);
    return () => clearTimeout(timer);
  }, [taxId]);
  // The points slider the same way: every notch of a drag was a quote of its own
  // (a dozen reads each, with a code), and the slider snapped back to the last
  // answer while the next was on its way (code review WEB-18).
  const [quotePoints, setQuotePoints] = useState(pointsToRedeem);
  useEffect(() => {
    const timer = setTimeout(() => setQuotePoints(pointsToRedeem), 600);
    return () => clearTimeout(timer);
  }, [pointsToRedeem]);
  // What the server decides the VAT from — the same facts the order will carry,
  // or a shop with the VAT rules switched on quoted one total and charged
  // another (and refused every Pay with "the price changed").
  const quoteCustomer = {
    country: countryOf(shipping, country)?.name ?? country,
    countryCode: country,
    buyerType: isBusiness ? 'company' : 'private',
    vatNumber: isBusiness ? quoteTaxId : '',
  };
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);

  // A guest has no loyalty points. Defaulting every visitor to 250 handed out
  // 25 kr of discount to anyone who opened the site.
  const userPointsBalance = user?.loyaltyPoints ?? 0;

  useEffect(() => {
    if (cartItems.length === 0) {
      setServerQuote(null);
      setQuoteError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setIsQuoting(true);

    const payload = {
      items: cartItems.map((item: any) => ({
        productId: item.productId,
        quantity: item.quantity,
        kind: item.isCustomUpload ? 'linear' : 'configured',
        optionIds: item.selectedOptionIds ?? [],
        widthCm: item.widthCm,
        heightCm: item.heightCm
      })),
      shippingMethod,
      deliveryCountry: deliveryCode,
      customer: quoteCustomer,
      couponCode: appliedDiscount?.code,
      pointsToRedeem: quotePoints
    };
    const retryLater = () => {
      if (quoteRetries.current >= 3) return;
      const delay = [2000, 5000, 10000][quoteRetries.current];
      quoteRetries.current += 1;
      if (quoteRetryTimer.current) clearTimeout(quoteRetryTimer.current);
      quoteRetryTimer.current = setTimeout(() => setQuoteNonce((n) => n + 1), delay);
    };

    // A FRESH token for every quote, as Pay takes one. The token taken at sign-in
    // expires after an hour, and a quote asked with it was a guest's: no points,
    // a sign-in-only code refused — and Pay, with its fresh token, then refused
    // the order as "the price changed", again and again (code review WEB-02).
    // When a fresh one cannot be had (the token service out of reach for a moment),
    // the one this page holds, as Pay and the pay-on-delivery options do: with none,
    // the quote was a guest's for the same reasons.
    const tokenNow = auth.currentUser
      ? auth.currentUser.getIdToken().catch(() => null).then((fresh) => fresh ?? authToken)
      : Promise.resolve(null);
    tokenNow
      .then((token) => {
        // Superseded while the token came: nobody would read this quote.
        if (cancelled) throw new DOMException('Superseded', 'AbortError');
        return fetch('/api/checkout/quote', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Identity comes from this token, not from anything in the body. The
            // server reads the real points balance from the user's own document.
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setServerQuote(null);
          setQuoteError(unavailableMessage(data) ?? data?.error ?? t('checkoutQuoteFailed'));
          // The shop's trouble, not the basket's: try again by itself.
          if (res.status >= 500 || res.status === 429) retryLater();
          return;
        }
        quoteRetries.current = 0;
        setServerQuote(data);
        // The menu is the server's: a method not offered to this country (express
        // after switching to Norway) was swapped for the first one that is.
        if (data?.shipping?.selected && data.shipping.selected !== shippingMethod) {
          setShippingMethod(data.shipping.selected);
        }
        // THE SERVER CAN TAKE A CODE BACK. It re-decides on every quote, and the
        // basket can change after the code was accepted — an offer product is
        // added, or the one product it was scoped to is removed. Leaving
        // appliedDiscount set showed a green "SPRING10 applied, −10%" box above a
        // saving of 0.00 kr.
        //
        // Said where the code was typed, and kept there with it until the next
        // Apply: the quote this drop triggers carries no code, and its answer
        // wiped the reason a moment after it appeared — the discount simply
        // vanished, and the box was empty too (code review WEB-18).
        if (data?.couponErrorCode && appliedDiscount) {
          setDiscountCode(appliedDiscount.code);
          setDiscountError(
            translateCouponError(data.couponErrorCode, data.couponErrorValue, data.couponError)
            || t('checkoutInvalidCoupon'),
          );
          setAppliedDiscount(null);
        }
        // The basket can change AFTER a code was accepted — the shopper removes
        // the one product it applied to, or adds an offer item. The server
        // re-decides on every quote, and this is where the customer finds out.
        setQuoteError(
          translateCouponError(data?.couponErrorCode, data?.couponErrorValue, data?.couponError),
        );
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return;
        setServerQuote(null);
        setQuoteError(t('checkoutQuoteUnreachable'));
        retryLater();
      })
      .finally(() => {
        if (!cancelled) setIsQuoting(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // authToken belongs in here — not mainly for the request, which takes its own
    // fresh token above (authToken only stands in when none can be had), but as
    // the sign-in's signal. It arrives asynchronously after
    // the component first renders, and without it in the list the quote was
    // requested once, as an anonymous visitor, and never asked again — so the
    // server read a points balance of zero and a signed-in customer could never
    // redeem the points the page was showing them.
  }, [cartItems, shippingMethod, appliedDiscount, quotePoints, userPointsBalance, authToken, deliveryCode, quoteNonce,
    country, isBusiness, quoteTaxId]);

  // Deliberately AFTER the quote effect, so `totals` below is in scope; the
  // dependency is the gross amount, because Mollie filters methods by amount
  // (Swish has a ceiling, some methods a floor) and by nothing else here.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const amount = Number(serverQuote?.totals?.grossTotal) || 0;

    // WAIT FOR A REAL AMOUNT. Mollie returns its Euro-only default set when no
    // amount is given, and Swish is SEK-only — so firing this on the first paint
    // with amount=0 showed a list with Swish MISSING, then corrected itself a
    // second later. Better to show nothing briefly than the wrong answer.
    if (amount <= 0) return;

    fetch(`/api/payment-methods?amount=${encodeURIComponent(amount)}&locale=${encodeURIComponent(language)}`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setPaymentMethods(Array.isArray(data.methods) ? data.methods : []);
      })
      // Silent on failure. This block is informational; a checkout must not show
      // an error because a logo strip could not be drawn.
      .catch(() => {});

    return () => { cancelled = true; controller.abort(); };
  }, [serverQuote?.totals?.grossTotal, language]);

  /**
   * The server's coupon refusal, in the shopper's own language.
   *
   * The server answers with a CODE and, for compatibility, the English sentence
   * it used to send on its own. Translating here rather than there keeps the
   * four locales in the one file that already holds them — and stops a Swedish
   * customer being told "This code cannot be used..." in English.
   */
  const translateCouponError = (
    code: string | null | undefined,
    value: number | null | undefined,
    fallback: string | null | undefined,
  ): string | null => {
    if (!code) return fallback ?? null;
    const key = `couponErr${code.charAt(0).toUpperCase()}${code.slice(1)}`;
    const text = (t as any)(key);
    // t() returns the key itself when it does not know it.
    if (!text || text === key) return fallback ?? null;
    return value != null ? text.replace('{0}', String(value)) : text;
  };

  const localTotals = calcOrderTotals({
    lineTotals: cartItems.map((item: any) => Number(item.totalPrice) || 0),
    // WHICH LINES THE CODE REACHED, as the server decided it.
    //
    // A coupon can now be limited to particular products, and a product already
    // on special offer is excluded from codes entirely. Only the server knows
    // both facts — the basket in localStorage carries neither — so this preview
    // copies the server's answer rather than guessing at it. Before the first
    // quote lands there is no answer to copy and every line counts, which is the
    // same optimistic preview the page has always shown; the server figure
    // replaces it a moment later and `priceVerified` says which one is on screen.
    couponEligible: serverQuote?.items
      ? serverQuote.items.map((line: any) => line.couponApplied === true)
      : undefined,
    discountPercent: appliedDiscount?.percent ?? 0,
    maxDiscountAmount: appliedDiscount?.maxDiscountAmount ?? null,
    discountIncludesShipping: appliedDiscount?.includesShipping === true,
    // 4.26 — the rates the owner set, the same ones the server reads.
    loyalty,
    pointsToRedeem,
    pointsBalance: userPointsBalance,
    shippingMethod,
    // A preview only, until the server's quote lands (Pay waits for it).
    shippingFees: { [shippingMethod]: feeFor(shipping, shippingMethod, deliveryCode) ?? 0 },
  });

  const totals = serverQuote?.totals ?? localTotals;
  // The delivery menu the SERVER drew for this country. Pay is offered only
  // against a quote for the address on screen and a method on that menu.
  // A server from before this release (the minutes of a deploy) answers without
  // a menu: his settings stand in, and the server still prices the order.
  const serverHasMenu = !!serverQuote?.shipping;
  const shipOptions: ShippingOption[] = serverHasMenu
    ? serverQuote.shipping.options ?? []
    : serverQuote ? shippingOptions(shipping, deliveryCode) : [];
  const quoteReady =
    !!serverQuote &&
    !isQuoting &&
    (!serverHasMenu || (serverQuote?.shipping?.countryCode ?? '') === (deliveryCode || '')) &&
    (!isBusiness || quoteTaxId === taxId) &&
    quotePoints === pointsToRedeem &&
    shipOptions.some((o) => o.id === shippingMethod);
  // Working days to the door (or to the counter) — THE SAME DAYS the order's
  // promised date is made from (src/lib/productionSpeed.ts): a production speed
  // in the basket counts (the slowest line wins), else his Site Settings' days,
  // plus the chosen method's transit.
  const promise = promiseNumbers((settings as any).deliveryPromise);
  const production = orderProductionDays(
    (serverQuote?.items ?? []).map((line: any) => (typeof line?.speedDays === 'number' ? line.speedDays : null)),
    promise.productionDays,
  );
  const daysFor = (id: string) => production.days + transitDaysFor(id, promise);
  const labelOf = (code: string) => {
    const c = countryOf(shipping, code);
    return c ? countryLabel(c, language) : code;
  };
  /** True only when the amount shown was calculated by the server. */
  const priceVerified = !!serverQuote?.totals;

  const rawSubtotal = totals.rawSubtotal;
  const discountAmount = totals.discountAmount;
  const discountedSubtotal = totals.discountedSubtotal;
  const maxRedeemablePoints = totals.maxRedeemablePoints;
  const effectivePointsToRedeem = totals.pointsRedeemed;
  const pointsDiscountAmount = totals.pointsDiscountAmount;
  const selectedShippingCost = totals.shippingCost;
  // 4.22 — on the net goods the customer actually pays for, not the gross.
  const pointsEarnedThisOrder = serverQuote?.pointsEarned
    ?? pointsEarnedFor(totals.pointsQualifyingNet, loyalty);

  // Validation
  const validateForm = () => {
    if (cartItems.length === 0) {
      setValidationError(t('emptyCart'));
      return false;
    }
    if (!firstName.trim()) {
      setValidationError(t('checkoutValidationFirstName'));
      return false;
    }
    if (!lastName.trim()) {
      setValidationError(t('checkoutValidationLastName'));
      return false;
    }
    if (!address1.trim()) {
      setValidationError(t('checkoutValidationAddress'));
      return false;
    }
    if (!postcode.trim()) {
      setValidationError(t('checkoutValidationPostcode'));
      return false;
    }
    if (!city.trim()) {
      setValidationError(t('checkoutValidationCity'));
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setValidationError(t('checkoutValidationEmail'));
      return false;
    }
    if (!phone.trim()) {
      setValidationError(t('checkoutValidationPhone'));
      return false;
    }
    // A ticked delivery address is a whole address: it decides the shipping
    // price, and the slip, the job sheet and the carrier read it.
    if (differentShippingAddress && !(shipAddress1.trim() && shipPostcode.trim() && shipCity.trim())) {
      setValidationError(t('checkoutValidationShipAddress'));
      return false;
    }
    setValidationError(null);
    return true;
  };

  // Place Order
  const handlePlaceOrder = async () => {
    // A design still uploading on a line: wait for it (the button waits too).
    if (designSaving) return;
    if (!acceptedTerms) {
      setValidationError(t('checkoutMustAcceptTerms'));
      return;
    }
    if (!validateForm()) return;

    // "Checkout started" — reported here, after the form is valid and the
    // customer is genuinely on their way out to pay, and NEVER as a sale. The
    // sale is still only reported from the order page, once the server confirms
    // the money arrived; this shop has been burned before by treating "came
    // back from the bank" as "paid".
    trackBeginCheckout(
      settings.marketing || {},
      cartItems.map((item: any) => ({
        id: String(item.productId ?? item.id ?? ''),
        name: String(item.productName ?? ''),
        price: Number(item.unitPrice) || 0,
        quantity: Number(item.quantity) || 1,
      })),
      totals.grossTotal,
    );

    setIsSubmitting(true);
    // Pay on delivery goes straight into production, so a SECOND press must not make
    // a second order: one attempt id per basket (kept for this tab), and the server
    // answers a repeat of it with the order it already made.
    const onDeliveryAttempt = payOnDelivery ? onDeliveryAttemptId() : undefined;
    try {
      const fullCustomerDetails = {
        company: company || '',
        taxId: taxId || '',
        // The server decides the VAT treatment from these two and the country;
        // it never trusts a rate the browser states. See src/lib/vatRegime.ts.
        buyerType: isBusiness ? 'company' : 'private',
        vatNumber: isBusiness ? (taxId || '') : '',
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`.trim(),
        address1,
        address2: address2 || '',
        postcode,
        city,
        // His name for it ('Sverige'), as every order has carried — and its code,
        // which the server prefers: the name comes from this page's copy of his
        // settings, which a rename since the page opened would have made stale.
        country: countryOf(shipping, country)?.name ?? country,
        countryCode: country,
        email,
        billingEmail: billingEmail || email,
        phone,
        differentShippingAddress,
        shippingAddressDetails: differentShippingAddress ? {
          company: shipCompany,
          firstName: shipFirstName,
          lastName: shipLastName,
          address1: shipAddress1,
          postcode: shipPostcode,
          city: shipCity,
          country: countryOf(shipping, shipCountry)?.name ?? shipCountry,
          countryCode: shipCountry
        } : null,
        notifyEmail
      };


      // The order is created by the server, not here.
      //
      // The browser sends WHAT was ordered and WHO is buying. The server prices
      // the cart again from the product documents and writes the result, so the
      // amount on the order is one the shop calculated. Firestore rules reject
      // order writes from a browser outright, so this is the only route.
      //
      // Order numbers also come from the server, from a counter allocated inside
      // a transaction. This used to read the entire orders collection here and
      // add one, which hands two simultaneous customers the same number — and the
      // second write silently replaced the first.
      // A FRESH token: the one taken at sign-in expires after an hour, and the server
      // would then refuse paying on delivery to a customer the owner did choose.
      const freshToken = (await auth.currentUser?.getIdToken().catch(() => null)) ?? authToken;
      const orderResponse = await fetch('/api/checkout/pay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(freshToken ? { Authorization: `Bearer ${freshToken}` } : {}),
        },
        body: JSON.stringify({
          items: cartItems.map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            kind: item.isCustomUpload ? 'linear' : 'configured',
            optionIds: item.selectedOptionIds ?? [],
            widthCm: item.widthCm,
            heightCm: item.heightCm,
            // Descriptive, never priced — see ConfiguredLineInput. The server
            // clamps it and writes it onto the order line so the print size
            // survives to the work order and to the upload box the customer
            // opens later.
            printWidthCm: (item as any).printWidthCm,
            printHeightCm: (item as any).printHeightCm,
            fileSpecs: item.fileSpecs ?? null
          })),
          shippingMethod,
          couponCode: appliedDiscount?.code,
        // The language the shopper is reading the shop in. The server maps it to
        // Mollie's own locale codes; without it Mollie picks from the browser,
        // so a Swedish customer could land on an English payment page.
        locale: language,
          pointsToRedeem,
          customer: fullCustomerDetails,
          paymentMethod: payOnDelivery ? 'on_delivery' : paymentMethod,
          ...(onDeliveryAttempt ? { attemptId: onDeliveryAttempt } : {}),
          comments,
          // Evidence that the buyer accepted, and when. Distance-selling disputes
          // turn on exactly this.
          termsAccepted: true,
          termsAcceptedAt: new Date().toISOString(),
          // The total on screen. If a price changed since, the server refuses
          // (409) rather than charge an amount the customer never saw.
          expectedGrossTotal: serverQuote?.totals?.grossTotal,
        })
      });

      const orderResult = await orderResponse.json().catch(() => null);
      // An answer that names its order is noted on the attempt — NOT the end of it.
      // The basket stays until the order page has this order; Back, or a slow order
      // page, and Place order again must answer with the same order, never place a
      // second (code review REVIEW-3 #1). The order page ends the attempt.
      if (onDeliveryAttempt && orderResult?.orderId) notePodAttemptOrder(tabStorage(), onDeliveryAttempt, String(orderResult.orderId));

      // Paying on delivery refused (no longer allowed for this account): back to
      // paying online, said in his language.
      if (orderResponse.status === 403 && orderResult?.code === 'no_pay_on_delivery') {
        setPayOnDelivery(false);
        setOnDeliveryAllowed(false);
        setValidationError(t('checkoutPayOnDeliveryRefused'));
        setIsSubmitting(false);
        return;
      }
      // Points or a code with pay on delivery (the page holds the button; a stale one may not).
      if (orderResponse.status === 400 && orderResult?.code === 'on_delivery_no_discounts') {
        setValidationError(t('checkoutPayOnDeliveryNoDiscounts'));
        setIsSubmitting(false);
        return;
      }
      // The same order is still being placed (a second press while the first runs).
      if (orderResponse.status === 409 && orderResult?.code === 'placing') {
        setValidationError(t('checkoutPayOnDeliveryUnsure'));
        setIsSubmitting(false);
        return;
      }

      // A limited code whose last use another customer's unpaid order now holds, or a
      // once-per-customer code already on one of this customer's orders. A guest's
      // quote cannot see that — only placing the order knows the e-mail — so it is
      // said where the code was typed and the code comes off; the next quote shows
      // the price without it. Read as "the price changed", it re-quoted the same
      // code and refused the same Pay for ever.
      if (orderResponse.status === 409 && (orderResult?.code === 'usedUp' || orderResult?.code === 'alreadyUsed')) {
        const why = translateCouponError(orderResult.code, null, orderResult.error) || t('checkoutInvalidCoupon');
        if (appliedDiscount) setDiscountCode(appliedDiscount.code);
        setDiscountError(why);
        setAppliedDiscount(null);
        setValidationError(why);
        setIsSubmitting(false);
        return;
      }

      if (orderResponse.status === 409) {
        // Two refusals share the status: a shape (or other option) the owner has
        // hidden since this basket was filled — named, nothing to re-quote — or a
        // price that changed, which a fresh quote shows.
        const gone = unavailableMessage(orderResult);
        setValidationError(gone ?? t('checkoutPriceChanged'));
        if (!gone) setQuoteNonce((n) => n + 1);
        setIsSubmitting(false);
        return;
      }

      if (!orderResponse.ok || !orderResult?.orderId) {
        // On delivery, a failure AFTER the order was written still leaves an order in
        // production: "try again" must not be the advice.
        setValidationError(
          onDeliveryAttempt && orderResponse.status >= 500
            ? t('checkoutPayOnDeliveryUnsure')
            : orderResult?.error || t('checkoutOrderFailed'),
        );
        setIsSubmitting(false);
        return;
      }

      // The cart survives until the payment is CONFIRMED. Clearing it here meant
      // a failed or cancelled payment sent the customer back to an empty
      // checkout — while the failure screen promised "your basket is still
      // here". The order page clears it instead, once, when THIS order reports
      // paid; the marker ties the clearing to this order so a newer basket the
      // customer starts meanwhile is left alone.
      //
      // Never in the way of the order itself: a full storage threw here, AFTER the
      // order existed, and the customer was told it failed — on delivery, "we are
      // not sure", for ever. Unmarked, the basket simply stays until he empties it.
      try {
        localStorage.setItem('reklamx_pending_order', orderResult.orderId);
      } catch {
        /* the basket stays; the order is placed */
      }
      // …and which lines that order took, for this tab: the basket's note that a
      // line's design now belongs on the order page (CartDrawer, DSN-13) is about
      // these lines only — never one added later, nor a basket started afresh.
      try {
        sessionStorage.setItem('reklamx_ordered_lines', JSON.stringify({ orderId: String(orderResult.orderId), ids: cartItems.map((i: any) => String(i.id)) }));
      } catch {
        /* a courtesy: without it, no note */
      }

      // 5.7c — THIS BASKET IS NO LONGER ABANDONED.
      //
      // Said here, at the moment the order exists, and deliberately not left for
      // the server to work out: the customer may pay minutes later on a page this
      // code never runs on, or not at all, and either way they DID reach an order.
      // A basket that became an order is a different thing from one that was left,
      // and 5.7b already reports the payments that then failed.
      markCartConverted();

      // Off to Mollie's own checkout. Card details never pass through this site.
      if (orderResult.checkoutUrl) {
        window.location.href = orderResult.checkoutUrl;
        return;
      }

      // No checkout URL: the order exists but payment could not be started.
      // Send them to the order page, which tells them where they stand.
      // `again`: this basket had already become that order (a second press, or Back and
      // Place order once more — perhaps with the address corrected). The same order is
      // the right answer; saying nothing about it was not (final review).
      window.location.href = `/order/${orderResult.orderId}?t=${orderResult.publicToken ?? ''}${orderResult.again ? '&again=1' : ''}`;
      return;

      // Loyalty points used to be spent and awarded HERE, before any payment —
      // so an abandoned checkout still cost the customer their points and still
      // credited them for a purchase that never happened. They now move on the
      // server, once the payment webhook confirms the money arrived.
    } catch (err) {
      console.error('Checkout failed:', err);
      setIsSubmitting(false);
      // No answer at all: on delivery the order may already exist.
      setValidationError(onDeliveryAttempt ? t('checkoutPayOnDeliveryUnsure') : t('checkoutOrderProcessingFailed'));
    }
  };

  // If order is completed, show Order Summary Confirmation
  // The old confirmation screen lived here. It is gone because it was dead — the
  // customer now goes to Mollie and comes back to /order/:id, and setCompletedOrder
  // was never called again. It also told every buyer "a confirmation email has been
  // sent to you" when the shop has no email of any kind.

  return (
    <div className="min-h-screen bg-[#eceef2] text-gray-900 font-sans py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Back Button */}
        <div className="flex items-center justify-between">
          <Link 
            to="/products"
            className="inline-flex items-center space-x-2 px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs uppercase tracking-wider rounded-lg transition-colors shadow-2xs"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t('checkoutBackToStore')}</span>
          </Link>

          <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
            {t('checkoutSecureCheckout')}
          </span>
        </div>

        {/* Main Grid: Left Column (Cart + Customer Details) | Right Column (Shipping + Payment + Order Summary) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* ================= LEFT COLUMN ================= */}
          <div className="lg:col-span-7 space-y-6">

            {/* 1. Shopping Cart Summary Card */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 space-y-4">
              <h2 className="text-xl font-black text-gray-900 tracking-tight">
                {t('authCartTitle')}
              </h2>

              {cartItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500 space-y-3">
                  <ShoppingCart className="w-10 h-10 mx-auto text-gray-300" />
                  <p className="font-bold text-sm">{t('emptyCart')}</p>
                  <Link to="/products" className="inline-block text-xs font-bold text-orange-600 hover:underline">
                    {t('authCartBrowseProducts')}
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Table Header */}
                  <div className="grid grid-cols-12 text-[0.6875rem] font-bold text-gray-400 uppercase border-b border-gray-100 pb-2">
                    <span className="col-span-6">{t('checkoutItemHeader')}</span>
                    <span className="col-span-3 text-right">{t('checkoutPriceHeader')}</span>
                    <span className="col-span-3 text-right">{t('checkoutSumHeader')}</span>
                  </div>

                  {/* Cart Items List */}
                  <div className="divide-y divide-gray-100">
                    {cartItems.map((item, idx) => {
                      // A studio design opens its page pictures, never the print file (a
                      // two-sided PDF can be 40 MB; a one-sided PNG is no PDF at all).
                      const designPages = Array.isArray(item.fileSpecs?.previews) && item.fileSpecs.previews.length ? item.fileSpecs.previews : null;
                      const pdfFileUrl = designPages ? null : item.fileUrl || item.fileSpecs?.fileUrl || item.fileSpecs?.previewUrl || (item.image?.startsWith('data:') || item.image?.includes('.pdf') ? item.image : null);
                      // The server's line wins. It re-prices every line from
                      // productId in cart order and it is what the payment will
                      // charge; the figures stored with the basket line are a
                      // preview from the moment it was added, and after a
                      // quantity change they are not even that. They stand in
                      // only while the quote is still in flight — and a stale or
                      // minimal cart entry may not carry them at all, which is
                      // what the trailing 0 (rendered as "—") is for.
                      const quoteLine = serverQuote?.items?.[idx];
                      const unitPrice = Number(quoteLine?.unitPrice) || Number(item.unitPrice) || 0;
                      const lineTotal = Number(quoteLine?.totalPrice) || Number(item.totalPrice) || 0;

                      return (
                        <div key={item.id ?? `${item.productId}-${idx}`} className="grid grid-cols-12 items-center py-3 text-xs gap-2">
                          {/* Thumbnail & Title */}
                          <div className="col-span-6 flex items-center space-x-3">
                            <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center relative group">
                              {designPages ? (
                                <SafeImage src={designPages[0].url} alt="" className="w-full h-full object-contain bg-white" />
                              ) : item.image ? (
                                <SafeImage src={item.image} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <FileText className="w-5 h-5 text-gray-400" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-gray-900 truncate">
                                {item.productName || item.fileName || quoteLine?.name || t('checkoutPrintProduct')}
                              </p>
                              {item.widthCm && (
                                <p className="text-[0.625rem] text-gray-500">
                                  {item.widthCm}cm × {item.heightCm}cm
                                </p>
                              )}

                              {/* Quantity Controls Pill & PDF Preview Button */}
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <div className="inline-flex items-center space-x-1 bg-gray-100 p-0.5 rounded-md border border-gray-200">
                                  <span className="px-2 font-bold text-gray-700">{item.quantity}</span>
                                  <span className="text-[0.625rem] text-gray-400 font-bold pr-1">{t('checkoutPcs')}</span>
                                  {/* p-2, not p-1: a 20px hit area is fiddly
                                      with a thumb, and Delete sits right next
                                      to Increase. */}
                                  <button
                                    onClick={() => updateQuantity(item.id, 1)}
                                    className="p-2 hover:bg-gray-200 rounded text-gray-600"
                                    title={t('checkoutIncrease')}
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => removeItem(item.id)}
                                    className="p-2 hover:bg-red-100 text-red-600 rounded"
                                    title={t('checkoutDelete')}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {designPages && (
                                  <button
                                    type="button"
                                    onClick={() => setDesignPagesModal({ name: item.productName || item.fileSpecs?.fileName || '', pages: designPages })}
                                    data-rx-checkout-design={item.id}
                                    className="inline-flex items-center space-x-1 px-2 py-0.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 rounded-md text-[0.625rem] font-black transition-colors shadow-2xs"
                                  >
                                    <Eye className="w-3 h-3 text-orange-600 shrink-0" />
                                    <span>{t('checkoutViewDesign')}</span>
                                  </button>
                                )}
                                {pdfFileUrl && (
                                  <button
                                    type="button"
                                    onClick={() => setPreviewPdfModal({
                                      isOpen: true,
                                      fileUrl: pdfFileUrl,
                                      fileName: item.fileName || item.fileSpecs?.fileName || item.productName || 'Document_Proof.pdf',
                                      widthCm: item.widthCm || item.fileSpecs?.widthCm,
                                      heightCm: item.heightCm || item.fileSpecs?.heightCm,
                                    })}
                                    className="inline-flex items-center space-x-1 px-2 py-0.5 bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-700 rounded-md text-[0.625rem] font-black transition-colors shadow-2xs"
                                  >
                                    <Eye className="w-3 h-3 text-orange-600 shrink-0" />
                                    <span>{t('checkoutPreviewPdf')}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Price */}
                          <div className="col-span-3 text-right font-semibold text-gray-700">
                            {unitPrice ? `${unitPrice} kr` : '—'}
                          </div>

                          {/* Sum */}
                          <div className="col-span-3 text-right font-black text-gray-900">
                            {lineTotal ? `${lineTotal} kr` : '—'}
                          </div>

                          {/* Bought as "Design online" without the design: made here, or
                              after paying from the order page — the order waits for it. */}
                          {designLaterOf(item) && (
                            <div className="col-span-12 space-y-1.5" data-rx-checkout-design-later={item.id}>
                              <p className="flex items-center gap-1 text-[0.6875rem] font-black text-amber-700">
                                <PenTool className="w-3.5 h-3.5" />
                                {t('stDlPending')}
                              </p>
                              <DesignLater
                                marker={designLaterOf(item)!}
                                productId={item.productId!}
                                productName={item.productName || ''}
                                className="max-w-xs"
                                saveKey={`line:${item.id}`}
                                onDesigned={(design) => {
                                  try {
                                    attachDesignOrSay(item.id, design, t);
                                  } finally {
                                    loadCart();
                                  }
                                }}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Subtotal Display — one mode tag here covers the dense
                      per-row Price/Sum cells above. The subtotal is always the
                      net sum, regardless of the header's VAT toggle. */}
                  <div className="pt-3 border-t border-gray-100 text-right">
                    <span className="text-xs font-bold text-gray-500 mr-2">{t('checkoutSubtotal')}</span>
                    <span className="text-base font-black text-gray-900">SEK {rawSubtotal} kr</span>
                    <VatTag mode="excl" className="ml-1" />
                  </div>
                </div>
              )}
            </div>

            {/* Discount Code Input */}
            <div className="flex items-center space-x-2">
              <input 
                type="text" 
                placeholder={t('checkoutCouponPlaceholder')} 
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value)}
                className="bg-white border border-gray-300 rounded-xl px-4 py-2 text-xs font-bold text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 flex-1 shadow-2xs"
              />
              <button 
                onClick={handleApplyDiscount}
                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors"
              >
                {t('checkoutSet')}
              </button>
            </div>
            {appliedDiscount && (
              <p className="text-xs font-bold text-green-600">
                {t('checkoutDiscountCodeApplied').replace('{0}', appliedDiscount.code).replace('{1}', String(appliedDiscount.percent))}
              </p>
            )}
            {discountError && (
              <p className="text-xs font-bold text-red-600">
                {discountError}
              </p>
            )}

            {/* 2. Customer Details Section */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 space-y-6">
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <h2 className="text-xl font-black text-gray-900 tracking-tight">
                  {t('checkoutCustomerDetails')}
                </h2>
                {!user ? (
                  <button 
                    onClick={login}
                    className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold text-xs rounded-lg transition-colors"
                  >
                    {t('signIn')}
                  </button>
                ) : (
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    {t('checkoutSignedInAs').replace('{0}', user.email ?? '')}
                  </span>
                )}
              </div>

              {/* Form Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-semibold">
                
                {/* Company & Tax ID */}
                <div>
                  <label htmlFor="co-company" className="block text-gray-600 mb-1">{t('checkoutCompanyLabel')}</label>
                  <input
                    id="co-company"
                    autoComplete="organization" 
                    type="text" 
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isBusiness}
                      onChange={(e) => setIsBusiness(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>
                      <span className="block text-gray-800 font-bold">{t('checkoutBusinessLabel')}</span>
                      <span className="block text-[0.6875rem] text-gray-500 font-medium mt-0.5">{t('checkoutBusinessHint')}</span>
                    </span>
                  </label>
                </div>

                <div>
                  <label htmlFor="co-taxid" className="block text-gray-600 mb-1">
                    {isBusiness ? t('checkoutVatNumberLabel') : t('checkoutTaxIdLabel')}
                  </label>
                  <input
                    id="co-taxid"
                    autoComplete="off" 
                    type="text" 
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    placeholder={t('checkoutTaxIdPlaceholder')}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>

                {/* First & Last Name */}
                <div>
                  <label htmlFor="co-firstname" className="block text-gray-600 mb-1">{t('checkoutFirstNameLabel')}</label>
                  <input
                    id="co-firstname"
                    autoComplete="given-name" 
                    type="text" 
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>

                <div>
                  <label htmlFor="co-lastname" className="block text-gray-600 mb-1">{t('checkoutLastNameLabel')}</label>
                  <input
                    id="co-lastname"
                    autoComplete="family-name" 
                    type="text" 
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>

                {/* Address 1 & Address 2 */}
                <div>
                  <label htmlFor="co-address1" className="block text-gray-600 mb-1">{t('checkoutAddress1Label')}</label>
                  <input
                    id="co-address1"
                    autoComplete="address-line1" 
                    type="text" 
                    value={address1}
                    onChange={(e) => setAddress1(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>

                <div>
                  <label htmlFor="co-address2" className="block text-gray-600 mb-1">{t('checkoutAddress2Label')}</label>
                  <input
                    id="co-address2"
                    autoComplete="address-line2" 
                    type="text" 
                    value={address2}
                    onChange={(e) => setAddress2(e.target.value)}
                    placeholder={t('checkoutAddress2Placeholder')}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>

                {/* Postcode & City */}
                <div>
                  <label htmlFor="co-postcode" className="block text-gray-600 mb-1">{t('checkoutPostcodeLabel')}</label>
                  <input
                    id="co-postcode"
                    autoComplete="postal-code" 
                    type="text" 
                    value={postcode}
                    onChange={(e) => setPostcode(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>

                <div>
                  <label htmlFor="co-city" className="block text-gray-600 mb-1">{t('checkoutCityLabel')}</label>
                  <input
                    id="co-city"
                    autoComplete="address-level2" 
                    type="text" 
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                  />
                </div>

                {/* Country Dropdown */}
                <div className="sm:col-span-2">
                  <label htmlFor="co-country" className="block text-gray-600 mb-1">{t('checkoutCountryLabel')}</label>
                  <select
                    id="co-country"
                    autoComplete="country-name" 
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-bold"
                  >
                    {/* Billing may be any country he has — a Norwegian company
                        can have the goods delivered to Sweden even when he does
                        not ship to Norway. */}
                    {shipping.countries.map((c) => (
                      <option key={c.code} value={c.code}>{countryLabel(c, language)}</option>
                    ))}
                  </select>
                </div>

                {/* Email Address & Billing Email */}
                <div>
                  <label htmlFor="co-email" className="block text-gray-600 mb-1">{t('checkoutEmailLabel')}</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
                    <input 
                      id="co-email"
                      autoComplete="email"
                      
                      type="email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="co-billemail" className="block text-gray-600 mb-1">{t('checkoutBillingEmailLabel')}</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
                    <input 
                      id="co-billemail"
                      autoComplete="email"
                      
                      type="email" 
                      value={billingEmail}
                      onChange={(e) => setBillingEmail(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                    />
                  </div>
                </div>

                {/* Phone */}
                <div className="sm:col-span-2">
                  <label htmlFor="co-phone" className="block text-gray-600 mb-1">{t('checkoutPhoneLabel')}</label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
                    <input 
                      id="co-phone"
                      autoComplete="tel"
                      
                      type="tel" 
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      placeholder="+46 70 000 0000"
                      className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500 font-medium"
                    />
                  </div>
                </div>

              </div>

              {/* Checkboxes */}
              <div className="space-y-2 pt-2 border-t border-gray-100 text-xs font-medium text-gray-700">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={differentShippingAddress}
                    onChange={(e) => {
                      setDifferentShippingAddress(e.target.checked);
                      // Start the delivery country where the billing one is —
                      // most second addresses are in the same country, and the
                      // customer can change it right below.
                      // A billing country he does not deliver to cannot be the
                      // delivery country: then it starts on his home country.
                      if (e.target.checked) setShipCountry(countryOf(shipping, country)?.enabled ? country : shipping.homeCountry);
                    }}
                    className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 shrink-0 cursor-pointer"
                  />
                  <span>{t('checkoutDifferentShipping')}</span>
                </label>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={notifyEmail}
                    onChange={(e) => setNotifyEmail(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500 shrink-0 cursor-pointer"
                  />
                  <span>{t('checkoutNotifyEmail')}</span>
                </label>
              </div>

              {/* Conditional Different Shipping Address Form */}
              {differentShippingAddress && (
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-3 pt-3">
                  <h4 className="font-bold text-xs text-gray-800 uppercase tracking-wider">{t('checkoutShippingAddressDetails')}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <input 
                      type="text" 
                      placeholder={t('checkoutShipCompany')} 
                      value={shipCompany} 
                      onChange={(e) => setShipCompany(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg"
                    />
                    <input 
                      type="text" 
                      placeholder={t('checkoutShipFirstName')} 
                      value={shipFirstName} 
                      onChange={(e) => setShipFirstName(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg"
                    />
                    <input 
                      type="text" 
                      placeholder={t('checkoutShipLastName')} 
                      value={shipLastName} 
                      onChange={(e) => setShipLastName(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg"
                    />
                    <input 
                      type="text" 
                      placeholder={t('checkoutShipStreetAddress')} 
                      value={shipAddress1} 
                      onChange={(e) => setShipAddress1(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg"
                    />
                    <input 
                      type="text" 
                      placeholder={t('checkoutShipPostcode')} 
                      value={shipPostcode} 
                      onChange={(e) => setShipPostcode(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg"
                    />
                    <input 
                      type="text" 
                      placeholder={t('checkoutShipCity')} 
                      value={shipCity} 
                      onChange={(e) => setShipCity(e.target.value)}
                      className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg"
                    />
                    <select
                      id="co-ship-country"
                      aria-label={t('checkoutCountryLabel')}
                      autoComplete="shipping country-name"
                      value={shipCountry}
                      onChange={(e) => setShipCountry(e.target.value)}
                      className="sm:col-span-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg font-bold"
                    >
                      {shipping.countries.filter((c) => c.enabled).map((c) => (
                        <option key={c.code} value={c.code}>{countryLabel(c, language)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/*
                SAVE CHANGES — it now answers.

                This button had no onClick at all. On the one page where a
                customer is about to hand over money, they typed their address,
                pressed the only button under it, and NOTHING happened: no
                message, no tick, no change of any kind. The details were in
                fact already stored — the effect above writes the form to this
                browser on every keystroke — so the button was redundant AND
                silent, which is the worst of both: the work was done and the
                customer had every reason to believe it had failed.

                Rather than delete a control the owner asked for, it now
                confirms what is true. The confirmation clears itself so it
                cannot be mistaken for the state of the order.
              */}
              <button
                type="button"
                onClick={() => {
                  setDetailsSaved(true);
                  window.setTimeout(() => setDetailsSaved(false), 2500);
                }}
                className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs rounded-xl transition-colors uppercase tracking-wider flex items-center justify-center gap-2"
              >
                {detailsSaved ? <Check className="w-4 h-4 text-emerald-600" /> : null}
                {detailsSaved ? t('checkoutDetailsSaved') : t('saveChanges')}
              </button>
            </div>

          </div>

          {/* ================= RIGHT COLUMN ================= */}
          <div className="lg:col-span-5 space-y-6">

            {/* 3. Shipping Options */}
            <div className="space-y-3">
              <h2 className="text-lg font-black text-gray-900 tracking-tight">
                {t('checkoutShipping')}
              </h2>

              {/*
                A RADIO GROUP, NOT THREE CLICKABLE DIVS.

                These were plain <div onClick>. A div is not focusable and has no
                role, so choosing a delivery method was impossible with a keyboard
                and a screen reader announced three unlabelled blocks of text with
                no indication that they were a choice, or which one was taken. On
                the page where the customer commits to paying, that is not an
                inconvenience — it is a checkout they cannot complete.

                Real <input type="radio"> inside a <label>: focus, arrow-key
                movement between options, Space to select, the checked state read
                aloud, and the whole card clickable, all from the browser. The
                input is sr-only rather than hidden, because display:none would
                take the keyboard behaviour away again; peer-focus-visible draws
                the focus ring on the card the eye is actually on.
              */}
              <div
                role="radiogroup"
                aria-label={t('checkoutShipping')}
                className="bg-gray-100 p-2 rounded-2xl space-y-2 border border-gray-200"
              >
                {/* HIS MENU, AS THE SERVER DREW IT for the country on screen
                    (src/lib/shipping.ts via /api/checkout/quote): his methods,
                    in his order, at his price for that country — the fee the
                    order will be charged, not this browser's copy of the
                    settings from when the page was opened. These were three
                    cards typed into this file with the prices compiled in. */}
                <div role="status" aria-live="polite">
                  {cartItems.length > 0 && !serverQuote && (!quoteError || isQuoting) && (
                    <p className="px-3 py-2 text-[0.6875rem] font-bold text-gray-500">{t('checkoutShipLoading')}</p>
                  )}
                  {/* A quote that failed says so here, with a way to try again —
                      it used to read "Loading…" for good. */}
                  {cartItems.length > 0 && !serverQuote && quoteError && !isQuoting && (
                    <p className="px-3 py-2 text-[0.6875rem] font-bold text-red-700 flex flex-wrap items-center gap-2">
                      <span>{quoteError}</span>
                      <button type="button" onClick={() => setQuoteNonce((n) => n + 1)} className="px-2 py-1 rounded-lg bg-white border border-red-200 text-red-700 hover:bg-red-50">
                        {t('checkoutRetryQuote')}
                      </button>
                    </p>
                  )}
                  {serverQuote && shipOptions.length === 0 && (
                    <p className="px-3 py-2 text-[0.6875rem] font-bold text-red-700">
                      {t('checkoutNoDeliveryNoPickup').replace('{0}', labelOf(deliveryCode)).replace('{1}', t('checkoutDifferentShipping'))}
                    </p>
                  )}
                  {serverQuote && shipOptions.length > 0 && !shipOptions.some((o) => o.id !== 'pickup') && (
                    <p className="px-3 py-2 text-[0.6875rem] font-bold text-amber-800">
                      {t('checkoutNoDelivery').replace('{0}', labelOf(deliveryCode)).replace('{1}', t('checkoutDifferentShipping'))}
                    </p>
                  )}
                </div>
                {shipOptions.map((o) => (
                  <label
                    key={o.id}
                    data-ship-option={o.id}
                    className={cn(
                      "p-3 rounded-xl cursor-pointer transition-all flex items-center space-x-3 border",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orange-500 has-[:focus-visible]:ring-offset-1",
                      shippingMethod === o.id
                        ? "bg-white border-orange-500 shadow-sm"
                        : "bg-white/60 hover:bg-white border-transparent"
                    )}
                  >
                    <input
                      type="radio"
                      name="shippingMethod"
                      value={o.id}
                      checked={shippingMethod === o.id}
                      onChange={() => setShippingMethod(o.id)}
                      className="sr-only"
                    />
                    {o.id === 'pickup' ? (
                      <div className="w-16 h-10 bg-amber-100 text-amber-800 rounded-md flex items-center justify-center font-bold text-xs shrink-0 border border-amber-200">
                        <Building2 className="w-5 h-5 text-amber-700" />
                      </div>
                    ) : (
                      <div className={cn("w-16 h-10 text-white rounded-md flex items-center justify-center shrink-0", o.id === 'express' ? "bg-orange-600" : "bg-gray-900")}>
                        {o.id === 'express' ? <Zap className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-xs text-gray-900 leading-tight">{methodName(o, language)}</p>
                      {methodNote(o, language) && <p className="text-[0.6875rem] text-gray-500">{methodNote(o, language)}</p>}
                      {/* The legal text promises the delivery time is shown for
                          each option here; it never was. */}
                      <p className="text-[0.625rem] font-bold text-gray-400">{t('checkoutShipDays').replace('{0}', String(daysFor(o.id)))}</p>
                    </div>
                    {o.fee === 0 ? (
                      <span className="font-bold text-xs text-emerald-600">{t('checkoutNoFee')}</span>
                    ) : (
                      <span className="font-bold text-xs text-gray-900 whitespace-nowrap">
                        + {o.fee.toFixed(2)} kr
                        <VatTag mode="excl" className="ml-1" />
                      </span>
                    )}
                  </label>
                ))}

                {/* Where "collect it yourself" actually is.
                    Pickup used to say only "Self collection at print hub" — no
                    address, no hours — so choosing it told the customer nothing
                    about where to go or when the door is open. Everything here
                    is the owner's own text from Site Settings; with nothing
                    filled in the panel does not appear at all rather than
                    showing empty headings. */}
                {shippingMethod === 'pickup' && pickupHasDetails && (
                  <div className="mx-1 mb-1 p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                    {pickup.companyName && (
                      <p className="font-black text-xs text-gray-900">{pickup.companyName}</p>
                    )}
                    {pickup.address && (
                      <p className="text-[0.6875rem] font-bold text-gray-700 whitespace-pre-line flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-px" />
                        <span>{pickup.address}</span>
                      </p>
                    )}
                    {pickup.phone && (
                      <p className="text-[0.6875rem] font-bold text-gray-700 flex items-center gap-1.5">
                        <Phone className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        <a href={`tel:${pickup.phone.replace(/\s+/g, '')}`} className="hover:underline">
                          {pickup.phone}
                        </a>
                      </p>
                    )}

                    {pickupHours.length > 0 && (
                      <div className="pt-1.5 border-t border-amber-200/80">
                        <p className="text-[0.625rem] font-black uppercase tracking-wider text-amber-800 mb-1">
                          {t('checkoutPickupHours')}
                        </p>
                        <table className="text-[0.6875rem] font-bold text-gray-700">
                          <tbody>
                            {pickupHours.map((row) => (
                              <tr key={row.id}>
                                <td className="pr-4 py-0.5 text-gray-500">{row.days}</td>
                                <td className="py-0.5">{row.hours}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {pickup.note && (
                      <p className="text-[0.6875rem] font-semibold text-amber-900">{pickup.note}</p>
                    )}
                    {pickup.mapsUrl && (
                      <a
                        href={pickup.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[0.6875rem] font-black text-blue-700 hover:underline"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        {t('checkoutPickupMap')}
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 4. Payment Options */}
            <div className="space-y-3">
              <h2 className="text-lg font-black text-gray-900 tracking-tight">
                {t('checkoutPayment')}
              </h2>

              {/* PAY ON DELIVERY, for the customers the owner chose: the two ways side
                  by side. Nobody else sees this choice. */}
              {onDeliveryAllowed && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t('checkoutPayment')} data-rx-pay-choice>
                  {([
                    { id: 'online', on: !payOnDelivery, title: t('checkoutPayOnline'), sub: t('checkoutPaySubtitle'), Icon: CreditCard },
                    { id: 'on_delivery', on: payOnDelivery, title: t('checkoutPayOnDelivery'), sub: t('checkoutPayOnDeliveryHint'), Icon: Truck },
                  ] as const).map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={o.on}
                      onClick={() => setPayOnDelivery(o.id === 'on_delivery')}
                      data-rx-pay-choice-option={o.id}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-2xl border text-left transition-colors',
                        o.on ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200 bg-white hover:border-gray-400',
                      )}
                    >
                      <o.Icon className="w-5 h-5 text-gray-700 shrink-0" />
                      <span>
                        <span className="block text-xs font-black text-gray-900">{o.title}</span>
                        <span className="block text-[0.625rem] text-gray-500">{o.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {payOnDelivery ? (
                <div className="bg-white p-4 rounded-2xl border border-gray-200 space-y-2" data-rx-pay-on-delivery-note>
                  <p className="text-[0.6875rem] text-gray-700 font-bold leading-relaxed">
                    {t('checkoutPayOnDeliveryNote').replace('{0}', `${totals.grossTotal.toFixed(2)} kr`)}
                  </p>
                  {/* Spent only when the money arrives — days later on delivery — so the
                      same points or a once-only code would also buy a second order. */}
                  {onDeliveryBlockedByDiscounts && (
                    <p role="alert" className="text-[0.6875rem] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-rx-pay-on-delivery-no-discounts>
                      {t('checkoutPayOnDeliveryNoDiscounts')}
                    </p>
                  )}
                </div>
              ) : (
              <div className="bg-white p-4 rounded-2xl border border-gray-200 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-8 bg-gray-900 text-white rounded-md flex items-center justify-center font-black text-[0.625rem] shrink-0">
                    PAY
                  </div>
                  <div>
                    <p className="font-bold text-xs text-gray-900">{t('checkoutPayTitle')}</p>
                    <p className="text-[0.625rem] text-gray-500">{t('checkoutPaySubtitle')}</p>
                  </div>
                </div>
                {/* WHAT THIS SHOP CAN ACTUALLY BE PAID WITH.
                    Read from Mollie, so whatever the owner switches on in his
                    Mollie dashboard shows up here without a code change. Not a
                    picker: the customer still chooses on Mollie's own page, and
                    offering a choice here that the next page might not honour
                    would be worse than showing none. This is the answer to
                    "what can I pay with?" before committing to find out.
                    An empty list — no key, Mollie unreachable — simply renders
                    nothing, leaving the generic card above exactly as it was. */}
                {paymentMethods.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {paymentMethods.map((m) => (
                      <span
                        key={m.id}
                        title={m.description}
                        className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1"
                      >
                        {m.imageSvg && (
                          <img
                            src={m.imageSvg}
                            alt=""
                            aria-hidden="true"
                            className="h-4 w-auto"
                            loading="lazy"
                            // Mollie's CDN, and the name is beside it anyway, so
                            // a blocked image costs the shopper nothing.
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}
                        <span className="text-[0.625rem] font-bold text-gray-700">{m.description}</span>
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[0.6875rem] text-gray-500 leading-relaxed">{t('checkoutPayNote')}</p>
              </div>
              )}
            </div>

            {/* 5. Order Summary Card */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200 space-y-4">
              <h2 className="text-lg font-black text-gray-900 tracking-tight flex items-center justify-between">
                <span>{t('checkoutOrderSummary')}</span>
                <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 flex items-center gap-1">
                  <Coins className="w-3.5 h-3.5 text-amber-500" />
                  {userPointsBalance} PTS
                </span>
              </h2>

              {/* Coupon / Promo Code Box */}
              <div className="bg-orange-50/60 rounded-2xl p-4 border border-orange-200/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Tag className="w-4 h-4 text-orange-600 shrink-0" />
                    <span className="font-extrabold text-xs text-gray-900 uppercase tracking-wide">
                      {t('checkoutCouponCode')}
                    </span>
                  </div>
                  {appliedDiscount && (
                    <span className="text-[0.625rem] font-extrabold bg-emerald-600 text-white px-2 py-0.5 rounded-full uppercase">
                      {t('checkoutDiscountAppliedBadge').replace('{0}', String(appliedDiscount.percent))}
                    </span>
                  )}
                </div>

                {appliedDiscount ? (
                  <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200/90 rounded-xl text-xs font-bold text-emerald-900 shadow-2xs">
                    <div className="flex items-center space-x-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <div>
                        <p className="font-black text-emerald-950 uppercase">{appliedDiscount.code}</p>
                        <p className="text-[0.625rem] text-emerald-700 font-medium">
                          {t('checkoutPercentDiscountDetail').replace('{0}', String(appliedDiscount.percent)).replace('{1}', discountAmount.toFixed(2))}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveDiscount}
                      className="text-xs text-red-600 hover:text-red-800 font-extrabold underline px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    >
                      {t('checkoutRemove')}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleApplyDiscount} className="space-y-2">
                    <div className="flex space-x-2">
                      <input
                        type="text"
                        value={discountCode}
                        onChange={(e) => setDiscountCode(e.target.value)}
                        placeholder={t('checkoutCouponPlaceholder')}
                        className="flex-1 uppercase px-3 py-2 bg-white border border-gray-300 rounded-xl text-xs font-bold text-gray-900 placeholder:normal-case placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                      <button
                        type="submit"
                        disabled={isValidatingCoupon || !discountCode.trim()}
                        className={cn(
                          "px-4 py-2 rounded-xl text-xs font-black transition-all shadow-2xs flex items-center shrink-0",
                          isValidatingCoupon || !discountCode.trim()
                            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                            : "bg-orange-600 hover:bg-orange-500 text-white shadow-sm cursor-pointer active:scale-95"
                        )}
                      >
                        {isValidatingCoupon ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          t('checkoutApply')
                        )}
                      </button>
                    </div>

                    {discountError && (
                      <p className="text-[0.6875rem] font-bold text-red-600 flex items-center gap-1.5 pt-0.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{discountError}</span>
                      </p>
                    )}

                    <p className="text-[0.625rem] text-gray-500">
                    </p>
                  </form>
                )}

                {/* THE BASKET CHANGED AFTER THE CODE WAS ACCEPTED.
                    The server re-decides the coupon on every quote, and it can
                    stop applying — the shopper removed the one product it was
                    scoped to, or the last eligible item. This was computed and
                    then thrown away: quoteError was assigned in three places and
                    rendered in none, so the discount simply vanished from the
                    total with nothing to explain it. */}
                {quoteError && !discountError && (
                  <p className="text-[0.6875rem] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{quoteError}</span>
                  </p>
                )}
              </div>

              {/* Loyalty Points Redemption Box */}
              <div className="bg-amber-50/80 rounded-2xl p-4 border border-amber-200/90 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Coins className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="font-extrabold text-xs text-amber-950 uppercase tracking-wide">
                      {t('checkoutRedeemPoints')}
                    </span>
                  </div>
                  {/* 4.26 — the rate, from the setting. It read "10 PTS = 1
                      SEK" as a literal, so changing the rate left the badge
                      advertising the old one. */}
                  <span className="text-[0.625rem] font-extrabold bg-amber-500 text-white px-2 py-0.5 rounded-full uppercase">
                    {loyalty.pointsPerSek} PTS = 1 SEK
                  </span>
                </div>

                {/* 4.21 — A MINIMUM REDEMPTION.
                    A balance under the minimum used to show a slider whose
                    maximum was zero: a control that cannot be moved, with
                    nothing to say why. */}
                {userPointsBalance > 0 && maxRedeemablePoints <= 0 && loyalty.minRedeemPoints > 0 ? (
                  <p className="text-xs text-amber-800 font-medium">
                    {t('checkoutPointsMinimum')
                      .replace('{0}', String(loyalty.minRedeemPoints))
                      .replace('{1}', String(userPointsBalance))}
                  </p>
                ) : userPointsBalance > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-amber-900">
                      <span>{t('checkoutRedeemPointsLabel')}</span>
                      <span className="text-amber-700 font-black">{effectivePointsToRedeem} PTS (-{pointsDiscountAmount} kr)</span>
                    </div>
                    
                    <input 
                      type="range"
                      min={0}
                      max={maxRedeemablePoints}
                      // One krona's worth per notch, whatever the rate is.
                      step={loyalty.pointsPerSek}
                      // Where he put it, not the last quote's answer: that one is
                      // a moment behind, and the handle jumped back to it.
                      value={Math.min(pointsToRedeem, maxRedeemablePoints)}
                      onChange={(e) => setPointsToRedeem(Number(e.target.value))}
                      className="w-full accent-amber-600 h-2 bg-amber-200/90 rounded-lg cursor-pointer"
                    />

                    <div className="flex justify-between items-center text-[0.625rem] font-extrabold text-amber-800">
                      <button 
                        type="button" 
                        onClick={() => setPointsToRedeem(0)}
                        className="hover:underline text-amber-600"
                      >
                        {t('checkoutZeroPoints')}
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setPointsToRedeem(maxRedeemablePoints)}
                        className="hover:underline text-amber-800 font-black"
                      >
                        {t('checkoutMaxPoints')
                          .replace('{0}', String(maxRedeemablePoints))
                          .replace('{1}', String(Math.floor(maxRedeemablePoints / loyalty.pointsPerSek)))}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-amber-800 font-medium">
                    {t('checkoutNoPointsPrefix')} <span className="font-black text-emerald-700">+{pointsEarnedThisOrder} PTS</span> {t('checkoutNoPointsSuffix')}
                  </p>
                )}

                {/* Points Earned Banner */}
                <div className="pt-2 border-t border-amber-200/60 flex items-center justify-between text-xs font-bold text-emerald-800">
                  <span className="flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                    {t('checkoutPointsEarned')}
                  </span>
                  <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full text-xs font-black">
                    +{pointsEarnedThisOrder} PTS
                  </span>
                </div>
              </div>

              <div className="space-y-2 text-xs font-semibold">
                <div className="flex justify-between text-gray-600">
                  <span>{t('checkoutSubtotal')}</span>
                  <span className="font-bold text-gray-900">
                    {discountedSubtotal.toFixed(2)} kr
                    <VatTag mode="excl" className="ml-1" />
                  </span>
                </div>

                {pointsDiscountAmount > 0 && (
                  <div className="flex justify-between text-amber-700 font-bold bg-amber-50 p-2 rounded-lg">
                    <span className="flex items-center gap-1">
                      <Coins className="w-3.5 h-3.5" />
                      {t('checkoutPointsDiscount').replace('{0}', String(effectivePointsToRedeem))}
                    </span>
                    <span>-{pointsDiscountAmount.toFixed(2)} kr</span>
                  </div>
                )}

                <div className="flex justify-between text-gray-600">
                  <span>
                    {(() => {
                      const o = shipOptions.find((x) => x.id === shippingMethod);
                      return o ? methodName(o, language) : t('checkoutShipping');
                    })()}
                  </span>
                  <span className="font-bold text-gray-900 whitespace-nowrap">
                    {selectedShippingCost.toFixed(2)} kr
                    <VatTag mode="excl" className="ml-1" />
                  </span>
                </div>

                <div className="flex justify-between text-gray-500">
                  <span>{t('checkoutExclVat')}</span>
                  <span className="font-bold text-gray-700">{totals.netTotal.toFixed(2)} kr</span>
                </div>

                <div className="flex justify-between text-gray-500">
                  <span>{t('checkoutVatLine').replace('{0}', String(Math.round((serverQuote?.vatRate ?? 0.25) * 1000) / 10))}</span>
                  <span className="font-bold text-gray-700">{totals.vatAmount.toFixed(2)} kr</span>
                </div>

                {/* The amount that will actually be charged.
                    This used to render formatPriceWithVat(...), which follows the
                    incl./excl. VAT switch in the header AND converts to the
                    selected display currency. With the switch at its default the
                    customer read "Payment Due: 1 000 kr" and Mollie then asked for
                    1 250 kr — and in EUR the page said €88 while the charge was
                    1250 SEK. What is charged is gross, in SEK, full stop. */}
                <div className="border-t border-gray-200 pt-3 flex justify-between items-baseline">
                  <span className="font-black text-sm text-gray-900 uppercase">{t('checkoutPaymentDue')}</span>
                  <span className="text-xl font-black text-gray-900">
                    {totals.grossTotal.toFixed(2)} kr
                    <VatTag mode="incl" className="ml-1" />
                  </span>
                </div>
              </div>

              {/* Comments Textarea */}
              <div className="pt-2">
                <label className="block text-xs font-bold text-gray-700 mb-1">{t('checkoutComments')}</label>
                <textarea 
                  rows={3}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder={t('checkoutCommentsPlaceholder')}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {/* Validation Alert */}
              {validationError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 font-bold text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}

              {/* Acceptance of the terms, required before an order can be placed. */}
              <label className="flex items-start gap-2.5 cursor-pointer select-none py-1">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => { setAcceptedTerms(e.target.checked); setValidationError(null); }}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-2 focus:ring-gray-900 shrink-0 cursor-pointer"
                />
                <span className="text-[0.6875rem] leading-relaxed text-gray-600 font-medium">
                  {t('checkoutAcceptPrefix')}{' '}
                  <Link to="/terms" target="_blank" className="font-bold text-gray-900 underline underline-offset-2 hover:text-orange-600">
                    {t('checkoutTermsLink')}
                  </Link>{' '}
                  {t('checkoutAcceptAnd')}{' '}
                  <Link to="/privacy" target="_blank" className="font-bold text-gray-900 underline underline-offset-2 hover:text-orange-600">
                    {t('checkoutPrivacyLink')}
                  </Link>
                  {t('checkoutAcceptSuffix')}
                </span>
              </label>

              {/* Action Button: this IS the last step — the customer goes
                  straight from here to the payment page, so the button says
                  "Pay" rather than "Next", which promised a step that does not
                  exist. */}
              <button 
                onClick={handlePlaceOrder}
                disabled={isSubmitting || cartItems.length === 0 || !acceptedTerms || !quoteReady || designSaving || onDeliveryBlockedByDiscounts}
                className={cn(
                  "w-full py-3.5 rounded-xl font-black text-sm uppercase tracking-wider transition-all shadow-md flex items-center justify-center space-x-2",
                  isSubmitting || cartItems.length === 0 || !acceptedTerms || !quoteReady || designSaving || onDeliveryBlockedByDiscounts
                    ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                    : "bg-[#b3d386] hover:bg-[#a1c672] text-gray-900 shadow-sm cursor-pointer active:scale-98"
                )}
              >
                {isSubmitting ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <span>{payOnDelivery ? t('checkoutPlaceOnDelivery') : t('checkoutPay')}</span>
                    {payOnDelivery ? <Truck className="w-4 h-4" /> : <CreditCard className="w-4 h-4" />}
                  </>
                )}
              </button>

            </div>

          </div>

        </div>

      </div>

      <DesignPagesModal open={!!designPagesModal} name={designPagesModal?.name ?? ''} pages={designPagesModal?.pages ?? []} onClose={() => setDesignPagesModal(null)} t={t} />

      {/* PDF Proof Previewer Modal */}
      <PdfPreviewModal
        isOpen={previewPdfModal.isOpen}
        onClose={() => setPreviewPdfModal(prev => ({ ...prev, isOpen: false }))}
        fileUrl={previewPdfModal.fileUrl}
        fileName={previewPdfModal.fileName}
        widthCm={previewPdfModal.widthCm}
        heightCm={previewPdfModal.heightCm}
      />
    </div>
  );
}
