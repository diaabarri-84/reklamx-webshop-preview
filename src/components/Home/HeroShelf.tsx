// THE FRONT PAGE'S OPENING (2026-10-14) — after HelloPrint's: a plain intro
// (what the shop is, how much it carries, why buy here, what customers say),
// then a SHELF of large campaign cards that scrolls sideways. The first card is
// the wide one; the next card always peeks in at the edge, so it reads as "more
// this way" without a word.
//
// The cards are the owner's own: his hero slides first (UI Customizer → hero
// slides: eyebrow, title, subtitle, picture, price, link), then his category
// tiles (UI Customizer → bento cards). Nothing here is invented copy.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Star } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSiteSettings, type BentoCardSetting } from '../../context/SiteSettingsContext';
import { useAuth } from '../../App';
import { localized } from '../../lib/localizedText';
import SafeImage from '../SafeImage';
import type { TranslationKey } from '../../lib/translations';

const USPS: TranslationKey[] = ['uspProduce247', 'uspLeadTime', 'uspFullService', 'uspPersonal'];

/** The shop's Google rating and where its reviews are (the owner, 2026-10-14). Update both here. */
const GOOGLE_RATING = 4.7;
const GOOGLE_REVIEWS_URL =
  'https://www.google.com/search?sxsrf=APpeQnv-wOWHOkRMt_1Lg_g-45wKDGfiqg:1791969663702&q=reklamx&si=APenkKm7iecQ4G6P-TsbSMFKIQtv3EFIqRAFw-i8uEbk55Z-_75TMkGE_g59cWroqq2lESKrGzMML0Wnv2Gbotc4AysRyT-LPeHCbGYMVcarcl5o6MYEehY%3D&uds=AJ5uw1-NJiCKB2vgbZj6OMiVQNpxFlu8hGBUI6sQJwjAFhpRS7LLj6AhfYCT8Vir0-LkNhq9Q1xtfw3SAI10lM_pFi5a4K5-yg0niHz_MmlrOkk3V8ScE14';

/** Google's "G", so the score says where it comes from. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="w-5 h-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** A same-site path, or the shop. An owner-typed link never leaves the site. */
const safeLink = (link?: string) => (link && link.startsWith('/') && !link.startsWith('//') ? link : '/products');

/** No picture yet (or the shipped placeholder): the card shows the brand instead of an empty frame. */
const hasPicture = (url?: string) => !!url && !url.endsWith('/placeholder-print.svg');

interface ShelfCard {
  id: string;
  title: string;
  subtitle: string;
  eyebrow: string;
  image?: string;
  price: string | null;
  link: string;
  cta: string;
}

export default function HeroShelf() {
  const { settings } = useSiteSettings();
  const { t, language, formatPriceWithVat } = useAuth();

  // How many products the shop really carries, rounded DOWN to the hundred, for
  // the headline. Without an answer the headline says it without a number.
  const [productCount, setProductCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/catalogue/counts')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && typeof d?.total === 'number') setProductCount(d.total); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const locale = ({ sv: 'sv-SE', da: 'da-DK', no: 'nb-NO' } as Record<string, string>)[language] ?? 'en-GB';
  const headline = productCount !== null && productCount >= 100
    ? t('heroIntroTitle').replace('{n}', new Intl.NumberFormat(locale).format(Math.floor(productCount / 100) * 100))
    : t('heroIntroTitleNoCount');

  const rating = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(GOOGLE_RATING);

  const slides = settings.showHero !== false
    ? (settings.heroSlides && settings.heroSlides.length > 0
        ? settings.heroSlides
        : [{
            id: 's1',
            imageUrl: settings.heroImageUrl || 'https://images.pexels.com/photos/38041486/pexels-photo-38041486.jpeg?auto=compress&cs=tinysrgb&w=2000',
            title: t('heroOfferTitle'),
            subtitle: t('heroOfferSubtitle'),
            badge: t('heroOfferEyebrow'),
            priceSek: 995,
            link: '/products',
          }])
    : [];
  const defaultBento: BentoCardSetting[] = [
    { id: 'b1', title: t('giftBoxes'), imageUrl: 'https://images.pexels.com/photos/33629669/pexels-photo-33629669.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b2', title: t('customLabels'), imageUrl: 'https://images.pexels.com/photos/33490518/pexels-photo-33490518.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b3', title: t('exhibitionStands'), imageUrl: 'https://images.pexels.com/photos/12705461/pexels-photo-12705461.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b4', title: t('paperCups'), imageUrl: 'https://images.pexels.com/photos/6569972/pexels-photo-6569972.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b5', title: t('doypacks'), imageUrl: 'https://images.pexels.com/photos/16100293/pexels-photo-16100293.jpeg?auto=compress&cs=tinysrgb&w=900' },
    { id: 'b6', title: t('illuminatedAd'), imageUrl: 'https://images.pexels.com/photos/35091448/pexels-photo-35091448.jpeg?auto=compress&cs=tinysrgb&w=900' },
  ];
  const bento = settings.bentoCards && settings.bentoCards.length === 6 ? settings.bentoCards : defaultBento;

  // The owner types these in the dashboard, so they are data, not UI chrome —
  // t() cannot reach them; localized() resolves what HE typed.
  const cards: ShelfCard[] = [
    ...slides.map((s) => {
      const price = typeof s.priceSek === 'number' && s.priceSek > 0 ? formatPriceWithVat(s.priceSek).formatted : null;
      return {
        id: `slide-${s.id}`,
        title: localized(s.title || '', s.titleI18n, language),
        subtitle: localized(s.subtitle || '', s.subtitleI18n, language),
        eyebrow: localized(s.badge || '', s.badgeI18n, language),
        image: s.imageUrl,
        price,
        link: safeLink(s.link),
        cta: price ? t('heroOfferCta') : t('heroSeeProducts'),
      };
    }),
    ...bento.map((b) => ({
      id: `tile-${b.id}`,
      title: localized(b.title, b.titleI18n, language),
      subtitle: '',
      eyebrow: '',
      image: b.imageUrl,
      price: null,
      link: '/products',
      cta: t('heroSeeProducts'),
    })),
  ];

  // The arrows: one card's width per press. Shown only where there is somewhere to go.
  const shelf = useRef<HTMLUListElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const measure = useCallback(() => {
    const el = shelf.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, cards.length]);
  const step = (dir: 1 | -1) => {
    const el = shelf.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('li:nth-child(2)') ?? el.querySelector<HTMLElement>('li');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? el.clientWidth) + 16), behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section className="space-y-8">
      {/* The intro: the headline with help beside it, then the reasons in one row. */}
      <div>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-gray-900 leading-[1.1] max-w-3xl text-balance">
            {headline}
          </p>
          {/* The shop's Google rating, as HelloPrint shows its Trustpilot score. No
              review count: the owner asked for the score only. Opens Google's own
              listing of the reviews, so anyone can check it. */}
          <a
            href={GOOGLE_REVIEWS_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('reviewsAria').replace('{r}', rating)}
            className="group shrink-0 inline-flex items-center gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-3.5 shadow-sm hover:border-orange-600 transition-colors"
          >
            <span className="text-lg font-semibold text-gray-900">{t('reviewsExcellent')}</span>
            <span className="relative inline-flex" aria-hidden>
              <span className="flex gap-0.5 text-gray-200">
                {[0, 1, 2, 3, 4].map((i) => <Star key={i} className="w-5 h-5 fill-current" strokeWidth={0} />)}
              </span>
              <span className="absolute inset-y-0 left-0 flex gap-0.5 overflow-hidden text-orange-600" style={{ width: `${(GOOGLE_RATING / 5) * 100}%` }}>
                {[0, 1, 2, 3, 4].map((i) => <Star key={i} className="w-5 h-5 shrink-0 fill-current" strokeWidth={0} />)}
              </span>
            </span>
            <span className="text-lg font-bold tabular-nums text-gray-900">{rating}</span>
            <span className="inline-flex items-center gap-1.5 text-base text-gray-700 group-hover:text-gray-900">
              {t('reviewsOn')}
              <GoogleMark />
            </span>
          </a>
        </div>
        <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
          {USPS.map((key) => (
            <li key={key} className="flex items-center gap-2.5 text-base text-gray-800">
              <span className="flex w-5 h-5 shrink-0 items-center justify-center rounded-full bg-orange-600 text-white">
                <Check className="w-3.5 h-3.5" strokeWidth={3} />
              </span>
              {t(key)}
            </li>
          ))}
        </ul>
      </div>

      {/* The shelf. */}
      <div className="relative">
        <ul
          ref={shelf}
          onScroll={measure}
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {cards.map((card, i) => {
            const wide = i === 0;
            return (
              <li
                key={card.id}
                className={cn(
                  'snap-start shrink-0',
                  wide ? 'w-[86%] md:w-[62%] lg:w-[calc(50%-0.5rem)]' : 'w-[78%] sm:w-[48%] md:w-[38%] lg:w-[calc(25%-0.75rem)]',
                )}
              >
                <Link
                  to={card.link}
                  className="group relative flex h-[28rem] sm:h-[30rem] lg:h-[31rem] flex-col overflow-hidden rounded-[1.75rem] bg-[#1e232d] text-white"
                >
                  {hasPicture(card.image) ? (
                    <SafeImage
                      src={card.image!}
                      alt=""
                      priority={wide}
                      loading={wide ? undefined : 'lazy'}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    // The brand instead of an empty frame, until the owner adds a picture.
                    <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_80%_at_100%_100%,#9c7b44_0%,#3a3a3a_45%,#1e232d_75%)]" />
                  )}
                  {/* Dark only behind the words: the top, and the button's corner. */}
                  <div className="absolute inset-x-0 top-0 h-3/4 bg-gradient-to-b from-black/85 via-black/55 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />

                  <div className="relative z-10 p-7 lg:p-9">
                    {card.eyebrow && (
                      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-orange-300">{card.eyebrow}</p>
                    )}
                    <p className={cn(
                      'font-bold tracking-tight leading-[1.08] text-balance',
                      card.eyebrow && 'mt-3',
                      wide ? 'text-4xl lg:text-5xl max-w-xl' : 'text-3xl lg:text-[2.125rem]',
                    )}>
                      {card.title}
                    </p>
                    {card.subtitle && (
                      <p className="mt-4 text-base lg:text-lg text-white/90 leading-relaxed max-w-md">{card.subtitle}</p>
                    )}
                  </div>

                  {/* The offer, across the card like a sticker on the print. */}
                  {card.price && (
                    <p className="absolute z-10 left-0 right-0 bottom-24 lg:bottom-28 -rotate-3 origin-left bg-orange-600 px-7 lg:px-9 py-3.5 flex items-baseline gap-3 shadow-lg">
                      <span className="text-lg font-medium text-white/90">{t('heroOfferFrom')}</span>
                      <span className="text-4xl lg:text-5xl font-black tabular-nums tracking-tight">{card.price}</span>
                    </p>
                  )}

                  <span className="absolute z-10 left-7 bottom-7 lg:left-9 lg:bottom-9 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-base font-semibold text-gray-900 transition-colors group-hover:bg-orange-600 group-hover:text-white">
                    {card.cta}
                    <ArrowRight className="w-4 h-4" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* The arrows sit over the shelf's edges, pointer screens only — a phone swipes. */}
        {canPrev && (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t('heroPrev')}
            className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 w-14 h-14 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur hover:bg-black/80 transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
        )}
        {canNext && (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t('heroNext')}
            className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 w-14 h-14 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur hover:bg-black/80 transition-colors"
          >
            <ArrowRight className="w-6 h-6" />
          </button>
        )}
      </div>
    </section>
  );
}
