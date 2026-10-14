import React, { useCallback, useMemo, useState } from 'react';
import {
  Download, RefreshCw, CheckCircle2, AlertTriangle, Package, KeyRound,
  Search, Eye, EyeOff, Layers, Percent, Coins,
} from 'lucide-react';
import { auth } from '../../firebase';
import { useAuth } from '../../App';
import { cn } from '../../lib/utils';

/**
 * BULK IMPORT FROM THE SUPPLIER FEED.
 *
 * The owner is a trade customer of promediaplus.pl. Their feed carries 635
 * products; adding them by hand is 635 forms. This screen reads the feed through
 * the server (the supplier sends no CORS headers, so the browser cannot fetch it
 * at all), shows what is in it, and writes the products he chooses.
 *
 * THE SCREEN IS DELIBERATELY A FOUR-STEP FORM, not a "sync everything" button.
 * Three of the four decisions are about money or about where a product ends up
 * in the shop, and none of them can be guessed on his behalf:
 *
 *   1. the B2B login          — stored on the server, verified before saving
 *   2. the EUR → SEK rate     — the shop stores prices in SEK
 *   3. the margin             — the feed carries HIS trade price, not a retail one
 *   4. the category mapping   — the supplier's 20 categories onto the shop's own
 *
 * Everything arrives HIDDEN. Six hundred unreviewed products appearing in the
 * shop at once would be worse than no import.
 */

type Offer = {
  id: string; name: string; price: number; stock: number;
  category: string; subCategory: string; image: string | null;
  images: number; hasDescription: boolean; exists: boolean;
};
type Preview = {
  total: number; skipped: number; fetchedAt: number;
  categories: { name: string; count: number }[];
  shopCategories: { id: string; name: string }[];
  offers: Offer[];
};

// The server refuses more than this in one request, deliberately: the live host
// has a documented 502 problem and a ~29 second app spawn, and 635 products in
// one call would be cut off half-written.
const CHUNK = 25;

export default function SupplierImportAdmin() {
  const { t } = useAuth();

  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [savedUser, setSavedUser] = useState('');

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [rate, setRate] = useState<number | ''>('');
  const [margin, setMargin] = useState<number | ''>(40);
  const [maxImages, setMaxImages] = useState(4);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ written: number; unmapped: string[] } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishNote, setPublishNote] = useState<string | null>(null);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    const resp = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status}).`);
    return data;
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await call('/api/admin/supplier/status');
      setConfigured(Boolean(s.configured));
      setSavedUser(s.user ?? '');
    } catch {
      setConfigured(false);
    }
  }, [call]);

  React.useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const saveCredentials = async () => {
    setSavingCreds(true);
    setError(null);
    setNotice(null);
    try {
      await call('/api/admin/supplier/credentials', { method: 'POST', body: JSON.stringify({ user, pass }) });
      setNotice(t('siCredsSaved'));
      setPass('');
      await refreshStatus();
    } catch (err: any) {
      setError(err?.message ?? 'Could not save the login.');
    } finally {
      setSavingCreds(false);
    }
  };

  const loadPreview = async (refresh = false) => {
    setLoadingPreview(true);
    setError(null);
    setResult(null);
    try {
      const data: Preview = await call('/api/admin/supplier/preview', {
        method: 'POST', body: JSON.stringify({ refresh }),
      });
      setPreview(data);
      // Nothing is selected by default. Six hundred ticked boxes is not a
      // choice the owner made.
      setSelected(new Set());
    } catch (err: any) {
      setError(err?.message ?? 'Could not read the feed.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const visible = useMemo(() => {
    if (!preview) return [];
    const q = search.trim().toLowerCase();
    return preview.offers.filter(
      (o) => !q || o.name.toLowerCase().includes(q) || o.category.toLowerCase().includes(q),
    );
  }, [preview, search]);

  // A product cannot be imported until its supplier category has been pointed at
  // one of the shop's own. Shown as a count rather than discovered on failure.
  const unmappedSelected = useMemo(() => {
    if (!preview) return [];
    return [...selected]
      .map((id) => preview.offers.find((o) => o.id === id))
      .filter((o): o is Offer => Boolean(o) && !categoryMap[o!.category]);
  }, [selected, preview, categoryMap]);

  const readyToImport =
    Boolean(preview) && selected.size > 0
    && rate !== '' && Number(rate) > 0
    // margin !== '' matters: Number('') is 0 and 0 >= 0, so an EMPTY box passed
    // this guard and priced all 635 products at his own trade cost.
    && margin !== '' && Number(margin) >= 0
    && unmappedSelected.length === 0 && !importing;

  const runImport = async () => {
    if (!preview) return;
    setImporting(true);
    setError(null);
    setResult(null);
    const ids = [...selected];
    setProgress({ done: 0, total: ids.length });
    let written = 0;
    const unmapped: string[] = [];
    try {
      // ONE REQUEST PER CHUNK, sequentially. Not in parallel: the point of the
      // chunking is to stay inside the host's proxy timeout, and firing 25
      // requests at once would put it straight back over.
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const res = await call('/api/admin/supplier/import', {
          method: 'POST',
          body: JSON.stringify({
            offerIds: slice,
            rate: Number(rate),
            marginPercent: Number(margin),
            categoryMap,
            maxImages,
            hidden: true,
          }),
        });
        written += Number(res.written) || 0;
        if (Array.isArray(res.unmapped)) unmapped.push(...res.unmapped);
        setProgress({ done: Math.min(i + CHUNK, ids.length), total: ids.length });
      }
      setResult({ written, unmapped });
      setSelected(new Set());
      // Re-read, so the "already in the shop" marks are correct if he imports again.
      await loadPreview(false);
    } catch (err: any) {
      // Say how far it got. A half-finished import is resumable — the ids are
      // deterministic, so re-running skips nothing and duplicates nothing.
      setError(`${err?.message ?? 'The import stopped.'} ${written} product(s) were written before it stopped.`);
    } finally {
      setImporting(false);
    }
  };

  const bulkPublish = async (hidden: boolean) => {
    setPublishing(true);
    setPublishNote(null);
    setError(null);
    try {
      const res = await call('/api/admin/supplier/publish', { method: 'POST', body: JSON.stringify({ hidden }) });
      setPublishNote(
        (hidden ? t('siHidden') : t('siPublished')).replace('{0}', String(res.changed ?? 0)),
      );
    } catch (err: any) {
      setError(err?.message ?? 'Could not change those products.');
    } finally {
      setPublishing(false);
    }
  };

  const label = 'block text-xs font-extrabold text-gray-700 mb-1';
  const input = 'w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none';
  const card = 'bg-white p-6 rounded-3xl border border-gray-100 shadow-sm';

  return (
    <div className="space-y-6">
      <div className={card}>
        <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
          <Download className="w-6 h-6 text-blue-600" />
          {t('siTitle')}
        </h1>
        <p className="text-xs font-bold text-gray-400 mt-1">{t('siSubtitle')}</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-2xl text-xs font-bold flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl text-xs font-bold">{notice}</div>
      )}

      {/* 1 — the login */}
      <div className={card}>
        <h2 className="text-sm font-black text-gray-900 flex items-center gap-2 mb-1">
          <KeyRound className="w-4 h-4 text-gray-400" />
          {t('siStep1')}
        </h2>
        <p className="text-[0.6875rem] font-bold text-gray-400 mb-4">{t('siStep1Note')}</p>

        {configured && (
          <p className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mb-4 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" />
            {t('siCredsStored').replace('{0}', savedUser)}
          </p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className={label}>{t('siUsername')}</label>
            <input className={input} value={user} onChange={(e) => setUser(e.target.value)} placeholder="info@reklamx.se" />
          </div>
          <div>
            <label className={label}>{t('siPassword')}</label>
            <div className="relative">
              <input
                className={input}
                type={showPass ? 'text' : 'password'}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
                aria-label={showPass ? 'Hide' : 'Show'}
              >
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={saveCredentials}
            disabled={savingCreds || !user || !pass}
            className="px-5 py-2.5 rounded-2xl text-xs font-black bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
          >
            {savingCreds ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {t('siVerifyAndSave')}
          </button>
        </div>
      </div>

      {/* 2 — read the feed */}
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-gray-900 flex items-center gap-2">
              <Package className="w-4 h-4 text-gray-400" />
              {t('siStep2')}
            </h2>
            <p className="text-[0.6875rem] font-bold text-gray-400 mt-1">{t('siStep2Note')}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void loadPreview(false)}
              disabled={loadingPreview || configured === false}
              className="px-4 py-2.5 rounded-2xl text-xs font-black bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              {loadingPreview ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t('siReadFeed')}
            </button>
            {preview && (
              <button
                type="button"
                onClick={() => void loadPreview(true)}
                disabled={loadingPreview}
                className="px-4 py-2.5 rounded-2xl text-xs font-black bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 cursor-pointer"
              >
                {t('siRefetch')}
              </button>
            )}
          </div>
        </div>

        {preview && (
          <p className="text-xs font-bold text-gray-600 mt-4">
            {t('siFoundProducts').replace('{0}', String(preview.total)).replace('{1}', String(preview.categories.length))}
            {preview.skipped > 0 && ` · ${t('siSkipped').replace('{0}', String(preview.skipped))}`}
          </p>
        )}
      </div>

      {preview && (
        <>
          {/* 3 — money and categories */}
          <div className={card}>
            <h2 className="text-sm font-black text-gray-900 flex items-center gap-2 mb-1">
              <Coins className="w-4 h-4 text-gray-400" />
              {t('siStep3')}
            </h2>
            <p className="text-[0.6875rem] font-bold text-gray-400 mb-4">{t('siStep3Note')}</p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className={label}>{t('siRate')}</label>
                <input
                  className={input}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="11.50"
                  value={rate}
                  onChange={(e) => setRate(e.target.value === '' ? '' : Number(e.target.value))}
                />
                <p className="text-[0.6875rem] font-bold text-gray-400 mt-1.5">{t('siRateNote')}</p>
              </div>
              <div>
                <label className={label}>{t('siMargin')}</label>
                <input
                  className={input}
                  type="number"
                  min="0"
                  value={margin}
                  onChange={(e) => setMargin(e.target.value === '' ? '' : Number(e.target.value))}
                />
                <p className="text-[0.6875rem] font-bold text-gray-400 mt-1.5">{t('siMarginNote')}</p>
              </div>
              <div>
                <label className={label}>{t('siMaxImages')}</label>
                <input
                  className={input}
                  type="number"
                  min="1"
                  max="10"
                  value={maxImages}
                  onChange={(e) => setMaxImages(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                />
                <p className="text-[0.6875rem] font-bold text-gray-400 mt-1.5">{t('siMaxImagesNote')}</p>
              </div>
            </div>

            {/* A worked example, live. An owner who types 11.5 and 40 should not
                have to trust the arithmetic — he should see it on a product he
                recognises. */}
            {Number(rate) > 0 && Number(margin) >= 0 && preview.offers[0] && (
              <p className="text-xs font-black text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2 mt-4">
                {t('siPriceExample')
                  .replace('{0}', preview.offers[0].name)
                  .replace('{1}', String(preview.offers[0].price))
                  .replace('{2}', String(Math.round(preview.offers[0].price * Number(rate) * (1 + Number(margin) / 100))))}
              </p>
            )}

            <h3 className="text-xs font-black text-gray-700 mt-6 mb-2 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-gray-400" />
              {t('siCategoryMapping')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {preview.categories.map((c) => (
                <div key={c.name} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
                  <span className="text-xs font-bold text-gray-800 flex-1 truncate">
                    {c.name} <span className="text-gray-400">({c.count})</span>
                  </span>
                  <select
                    value={categoryMap[c.name] ?? ''}
                    onChange={(e) => setCategoryMap((m) => ({ ...m, [c.name]: e.target.value }))}
                    className="text-xs font-bold text-gray-900 bg-white border border-gray-200 rounded-lg px-2 py-1.5 max-w-[45%]"
                  >
                    <option value="">{t('siNotImported')}</option>
                    {preview.shopCategories.map((sc) => (
                      <option key={sc.id} value={sc.id}>{sc.name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* 4 — choose and import */}
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <h2 className="text-sm font-black text-gray-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-gray-400" />
                {t('siStep4').replace('{0}', String(selected.size))}
              </h2>
              <div className="flex flex-wrap gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('siSearch')}
                    className="pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(new Set(visible.filter((o) => categoryMap[o.category]).map((o) => o.id)))}
                  className="px-3 py-2 rounded-xl text-xs font-black bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer"
                >
                  {t('siSelectMappedShown')}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="px-3 py-2 rounded-xl text-xs font-black bg-gray-100 text-gray-700 hover:bg-gray-200 cursor-pointer"
                >
                  {t('siClear')}
                </button>
              </div>
            </div>

            {unmappedSelected.length > 0 && (
              <p className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                {t('siUnmappedSelected').replace('{0}', String(unmappedSelected.length))}
              </p>
            )}

            <div className="border border-gray-200 rounded-2xl overflow-hidden">
              <div className="max-h-[28rem] overflow-y-auto divide-y divide-gray-100">
                {visible.slice(0, 400).map((o) => {
                  const mapped = Boolean(categoryMap[o.category]);
                  return (
                    <label
                      key={o.id}
                      className={cn(
                        'flex items-center gap-3 p-2.5 cursor-pointer hover:bg-blue-50/40',
                        !mapped && 'opacity-60',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(o.id); else next.delete(o.id);
                            return next;
                          })
                        }
                        className="w-4 h-4 rounded accent-blue-600 cursor-pointer shrink-0"
                      />
                      {o.image && (
                        <img src={o.image} alt="" className="w-9 h-9 rounded-lg object-contain bg-white border border-gray-200 shrink-0" loading="lazy" />
                      )}
                      <span className="text-xs font-bold text-gray-800 flex-1 truncate">{o.name}</span>
                      <span className="text-[0.625rem] font-bold text-gray-400 shrink-0 hidden sm:inline">{o.category}</span>
                      <span className="text-[0.625rem] font-black text-gray-600 shrink-0 tabular-nums">{o.price} €</span>
                      {o.exists && (
                        <span className="text-[0.5625rem] font-black text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded shrink-0">
                          {t('siAlreadyHere')}
                        </span>
                      )}
                      {!mapped && (
                        <span className="text-[0.5625rem] font-black text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">
                          {t('siNoCategory')}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              {visible.length > 400 && (
                <p className="p-2 text-[0.6875rem] font-bold text-gray-400 bg-gray-50 border-t border-gray-200">
                  {t('siShowingFirst').replace('{0}', '400').replace('{1}', String(visible.length))}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
              <p className="text-[0.6875rem] font-bold text-gray-400">{t('siHiddenNote')}</p>
              <button
                type="button"
                onClick={runImport}
                disabled={!readyToImport}
                className="px-6 py-3 rounded-2xl text-xs font-black bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 cursor-pointer flex items-center gap-2"
              >
                {importing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {t('siImportSelected').replace('{0}', String(selected.size))}
              </button>
            </div>

            {progress && importing && (
              <div className="mt-4">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all"
                    style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
                  />
                </div>
                <p className="text-[0.6875rem] font-black text-gray-500 mt-1.5">
                  {t('siProgress').replace('{0}', String(progress.done)).replace('{1}', String(progress.total))}
                </p>
              </div>
            )}

            {result && (
              <div className="mt-4 bg-emerald-50 border border-emerald-200 text-emerald-800 p-4 rounded-2xl text-xs font-bold space-y-2">
                <p className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  {t('siImported').replace('{0}', String(result.written))}
                </p>
                {/* He asked to add the products "all at once". Landing them
                    hidden is right — six hundred unreviewed rows must not appear
                    in the shop by themselves — but it is only reasonable if he
                    can publish them together too. */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void bulkPublish(false)}
                    disabled={publishing}
                    className="px-4 py-2 rounded-xl text-xs font-black bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    {publishing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    {t('siPublishAll')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void bulkPublish(true)}
                    disabled={publishing}
                    className="px-4 py-2 rounded-xl text-xs font-black bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    {t('siHideAll')}
                  </button>
                </div>
                {publishNote && <p className="text-emerald-900">{publishNote}</p>}
                {result.unmapped.length > 0 && (
                  <p className="text-amber-800">
                    {t('siUnmappedSkipped').replace('{0}', String(result.unmapped.length))}
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
