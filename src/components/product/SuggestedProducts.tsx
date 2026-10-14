import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../App';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { Product } from '../../types';
import { localized } from '../../lib/localizedText';
import { productPath } from '../../lib/slug';
import { cardPrices } from '../../lib/cardPrice';
import { cleanPickIds, suggestionModeOf } from '../../lib/suggestions';
import { cn, safeImageSrc } from '../../lib/utils';
import SafeImage from '../SafeImage';
import VatTag from '../VatTag';

/**
 * "You might also like" — the row of suggested products under a product
 * (round 16, item 10). What it holds is the owner's: his picks for this product,
 * then — if UI Customizer → Page Sections says so — the products after this one in its category
 * (src/lib/suggestions.ts, answered by /api/catalogue/suggestions, which never
 * reads Firestore for it).
 *
 * Nothing at all while loading, on an error, or with nothing to suggest: it sits
 * below everything that matters on the page, and a frame waiting for cards
 * would only move the footer.
 */
export default function SuggestedProducts({ product }: { product: Product }) {
  const { language, t, formatPriceWithVat } = useAuth();
  const { settings, loading: settingsLoading } = useSiteSettings();
  const mode = suggestionModeOf(settings.productSuggestions);
  const [shown, setShown] = useState<{ forId: string; products: Product[] } | null>(null);

  const picks = cleanPickIds(product.relatedProductIds, product.id).join(',');
  const categoryId = String(product.categoryId ?? '');

  useEffect(() => {
    // His setting decides whether to ask at all — so not before it has arrived;
    // and "only my picks" with none picked has nothing to ask about.
    if (settingsLoading || mode === 'off' || (mode === 'picks' && !picks)) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ exclude: product.id, fill: mode === 'fill' ? '1' : '0' });
    if (picks) params.set('ids', picks);
    if (categoryId) params.set('category', categoryId);
    fetch(`/api/catalogue/suggestions?${params.toString()}`, { signal: controller.signal })
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        // Answers are tagged with the product they were for: a late answer for
        // the product the shopper just left must not land on this one.
        if (Array.isArray(data?.products)) setShown({ forId: product.id, products: data.products as Product[] });
      })
      .catch(() => { /* a suggestion row is optional; nothing is shown */ });
    return () => controller.abort();
  }, [product.id, picks, categoryId, mode, settingsLoading]);

  if (mode === 'off' || (mode === 'picks' && !picks) || !shown || shown.forId !== product.id || shown.products.length === 0) return null;

  return (
    <section aria-labelledby="rx-suggested-heading" className="pt-6 space-y-4" data-rx-suggestions>
      <h2 id="rx-suggested-heading" className="text-lg sm:text-xl font-black text-gray-900 tracking-tight">
        {t('ppSuggestedHeading')}
      </h2>
      {/* role="list": Safari drops a list's meaning once its bullets are gone. */}
      <ul role="list" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {shown.products.map((p) => {
          const name = localized(p.name, p.nameI18n, language);
          const card = cardPrices(p);
          const price = formatPriceWithVat(card.price);
          const list = card.listPrice !== null ? formatPriceWithVat(card.listPrice) : null;
          return (
            <li key={p.id}>
              {/* ONE link per card: the whole card is the way to the product. */}
              <Link
                to={productPath(p)}
                className="group relative flex flex-col h-full bg-white rounded-3xl border border-gray-200/80 shadow-2xs hover:shadow-xl hover:border-orange-300 transition-all overflow-hidden"
                data-rx-suggestion={p.id}
              >
                <span className="aspect-square bg-gray-50 p-3 block">
                  {/* A picture that fails to load is dropped, not replaced by a
                      labelled placeholder: the link already says the name, and a
                      screen reader would read it twice. */}
                  <span className="block w-full h-full rounded-xl overflow-hidden">
                    <SafeImage
                      src={safeImageSrc(p.images?.[0]) ?? '/placeholder-print.svg'}
                      alt=""
                      hideOnError
                      className="w-full h-full object-contain group-hover:scale-[1.04] transition-transform duration-500"
                    />
                  </span>
                </span>
                {card.onSale && (
                  <span className="absolute top-3 left-3 bg-red-600 text-white text-[0.5625rem] font-black px-2.5 py-1 rounded-lg uppercase tracking-wider shadow-sm">
                    {t('shopSaleBadge').replace('{0}', String(card.offPercent))}
                  </span>
                )}
                <span className="p-4 flex-1 flex flex-col justify-between gap-2">
                  <span className="text-sm font-black text-gray-900 group-hover:text-orange-600 transition-colors leading-snug line-clamp-2">
                    {name}
                  </span>
                  <span>
                    <span className="text-[0.625rem] text-gray-400 block uppercase font-black tracking-widest">{t('shopPriceFrom')}</span>
                    <span className="flex items-baseline gap-1.5 flex-wrap">
                      <span className={cn('text-base font-black', card.onSale ? 'text-red-600' : 'text-gray-900')}>{price.formatted}</span>
                      {list && <span className="text-xs font-bold text-gray-400 line-through">{list.formatted}</span>}
                    </span>
                    <VatTag className="block" />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
