import React, { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AlertTriangle, Building2, Home, Loader2, Plus, Save, Trash2, Truck, Zap } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../App';
import SortableList, { DragHandle } from './SortableList';
import { cn } from '../../lib/utils';
import { toCountryCode } from '../../lib/vatRegime';
import type { TranslationKey } from '../../lib/translations';
import {
  SHIP_LANGS,
  cleanPrice,
  countryLabel,
  methodName,
  normaliseShipping,
  shippingOptions,
  shippingSaveProblems,
  type Localised,
  type ShippingMethodId,
  type ShippingSettings,
} from '../../lib/shipping';

/**
 * SHIPPING — "there is no place to edit shipping prices and countries" (the
 * client's item 2). Prices per country for the delivered methods, one fee for
 * pickup, the countries themselves, and the order of both, by dragging.
 *
 * Writes ONLY `printSettings.shipping` (mergeFields), so nothing else in that
 * document — VAT, loyalty, print rules — can be touched by a save here. What
 * it writes is read by the checkout (the country list), by the server on every
 * quote (the menu and the fee) and by the Google feed; src/lib/shipping.ts is
 * the one set of rules all three use.
 */

interface RowCountry {
  /** Stable row id for dragging — not the code, which can still be typed on a new row. */
  key: string;
  code: string;
  name: string;
  enabled: boolean;
  /** Saved once: the code keys the prices, so it is fixed from then on. */
  locked: boolean;
}
interface RowMethod {
  id: ShippingMethodId;
  enabled: boolean;
  name: Localised;
  note: Localised;
  /** By ROW key, as typed. Blank = not offered there. */
  prices: Record<string, string>;
  fee: string;
}
interface Draft {
  homeCountry: string; // a row key
  countries: RowCountry[];
  methods: RowMethod[];
}

let rowSeq = 0;
const newKey = () => `c${Date.now().toString(36)}${(rowSeq++).toString(36)}`;
const money = (n: number) => n.toFixed(2);
/** Typed, and not a price the shop can read — the cell is marked, not just a message at the bottom. */
const unreadable = (text: string | undefined) => String(text ?? '').trim() !== '' && cleanPrice(text) === null;

function toDraft(s: ShippingSettings): Draft {
  const countries = s.countries.map((c) => ({ key: newKey(), code: c.code, name: c.name, enabled: c.enabled, locked: true }));
  const keyOf = new Map(countries.map((c) => [c.code, c.key]));
  return {
    homeCountry: keyOf.get(s.homeCountry) ?? countries[0]?.key ?? '',
    countries,
    methods: s.methods.map((m) => ({
      id: m.id,
      enabled: m.enabled,
      name: { ...m.name },
      note: { ...m.note },
      prices: Object.fromEntries(
        Object.entries(m.prices).flatMap(([code, v]) => (keyOf.has(code) ? [[keyOf.get(code)!, String(v)]] : [])),
      ),
      fee: m.fee === null ? '' : String(m.fee),
    })),
  };
}

/** The draft as it would be stored. Unreadable numbers become NaN so the checks name them. */
function fromDraft(d: Draft): ShippingSettings {
  const codeOf = new Map(d.countries.map((c) => [c.key, c.code.trim().toUpperCase()]));
  const tidy = (t: Localised): Localised =>
    Object.fromEntries(Object.entries(t).flatMap(([k, v]) => (String(v ?? '').trim() ? [[k, String(v).trim()]] : [])));
  return {
    homeCountry: codeOf.get(d.homeCountry) ?? '',
    countries: d.countries.map((c) => ({ code: c.code.trim().toUpperCase(), name: c.name.trim(), enabled: c.enabled })),
    methods: d.methods.map((m) => ({
      id: m.id,
      enabled: m.enabled,
      name: tidy(m.name),
      note: tidy(m.note),
      prices:
        m.id === 'pickup'
          ? {}
          : Object.fromEntries(
              Object.entries(m.prices).flatMap(([key, v]) =>
                String(v).trim() === '' || !codeOf.has(key) ? [] : [[codeOf.get(key)!, cleanPrice(v) ?? NaN]],
              ),
            ),
      fee: m.id === 'pickup' ? (String(m.fee).trim() === '' ? null : (cleanPrice(m.fee) ?? NaN)) : null,
    })),
  };
}

const METHOD_ICON: Record<ShippingMethodId, React.ReactNode> = {
  standard: <Truck className="w-4 h-4" />,
  express: <Zap className="w-4 h-4" />,
  pickup: <Building2 className="w-4 h-4" />,
};
const inputCls =
  'px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function ShippingAdmin() {
  const { t, language, refreshShipping } = useAuth();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [previewKey, setPreviewKey] = useState('');

  useEffect(() => {
    let cancelled = false;
    getDoc(doc(db, 'settings', 'printSettings'))
      .then((snap) => {
        if (cancelled) return;
        const d = toDraft(normaliseShipping(snap.exists() ? snap.data()?.shipping : undefined));
        setDraft(d);
        setPreviewKey(d.homeCountry);
      })
      .catch((err) => {
        console.warn('Could not load the shipping settings:', err);
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const built = useMemo(() => (draft ? fromDraft(draft) : null), [draft]);
  const sellable = useMemo(() => (built ? normaliseShipping(built) : null), [built]);

  if (loadError) {
    return <p className="p-6 text-xs font-bold text-red-600">{t('shipLoadFailed')}</p>;
  }
  if (!draft || !built || !sellable) {
    return (
      <p className="p-6 text-xs font-bold text-gray-400 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> {t('rpLoading')}
      </p>
    );
  }

  const edit = (fn: (d: Draft) => Draft) => {
    setStatus(null);
    setDraft((d) => (d ? fn(d) : d));
  };
  const editCountry = (key: string, patch: Partial<RowCountry>) =>
    edit((d) => ({ ...d, countries: d.countries.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const editMethod = (id: ShippingMethodId, patch: Partial<RowMethod>) =>
    edit((d) => ({ ...d, methods: d.methods.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const addCountry = () =>
    edit((d) => ({ ...d, countries: [...d.countries, { key: newKey(), code: '', name: '', enabled: true, locked: false }] }));
  const removeCountry = (key: string) =>
    edit((d) => ({
      ...d,
      countries: d.countries.filter((c) => c.key !== key),
      // Its prices go with it — they must not be found again by a country
      // added later under the same code.
      methods: d.methods.map((m) => {
        const prices = { ...m.prices };
        delete prices[key];
        return { ...m, prices };
      }),
    }));

  const save = async () => {
    const found = shippingSaveProblems(built);
    setProblems(found);
    if (found.length > 0) return;
    setSaving(true);
    setStatus(null);
    try {
      const stored: ShippingSettings = {
        ...built,
        methods: built.methods.map((m) => ({ ...m, fee: m.id === 'pickup' && Number.isFinite(m.fee) ? m.fee : null })),
      };
      // mergeFields: replaces `shipping` as a whole (a deep merge would keep a
      // price he cleared) and leaves every other field of the document alone.
      await setDoc(doc(db, 'settings', 'printSettings'), { shipping: stored }, { mergeFields: ['shipping'] });
      // This visit's copy (the checkout lists, the Google tab) follows at once.
      refreshShipping(normaliseShipping(stored));
      setDraft((d) => (d ? { ...d, countries: d.countries.map((c) => ({ ...c, code: c.code.trim().toUpperCase(), name: c.name.trim(), locked: true })) } : d));
      setStatus({ kind: 'ok', text: t('shipSaved') });
    } catch (err) {
      console.error('Saving the shipping settings failed:', err);
      setStatus({ kind: 'error', text: t('shipSaveFailed') });
    } finally {
      setSaving(false);
    }
  };

  const deliveryMethods = draft.methods.filter((m) => m.id !== 'pickup');
  const pickup = draft.methods.find((m) => m.id === 'pickup')!;
  const previewCode = draft.countries.find((c) => c.key === previewKey)?.code.trim().toUpperCase() ?? '';
  const preview = shippingOptions(sellable, previewCode);

  return (
    <div className="space-y-6" data-rx-shipping-admin>
      <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
        <h2 className="text-lg font-black text-gray-900">{t('shipTitle')}</h2>
        <p className="text-xs font-bold text-gray-500 mt-1">{t('shipSubtitle')}</p>
      </div>

      {/* ---- countries ---- */}
      <section className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-black text-gray-900">{t('shipCountriesTitle')}</h3>
          <p className="text-[0.6875rem] font-bold text-gray-500 mt-1">{t('shipCountriesHelp')}</p>
        </div>
        <SortableList
          ids={draft.countries.map((c) => c.key)}
          onReorder={(keys) => edit((d) => ({ ...d, countries: keys.map((k) => d.countries.find((c) => c.key === k)!).filter(Boolean) }))}
          className="space-y-2"
          renderItem={(key, { handle }) => {
            const c = draft.countries.find((x) => x.key === key)!;
            const code = c.code.trim().toUpperCase();
            const taxKnown = !code || toCountryCode(code) !== null;
            return (
              <div data-ship-country={code || 'new'} className={cn('rounded-2xl border p-2.5 space-y-1.5', c.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50')}>
                <div className="flex flex-wrap items-center gap-2">
                  <DragHandle handle={handle} label={t('shipDrag').replace('{0}', c.name || code || '—')} />
                  <input
                    value={c.code}
                    disabled={c.locked}
                    maxLength={2}
                    onChange={(e) => editCountry(key, { code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
                    aria-label={t('shipCountryCode')}
                    placeholder="NL"
                    className={cn(inputCls, 'w-14 font-mono uppercase text-center disabled:bg-gray-100 disabled:text-gray-600')}
                  />
                  <input
                    value={c.name}
                    onChange={(e) => editCountry(key, { name: e.target.value })}
                    aria-label={t('shipCountryName')}
                    placeholder={t('shipCountryName')}
                    className={cn(inputCls, 'flex-1 min-w-[8.75rem]')}
                  />
                  {code && <span className="text-[0.6875rem] font-bold text-gray-400">{countryLabel({ code, name: c.name, enabled: c.enabled }, language)}</span>}
                  <label className="flex items-center gap-1.5 text-[0.6875rem] font-black text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={c.enabled}
                      onChange={(e) => editCountry(key, { enabled: e.target.checked })}
                      aria-label={`${t('shipCountryOn')} — ${c.name || code}`}
                    />
                    {t('shipCountryOn')}
                  </label>
                  <label className="flex items-center gap-1.5 text-[0.6875rem] font-black text-gray-600 cursor-pointer">
                    <input
                      type="radio"
                      name="ship-home"
                      checked={draft.homeCountry === key}
                      onChange={() => edit((d) => ({ ...d, homeCountry: key }))}
                      aria-label={`${t('shipHome')} — ${c.name || code}`}
                    />
                    <Home className="w-3.5 h-3.5" />
                    {t('shipHome')}
                  </label>
                  <button
                    type="button"
                    onClick={() => removeCountry(key)}
                    disabled={draft.homeCountry === key}
                    title={t('shipRemoveCountry')}
                    aria-label={`${t('shipRemoveCountry')} ${c.name || code}`}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {!taxKnown && (
                  <p className="text-[0.625rem] font-bold text-amber-700 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> {t('shipNotInTaxTable')}
                  </p>
                )}
              </div>
            );
          }}
        />
        <button type="button" onClick={addCountry} className="px-3 py-2 rounded-xl border border-dashed border-gray-300 text-xs font-black text-gray-600 hover:border-blue-400 hover:text-blue-700 inline-flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> {t('shipAddCountry')}
        </button>
      </section>

      {/* ---- prices: one row per country, one column per delivered method ---- */}
      <section className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-black text-gray-900">{t('shipPricesTitle')}</h3>
          <p className="text-[0.6875rem] font-bold text-gray-500 mt-1">{t('shipPricesHelp')}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs" data-ship-prices>
            <thead>
              <tr className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">
                <th className="text-left pr-4 py-1.5" />
                {deliveryMethods.map((m) => (
                  <th key={m.id} className="text-left pr-4 py-1.5">{methodName(m, language)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {draft.countries.map((c) => (
                <tr key={c.key} className={cn(!c.enabled && 'opacity-50')}>
                  <td className="pr-4 py-1 font-black text-gray-800 whitespace-nowrap">
                    {c.name || c.code || '—'}
                    {!c.enabled && <span className="ml-1 text-[0.625rem] font-bold text-gray-400">({t('shipOffLabel')})</span>}
                  </td>
                  {deliveryMethods.map((m) => (
                    <td key={m.id} className="pr-4 py-1">
                      <input
                        value={m.prices[c.key] ?? ''}
                        inputMode="decimal"
                        placeholder="—"
                        aria-label={`${methodName(m, language)} — ${c.name || c.code}`}
                        data-ship-price={`${m.id}:${c.code.trim().toUpperCase()}`}
                        onChange={(e) => editMethod(m.id, { prices: { ...m.prices, [c.key]: e.target.value } })}
                        aria-invalid={unreadable(m.prices[c.key])}
                        className={cn(inputCls, 'w-24 text-right tabular-nums', unreadable(m.prices[c.key]) && 'border-red-400 bg-red-50')}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---- the three methods: on/off, names, order ---- */}
      <section className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-black text-gray-900">{t('shipMethodsTitle')}</h3>
          <p className="text-[0.6875rem] font-bold text-gray-500 mt-1">{t('shipMethodsHelp')}</p>
        </div>
        <SortableList
          ids={draft.methods.map((m) => m.id)}
          onReorder={(ids) => edit((d) => ({ ...d, methods: ids.map((id) => d.methods.find((m) => m.id === id)!).filter(Boolean) }))}
          className="space-y-3"
          renderItem={(id, { handle }) => {
            const m = draft.methods.find((x) => x.id === id)!;
            return (
              <div data-ship-method={m.id} className={cn('rounded-2xl border p-3 space-y-2.5', m.enabled ? 'border-gray-200' : 'border-gray-100 bg-gray-50')}>
                <div className="flex flex-wrap items-center gap-2">
                  <DragHandle handle={handle} label={t('shipDrag').replace('{0}', methodName(m, language))} />
                  <span className="w-7 h-7 rounded-lg bg-gray-900 text-white flex items-center justify-center">{METHOD_ICON[m.id]}</span>
                  <span className="font-black text-sm text-gray-900">{methodName(m, language)}</span>
                  <label className="ml-auto flex items-center gap-1.5 text-[0.6875rem] font-black text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={m.enabled} onChange={(e) => editMethod(m.id, { enabled: e.target.checked })} />
                    {t('shipMethodOn')}
                  </label>
                </div>
                <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-x-2 gap-y-1 items-center">
                  <span />
                  <span className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{t('shipName')}</span>
                  <span className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400">{t('shipNote')}</span>
                  {SHIP_LANGS.map((lang) => (
                    <React.Fragment key={lang}>
                      <span className="text-[0.625rem] font-black uppercase text-gray-500">{lang}</span>
                      <input
                        value={m.name[lang] ?? ''}
                        onChange={(e) => editMethod(m.id, { name: { ...m.name, [lang]: e.target.value } })}
                        aria-label={`${t('shipName')} (${lang})`}
                        className={inputCls}
                      />
                      <input
                        value={m.note[lang] ?? ''}
                        onChange={(e) => editMethod(m.id, { note: { ...m.note, [lang]: e.target.value } })}
                        aria-label={`${t('shipNote')} (${lang})`}
                        className={inputCls}
                      />
                    </React.Fragment>
                  ))}
                </div>
                {m.id === 'pickup' && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <label className="text-[0.6875rem] font-black text-gray-600">{t('shipPickupFee')}</label>
                    <input
                      value={pickup.fee}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={t('shipPickupFee')}
                      onChange={(e) => editMethod('pickup', { fee: e.target.value })}
                      aria-invalid={unreadable(pickup.fee)}
                      className={cn(inputCls, 'w-24 text-right tabular-nums', unreadable(pickup.fee) && 'border-red-400 bg-red-50')}
                    />
                    <p className="w-full text-[0.625rem] font-bold text-gray-400">{t('shipPickupWhere')}</p>
                  </div>
                )}
              </div>
            );
          }}
        />
      </section>

      {/* ---- what a customer sees ---- */}
      <section className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-3">
        <h3 className="text-sm font-black text-gray-900">{t('shipPreviewTitle')}</h3>
        <label className="flex items-center gap-2 text-[0.6875rem] font-black text-gray-600">
          {t('shipPreviewIn')}
          <select value={previewKey} onChange={(e) => setPreviewKey(e.target.value)} className={inputCls} aria-label={t('shipPreviewIn')}>
            {draft.countries.map((c) => (
              <option key={c.key} value={c.key}>{c.name || c.code}</option>
            ))}
          </select>
        </label>
        <ul data-ship-preview className="space-y-1">
          {preview.map((o) => (
            <li key={o.id} className="flex items-center gap-2 text-xs font-bold text-gray-800">
              <span className="text-gray-400">{METHOD_ICON[o.id]}</span>
              <span className="flex-1">{methodName(o, language)}</span>
              <span className="tabular-nums">{o.fee === 0 ? t('shipFree') : `${money(o.fee)} kr`}</span>
            </li>
          ))}
        </ul>
        {!preview.some((o) => o.id !== 'pickup') && (
          <p className="text-[0.6875rem] font-bold text-amber-700">{t('shipPreviewNothing')}</p>
        )}
      </section>

      {problems.length > 0 && (
        <ul role="alert" className="p-3 rounded-2xl bg-red-50 border border-red-200 space-y-1">
          {problems.map((p) => (
            <li key={p} className="text-xs font-bold text-red-700">{t(p as TranslationKey)}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-5 py-2.5 rounded-2xl bg-gray-900 text-white text-xs font-black hover:bg-black disabled:opacity-60 inline-flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? t('shipSaving') : t('shipSave')}
        </button>
        {status && (
          <span role="status" className={cn('text-xs font-black', status.kind === 'ok' ? 'text-emerald-700' : 'text-red-700')}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
