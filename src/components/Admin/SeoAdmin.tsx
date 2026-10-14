import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode2,
  Globe,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Save,
  Search,
  ShoppingBag,
  Sparkles,
  Undo2,
} from 'lucide-react';
import { auth } from '../../firebase';
import { useAuth } from '../../App';
import { aiHealth, translateViaApi } from './LocalizedTextFields';
import { useSiteSettings } from '../../context/SiteSettingsContext';
import { countryLabel, feedShippingLines } from '../../lib/shipping';
import {
  DEFAULT_SEO_SETTINGS,
  DESCRIPTION_LIMIT,
  MERCHANT_CONDITIONS,
  normalizeSeo,
  pruneSeoForSave,
  SEO_LANGS,
  SEO_PAGES,
  seoText,
  seoTextFilled,
  TITLE_LIMIT,
  type SeoLang,
  type SeoPageSettings,
  type SeoSettings,
  type SeoText,
} from '../../lib/seoSettings';

/**
 * Everything a search engine reads, edited by the shop owner.
 *
 * WHY THIS SCREEN EXISTS
 * The page titles lived in a const in server-seo.ts, the robots rules in an
 * array beside them, and the product feed did not exist at all. Changing one
 * sentence meant an edit, a build and a deploy — so in practice nothing was ever
 * changed. The owner asked for the fields instead: "make me the settings in the
 * dashboard and I'll enter them myself." This is those fields.
 *
 * ONE DRAFT, ONE SAVE. All four screens below edit the same `seo` object inside
 * settings/siteConfig, so they share one draft and one Save button rather than
 * writing the document from four places — two half-saves racing over one
 * document is how a shop loses its logo.
 *
 * AND THEN THE SERVER IS TOLD. The head, robots.txt, the sitemap and the feed
 * are built from a ten-minute cache, deliberately, because a Firestore read per
 * crawler hit is what took this shop dark for seven hours once. Saving here
 * drops that cache immediately, so a title changed at 14:02 is live at 14:02 and
 * not at 14:12.
 */

export type SeoSection = 'search' | 'pages' | 'robots' | 'merchant';

// ---------------------------------------------------------------- small parts

function Card({
  icon,
  title,
  subtitle,
  badge,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-black text-gray-900 truncate">{title}</h3>
            {subtitle && <p className="text-[0.6875rem] font-bold text-gray-400">{subtitle}</p>}
          </div>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}

function Text({
  label,
  hint,
  placeholder,
  value,
  onChange,
  mono,
}: {
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-[0.6875rem] font-black uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className={
          'w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500 ' +
          (mono ? 'font-mono' : 'font-bold text-gray-900')
        }
      />
      {hint && <p className="text-[0.6875rem] font-bold text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

/** A character count that says what happens when it is exceeded, not just a number. */
function Counter({ value, limit, emptyHint }: { value: string; limit: number; emptyHint: string }) {
  const n = value.trim().length;
  const over = n > limit;
  return (
    <p className={'text-[0.6875rem] font-bold mt-1 ' + (over ? 'text-amber-600' : 'text-gray-400')}>
      {n}/{limit}
      {n === 0 ? ` — ${emptyHint}` : over ? ' — Google will cut this off mid-word.' : ''}
    </p>
  );
}

/**
 * One string in the four shop languages.
 *
 * Collapsed to a single row until it is opened, because nine pages × two fields
 * × four languages is seventy-two boxes and an owner faced with seventy-two
 * boxes fills in none of them. The one language he must fill in — the one the
 * crawler's copy is written in — is always visible; the rest are behind the
 * button, exactly as the product form already does it.
 */
function LangText({
  label,
  value,
  onChange,
  crawlerLang,
  placeholder,
  limit,
  emptyHint,
  multiline,
}: {
  label: string;
  value: SeoText | undefined;
  onChange: (next: SeoText) => void;
  crawlerLang: SeoLang;
  placeholder?: string;
  limit: number;
  emptyHint: string;
  multiline?: boolean;
}) {
  const { t } = useAuth();
  const [open, setOpen] = useState(false);
  const filled = seoTextFilled(value);
  const set = (lang: SeoLang, text: string) => {
    const next: SeoText = { ...(value || {}) };
    if (text) next[lang] = text;
    else delete next[lang];
    onChange(next);
  };
  const primary = value?.[crawlerLang] ?? '';
  const others = SEO_LANGS.filter((l) => l.code !== crawlerLang);

  /**
   * THE FOURTH COPY OF THE LANGUAGE BOXES GETS THE BUTTON TOO — 15.4.4.
   *
   * "وفي اماكن ما شغاله". The shop had four separate implementations of "type
   * this in three more languages" and exactly one of them had ever been given
   * the AI. This screen keeps its own layout — it has a character counter and a
   * live Google result preview, and its primary language is whichever one the
   * crawler is served rather than always English — and borrows only the call.
   *
   * It fills the EMPTY boxes from the primary one, the same promise the purple
   * button makes everywhere else, and it never touches the primary itself.
   */
  const [aiOn, setAiOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    aiHealth().then((on) => { if (!cancelled) setAiOn(on); });
    return () => { cancelled = true; };
  }, []);

  const translate = async () => {
    const source = primary.trim();
    if (busy) return;
    if (!source) { setNote(t('i18nTranslateNeedsSource')); return; }
    const wanted = others.filter(({ code }) => !(value?.[code] ?? '').trim()).map(({ code }) => code);
    if (wanted.length === 0) { setNote(t('i18nTranslateAllFilled')); setOpen(true); return; }
    setBusy(true);
    setNote(null);
    try {
      const body = await translateViaApi(source, wanted, multiline ? 'page description for search results' : 'page title for search results');
      if (!body.ok) {
        setNote(body.upstream ? `${t('i18nTranslateFailed')} (${body.upstream})` : t('i18nTranslateFailed'));
        return;
      }
      const next: SeoText = { ...(value || {}) };
      let changed = 0;
      for (const code of wanted) {
        const text = (body.translations[code] ?? '').trim();
        if (!text) continue;
        next[code] = text;
        changed += 1;
      }
      if (changed === 0) { setNote(t('i18nTranslateEmpty')); return; }
      onChange(next);
      setOpen(true);
      if (body.echoed.length) {
        const names = body.echoed.map((c) => SEO_LANGS.find((l) => l.code === c)?.label ?? c).join(', ');
        setNote(t('i18nTranslateEchoed').replace('{0}', names));
      }
    } catch {
      setNote(t('i18nTranslateFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="block text-[0.6875rem] font-black uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
      </label>
      {multiline ? (
        <textarea
          rows={2}
          value={primary}
          onChange={(e) => set(crawlerLang, e.target.value)}
          placeholder={placeholder}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      ) : (
        <input
          type="text"
          value={primary}
          onChange={(e) => set(crawlerLang, e.target.value)}
          placeholder={placeholder}
          className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <Counter value={primary} limit={limit} emptyHint={emptyHint} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={
            'mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[0.625rem] font-black shrink-0 transition-colors ' +
            (open
              ? 'border-blue-400 bg-blue-50 text-blue-700'
              : filled > 1
                ? 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                : 'border-dashed border-gray-300 bg-white text-gray-400 hover:border-blue-300 hover:text-blue-600')
          }
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{Math.max(0, filled - (primary.trim() ? 1 : 0))}/3 other languages</span>
        </button>
        {aiOn && (
          <button
            type="button"
            onClick={() => void translate()}
            disabled={busy}
            title={t('i18nTranslateHint')}
            className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 text-[0.625rem] font-black shrink-0 hover:border-purple-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{busy ? t('i18nTranslating') : t('i18nTranslate')}</span>
          </button>
        )}
      </div>

      {note && (
        <p role="status" aria-live="polite" className="mt-1.5 text-[0.625rem] font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-2 py-1">
          {note}
        </p>
      )}

      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
          {others.map(({ code, label: langLabel, flag }) => (
            <div key={code}>
              <label className="block text-[0.625rem] font-bold text-gray-500 mb-0.5">
                {flag} {langLabel}
              </label>
              {multiline ? (
                <textarea
                  rows={3}
                  value={value?.[code] ?? ''}
                  onChange={(e) => set(code, e.target.value)}
                  placeholder={t('i18nEmptyBox')}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-[0.75rem] font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              ) : (
                <input
                  type="text"
                  value={value?.[code] ?? ''}
                  onChange={(e) => set(code, e.target.value)}
                  placeholder={t('i18nEmptyBox')}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-[0.75rem] font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A real Google result, built from what is in the boxes right now. */
function ResultPreview({ path, title, description }: { path: string; title: string; description: string }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-2xl p-4 min-w-0">
      <p className="text-[0.625rem] font-black uppercase tracking-wider text-gray-400 mb-2">How it looks in Google</p>
      <p className="text-[0.6875rem] text-emerald-800 font-bold truncate">
        shop.reklamx.se{path === '/' ? '' : ` › ${path.replace(/^\//, '').split('/').join(' › ')}`}
      </p>
      <p className="text-[0.9375rem] leading-snug text-blue-800 font-bold truncate">{title}</p>
      <p className="text-[0.75rem] leading-relaxed text-gray-600 font-semibold line-clamp-2">{description}</p>
    </div>
  );
}

function CopyBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="block text-[0.6875rem] font-black uppercase tracking-wider text-gray-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-[0.75rem] font-mono text-gray-700 truncate">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(value).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              },
              () => {
                /* a browser that refuses the clipboard still shows the text */
              },
            );
          }}
          className="px-3 py-2 rounded-xl border border-gray-200 hover:border-blue-400 hover:text-blue-600 text-gray-500 transition-colors shrink-0"
          title="Copy"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the screen

export default function SeoAdmin({ section }: { section: SeoSection }) {
  const { settings, updateSettings } = useSiteSettings();

  const stored = useMemo(() => normalizeSeo(settings.seo), [settings.seo]);
  const [draft, setDraft] = useState<SeoSettings>(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  // Re-seed whenever the live settings change, but ONLY while there is nothing
  // unsaved — otherwise a background snapshot arriving mid-sentence would throw
  // away what the owner is typing. Same trap that has already cost this shop a
  // logo: a screen that saves what it started with rather than what is stored.
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(stored), [draft, stored]);
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!dirtyRef.current) setDraft(stored);
  }, [stored]);

  const crawlerLang: SeoLang = draft.defaultLang || 'en';
  const siteName = settings.siteName || 'ReklamX';
  const suffix = typeof draft.titleSuffix === 'string' ? draft.titleSuffix : ` | ${siteName}`;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://shop.reklamx.se';

  const patch = (next: Partial<SeoSettings>) => setDraft((d) => ({ ...d, ...next }));
  const patchPage = (path: string, next: Partial<SeoPageSettings>) =>
    setDraft((d) => ({ ...d, pages: { ...(d.pages || {}), [path]: { ...(d.pages?.[path] || {}), ...next } } }));

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    setRefreshNote(null);
    try {
      const cleaned = pruneSeoForSave(draft);
      await updateSettings({ seo: cleaned });
      // Adopt what was actually stored, not what was typed. Saving trims blank
      // languages and drops empty pages, so the draft and the document differ the
      // moment the write lands — and the screen would go on claiming unsaved
      // changes, with Save still lit, over a difference of nothing.
      setDraft(normalizeSeo(cleaned));
      // The document is written; now tell the server to forget what it cached,
      // so he can press the live link on this screen and see his own change
      // rather than the one from ten minutes ago.
      try {
        const token = await auth.currentUser?.getIdToken().catch(() => null);
        const resp = await fetch('/api/admin/seo/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        if (!resp.ok) throw new Error(String(resp.status));
      } catch {
        // The save itself worked. Say so, and say the other half did not, rather
        // than reporting a failure that did not happen.
        setRefreshNote('Saved. The live pages may take up to ten minutes to catch up.');
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {section === 'search' && (
        <SearchSection
          draft={draft}
          patch={patch}
          // The badge must report what is SAVED, never what is being typed.
          savedToken={stored.verification?.google ?? ''}
          // THIS FIELD'S OWN dirtiness, not the document's. `dirty` compares the
          // whole SEO document, so rewriting a page description made the
          // untouched verification token read "UNSAVED CHANGES".
          dirty={(draft.verification?.google ?? '') !== (stored.verification?.google ?? '')}
          crawlerLang={crawlerLang}
          siteName={siteName}
          suffix={suffix}
          origin={origin}
        />
      )}
      {section === 'pages' && (
        <PagesSection draft={draft} patchPage={patchPage} crawlerLang={crawlerLang} suffix={suffix} />
      )}
      {section === 'robots' && <RobotsSection draft={draft} patch={patch} origin={origin} />}
      {section === 'merchant' && <MerchantSection draft={draft} patch={patch} origin={origin} />}

      {/* ------------------------------------------------------------ SAVE */}
      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 bg-white/95 backdrop-blur border border-gray-100 shadow-lg rounded-2xl px-4 py-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black rounded-2xl transition-colors flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          <span>Save</span>
        </button>
        {dirty && !saving && (
          <button
            type="button"
            onClick={() => setDraft(stored)}
            className="px-4 py-3 text-gray-500 hover:text-gray-800 text-sm font-black rounded-2xl transition-colors flex items-center gap-2"
          >
            <Undo2 className="w-4 h-4" />
            <span>Discard changes</span>
          </button>
        )}
        {!dirty && !saved && <span className="text-[0.75rem] font-bold text-gray-400">Everything is saved.</span>}
        {saved && (
          <span className="text-[0.75rem] font-black text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4" /> {refreshNote ?? 'Saved — live on the shop straight away'}
          </span>
        )}
        {error && <span className="text-[0.75rem] font-black text-red-600">{error}</span>}
      </div>
    </div>
  );
}

// ------------------------------------------------------- 1. search & identity

function SearchSection({
  draft,
  patch,
  savedToken,
  dirty,
  crawlerLang,
  siteName,
  suffix,
  origin,
}: {
  draft: SeoSettings;
  patch: (next: Partial<SeoSettings>) => void;
  savedToken: string;
  dirty: boolean;
  crawlerLang: SeoLang;
  siteName: string;
  suffix: string;
  origin: string;
}) {
  const verification = draft.verification || {};
  const setVerification = (next: Partial<typeof verification>) =>
    patch({ verification: { ...verification, ...next } });

  return (
    <>
      <Card
        icon={<CheckCircle2 className="w-5 h-5" />}
        title="Prove the site is yours"
        subtitle="Paste the code Google gives you — no DNS record, no waiting for anyone"
        badge={
          /*
           * WE DO NOT KNOW WHETHER GOOGLE HAS VERIFIED ANYTHING, so this no
           * longer claims it does.
           *
           * It used to read `draft.verification.google` — the UNSAVED box on
           * this very screen — and print an emerald tick saying GOOGLE VERIFIED
           * the moment a single character was typed into it. Nothing had been
           * saved, nothing had been served to a crawler, and Google had not been
           * asked. Following this panel's own step 3 is what lit it.
           *
           * Three states, and each is something we can actually check: the token
           * is not set, it is typed but not saved, or it is saved and now being
           * served — after which the owner still has to press Verify at Google's
           * end, which is the sentence the last state carries.
           */
          (() => {
            const tone = !savedToken
              ? 'bg-amber-50 text-amber-700'
              : dirty
                ? 'bg-gray-100 text-gray-600'
                : 'bg-sky-50 text-sky-700';
            const text = !savedToken
              ? 'Not set'
              : dirty
                ? 'Unsaved changes'
                : 'Token saved — press Verify at Google';
            return (
              <span className={'inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wide shrink-0 ' + tone}>
                {savedToken && !dirty ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                <span>{text}</span>
              </span>
            );
          })()
        }
      >
        <ol className="text-[0.75rem] leading-relaxed text-gray-600 bg-gray-50 rounded-2xl p-4 space-y-1.5 list-decimal list-inside">
          <li>
            Open{' '}
            <a
              href="https://search.google.com/search-console"
              target="_blank"
              rel="noreferrer"
              className="font-bold text-blue-600 hover:underline"
            >
              Google Search Console <ExternalLink className="w-3 h-3 inline" />
            </a>{' '}
            and add a property of type <b>URL prefix</b> — <code className="font-mono">{origin}</code>.
          </li>
          <li>
            Choose the <b>HTML tag</b> method. Google shows a line like{' '}
            <code className="font-mono text-[0.6875rem]">
              &lt;meta name="google-site-verification" content="AbC123…" /&gt;
            </code>
          </li>
          <li>
            Paste <b>only the part in quotes after content=</b> into the box below and press Save.
          </li>
          <li>Go back to Google and press Verify. The shop is already serving your code by then.</li>
        </ol>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Text
            label="Google Search Console"
            placeholder="AbC123def456…"
            hint="The content= value, not the whole tag."
            value={verification.google || ''}
            onChange={(v) => setVerification({ google: v })}
            mono
          />
          <Text
            label="Bing Webmaster Tools"
            placeholder="Optional"
            hint="Bing is where DuckDuckGo's results come from."
            value={verification.bing || ''}
            onChange={(v) => setVerification({ bing: v })}
            mono
          />
          <Text
            label="Pinterest"
            placeholder="Optional"
            value={verification.pinterest || ''}
            onChange={(v) => setVerification({ pinterest: v })}
            mono
          />
          <Text
            label="Facebook / Meta domain"
            placeholder="Optional"
            value={verification.facebook || ''}
            onChange={(v) => setVerification({ facebook: v })}
            mono
          />
        </div>

        <p className="text-[0.75rem] leading-relaxed text-gray-600 bg-gray-50 rounded-2xl p-4">
          Once Google has verified the site, give it the address of your sitemap —{' '}
          <code className="font-mono">{origin}/sitemap.xml</code> — under <b>Sitemaps</b>. It rebuilds itself
          every time you add a product, so that is the only time you ever have to do it.
        </p>
      </Card>

      <Card
        icon={<Globe className="w-5 h-5" />}
        title="How the shop introduces itself"
        subtitle="The name, the sentence and the picture used wherever a page has nothing of its own"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[0.6875rem] font-black uppercase tracking-wider text-gray-500 mb-1.5">
              Language Google is shown
            </label>
            <select
              value={crawlerLang}
              onChange={(e) => patch({ defaultLang: e.target.value as SeoLang })}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {SEO_LANGS.map(({ code, label, flag }) => (
                <option key={code} value={code}>
                  {flag} {label}
                </option>
              ))}
            </select>
            <p className="text-[0.6875rem] font-bold text-gray-400 mt-1">
              A visitor's own language is chosen in their browser, so the server cannot know it — this is the
              language the copy a crawler reads is written in.
            </p>
          </div>

          <Text
            label="Added to every title"
            placeholder={` | ${siteName}`}
            hint={`Empty means no suffix at all. Leave it as it is to follow the shop's name.`}
            value={suffix}
            onChange={(v) => patch({ titleSuffix: v })}
          />

          <div className="md:col-span-2">
            <LangText
              label="Fallback description"
              value={draft.defaultDescription}
              onChange={(v) => patch({ defaultDescription: v })}
              crawlerLang={crawlerLang}
              placeholder="One sentence describing the shop, used on any page with nothing better to say."
              limit={DESCRIPTION_LIMIT}
              emptyHint="the shop's built-in sentence is used."
              multiline
            />
          </div>

          <Text
            label="Share picture (og:image)"
            placeholder="/og-image.png"
            hint="What WhatsApp, Facebook and LinkedIn show when someone pastes a link. 1200×630 works everywhere."
            value={draft.shareImageUrl || ''}
            onChange={(v) => patch({ shareImageUrl: v })}
          />
          <Text
            label="Twitter / X account"
            placeholder="@reklamx"
            hint="Optional — shown as the source on the share card."
            value={draft.twitterSite || ''}
            onChange={(v) => patch({ twitterSite: v })}
          />
        </div>

        {draft.shareImageUrl?.trim() && (
          <div className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-100 rounded-2xl">
            <ImageIcon className="w-4 h-4 text-gray-400 shrink-0" />
            <img
              src={draft.shareImageUrl}
              alt=""
              className="h-16 w-auto max-w-[13.75rem] object-contain rounded-lg border border-gray-200 bg-white"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <p className="text-[0.6875rem] font-bold text-gray-400">
              If nothing appears here, the address is wrong — and it will be just as blank on WhatsApp.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}

// -------------------------------------------------------------- 2. the pages

function PagesSection({
  draft,
  patchPage,
  crawlerLang,
  suffix,
}: {
  draft: SeoSettings;
  patchPage: (path: string, next: Partial<SeoPageSettings>) => void;
  crawlerLang: SeoLang;
  suffix: string;
}) {
  const [openPath, setOpenPath] = useState<string>('/');

  return (
    <Card
      icon={<Search className="w-5 h-5" />}
      title="What each page says in Google"
      subtitle="Nine pages. An empty box keeps the wording the shop ships with."
    >
      <div className="space-y-3">
        {SEO_PAGES.map((page) => {
          const own = draft.pages?.[page.path] || {};
          const title = seoText(own.title, crawlerLang);
          const description = seoText(own.description, crawlerLang);
          const isOpen = openPath === page.path;
          const written = Boolean(title || description);

          return (
            <div key={page.path} className="border border-gray-100 rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenPath(isOpen ? '' : page.path)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors text-left"
              >
                <span className="min-w-0">
                  <span className="block text-[0.8125rem] font-black text-gray-900 truncate">{page.label}</span>
                  <span className="block text-[0.6875rem] font-mono text-gray-400 truncate">{page.path}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  {own.noindex && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[0.625rem] font-black uppercase">
                      Hidden
                    </span>
                  )}
                  <span
                    className={
                      'px-2 py-0.5 rounded-full text-[0.625rem] font-black uppercase ' +
                      (written ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400')
                    }
                  >
                    {written ? 'Your words' : 'Built-in'}
                  </span>
                </span>
              </button>

              {isOpen && (
                <div className="p-4 border-t border-gray-100 bg-gray-50/50 space-y-4">
                  <LangText
                    label="Title"
                    value={own.title}
                    onChange={(v) => patchPage(page.path, { title: v })}
                    crawlerLang={crawlerLang}
                    placeholder={page.title}
                    limit={TITLE_LIMIT}
                    emptyHint="the wording above is used."
                  />
                  <LangText
                    label="Description"
                    value={own.description}
                    onChange={(v) => patchPage(page.path, { description: v })}
                    crawlerLang={crawlerLang}
                    placeholder={page.description}
                    limit={DESCRIPTION_LIMIT}
                    emptyHint="the wording above is used."
                    multiline
                  />

                  {/* The real result, including the built-in wording when a box
                      is empty — so "leave it blank" is a visible choice rather
                      than a leap of faith. */}
                  <ResultPreview
                    path={page.path}
                    title={
                      title
                        ? title.includes(suffix.trim()) || !suffix.trim()
                          ? title
                          : `${title}${suffix}`
                        : page.title
                    }
                    description={description || page.description}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex items-start gap-2.5 p-3 bg-white border border-gray-100 rounded-2xl cursor-pointer">
                      <input
                        type="checkbox"
                        checked={own.noindex === true}
                        onChange={(e) => patchPage(page.path, { noindex: e.target.checked })}
                        className="mt-0.5 w-4 h-4 accent-blue-600"
                      />
                      <span className="text-[0.75rem] font-bold text-gray-700 leading-snug">
                        Hide from Google
                        <span className="block text-[0.6875rem] font-semibold text-gray-400">
                          The page still works for anyone with the link; it just stops appearing in search.
                        </span>
                      </span>
                    </label>

                    <label className="flex items-start gap-2.5 p-3 bg-white border border-gray-100 rounded-2xl cursor-pointer">
                      <input
                        type="checkbox"
                        checked={own.excludeFromSitemap === true}
                        onChange={(e) => patchPage(page.path, { excludeFromSitemap: e.target.checked })}
                        className="mt-0.5 w-4 h-4 accent-blue-600"
                      />
                      <span className="text-[0.75rem] font-bold text-gray-700 leading-snug">
                        Keep out of the sitemap
                        <span className="block text-[0.6875rem] font-semibold text-gray-400">
                          Not offered to Google, though it may still find the page on its own.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[0.6875rem] font-black uppercase tracking-wider text-gray-500 mb-1.5">
                        Importance
                      </label>
                      <select
                        value={own.priority || page.priority}
                        onChange={(e) => patchPage(page.path, { priority: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        {['1.0', '0.9', '0.8', '0.7', '0.5', '0.3', '0.2'].map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[0.6875rem] font-black uppercase tracking-wider text-gray-500 mb-1.5">
                        How often it changes
                      </label>
                      <select
                        value={own.changefreq || page.changefreq}
                        onChange={(e) => patchPage(page.path, { changefreq: e.target.value })}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        {['daily', 'weekly', 'monthly', 'yearly'].map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-[0.6875rem] font-bold text-gray-400">
                    Both are hints in the sitemap. Google reads them and then makes up its own mind.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[0.75rem] leading-relaxed text-gray-600 bg-gray-50 rounded-2xl p-4">
        Product pages are not in this list — each product writes its own title and description in the product
        form, under <b>Google — search result &amp; Shopping</b>.
      </p>
    </Card>
  );
}

// --------------------------------------------------------- 3. robots/sitemap

function RobotsSection({
  draft,
  patch,
  origin,
}: {
  draft: SeoSettings;
  patch: (next: Partial<SeoSettings>) => void;
  origin: string;
}) {
  const custom = draft.robotsMode === 'custom';
  const [newPath, setNewPath] = useState('');
  const extra = draft.robotsExtraDisallow || [];

  return (
    <>
      <Card
        icon={<FileCode2 className="w-5 h-5" />}
        title="robots.txt"
        subtitle="What crawlers are allowed to read"
        badge={
          <a
            href={`${origin}/robots.txt`}
            target="_blank"
            rel="noreferrer"
            className="text-[0.6875rem] font-black text-blue-600 hover:underline flex items-center gap-1 shrink-0"
          >
            See it live <ExternalLink className="w-3 h-3" />
          </a>
        }
      >
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => patch({ robotsMode: 'auto' })}
            className={
              'px-4 py-2 rounded-2xl text-[0.75rem] font-black border transition-colors ' +
              (!custom ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300')
            }
          >
            Built automatically
          </button>
          <button
            type="button"
            onClick={() => patch({ robotsMode: 'custom' })}
            className={
              'px-4 py-2 rounded-2xl text-[0.75rem] font-black border transition-colors ' +
              (custom ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500 hover:border-gray-300')
            }
          >
            I'll write it myself
          </button>
        </div>

        {!custom ? (
          <div className="space-y-4">
            <p className="text-[0.75rem] leading-relaxed text-gray-600">
              The shop already keeps crawlers out of the dashboard, the checkout, the editor and every customer
              page. Add anything else you want kept out below — one address per line.
            </p>

            <div className="flex flex-wrap gap-2">
              {extra.length === 0 && (
                <span className="text-[0.75rem] font-bold text-gray-400">Nothing extra is blocked.</span>
              )}
              {extra.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-[0.75rem] font-bold"
                >
                  <code className="font-mono">{p}</code>
                  <button
                    type="button"
                    onClick={() => patch({ robotsExtraDisallow: extra.filter((x) => x !== p) })}
                    className="text-gray-400 hover:text-red-600 font-black"
                    aria-label={`Stop blocking ${p}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="/some-page"
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => {
                  const v = newPath.trim();
                  if (!v) return;
                  const withSlash = v.startsWith('/') ? v : `/${v}`;
                  if (!extra.includes(withSlash)) patch({ robotsExtraDisallow: [...extra, withSlash] });
                  setNewPath('');
                }}
                className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 text-white text-[0.75rem] font-black rounded-2xl transition-colors"
              >
                Block it
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[0.75rem] leading-relaxed text-amber-900">
                <b>One wrong line here removes the whole shop from Google.</b> A file containing{' '}
                <code className="font-mono">Disallow: /</code> tells every search engine to leave, and it can
                take weeks to come back. If you are not sure, use the automatic version.
              </p>
            </div>
            <textarea
              rows={12}
              value={draft.robotsCustom || ''}
              onChange={(e) => patch({ robotsCustom: e.target.value })}
              placeholder={'User-agent: *\nAllow: /\nDisallow: /admin'}
              spellCheck={false}
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-[0.75rem] font-mono text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            />
            <p className="text-[0.6875rem] font-bold text-gray-400">
              The <code className="font-mono">Sitemap:</code> line is added for you if you leave it out.
            </p>
          </div>
        )}
      </Card>

      <Card
        icon={<RefreshCw className="w-5 h-5" />}
        title="sitemap.xml"
        subtitle="The list of addresses handed to Google — rebuilt every time you add a product"
        badge={
          <a
            href={`${origin}/sitemap.xml`}
            target="_blank"
            rel="noreferrer"
            className="text-[0.6875rem] font-black text-blue-600 hover:underline flex items-center gap-1 shrink-0"
          >
            See it live <ExternalLink className="w-3 h-3" />
          </a>
        }
      >
        <CopyBox label="Give this address to Search Console" value={`${origin}/sitemap.xml`} />
        <p className="text-[0.75rem] leading-relaxed text-gray-600 bg-gray-50 rounded-2xl p-4">
          Every visible product and every page above is listed automatically. To keep one product out, open it
          in <b>Products</b> and tick <i>Keep out of the sitemap</i> — the switch is next to its Google fields,
          where you can see which product you are hiding.
        </p>
      </Card>
    </>
  );
}

// ------------------------------------------------------- 4. Merchant Center

/** What the feed tells Google about delivery — read-only; the prices are edited in the Shipping tab. */
function ShippingFeedLines() {
  const { shipping, vatRate, language } = useAuth();
  const lines = feedShippingLines(shipping, vatRate);
  return (
    <div className="md:col-span-2 p-3.5 bg-gray-50 border border-gray-100 rounded-2xl space-y-1.5" data-rx-feed-shipping>
      <p className="text-[0.6875rem] font-black uppercase tracking-wider text-gray-500">Shipping in the feed (incl. VAT)</p>
      {lines.length === 0 ? (
        <p className="text-xs font-bold text-amber-700">No country has a delivery price — the feed sends no shipping, and Google uses your Merchant Center settings.</p>
      ) : (
        <ul className="text-xs font-bold text-gray-800 space-y-0.5">
          {lines.map((l) => {
            const c = shipping.countries.find((x) => x.code === l.country);
            return (
              <li key={l.country} className="flex gap-3">
                <span className="w-40">{c ? countryLabel(c, language) : l.country}</span>
                <span className="tabular-nums">{l.price} SEK</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[0.6875rem] font-bold text-gray-400">The cheapest delivery to each country, from the Shipping tab — the price checkout charges.</p>
    </div>
  );
}

function MerchantSection({
  draft,
  patch,
  origin,
}: {
  draft: SeoSettings;
  patch: (next: Partial<SeoSettings>) => void;
  origin: string;
}) {
  const m = draft.merchant || DEFAULT_SEO_SETTINGS.merchant!;
  const setM = (next: Partial<typeof m>) => patch({ merchant: { ...m, ...next } });

  return (
    <Card
      icon={<ShoppingBag className="w-5 h-5" />}
      title="Google Shopping"
      subtitle="A product feed Merchant Center can read, built from your own catalogue"
      badge={
        <span
          className={
            'inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wide shrink-0 ' +
            (m.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')
          }
        >
          {m.enabled ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          <span>{m.enabled ? 'Feed is live' : 'Switched off'}</span>
        </span>
      }
    >
      {/*
        * The lock is off. It was here because the feed quoted 201.25 SEK for a
        * product whose page said 161.00 — measured on production — and one tick
        * would have sent 33 of those to Merchant Center, where disapproval and
        * suspension happen somewhere we cannot undo them.
        *
        * What removed it: the page's structured data and the feed now compute the
        * price from one formula, and the product page prints the VAT-inclusive
        * figure beside the net one, so the number Google is told is a number a
        * visitor can see. scripts/test-seo-price.mjs fails the build if the two
        * ever drift apart again.
        */}
      <label className="flex items-start gap-3 p-3.5 bg-gray-50 border border-gray-100 rounded-2xl cursor-pointer">
        <input
          type="checkbox"
          checked={m.enabled === true}
          onChange={(e) => setM({ enabled: e.target.checked })}
          className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
        />
        <span>
          <span className="block text-[0.75rem] font-black text-gray-800">Publish the product feed</span>
          <span className="block text-[0.6875rem] font-bold text-gray-400 leading-snug">
            Until this is on, the address below answers "not found" — which is the right answer. An empty or
            half-finished feed turns into policy warnings against your Merchant account, not into sales.
          </span>
        </span>
      </label>

      {m.enabled && <CopyBox label="Give this address to Merchant Center" value={`${origin}/feed.xml`} />}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Text
          label="Default brand"
          placeholder="Leave empty to use the shop's name"
          hint="Used for any product that does not set its own."
          value={m.defaultBrand || ''}
          onChange={(v) => setM({ defaultBrand: v })}
        />
        <div>
          <label className="block text-[0.6875rem] font-black uppercase tracking-wider text-gray-500 mb-1.5">
            Default condition
          </label>
          <select
            value={m.defaultCondition || 'new'}
            onChange={(e) => setM({ defaultCondition: e.target.value as 'new' | 'refurbished' | 'used' })}
            className="w-full px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {MERCHANT_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <Text
            label="Default Google category"
            placeholder="Business & Industrial > Signage > Business Signs"
            hint="Google's own list of categories. One that fits most of what you sell is enough — a product can set its own."
            value={m.defaultGoogleCategory || ''}
            onChange={(v) => setM({ defaultGoogleCategory: v })}
          />
        </div>

        {/* SHIPPING IN THE ADS = WHAT CHECKOUT CHARGES. This was a country and a
            price typed here, separately from the checkout — and it defaulted to
            0, so the ads promised free delivery while checkout charged 99 kr.
            The feed now sends his own prices (Admin → Shipping), one line per
            country, incl. VAT; this only shows them. The old fields stay in the
            saved settings, untouched, should this ever be rolled back. */}
        <ShippingFeedLines />
      </div>

      <label className="flex items-start gap-3 p-3.5 bg-gray-50 border border-gray-100 rounded-2xl cursor-pointer">
        <input
          type="checkbox"
          checked={m.includeZeroPriced === true}
          onChange={(e) => setM({ includeZeroPriced: e.target.checked })}
          className="mt-0.5 w-4 h-4 accent-blue-600 shrink-0"
        />
        <span>
          <span className="block text-[0.75rem] font-black text-gray-800">Include products priced at 0 kr</span>
          <span className="block text-[0.6875rem] font-bold text-gray-400 leading-snug">
            Off by default: a 0 kr product is nearly always one that has not been finished, and advertising it
            at nothing is worse than not advertising it.
          </span>
        </span>
      </label>

      <div className="flex gap-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-[0.75rem] leading-relaxed text-amber-900 space-y-1.5">
          <p className="font-black">Two things Merchant Center will suspend an account over</p>
          <p>
            {/* This paragraph once claimed the feed and the page already agreed,
                while they differed by 25%. It now describes what was actually
                built to make that true. */}
            <b>The price must match the page, and now it does.</b> Your prices are stored without VAT and the
            shop shows them that way — which is right for trade customers. Google quotes a consumer price, so
            the feed sends the figure including VAT, the product page prints that same figure beside the net
            one, and the page's structured data quotes it too. All three come from one formula and a build
            check fails if they ever drift apart. If you change the VAT rate, all three move together.
          </p>
          <p>
            <b>A product with no barcode must say so.</b> Custom print has none, and the feed tells Google that
            outright instead of leaving it to guess and reject the item. Fill in a GTIN only if the product
            really has one.
          </p>
        </div>
      </div>
    </Card>
  );
}
