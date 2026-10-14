import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { homeSectionOrder } from '../../lib/homeSections';
import { motion } from 'motion/react';
import { 
  Phone, 
  Mail, 
  Search, 
  Globe, 
  ChevronRight, 
  ChevronDown, 
  ShoppingCart, 
  Clock, 
  Users, 
  MapPin, 
  CalendarCheck, 
  ShieldCheck,
  Layers,
  Sparkles,
  FileText,
  HelpCircle,
  Box,
  Image as ImageIcon,
  Tag,
  Store,
  Compass,
  ArrowRight
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSiteSettings, type BentoCardSetting } from '../../context/SiteSettingsContext';
import { useAuth } from '../../App';
import { translations, type TranslationKey } from '../../lib/translations';
import SafeImage from '../SafeImage';
import HeroShelf from './HeroShelf';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Category } from '../../types';
import { localized } from '../../lib/localizedText';
import { buildCategoryTree, flattenTree } from '../../lib/categoryTree';
import { SEO_PAGES, seoText, type SeoLang, type SeoSettings } from '../../lib/seoSettings';


/** The home page news rows: campaign notes, each opening the shop. The words are in translations.ts. */
const NEWS_ITEMS: { id: string; label: TranslationKey; title: TranslationKey; text: TranslationKey; image: string; link: string }[] = [
  { id: 'rollup', label: 'newsOffer', title: 'newsRollupTitle', text: 'newsRollupText', link: '/products',
    image: 'https://images.pexels.com/photos/7648057/pexels-photo-7648057.jpeg?auto=compress&cs=tinysrgb&w=900' },
  { id: 'pos', label: 'newModels', title: 'newsPosTitle', text: 'newsPosText', link: '/products',
    image: 'https://images.pexels.com/photos/20232007/pexels-photo-20232007.jpeg?auto=compress&cs=tinysrgb&w=900' },
  { id: 'autumn', label: 'campaigns', title: 'newsAutumnTitle', text: 'newsAutumnText', link: '/products',
    image: 'https://images.pexels.com/photos/3695660/pexels-photo-3695660.jpeg?auto=compress&cs=tinysrgb&w=900' },
];

export default function LaboPrintHome() {
  const { settings } = useSiteSettings();
  const { t, language, formatPriceWithVat } = useAuth();
  const [activeHeroSlide, setActiveHeroSlide] = useState(0);

  // THE CATEGORIES ON THE FRONT PAGE ARE THE SHOP'S OWN CATEGORIES.
  //
  // They used to be a hard-coded list of twenty — Beachflags, Sun sails, Tents,
  // Neons Flex — drawn as emoji and every one of them linking to /products with
  // no filter. None of them existed in the catalogue. A visitor picked "Tents"
  // and landed on everything, and the owner could add or rename a category all
  // day without the front page ever noticing. It now reads the same collection
  // the shop page reads, hides what the owner hid, and each tile filters the
  // shop to that category.
  const [categories, setCategories] = useState<Category[]>([]);
  // Both reads failed: say so, and offer a retry, instead of grey placeholders for
  // ever — which is what a visitor saw whenever the server and Firestore were both
  // out of reach (2026-10-13).
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [categoriesAttempt, setCategoriesAttempt] = useState(0);

  // From the server, not from Firestore. This page and the shop page each read
  // the whole collection per visitor, and on 2026-09-12 the project's free daily
  // read quota ran out — the shop page rendered "0 categories" to real visitors.
  // /api/categories is read once every five minutes and shared by everybody. The
  // direct read stays behind it so the page degrades to its old behaviour rather
  // than to an empty grid.
  useEffect(() => {
    let cancelled = false;
    setCategoriesFailed(false);
    (async () => {
      try {
        const resp = await fetch('/api/categories');
        const data = resp.ok ? await resp.json() : null;
        if (Array.isArray(data?.categories) && data.categories.length > 0) {
          if (!cancelled) setCategories(data.categories as Category[]);
          return;
        }
      } catch { /* fall through to the direct read */ }
      try {
        const snap = await getDocs(collection(db, 'categories'));
        if (cancelled) return;
        setCategories(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as Category)
            .filter((c) => c.isHidden !== true),
        );
      } catch (err) {
        console.warn('Notice loading categories for the home page:', err);
        if (!cancelled) setCategoriesFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoriesAttempt]);

  // The owner's order first (he drags categories into it in the dashboard —
  // src/lib/ownerOrder.ts), then the name the visitor actually reads, not the
  // English original: a Swedish grid sorted on English words is sorted by
  // nothing the customer can see. Done here rather than in the fetch so
  // switching language reorders the tiles without going back to Firestore.
  //
  // In TREE order: `sortOrder` places a category among its own siblings, so one
  // flat sort would lift arranged sub-categories above every main category.
  // THE MAIN CATEGORIES ONLY, in the owner's order (2026-10-13). The whole tree
  // used to be flattened onto the front page, so one "Promotional products" with
  // nine sub-categories became ten tiles and buried the top sellers. Its
  // sub-categories are one click away on its own page. Hidden ones never show.
  // Only categories with NO parent: the tree lifts a sub-category whose parent is
  // hidden (so absent here) to the top level, and it would show as a main tile.
  const sortedCategories = useMemo(
    () =>
      buildCategoryTree(
        categories.filter((c) => c.isHidden !== true && c.hiddenOnHome !== true && !c.parentId),
        (c) => localized(c.name || '', c.nameI18n, language),
      ).map((n) => n.category),
    [categories, language],
  );

  const siteName = settings.siteName || 'ReklamX';
  // THE PAGE'S ONE HEADING. The home page leads with pictures and had no <h1> at
  // all (the client's audit, 2026-10-10). It is the same words as the page's
  // title — his own home title when he wrote one, else the shipped one — kept
  // for screen readers and search engines rather than drawn over the design.
  const seoSettings = settings.seo as Partial<SeoSettings> | undefined;
  const seoLang: SeoLang = (['sv', 'en', 'da', 'no'] as const).includes(language as SeoLang) ? (language as SeoLang) : 'en';
  const homeHeading = seoText(seoSettings?.pages?.['/']?.title, seoLang) || SEO_PAGES.find((p) => p.path === '/')?.title || siteName;

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-gray-900 font-sans relative selection:bg-orange-500 selection:text-white pb-24" dir="ltr">
      <h1 className="sr-only" data-rx-home-heading>{homeHeading}</h1>
      
      {/* Floating Right Dock / Sidebar Actions */}
      <div className="fixed top-1/2 -translate-y-1/2 right-0 items-end z-40 hidden xl:flex flex-col shadow-2xl rounded-l-2xl overflow-hidden">
        <Link 
          to="/products" 
          title="Go to Shop"
          className="w-14 h-14 bg-orange-600 hover:bg-orange-500 text-white shadow-lg flex items-center justify-center transition-all group"
        >
          <ShoppingCart className="w-6 h-6 transition-transform duration-200 group-hover:scale-125" />
        </Link>

        {/*
          FOUR BUTTONS THAT DID NOTHING, NOW TWO LINKS THAT GO SOMEWHERE.

          Newsletter, Contact, Samples and Specification were plain <button>s
          with no onClick between them — they highlighted on hover, grew their
          icon, and swallowed the click. Two of the four named things this shop
          genuinely has, so those are now links to them. "Newsletter" and
          "Samples" named things it does not have at all: there is no mailing
          list to join and no sample service to request, and pointing them at
          some nearby page would only move the disappointment one click later.
          They are gone until those features exist.
        */}
        <div className="bg-[#2d323e]/95 backdrop-blur-md p-2 text-white space-y-2 w-14 border-gray-700/50 flex flex-col items-center border-l border-b border-t border-t-gray-700/40">
          <Link to="/contact" title={t('contact')} className="p-2 hover:bg-white/10 rounded-xl transition-all text-gray-300 hover:text-orange-400 group">
            <Phone className="w-5 h-5 transition-transform duration-200 group-hover:scale-125" />
          </Link>
          <Link to="/custom-upload" title={t('footerUploadFile')} className="p-2 hover:bg-white/10 rounded-xl transition-all text-gray-300 hover:text-orange-400 group">
            <FileText className="w-5 h-5 transition-transform duration-200 group-hover:scale-125" />
          </Link>
        </div>
      </div>

      {/* Main Content Showcase */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 space-y-16">

        {/* THE SECTIONS IN HIS ORDER (UI Customizer → Page Sections, 2026-10-07);
            homeSectionOrder adds any section he never placed at the end. */}
        {homeSectionOrder(settings.homeSectionOrder).map((id) => (
          <React.Fragment key={id}>
            {
              id === 'hero' ? (
                <>
                {/* SECTION 1: THE OPENING — intro and a shelf of campaign cards
                    (HeroShelf.tsx, after HelloPrint's front page, 2026-10-14). */}
                <HeroShelf />
                </>
              ) : 
              id === 'categories' ? (
                <>
                {/* SECTION 2: PRODUCT CATEGORIES GRID ("PRODUCTS")
                    Hidden by the "Categories Grid" switch — another one that used to be
                    saved and never read. */}
                {settings.showCategoriesSection !== false && (
                <section className="space-y-6 pt-6">
                  <div className="text-center">
                    <h2 className="text-2xl sm:text-3xl font-black text-gray-900 uppercase tracking-widest">
                      {t('productCategories')}
                    </h2>
                    <div className="w-16 h-1.5 bg-orange-600 mx-auto mt-2 rounded-full" />
                  </div>

                  {/* One tile per real category. Four across, so eight categories land as
                      two even rows — the old five-across grid was built for a list of
                      twenty that no longer exists. */}
                  {sortedCategories.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
                      {sortedCategories.map((cat) => (
                        <Link
                          key={cat.id}
                          to={`/products?category=${encodeURIComponent(cat.id)}`}
                          className="bg-white rounded-3xl border border-gray-200/90 shadow-2xs hover:shadow-xl hover:border-orange-500 hover:-translate-y-1.5 transition-all group overflow-hidden flex flex-col"
                        >
                          {/* The square stays — a grid of cards has to line up, and a
                              card whose height follows its picture breaks every row it
                              is in. What changed is object-cover -> object-contain, the
                              same fix the product cards got: the square decides the
                              SPACE, never the crop.

                              object-cover here was throwing away 38% of the ROLLUPS
                              photo. That image is 656x1060 — the only portrait one in
                              the collection — so cover scaled it to 286x462 inside a
                              286px window and painted only the middle band, which on
                              that particular photo is a featureless grey panel. The
                              owner reported it as "the image is not showing fully",
                              and he was right: it was a real picture, cropped to its
                              least recognisable part. */}
                          <div className="aspect-square overflow-hidden bg-gray-50 p-3">
                            {/* Rounded to match the card: 12px = its 24px corner less the 12px padding. */}
                            <div className="w-full h-full rounded-xl overflow-hidden">
                              <SafeImage
                                src={cat.image || '/placeholder-print.svg'}
                                alt={localized(cat.name, cat.nameI18n, language)}
                                fallbackLabel={localized(cat.name, cat.nameI18n, language)}
                                // A stock PHOTO fills the tile; anything else — a product
                                // cut-out, the owner's own upload — is shown whole, per the
                                // complaint above (2026-10-14).
                                className={cn(
                                  'w-full h-full group-hover:scale-105 transition-transform duration-500',
                                  /^https:\/\/images\.(pexels|unsplash)\.com\//.test(cat.image || '') ? 'object-cover' : 'object-contain bg-white p-4',
                                )}
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          </div>
                          <div className="p-5 text-center space-y-1.5 flex-1 flex flex-col justify-center">
                            <span className="block text-base font-black text-gray-900 leading-snug group-hover:text-orange-600 transition-colors">
                              {localized(cat.name, cat.nameI18n, language)}
                            </span>
                            {localized(cat.description || '', cat.descriptionI18n, language) && (
                              <span className="block text-xs font-bold text-gray-400 line-clamp-2 group-hover:text-gray-500 transition-colors">
                                {localized(cat.description || '', cat.descriptionI18n, language)}
                              </span>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : categoriesFailed ? (
                    <div className="rounded-3xl border border-gray-200/90 bg-white px-6 py-12 text-center" role="status">
                      <p className="text-base font-semibold text-gray-900">{t('homeCategoriesFailed')}</p>
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
                        <button
                          type="button"
                          onClick={() => setCategoriesAttempt((n) => n + 1)}
                          className="inline-flex items-center gap-2 bg-gray-900 hover:bg-orange-700 text-white text-sm font-bold px-5 py-3 rounded-full transition-colors"
                        >
                          {t('homeCategoriesRetry')}
                        </button>
                        <Link to="/products" className="text-sm font-semibold text-gray-700 hover:text-gray-900 underline-offset-4 hover:underline py-2">
                          {t('heroBrowseAll')}
                        </Link>
                      </div>
                    </div>
                  ) : (
                    /* Placeholders while the categories load, so the page does not jump
                       once they arrive. */
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
                      {[0, 1, 2, 3].map((n) => (
                        <div key={n} className="bg-white rounded-3xl border border-gray-200/90 overflow-hidden">
                          <div className="aspect-square bg-gray-100 animate-pulse" />
                          <div className="p-5 space-y-2">
                            <div className="h-4 bg-gray-100 rounded animate-pulse" />
                            <div className="h-3 bg-gray-50 rounded animate-pulse w-2/3 mx-auto" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  </section>
                )}
                </>
              ) : 
              id === 'inspiration' ? (
                <>
                {/* SECTION 3: VISUAL INSPIRATION SHOWCASE ("find INSPIRATION")

                    These were three 16:10 letterbox panels with the caption printed over
                    the picture — wide enough that a photo of a business card arrived
                    cropped top and bottom, and a different shape from every product card
                    in the shop. Each is now the shop's own card: a SQUARE picture with
                    the caption underneath, which makes the card itself portrait. */}
                <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 pt-6">
          
                  {/* Inspiration 1 */}
                  <div className="bg-white rounded-3xl overflow-hidden group shadow-lg border border-gray-200 flex flex-col">
                    <div className="relative aspect-square overflow-hidden bg-gray-50">
                      <SafeImage 
                        src="https://images.pexels.com/photos/19518876/pexels-photo-19518876.jpeg?auto=compress&cs=tinysrgb&w=1200" 
                        alt="Find Inspiration Signage"
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="p-5 space-y-1">
                      <span className="text-xs font-black text-orange-700 uppercase tracking-widest block">
                        {`${siteName} ${t('gallery')}`}
                      </span>
                      <h3 className="text-lg sm:text-xl font-black text-gray-900 uppercase tracking-tight">
                        {t('findInspiration')}
                      </h3>
                    </div>
                  </div>

                  {/* Inspiration 2 */}
                  <div className="bg-white rounded-3xl overflow-hidden group shadow-lg border border-gray-200 flex flex-col">
                    <div className="relative aspect-square overflow-hidden bg-gray-50">
                      <SafeImage 
                        src="https://images.pexels.com/photos/9594420/pexels-photo-9594420.jpeg?auto=compress&cs=tinysrgb&w=1200" 
                        alt="Custom Packaging Box"
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="p-5 space-y-1">
                      <span className="text-xs font-black text-orange-700 uppercase tracking-widest block">
                        {t('customPackaging')}
                      </span>
                      <h3 className="text-lg sm:text-xl font-black text-gray-900 uppercase tracking-tight">
                        {t('luxuryPackagingBoxes')}
                      </h3>
                    </div>
                  </div>

                  {/* Inspiration 3 */}
                  <div className="bg-white rounded-3xl overflow-hidden group shadow-lg border border-gray-200 flex flex-col">
                    <div className="relative aspect-square overflow-hidden bg-gray-50">
                      <SafeImage 
                        src="https://images.pexels.com/photos/35826570/pexels-photo-35826570.jpeg?auto=compress&cs=tinysrgb&w=1200" 
                        alt="Storefront Poster Mockup"
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="p-5 space-y-1">
                      <span className="text-xs font-black text-orange-700 uppercase tracking-widest block">
                        {t('storefrontSignage')}
                      </span>
                      <h3 className="text-lg sm:text-xl font-black text-gray-900 uppercase tracking-tight">
                        {t('highPrecisionPrinting')}
                      </h3>
                    </div>
                  </div>

                </section>
                </>
              ) : 
              id === 'benefits' ? (
                <>
                {/* SECTION 4: BENEFITS BAR ("THE BENEFITS OF WORKING WITH US")
                    This is the row the admin panel calls the "Stats Bar" — the 24/7,
                    450+, coverage and lead-time numbers. Its switch was saved and never
                    read either. */}
                {settings.showStatsSection !== false && (
                <section className="bg-white rounded-3xl p-8 border border-gray-200 shadow-sm space-y-6">
                  <div className="text-center">
                    <h2 className="text-xl font-black text-gray-900 uppercase tracking-widest">
                      {t('benefitsTitle')}
                    </h2>
                    <div className="w-12 h-1 bg-orange-600 mx-auto mt-2 rounded-full" />
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-6 text-center pt-4">
            
                    <div className="space-y-3 flex flex-col items-center">
                      <div className="h-16 flex items-center justify-center text-orange-600 font-black text-4xl tracking-tight">
                        24/7
                      </div>
                      <span className="block text-xs font-black text-gray-900 uppercase">
                        {t('produce247')}
                      </span>
                    </div>

                    <div className="space-y-3 flex flex-col items-center">
                      <div className="h-16 flex items-center justify-center text-orange-600 font-black text-4xl tracking-tight">
                        450+
                      </div>
                      <span className="block text-xs font-black text-gray-900 uppercase">
                        {t('over450Specialists')}
                      </span>
                    </div>

                    <div className="space-y-3 flex flex-col items-center">
                      <div className="h-16 flex items-center justify-center text-orange-600 font-black text-4xl tracking-tight">
                        <MapPin className="w-12 h-12" strokeWidth={1.75} />
                      </div>
                      <span className="block text-xs font-black text-gray-900 uppercase">
                        {t('wideAreaCoverage')}
                      </span>
                    </div>

                    <div className="space-y-3 flex flex-col items-center">
                      <div className="h-16 flex items-center justify-center text-orange-600 font-black text-4xl tracking-tight">
                        <CalendarCheck className="w-12 h-12" strokeWidth={1.75} />
                      </div>
                      <span className="block text-xs font-black text-gray-900 uppercase">
                        {t('shortLeadTime')}
                      </span>
                    </div>

                    <div className="space-y-3 flex flex-col items-center col-span-2 md:col-span-1">
                      <div className="h-16 flex items-center justify-center text-orange-600 font-black text-4xl tracking-tight">
                        <ShieldCheck className="w-12 h-12" strokeWidth={1.75} />
                      </div>
                      <span className="block text-xs font-black text-gray-900 uppercase">
                        {t('fullService')}
                      </span>
                    </div>

                  </div>
                </section>
                )}
                </>
              ) : 
              (
                <>
                {/* SECTION 5: NEWS — an editorial list (Stripe / Grok newsroom
                    pattern on Mobbin, 2026-10-14): heading left, "all news"
                    right, then full-width rows split by hairlines: label |
                    title + lead | picture. No badges, no dark slab. These are
                    campaign notes, not articles, so each row opens the shop. */}
                <section className="bg-white rounded-3xl border border-gray-200 shadow-sm px-6 py-8 md:px-10 md:py-12">
                  <div className="flex items-end justify-between gap-4 pb-6 md:pb-8 border-b border-gray-200">
                    <h2 className="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-gray-900">
                      {t('latestNews')}
                    </h2>
                    <Link
                      to="/products"
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-orange-600 hover:text-orange-700 transition-colors"
                    >
                      {t('allPosts')}
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>

                  <ul className="divide-y divide-gray-200">
                    {NEWS_ITEMS.map((item) => (
                      <li key={item.id}>
                        <Link
                          to={item.link}
                          className="group grid grid-cols-1 md:grid-cols-[9.375rem_1fr_16.25rem] gap-4 md:gap-8 py-8 items-start"
                        >
                          <span className="text-sm font-medium text-orange-700 md:pt-1.5">{t(item.label)}</span>
                          <div className="min-w-0">
                            <h3 className="text-xl md:text-2xl font-semibold tracking-tight leading-snug text-gray-900 group-hover:text-orange-700 transition-colors">
                              {t(item.title)}
                            </h3>
                            <p className="mt-3 text-base leading-relaxed text-gray-600 max-w-prose">{t(item.text)}</p>
                            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-gray-900">
                              {t('readMore')}
                              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                            </span>
                          </div>
                          <div className="order-first md:order-none aspect-[16/10] rounded-2xl overflow-hidden bg-gray-100">
                            <SafeImage
                              src={item.image}
                              alt=""
                              loading="lazy"
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
                </>
              )
            }
          </React.Fragment>
        ))}

      </main>

      {/*
        The bouncing bell that used to float here is gone.
        It had no onClick. It bounced in the bottom-left corner of every visit
        to the home page, on top of the category cards on a phone — it sat over
        the "Gift boxes" and "Banners & Large Format" labels — and tapping it
        did nothing whatsoever, because there was nothing behind it: no offers
        panel, no route, not even a scroll target. A control that advertises
        "special offers" and then ignores the tap is worse than no control, so
        it is removed rather than wired to something invented here. The running
        campaign is already announced, in words, in the bar across the top of
        every page.
      */}

    </div>
  );
}
