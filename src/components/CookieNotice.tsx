import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, X } from 'lucide-react';
import { useAuth } from '../App';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { denyConsent, grantConsent, hasMarketing, readConsent } from '../lib/gtag';

const DISMISSED_KEY = 'reklamx_cookie_notice_seen';

/**
 * TWO BANNERS IN ONE, and which one appears is decided by the data, not by us.
 *
 * WITH NO MARKETING IDS CONFIGURED it is an INFORMATION notice, exactly as it
 * has always been. Consent is required for storage that is not necessary for a
 * service the visitor asked for; the basket, the language, the currency, the
 * VAT preference and the sign-in session are all necessary, and for those
 * Swedish law (lagen om elektronisk kommunikation) requires only that visitors
 * be INFORMED. There is nothing to accept, so there is no Accept button, and
 * blocking the page behind a dialogue nobody needs to answer would cost sales
 * for no legal gain.
 *
 * THE MOMENT THE OWNER SAVES A GOOGLE ADS OR ANALYTICS ID it becomes a real
 * consent gate: Accept and Reject, equally weighted, nothing loaded until the
 * answer is Accept, and the answer remembered so it is asked once. This is not
 * decoration — src/lib/gtag.ts creates no script element at all until consent
 * is granted, so a visitor who refuses is not merely untracked in name.
 *
 * The two use different storage keys on purpose. Somebody who dismissed the old
 * information notice has consented to nothing, and must be asked properly.
 */
export default function CookieNotice() {
  const { t } = useAuth();
  const { settings } = useSiteSettings();
  const marketing = settings.marketing;
  const consentNeeded = hasMarketing(marketing);

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Delay slightly so it does not fight the page for attention on first paint.
    const timer = setTimeout(() => {
      try {
        if (consentNeeded) {
          setVisible(readConsent() === null);
        } else {
          setVisible(!localStorage.getItem(DISMISSED_KEY));
        }
      } catch {
        // A browser with storage blocked cannot remember either answer. For the
        // information notice, showing nothing is kinder than showing it on
        // every page. For consent, the opposite: never assume a yes.
        setVisible(consentNeeded);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [consentNeeded]);

  // The owner can switch marketing on while a tab is open, and the settings
  // arrive by live snapshot. Re-ask in that tab rather than waiting for a
  // reload that may never come.
  useEffect(() => {
    if (consentNeeded && readConsent() === null) setVisible(true);
  }, [consentNeeded]);

  // The footer's "cookie choices" link clears the answer and fires this; the
  // banner has to come straight back, or withdrawing consent would be a link
  // that appears to do nothing.
  useEffect(() => {
    const reopen = () => {
      if (readConsent() === null) setVisible(true);
    };
    window.addEventListener('reklamx:consent', reopen);
    return () => window.removeEventListener('reklamx:consent', reopen);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* nothing to do */
    }
  };

  const choose = (accepted: boolean) => {
    if (accepted) grantConsent(marketing || {});
    else denyConsent();
    setVisible(false);
    // Tell the tag mount in App.tsx, and any other open tab, without a reload.
    try {
      window.dispatchEvent(new Event('reklamx:consent'));
    } catch {
      /* nothing to do */
    }
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label={consentNeeded ? t('cookieNoticeConsentAria') : t('cookieNoticeAria')}
      // z-[60]: the AI launcher pill (z-50) used to float ON TOP of this banner
      // on mobile, covering its button row. While the notice is up it owns the
      // bottom of the screen; dismissed, the pills return to normal.
      className="fixed bottom-4 left-4 right-4 sm:left-6 sm:right-auto sm:max-w-md z-[60] print:hidden"
    >
      <div className="bg-gray-900 text-white rounded-2xl shadow-2xl border border-white/10 p-4 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <Cookie className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[0.8125rem] leading-relaxed text-gray-200">
            {consentNeeded ? t('cookieNoticeConsentBody') : t('cookieNoticeBody')}{' '}
            <Link to="/cookies" className="font-bold text-white underline underline-offset-2 hover:text-orange-300">
              {t('cookieNoticeLink')}
            </Link>
          </p>

          {consentNeeded ? (
            <>
              {/* Accept and Reject carry the SAME visual weight. A refusal
                  hidden in grey text beside a bright green button is not a free
                  choice, and regulators have said so repeatedly. */}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => choose(true)}
                  className="px-4 py-1.5 bg-white text-gray-900 text-xs font-black rounded-xl hover:bg-gray-100 transition-colors"
                >
                  {t('cookieNoticeAccept')}
                </button>
                <button
                  onClick={() => choose(false)}
                  className="px-4 py-1.5 bg-white/10 text-white text-xs font-black rounded-xl border border-white/20 hover:bg-white/20 transition-colors"
                >
                  {t('cookieNoticeReject')}
                </button>
              </div>
              <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-gray-400">{t('cookieNoticeEssentials')}</p>
            </>
          ) : (
            <button
              onClick={dismiss}
              className="mt-3 px-4 py-1.5 bg-white text-gray-900 text-xs font-black rounded-xl hover:bg-gray-100 transition-colors"
            >
              {t('cookieNoticeOk')}
            </button>
          )}
        </div>

        {/* -m-2 p-2: the same 16px cross, with a 32px area around it to hit.
            A bare 16px icon is under half the width of a fingertip, and this
            one sits in the corner of a banner that covers the bottom of the
            screen — the miss lands on the page behind it.

            While consent is being asked the cross is NOT an answer: closing the
            banner without choosing must not be recorded as a yes, and must not
            be recorded as a no either. It simply goes away for this page view
            and is asked again, which is the only reading of "no answer" that is
            safe in both directions. */}
        <button
          onClick={() => (consentNeeded ? setVisible(false) : dismiss())}
          aria-label={t('cookieNoticeClose')}
          className="-m-2 p-2 text-gray-500 hover:text-white transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
