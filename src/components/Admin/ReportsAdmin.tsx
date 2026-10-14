import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, RefreshCw, Download, FileText,
  Package, Users, Receipt, AlertTriangle, Calendar,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase';
import InvoiceModal from '../InvoiceModal';
import { useAuth } from '../../App';
import { formatDate, localeFor } from '../../lib/dateFormat';
import { couponStats, type CouponStatRow } from '../../lib/couponsApi';
import { abandonedCarts, type AbandonedCarts } from '../../lib/loyaltyApi';
import { cn } from '../../lib/utils';
import { knownStageLabelKey } from '../../lib/orderQueue';

/**
 * SALES, PRODUCTS AND INVOICES — the reporting screen the owner asked for.
 *
 * Everything on this page comes from ONE call to /api/admin/reports, which
 * returns finished aggregates. Nothing here reads Firestore directly: an order
 * document can run to hundreds of KB because of the artwork specs frozen into
 * it, and this shop has already been dark for seven hours over the free read
 * quota. Drawing a line chart must not cost a year of order documents.
 *
 * The comparison figures are computed by asking for the PREVIOUS period of the
 * same length and diffing in the browser — two cheap aggregate calls rather than
 * one clever query.
 */

type Totals = {
  paidOrders: number; unpaidOrders: number; testOrders: number;
  grossRevenue: number; netRevenue: number; vatCollected: number;
  refunded: number; shippingCharged: number; discountGiven: number;
  unitsSold: number; averageOrderValue: number; customers: number;
};
/** 5.4 · 5.5 — absent on reports built before the cost snapshot existed. */
type MoneyBlock = {
  goodsCost: number;
  grossProfit: number;
  /** null when there is no revenue to state a margin on. Not 0. */
  marginPercent: number | null;
  shippingCharged: number;
  shippingPaid: number;
  shippingResult: number;
  ordersWithCost: number;
  ordersMissingCost: number;
  costCoverage: number;
  complete: boolean;
};

/** 5.6 — by rate for the return, by regime because the zeroes differ. */
type VatBlock = {
  byRate: { rate: string; net: number; vat: number; orders: number }[];
  byRegime: { regime: string; net: number; vat: number; orders: number }[];
};

type Reports = {
  range: { from: string; to: string };
  totals: Totals;
  money?: MoneyBlock;
  vat?: VatBlock;
  /** 5.8 — profit per product, and what took no money at all. */
  topProfitable?: { key: string; name: string; units: number; revenue: number; cost: number; profit: number; marginPercent: number | null }[];
  profitableCoverage?: { productsWithCost: number; productsSold: number };
  stagnant?: { key: string; name: string; price: number }[];
  /** 5.9 — within this range, and it says so. */
  customers?: { total: number; repeat: number; repeatRatePercent: number; averageOrdersPerCustomer: number; averageRevenuePerCustomer: number; revenueFromRepeat: number; scope: string };
  /** 5.13 — median as well as mean; one slow reprint moves the mean and not the median. */
  production?: { orders: number; averageHours: number | null; medianHours: number | null; slowestHours: number | null };
  /** 5.7b — Mollie's reason where it gave one, its status where it did not. */
  paymentFailures?: { reason: string; count: number; value: number }[];
  /** 5.11 — unpaid orders by age. */
  aging?: { buckets: { label: string; count: number; value: number }[]; totalValue: number };
  /** 5.14 — reprints are recorded; rejections are not, and it says so. */
  reprints?: { lines: number; artworkLines: number; percent: number | null; rejectionsRecorded: boolean };
  daily: { day: string; gross: number; net: number; orders: number }[];
  topProducts: { key: string; name: string; units: number; revenue: number; orders: number }[];
  byStatus: { key: string; count: number }[];
  byShipping: { key: string; count: number }[];
  byMethod: { key: string; count: number }[];
  topCustomers: { key: string; name: string; orders: number; revenue: number }[];
  invoices: {
    id: string; number: string; createdAt: string; paidAt: string | null;
    customerName: string | null; customerEmail: string | null; status: string | null;
    currency: string; net: number; vat: number; gross: number; refunded: number;
    discountCode: string | null; method: string | null;
  }[];
  cached?: boolean;
  stale?: boolean;
};

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
];

// A brand-neutral, colour-blind-safe set. Deliberately NOT the orange the shop
// uses for calls to action — a chart series that matches the "Buy" button reads
// as interactive.
const SERIES = ['#2563eb', '#0d9488', '#d97706', '#7c3aed', '#db2777', '#4b5563', '#059669'];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export default function ReportsAdmin() {
  const { t, language } = useAuth();
  const [days, setDays] = useState(30);
  // How many days the figures on screen cover — the preset's, or a custom range's
  // own length: "vs previous 30 days" under an eleven-day range was a wrong label.
  const [spanShown, setSpanShown] = useState(30);
  // A DATE RANGE HE CHOOSES — plan task 5.2.
  // The four presets answer "how are we doing"; they cannot answer "what did
  // we invoice in March", which is the question an accountant asks. When both
  // ends are set they win over the preset, and clearing either goes back.
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [data, setData] = useState<Reports | null>(null);
  const [previous, setPrevious] = useState<Reports | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'sales' | 'products' | 'invoices'>('sales');
  // The order behind a clicked invoice row. He asked for "reports and INVOICES";
  // a list you cannot open is a list, not invoices. The row fetches the one
  // order document it needs and hands it to the same modal the staff screen
  // prints from, so the two can never disagree about what an invoice says.
  const [invoiceOrder, setInvoiceOrder] = useState<any | null>(null);
  const [openingInvoice, setOpeningInvoice] = useState<string | null>(null);

  /**
   * 5.10 — COUPON PERFORMANCE.
   *
   * Not part of /api/admin/reports, and deliberately: these figures are FROZEN
   * AT REDEMPTION TIME (4.24) rather than computed from the orders in a date
   * range. They have to be. The cost of the goods moves, a coupon's percentage
   * can be edited after the fact, and an order deleted for GDPR takes its row
   * with it — so a campaign recomputed six months later answers a different
   * question from the one the owner is asking. It is lifetime-per-code, and it
   * says so on the screen rather than pretending to follow the date range above.
   */
  const [coupons, setCoupons] = useState<CouponStatRow[] | null>(null);
  /** 5.7c — what is sitting in baskets right now, not in the date range above. */
  const [abandoned, setAbandoned] = useState<AbandonedCarts | null>(null);
  useEffect(() => {
    let cancelled = false;
    couponStats()
      .then(({ stats }) => { if (!cancelled) setCoupons(stats); })
      // A silent absence: the tiles and the charts are the point of this screen
      // and must not be held up by one extra section.
      .catch(() => { if (!cancelled) setCoupons([]); });
    abandonedCarts(24)
      .then((data) => { if (!cancelled) setAbandoned(data); })
      .catch(() => { if (!cancelled) setAbandoned(null); });
    return () => { cancelled = true; };
  }, []);

  const call = useCallback(async (from: string, to: string, refresh = false) => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    const qs = `from=${from}&to=${to}${refresh ? '&refresh=1' : ''}`;
    const resp = await fetch(`/api/admin/reports?${qs}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(body?.error || `Request failed (${resp.status}).`);
    return body as Reports;
  }, []);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      // A custom range needs BOTH ends. One date alone is an unfinished thought,
      // and guessing the other — today? the beginning of time? — answers a
      // question he did not ask.
      const useCustom = Boolean(customFrom && customTo && customFrom <= customTo);

      const now = useCustom ? new Date(`${customTo}T12:00:00`) : new Date();
      const from = useCustom
        ? new Date(`${customFrom}T12:00:00`)
        : new Date(new Date().getTime() - (days - 1) * 86400000);

      // Midday, not midnight: these strings are read in the browser's local
      // zone, and a midnight that lands an hour earlier in UTC shifts the whole
      // range by a day for anyone west of Greenwich.

      // The period immediately before this one, THE SAME LENGTH — that is what
      // "vs previous" has to mean for the percentages to be honest, and it holds
      // for a custom range too: comparing eleven days against thirty would make
      // every figure look like a collapse.
      const spanDays = Math.max(1, Math.round((now.getTime() - from.getTime()) / 86400000) + 1);
      const prevTo = new Date(from.getTime() - 86400000);
      const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * 86400000);

      const [current, prior] = await Promise.all([
        call(isoDay(from), isoDay(now), refresh),
        call(isoDay(prevFrom), isoDay(prevTo), refresh).catch(() => null),
      ]);
      setData(current);
      setPrevious(prior);
      setSpanShown(spanDays);
    } catch (err: any) {
      setError(err?.message || 'Could not load the reports.');
    } finally {
      setLoading(false);
    }
  }, [call, days, customFrom, customTo]);

  useEffect(() => { void load(); }, [load]);

  const money = useMemo(
    () => (n: number) => `${Number(n || 0).toLocaleString('sv-SE', { maximumFractionDigits: 0 })} SEK`,
    [],
  );

  // A percentage against a zero baseline is not a percentage. Say "new" instead
  // of printing an infinity or a misleading 100%.
  /**
   * The comparison with the previous period — plan task 5.3.
   *
   * It used to return null whenever the baseline was zero, so the line simply
   * VANISHED from the tile. Nothing on screen distinguished "there is no
   * comparison to make" from "the comparison is flat", and a shop whose previous
   * period was empty — which is every shop starting out, and this one — saw
   * eight tiles with no comparison at all and no reason given.
   *
   * A percentage change from zero is undefined, not infinite, so it is not
   * invented. What is shown instead is the pair of numbers, which is the thing
   * the percentage was standing in for.
   */
  const delta = (now: number, before: number | undefined) => {
    if (before === undefined || before === null) return { kind: 'none' as const };
    if (before === 0 && now === 0) return { kind: 'flat' as const };
    if (before === 0) return { kind: 'fromZero' as const, before, now, up: true };
    const pct = ((now - before) / before) * 100;
    return { kind: 'pct' as const, pct, up: pct >= 0 };
  };

  const openInvoice = async (orderId: string) => {
    setOpeningInvoice(orderId);
    try {
      const snap = await getDoc(doc(db, 'orders', orderId));
      if (snap.exists()) setInvoiceOrder({ id: snap.id, ...snap.data() });
      else setError(t('rpInvoiceMissing'));
    } catch (err: any) {
      setError(err?.message || t('rpInvoiceMissing'));
    } finally {
      setOpeningInvoice(null);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const rows: string[][] = [];
    if (tab === 'invoices') {
      rows.push(['Invoice', 'Order', 'Date', 'Paid', 'Customer', 'Email', 'Status', 'Net', 'VAT', 'Gross', 'Refunded', 'Discount code', 'Method']);
      data.invoices.forEach((i) => rows.push([
        i.number, i.id, i.createdAt, i.paidAt ?? '', i.customerName ?? '', i.customerEmail ?? '',
        i.status ?? '', String(i.net), String(i.vat), String(i.gross), String(i.refunded),
        i.discountCode ?? '', i.method ?? '',
      ]));
    } else if (tab === 'products') {
      rows.push(['Product', 'Units', 'Revenue (net)', 'Orders']);
      data.topProducts.forEach((p) => rows.push([p.name, String(p.units), String(p.revenue), String(p.orders)]));
    } else {
      rows.push(['Day', 'Gross revenue', 'Net revenue', 'Orders']);
      data.daily.forEach((d) => rows.push([d.day, String(d.gross), String(d.net), String(d.orders)]));
    }
    // Quote every field: a customer called "Andersson, Bo" would otherwise
    // become two columns and shift the whole row.
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `reklamx-${tab}-${isoDay(new Date())}.csv`;
    // In the document before the click, and revoked on the next tick. Firefox
    // ignores a click on a detached anchor, and revoking synchronously races the
    // download in every browser.
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  };

  const Tile = ({ label, value, prior, hint }: { label: string; value: number; prior?: number; hint?: string }) => {
    const d = delta(value, prior);
    return (
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
        <p className="text-[0.6875rem] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-black text-gray-900 mt-1 tabular-nums">{hint === 'money' ? money(value) : value.toLocaleString('sv-SE')}</p>
        {/* Always something. A missing line reads as a missing feature. */}
        {d.kind === 'none' ? (
          <p className="text-[0.6875rem] font-black mt-1 text-gray-300">—</p>
        ) : d.kind === 'flat' ? (
          <p className="text-[0.6875rem] font-black mt-1 text-gray-400 flex items-center gap-1">
            <span>{t('rpNoChange')}</span>
            <span className="text-gray-300 font-bold">{t('rpVsPrevious').replace('{0}', String(spanShown))}</span>
          </p>
        ) : d.kind === 'fromZero' ? (
          // "0 → 12" rather than a percentage that does not exist.
          <p className="text-[0.6875rem] font-black mt-1 text-emerald-600 flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              0 → {hint === 'money' ? money(d.now) : d.now.toLocaleString('sv-SE')}
            </span>
            <span className="text-gray-400 font-bold">{t('rpVsPrevious').replace('{0}', String(spanShown))}</span>
          </p>
        ) : (
          <p className={cn('text-[0.6875rem] font-black mt-1 flex items-center gap-1', d.up ? 'text-emerald-600' : 'text-red-600')}>
            {d.up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {`${d.pct >= 0 ? '+' : ''}${d.pct.toLocaleString(localeFor(language), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
            <span className="text-gray-400 font-bold">{t('rpVsPrevious').replace('{0}', String(spanShown))}</span>
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-blue-600" />
              {t('rpTitle')}
            </h1>
            <p className="text-xs font-bold text-gray-400 mt-1">{t('rpSubtitle')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => { setDays(r.days); setCustomFrom(''); setCustomTo(''); }}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-black border transition-colors cursor-pointer',
                  days === r.days && !(customFrom && customTo)
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100',
                )}
              >
                {r.label}
              </button>
            ))}

            {/* The two dates. Both or neither — see the note in load(). */}
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2.5 py-2 rounded-xl text-xs font-bold border border-gray-200 bg-gray-50 text-gray-700"
              />
              <span className="text-gray-400 text-xs font-black">–</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2.5 py-2 rounded-xl text-xs font-bold border border-gray-200 bg-gray-50 text-gray-700"
              />
              {(customFrom || customTo) && (
                <button
                  type="button"
                  onClick={() => { setCustomFrom(''); setCustomTo(''); }}
                  className="px-2.5 py-2 rounded-xl text-xs font-black bg-gray-100 text-gray-600 hover:bg-gray-200"
                >
                  {t('rpClearDates')}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={loading}
              className="px-3 py-2 rounded-xl text-xs font-black bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
              {t('rpRefresh')}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data}
              className="px-3 py-2 rounded-xl text-xs font-black bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>
        </div>

        {data && (
          <p className="text-[0.6875rem] font-bold text-gray-400 mt-3 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            {/* range.to is the half-open upper bound, so printing it verbatim
                showed a day the report deliberately excludes. Step back one. */}
            {formatDate(data.range.from, localeFor(language))} — {formatDate(
              new Date(new Date(data.range.to).getTime() - 86400000).toISOString(),
              localeFor(language),
            )}
            {data.stale && <span className="text-amber-600">· {t('rpStale')}</span>}
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-xs font-bold">{error}</div>
      )}

      {/* Test-mode orders are excluded from every figure above, but the owner has
          to be TOLD that — otherwise a shop full of test payments reads as a shop
          with no sales, and he goes looking for a bug that is not there. */}
      {data && data.totals.testOrders > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl text-xs font-bold flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t('rpTestExcluded').replace('{0}', String(data.totals.testOrders))}</span>
        </div>
      )}

      {loading && !data && (
        <div className="bg-white p-12 rounded-3xl border border-gray-100 text-center text-xs font-bold text-gray-400">
          {t('rpLoading')}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile label={t('rpRevenueGross')} value={data.totals.grossRevenue} prior={previous?.totals.grossRevenue} hint="money" />
            <Tile label={t('rpRevenueNet')} value={data.totals.netRevenue} prior={previous?.totals.netRevenue} hint="money" />
            <Tile label={t('rpPaidOrders')} value={data.totals.paidOrders} prior={previous?.totals.paidOrders} />
            <Tile label={t('rpAverageOrder')} value={data.totals.averageOrderValue} prior={previous?.totals.averageOrderValue} hint="money" />
            <Tile label={t('rpUnitsSold')} value={data.totals.unitsSold} prior={previous?.totals.unitsSold} />
            <Tile label={t('rpCustomers')} value={data.totals.customers} prior={previous?.totals.customers} />
            <Tile label={t('rpVatCollected')} value={data.totals.vatCollected} prior={previous?.totals.vatCollected} hint="money" />
            <Tile label={t('rpUnpaidAttempts')} value={data.totals.unpaidOrders} prior={previous?.totals.unpaidOrders} />
          </div>

          {/* ── 5.4 · 5.5 — WHAT IT COST, AND WHAT IS LEFT ──────────────────
              Shown apart from the revenue tiles and with its coverage stated.
              A margin built from total revenue and partial costs is not a
              cautious estimate, it is a flattering one — and it is the kind of
              number a shop makes decisions on. */}
          {data.money && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h3 className="text-sm font-black text-gray-900">{t('rpCostTitle')}</h3>
                {data.money.complete ? (
                  <span className="text-[0.6875rem] font-bold text-emerald-600">{t('rpCostComplete')}</span>
                ) : (
                  <span className="text-[0.6875rem] font-bold text-amber-700">
                    {t('rpCostPartial')
                      .replace('{0}', String(data.money.ordersWithCost))
                      .replace('{1}', String(data.money.ordersWithCost + data.money.ordersMissingCost))}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Tile label={t('rpGoodsCost')} value={data.money.goodsCost} prior={previous?.money?.goodsCost} hint="money" />
                <Tile label={t('rpGrossProfit')} value={data.money.grossProfit} prior={previous?.money?.grossProfit} hint="money" />
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <p className="text-[0.6875rem] font-bold text-gray-400 uppercase tracking-wide">{t('rpMarginPercent')}</p>
                  <p className="text-2xl font-black text-gray-900 mt-1 tabular-nums">
                    {/* null, not 0: no revenue means no margin to state. */}
                    {data.money.marginPercent === null ? '—' : `${data.money.marginPercent}%`}
                  </p>
                  <p className="text-[0.6875rem] font-bold text-gray-400 mt-1">{t('rpMarginNote')}</p>
                </div>
                <div className="bg-gray-50 p-5 rounded-3xl border border-gray-100">
                  <p className="text-[0.6875rem] font-bold text-gray-400 uppercase tracking-wide">{t('rpShippingResult')}</p>
                  <p className={cn('text-2xl font-black mt-1 tabular-nums',
                    data.money.shippingResult >= 0 ? 'text-gray-900' : 'text-red-600')}>
                    {money(data.money.shippingResult)}
                  </p>
                  <p className="text-[0.6875rem] font-bold text-gray-400 mt-1">
                    {money(data.money.shippingCharged)} − {money(data.money.shippingPaid)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── 5.6 — THE VAT SPLIT ─────────────────────────────────────────
              By RATE for the return, and separately by REGIME because a zero
              from a reverse charge and a zero from an export are reported
              differently — and one of them rests on a VAT number nobody has
              checked against VIES. */}
          {data.vat && (data.vat.byRate?.length > 0 || data.vat.byRegime?.length > 0) && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4">
              <h3 className="text-sm font-black text-gray-900">{t('rpVatTitle')}</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <p className="text-[0.6875rem] font-black text-gray-400 uppercase mb-2">{t('rpVatByRate')}</p>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-gray-100">
                      {data.vat.byRate.map((r: any) => (
                        <tr key={r.rate}>
                          <td className="py-2 font-black text-gray-800">{r.rate}</td>
                          <td className="py-2 text-right tabular-nums text-gray-600">{money(r.net)}</td>
                          <td className="py-2 text-right tabular-nums font-bold text-gray-900">{money(r.vat)}</td>
                          <td className="py-2 text-right text-gray-400">{r.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="text-[0.6875rem] font-black text-gray-400 uppercase mb-2">{t('rpVatByRegime')}</p>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-gray-100">
                      {data.vat.byRegime.map((r: any) => (
                        <tr key={r.regime}>
                          <td className="py-2 font-black text-gray-800">{t(`rpRegime_${r.regime.replace(/-/g, '_')}` as any) || r.regime}</td>
                          <td className="py-2 text-right tabular-nums text-gray-600">{money(r.net)}</td>
                          <td className="py-2 text-right tabular-nums font-bold text-gray-900">{money(r.vat)}</td>
                          <td className="py-2 text-right text-gray-400">{r.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 5.9 and 5.13 — who buys again, and how long a job takes. */}
          {(data.customers || data.production) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.customers && (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-black text-gray-900">{t('rpRepeatTitle')}</h3>
                  <p className="text-3xl font-black text-gray-900 mt-2 tabular-nums">{data.customers.repeatRatePercent}%</p>
                  <p className="text-[0.6875rem] font-bold text-gray-400">
                    {t('rpRepeatOf').replace('{0}', String(data.customers.repeat)).replace('{1}', String(data.customers.total))}
                  </p>
                  <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                    <div>
                      <p className="text-gray-400 font-bold">{t('rpAvgOrdersPerCustomer')}</p>
                      <p className="font-black text-gray-900 tabular-nums">{data.customers.averageOrdersPerCustomer}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 font-bold">{t('rpAvgRevenuePerCustomer')}</p>
                      <p className="font-black text-gray-900 tabular-nums">{money(data.customers.averageRevenuePerCustomer)}</p>
                    </div>
                  </div>
                  {/* Said plainly: this is the range, not the shop's lifetime. */}
                  <p className="text-[0.625rem] text-gray-400 font-medium mt-3">{t('rpRepeatScopeNote')}</p>
                </div>
              )}
              {data.production && (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-black text-gray-900">{t('rpProductionTitle')}</h3>
                  {data.production.orders === 0 ? (
                    <p className="text-xs text-gray-400 font-bold mt-3">{t('rpProductionNone')}</p>
                  ) : (
                    <>
                      <p className="text-3xl font-black text-gray-900 mt-2 tabular-nums">
                        {t('rpHours').replace('{0}', String(data.production.medianHours))}
                      </p>
                      <p className="text-[0.6875rem] font-bold text-gray-400">{t('rpProductionMedian')}</p>
                      <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
                        <div>
                          <p className="text-gray-400 font-bold">{t('rpProductionAverage')}</p>
                          <p className="font-black text-gray-900 tabular-nums">{t('rpHours').replace('{0}', String(data.production.averageHours))}</p>
                        </div>
                        <div>
                          <p className="text-gray-400 font-bold">{t('rpProductionSlowest')}</p>
                          <p className="font-black text-gray-900 tabular-nums">{t('rpHours').replace('{0}', String(data.production.slowestHours))}</p>
                        </div>
                      </div>
                      {/* The median leads, because one reprint that sat for three
                          weeks moves the mean and not the median — and the mean
                          is the number a shop accidentally quotes. */}
                      <p className="text-[0.625rem] text-gray-400 font-medium mt-3">
                        {t('rpProductionNote').replace('{0}', String(data.production.orders))}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 5.8 — profit, and silence. */}
          {(data.topProfitable?.length || data.stagnant?.length) ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.topProfitable && data.topProfitable.length > 0 && (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <h3 className="text-sm font-black text-gray-900">{t('rpMostProfitable')}</h3>
                    {data.profitableCoverage && (
                      <span className="text-[0.625rem] font-bold text-gray-400">
                        {t('rpProfitCoverage')
                          .replace('{0}', String(data.profitableCoverage.productsWithCost))
                          .replace('{1}', String(data.profitableCoverage.productsSold))}
                      </span>
                    )}
                  </div>
                  <table className="w-full text-xs mt-3">
                    <tbody className="divide-y divide-gray-100">
                      {data.topProfitable.slice(0, 8).map((p) => (
                        <tr key={p.key}>
                          <td className="py-2 font-bold text-gray-800 truncate max-w-[10rem]" title={p.name}>{p.name}</td>
                          <td className="py-2 text-right tabular-nums text-gray-500">{money(p.revenue)}</td>
                          <td className="py-2 text-right tabular-nums font-black text-emerald-700">{money(p.profit)}</td>
                          <td className="py-2 text-right tabular-nums text-gray-400">{p.marginPercent === null ? '—' : `${p.marginPercent}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.stagnant && data.stagnant.length > 0 && (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-black text-gray-900">{t('rpStagnant')}</h3>
                  <p className="text-[0.6875rem] font-bold text-gray-400 mt-0.5">{t('rpStagnantNote')}</p>
                  <table className="w-full text-xs mt-3">
                    <tbody className="divide-y divide-gray-100">
                      {data.stagnant.slice(0, 8).map((p) => (
                        <tr key={p.key}>
                          <td className="py-2 font-bold text-gray-700 truncate max-w-[13.75rem]" title={p.name}>{p.name}</td>
                          <td className="py-2 text-right tabular-nums text-gray-400">{money(p.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.stagnant.length > 8 && (
                    <p className="text-[0.625rem] text-gray-400 font-bold mt-2">
                      {t('rpStagnantMore').replace('{0}', String(data.stagnant.length - 8))}
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {/* 5.11 and 5.7b — money not collected, and why. */}
          {((data.aging && data.aging.totalValue > 0) || (data.paymentFailures && data.paymentFailures.length > 0)) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {data.aging && data.aging.totalValue > 0 && (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-black text-gray-900">{t('rpAgingTitle')}</h3>
                  <p className="text-3xl font-black text-gray-900 mt-2 tabular-nums">{money(data.aging.totalValue)}</p>
                  <p className="text-[0.6875rem] font-bold text-gray-400">{t('rpAgingSubtitle')}</p>
                  <table className="w-full text-xs mt-3">
                    <tbody className="divide-y divide-gray-100">
                      {data.aging.buckets.map((b) => (
                        <tr key={b.label}>
                          {/* The oldest bucket is the one that matters, so it is
                              the one that is coloured. */}
                          <td className={cn('py-2 font-black', b.label === '61+' && b.count > 0 ? 'text-red-600' : 'text-gray-700')}>
                            {t('rpAgingDays').replace('{0}', b.label)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-gray-400">{b.count}</td>
                          <td className="py-2 text-right tabular-nums font-bold text-gray-900">{money(b.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.paymentFailures && data.paymentFailures.length > 0 && (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
                  <h3 className="text-sm font-black text-gray-900">{t('rpFailuresTitle')}</h3>
                  <p className="text-[0.6875rem] font-bold text-gray-400 mt-0.5">{t('rpFailuresNote')}</p>
                  <table className="w-full text-xs mt-3">
                    <tbody className="divide-y divide-gray-100">
                      {data.paymentFailures.slice(0, 8).map((f) => (
                        <tr key={f.reason}>
                          <td className="py-2 font-bold text-gray-700">{f.reason}</td>
                          <td className="py-2 text-right tabular-nums text-gray-400">{f.count}</td>
                          <td className="py-2 text-right tabular-nums font-bold text-gray-900">{money(f.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 5.14 — and what is honestly missing from it. */}
          {data.reprints && data.reprints.artworkLines > 0 && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-gray-900">{t('rpReprintTitle')}</h3>
                <p className="text-[0.6875rem] font-bold text-gray-400 mt-0.5">
                  {t('rpReprintOf').replace('{0}', String(data.reprints.lines)).replace('{1}', String(data.reprints.artworkLines))}
                </p>
              </div>
              <p className="text-2xl font-black text-gray-900 tabular-nums">
                {data.reprints.percent === null ? '—' : `${data.reprints.percent}%`}
              </p>
              {!data.reprints.rejectionsRecorded && (
                <p className="w-full text-[0.625rem] text-amber-700 font-bold">{t('rpRejectionsMissing')}</p>
              )}
            </div>
          )}



          {/* 5.7c — WHAT WALKED AWAY.
              Signed-in customers only; the shop has no anonymous visitor id and
              inventing one to follow people who have not identified themselves is
              a different decision. Like the coupon figures above, this is not part
              of the date range: it is what is sitting there RIGHT NOW. */}
          {abandoned && abandoned.count > 0 && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-gray-900">{t('rpAbandonedTitle')}</h3>
                  <p className="text-[0.6875rem] font-bold text-gray-400 mt-0.5">
                    {t('rpAbandonedNote')
                      .replace('{0}', String(abandoned.hours))
                      .replace('{1}', String(abandoned.retentionDays))}
                  </p>
                </div>
                <div className="flex gap-5 text-right">
                  <div>
                    <p className="text-[0.625rem] font-extrabold text-gray-400 uppercase">{t('rpAbandonedValue')}</p>
                    <p className="text-2xl font-black text-amber-700 tabular-nums">{money(abandoned.totalValue)}</p>
                  </div>
                  <div>
                    <p className="text-[0.625rem] font-extrabold text-gray-400 uppercase">{t('rpAbandonedCount')}</p>
                    <p className="text-2xl font-black text-gray-900 tabular-nums">{abandoned.count}</p>
                  </div>
                  {abandoned.waitingForArtwork > 0 && (
                    <div>
                      <p className="text-[0.625rem] font-extrabold text-gray-400 uppercase">{t('rpAbandonedArtwork')}</p>
                      <p className="text-2xl font-black text-gray-900 tabular-nums">{abandoned.waitingForArtwork}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[0.625rem] font-extrabold text-gray-400 uppercase border-b border-gray-100">
                      <th className="p-2 text-left">{t('rpAbandonedCustomer')}</th>
                      <th className="p-2">{t('rpAbandonedItems')}</th>
                      <th className="p-2">{t('rpAbandonedValue')}</th>
                      <th className="p-2">{t('rpAbandonedLast')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 font-bold text-gray-800">
                    {abandoned.carts.slice(0, 25).map((c) => (
                      <tr key={c.uid}>
                        <td className="p-2 text-left">
                          {/* The e-mail, because the only useful thing to DO with
                              this row is get in touch. */}
                          {c.email || <span className="text-gray-400">{c.uid.slice(0, 8)}…</span>}
                          {c.anyArtworkPending && (
                            <span className="block text-[0.625rem] font-bold text-amber-700">{t('rpAbandonedWaiting')}</span>
                          )}
                        </td>
                        <td className="p-2 text-center tabular-nums">{c.itemCount}</td>
                        <td className="p-2 text-center tabular-nums">{money(c.value)}</td>
                        <td className="p-2 text-center text-gray-500">{String(c.updatedAt ?? '').slice(0, 10)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5.10 — COUPON PERFORMANCE, from figures frozen at redemption time.
              Lifetime per code, NOT the date range above, and it says so: these
              numbers cannot be recomputed later without answering a different
              question. */}
          {coupons && coupons.length > 0 && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-3">
              <div>
                <h3 className="text-sm font-black text-gray-900">{t('rpCouponTitle')}</h3>
                <p className="text-[0.6875rem] font-bold text-gray-400 mt-0.5">{t('rpCouponLifetime')}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[0.625rem] font-extrabold text-gray-400 uppercase border-b border-gray-100">
                      <th className="p-2 text-left">{t('rpCouponCode')}</th>
                      <th className="p-2">{t('rpCouponUses')}</th>
                      <th className="p-2">{t('rpCouponDiscount')}</th>
                      <th className="p-2">{t('rpCouponRevenue')}</th>
                      <th className="p-2">{t('rpCouponMargin')}</th>
                      <th className="p-2">{t('rpCouponNew')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 font-bold text-gray-800">
                    {coupons.map((row) => (
                      <tr key={row.id}>
                        <td className="p-2 font-mono font-black text-left">{row.code}</td>
                        <td className="p-2 text-center tabular-nums">{row.uses}</td>
                        <td className="p-2 text-center tabular-nums">{money(row.discountGiven)}</td>
                        <td className="p-2 text-center tabular-nums">{money(row.netRevenue)}</td>
                        <td className="p-2 text-center tabular-nums">
                          {/* THE CAVEAT TRAVELS WITH THE NUMBER. An order whose
                              cost was never recorded counts as revenue with no
                              cost, which flatters the margin — so the screen
                              says how much of itself the figure knows rather
                              than leaving somebody to remember. */}
                          {row.marginPercent === null ? '—' : `${row.marginPercent}%`}
                          {row.ordersWithFullCost < row.uses && (
                            <span className="block text-[0.625rem] font-bold text-amber-700">
                              {t('rpCouponPartialCost')
                                .replace('{0}', String(row.ordersWithFullCost))
                                .replace('{1}', String(row.uses))}
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-center tabular-nums">
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
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {([
              ['sales', t('rpTabSales'), <TrendingUp key="a" className="w-3.5 h-3.5" />],
              ['products', t('rpTabProducts'), <Package key="b" className="w-3.5 h-3.5" />],
              ['invoices', t('rpTabInvoices'), <Receipt key="c" className="w-3.5 h-3.5" />],
            ] as const).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id as any)}
                className={cn(
                  'px-4 py-2.5 rounded-2xl text-xs font-black border transition-colors flex items-center gap-1.5 cursor-pointer',
                  tab === id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50',
                )}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          {tab === 'sales' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                <h2 className="text-sm font-black text-gray-900 mb-4">{t('rpRevenueOverTime')}</h2>
                {data.daily.length === 0 ? (
                  <p className="text-xs font-bold text-gray-400 py-12 text-center">{t('rpNoSales')}</p>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.daily} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="rpGross" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.35} />
                            <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" vertical={false} />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={70} />
                        <Tooltip
                          formatter={(v: any, n: any) => [money(Number(v)), String(n)]}
                          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12, fontWeight: 700 }}
                        />
                        <Area type="monotone" dataKey="gross" name={t('rpRevenueGross')} stroke={SERIES[0]} strokeWidth={2.5} fill="url(#rpGross)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                  <h2 className="text-sm font-black text-gray-900 mb-4">{t('rpOrdersByStatus')}</h2>
                  {data.byStatus.length === 0 ? (
                    <p className="text-xs font-bold text-gray-400 py-12 text-center">{t('rpNoSales')}</p>
                  ) : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          {/* The stage's own name in his language — the legend said "in_print". */}
                          <Pie
                            data={data.byStatus.map((row) => {
                              const key = knownStageLabelKey(row.key);
                              return { ...row, name: key ? t(key) : String(row.key) };
                            })}
                            dataKey="count"
                            nameKey="name"
                            innerRadius="55%"
                            outerRadius="80%"
                            paddingAngle={2}
                          >
                            {data.byStatus.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
                          </Pie>
                          <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
                          <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12, fontWeight: 700 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                  <h2 className="text-sm font-black text-gray-900 mb-4">{t('rpTopCustomers')}</h2>
                  {data.topCustomers.length === 0 ? (
                    <p className="text-xs font-bold text-gray-400 py-12 text-center">{t('rpNoSales')}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-[0.625rem] uppercase text-gray-400 font-black">
                          <tr><th className="text-left p-2">{t('rpCustomer')}</th><th className="text-right p-2">{t('rpOrders')}</th><th className="text-right p-2">{t('rpRevenueGross')}</th></tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {data.topCustomers.slice(0, 8).map((c) => (
                            <tr key={c.key}>
                              <td className="p-2 font-bold text-gray-800 truncate max-w-[12.5rem]">{c.name}</td>
                              <td className="p-2 text-right font-bold text-gray-600 tabular-nums">{c.orders}</td>
                              <td className="p-2 text-right font-black text-gray-900 tabular-nums">{money(c.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'products' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
                <h2 className="text-sm font-black text-gray-900 mb-4">{t('rpTopProducts')}</h2>
                {data.topProducts.length === 0 ? (
                  <p className="text-xs font-bold text-gray-400 py-12 text-center">{t('rpNoSales')}</p>
                ) : (
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.topProducts.slice(0, 10)} layout="vertical" margin={{ left: 20, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11, fill: '#4b5563' }} tickLine={false} axisLine={false} />
                        <Tooltip formatter={(v: any) => money(Number(v))} contentStyle={{ borderRadius: 12, fontSize: 12, fontWeight: 700 }} />
                        <Bar dataKey="revenue" name={t('rpRevenueNet')} fill={SERIES[1]} radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[0.625rem] uppercase text-gray-400 font-black">
                    <tr>
                      <th className="text-left p-3">{t('rpProduct')}</th>
                      <th className="text-right p-3">{t('rpUnitsSold')}</th>
                      <th className="text-right p-3">{t('rpOrders')}</th>
                      <th className="text-right p-3">{t('rpRevenueNet')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.topProducts.map((p) => (
                      <tr key={p.key} className="hover:bg-gray-50/60">
                        <td className="p-3 font-bold text-gray-800">{p.name}</td>
                        <td className="p-3 text-right font-bold text-gray-600 tabular-nums">{p.units}</td>
                        <td className="p-3 text-right font-bold text-gray-600 tabular-nums">{p.orders}</td>
                        <td className="p-3 text-right font-black text-gray-900 tabular-nums">{money(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'invoices' && (
            <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-sm font-black text-gray-900 mb-1 flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                {t('rpInvoiceList')}
              </h2>
              {/* Said plainly rather than implied: these numbers are derived from
                  the order id at print time, exactly as InvoiceModal derives
                  them. There is no separate invoice register with its own
                  sequence, and pretending otherwise would be a bookkeeping
                  problem, not a feature. */}
              <p className="text-[0.6875rem] font-bold text-gray-400 mb-4">{t('rpInvoiceNote')}</p>
              {data.invoices.length === 0 ? (
                <p className="text-xs font-bold text-gray-400 py-12 text-center">{t('rpNoSales')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-[0.625rem] uppercase text-gray-400 font-black">
                      <tr>
                        <th className="text-left p-3">{t('rpInvoiceNumber')}</th>
                        <th className="text-left p-3">{t('rpDate')}</th>
                        <th className="text-left p-3">{t('rpCustomer')}</th>
                        <th className="text-right p-3">{t('rpNet')}</th>
                        <th className="text-right p-3">{t('rpVat')}</th>
                        <th className="text-right p-3">{t('rpGross')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.invoices.map((i) => (
                        <tr
                          key={i.id}
                          onClick={() => void openInvoice(i.id)}
                          className="hover:bg-blue-50/60 cursor-pointer"
                          title={t('rpOpenInvoice')}
                        >
                          <td className="p-3 font-mono font-bold text-blue-700 underline decoration-dotted">
                            {openingInvoice === i.id ? '…' : i.number}
                          </td>
                          <td className="p-3 font-bold text-gray-600">{formatDate(i.createdAt, localeFor(language))}</td>
                          <td className="p-3 font-bold text-gray-800 truncate max-w-[13.75rem]">
                            {i.customerName || i.customerEmail || '—'}
                          </td>
                          <td className="p-3 text-right font-bold text-gray-600 tabular-nums">{money(i.net)}</td>
                          <td className="p-3 text-right font-bold text-gray-600 tabular-nums">{money(i.vat)}</td>
                          <td className="p-3 text-right font-black text-gray-900 tabular-nums">
                            {money(i.gross)}
                            {i.refunded > 0 && (
                              <span className="block text-[0.625rem] font-black text-red-600">
                                −{money(i.refunded)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <InvoiceModal
        isOpen={!!invoiceOrder}
        onClose={() => setInvoiceOrder(null)}
        order={invoiceOrder}
      />
    </div>
  );
}
