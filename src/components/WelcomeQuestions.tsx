import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Building2, User, X } from 'lucide-react';
import { useAuth } from '../App';
import type { Language } from '../lib/translations';

const DONE_KEY = 'reklamx_welcome_done';

/**
 * TWO QUESTIONS ON A FIRST VISIT and nothing else — the owner's wish
 * (2026-10-15) is that nobody gets stuck and leaves. The page keeps loading
 * underneath while they answer.
 *
 *   1. Language, four flags. It also sets the currency that goes with it —
 *      English gets euro. The currency menu in the header can still change it.
 *   2. Private person or business — prices with or without VAT.
 *
 * The header has no language or VAT menu any more; the footer link
 * "Language & prices" reopens this (event `reklamx:welcome`). Closing it keeps
 * what the browser guessed. Crawlers and test robots never see it on their own
 * (add ?welcome=1 to force it), and it stays off pages a visitor is sent to
 * rather than arrives at: admin, order receipts, password reset.
 */
const LANGS: { code: Language; name: string; currency: 'SEK' | 'EUR' | 'DKK' | 'NOK' }[] = [
  { code: 'sv', name: 'Svenska', currency: 'SEK' },
  { code: 'en', name: 'English', currency: 'EUR' },
  { code: 'da', name: 'Dansk', currency: 'DKK' },
  { code: 'no', name: 'Norsk', currency: 'NOK' },
];

// Drawn, not emoji: Windows shows emoji flags as two letters.
function Flag({ code }: { code: Language }) {
  const box = 'h-7 w-10 shrink-0 overflow-hidden rounded-md shadow-[0_0_0_1px_rgba(0,0,0,0.08)]';
  if (code === 'sv') return (
    <svg viewBox="0 0 16 10" className={box} aria-hidden="true"><rect width="16" height="10" fill="#006AA7" /><rect x="5" width="2" height="10" fill="#FECC00" /><rect y="4" width="16" height="2" fill="#FECC00" /></svg>
  );
  if (code === 'da') return (
    <svg viewBox="0 0 37 28" className={box} aria-hidden="true"><rect width="37" height="28" fill="#C8102E" /><rect x="12" width="4" height="28" fill="#fff" /><rect y="12" width="37" height="4" fill="#fff" /></svg>
  );
  if (code === 'no') return (
    <svg viewBox="0 0 22 16" className={box} aria-hidden="true"><rect width="22" height="16" fill="#BA0C2F" /><rect x="6" width="4" height="16" fill="#fff" /><rect y="6" width="22" height="4" fill="#fff" /><rect x="7" width="2" height="16" fill="#00205B" /><rect y="7" width="22" height="2" fill="#00205B" /></svg>
  );
  return (
    <svg viewBox="0 0 60 30" className={box} aria-hidden="true">
      <clipPath id="rx-gb"><rect width="60" height="30" /></clipPath>
      <g clipPath="url(#rx-gb)">
        <rect width="60" height="30" fill="#012169" />
        <path d="M0,0 60,30 M60,0 0,30" stroke="#fff" strokeWidth="6" />
        <path d="M0,0 60,30 M60,0 0,30" stroke="#C8102E" strokeWidth="2" />
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
      </g>
    </svg>
  );
}

const STEP2: Record<Language, { q: string; privat: string; privatHint: string; biz: string; bizHint: string; back: string; close: string }> = {
  sv: { q: 'Handlar du som…', privat: 'Privatperson', privatHint: 'Priser inkl. moms', biz: 'Företag', bizHint: 'Priser exkl. moms', back: 'Byt språk', close: 'Stäng' },
  en: { q: 'Are you buying as a…', privat: 'Private person', privatHint: 'Prices incl. VAT', biz: 'Business', bizHint: 'Prices excl. VAT', back: 'Change language', close: 'Close' },
  da: { q: 'Handler du som…', privat: 'Privatperson', privatHint: 'Priser inkl. moms', biz: 'Virksomhed', bizHint: 'Priser ekskl. moms', back: 'Skift sprog', close: 'Luk' },
  no: { q: 'Handler du som…', privat: 'Privatperson', privatHint: 'Priser inkl. mva.', biz: 'Bedrift', bizHint: 'Priser ekskl. mva.', back: 'Bytt språk', close: 'Lukk' },
};

const SKIP_PATHS = /^\/(admin|admin-dashboard|order|reset-password|editor)(\/|$)/;

function shouldAsk(pathname: string, search: string): boolean {
  if (/[?&]welcome=1\b/.test(search)) return true;
  if (SKIP_PATHS.test(pathname)) return false;
  if (typeof navigator !== 'undefined') {
    if ((navigator as any).webdriver) return false;
    if (/bot|crawl|spider|slurp|lighthouse|headless|prerender|preview/i.test(navigator.userAgent)) return false;
  }
  try {
    return !localStorage.getItem(DONE_KEY);
  } catch {
    // Storage blocked: it could never remember the answer, so asking on every
    // page would be worse than not asking at all.
    return false;
  }
}

export default function WelcomeQuestions() {
  const { language, setLanguage, setCurrency, setIncludeVat } = useAuth();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<Language | null>(null);
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(shouldAsk(pathname, search));
    // Only on arrival — moving between pages must not bring it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The footer's "Language & prices" link.
  useEffect(() => {
    const reopen = () => { setLang(null); setOpen(true); };
    window.addEventListener('reklamx:welcome', reopen);
    return () => window.removeEventListener('reklamx:welcome', reopen);
  }, []);

  useEffect(() => {
    if (open) firstButton.current?.focus();
  }, [open, lang]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const finish = () => {
    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* nothing to do */ }
    setOpen(false);
  };

  const pickLanguage = (l: (typeof LANGS)[number]) => {
    setLanguage(l.code);
    setCurrency(l.currency);
    setLang(l.code);
  };

  const pickBuyer = (business: boolean) => {
    setIncludeVat(!business);
    finish();
  };

  if (!open) return null;
  const s = lang ? STEP2[lang] : null;

  const card =
    'group flex w-full items-center gap-4 rounded-2xl border-2 border-gray-200 bg-white px-5 py-4 text-left transition-colors hover:border-orange-600 focus-visible:border-orange-600 focus-visible:outline-none';

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-4 print:hidden" role="dialog" aria-modal="true" aria-labelledby="rx-welcome-q">
      <div className="relative w-full max-w-md rounded-[1.75rem] bg-white p-6 sm:p-8 shadow-2xl">
        <button
          type="button"
          onClick={finish}
          aria-label={STEP2[lang ?? language]?.close ?? 'Close'}
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-5 w-5" />
        </button>

        <p className="text-[0.6875rem] font-black uppercase tracking-[0.2em] text-orange-600">{s ? '2 / 2' : '1 / 2'}</p>

        {!s ? (
          <>
            <h2 id="rx-welcome-q" className="mt-2 pr-10 text-2xl font-black text-gray-900">Välj språk <span className="text-gray-400">· Choose language</span></h2>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {LANGS.map((l, i) => (
                <button
                  key={l.code}
                  ref={i === 0 ? firstButton : undefined}
                  type="button"
                  onClick={() => pickLanguage(l)}
                  className="flex flex-col items-center gap-2 rounded-2xl border-2 border-gray-200 bg-white px-3 py-4 transition-colors hover:border-orange-600 focus-visible:border-orange-600 focus-visible:outline-none"
                >
                  <Flag code={l.code} />
                  <span className="text-base font-black text-gray-900">{l.name}</span>
                  <span className="text-xs font-bold text-gray-500">{l.currency}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 id="rx-welcome-q" className="mt-2 pr-10 text-2xl font-black text-gray-900">{s.q}</h2>
            <div className="mt-6 space-y-3">
              <button ref={firstButton} type="button" onClick={() => pickBuyer(false)} className={card}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><User className="h-5 w-5" /></span>
                <span>
                  <span className="block text-lg font-black text-gray-900">{s.privat}</span>
                  <span className="block text-sm text-gray-500">{s.privatHint}</span>
                </span>
              </button>
              <button type="button" onClick={() => pickBuyer(true)} className={card}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Building2 className="h-5 w-5" /></span>
                <span>
                  <span className="block text-lg font-black text-gray-900">{s.biz}</span>
                  <span className="block text-sm text-gray-500">{s.bizHint}</span>
                </span>
              </button>
            </div>
            <p className="mt-4 text-center">
              <button type="button" onClick={() => setLang(null)} className="min-h-[44px] px-2 text-sm font-bold text-gray-500 underline underline-offset-2 hover:text-gray-900">{s.back}</button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
