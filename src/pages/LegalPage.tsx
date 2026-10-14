import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Shield, FileText, Cookie, AlertTriangle } from 'lucide-react';
import { useAuth } from '../App';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { aiTransferSection, fillAiProvider, getLegalDocument, textToDocument, LEGAL_TRANSLATION_PENDING, type AiProcessor, type LegalKind } from '../lib/legal';
import { useEffect, useState } from 'react';
import { doc as fsDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

const KINDS: Record<string, LegalKind> = {
  privacy: 'privacy',
  terms: 'terms',
  cookies: 'cookies',
};

const ICONS: Record<LegalKind, React.ElementType> = {
  privacy: Shield,
  terms: FileText,
  cookies: Cookie,
};

/**
 * Renders the privacy policy, the terms, or the cookie notice.
 *
 * Two things are deliberate. Passages the shop owner still has to complete are
 * written as [ ... ] in the source and shown here as a visible amber gap — a
 * policy that reads as finished while quietly stating something untrue is worse
 * than one that shows what is missing. And the seller's identity is read from
 * site settings rather than repeated here, so it cannot drift away from what the
 * invoice prints.
 */
export default function LegalPage() {
  const { pathname } = useLocation();
  const { language, t } = useAuth();
  const { settings } = useSiteSettings();

  // /privacy, /terms and /cookies read better than /legal/privacy, and these are
  // the addresses people paste into a checkout form or a payment application.
  const kind = KINDS[pathname.replace(/^\/+|\/+$/g, '')] ?? 'privacy';

  // The owner's own text, if he has written any for this page and language.
  // Anything he has not written falls back to the supplied draft.
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});
  // WHICH COMPANY ANSWERS THE CHAT, for the line that says who receives what a
  // customer types into it — the one in use, not the one the text was written
  // for (the owner can switch to DeepSeek). Written by the server into this same
  // document when he saves an AI key; /api/health names it for a key that came
  // from the host instead.
  const [processor, setProcessor] = useState<(AiProcessor & { updatedAt?: string }) | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fromHealth = async () => {
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        try {
          const r = await fetch('/api/health');
          if (r.ok) {
            const d = await r.json();
            if (!cancelled) setProcessor({ provider: typeof d?.chatProvider === 'string' ? d.chatProvider : null });
            return;
          }
        } catch { /* tried again below */ }
        await new Promise((res) => setTimeout(res, 2000));
      }
    };
    getDoc(fsDoc(db, 'settings', 'legalPages'))
      .then((snap) => {
        if (cancelled) return;
        setOverrides((snap.data()?.overrides ?? {}) as any);
        const stored = snap.data()?.aiProcessor;
        if (stored && typeof stored.provider === 'string') setProcessor(stored);
        else void fromHealth();
      })
      .catch(() => {
        /* the drafts stand on their own */
        void fromHealth();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shipped = getLegalDocument(kind, language);
  const ownText = overrides?.[kind]?.[language]?.trim();
  const ownDoc = ownText ? textToDocument(ownText, shipped.title, shipped.updated) : null;
  // His own text written before the tokens existed never says where a DeepSeek
  // chat goes: the section is added to it.
  const extra = kind === 'privacy' && ownText && !ownText.includes('{AI_TRANSFER}') ? aiTransferSection(processor, language) : null;
  const doc = ownDoc ? { ...ownDoc, sections: extra ? [...ownDoc.sections, extra] : ownDoc.sections } : shipped;
  // The policy changes when the AI service does, so its date moves with it.
  const aiDate = kind === 'privacy' && processor?.updatedAt ? String(processor.updatedAt).slice(0, 10) : '';
  const updated = aiDate > doc.updated ? aiDate : doc.updated;
  const fill = (text: string) => fillAiProvider(text, processor, language);
  const Icon = ICONS[kind];
  const translationPending = !ownText && LEGAL_TRANSLATION_PENDING.includes(language);

  const sellerName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';
  const sellerAddress = settings.companyAddress?.trim();
  const orgNumber = settings.orgNumber?.trim();
  const vatNumber = settings.vatNumber?.trim();
  const contactEmail = settings.contactEmail?.trim();
  const contactPhone = settings.contactPhone?.trim();
  const sellerIncomplete = !sellerAddress || !orgNumber || !vatNumber;

  /** Splits out [placeholders] so an unfinished passage is obvious. */
  const renderBody = (text: string, i: number) => {
    const parts = fill(text).split(/(\[[^\]]+\])/g);
    return (
      <p key={i} className="text-[0.9375rem] leading-relaxed text-gray-600">
        {parts.map((part, j) =>
          part.startsWith('[') ? (
            <span
              key={j}
              className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-900 rounded-lg px-2 py-0.5 text-[0.8125rem] font-bold mx-0.5"
            >
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {part.slice(1, -1)}
            </span>
          ) : (
            <React.Fragment key={j}>{part}</React.Fragment>
          ),
        )}
      </p>
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded-2xl bg-gray-900 text-white flex items-center justify-center">
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">{fill(doc.title)}</h1>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">
            {t('legalUpdated')} {updated}
          </p>
        </div>
      </div>

      {translationPending && (
        <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 mb-6">
          <p className="text-[0.8125rem] text-gray-600 font-medium">{t('legalTranslationPending')}</p>
        </div>
      )}

      <p className="text-[1rem] leading-relaxed text-gray-700 mb-10">{fill(doc.intro)}</p>

      <div className="space-y-9">
        {doc.sections.map((section, i) => (
          <section key={i}>
            <h2 className="text-lg font-black text-gray-900 mb-3">{fill(section.heading)}</h2>
            <div className="space-y-3">{section.body.map(renderBody)}</div>
          </section>
        ))}
      </div>

      {/* The seller's identity, from settings. */}
      <div className="mt-12 pt-8 border-t border-gray-200">
        <h2 className="text-lg font-black text-gray-900 mb-3">{t('legalSellerHeading')}</h2>
        {sellerIncomplete ? (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
            <p className="text-[0.8125rem] font-bold text-amber-900 leading-relaxed">{t('legalSellerMissing')}</p>
          </div>
        ) : (
          <div className="text-[0.9375rem] text-gray-600 space-y-1">
            <p className="font-bold text-gray-900">{sellerName}</p>
            <p>{sellerAddress}</p>
            {orgNumber && <p>Org.nr: {orgNumber}</p>}
            {vatNumber && <p>Momsreg.nr: {vatNumber}</p>}
            {contactEmail && <p>{contactEmail}</p>}
            {contactPhone && <p>{contactPhone}</p>}
          </div>
        )}
      </div>

      <div className="mt-10 flex flex-wrap gap-3 text-sm">
        <Link to="/privacy" className="font-bold text-gray-500 hover:text-orange-600 underline underline-offset-4">
          {getLegalDocument('privacy', language).title}
        </Link>
        <Link to="/terms" className="font-bold text-gray-500 hover:text-orange-600 underline underline-offset-4">
          {getLegalDocument('terms', language).title}
        </Link>
        <Link to="/cookies" className="font-bold text-gray-500 hover:text-orange-600 underline underline-offset-4">
          {getLegalDocument('cookies', language).title}
        </Link>
      </div>
    </div>
  );
}
