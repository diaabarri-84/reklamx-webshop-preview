import React, { useState, useEffect } from 'react';
import { collection, getDocs, getDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { auth } from '../../firebase';
import { db } from '../../firebase';
import { useConfirmDialog } from '../ConfirmDialog';
import { useAuth } from '../../App';
import { UserProfile } from '../../types';
import { 
  Tag, 
  Coins, 
  Plus, 
  Trash2, 
  Edit3, 
  CheckCircle2, 
  XCircle, 
  ShieldAlert, 
  Sparkles, 
  Users, 
  Search,
  Calendar,
  Percent,
  RefreshCw,
  Award,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Ban,
  CalendarClock,
  History,
  Layers,
  Copy,
  Download,
  X,
  AlertTriangle
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { couponStatus, couponUsageLabel, couponStatusIsToggleable, couponIsFull } from '../../lib/couponStatus';
import { couponLimit, liveCouponHolders } from '../../lib/couponRules';
import {
  saveCoupon, deleteCoupon as deleteCouponApi, bulkCoupons, couponAudit, couponStats, codesToCsv,
  type CouponAuditEntry, type CouponStatRow,
} from '../../lib/couponsApi';
import {
  loyaltyLiability, loyaltyLedger, expirePoints,
  type LoyaltyLiability, type LoyaltyLedger,
} from '../../lib/loyaltyApi';
import { loyaltySettingsFrom, pointsValueSek, tierForSpend, LOYALTY_DEFAULTS } from '../../lib/loyalty';

export interface CouponData {
  id: string;
  code: string;
  percent: number;
  active: boolean;
  minOrderAmount?: number;
  expiresAt?: string;
  createdAt?: string;
  /** Total redemptions allowed across all customers. Empty = unlimited. */
  maxUses?: number;
  /** Each customer may redeem this code once. */
  oncePerCustomer?: boolean;
  /** Redemptions so far. Maintained by the order flow, never by this screen. */
  usedCount?: number;
  /**
   * Uses that unpaid orders hold right now (PAY-02) — each customer once, as the
   * till counts them. Worked out from the `holds` on the document this screen
   * reads anyway; never written from here.
   */
  heldUses?: number;
  /**
   * WHAT THIS CODE APPLIES TO.
   *
   * 'all' — the whole basket, which is what every coupon written before
   * 2026-09-08 means and what a missing value falls back to on the server.
   * 'products' — only the products listed in productIds.
   *
   * Note the server ALSO refuses to discount any line already sold at a
   * special-offer price, whatever the scope says. That rule is not stored here
   * because it belongs to the product, not to the coupon.
   */
  scope?: 'all' | 'products';
  productIds?: string[];
  /** The ceiling in kronor. Required above 50% — see handleSaveCoupon. */
  maxDiscountAmount?: number | null;
  /** 4.10 — the day it starts working. */
  startsAt?: string;
  /** 4.11 — who may use it. */
  audience?: 'all' | 'business' | 'individual';
  /** 4.12 */
  firstOrderOnly?: boolean;
  /** 4.13 */
  noStacking?: boolean;
  /** 4.9 */
  discountIncludesShipping?: boolean;
  /** 4.7 — null means "use the shop-wide floor". */
  minMarginPercent?: number | null;
  /** Set on codes made by a batch, so a print run can be found again. */
  batchPrefix?: string;
}

export default function CouponsLoyaltyAdmin() {
  const { user, t } = useAuth();
  // In-page dialogs, never window.confirm/alert — a browser that has been told
  // to stop prompting silences those, and the action then does nothing at all.
  const { confirm, notify, dialog: confirmDialog } = useConfirmDialog();
  
  // Guard: ONLY main admin allowed
  const isMainAdmin = user?.role === 'admin';

  const [activeSubTab, setActiveSubTab] = useState<'coupons' | 'loyalty'>('coupons');

  // Coupon State
  const [coupons, setCoupons] = useState<CouponData[]>([]);
  const [loadingCoupons, setLoadingCoupons] = useState(true);
  const [couponSearch, setCouponSearch] = useState('');

  // Coupon Form State
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [percent, setPercent] = useState<number>(10);
  const [active, setActive] = useState(true);
  const [minOrderAmount, setMinOrderAmount] = useState<number | ''>('');
  const [maxUses, setMaxUses] = useState<number | ''>('');
  const [maxDiscountAmount, setMaxDiscountAmount] = useState<number | ''>('');
  // Reset with the form, so a confirmation given for one coupon cannot carry
  // over to the next one the owner opens.
  const [deepDiscountConfirmed, setDeepDiscountConfirmed] = useState(false);
  // 4.4 — ON for a new code. A discount code with no per-customer limit can be
  // posted publicly and redeemed by the same account every day until the usage
  // limit runs out; "once each" is what a campaign almost always means, and the
  // owner has to choose the dangerous one deliberately. Editing an existing
  // coupon still loads what was stored — this default only applies to new ones.
  const [oncePerCustomer, setOncePerCustomer] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  // 4.10 to 4.13, plus 4.9 and 4.7. Every default is what a coupon written
  // before these existed already does, so nothing changes for the old codes.
  const [startsAt, setStartsAt] = useState('');
  const [audience, setAudience] = useState<'all' | 'business' | 'individual'>('all');
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [noStacking, setNoStacking] = useState(false);
  const [discountIncludesShipping, setDiscountIncludesShipping] = useState(false);
  const [minMarginPercent, setMinMarginPercent] = useState<number | ''>('');
  const [scope, setScope] = useState<'all' | 'products'>('all');
  const [productIds, setProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [savingCoupon, setSavingCoupon] = useState(false);

  // 4.14 — a batch of codes. The same modal, in a different mode: a batch needs
  // every rule a single coupon needs, and duplicating the form to ask for them
  // again is how the two drift apart.
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkPrefix, setBulkPrefix] = useState('');
  const [bulkCount, setBulkCount] = useState<number | ''>(25);
  const [bulkLength, setBulkLength] = useState<number>(6);
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);

  // 4.15 — who changed what.
  const [showAudit, setShowAudit] = useState(false);
  const [auditEntries, setAuditEntries] = useState<CouponAuditEntry[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // The catalogue, for the "which products?" picker. Read straight from
  // Firestore like fetchUsers does — products are world-readable, so this needs
  // no server round-trip. Only the fields the picker shows are kept: product
  // documents carry base64 images and this screen must not hold the catalogue in
  // memory twice over.
  const [productList, setProductList] = useState<{ id: string; name: string; basePrice: number; salePrice: number | null }[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);

  // Loyalty Points State
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [userSearch, setUserSearch] = useState('');

  // 4.20 — the debt. It existed on the server and nothing showed it.
  const [liability, setLiability] = useState<LoyaltyLiability | null>(null);

  // 4.26 — the rates, his to set. Loaded from settings/printSettings, which is
  // the same document the shop and the server read.
  const [loyaltyForm, setLoyaltyForm] = useState(LOYALTY_DEFAULTS);
  const [savingLoyalty, setSavingLoyalty] = useState(false);
  const [loyaltySaved, setLoyaltySaved] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);

  // 4.18 — the expiry sweep, dry run first.
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<{
    dryRun: boolean; customers: number; expired: number; reason?: string; capped?: boolean; scanned?: number;
  } | null>(null);

  // 4.24 — how each code performed.
  const [stats, setStats] = useState<CouponStatRow[] | null>(null);

  // Loyalty Adjust Modal
  const [selectedUserForPoints, setSelectedUserForPoints] = useState<UserProfile | null>(null);
  // 4.16 — the customer's ledger, read when the adjust modal opens. "Where did
  // these points come from?" is the only question worth asking before changing
  // a balance, and nothing on this screen could answer it.
  const [ledger, setLedger] = useState<LoyaltyLedger | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [pointsDelta, setPointsDelta] = useState<number>(100);
  const [pointsReason, setPointsReason] = useState('Bonus from Admin');
  const [savingPoints, setSavingPoints] = useState(false);

  // Fetch Coupons
  const fetchCoupons = async () => {
    setLoadingCoupons(true);
    try {
      const snap = await getDocs(collection(db, 'coupons'));
      const list: CouponData[] = snap.docs.map(d => ({
        id: d.id,
        code: d.data().code || d.id.toUpperCase(),
        percent: Number(d.data().percent) || 10,
        active: d.data().active !== false,
        minOrderAmount: d.data().minOrderAmount ? Number(d.data().minOrderAmount) : undefined,
        maxUses: d.data().maxUses ? Number(d.data().maxUses) : undefined,
        oncePerCustomer: d.data().oncePerCustomer === true,
        usedCount: Number(d.data().usedCount) || 0,
        // The same count the till makes (src/lib/couponRules.ts), from the document
        // already in hand: no read of its own (review 2026-10-11, G).
        heldUses: liveCouponHolders(d.data().holds, Date.now()),
        expiresAt: d.data().expiresAt || undefined,
        createdAt: d.data().createdAt || undefined,
        scope: d.data().scope === 'products' ? 'products' : 'all',
        productIds: Array.isArray(d.data().productIds) ? d.data().productIds.map(String) : [],
        // couponLimit, as the till reads it: a stored null (an empty box) read as 0
        // here, and the toggle and the edit form then saved that 0 back as a cap.
        maxDiscountAmount: couponLimit(d.data().maxDiscountAmount),
        startsAt: d.data().startsAt || undefined,
        audience: d.data().audience === 'business' || d.data().audience === 'individual' ? d.data().audience : 'all',
        firstOrderOnly: d.data().firstOrderOnly === true,
        noStacking: d.data().noStacking === true,
        discountIncludesShipping: d.data().discountIncludesShipping === true,
        minMarginPercent: couponLimit(d.data().minMarginPercent),
        batchPrefix: d.data().batchPrefix || undefined,
      }));

      // Whatever the shop has, exactly as it has it.
      //
      // Opening this screen with an empty collection used to write four demo
      // coupons — PRINT10, WELCOME15, VIP20, SUMMER25 — straight into Firestore.
      // That is why they exist today. It also meant deleting them never stuck:
      // remove the last coupon, reopen the screen, and all four came back.
      // The existing ones are left in place so they can be edited or deleted from
      // here; they simply no longer regenerate.
      setCoupons(list);
    } catch (err) {
      console.error('Error fetching coupons:', err);
    } finally {
      setLoadingCoupons(false);
    }
  };

  // Fetch Users for Loyalty
  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      const list: UserProfile[] = snap.docs.map(d => ({
        uid: d.id,
        ...d.data()
      } as UserProfile));
      setUsersList(list);
    } catch (err) {
      console.error('Error fetching users for loyalty:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchProductsForPicker = async () => {
    setLoadingProducts(true);
    try {
      const snap = await getDocs(collection(db, 'products'));
      setProductList(
        snap.docs
          .map((d) => ({
            id: d.id,
            name: String(d.data().name || d.id),
            basePrice: Number(d.data().basePrice) || 0,
            salePrice: Number(d.data().salePrice) > 0 ? Number(d.data().salePrice) : null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err) {
      console.error('Error fetching products for the coupon picker:', err);
    } finally {
      setLoadingProducts(false);
    }
  };

  // 4.26 — the rates, from the same settings document the shop reads.
  const fetchLoyaltySettings = async () => {
    try {
      const snap = await getDoc(doc(db, 'settings', 'printSettings'));
      setLoyaltyForm(loyaltySettingsFrom(snap.exists() ? snap.data() : null));
    } catch (err) {
      console.error('Could not read the loyalty rates:', err);
    }
  };

  // 4.20 — the debt, in kronor. Failing to read it must not blank the screen:
  // the customer table below is still usable without the tile.
  const fetchLiability = async () => {
    try {
      setLiability(await loyaltyLiability());
    } catch (err) {
      console.error('Could not work out the points liability:', err);
    }
  };

  useEffect(() => {
    if (isMainAdmin) {
      fetchCoupons();
      fetchUsers();
      fetchProductsForPicker();
      fetchLoyaltySettings();
      fetchLiability();
    }
  }, [isMainAdmin]);

  // 4.26 — saved to settings/printSettings, clamped on the way in AND on the way
  // out: a rate of zero would divide by zero everywhere it is used.
  const handleSaveLoyaltySettings = async () => {
    if (!isMainAdmin) return;
    setSavingLoyalty(true);
    setLoyaltyError(null);
    setLoyaltySaved(false);
    try {
      const clean = loyaltySettingsFrom(loyaltyForm);
      await setDoc(doc(db, 'settings', 'printSettings'), {
        ...clean,
        loyaltyRatesUpdatedAt: new Date().toISOString(),
        loyaltyRatesUpdatedBy: user?.email || 'admin',
      }, { merge: true });
      setLoyaltyForm(clean);
      setLoyaltySaved(true);
      // The tiers on the table below are computed from these, so they have to be
      // re-read rather than left showing the old bands.
      fetchLiability();
    } catch (err: any) {
      setLoyaltyError(err?.message || t('cpSaveFailed').replace('{0}', t('cpDbError')));
    } finally {
      setSavingLoyalty(false);
    }
  };

  // 4.18 — dry run by default. `apply` only from the second, explicit press.
  const handleExpirySweep = async (apply: boolean) => {
    if (!isMainAdmin) return;
    if (apply && !(await confirm({ title: t('cpExpireConfirm'), confirmLabel: t('dlgConfirm') }))) return;
    setSweeping(true);
    try {
      const result = await expirePoints(apply);
      setSweepResult({
        dryRun: result.dryRun,
        customers: result.customers,
        expired: result.expired,
        reason: result.reason,
        scanned: result.scanned,
        capped: result.capped,
      });
      if (apply) { fetchUsers(); fetchLiability(); }
    } catch (err: any) {
      setSweepResult(null);
      setLoyaltyError(err?.message || t('cpExpireFailed'));
    } finally {
      setSweeping(false);
    }
  };

  // 4.16 — opened with the adjust modal, so the history is in front of whoever
  // is about to change the balance.
  const openPointsAdjust = async (u: UserProfile) => {
    setSelectedUserForPoints(u);
    setPointsDelta(100);
    setPointsReason(t('cpBonusReason'));
    setLedger(null);
    setLoadingLedger(true);
    try {
      setLedger(await loyaltyLedger(u.uid));
    } catch (err) {
      console.error('Could not read the points ledger:', err);
    } finally {
      setLoadingLedger(false);
    }
  };

  // Handle Save Coupon (Create / Edit)
  const handleSaveCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMainAdmin) return;
    setCouponError(null);

    // A batch has no single code — the server generates them.
    const cleanCode = code.trim().toUpperCase();
    if (!bulkMode && !cleanCode) {
      setCouponError(t('cpCodeRequired'));
      return;
    }

    if (percent <= 0 || percent > 100) {
      setCouponError(t('cpPercentRange'));
      return;
    }

    // ANYTHING ABOVE HALF PRICE ASKS TWICE, AND MUST BE CAPPED.
    //
    // TEST100 — a live, working, 100% code — sat in this shop's coupon list. A
    // single digit typed wrong in this box gives the whole catalogue away, and
    // nothing between the keystroke and the customer would have caught it: the
    // server honours whatever is stored, because the owner is the one who is
    // allowed to decide discounts.
    //
    // So a deep discount needs a second, deliberate action AND a maximum
    // discount in kronor. The cap is what turns a mistake into a small one: a
    // 90% code with a 200 kr ceiling costs at most 200 kr, whatever it is
    // applied to.
    if (Number(percent) > 50) {
      if (!deepDiscountConfirmed) {
        setCouponError(t('cpDeepDiscountConfirm').replace('{0}', String(percent)));
        return;
      }
      if (maxDiscountAmount === '' || !(Number(maxDiscountAmount) > 0)) {
        setCouponError(t('cpDeepDiscountNeedsCap'));
        return;
      }
    }

    // A code scoped to nothing would be accepted by the shop and then discount
    // nothing, which reads to a customer as the code being ignored.
    if (scope === 'products' && productIds.length === 0) {
      setCouponError(t('cpPickAtLeastOneProduct'));
      return;
    }

    // A batch needs a prefix and a number; a single coupon needs its code. The
    // rest of the form is shared, which is the point of doing it in one modal.
    if (bulkMode) {
      if (bulkPrefix.trim().replace(/[^A-Za-z0-9]/g, '').length < 2) {
        setCouponError(t('cpBulkNeedsPrefix'));
        return;
      }
      if (!(Number(bulkCount) > 0)) {
        setCouponError(t('cpBulkNeedsCount'));
        return;
      }
    }

    setSavingCoupon(true);

    // EVERY FIELD, EVERY TIME. The server merges, so a key left out keeps
    // whatever the document already held — which is how a coupon the owner had
    // just un-scoped went on being scoped.
    const rules = {
      percent: Number(percent),
      active: Boolean(active),
      minOrderAmount: minOrderAmount !== '' ? Number(minOrderAmount) : null,
      maxDiscountAmount: maxDiscountAmount !== '' ? Number(maxDiscountAmount) : null,
      expiresAt: expiresAt || null,
      startsAt: startsAt || null,
      maxUses: maxUses !== '' ? Number(maxUses) : null,
      oncePerCustomer: Boolean(oncePerCustomer),
      scope,
      productIds: scope === 'products' ? productIds : [],
      audience,
      firstOrderOnly: Boolean(firstOrderOnly),
      noStacking: Boolean(noStacking),
      discountIncludesShipping: Boolean(discountIncludesShipping),
      minMarginPercent: minMarginPercent !== '' ? Number(minMarginPercent) : null,
    };

    try {
      if (bulkMode) {
        const result = await bulkCoupons({
          ...rules,
          prefix: bulkPrefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''),
          count: Number(bulkCount),
          length: Number(bulkLength) || 6,
        });
        // Kept on screen, not just written: these codes are the deliverable, and
        // a batch the owner cannot copy out is a batch he has to go and find.
        setGeneratedCodes(result.codes);
        setShowCouponModal(false);
        resetCouponForm();
        fetchCoupons();
        return;
      }

      await saveCoupon({ ...rules, id: editingCouponId ?? undefined, code: cleanCode });

      setShowCouponModal(false);
      resetCouponForm();
      fetchCoupons();
    } catch (err: any) {
      console.error('Error saving coupon:', err);
      // The server's own sentence when it has one — it knows which rule was
      // broken, and "database error" tells the owner nothing he can act on.
      setCouponError(err?.message || t('cpSaveFailed').replace('{0}', t('cpDbError')));
    } finally {
      setSavingCoupon(false);
    }
  };

  // Toggle Coupon Active Status
  //
  // Through the save endpoint like everything else, so the flip lands in the
  // audit log: "who switched off the code the campaign was running on?" is
  // exactly the question 4.15 exists to answer.
  const handleToggleCouponActive = async (coupon: CouponData) => {
    if (!isMainAdmin) return;
    const newStatus = !coupon.active;
    // Optimistic, then corrected. The table is the only feedback a one-click
    // switch gives, and waiting on a round trip makes it feel broken.
    setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, active: newStatus } : c));
    try {
      await saveCoupon({
        id: coupon.id,
        code: coupon.code,
        percent: coupon.percent,
        active: newStatus,
        minOrderAmount: coupon.minOrderAmount ?? null,
        maxDiscountAmount: coupon.maxDiscountAmount ?? null,
        expiresAt: coupon.expiresAt ?? null,
        startsAt: coupon.startsAt ?? null,
        maxUses: coupon.maxUses ?? null,
        oncePerCustomer: Boolean(coupon.oncePerCustomer),
        scope: coupon.scope === 'products' ? 'products' : 'all',
        productIds: Array.isArray(coupon.productIds) ? coupon.productIds : [],
        audience: coupon.audience ?? 'all',
        firstOrderOnly: Boolean(coupon.firstOrderOnly),
        noStacking: Boolean(coupon.noStacking),
        discountIncludesShipping: Boolean(coupon.discountIncludesShipping),
        minMarginPercent: coupon.minMarginPercent ?? null,
      });
    } catch (err: any) {
      console.error('Error toggling coupon:', err);
      // Put it back. A switch that shows one state while the shop believes the
      // other is worse than a switch that refused to move.
      setCoupons(prev => prev.map(c => c.id === coupon.id ? { ...c, active: coupon.active } : c));
      setCouponError(err?.message || t('cpChangeFailed'));
    }
  };

  // Delete Coupon
  const handleDeleteCoupon = async (couponId: string) => {
    if (!isMainAdmin) return;
    if (!(await confirm({ title: t('cpConfirmDelete'), confirmLabel: t('dlgConfirm') }))) return;

    try {
      await deleteCouponApi(couponId);
      setCoupons(prev => prev.filter(c => c.id !== couponId));
    } catch (err: any) {
      console.error('Error deleting coupon:', err);
      setCouponError(err?.message || t('cpChangeFailed'));
    }
  };

  // 4.15 — the log, read on demand rather than on every visit to the screen.
  const openAudit = async () => {
    setShowAudit(true);
    if (auditEntries || loadingAudit) return;
    setLoadingAudit(true);
    setAuditError(null);
    try {
      // Both in one press: the owner opening "history" wants to know what the
      // codes DID as much as who touched them.
      const [audit, performance] = await Promise.all([couponAudit(), couponStats()]);
      setAuditEntries(audit.entries);
      setStats(performance.stats);
    } catch (err: any) {
      setAuditError(err?.message || t('cpAuditFailed'));
    } finally {
      setLoadingAudit(false);
    }
  };

  // Edit Coupon
  const handleStartEditCoupon = (c: CouponData) => {
    setEditingCouponId(c.id);
    setCode(c.code);
    setPercent(c.percent);
    setActive(c.active);
    setMinOrderAmount(c.minOrderAmount ?? '');
    setMaxUses(c.maxUses ?? '');
    setOncePerCustomer(Boolean(c.oncePerCustomer));
    setExpiresAt(c.expiresAt ? c.expiresAt.substring(0, 10) : '');
    setScope(c.scope === 'products' ? 'products' : 'all');
    setProductIds(Array.isArray(c.productIds) ? c.productIds : []);
    setProductSearch('');
    setMaxDiscountAmount(c.maxDiscountAmount ?? '');
    setStartsAt(c.startsAt ? c.startsAt.substring(0, 10) : '');
    setAudience(c.audience ?? 'all');
    setFirstOrderOnly(Boolean(c.firstOrderOnly));
    setNoStacking(Boolean(c.noStacking));
    setDiscountIncludesShipping(Boolean(c.discountIncludesShipping));
    setMinMarginPercent(c.minMarginPercent ?? '');
    // An existing coupon is edited, never turned into a batch.
    setBulkMode(false);
    // An EXISTING deep discount is already the owner's decision — he is opening
    // it, not creating it — so re-confirming is noise. Lowering it below 50 and
    // back up is a new decision and asks again, because the flag rides on the
    // value in the form rather than on what was stored.
    setDeepDiscountConfirmed(Number(c.percent) > 50);
    setCouponError(null);
    setShowCouponModal(true);
  };

  const resetCouponForm = () => {
    setEditingCouponId(null);
    setCode('');
    setPercent(10);
    setActive(true);
    setMinOrderAmount('');
    setMaxUses('');
    setOncePerCustomer(true);
    setExpiresAt('');
    setScope('all');
    setProductIds([]);
    setProductSearch('');
    setMaxDiscountAmount('');
    setStartsAt('');
    setAudience('all');
    setFirstOrderOnly(false);
    setNoStacking(false);
    setDiscountIncludesShipping(false);
    setMinMarginPercent('');
    setBulkMode(false);
    setBulkPrefix('');
    setBulkCount(25);
    setBulkLength(6);
    // Cleared with everything else: a confirmation given for one coupon must not
    // carry over to the next one opened.
    setDeepDiscountConfirmed(false);
    setCouponError(null);
  };

  // Save Loyalty Adjustment
  const handleSavePointsAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMainAdmin || !selectedUserForPoints) return;

    setSavingPoints(true);
    try {
      // THE BALANCE IS NOT COMPUTED HERE ANY MORE. This screen used to work out
      // the new total and the new tier from what it happened to have loaded, and
      // then write them — so two admins on the same customer raced, and a stale
      // list produced a wrong balance with no sign of it. The server does the
      // arithmetic in a transaction and returns what it settled on.
      //
      // THROUGH THE SERVER, so the ledger is complete.
      //
      // This screen used to write loyaltyPoints and a 50-entry pointsHistory
      // straight to the user document. It worked — an admin may write it — but
      // it bypassed users/<uid>/pointsLedger, so the one permanent record of a
      // customer's points had a hole in it exactly where somebody had stepped in
      // by hand. Those are the entries most likely to be asked about later.
      //
      // The endpoint also REQUIRES a reason, refuses a zero adjustment, clamps
      // at zero, and records who did it.
      const token = await auth.currentUser?.getIdToken().catch(() => null);
      if (!token) throw new Error(t('cpNotSignedIn'));
      const resp = await fetch(`/api/admin/loyalty/${encodeURIComponent(selectedUserForPoints.uid)}/adjust`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: pointsDelta, reason: pointsReason }),
      });
      const result = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(result?.error || t('cpAdjustFailed'));

      // The balance the SERVER settled on, not the one this screen predicted —
      // it clamps at zero, so the two can differ.
      const newPts = Number(result?.balance) || 0;
      // 4.25 — THE TIER IS NOT TOUCHED. It follows lifetime spend, and a manual
      // adjustment is not a purchase. Computing it from the balance here, as this
      // did, made a 2 500-point goodwill gesture read as Platinum.
      setUsersList(prev => prev.map(u => u.uid === selectedUserForPoints.uid ? {
        ...u,
        loyaltyPoints: newPts,
      } : u));

      setSelectedUserForPoints(null);
      setPointsDelta(100);
      setPointsReason('Bonus from Admin');
    } catch (err) {
      console.error('Error adjusting loyalty points:', err);
      alert(t('cpPointsError'));
    } finally {
      setSavingPoints(false);
    }
  };

  if (!isMainAdmin) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-3xl p-8 text-center space-y-4">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-black text-red-950">
          {t('cpDeniedTitle')}
        </h2>
        <p className="text-sm font-semibold text-red-700 max-w-md mx-auto">
          {t('cpDeniedBody')}
        </p>
      </div>
    );
  }

  const filteredCoupons = coupons.filter(c => 
    c.code.toLowerCase().includes(couponSearch.toLowerCase())
  );

  const filteredUsers = usersList.filter(u => 
    u.displayName?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-3xl p-6 text-white shadow-lg border border-indigo-900/40 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="inline-flex items-center px-3 py-1 bg-amber-500/20 text-amber-300 text-xs font-bold rounded-full mb-2 border border-amber-500/30">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            {t('cpAdminOnlyBadge')}
          </div>
          <h2 className="text-2xl font-black tracking-tight">
            {t('cpTitle')}
          </h2>
          <p className="text-xs text-slate-300 mt-1">
            {t('cpSubtitle')}
          </p>
        </div>

        {/* Sub-tab Navigation */}
        <div className="flex bg-slate-800/80 p-1.5 rounded-2xl border border-slate-700/60 shrink-0">
          <button
            type="button"
            onClick={() => setActiveSubTab('coupons')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2",
              activeSubTab === 'coupons'
                ? "bg-orange-500 text-white shadow-md"
                : "text-slate-300 hover:text-white"
            )}
          >
            <Tag className="w-4 h-4" />
            <span>{t('cpTabCoupons')} ({coupons.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('loyalty')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-extrabold transition-all flex items-center gap-2",
              activeSubTab === 'loyalty'
                ? "bg-amber-500 text-white shadow-md"
                : "text-slate-300 hover:text-white"
            )}
          >
            <Coins className="w-4 h-4" />
            <span>{t('cpTabLoyalty')}</span>
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: COUPONS MANAGEMENT */}
      {activeSubTab === 'coupons' && (
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-5">
            <div>
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Tag className="w-5 h-5 text-orange-600" />
                <span>Coupon Codes</span>
              </h3>
              <p className="text-xs text-gray-500">
                {t('cpCodesNote')}
              </p>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* Search */}
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={couponSearch}
                  onChange={(e) => setCouponSearch(e.target.value)}
                  placeholder={t('cpSearchCoupon')}
                  className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {/* 4.15 — who changed what. */}
              <button
                type="button"
                onClick={openAudit}
                className="px-3 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-extrabold rounded-xl flex items-center gap-1.5 shrink-0 transition-all cursor-pointer"
              >
                <History className="w-4 h-4" />
                <span className="hidden sm:inline">{t('cpHistoryButton')}</span>
              </button>

              {/* 4.14 — the same form, in batch mode. */}
              <button
                type="button"
                onClick={() => {
                  resetCouponForm();
                  setBulkMode(true);
                  setShowCouponModal(true);
                }}
                className="px-3 py-2.5 bg-white border border-orange-200 hover:bg-orange-50 text-orange-700 text-xs font-extrabold rounded-xl flex items-center gap-1.5 shrink-0 transition-all cursor-pointer"
              >
                <Layers className="w-4 h-4" />
                <span className="hidden sm:inline">{t('cpBulkButton')}</span>
              </button>

              {/* Add Coupon Button */}
              <button
                type="button"
                onClick={() => {
                  resetCouponForm();
                  setShowCouponModal(true);
                }}
                className="px-4 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-extrabold rounded-xl shadow-md shadow-orange-500/20 flex items-center gap-1.5 shrink-0 transition-all active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{t('cpAddCoupon')}</span>
              </button>
            </div>
          </div>

          {loadingCoupons ? (
            <div className="py-12 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-orange-500 animate-spin mx-auto" />
              <p className="text-xs font-bold text-gray-500">{t('cpLoadingCoupons')}</p>
            </div>
          ) : filteredCoupons.length === 0 ? (
            <div className="py-12 text-center bg-gray-50/50 rounded-2xl border border-dashed border-gray-200 space-y-3">
              <Tag className="w-10 h-10 text-gray-300 mx-auto" />
              <p className="text-sm font-bold text-gray-700">{t('cpNoCoupons')}</p>
              <button
                type="button"
                onClick={() => {
                  resetCouponForm();
                  setShowCouponModal(true);
                }}
                className="text-xs font-extrabold text-orange-600 hover:underline"
              >
                {t('cpAddFirst')}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right dir-rtl text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-extrabold text-gray-500 uppercase border-b border-gray-100">
                    <th className="p-4">{t('cpColCode')}</th>
                    <th className="p-4">{t('cpColPercent')}</th>
                    <th className="p-4">{t('cpColMinOrder')}</th>
                    <th className="p-4">{t('cpScopeLabel')}</th>
                    <th className="p-4">{t('cpColExpiry')}</th>
                    {/* 4.5 — how much of a limited code is left, without having
                        to open it. */}
                    <th className="p-4">{t('cpColUses')}</th>
                    <th className="p-4">{t('cpColStatus')}</th>
                    <th className="p-4 text-center">{t('cpColActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-bold">
                  {filteredCoupons.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50/70 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-3 py-1 bg-orange-100 text-orange-950 font-black text-xs rounded-lg border border-orange-200 tracking-wider font-mono">
                            {c.code}
                          </span>
                          {/* Which print run it came from, so two hundred
                              near-identical codes are still tellable apart. */}
                          {c.batchPrefix && (
                            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[0.625rem] font-black">
                              {t('cpBatchBadge').replace('{0}', c.batchPrefix)}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-4">
                        <span className="text-emerald-700 font-black text-sm bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200/80">
                          {c.percent}% {t('cpOffSuffix')}
                        </span>
                      </td>

                      <td className="p-4 text-xs text-gray-600">
                        {c.minOrderAmount ? `${c.minOrderAmount} kr` : <span className="text-gray-400">{t('cpNoMinimum')}</span>}
                      </td>

                      {/* Scope, at a glance. A code limited to three products
                          and one that discounts the whole shop looked identical
                          in this table, and the difference is the whole point of
                          the feature. */}
                      <td className="p-4 text-xs">
                        {c.scope === 'products' ? (
                          <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-black">
                            {t('cpScopeProductsShort').replace('{0}', String(c.productIds?.length ?? 0))}
                          </span>
                        ) : (
                          <span className="text-gray-400 font-bold">{t('cpScopeAllShort')}</span>
                        )}
                      </td>

                      <td className="p-4 text-xs text-gray-600">
                        {c.expiresAt ? (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-gray-400" />
                            {c.expiresAt.substring(0, 10)}
                          </span>
                        ) : (
                          <span className="text-gray-400">{t('cpNeverExpires')}</span>
                        )}
                      </td>

                      {/* 4.5 — `2/4`, or a plain count when the code is
                          unlimited. And the uses unpaid orders HOLD beside the
                          paid ones — "18 + 2 held / 20" (review 2026-10-11, G):
                          the till counts both, and a code whose last uses are
                          held turns new customers away while it reads 18/20. Red
                          once the two together leave none. */}
                      <td className="p-4 text-xs">
                        {c.maxUses && c.maxUses > 0 ? (
                          <span
                            className={cn(
                              'font-black whitespace-nowrap',
                              couponIsFull(c.maxUses, c.usedCount, c.heldUses) ? 'text-red-600' : 'text-gray-700'
                            )}
                            title={(c.heldUses ?? 0) > 0 ? t('cpUsesHeldNote') : undefined}
                            data-rx-coupon-uses={c.code}
                          >
                            {(c.heldUses ?? 0) > 0
                              ? t('cpUsesWithHeld')
                                  .replace('{0}', String(c.usedCount ?? 0))
                                  .replace('{1}', String(c.heldUses))
                                  .replace('{2}', String(c.maxUses))
                              : couponUsageLabel(c.maxUses, c.usedCount)}
                          </span>
                        ) : (
                          <span className="text-gray-400 font-bold">
                            {couponUsageLabel(0, c.usedCount)} · {t('cpUsesUnlimited')}
                          </span>
                        )}
                      </td>

                      {/* 4.1 — the badge now says what the SERVER would do with
                          this code, not what the `active` flag happens to hold.
                          An expired code and a fully-redeemed one both read
                          Active here before, while the till refused them. */}
                      <td className="p-4">
                        {(() => {
                          const kind = couponStatus(c, Date.now());
                          const toggleable = couponStatusIsToggleable(kind, c.active);
                          const look = {
                            active: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200',
                            inactive: 'bg-red-100 text-red-800 hover:bg-red-200',
                            scheduled: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
                            expired: 'bg-amber-100 text-amber-900',
                            usedUp: 'bg-gray-200 text-gray-700',
                            needsCap: cn('bg-orange-100 text-orange-900', toggleable && 'hover:bg-orange-200'),
                          }[kind];
                          const icon = {
                            active: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
                            inactive: <XCircle className="w-3.5 h-3.5 text-red-600" />,
                            scheduled: <CalendarClock className="w-3.5 h-3.5 text-blue-600" />,
                            expired: <Clock className="w-3.5 h-3.5 text-amber-700" />,
                            usedUp: <Ban className="w-3.5 h-3.5 text-gray-500" />,
                            needsCap: <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />,
                          }[kind];
                          const label = {
                            active: t('cpActive'),
                            inactive: t('cpInactive'),
                            scheduled: t('cpScheduled'),
                            expired: t('cpExpired'),
                            usedUp: t('cpUsedUp'),
                            needsCap: t('cpNeedsCap'),
                          }[kind];
                          return (
                            <>
                              <button
                                type="button"
                                // Only where the switch does something. Clicking
                                // "Expired" used to write active:false and change
                                // nothing the customer could see.
                                disabled={!toggleable}
                                onClick={toggleable ? () => handleToggleCouponActive(c) : undefined}
                                title={toggleable ? undefined : label}
                                className={cn(
                                  // On one line: in the phone's narrow column a label of
                                  // three words broke inside the pill.
                                  'px-3 py-1 rounded-full text-xs font-black transition-all flex items-center gap-1 whitespace-nowrap',
                                  toggleable ? 'cursor-pointer' : 'cursor-default',
                                  look
                                )}
                              >
                                {icon}
                                <span>{label}</span>
                              </button>
                              {/* WHY the till refuses it, and what fixes it — a badge
                                  alone said "Active" here while customers were told
                                  the code was not valid (review 2026-10-11, G). */}
                              {kind === 'needsCap' && (
                                <p className="mt-1.5 max-w-[15rem] text-pretty text-[0.6875rem] font-bold leading-snug text-orange-900" data-rx-coupon-needs-cap={c.code}>
                                  {t('cpNeedsCapReason')}
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </td>

                      <td className="p-4">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleStartEditCoupon(c)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors cursor-pointer"
                            title={t('cpEditCoupon')}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteCoupon(c.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
                            title={t('cpDeleteCoupon')}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: LOYALTY POINTS MANAGEMENT */}
      {activeSubTab === 'loyalty' && (
        <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-100 pb-5">
            <div>
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Coins className="w-5 h-5 text-amber-600" />
                <span>Customer Loyalty Points</span>
              </h3>
              <p className="text-xs text-gray-500">
                {t('cpTiersNote')}
              </p>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder={t('cpSearchCustomer')}
                className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* 4.20 — IT IS A DEBT, AND IT IS COUNTED.
              The endpoint has existed since 4.20 was built and nothing showed
              the figure. Points are a promise to give goods away later; a shop
              that cannot see the promise cannot price around it. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <p className="text-[0.6875rem] font-black text-amber-900 uppercase tracking-wide">{t('cpLiabilityTitle')}</p>
              <p className="text-2xl font-black text-amber-950 mt-1">
                {liability ? `${liability.liabilitySek.toLocaleString('sv-SE')} kr` : '—'}
              </p>
              <p className="text-[0.6875rem] text-amber-800 font-bold mt-0.5">{t('cpLiabilityNote')}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 p-4">
              <p className="text-[0.6875rem] font-black text-gray-500 uppercase tracking-wide">{t('cpColPoints')}</p>
              <p className="text-2xl font-black text-gray-900 mt-1">
                {liability ? liability.totalPoints.toLocaleString('sv-SE') : '—'}
              </p>
              <p className="text-[0.6875rem] text-gray-500 font-bold mt-0.5">
                {liability ? t('cpLiabilityHolders').replace('{0}', String(liability.holders)) : ''}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-200 p-4">
              <p className="text-[0.6875rem] font-black text-gray-500 uppercase tracking-wide">{t('cpRedeemRateLabel')}</p>
              <p className="text-2xl font-black text-gray-900 mt-1">
                {liability ? liability.pointsPerKrona : loyaltyForm.pointsPerSek}
              </p>
              <p className="text-[0.6875rem] text-gray-500 font-bold mt-0.5">{t('cpEarnRateNote')}</p>
            </div>
          </div>

          {/* 4.26 — "انا بحدد النقاط واقدر اعدل متى اريد".
              Every one of these was a constant in the code: the earn rate in
              pricing.ts, "10 PTS = 1 SEK" in the checkout and in three locale
              strings, the tier thresholds written out in three files. */}
          <div className="rounded-2xl border border-gray-200 p-4 space-y-4">
            <div>
              <h4 className="text-sm font-black text-gray-900">{t('cpLoyaltyRulesTitle')}</h4>
              <p className="text-[0.6875rem] text-gray-500 font-bold">{t('cpLoyaltyRulesNote')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {([
                { key: 'pointsEarnedPerSek' as const, label: t('cpEarnRateLabel'), note: t('cpEarnRateNote'), min: 1 },
                { key: 'pointsPerSek' as const, label: t('cpRedeemRateLabel'), note: '', min: 1 },
                { key: 'minRedeemPoints' as const, label: t('cpMinRedeemLabel'), note: t('cpMinRedeemNote'), min: 0 },
                { key: 'pointsExpiryMonths' as const, label: t('cpExpiryMonthsLabel'), note: t('cpExpiryMonthsNote'), min: 0 },
                { key: 'tierGoldSpend' as const, label: t('cpTierGoldLabel'), note: '', min: 0 },
                { key: 'tierPlatinumSpend' as const, label: t('cpTierPlatinumLabel'), note: t('cpTierSpendNote'), min: 0 },
              ]).map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-bold text-gray-700 mb-1">{field.label}</label>
                  <input
                    type="number"
                    min={field.min}
                    value={loyaltyForm[field.key]}
                    onChange={(e) => setLoyaltyForm((prev) => ({ ...prev, [field.key]: Number(e.target.value) }))}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  {field.note && <p className="text-[0.6875rem] text-gray-400 mt-1">{field.note}</p>}
                </div>
              ))}
            </div>

            {loyaltyError && (
              <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{loyaltyError}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSaveLoyaltySettings}
                disabled={savingLoyalty}
                className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-black rounded-xl flex items-center gap-2 cursor-pointer"
              >
                {savingLoyalty ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>{t('cpSaveLoyalty')}</span>
              </button>
              {loyaltySaved && <span className="text-xs font-black text-emerald-700">{t('cpLoyaltySaved')}</span>}

              {/* 4.18 — THE DRY RUN COMES FIRST, and it is the default. An
                  action that deletes customers' balances should never be one
                  press away from a screen nobody was reading. */}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleExpirySweep(false)}
                  disabled={sweeping}
                  className="px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-extrabold rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Clock className="w-4 h-4" />
                  <span>{t('cpExpireDryRun')}</span>
                </button>
                {sweepResult && sweepResult.dryRun && sweepResult.expired > 0 && (
                  <button
                    type="button"
                    onClick={() => handleExpirySweep(true)}
                    disabled={sweeping}
                    className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs font-black rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Ban className="w-4 h-4" />
                    <span>{t('cpExpireApply')}</span>
                  </button>
                )}
              </span>
            </div>

            {sweepResult && (
              <p className="text-xs font-bold text-gray-700 bg-gray-50 border border-gray-200 rounded-xl p-3">
                {sweepResult.reason === 'expiry-off'
                  ? t('cpExpireOff')
                  : sweepResult.expired > 0
                    ? t('cpExpireResult')
                        .replace('{0}', String(sweepResult.expired))
                        .replace('{1}', String(sweepResult.customers))
                    : t('cpExpireNothing')}
                {/* NOT A SILENT CAP: a shop with more than 500 balances would
                    otherwise be told the sweep was complete. */}
                {sweepResult.capped && (
                  <span className="block text-amber-700 mt-1">
                    {t('cpExpireCapped').replace('{0}', String(sweepResult.scanned ?? 0))}
                  </span>
                )}
              </p>
            )}
          </div>

          {loadingUsers ? (
            <div className="py-12 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-amber-500 animate-spin mx-auto" />
              <p className="text-xs font-bold text-gray-500">{t('cpLoadingCustomers')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right dir-rtl text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-extrabold text-gray-500 uppercase border-b border-gray-100">
                    <th className="p-4">{t('cpColCustomer')}</th>
                    <th className="p-4">{t('cpColAccountType')}</th>
                    <th className="p-4">{t('cpColPoints')}</th>
                    <th className="p-4">{t('cpColPointsValue')}</th>
                    {/* 4.25 — the number the tier is actually computed from. */}
                    <th className="p-4">{t('cpColSpend')}</th>
                    <th className="p-4">{t('cpColTier')}</th>
                    <th className="p-4 text-center">{t('cpColAdjust')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-bold">
                  {filteredUsers.map((u) => {
                    const pts = u.loyaltyPoints ?? 0;
                    // 4.25 — from LIFETIME SPEND, at the owner's own thresholds.
                    // On the balance a customer was demoted the moment he spent
                    // his points. The stored tier is preferred when it exists —
                    // the server writes it on every paid order — and computed
                    // when it does not, so an account that has not ordered since
                    // this landed still shows the right badge.
                    const spend = Number((u as any).lifetimeSpend) || 0;
                    const tier = u.loyaltyTier || tierForSpend(spend, loyaltyForm);
                    const valueSek = pointsValueSek(pts, loyaltyForm);

                    return (
                      <tr key={u.uid} className="hover:bg-gray-50/70 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-gray-900">{u.displayName || t('cpColCustomer')}</div>
                          <div className="text-xs text-gray-400">{u.email}</div>
                        </td>

                        <td className="p-4 text-xs">
                          <span className={cn(
                            "px-2.5 py-1 rounded-lg font-bold",
                            u.accountType === 'business' ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-700"
                          )}>
                            {u.accountType === 'business' ? 'B2B' : t('cpIndividual')}
                          </span>
                        </td>

                        <td className="p-4">
                          <span className="text-amber-700 font-black text-base bg-amber-50 px-3 py-1 rounded-xl border border-amber-200">
                            {pts} PTS
                          </span>
                        </td>

                        <td className="p-4 text-xs text-emerald-800 font-extrabold">
                          {valueSek} SEK
                        </td>

                        <td className="p-4 text-xs text-gray-700 font-extrabold">
                          {spend > 0 ? `${Math.round(spend).toLocaleString('sv-SE')} kr` : <span className="text-gray-400">—</span>}
                        </td>

                        <td className="p-4">
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-black flex items-center gap-1 w-fit",
                            tier === 'Platinum' ? "bg-purple-100 text-purple-900 border border-purple-300" :
                            tier === 'Gold' ? "bg-amber-100 text-amber-900 border border-amber-300" :
                            "bg-slate-100 text-slate-800 border border-slate-300"
                          )}>
                            <Award className="w-3.5 h-3.5" />
                            <span>{tier}</span>
                          </span>
                        </td>

                        <td className="p-4 text-center">
                          <button
                            type="button"
                            onClick={() => openPointsAdjust(u)}
                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-black rounded-xl shadow-sm transition-all active:scale-95 cursor-pointer inline-flex items-center gap-1"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>{t('cpAdjustPoints')}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* CREATE / EDIT COUPON MODAL — capped and scrollable: the full form is taller
          than a phone screen, and without this the Save button sat below the fold
          with nothing to scroll. Same cap as the product and user modals. */}
      {showCouponModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6 dir-rtl">
            <div className="flex justify-between items-center border-b border-gray-100 pb-4">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Tag className="w-5 h-5 text-orange-600" />
                <span>{bulkMode ? t('cpBulkTitle') : editingCouponId ? t('cpModalEdit') : t('cpModalNew')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowCouponModal(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSaveCoupon} className="space-y-4">
              {/* 4.14 — ONE form. A batch needs every rule a single coupon
                  needs; asking for them on a second screen is how the two
                  drift apart. Only the identity of the code differs. */}
              {bulkMode ? (
                <div className="space-y-3 bg-orange-50/60 border border-orange-200 rounded-2xl p-4">
                  <p className="text-[0.6875rem] font-bold text-orange-900">{t('cpBulkModeNote')}</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        {t('cpBulkPrefixLabel')}
                      </label>
                      <input
                        type="text"
                        value={bulkPrefix}
                        onChange={(e) => setBulkPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                        placeholder="SUMMER"
                        className="w-full uppercase font-mono font-bold px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        {t('cpBulkCountLabel')}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={bulkCount}
                        onChange={(e) => setBulkCount(e.target.value ? Number(e.target.value) : '')}
                        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        {t('cpBulkLengthLabel')}
                      </label>
                      <input
                        type="number"
                        min={4}
                        max={12}
                        value={bulkLength}
                        onChange={(e) => setBulkLength(Number(e.target.value) || 6)}
                        className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </div>
                  {/* What they will actually look like. A prefix plus six
                      characters is an abstraction until it is shown. */}
                  <p className="text-[0.6875rem] font-mono text-orange-800">
                    {(bulkPrefix || 'SUMMER')}
                    {'X'.repeat(Math.max(4, Math.min(12, Number(bulkLength) || 6)))}
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpFieldCode')}
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder={t('cpCodePlaceholder')}
                    className="w-full uppercase font-mono font-bold px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpFieldPercent')}
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={percent}
                      onChange={(e) => setPercent(Number(e.target.value))}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      required
                    />
                    <Percent className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpFieldMinOrder')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={minOrderAmount}
                    onChange={(e) => setMinOrderAmount(e.target.value ? Number(e.target.value) : '')}
                    placeholder={t('cpMinPlaceholder')}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* Only above half price, and it is deliberately loud. TEST100 — a
                  live, working, 100% code — sat in this shop's own list. */}
              {Number(percent) > 50 && (
                <label className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 border border-red-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deepDiscountConfirmed}
                    onChange={(e) => setDeepDiscountConfirmed(e.target.checked)}
                    className="w-4 h-4 mt-0.5 rounded text-red-600 focus:ring-red-500"
                  />
                  <span>
                    <span className="block text-xs font-black text-red-900">
                      {t('cpDeepDiscountTitle').replace('{0}', String(percent))}
                    </span>
                    <span className="block text-[0.6875rem] text-red-700 font-medium mt-0.5">
                      {t('cpDeepDiscountBody')}
                    </span>
                  </span>
                </label>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpUsageLimitLabel')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={maxUses}
                    onChange={(e) => setMaxUses(e.target.value ? Number(e.target.value) : '')}
                    placeholder={t('cpUsageLimitPlaceholder')}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-[0.6875rem] text-gray-400 mt-1">{t('cpUsageLimitNote')}</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpMaxDiscountLabel')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={maxDiscountAmount}
                    onChange={(e) => setMaxDiscountAmount(e.target.value ? Number(e.target.value) : '')}
                    placeholder={t('cpMaxDiscountPlaceholder')}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-[0.6875rem] text-gray-400 mt-1">{t('cpMaxDiscountNote')}</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpPerCustomerLabel')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setOncePerCustomer(v => !v)}
                    className={cn(
                      'w-full px-4 py-2.5 rounded-xl text-sm font-bold border transition-colors text-left',
                      oncePerCustomer
                        ? 'bg-orange-50 border-orange-300 text-orange-800'
                        : 'bg-gray-50 border-gray-200 text-gray-500'
                    )}
                  >
                    {oncePerCustomer ? t('cpPerCustomerOnce') : t('cpPerCustomerNone')}
                  </button>
                  {/* 4.3 — this line used to say "Each customer may redeem it
                      once." whatever the button above it said, so with the
                      limit OFF the screen contradicted itself. */}
                  <p className="text-[0.6875rem] text-gray-400 mt-1">
                    {oncePerCustomer ? t('cpPerCustomerOnceNote') : t('cpPerCustomerNoneNote')}
                  </p>
                </div>
              </div>

              {/* 4.10 — a code can be written today and start on Monday. Both
                  dates read as WHOLE DAYS in Stockholm: the start is the
                  beginning of its day, the expiry the end of its own. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpFieldStart')}
                  </label>
                  <input
                    type="date"
                    value={startsAt}
                    max={expiresAt || undefined}
                    onChange={(e) => setStartsAt(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-[0.6875rem] text-gray-400 mt-1">{t('cpFieldStartNote')}</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpFieldExpiry')}
                  </label>
                  <input
                    type="date"
                    value={expiresAt}
                    min={startsAt || undefined}
                    onChange={(e) => setExpiresAt(e.target.value)}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
              </div>

              {/* 4.11, 4.12, 4.13, 4.9 and 4.7 — the rules that decide WHO and
                  WHAT a code reaches, rather than how much it takes off. */}
              <div className="space-y-4 rounded-2xl border border-gray-200 p-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpAudienceLabel')}
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['all', 'business', 'individual'] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setAudience(a)}
                        className={cn(
                          'px-2 py-2 rounded-xl text-[0.6875rem] font-black border transition-colors',
                          audience === a
                            ? 'bg-orange-50 border-orange-300 text-orange-800'
                            : 'bg-gray-50 border-gray-200 text-gray-500'
                        )}
                      >
                        {a === 'all' ? t('cpAudienceAll') : a === 'business' ? t('cpAudienceBusiness') : t('cpAudienceIndividual')}
                      </button>
                    ))}
                  </div>
                  {audience !== 'all' && (
                    <p className="text-[0.6875rem] text-gray-400 mt-1">{t('cpAudienceNote')}</p>
                  )}
                </div>

                {([
                  { on: firstOrderOnly, set: setFirstOrderOnly, label: t('cpFirstOrderLabel'), note: t('cpFirstOrderNote') },
                  { on: noStacking, set: setNoStacking, label: t('cpNoStackingLabel'), note: t('cpNoStackingNote') },
                  { on: discountIncludesShipping, set: setDiscountIncludesShipping, label: t('cpShippingLabel'), note: t('cpShippingNote') },
                ]).map((row) => (
                  <label key={row.label} className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={row.on}
                      onChange={(e) => row.set(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-orange-600 focus:ring-orange-500"
                    />
                    <span>
                      <span className="block text-xs font-black text-gray-800">{row.label}</span>
                      <span className="block text-[0.6875rem] text-gray-400">{row.note}</span>
                    </span>
                  </label>
                ))}

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    {t('cpMarginLabel')}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={minMarginPercent}
                    onChange={(e) => setMinMarginPercent(e.target.value ? Number(e.target.value) : '')}
                    placeholder={t('cpMarginPlaceholder')}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <p className="text-[0.6875rem] text-gray-400 mt-1">{t('cpMarginNote')}</p>
                </div>
              </div>

              {/* WHAT THIS CODE APPLIES TO.
                  Placed after expiry and before Active so the owner answers
                  "what does it discount?" before "is it live?". Left-aligned on
                  purpose: the rest of this modal inherits a text-right from an
                  older right-to-left layout, and a scrolling product list under
                  a right-aligned heading reads as a different screen. */}
              <div className="text-left">
                <label className="block text-xs font-bold text-gray-700 mb-1.5">
                  {t('cpScopeLabel')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['all', 'products'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setScope(s)}
                      className={cn(
                        'px-3 py-2.5 rounded-xl text-xs font-black border transition-colors cursor-pointer',
                        scope === s
                          ? 'bg-orange-600 text-white border-orange-600 shadow-sm'
                          : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100',
                      )}
                    >
                      {s === 'all' ? t('cpScopeAll') : t('cpScopeProducts')}
                    </button>
                  ))}
                </div>

                {scope === 'products' && (
                  <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
                    <div className="p-2 bg-gray-50 border-b border-gray-200">
                      <input
                        type="text"
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        placeholder={t('cpSearchProducts')}
                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    {/* Capped and scrollable: this list is the whole catalogue,
                        and 635 imported products would otherwise push the Save
                        button off the bottom of the modal. */}
                    <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
                      {loadingProducts && (
                        <p className="p-3 text-[0.6875rem] font-bold text-gray-400">{t('cpLoadingProducts')}</p>
                      )}
                      {!loadingProducts && productList.length === 0 && (
                        <p className="p-3 text-[0.6875rem] font-bold text-gray-400">{t('cpNoProducts')}</p>
                      )}
                      {productList
                        .filter((p) => p.name.toLowerCase().includes(productSearch.trim().toLowerCase()))
                        .map((p) => {
                          const checked = productIds.includes(p.id);
                          return (
                            <label
                              key={p.id}
                              className="flex items-center gap-2.5 p-2.5 hover:bg-orange-50/50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setProductIds((prev) =>
                                    e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                                  )
                                }
                                className="w-4 h-4 rounded accent-orange-600 cursor-pointer shrink-0"
                              />
                              <span className="text-xs font-bold text-gray-800 flex-1 truncate">{p.name}</span>
                              {/* Say it here rather than letting the owner
                                  discover it at checkout: ticking a product that
                                  is on offer achieves nothing, because the server
                                  refuses to stack a code on an offer price. */}
                              {p.salePrice !== null ? (
                                <span className="text-[0.625rem] font-black text-red-600 shrink-0">
                                  {t('cpOnOfferNoCoupon')}
                                </span>
                              ) : (
                                <span className="text-[0.625rem] font-bold text-gray-400 shrink-0">{p.basePrice} SEK</span>
                              )}
                            </label>
                          );
                        })}
                    </div>
                    <div className="p-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                      <span className="text-[0.6875rem] font-black text-gray-600">
                        {t('cpSelectedCount').replace('{0}', String(productIds.length))}
                      </span>
                      {productIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setProductIds([])}
                          className="text-[0.6875rem] font-bold text-gray-500 hover:text-red-600 cursor-pointer"
                        >
                          {t('cpClearSelection')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="couponActive"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                  className="w-4 h-4 text-orange-600 rounded accent-orange-600 cursor-pointer"
                />
                <label htmlFor="couponActive" className="text-xs font-bold text-gray-800 cursor-pointer">
                  {t('cpFieldActive')}
                </label>
              </div>

              {couponError && (
                <p className="text-xs font-bold text-red-600 bg-red-50 p-3 rounded-xl border border-red-200">
                  {couponError}
                </p>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowCouponModal(false)}
                  className="px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  {t('cpCancel')}
                </button>
                <button
                  type="submit"
                  disabled={savingCoupon}
                  className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-black rounded-xl shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-2"
                >
                  {savingCoupon ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>{bulkMode ? t('cpBulkSubmit') : t('cpSaveCoupon')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* 4.14 — THE CODES THEMSELVES.
          A batch is a deliverable: these go on cards, into a mailing, onto a
          stand at a fair. Written and then left in a table of two hundred rows,
          they would have to be found again one at a time. */}
      {generatedCodes && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-4">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-orange-600" />
                <span>{t('cpGeneratedTitle')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setGeneratedCodes(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <p className="text-xs font-bold text-gray-600">
              {t('cpGeneratedNote').replace('{0}', String(generatedCodes.length))}
            </p>

            <div className="max-h-64 overflow-y-auto rounded-2xl border border-gray-200 bg-gray-50 p-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 font-mono text-[0.6875rem] font-bold text-gray-800">
                {generatedCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(generatedCodes.join('\n'));
                    notify({ title: t('cpCopied') });
                  } catch {
                    // A browser that refuses the clipboard is not an error worth
                    // a red box: the codes are on the screen, and the CSV is
                    // beside this button.
                    notify({ title: t('cpDownloadCsv') });
                  }
                }}
                className="px-4 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-extrabold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                <span>{t('cpCopyCodes')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([codesToCsv(generatedCodes)], { type: 'text/csv;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `coupon-codes-${new Date().toISOString().slice(0, 10)}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  // Released on the next tick: revoking it synchronously can
                  // cancel the download in some browsers before it starts.
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
                className="px-4 py-2.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-black rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{t('cpDownloadCsv')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4.15 — WHO CHANGED WHAT.
          Written by the server in the same batch as the change itself, so an
          entry cannot be missing from a change that happened. */}
      {showAudit && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center border-b border-gray-100 pb-4">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <History className="w-5 h-5 text-gray-600" />
                <span>{t('cpAuditTitle')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAudit(false)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* 4.24 — HOW EACH CODE ACTUALLY PERFORMED.
                Frozen at redemption time by the payment webhook, because none of
                it can be recovered afterwards: the cost of the goods moves, the
                percentage can be edited, and an order deleted for GDPR takes its
                row with it. */}
            <div className="space-y-2">
              <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide">{t('cpStatsTitle')}</h4>
              {!stats ? null : stats.length === 0 ? (
                <p className="text-xs font-bold text-gray-400">{t('cpStatsEmpty')}</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-gray-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-[0.625rem] font-extrabold text-gray-500 uppercase">
                        <th className="p-2 text-left">{t('cpColCode')}</th>
                        <th className="p-2">{t('cpStatsUses')}</th>
                        <th className="p-2">{t('cpStatsDiscount')}</th>
                        <th className="p-2">{t('cpStatsRevenue')}</th>
                        <th className="p-2">{t('cpStatsMargin')}</th>
                        <th className="p-2">{t('cpStatsNewCustomers')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 font-bold text-gray-800">
                      {stats.map((row) => (
                        <tr key={row.id}>
                          <td className="p-2 font-mono font-black text-left">{row.code}</td>
                          <td className="p-2 text-center">{row.uses}</td>
                          <td className="p-2 text-center">{Math.round(row.discountGiven).toLocaleString('sv-SE')} kr</td>
                          <td className="p-2 text-center">{Math.round(row.netRevenue).toLocaleString('sv-SE')} kr</td>
                          <td className="p-2 text-center">
                            {/* A MARGIN THAT SAYS HOW MUCH OF ITSELF IT KNOWS.
                                Orders whose cost was never recorded are counted
                                as revenue with no cost, which flatters the
                                figure — so the caveat travels with it rather
                                than being left for somebody to remember. */}
                            {row.marginPercent === null ? '—' : `${row.marginPercent}%`}
                            {row.ordersWithFullCost < row.uses && (
                              <span className="block text-[0.625rem] font-bold text-amber-700">
                                {t('cpStatsPartialCost')
                                  .replace('{0}', String(row.ordersWithFullCost))
                                  .replace('{1}', String(row.uses))}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {row.newCustomers}
                            {row.newCustomerShare !== null && (
                              <span className="text-gray-400"> ({row.newCustomerShare}%)</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {loadingAudit ? (
              <div className="py-10 text-center space-y-3">
                <RefreshCw className="w-7 h-7 text-gray-400 animate-spin mx-auto" />
                <p className="text-xs font-bold text-gray-500">{t('cpAuditLoading')}</p>
              </div>
            ) : auditError ? (
              <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{auditError}</p>
            ) : !auditEntries || auditEntries.length === 0 ? (
              <p className="text-xs font-bold text-gray-500 py-8 text-center">{t('cpAuditEmpty')}</p>
            ) : (
              <div className="space-y-2">
                {auditEntries.map((e) => (
                  <div key={e.id} className="rounded-2xl border border-gray-200 p-3 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 font-black font-mono">{e.code}</span>
                      <span className="font-black text-gray-900">
                        {e.action === 'create' ? t('cpAuditCreate')
                          : e.action === 'delete' ? t('cpAuditDelete')
                          : e.action === 'bulk' ? t('cpAuditBulk')
                          : t('cpAuditUpdate')}
                      </span>
                      <span className="text-gray-500 font-bold">{e.byEmail || e.by}</span>
                      <span className="text-gray-400 ml-auto">{String(e.at).slice(0, 16).replace('T', ' ')}</span>
                    </div>
                    {e.note && <p className="text-[0.6875rem] text-gray-500 font-bold">{e.note}</p>}
                    {/* WHAT changed, field by field. A log saying only "changed"
                        answers none of the questions anybody opens it with. */}
                    {e.changes && Object.keys(e.changes).length > 0 && (
                      <div className="text-[0.6875rem] text-gray-600 font-mono space-y-0.5">
                        {Object.entries(e.changes).slice(0, 12).map(([field, value]) => (
                          <div key={field} className="truncate">
                            <span className="text-gray-400">{field}: </span>
                            {value && typeof value === 'object' && 'from' in (value as any)
                              ? `${JSON.stringify((value as any).from)} → ${JSON.stringify((value as any).to)}`
                              : JSON.stringify(value)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADJUST LOYALTY POINTS MODAL — same capped scroller as the coupon modal above;
          on a short phone the confirm button otherwise fell off the bottom. */}
      {selectedUserForPoints && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-6 dir-rtl">
            <div className="flex justify-between items-center border-b border-gray-100 pb-4">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Coins className="w-5 h-5 text-amber-600" />
                <span>{t('cpAdjustTitle')}</span>
              </h3>
              <button
                type="button"
                onClick={() => setSelectedUserForPoints(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 space-y-1">
              <p className="text-xs font-bold text-amber-900">{t('cpAdjustCustomer')}</p>
              <p className="font-black text-sm text-amber-950">{selectedUserForPoints.displayName}</p>
              <p className="text-[0.6875rem] text-amber-800">{selectedUserForPoints.email}</p>
              <p className="text-xs font-extrabold text-amber-900 pt-2 border-t border-amber-200/80 mt-2">
                {t('cpAdjustCurrent')} <span className="text-amber-700 font-black text-sm">{selectedUserForPoints.loyaltyPoints ?? 0} PTS</span>
              </p>
            </div>

            {/* 4.16 — THE LEDGER, IN FRONT OF WHOEVER IS ABOUT TO CHANGE IT.
                It has existed since 4.6 and nothing in the dashboard could read
                it: the owner had a balance, a "history" array truncated at
                fifty, and no way to answer "where did these points come from?"
                — which is the only question worth asking before adjusting a
                balance. */}
            <div className="rounded-2xl border border-gray-200 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wide">{t('cpLedgerTitle')}</h4>
                {ledger && (
                  <span className="text-[0.6875rem] font-bold text-gray-500">
                    {ledger.lifetimeSpend > 0
                      ? `${t('cpColSpend')}: ${Math.round(ledger.lifetimeSpend).toLocaleString('sv-SE')} kr`
                      : ''}
                  </span>
                )}
              </div>

              {loadingLedger ? (
                <p className="text-[0.6875rem] font-bold text-gray-500">{t('cpLedgerLoading')}</p>
              ) : !ledger ? (
                <p className="text-[0.6875rem] font-bold text-gray-400">{t('cpLedgerEmpty')}</p>
              ) : (
                <>
                  {/* A BALANCE THAT HAS DRIFTED FROM ITS OWN LEDGER is shown,
                      not hidden. Every balance that predates the ledger has
                      drifted by definition, and somebody has to be able to see
                      which ones. */}
                  {ledger.ledgerBalance !== ledger.balance && (
                    <p className="text-[0.6875rem] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2">
                      {t('cpLedgerDrift')
                        .replace('{0}', String(ledger.ledgerBalance))
                        .replace('{1}', String(ledger.balance))}
                    </p>
                  )}
                  {ledger.pendingExpiry > 0 && (
                    <p className="text-[0.6875rem] font-bold text-red-800 bg-red-50 border border-red-200 rounded-xl p-2">
                      {t('cpLedgerExpiring').replace('{0}', String(ledger.pendingExpiry))}
                    </p>
                  )}
                  {ledger.nextExpiryAt && (
                    <p className="text-[0.6875rem] font-bold text-gray-500">
                      {t('cpLedgerNextExpiry').replace('{0}', ledger.nextExpiryAt.slice(0, 10))}
                    </p>
                  )}

                  {ledger.entries.length === 0 ? (
                    <p className="text-[0.6875rem] font-bold text-gray-400">{t('cpLedgerEmpty')}</p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                      {ledger.entries.map((e) => (
                        <div key={e.id} className="py-1.5 flex items-start gap-2 text-[0.6875rem]">
                          <span className={cn(
                            'font-black tabular-nums shrink-0 w-14 text-left',
                            (e.points ?? 0) >= 0 ? 'text-emerald-700' : 'text-red-700'
                          )}>
                            {(e.points ?? 0) >= 0 ? '+' : ''}{e.points ?? 0}
                          </span>
                          <span className="flex-1 text-gray-700 font-bold truncate">
                            {e.description || e.type}
                            {e.by && <span className="text-gray-400"> · {e.by}</span>}
                          </span>
                          <span className="text-gray-400 shrink-0">{String(e.date ?? '').slice(0, 10)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <form onSubmit={handleSavePointsAdjustment} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('cpAdjustDelta')}
                </label>
                <input
                  type="number"
                  step={10}
                  value={pointsDelta}
                  onChange={(e) => setPointsDelta(Number(e.target.value))}
                  placeholder={t('cpDeltaPlaceholder')}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-black text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  required
                />
                <p className="text-[0.625rem] text-gray-500 mt-1">
                  {t('cpAdjustNew')} <span className="font-extrabold text-amber-700">{Math.max(0, (selectedUserForPoints.loyaltyPoints ?? 250) + pointsDelta)} PTS</span>
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  {t('cpAdjustReason')}
                </label>
                <input
                  type="text"
                  value={pointsReason}
                  onChange={(e) => setPointsReason(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setSelectedUserForPoints(null)}
                  className="px-4 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
                >
                  {t('cpCancel')}
                </button>
                <button
                  type="submit"
                  disabled={savingPoints}
                  className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-black rounded-xl shadow-md transition-all active:scale-95 cursor-pointer flex items-center gap-2"
                >
                  {savingPoints ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span>{t('cpAdjustConfirm')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
