import React, { useState } from 'react';
import { BarChart3, Cloud, FileCode2, Megaphone, Search, ShoppingBag } from 'lucide-react';
import MarketingAdmin from './MarketingAdmin';
import GoogleAdmin from './GoogleAdmin';
import SeoAdmin, { type SeoSection } from './SeoAdmin';

/**
 * Everything Google, in one place.
 *
 * It used to be two tabs — "Google Drive" and "Google Ads & SEO" — sitting apart
 * in the sidebar, with the SEO half being a read-only note saying the shop had
 * already taken care of it. The owner's request was plain: "make me the settings
 * for all of them in the dashboard and I'll enter them myself, I'll work on them
 * at night." So this is one door with six rooms behind it, and nothing behind it
 * needs us.
 *
 * The sub-tabs are rendered from ONE position in the tree on purpose: switching
 * between the four SEO screens keeps the same <SeoAdmin> mounted, so a draft
 * half-typed on one screen is still there after a look at another. Losing an
 * edit by clicking the wrong tab is the kind of small betrayal that stops
 * somebody using a screen at all.
 */

type Tab = 'ads' | SeoSection | 'drive';

const TABS: { id: Tab; label: string; icon: React.ReactNode; blurb: string }[] = [
  { id: 'ads', label: 'Ads & Analytics', icon: <Megaphone className="w-4 h-4" />, blurb: 'Conversion tracking, visitor numbers, Tag Manager' },
  { id: 'search', label: 'Search Console', icon: <BarChart3 className="w-4 h-4" />, blurb: 'Prove the site is yours, and how it introduces itself' },
  { id: 'pages', label: 'Page text', icon: <Search className="w-4 h-4" />, blurb: 'The title and description Google shows for each page' },
  { id: 'robots', label: 'robots & sitemap', icon: <FileCode2 className="w-4 h-4" />, blurb: 'What crawlers may read, and the list handed to Google' },
  { id: 'merchant', label: 'Shopping', icon: <ShoppingBag className="w-4 h-4" />, blurb: 'The product feed for Merchant Center' },
  { id: 'drive', label: 'Drive', icon: <Cloud className="w-4 h-4" />, blurb: 'File every paid order in your own Google Drive' },
];

const SEO_TABS: Tab[] = ['search', 'pages', 'robots', 'merchant'];

export default function GoogleHubAdmin() {
  const [tab, setTab] = useState<Tab>('ads');
  const active = TABS.find((t) => t.id === tab);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={
                'flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[0.75rem] font-black transition-colors ' +
                (tab === t.id
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50')
              }
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        {active && (
          <p className="px-4 pt-1 pb-2 text-[0.6875rem] font-bold text-gray-400">{active.blurb}</p>
        )}
      </div>

      {tab === 'ads' && <MarketingAdmin />}
      {tab === 'drive' && <GoogleAdmin />}
      {SEO_TABS.includes(tab) && <SeoAdmin section={tab as SeoSection} />}
    </div>
  );
}
