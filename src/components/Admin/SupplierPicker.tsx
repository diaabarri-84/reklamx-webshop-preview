// "انا اقدر اختار المنتج الي اريده" — he browses, and imports only what he picks.
//
// The existing supplier screen imports a whole feed in one go, with a category
// mapping decided up front. He asked for the other thing: look through the
// supplier's catalogue, filter it down, tick the products he wants, import those.
//
// What it reads is `supplierIndex` through an admin endpoint — 364 bytes per
// product, 21.6 KB for a page of sixty — never the 13 MB feed. What it writes it
// does not write itself: Import posts the ticked keys and the server fetches the
// feed fresh, so the price that lands on a product is the price at that moment
// and not whenever the index was last built.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Download, RefreshCw, Loader2, Check, X, AlertTriangle, PackageSearch } from 'lucide-react';
import { useAuth } from '../../App';
import { cn } from '../../lib/utils';
import { auth } from '../../firebase';
import type { Category } from '../../types';
import { categoryPickList } from '../../lib/categoryTree';
import { BAR_FIELD } from './darkBar';
import { SUPPLIER_SORTS, cleanSort, decodeEntities, displayName, foldText, type SupplierSort } from '../../lib/suppliers/supplierSearch';
import type { TranslationKey } from '../../lib/translations';

/** The owner's last choice of order, on this browser. */
const SORT_KEY = 'rx.supplierPicker.sort';
const SORT_LABEL: Record<SupplierSort, TranslationKey> = {
  category: 'spSortCategory',
  name: 'spSortName',
  'price-asc': 'spSortPriceLow',
  'price-desc': 'spSortPriceHigh',
  stock: 'spSortStock',
};

interface IndexRow {
  productKey: string;
  name: string;
  nameSv?: string | null;
  categoryPath: string[];
  sourcePrice: number | null;
  sourceCurrency: string;
  image: string | null;
  variantCount: number;
  stock: number | null;
}

/**
 * The suppliers this screen can browse — 3.7.
 *
 * It was a constant, `'easygifts'`, because there was one adapter. Pro Media Plus
 * is on the same model now and reaches the same three endpoints, so the constant
 * became a choice. The list is deliberately explicit rather than read from the
 * supplier record: a supplier with a record but no adapter would show an empty
 * catalogue, which reads as "the feed is empty" and is not.
 */
const SUPPLIERS: { id: string; name: string }[] = [
  { id: 'easygifts', name: 'EasyGifts' },
  { id: 'promediaplus', name: 'Pro Media Plus' },
  { id: 'midocean', name: 'midocean' },
];

/**
 * Suppliers that quote in the shop's own currency — 3.8.
 *
 * The exchange-rate box is hidden for these and the server forces the rate to 1
 * whatever is sent. midocean's prices are already SEK; multiplying them by 11.5
 * would sell an 89 kr bag for 1 024.
 */
const NATIVE_SEK = new Set(['midocean']);

/**
 * Read a number the way a Swedish owner types one — 15.1.4.
 *
 * `<input type="number">` blanks its own value the moment the text is not a
 * valid float for the browser's locale, so "25,5" could leave the box LOOKING
 * filled while the state held ''. With the field invisible as well, that is
 * exactly "I entered it and it does not work". These boxes are plain text now
 * and this is the only place their text becomes a number.
 *
 * Returns NaN for anything that is not a number, including an empty box —
 * which is the point: an empty box must never arrive at the server as 0.
 */
function decimal(text: string): number {
  const cleaned = String(text ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (!cleaned) return NaN;
  return Number(cleaned);
}

async function authed(url: string, init?: RequestInit) {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) throw Object.assign(new Error('Not signed in.'), { status: 401 });
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  // The status and the server's reason travel with the error: an expired
  // sign-in, a refused read and a host failure are three different sentences.
  if (!res.ok) throw Object.assign(new Error(body?.error || 'The request failed.'), { status: res.status, reason: body?.reason ?? null });
  return body;
}

export default function SupplierPicker() {
  const { t } = useAuth();
  const [SUPPLIER, setSupplier] = useState(SUPPLIERS[0].id);

  /**
   * The shop's own categories, for "put them in".
   *
   * From /api/categories rather than from Firestore: it is already cached and
   * shared on the server, and this screen must not add a per-visit collection
   * read to a project whose daily read quota has run out once already.
   */
  const [categories, setCategories] = useState<Category[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/categories')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && Array.isArray(d?.categories)) setCategories(d.categories); })
      .catch(() => { /* the picker still works; only the destination list is empty */ });
    return () => { cancelled = true; };
  }, []);

  const [rows, setRows] = useState<IndexRow[]>([]);
  const [catCounts, setCatCounts] = useState<{ name: string; label?: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [indexedAt, setIndexedAt] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  // THE ORDER, HIS CHOICE (the client's item 9), remembered on this browser.
  const [sort, setSort] = useState<SupplierSort>(() => {
    try {
      return cleanSort(localStorage.getItem(SORT_KEY));
    } catch {
      return 'category';
    }
  });
  // Products the supplier sends without a price cannot be imported: hidden — and counted, and his to show.
  const [showUnpriced, setShowUnpriced] = useState(false);
  const [hiddenUnpriced, setHiddenUnpriced] = useState(0);
  // A refused read is not an empty catalogue: the reason decides the empty screen's words.
  const [errorKind, setErrorKind] = useState<'quota' | 'other' | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleAsOf, setStaleAsOf] = useState<string | null>(null);
  // The build, driven one step at a time. `build` is the SERVER's last answer —
  // nothing on this screen is a number the browser worked out for itself.
  const [build, setBuild] = useState<{ phase: string; percent: number; cursor: number; total: number; reason?: string } | null>(null);
  const [buildNote, setBuildNote] = useState<string | null>(null);
  const buildingRef = useRef(false);
  // The list's loader as it is NOW: a build runs for many steps, and reloading
  // through the loader of the moment it was clicked put back the sort, search and
  // price filter he had before — while the controls showed his new ones.
  const loadRef = useRef<(offset?: number) => Promise<void>>(async () => {});

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [margin, setMargin] = useState('150');
  const [rate, setRate] = useState('11.5');
  const [targetCategory, setTargetCategory] = useState('');
  const [importing, setImporting] = useState(false);

  // 3.6/3.8 — whether this supplier can actually be read: is there an adapter,
  // is a credential stored, has it been indexed. Without this the screen showed
  // an empty catalogue and no way to tell "nothing indexed" from "wrong key".
  const [status, setStatus] = useState<{
    hasCredentials: boolean; adapterBuilt: boolean; indexedProducts: number | null; last4?: string;
    /** EasyGifts is static files and needs none. The server says which. */
    needsCredentials: boolean;
  } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  // Pro Media Plus signs in with a username and a password (HTTP Basic on its
  // XML feed), not a key — the login from its B2B panel, My B2B account → Integration.
  const [pmpUser, setPmpUser] = useState('');
  const [pmpPass, setPmpPass] = useState('');
  const [testing, setTesting] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped?: { productKey: string; reason: string }[] } | null>(null);

  // Read once per supplier, not per keystroke: it is three Firestore reads on a
  // project whose daily quota has run out once already.
  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    setStatusNote(null);
    setApiKey('');
    authed('/api/admin/suppliers')
      .then((data) => {
        if (cancelled) return;
        const row = (data?.suppliers ?? []).find((sup: any) => sup.id === SUPPLIER);
        if (row) {
          setStatus({
            hasCredentials: row.hasCredentials === true,
            adapterBuilt: row.adapterBuilt === true,
            needsCredentials: row.needsCredentials !== false,
            // NULL IS NOT ZERO. `Number(null) || 0` turned "the database would
            // not let me count" into "there are none", and the screen then told
            // the owner his catalogue had not been built — the sentence his
            // client photographed while the truth was a read quota.
            indexedProducts: row.indexedProducts === null || row.indexedProducts === undefined
              ? null
              : Number(row.indexedProducts) || 0,
            last4: row.last4,
          });
        }
      })
      .catch(() => { /* the catalogue below is the point; this is a hint */ });
    return () => { cancelled = true; };
  }, [SUPPLIER]);

  /**
   * Build the catalogue, one bounded step per request.
   *
   * The server holds the cursor on disk, so a dropped request — this host loses
   * roughly one in five — costs one repeated step and nothing else. The loop
   * stops itself on 'done' and on 'blocked'; it never decides the job finished
   * because a request failed.
   */
  const runBuild = async () => {
    if (buildingRef.current) return;
    buildingRef.current = true;
    setBuildNote(null);
    setBuild({ phase: 'fetch', percent: 0, cursor: 0, total: 0 });
    try {
      for (let step = 0; step < 200; step += 1) {
        const state = await authed(`/api/admin/suppliers/${SUPPLIER}/index/step`, { method: 'POST' });
        setBuild({
          phase: String(state.phase ?? ''),
          percent: Number(state.percent) || 0,
          cursor: Number(state.cursor) || 0,
          total: Number(state.total) || 0,
          reason: state.reason,
        });
        if (state.phase === 'done') {
          setBuildNote(t('spBuildDone').replace('{0}', String(state.total ?? 0)));
          setStatus((prev) => (prev ? { ...prev, indexedProducts: Number(state.total) || 0 } : prev));
          void loadRef.current(0);
          return;
        }
        if (state.phase === 'blocked') {
          setBuildNote(state.reason === 'empty_feed' ? t('spBuildEmptyFeed') : t('spBuildStopped'));
          return;
        }
      }
      // The cap exists so a machine that never reports 'done' cannot loop for
      // ever. Reaching it is not success and is not reported as success.
      setBuildNote(t('spBuildStopped'));
    } catch {
      // The work already committed is on the server. Say so, rather than leaving
      // him to guess whether pressing again starts from nothing.
      setBuildNote(t('spBuildStopped'));
    } finally {
      buildingRef.current = false;
      setBuild((b) => (b && b.phase !== 'done' ? null : b));
    }
  };

  const saveKey = async () => {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    setStatusNote(null);
    try {
      const out = await authed(`/api/admin/suppliers/${SUPPLIER}/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      setStatus((prev) => ({
        hasCredentials: true,
        needsCredentials: prev?.needsCredentials ?? true,
        adapterBuilt: prev?.adapterBuilt ?? true,
        indexedProducts: prev?.indexedProducts ?? null,
        last4: out?.last4,
      }));
      setApiKey('');
      // SAY THE NEXT STEP. Saving the key is not the end of the job — the
      // catalogue is still empty until it is built, and the Build button only
      // appears once the key exists, so the moment it appears is the moment to
      // point at it. Without this the owner saves a key, sees "Saved and
      // working", and is left looking at the same empty grid he started with.
      setStatusNote(t('spKeySavedNowBuild'));
    } catch (err: any) {
      setStatusNote(err?.message || t('spLoadFailed'));
    } finally {
      setSavingKey(false);
    }
  };

  const saveLogin = async () => {
    if (!pmpUser.trim() || !pmpPass) return;
    setSavingKey(true);
    setStatusNote(null);
    try {
      // The server checks the login against the live feed before it keeps it.
      await authed('/api/admin/supplier/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: pmpUser.trim(), pass: pmpPass }),
      });
      setStatus((prev) => ({
        hasCredentials: true,
        needsCredentials: prev?.needsCredentials ?? true,
        adapterBuilt: prev?.adapterBuilt ?? true,
        indexedProducts: prev?.indexedProducts ?? null,
      }));
      setPmpPass('');
      setStatusNote(t('spKeySavedNowBuild'));
    } catch (err: any) {
      setStatusNote(err?.message || t('spLoadFailed'));
    } finally {
      setSavingKey(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setStatusNote(null);
    try {
      const out = await authed(`/api/admin/suppliers/${SUPPLIER}/test`, { method: 'POST' });
      setStatusNote(`${out?.detail ?? 'ok'}${out?.ms ? ` · ${out.ms} ms` : ''}`);
    } catch (err: any) {
      setStatusNote(err?.message || t('spLoadFailed'));
    } finally {
      setTesting(false);
    }
  };

  // A late reply must not land in a screen that has moved on.
  const live = useRef(0);
  useEffect(() => () => { live.current = -1; }, []);

  // `t` through a ref: it is a new function on every render of the app's top
  // component, and as a dependency of `load` it reloaded page one — throwing
  // away the "Show more" pages — whenever anything unrelated re-rendered.
  const tRef = useRef(t);
  tRef.current = t;

  const load = useCallback(async (offset = 0) => {
    const ticket = live.current + 1;
    live.current = ticket;
    if (offset === 0) setLoading(true); else setLoadingMore(true);
    setError(null);
    setErrorKind(null);
    try {
      const params = new URLSearchParams({ limit: '60', offset: String(offset), sort });
      if (search.trim()) params.set('q', search.trim());
      if (category) params.set('category', category);
      if (showUnpriced) params.set('unpriced', '1');
      const data = await authed(`/api/admin/suppliers/${SUPPLIER}/catalogue?${params}`);
      if (live.current !== ticket) return;
      setRows((prev) => (offset === 0 ? data.products : [...prev, ...data.products]));
      setTotal(data.total ?? 0);
      setHiddenUnpriced(Number(data.hiddenUnpriced) || 0);
      setNextOffset(data.nextOffset ?? null);
      setCatCounts(data.categories ?? []);
      setIndexedAt(data.indexedAt ?? null);
      // Served from the shop's own disk copy because the live read was refused.
      // Shown as an "as of", never passed off as current.
      setStaleAsOf(data.stale === true ? (data.asOf ?? null) : null);
    } catch (err: any) {
      if (live.current !== ticket) return;
      const tt = tRef.current;
      const status = Number(err?.status) || 0;
      // Each failure in its own words: the read-limit sentence only when the
      // read limit is the reason (it was said for any failure at all).
      if (status === 401) setError(tt('spErrSignIn'));
      else if (status === 403) setError(tt('spErrNotAdmin'));
      else if (status === 503 && err?.reason === 'firestore_quota') setError(err?.message || tt('spLoadFailed'));
      else setError(tt('spErrLoad').replace('{0}', status ? String(status) : '—'));
      setErrorKind(status === 503 && err?.reason === 'firestore_quota' ? 'quota' : 'other');
      // A NEW search that failed must not leave the last one's results on screen,
      // looking like its own.
      if (offset === 0) {
        setRows([]);
        setTotal(0);
        setNextOffset(null);
      }
    } finally {
      if (live.current === ticket) { setLoading(false); setLoadingMore(false); }
    }
    // SUPPLIER is in the dependencies: without it, switching supplier left the
    // previous one's catalogue on screen and the tick list pointing at products
    // the import endpoint would refuse.
  }, [search, category, SUPPLIER, sort, showUnpriced]);

  loadRef.current = load;

  // Debounced: a keystroke is not a search, and each one costs a request.
  useEffect(() => {
    const timer = setTimeout(() => { void load(0); }, search.trim() ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, search, category, SUPPLIER, sort, showUnpriced]);

  const chooseSort = (next: SupplierSort) => {
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      /* private window: the choice lasts this visit */
    }
  };

  const toggle = (key: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const runImport = async () => {
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const data = await authed(`/api/admin/suppliers/${SUPPLIER}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productKeys: [...picked],
          marginPercent: decimal(margin),
          // 1 for a supplier that already quotes kronor. The server forces it
          // anyway; sending the truth keeps the two honest about each other.
          rate: NATIVE_SEK.has(SUPPLIER) ? 1 : decimal(rate),
          categoryId: targetCategory || undefined,
          // Always hidden. He reviews them in Products and shows them himself.
          hidden: true,
        }),
      });
      setResult(data);
      setPicked(new Set());
    } catch (err: any) {
      setError(err?.message || t('spImportFailed'));
    } finally {
      setImporting(false);
    }
  };

  const money = (r: IndexRow) =>
    typeof r.sourcePrice === 'number' ? `${r.sourcePrice.toFixed(2)} ${r.sourceCurrency}` : '—';

  /**
   * IS THE MARGIN BOX A NUMBER? — 15.1.5, and this is the one that cost money.
   *
   * The guard used to be `!(Number(margin) >= 0)`. `Number('') === 0`, and
   * `0 >= 0` is true, so an EMPTY box passed it, arrived at the server as
   * `marginPercent: 0`, and every ticked product was imported at his own trade
   * price. The rate box never had the problem — `Number('') > 0` is false — and
   * the asymmetry is why the shop could import a whole selection at cost with
   * nothing on screen saying so. The other bar guards this screen's sibling uses
   * (ProductsBulkBar) have tested `.trim()` for exactly this reason since
   * round 12; this one was missed.
   */
  const marginValue = decimal(margin);
  const marginOk = Number.isFinite(marginValue) && marginValue >= 0;
  const effectiveRate = NATIVE_SEK.has(SUPPLIER) ? 1 : decimal(rate);
  const rateOk = Number.isFinite(effectiveRate) && effectiveRate > 0;

  /**
   * THE ARITHMETIC, ON SCREEN, BEFORE HE PRESSES IMPORT — 15.1.6.
   *
   * Built from a row already in `rows`, so it costs no read and no request. The
   * sibling screen has had this since round 12 (`siPriceExample`); the picker
   * showed him no resulting number at all, which is the other half of "I don't
   * know, I entered it and it does not work". The formula is `sellPrice` from
   * src/lib/suppliers/toShopProduct.ts, kept in step with it by shape rather
   * than imported — the server, not the browser, computes what is written.
   */
  const previewRow = marginOk && rateOk
    ? rows.find((r) => picked.has(r.productKey) && typeof r.sourcePrice === 'number')
    : undefined;
  const preview = previewRow && typeof previewRow.sourcePrice === 'number'
    ? {
        from: `${previewRow.sourcePrice.toFixed(2)} ${previewRow.sourceCurrency}`,
        to: Math.round(previewRow.sourcePrice * effectiveRate * (1 + marginValue / 100)),
      }
    : null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-gray-900">{t('spTitle')}</h2>
        <p className="text-xs text-gray-500 font-medium mt-1">
          {t('spSubtitle')}
          {indexedAt && ` · ${t('spIndexed')} ${new Date(indexedAt).toLocaleString('sv-SE')}`}
        </p>
      </div>

      {/* CAN THIS SUPPLIER BE READ AT ALL — 3.6 and 3.8.
          Without it an empty list meant one of three different things and the
          screen said none of them: no adapter, no key, or nothing indexed yet. */}
      {status && (
        <div className="bg-white rounded-3xl border border-gray-100 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] font-bold">
            {!status.adapterBuilt && (
              <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-600">{t('spNoAdapter')}</span>
            )}
            {status.adapterBuilt && status.hasCredentials && (
              <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800">
                {status.last4 ? t('spKeyStored').replace('{0}', status.last4) : t('spKeySaved')}
              </span>
            )}
            {status.adapterBuilt && status.indexedProducts === 0 && (
              <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-800">{t('spNotIndexed')}</span>
            )}
            {/* Counted, and the count could not be taken. Grey, not amber: it is
                not a problem with the supplier, it is a thing we do not know. */}
            {status.adapterBuilt && status.indexedProducts === null && (
              <span className="px-2 py-1 rounded-lg bg-gray-100 text-gray-600">{t('spIndexedUnknown')}</span>
            )}
            {/* A KEY IS NOT ALWAYS NEEDED. This read `hasCredentials !== false`,
                which hid the Build button from EasyGifts — a feed of static files
                that needs no login at all — so its 1 330 products could never be
                refreshed from this screen. The server already says which
                suppliers need a credential; ask it rather than assuming. */}
            {status.adapterBuilt && (!status.needsCredentials || status.hasCredentials) && (
              <button
                type="button"
                onClick={runBuild}
                disabled={buildingRef.current || (build !== null && build.phase !== 'done')}
                className="px-3 py-1.5 rounded-xl bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 font-black cursor-pointer"
              >
                {build && build.phase !== 'done'
                  ? (build.phase === 'fetch' ? t('spBuildFetching') : t('spBuilding').replace('{0}', String(build.percent)))
                  : (status.indexedProducts ? t('spBuildAgain') : t('spBuild'))}
              </button>
            )}
            {status.adapterBuilt && (
              <button
                type="button"
                onClick={testConnection}
                disabled={testing}
                className="ml-auto px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-700 font-black cursor-pointer"
              >
                {testing ? t('spTesting') : t('spTestConnection')}
              </button>
            )}
          </div>

          {/* The key box, only where a key is what is missing. Pro Media Plus
              needs a username and a password and has its own panel. */}
          {status.adapterBuilt && !status.hasCredentials && SUPPLIER === 'midocean' && (
            <div className="space-y-2">
              <p className="text-[0.6875rem] font-bold text-amber-800">{t('spKeyNeeded')}</p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={t('spKeyLabel')}
                  autoComplete="off"
                  className="flex-1 min-w-[12rem] px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-900"
                />
                <button
                  type="button"
                  onClick={saveKey}
                  disabled={savingKey || !apiKey.trim()}
                  className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-[0.6875rem] font-black cursor-pointer"
                >
                  {t('spKeySave')}
                </button>
              </div>
            </div>
          )}

          {status.adapterBuilt && !status.hasCredentials && SUPPLIER === 'promediaplus' && (
            <div className="space-y-2">
              <p className="text-[0.6875rem] font-bold text-amber-800">{t('spKeyNeeded')}</p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={pmpUser}
                  onChange={(e) => setPmpUser(e.target.value)}
                  placeholder="Login (e-mail)"
                  autoComplete="off"
                  className="flex-1 min-w-[12rem] px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-900"
                />
                <input
                  type="password"
                  value={pmpPass}
                  onChange={(e) => setPmpPass(e.target.value)}
                  placeholder="Password"
                  autoComplete="off"
                  className="flex-1 min-w-[10rem] px-3 py-2 rounded-xl border border-gray-200 text-xs font-bold text-gray-900"
                />
                <button
                  type="button"
                  onClick={saveLogin}
                  disabled={savingKey || !pmpUser.trim() || !pmpPass}
                  className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-[0.6875rem] font-black cursor-pointer"
                >
                  {t('spKeySave')}
                </button>
              </div>
            </div>
          )}

          {statusNote && <p className="text-[0.6875rem] font-bold text-gray-600">{statusNote}</p>}
        </div>
      )}

      {/* Search and the supplier's own categories. His screenshot: choosing one
          filters the list to it and hides the rest. */}
      <div className="bg-white rounded-3xl border border-gray-100 p-4 space-y-3">
        {/* WHICH SUPPLIER. Hidden while there is only one — a choice with one
            option is a question with one answer. */}
        {SUPPLIERS.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {SUPPLIERS.map((sup) => (
              <button
                key={sup.id}
                type="button"
                onClick={() => {
                  if (sup.id === SUPPLIER) return;
                  setSupplier(sup.id);
                  // Everything below belongs to the supplier that was showing.
                  // Carrying a category filter or a tick list across would
                  // import the wrong products.
                  setCategory('');
                  setSearch('');
                  setPicked(new Set());
                }}
                className={cn(
                  'px-3 py-1.5 rounded-xl text-[0.6875rem] font-black border transition-colors',
                  SUPPLIER === sup.id
                    ? 'bg-orange-600 border-orange-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
                )}
              >
                {sup.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('spSearchPlaceholder')}
              data-rx-supplier-search
              className="w-full pl-9 pr-3 py-3 text-xs font-medium border border-gray-200 rounded-2xl focus:outline-hidden focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <label className="flex items-center gap-2 text-[0.6875rem] font-black text-gray-600 shrink-0">
            {t('spSortLabel')}
            <select
              value={sort}
              onChange={(e) => chooseSort(cleanSort(e.target.value))}
              data-rx-supplier-sort
              className="px-3 py-3 text-xs font-bold border border-gray-200 rounded-2xl bg-white focus:outline-hidden focus:ring-2 focus:ring-orange-500"
            >
              {SUPPLIER_SORTS.map((key) => (
                <option key={key} value={key}>
                  {t(SORT_LABEL[key])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setCategory('')}
            className={cn('px-3 py-1.5 rounded-xl text-[0.6875rem] font-black border transition-colors',
              !category ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400')}
          >
            {t('spAllCategories')}
          </button>
          {catCounts.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setCategory(c.name === category ? '' : c.name)}
              data-rx-supplier-chip={c.name}
              className={cn('px-3 py-1.5 rounded-xl text-[0.6875rem] font-black border transition-colors',
                category === c.name ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400')}
            >
              {c.label ?? decodeEntities(c.name)}<span className="ml-1.5 opacity-60">{c.count}</span>
            </button>
          ))}
        </div>
      </div>

      {buildNote && (
        <div className="bg-gray-900 text-white rounded-2xl px-4 py-3 text-xs font-bold">{buildNote}</div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs font-bold rounded-2xl px-4 py-3 flex items-start gap-2">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 text-green-900 text-xs font-bold rounded-2xl px-4 py-3 space-y-1.5">
          <p>{t('spImported').replace('{0}', String(result.imported))}</p>
          <p className="font-medium text-green-800">{t('spImportedHidden')}</p>
          {/* Refusals are NAMED. A silent "imported 12 of 20" leaves him hunting
              for which eight and why. */}
          {result.skipped?.length ? (
            <div className="pt-1 border-t border-green-200">
              <p className="font-black">{t('spSkipped').replace('{0}', String(result.skipped.length))}</p>
              <ul className="font-medium text-green-800">
                {result.skipped.slice(0, 8).map((s) => <li key={s.productKey}>· {s.productKey} — {s.reason}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      {/* What happens on Import, stated before it happens. */}
      {picked.size > 0 && (
        <div className="sticky top-2 z-30 bg-gray-900 text-white rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs font-black">{t('spPicked').replace('{0}', String(picked.size))}</span>
            <button type="button" onClick={() => setPicked(new Set())} className="text-[0.6875rem] font-black px-2.5 py-1.5 rounded-xl hover:bg-white/10">
              {t('pbClear')}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="text-[0.6875rem] font-bold">
              {t('spMargin')}
              <input type="text" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)}
                aria-invalid={!marginOk}
                className={cn('mt-1', BAR_FIELD)} />
            </label>
            {/* 3.8 — no exchange rate on a feed that already quotes kronor. The
                server forces 1 whatever is sent; this stops the owner typing a
                number that will be ignored. */}
            {NATIVE_SEK.has(SUPPLIER) ? (
              <div className="text-[0.6875rem] font-bold text-gray-500 self-end pb-2">
                {t('spRateFixed')}
              </div>
            ) : (
              <label className="text-[0.6875rem] font-bold">
                {t('spRate')}
                <input type="text" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)}
                  aria-invalid={!rateOk}
                  className={cn('mt-1', BAR_FIELD)} />
              </label>
            )}
            <label className="text-[0.6875rem] font-bold">
              {t('spCategory')}
              <select value={targetCategory} onChange={(e) => setTargetCategory(e.target.value)}
                className={cn('mt-1', BAR_FIELD)}>
                <option value="">{t('spNoCategory')}</option>
                {categoryPickList(categories).map(({ category: c, indent }) => (
                  <option key={c.id} value={c.id}>{indent}{c.name}</option>
                ))}
              </select>
            </label>
          </div>
          {/* WHAT THE NUMBERS DO, AND WHAT THEY PRODUCE — 15.1.6/15.1.7.
              The red line is why the Import button is dead; without it a
              disabled button is indistinguishable from a broken screen. */}
          {!marginOk && (
            <p className="text-[0.625rem] font-black text-red-300">{t('spMarginRequired')}</p>
          )}
          {marginOk && !rateOk && (
            <p className="text-[0.625rem] font-black text-red-300">{t('spRateRequired')}</p>
          )}
          {preview && (
            <p className="text-[0.6875rem] font-black text-white bg-white/10 rounded-xl px-3 py-2">
              {t('spPriceExample').replace('{0}', preview.from).replace('{1}', String(preview.to))}
            </p>
          )}
          <p className="text-[0.625rem] text-white/60 font-medium">{t('spImportNote')}</p>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={importing || !marginOk || !rateOk}
            className="w-full px-4 py-3 bg-white text-gray-900 text-xs font-black rounded-2xl hover:bg-gray-100 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {t('spImport').replace('{0}', String(picked.size))}
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="bg-gray-100 rounded-2xl aspect-square animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        /* TWO DIFFERENT SENTENCES, and they used to be one.
           "Either nothing matches, or the index has not been built yet" rendered
           directly under the red "the database has hit its daily read limit"
           banner — two contradictory explanations of the same blank screen, and
           the owner's client reasonably read the wrong one and concluded the
           catalogue was gone. A refused read is not an empty catalogue, and the
           screen now says which one it is. */
        <div className="bg-white rounded-3xl border border-gray-200 p-12 text-center space-y-3">
          <PackageSearch className="w-10 h-10 text-gray-300 mx-auto" />
          <p className="text-sm font-bold text-gray-700" data-rx-supplier-empty>
            {errorKind === 'quota' ? t('spEmptyReadRefused') : error ? t('spLoadFailed') : search.trim() || category ? t('spEmptyFiltered') : t('spEmptyTitle')}
          </p>
          <p className="text-xs text-gray-400 max-w-md mx-auto">
            {errorKind === 'quota' ? t('spEmptyReadRefusedBody') : error ? error : search.trim() || category ? t('spEmptyFilteredBody') : t('spEmptyBody')}
          </p>
          {!error && (search.trim() || category || hiddenUnpriced > 0) && (
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              {search.trim() && (
                <button type="button" onClick={() => setSearch('')} className="px-3 py-1.5 rounded-xl text-[0.6875rem] font-black border border-gray-200 text-gray-700 hover:border-gray-400">
                  {t('spMatching').replace('{0}', search.trim())} ✕
                </button>
              )}
              {category && (
                <button type="button" onClick={() => setCategory('')} className="px-3 py-1.5 rounded-xl text-[0.6875rem] font-black border border-gray-200 text-gray-700 hover:border-gray-400">
                  {t('spInCategory').replace('{0}', decodeEntities(category))} ✕
                </button>
              )}
              {hiddenUnpriced > 0 && (
                <button type="button" onClick={() => setShowUnpriced(true)} className="px-3 py-1.5 rounded-xl text-[0.6875rem] font-black border border-amber-300 text-amber-800 hover:border-amber-500">
                  {t('spHiddenUnpriced').replace('{0}', String(hiddenUnpriced))} — {t('spShowUnpriced')}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-gray-500" data-rx-supplier-results>
            <span>{t('spShowing').replace('{0}', String(rows.length)).replace('{1}', String(total))}</span>
            {category && (
              <button type="button" onClick={() => setCategory('')} title={t('spClearFilter')} className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
                {t('spInCategory').replace('{0}', decodeEntities(category))} ✕
              </button>
            )}
            {foldText(search) && (
              <button type="button" onClick={() => setSearch('')} title={t('spClearFilter')} className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
                {t('spMatching').replace('{0}', search.trim())} ✕
              </button>
            )}
            {hiddenUnpriced > 0 && (
              <button type="button" onClick={() => setShowUnpriced(true)} className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 hover:border-amber-400" data-rx-supplier-unpriced>
                {t('spHiddenUnpriced').replace('{0}', String(hiddenUnpriced))} — {t('spShowUnpriced')}
              </button>
            )}
            {showUnpriced && (
              <button type="button" onClick={() => setShowUnpriced(false)} className="px-2 py-0.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200">
                {t('spHideUnpriced')}
              </button>
            )}
          </div>
          {staleAsOf && (
            <p className="text-[0.6875rem] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {t('spStaleNotice').replace('{0}', new Date(staleAsOf).toLocaleString('sv-SE'))}
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {rows.map((r) => {
              const on = picked.has(r.productKey);
              // No price from the supplier: the import would refuse it, so it cannot be ticked.
              const unpriced = !(typeof r.sourcePrice === 'number' && r.sourcePrice > 0);
              return (
                <button
                  key={r.productKey}
                  type="button"
                  onClick={() => { if (!unpriced) toggle(r.productKey); }}
                  disabled={unpriced}
                  title={unpriced ? t('spNoPrice') : undefined}
                  data-rx-supplier-row={r.productKey}
                  className={cn('text-left bg-white rounded-2xl border overflow-hidden flex flex-col transition-all',
                    unpriced ? 'border-dashed border-gray-300 opacity-70 cursor-not-allowed'
                      : on ? 'border-orange-500 ring-2 ring-orange-200' : 'border-gray-200 hover:border-gray-400')}
                >
                  <div className="relative aspect-square bg-gray-50 p-2">
                    {r.image
                      ? <img src={r.image} alt={displayName(r)} loading="lazy" className="w-full h-full object-contain" />
                      : <div className="w-full h-full flex items-center justify-center text-gray-300 text-[0.625rem] font-bold">—</div>}
                    {on && (
                      <span className="absolute top-2 right-2 w-6 h-6 rounded-full bg-orange-600 text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                    {/* The colour count, because one row here is up to sixteen
                        sellable colours and that is the thing most likely to
                        surprise him about what he just imported. */}
                    {r.variantCount > 1 && (
                      <span className="absolute bottom-2 left-2 bg-white/90 text-gray-700 text-[0.625rem] font-black px-1.5 py-0.5 rounded-md border border-gray-200">
                        {t('spColours').replace('{0}', String(r.variantCount))}
                      </span>
                    )}
                  </div>
                  <div className="px-2.5 py-2 border-t border-gray-100 flex-1">
                    {/* Swedish first — it is what he reads, and what the shop
                        will show. */}
                    <p className="text-[0.6875rem] font-bold text-gray-800 line-clamp-2" title={decodeEntities(r.name)}>
                      {displayName(r)}
                    </p>
                    <p className="text-[0.625rem] text-gray-400 font-medium mt-0.5">{r.productKey}</p>
                    <p className="text-[0.6875rem] font-black text-gray-900 mt-1">{money(r)}</p>
                    {unpriced && <p className="text-[0.625rem] font-bold text-amber-700 mt-0.5">{t('spNoPrice')}</p>}
                  </div>
                </button>
              );
            })}
          </div>

          {nextOffset !== null && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void load(nextOffset)}
                disabled={loadingMore}
                className="px-6 py-3 bg-gray-100 text-gray-800 text-xs font-black rounded-2xl hover:bg-gray-200 inline-flex items-center gap-2 disabled:opacity-60"
              >
                {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {t('mlLoadMore')}
              </button>
            </div>
          )}
        </>
      )}

      <p className="text-[0.6875rem] text-gray-400 font-medium flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        {t('spIndexNote')}
      </p>
    </div>
  );
}
