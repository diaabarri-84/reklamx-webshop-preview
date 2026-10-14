import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { BarChart3, Loader2, Pencil, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { auth } from '../../firebase';
import { useAuth } from '../../App';
import { localeFor } from '../../lib/dateFormat';
import { cn } from '../../lib/utils';
import { parseGoalAmount } from '../../lib/goalAmount';

/**
 * THE OVERVIEW'S INSIGHTS — client, 2026-10-07: "the dashboard is incomplete", with
 * a reference dashboard (Metabase's "E-commerce Insights"): the headline figures
 * against the period before, revenue and orders over time, a revenue goal, orders
 * by category and revenue by category.
 *
 * Every figure comes from /api/admin/reports — finished aggregates, cached five
 * minutes on the server — never from order documents read here: an order can be
 * hundreds of KB, and this project's free read quota has run out before. Two calls
 * for the period and the one before it (the same length, so "vs" is honest). The
 * goal's month and quarter are added up from the period's own days whenever it
 * covers them (the 12 months it opens on always does); only otherwise, and only
 * with a goal set, two slim reports — every report reads its orders, slim or not.
 */

type Totals = { paidOrders: number; grossRevenue: number; averageOrderValue: number; customers: number };
type Report = {
  totals: Totals;
  daily: { day: string; gross: number; orders: number }[];
  topProducts?: { key: string; name: string; revenue: number; units: number }[];
  categories?: {
    totals: { key: string; name: string; orders: number; revenue: number }[];
    monthly: { month: string; values: Record<string, number> }[];
  } | null;
};
type Period = 30 | 90 | 365;
/** The figures on screen, and the period they belong to. */
type Loaded = { period: Period; current: Report; previous: Report | null };

// The reference's palette: violets and pale blues, then the shop's own accents.
const COLORS = ['#6d64b8', '#a48fd6', '#9ec3e6', '#4f7fd6', '#e9a23b', '#2ea512', '#d9534f', '#3fb7c4'];
const MAX_SLICES = 6;

const pad = (n: number) => String(n).padStart(2, '0');
/** A calendar day in the browser's own zone (the server snaps to Swedish days). */
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  const resp = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((body as any)?.error || `Request failed (${resp.status}).`);
  return body as T;
}

export default function DashboardInsights({ onOpenReports }: { onOpenReports?: () => void }) {
  const { t, language } = useAuth();
  const locale = localeFor(language);
  const money = useCallback(
    (v: number) => `${Math.round(v).toLocaleString('sv-SE')} SEK`,
    [],
  );
  // An axis tick: 0, 600, 1 200 … then 12 tn / 1,2 mn, in his language — "k" of a
  // rounded thousand read "0k 1k 1k 2k 2k" under a new shop's first sales.
  const compact = useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }), [locale]);
  const percent = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);
  const [period, setPeriod] = useState<Period>(365);
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // His monthly goal: null until it has loaded.
  const [goal, setGoal] = useState<number | null>(null);
  const [goalFailed, setGoalFailed] = useState(false);
  const [sums, setSums] = useState<{ month: number; quarter: number } | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState('');
  const [goalError, setGoalError] = useState<string | null>(null);
  const [savingGoal, setSavingGoal] = useState(false);

  // ---- the period and the one before it ----
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    const now = new Date();
    now.setHours(12, 0, 0, 0);
    const from = new Date(now.getTime() - (period - 1) * 86_400_000);
    const prevTo = new Date(from.getTime() - 86_400_000);
    const prevFrom = new Date(prevTo.getTime() - (period - 1) * 86_400_000);
    Promise.all([
      getJson<Report>(`/api/admin/reports?from=${isoDay(from)}&to=${isoDay(now)}`),
      getJson<Report>(`/api/admin/reports?from=${isoDay(prevFrom)}&to=${isoDay(prevTo)}`).catch(() => null),
    ])
      .then(([cur, prev]) => {
        if (!alive) return;
        setData({ period, current: cur, previous: prev });
      })
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [period]);
  // What is on screen belongs to the period that is PRESSED: the one before it stayed
  // under the new button until the answer came (or for good, if it failed).
  const current = data?.period === period ? data.current : null;
  const previous = data?.period === period ? data.previous : null;

  // ---- the goal: this month and this quarter, against his monthly amount ----
  useEffect(() => {
    let alive = true;
    getJson<{ monthlyGoal: number }>('/api/admin/dashboard-goal')
      .then((g) => alive && setGoal(Number(g.monthlyGoal) || 0))
      // Said as a failure — "no goal set yet" over a goal that did not load would
      // invite him to type it again.
      .catch(() => alive && setGoalFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  const goalDays = useMemo(() => {
    const now = new Date();
    return {
      month: isoDay(new Date(now.getFullYear(), now.getMonth(), 1, 12)),
      quarter: isoDay(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1, 12)),
      today: isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)),
    };
  }, []);
  // From the period's own days, when they reach back to the quarter's first day.
  useEffect(() => {
    const daily = current?.daily ?? [];
    if (!daily.length || daily[0].day > goalDays.quarter) return;
    let month = 0;
    let quarter = 0;
    for (const row of daily) {
      if (row.day > goalDays.today) continue;
      if (row.day >= goalDays.quarter) quarter += Number(row.gross) || 0;
      if (row.day >= goalDays.month) month += Number(row.gross) || 0;
    }
    setSums({ month, quarter });
  }, [current, goalDays]);
  // Otherwise (a shorter period was the first to load), and only with a goal to measure.
  useEffect(() => {
    if (sums || loading || !(goal && goal > 0)) return;
    if ((current?.daily?.[0]?.day ?? '9999') <= goalDays.quarter) return;
    let alive = true;
    Promise.all([
      getJson<Report>(`/api/admin/reports?slim=1&from=${goalDays.month}&to=${goalDays.today}`),
      getJson<Report>(`/api/admin/reports?slim=1&from=${goalDays.quarter}&to=${goalDays.today}`),
    ])
      .then(([m, q]) => alive && setSums({ month: Number(m.totals?.grossRevenue) || 0, quarter: Number(q.totals?.grossRevenue) || 0 }))
      .catch(() => alive && setGoalFailed(true));
    return () => {
      alive = false;
    };
  }, [sums, loading, goal, current, goalDays]);

  // ---- revenue and orders over time: days (30), weeks (3 months), months (12) ----
  const series = useMemo(() => {
    const daily = current?.daily ?? [];
    const bucketOf = (day: string) => {
      if (period === 365) return day.slice(0, 7);
      if (period === 30) return day;
      const d = new Date(`${day}T12:00:00`);
      const monday = new Date(d.getTime() - ((d.getDay() + 6) % 7) * 86_400_000);
      return isoDay(monday);
    };
    const buckets = new Map<string, { revenue: number; orders: number }>();
    for (const row of daily) {
      const key = bucketOf(row.day);
      const b = buckets.get(key) ?? { revenue: 0, orders: 0 };
      b.revenue += Number(row.gross) || 0;
      b.orders += Number(row.orders) || 0;
      buckets.set(key, b);
    }
    return [...buckets.entries()].map(([key, v]) => ({
      key,
      label:
        period === 365
          ? new Date(`${key}-15T12:00:00`).toLocaleDateString(locale, { month: 'short', year: '2-digit' })
          : new Date(`${key}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' }),
      revenue: Math.round(v.revenue),
      orders: v.orders,
    }));
  }, [current, period, locale]);

  // ---- by category: the biggest few, the rest as "Other" ----
  const categories = useMemo(() => {
    const totals = current?.categories?.totals ?? [];
    // The orders with no category are "Other" too — one slice, not two of that name.
    const named = totals.filter((c) => c.key !== 'other');
    const top = named.slice(0, MAX_SLICES);
    const rest = [...named.slice(MAX_SLICES), ...totals.filter((c) => c.key === 'other')];
    const slices = top.map((c) => ({ key: c.key, name: c.name, orders: c.orders, revenue: c.revenue }));
    if (rest.length) {
      slices.push({
        key: '__rest',
        name: t('diOther'),
        orders: rest.reduce((s, c) => s + c.orders, 0),
        revenue: rest.reduce((s, c) => s + c.revenue, 0),
      });
    }
    const keys = slices.map((s) => s.key);
    const restKeys = new Set(rest.map((c) => c.key));
    const monthly = (current?.categories?.monthly ?? []).map((m) => {
      const row: Record<string, number | string> = {
        label: new Date(`${m.month}-15T12:00:00`).toLocaleDateString(locale, { month: 'short', year: '2-digit' }),
      };
      for (const k of keys) row[k] = 0;
      for (const [k, v] of Object.entries(m.values)) {
        const key = restKeys.has(k) ? '__rest' : k;
        if (key in row) row[key] = Math.round((Number(row[key]) || 0) + (Number(v) || 0));
      }
      return row;
    });
    return { slices, monthly, keys };
  }, [current, t, locale]);

  const delta = (cur: number, prev: number | undefined) => {
    if (!previous || prev === undefined || !(prev > 0)) return null;
    const pct = ((cur - prev) / prev) * 100;
    // One decimal where it says something (+4.5 %), none where it would not (+233 %).
    return Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  };
  const tiles = current
    ? [
        { key: 'revenue', label: t('diRevenue'), value: money(current.totals.grossRevenue), d: delta(current.totals.grossRevenue, previous?.totals.grossRevenue) },
        { key: 'orders', label: t('diOrders'), value: String(current.totals.paidOrders), d: delta(current.totals.paidOrders, previous?.totals.paidOrders) },
        { key: 'aov', label: t('diAov'), value: money(current.totals.averageOrderValue), d: delta(current.totals.averageOrderValue, previous?.totals.averageOrderValue) },
        { key: 'customers', label: t('diCustomers'), value: String(current.totals.customers), d: delta(current.totals.customers, previous?.totals.customers) },
      ]
    : [];
  const noSales = !!current && current.totals.paidOrders === 0;

  const goalBar = (label: string, amount: number, target: number, testId: string) => {
    const pct = target > 0 ? Math.min(100, Math.round((amount / target) * 100)) : 0;
    return (
      <div className="space-y-1.5" data-rx-goal={testId}>
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="font-black text-gray-700">{label}</span>
          <span className="font-bold text-gray-500 tabular-nums">{t('diGoalOf').replace('{0}', money(amount)).replace('{1}', money(target))}</span>
        </div>
        <div className="relative h-7 rounded-lg bg-[#cfe7c2] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="absolute inset-y-0 left-0 bg-[#7cc65a]" style={{ width: `${pct}%` }} />
          <span className="absolute inset-0 flex items-center px-2.5 text-[0.6875rem] font-black text-[#1f4d12] tabular-nums">{pct} %</span>
        </div>
      </div>
    );
  };

  return (
    <section className="space-y-5" data-rx-insights>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[#6d64b8]" />
          {t('diTitle')}
        </h3>
        <div className="flex items-center gap-2">
          <div className="inline-flex p-1 rounded-2xl bg-gray-100 border border-gray-200" role="group">
            {([30, 90, 365] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                aria-pressed={period === p}
                data-rx-insights-period={p}
                className={cn('px-3 py-1.5 rounded-xl text-xs font-black transition-colors', period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}
              >
                {p === 30 ? t('diPeriod30') : p === 90 ? t('diPeriod90') : t('diPeriod365')}
              </button>
            ))}
          </div>
          {onOpenReports && (
            <button type="button" onClick={onOpenReports} className="px-3 py-2 rounded-xl text-xs font-black text-blue-700 hover:bg-blue-50">
              {t('diAllReports')} →
            </button>
          )}
        </div>
      </div>

      {failed && <p className="text-sm font-bold text-red-700 bg-red-50 border border-red-200 rounded-2xl p-4">{t('diLoadFailed')}</p>}

      {/* The headline figures, each against the period before */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(loading && !current ? [0, 1, 2, 3] : tiles).map((tile: any, i: number) =>
          tile.key ? (
            <div key={tile.key} className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm" data-rx-insight-tile={tile.key}>
              <p className="text-xs font-bold text-gray-400">{tile.label}</p>
              <p className="text-2xl font-black text-gray-900 mt-1 tabular-nums">{tile.value}</p>
              {tile.d === null ? (
                <p className="text-[0.6875rem] font-bold text-gray-400 mt-1">{t('diNoPrevious')}</p>
              ) : (
                <p className={cn('text-[0.6875rem] font-black mt-1 flex items-center gap-1', tile.d >= 0 ? 'text-emerald-700' : 'text-red-600')}>
                  {tile.d >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                  {tile.d >= 0 ? '+' : ''}
                  {percent.format(tile.d)} % <span className="font-bold text-gray-400">{t('diVsPrevious')}</span>
                </p>
              )}
            </div>
          ) : (
            <div key={i} className="h-[6.5rem] bg-white rounded-3xl border border-gray-100 animate-pulse" />
          ),
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Revenue (line) and orders (bars) over time */}
        <div className="xl:col-span-2 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm" data-rx-insight-chart="over-time">
          <h4 className="text-sm font-black text-gray-900 mb-3">{t('diOverTime')}</h4>
          {noSales ? (
            <p className="text-sm font-bold text-gray-400 py-16 text-center">{t('diNoSales')}</p>
          ) : (
            <div className="h-[17.5rem] relative">
              {loading && !current && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
                </span>
              )}
              {series.length > 0 && (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} interval="preserveStartEnd" />
                    <YAxis yAxisId="orders" allowDecimals={false} tick={{ fontSize: 11, fill: '#6b7280' }} width={32} />
                    <YAxis yAxisId="revenue" orientation="right" tick={{ fontSize: 11, fill: '#6b7280' }} width={64} tickFormatter={(v) => compact.format(Number(v))} />
                    <Tooltip formatter={(v: any, name: any) => (name === t('diRevenue') ? money(Number(v)) : v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar yAxisId="orders" dataKey="orders" name={t('diOrders')} fill="#6d64b8" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="revenue" type="linear" dataKey="revenue" name={t('diRevenue')} stroke="#7cc65a" strokeWidth={2.5} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>

        {/* The goal: this month and this quarter */}
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-4" data-rx-insight-goal>
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-black text-gray-900 flex items-center gap-1.5">
              <Target className="w-4 h-4 text-[#2ea512]" />
              {t('diGoalTitle')}
            </h4>
            <button
              type="button"
              onClick={() => {
                setGoalInput(goal ? String(goal) : '');
                setGoalError(null);
                setEditingGoal((v) => !v);
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
              aria-label={t('diGoalChange')}
              title={t('diGoalChange')}
              data-rx-goal-edit
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
          {editingGoal && (
            <form
              className="flex items-end gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const amount = parseGoalAmount(goalInput);
                if (amount === null) {
                  setGoalError(t('diGoalBadNumber'));
                  return;
                }
                setSavingGoal(true);
                setGoalError(null);
                try {
                  const r = await getJson<{ monthlyGoal: number }>('/api/admin/dashboard-goal', { method: 'POST', body: JSON.stringify({ monthlyGoal: amount }) });
                  setGoal(Number(r.monthlyGoal) || 0);
                  setGoalFailed(false);
                  setEditingGoal(false);
                } catch {
                  // The field stays open with what he typed, and says it was not saved.
                  setGoalError(t('diGoalSaveFailed'));
                } finally {
                  setSavingGoal(false);
                }
              }}
            >
              <label className="flex-1 space-y-1">
                <span className="block text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{t('diGoalEdit')}</span>
                <input
                  value={goalInput}
                  onChange={(e) => {
                    setGoalInput(e.target.value);
                    setGoalError(null);
                  }}
                  inputMode="numeric"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold tabular-nums"
                  data-rx-goal-input
                />
              </label>
              <button type="submit" disabled={savingGoal} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-xs font-black disabled:opacity-50" data-rx-goal-save>
                {savingGoal ? <Loader2 className="w-4 h-4 animate-spin" /> : t('diGoalSave')}
              </button>
            </form>
          )}
          {goalError && (
            <p role="alert" className="text-xs font-bold text-red-700" data-rx-goal-error>
              {goalError}
            </p>
          )}
          {goalFailed && goal === null ? (
            <p className="text-xs font-bold text-red-700" data-rx-goal-failed>{t('diGoalLoadFailed')}</p>
          ) : goal === null ? (
            <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
          ) : goal > 0 ? (
            sums ? (
              <div className="space-y-4">
                {goalBar(t('diGoalMonth'), sums.month, goal, 'month')}
                {goalBar(t('diGoalQuarter'), sums.quarter, goal * 3, 'quarter')}
              </div>
            ) : goalFailed ? (
              <p className="text-xs font-bold text-red-700" data-rx-goal-failed>{t('diLoadFailed')}</p>
            ) : (
              <Loader2 className="w-4 h-4 text-gray-300 animate-spin" />
            )
          ) : (
            !editingGoal && <p className="text-xs font-bold text-gray-400">{t('diGoalNone')}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Orders by category */}
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm" data-rx-insight-chart="category-orders">
          <h4 className="text-sm font-black text-gray-900 mb-3">{t('diByCategoryOrders')}</h4>
          {categories.slices.length === 0 ? (
            <p className="text-sm font-bold text-gray-400 py-16 text-center">{t('diNoSales')}</p>
          ) : (
            <div className="h-[16.25rem]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categories.slices} dataKey="orders" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                    {categories.slices.map((s, i) => (
                      <Cell key={s.key} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Revenue by category, month by month */}
        <div className="xl:col-span-2 bg-white p-5 rounded-3xl border border-gray-100 shadow-sm" data-rx-insight-chart="category-revenue">
          <h4 className="text-sm font-black text-gray-900 mb-3">{t('diByCategoryRevenue')}</h4>
          {categories.slices.length === 0 ? (
            <p className="text-sm font-bold text-gray-400 py-16 text-center">{t('diNoSales')}</p>
          ) : (
            <div className="h-[16.25rem]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categories.monthly} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} width={56} tickFormatter={(v) => compact.format(Number(v))} />
                  <Tooltip formatter={(v: any) => money(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {categories.slices.map((s, i) => (
                    <Bar key={s.key} dataKey={s.key} name={s.name} stackId="cat" fill={COLORS[i % COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* The best sellers of the period */}
      {(current?.topProducts?.length ?? 0) > 0 && (
        <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm" data-rx-insight-top>
          <h4 className="text-sm font-black text-gray-900 mb-3">
            {t('diTopProducts')} <span className="font-bold text-gray-400">· {t('rpRevenueNet')}</span>
          </h4>
          <ol className="space-y-2">
            {current!.topProducts!.slice(0, 5).map((p, i, all) => {
              const max = Math.max(...all.map((x) => x.revenue), 1);
              return (
                <li key={p.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 text-xs">
                  <span className="font-black text-gray-400 tabular-nums">{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block font-black text-gray-800 truncate">{p.name}</span>
                    <span className="block h-1.5 mt-1 rounded-full bg-gray-100">
                      <span className="block h-1.5 rounded-full bg-[#a48fd6]" style={{ width: `${Math.max(4, Math.round((p.revenue / max) * 100))}%` }} />
                    </span>
                  </span>
                  <span className="font-black text-gray-700 tabular-nums">{money(p.revenue)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
