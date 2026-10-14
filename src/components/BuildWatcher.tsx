import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { TranslationKey } from '../lib/translations';
import { reloadsHeld } from '../lib/reloadHold';

/**
 * KEEPS AN OPEN SHOP UP TO DATE WITHOUT ANYONE PRESSING REFRESH.
 *
 * A deploy changes the fingerprinted bundle name, but a browser that already has
 * the page will happily keep the old one for as long as the tab is open, and a
 * returning visitor could be served a cached shell pointing at it. So a customer
 * would be quoted last week's prices with nothing on screen to suggest it — the
 * reason the shop had to be reloaded by hand after every deploy.
 *
 * `/api/version` reports the build the server is actually serving. This asks
 * once on mount, remembers the answer, and asks again from time to time; a
 * different answer means a deploy landed under the page's feet.
 *
 * WHAT IT DOES ABOUT IT is deliberately cautious, because a reload throws away
 * whatever the customer had typed or chosen:
 *
 *   - Only on a page that holds nothing of his — the home page, the product
 *     list, the services, about and legal pages — does it reload by itself, and
 *     only at a free moment: coming back to the tab, or after two minutes of
 *     nobody touching it.
 *   - Everywhere else it only offers: a small bar the customer presses when he
 *     is ready. A product page holds his options, a file uploading, a design in
 *     the studio; the checkout a half-filled address. It reloaded all of those
 *     silently except the checkout (code review WEB-07 / DSN-08).
 *   - The same bar, on any page, while something holds the reload (a product
 *     being configured, a design open, a file still uploading —
 *     src/lib/reloadHold.ts).
 */

/** How often to ask, while the tab is in front. */
const POLL_MS = 5 * 60 * 1000;
/** Silence long enough that a reload cannot interrupt anything. */
const IDLE_MS = 2 * 60 * 1000;
/**
 * The pages a reload cannot lose anything on — exact paths, as the router has
 * them: '/products' is the list, not '/products/<one>' with its configurator.
 * What can open over them — the configurator from the list, the designer from
 * the basket — holds the reload while it is open.
 */
const READ_ONLY = new Set(['/', '/products', '/services', '/about', '/privacy', '/terms', '/cookies']);

/** `t` arrives as a prop: the translator lives in App, which renders this. */
export default function BuildWatcher({ t }: { t: (key: TranslationKey) => string }) {
  const [stale, setStale] = useState(false);
  const baseline = useRef<string | null>(null);
  const lastActive = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;

    const readBuild = async (): Promise<string | null> => {
      try {
        const resp = await fetch('/api/version', { cache: 'no-store' });
        if (!resp.ok) return null;
        const data = await resp.json();
        return typeof data?.build === 'string' ? data.build : null;
      } catch {
        // Offline, or the shop is being restarted mid-deploy. Neither is news;
        // the next poll asks again.
        return null;
      }
    };

    // A trailing slash is the same page to the router ('/about/' is '/about').
    const canReloadNow = () =>
      !reloadsHeld() && READ_ONLY.has(window.location.pathname.replace(/\/+$/, '') || '/');

    const check = async (returningToTab = false) => {
      const build = await readBuild();
      if (cancelled || !build) return;
      if (baseline.current === null) {
        baseline.current = build;
        return;
      }
      if (build === baseline.current) return;

      if (canReloadNow() && (returningToTab || Date.now() - lastActive.current > IDLE_MS)) {
        window.location.reload();
        return;
      }
      setStale(true);
    };

    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check(true);
    };
    const onActivity = () => {
      lastActive.current = Date.now();
    };

    document.addEventListener('visibilitychange', onVisible);
    // Passive: this only stamps a timestamp and must never delay a scroll.
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('scroll', onActivity, { passive: true });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('scroll', onActivity);
    };
  }, []);

  if (!stale) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-4 pb-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-gray-900 text-white shadow-[0_10px_30px_-10px_rgba(0,0,0,0.6)]">
        <span className="text-xs font-bold">{t('updateReadyTitle')}</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-gray-900 text-xs font-black hover:bg-gray-100 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('updateReadyAction')}
        </button>
      </div>
    </div>
  );
}
