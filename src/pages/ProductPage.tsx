import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { AlertCircle, ChevronRight, FileCheck2, Package, Truck, Wallet } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../App';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { trackAddToCart, trackViewItem } from '../lib/gtag';
import { Category, Product } from '../types';
import { localized, localizedList } from '../lib/localizedText';
import { addConfiguredLineToCart } from '../lib/cart';
import { DEFAULT_ARTWORK_FORMATS } from '../lib/artworkLimits';
import { artworkBoxShown } from '../lib/artwork';
import { looksLikeProductId, productPath, productSlug, slugify } from '../lib/slug';
import { cn } from '../lib/utils';
import { NEO } from '../components/NeumorphicSidebar';
import ProductConfigurator from '../components/product/ProductConfigurator';
import SuggestedProducts from '../components/product/SuggestedProducts';
import NeoInfoSections, {
  NeoInfoChips,
  ProductBullets,
  ProductInfoSection,
} from '../components/product/NeoInfoTabs';

/**
 * The product detail page — one product, one URL.
 *
 * The shop only ever had a configurator MODAL, which meant a product could not be
 * linked to, shared in a WhatsApp message or indexed by a search engine: every
 * product lived at /products. This page is the address, the breadcrumb and the
 * long-form content (specification table, artwork guidelines, FAQ, how ordering
 * works); the configurator inside it is the very same component the modal mounts,
 * so the two can never present a product differently.
 */

/**
 * Find the product an address points at.
 *
 * The address is the product's name (`/products/premium-card`), but ids are
 * what every link written before this change carries — and what a product with
 * no usable name still falls back to. Both must resolve, and the cheap lookup
 * has to come first: Firestore is on the free plan and its daily read quota has
 * blacked this shop out once already.
 */
/**
 * A product, briefly remembered.
 *
 * Clicking a card on the products page cost another 389 KB of Firestore reads,
 * re-fetching a document the list already held — measured on the live shop. The
 * catalogue's photos live inside the documents as base64, so a product document
 * IS a third of a megabyte, and this shop has already spent a day dark with its
 * read quota exhausted. Sixty seconds is long enough to cover browsing back and
 * forth between a category and its products, and short enough that an edit in
 * the dashboard shows up while the owner is still looking at it.
 */
const PRODUCT_TTL_MS = 60_000;
const productCache = new Map<string, { at: number; product: Product }>();

function cacheProduct(param: string, product: Product): Product {
  const now = Date.now();
  productCache.set(param, { at: now, product });
  productCache.set(product.id, { at: now, product });
  const slug = String((product as { slug?: string }).slug || '');
  if (slug) productCache.set(slug, { at: now, product });
  return product;
}

function cachedProduct(param: string): Product | null {
  const hit = productCache.get(param);
  if (!hit) return null;
  if (Date.now() - hit.at > PRODUCT_TTL_MS) {
    productCache.delete(param);
    return null;
  }
  return hit.product;
}

/** The shop could not be asked at all (refused, offline) — not "no such product". */
class ProductUnavailable extends Error {
  readonly unavailable = true;
}

/**
 * The product from the SERVER'S COPY (/api/catalogue/product, 2026-10-08): one read
 * per product per change from the dashboard instead of one per visit, and the last
 * copy while the database refuses reads — when the page used to tell the customer
 * the product "may have been removed" (the client's screenshot of his roll-up).
 * Visible products only. `undefined`: the server could not answer, ask Firestore.
 */
async function productFromServer(param: string): Promise<Product | null | undefined> {
  // A stalled host must not hold the page: after a few seconds, Firestore instead.
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), 6000);
  try {
    const resp = await fetch(`/api/catalogue/product?param=${encodeURIComponent(param)}`, { signal: abort.signal });
    if (resp.status === 404) return null;
    if (!resp.ok) return undefined;
    const body = await resp.json();
    return body?.product?.id ? (body.product as Product) : undefined;
  } catch {
    return undefined;
  } finally {
    window.clearTimeout(timer);
  }
}

async function resolveProduct(param: string, includeHidden = false): Promise<Product | null> {
  const remembered = cachedProduct(param);
  if (remembered) return remembered;

  // A customer: the server's copy first. The owner (includeHidden) reads
  // Firestore as before — his VIEW opens hidden products and must show his edit
  // at once — and falls back to the copy only when Firestore refuses.
  if (!includeHidden) {
    const fromServer = await productFromServer(param);
    if (fromServer) return cacheProduct(param, fromServer);
    if (fromServer === null) return null;
  }
  try {
    return await resolveProductFromFirestore(param, includeHidden);
  } catch (err) {
    if (includeHidden) {
      const fromServer = await productFromServer(param);
      if (fromServer) return cacheProduct(param, fromServer);
    }
    console.warn('The product could not be read:', err);
    throw new ProductUnavailable('The product could not be read right now.');
  }
}

async function resolveProductFromFirestore(param: string, includeHidden: boolean): Promise<Product | null> {

  const asDoc = async (id: string) => {
    const snap = await getDoc(doc(db, 'products', id));
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as Product) : null;
  };

  // An old-style id, verbatim: one read.
  if (looksLikeProductId(param)) {
    const byId = await asDoc(param);
    if (byId) return cacheProduct(param, byId);
  }

  // A name: one indexed equality read on the stored slug.
  const bySlug = await getDocs(
    query(collection(db, 'products'), where('slug', '==', param), limit(1)),
  );
  if (!bySlug.empty) {
    const hit = bySlug.docs[0];
    return cacheProduct(param, { id: hit.id, ...hit.data() } as Product);
  }

  // A product saved before slugs existed carries no slug field, so its name has
  // to be matched instead — and that used to mean reading EVERY product document
  // in the browser. The comment here said "18 documents"; it was 109 by
  // 2026-09-12 with thousands coming from the supplier feeds, and the scan runs
  // on any URL that fails the two cheap lookups — a mistyped link, an old
  // bookmark, a crawler on a stale address. On the day the project's free daily
  // read quota ran out, this was the most expensive thing a single bad URL could
  // do.
  //
  // The server already holds the catalogue in memory with `slug` and `name` in
  // it, so it can answer this for nothing. One read follows, for the full
  // document the page actually needs.
  let serverSaidNo = false;
  try {
    const resp = await fetch(`/api/catalogue/resolve?param=${encodeURIComponent(param)}`);
    if (resp.ok) {
      const { id } = await resp.json();
      if (id) {
        const resolved = await asDoc(String(id));
        if (resolved) return cacheProduct(param, resolved);
      }
    } else if (resp.status === 404) {
      serverSaidNo = true;
    }
  } catch { /* the endpoint is optional; the scan below still answers */ }

  // The server's list holds every product a customer can see, so its "no such
  // product" is final for a customer — the walk below ran after it anyway, on every
  // mistyped link. It still runs for an admin (a HIDDEN product is not in that list)
  // and when the server could not answer at all.
  if (serverSaidNo && !includeHidden) return null;

  // Only if the server could not: the original walk, unchanged. It is expensive
  // and it is correct, which is the right order of preference for a fallback.
  const all = await getDocs(collection(db, 'products'));
  const byName = all.docs.find((d) => slugify(String((d.data() as any).name || '')) === param);
  if (byName) return cacheProduct(param, { id: byName.id, ...byName.data() } as Product);

  // Last: an id that is not in the prod-<millis> shape.
  return looksLikeProductId(param) ? null : asDoc(param);
}

export default function ProductPage() {
  const { productId } = useParams<{ productId: string }>();
  const { language, t, user, loading: authLoading } = useAuth();
  // The owner's VIEW button opens even a HIDDEN product (client, 2026-10-07), for an
  // admin — or a staff account he lets manage products, which has the same button —
  // only; customers still get "not found" for it.
  const canSeeHidden = user?.role === 'admin' || user?.permissions?.canManageProducts === true;
  const { settings: siteSettings } = useSiteSettings();
  const navigate = useNavigate();
  // The canonical redirect below changes the address, which re-runs the effect.
  // Without this the same product would be fetched a second time.
  const loadedRef = useRef<Product | null>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  // Refused or offline — said as such, never as "removed" (2026-10-08).
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cartError, setCartError] = useState<string | null>(null);
  // The nonce makes a repeat press of the same chip jump again.
  const [infoJump, setInfoJump] = useState<{ id: string; n: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    setUnavailable(false);
    setCartError(null);

    const load = async () => {
      if (!productId) {
        setMissing(true);
        setLoading(false);
        return;
      }
      // Already holding the product this address points at — the redirect to the
      // canonical name arrived, not a different product.
      const held = loadedRef.current;
      if (held && (held.id === productId || productSlug(held) === productId)) {
        setLoading(false);
        return;
      }
      try {
        const found = await resolveProduct(productId, canSeeHidden);
        if (cancelled) return;
        // A hidden product is hidden from customers too — the owner takes junk
        // off the storefront with that flag and would not expect a direct link
        // to walk straight past it. An ADMIN sees it (his VIEW button), with a
        // note; while sign-in is still settling, nothing is decided yet — not
        // even "not found", which only an admin's fuller lookup may disprove.
        if (authLoading && (!found || found.isHidden === true)) return;
        if (!found || (found.isHidden === true && !canSeeHidden)) {
          setMissing(true);
          setLoading(false);
          return;
        }
        const loaded = found;
        loadedRef.current = loaded;
        setProduct(loaded);

        // One product, one address. An id link (an old bookmark, an order line,
        // a shared /products/prod-123 URL) is swapped for the name in the bar
        // without a second fetch, so the page a customer copies is the readable
        // one and a search engine is never shown the same product twice.
        const canonical = productPath(loaded);
        if (canonical !== `/products/${productId}`) {
          navigate(canonical, { replace: true });
        }
      } catch (e) {
        console.warn('Notice loading the product:', e);
        if (!cancelled) {
          if (e instanceof ProductUnavailable) setUnavailable(true);
          else setMissing(true);
        }
      }
      if (!cancelled) setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [productId, navigate, canSeeHidden, authLoading, retry]);
  // To the top for a NEW product only — not when sign-in settles under a page he
  // has already scrolled.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [productId]);

  // THE BREADCRUMB'S CATEGORY, in an effect of its own keyed on the product.
  // Fetched inside the load above, it was cancelled by the redirect to the
  // canonical address and never asked for again (an id link showed no category);
  // and kept between products, a suggestion clicked from A showed A's category
  // above B.
  const categoryId = product?.categoryId ? String(product.categoryId) : null;
  useEffect(() => {
    let cancelled = false;
    setCategory(null);
    if (!categoryId) return;
    getDoc(doc(db, 'categories', categoryId))
      .then((snap) => {
        if (!cancelled && snap.exists()) setCategory({ id: snap.id, ...snap.data() } as Category);
      })
      .catch(() => { /* a missing category costs one breadcrumb crumb, not the page */ });
    return () => {
      cancelled = true;
    };
  }, [product?.id, categoryId]);

  /**
   * "Someone looked at this product" — the event a remarketing audience is
   * built from. Off unless the owner switched it on, silent unless the visitor
   * accepted, and a no-op until a product has actually loaded.
   *
   * DELIBERATELY ABOVE EVERY EARLY RETURN in this component. A hook placed below
   * one runs on some renders and not others, and React answers that with
   * "Rendered fewer hooks than expected" and a crash loop — which is exactly how
   * the post-payment page broke the last time an analytics effect was added.
   */
  useEffect(() => {
    if (!product) return;
    trackViewItem(siteSettings.marketing || {}, {
      id: product.id,
      name: product.name,
      // The price the visitor is actually being shown. Reporting the list price
      // of a product on offer would make every Google Ads conversion value in
      // the account wrong by the size of the discount.
      price:
        Number(product.salePrice) > 0 && Number(product.salePrice) < Number(product.basePrice)
          ? Number(product.salePrice)
          : product.basePrice,
    });
  }, [product, siteSettings.marketing]);

  const name = product ? localized(product.name, product.nameI18n, language) : '';
  const description = product
    ? localized(product.description, product.descriptionI18n, language)
    : '';
  const features = useMemo(
    () => (product ? localizedList(product.features, product.featuresI18n, language) : []),
    [product, language],
  );

  const sections: ProductInfoSection[] = useMemo(() => {
    if (!product) return [];

    const rules = product.customUploadRules;
    // ONE SWITCH FOR EVERYTHING ARTWORK. The same rule the configurator uses for
    // the upload box decides these tabs, so a product can never offer print
    // advice with no way to send a file, or the reverse.
    const artworkShown = artworkBoxShown(product);
    const formats = (rules?.allowedFormats || DEFAULT_ARTWORK_FORMATS)
      .join(', ')
      .toUpperCase();

    const built: (ProductInfoSection | null)[] = [
      {
        id: 'description',
        title: t('ppSectionDescription'),
        defaultOpen: true,
        content: (
          <div className="space-y-4">
            <p className="text-xs text-gray-600 leading-relaxed font-semibold">
              {description || t('cfgDefaultDescription')}
            </p>
            {features.length > 0 && (
              <ProductBullets items={features.map((text) => ({ text, tone: 'plus' as const }))} />
            )}
          </div>
        ),
      },
      product.specs && product.specs.length > 0
        ? {
            id: 'specs',
            title: t('ppTabSpecs'),
            content: (
              <dl className="divide-y divide-white/70">
                {product.specs.map((spec, i) => (
                  <div key={i} className="py-2 flex items-baseline justify-between gap-4">
                    <dt className="text-[0.6875rem] font-black text-gray-500 uppercase tracking-wide">
                      {localized(spec.label, spec.labelI18n, language)}
                    </dt>
                    <dd className="text-xs font-bold text-gray-800 text-right">
                      {localized(spec.value, spec.valueI18n, language)}
                    </dd>
                  </div>
                ))}
              </dl>
            ),
          }
        : null,
      // DPI, BLEED, CMYK AND FONTS BELONG TO A PRINT JOB, and this tab used to
      // appear on everything. On an acrylic display stand — a finished good the
      // shop does not print on — it tells a buyer to prepare a file nobody wants,
      // and it does it right next to the tab that is now gone. Same switch as the
      // upload box: it follows what the owner ticked.
      artworkShown
        ? {
            id: 'guidelines',
            title: t('ppTabDesignGuidelines'),
            content: (
              <ProductBullets
                items={[
                  { text: t('ppGuidelineFormats').replace('{0}', formats), tone: 'plus' },
                  { text: t('ppGuidelineResolution'), tone: 'plus' },
                  { text: t('ppGuidelineBleed'), tone: 'plus' },
                  { text: t('ppGuidelineColour'), tone: 'plus' },
                  { text: t('ppGuidelineFonts'), tone: 'plus' },
                  { text: t('ppGuidelineNoRgbWarning'), tone: 'minus' },
                ]}
              />
            ),
          }
        : null,
      product.faq && product.faq.length > 0
        ? {
            id: 'faq',
            title: t('ppTabFaq'),
            content: (
              <div className="space-y-4">
                {product.faq.map((entry, i) => (
                  <div key={i} className="space-y-1">
                    <p className="text-xs font-black text-gray-900">
                      {localized(entry.q, entry.qI18n, language)}
                    </p>
                    <p className="text-xs font-semibold text-gray-600 leading-relaxed">
                      {localized(entry.a, entry.aI18n, language)}
                    </p>
                  </div>
                ))}
              </div>
            ),
          }
        : null,
      {
        id: 'process',
        title: t('ppTabOrderProcess'),
        content: (
          <ol className="space-y-3">
            {[
              { icon: <Package className="w-4 h-4" />, text: t('ppProcessStep1') },
              // "Upload your artwork — we run a preflight check on it" was step 2
              // of four on EVERY product. With the upload box off there is nowhere
              // to upload anything, so the step described something the page does
              // not offer. The other three are true of every order, print or not.
              ...(artworkShown ? [{ icon: <FileCheck2 className="w-4 h-4" />, text: t('ppProcessStep2') }] : []),
              { icon: <Wallet className="w-4 h-4" />, text: t('ppProcessStep3') },
              { icon: <Truck className="w-4 h-4" />, text: t('ppProcessStep4') },
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className={cn(
                    'w-8 h-8 rounded-2xl flex items-center justify-center text-orange-600 flex-shrink-0',
                    NEO.card,
                    NEO.raisedSm,
                  )}
                >
                  {step.icon}
                </span>
                <span className="text-xs font-semibold text-gray-600 leading-relaxed pt-1.5">
                  {step.text}
                </span>
              </li>
            ))}
          </ol>
        ),
      },
    ];

    return built.filter((s): s is ProductInfoSection => s !== null);
  }, [product, description, features, language, t]);

  if (loading) {
    // THE SKELETON IS THE SHAPE OF THE PAGE, not a suggestion of one.
    //
    // It used to be a square block and four 80px bars, in a wrapper 60vh tall,
    // where the real page has a breadcrumb, a title, a gallery at least 380px
    // tall and option cards 144px tall. Everything below moved when the data
    // landed, the footer with it: measured on the live shop, three runs out of
    // three, CLS 0.3007 — more than twice Google's "poor" threshold of 0.1, and
    // Core Web Vitals is a ranking signal on the very pages we are trying to
    // get indexed. Every box below mirrors a real one: the gallery's own
    // min-height, the option cards' h-28/32/36, the same grid and gaps.
    return (
      <div className={cn('py-8 lg:py-10', NEO.page)} dir="ltr" aria-busy="true">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          {/* breadcrumb */}
          <div className={cn('h-4 w-64 max-w-full rounded-lg animate-pulse', NEO.card)} />
          {/* title + info chips */}
          <div className="space-y-3">
            <div className={cn('h-9 w-2/3 max-w-md rounded-xl animate-pulse', NEO.card)} />
            <div className="flex gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className={cn('h-8 w-28 rounded-full animate-pulse', NEO.card)} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* the gallery frame, at the height it really has */}
            <div className="lg:col-span-5 space-y-4">
              <div
                className={cn(
                  'rounded-3xl animate-pulse min-h-[18.75rem] lg:min-h-[23.75rem]',
                  NEO.card,
                  NEO.raised,
                )}
              />
              <div className="flex gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={cn('w-20 h-20 rounded-xl animate-pulse', NEO.card)} />
                ))}
              </div>
            </div>

            {/* two option fields and the quantity block, at their real heights */}
            <div className="lg:col-span-7 space-y-6">
              {[0, 1].map((field) => (
                <div key={field} className="space-y-2">
                  <div className={cn('h-4 w-32 rounded-lg animate-pulse', NEO.card)} />
                  <div className="grid grid-cols-2 gap-3">
                    {[0, 1].map((card) => (
                      <div
                        key={card}
                        className={cn('h-28 sm:h-32 lg:h-36 rounded-2xl animate-pulse', NEO.card)}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className={cn('h-40 rounded-2xl animate-pulse', NEO.card)} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (unavailable && !product) {
    return (
      <div className={cn('min-h-[60vh] py-16', NEO.page)} data-rx-product-unavailable>
        <div className="max-w-2xl mx-auto px-4 text-center space-y-4">
          <Package className="w-12 h-12 text-gray-300 mx-auto" />
          <h1 className="text-xl font-black text-gray-800">{t('ppUnavailableTitle')}</h1>
          <p className="text-xs text-gray-500 font-semibold">{t('ppUnavailableBody')}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setRetry((n) => n + 1)}
              className="inline-block px-5 py-2.5 bg-gradient-to-br from-orange-500 to-orange-700 text-white text-xs font-black rounded-full"
            >
              {t('ppTryAgain')}
            </button>
            <Link to="/products" className="inline-block px-5 py-2.5 text-xs font-black text-gray-600">
              {t('ppBackToProducts')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (missing || !product) {
    return (
      <div className={cn('min-h-[60vh] py-16', NEO.page)}>
        <div className="max-w-2xl mx-auto px-4 text-center space-y-4">
          <Package className="w-12 h-12 text-gray-300 mx-auto" />
          <h1 className="text-xl font-black text-gray-800">{t('ppNotFoundTitle')}</h1>
          <p className="text-xs text-gray-500 font-semibold">{t('ppNotFoundBody')}</p>
          <Link
            to="/products"
            className="inline-block px-5 py-2.5 bg-gradient-to-br from-orange-500 to-orange-700 text-white text-xs font-black rounded-full"
          >
            {t('ppBackToProducts')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('py-8 lg:py-10', NEO.page)} dir="ltr">
      <Helmet>
        <title>{`${name} | ReklamX`}</title>
        <meta name="description" content={description.slice(0, 160)} />
        <meta property="og:title" content={name} />
        <meta property="og:description" content={description.slice(0, 160)} />
        {product.images?.[0] && <meta property="og:image" content={product.images[0]} />}
        <link rel="canonical" href={`${window.location.origin}${productPath(product)}`} />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        {product.isHidden === true && canSeeHidden && (
          <p className="px-4 py-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs font-black text-amber-900" data-rx-hidden-note>
            {t('ppHiddenAdminNote')}
          </p>
        )}
        {/* Breadcrumb — where this product sits, and the way back out. */}
        <nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-1 text-[0.6875rem] font-bold text-gray-500">
          <Link to="/" className="hover:text-orange-600 transition-colors">
            {t('ppBreadcrumbHome')}
          </Link>
          <ChevronRight className="w-3 h-3 text-gray-400" />
          <Link to="/products" className="hover:text-orange-600 transition-colors">
            {t('products')}
          </Link>
          {category && (
            <>
              <ChevronRight className="w-3 h-3 text-gray-400" />
              <Link
                to={`/products?category=${encodeURIComponent(category.id)}`}
                className="hover:text-orange-600 transition-colors"
              >
                {localized(category.name, category.nameI18n, language)}
              </Link>
            </>
          )}
          <ChevronRight className="w-3 h-3 text-gray-400" />
          <span className="text-gray-800">{name}</span>
        </nav>

        <div className="space-y-3">
          <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">{name}</h1>
          <NeoInfoChips
            sections={sections}
            onJump={(id) => setInfoJump((prev) => ({ id, n: (prev?.n ?? 0) + 1 }))}
          />
        </div>

        {cartError && (
          <div
            role="alert"
            className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-2.5 text-sm text-red-700 font-bold"
          >
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <span>{cartError}</span>
          </div>
        )}

        <ProductConfigurator
          product={product}
          variant="page"
          onAddToCart={(line) => {
            setCartError(null);
            const result = addConfiguredLineToCart(line, t('shopCartSaveError'));
            if (!result.ok) setCartError(result.message);
            // Reported only when the line really went in. A failed add that
            // still told Google "added to basket" would train Smart Bidding on
            // something that never happened.
            if (result.ok) {
              trackAddToCart(siteSettings.marketing || {}, {
                id: product.id,
                name: product.name,
                price: line.totalUnitPrice,
                quantity: line.quantity,
                lineTotal: line.totalPrice,
              });
            }
            return result.ok;
          }}
          secondaryAction={
            <Link
              to="/contact"
              className="block text-center text-[0.6875rem] font-black text-orange-600 hover:text-orange-700 transition-colors pt-1"
            >
              {t('ppRequestQuote')}
            </Link>
          }
          leftColumn={
            <NeoInfoSections
              sections={sections}
              openId={infoJump?.id}
              openNonce={infoJump?.n}
              t={t}
              className="pt-2"
            />
          }
        />

        <SuggestedProducts product={product} />
      </div>
    </div>
  );
}
