import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Globe, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { LocalizedText } from '../../types';
import { cn } from '../../lib/utils';
import { useAuth } from '../../App';
import { auth } from '../../firebase';

/**
 * WHY THIS IS ITS OWN FILE
 *
 * It lives here rather than beside the printing-field editor because the
 * CATEGORY screen needs it too, and importing it from that editor dragged the
 * whole product-form bundle — 634 KB — onto a screen that shows eight tiles.
 * It is a small, self-contained control; it should cost what it looks like.
 */
const I18N_LANGS: { code: keyof LocalizedText; label: string; flag: string }[] = [
  { code: 'sv', label: 'Svenska', flag: '🇸🇪' },
  { code: 'da', label: 'Dansk', flag: '🇩🇰' },
  { code: 'no', label: 'Norsk', flag: '🇳🇴' },
];

/**
 * The same map, but honest about a CLEARED language.
 *
 * `LocalizedText` says `string | undefined`, which is what a saved map holds;
 * while the owner is editing, a language he has emptied has to travel as an
 * explicit null so the merge write actually clears it (see `set` below). The
 * widening belongs on `LocalizedText` itself, in src/types/index.ts, and lives
 * here only because this control does not own that file.
 */
type LocalizedTextDraft = { [K in keyof LocalizedText]: string | null };

export const SMALL_INPUT =
  'w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-[0.6875rem] font-bold text-gray-700 bg-white';

export { I18N_LANGS };

/**
 * Two strings compared the way a PERSON would call them the same — 15.3.2b.
 *
 * The badge that says "this box says the same as the English" used an exact,
 * case-folded compare, and so missed the one product it was written for:
 * the English name is "Roll UP Standard 85×200 Small" and what came back is
 * "Roll-up Standard 85x200 Small". A hyphen and a multiplication sign apart —
 * the model's own tidying — and the owner got no warning at all on the screen
 * he photographed.
 *
 * Punctuation and spacing are folded away; the words and numbers are what
 * decide. It is deliberately not fuzzy beyond that: a genuine translation that
 * differs by one letter is a translation, and calling it an echo would send him
 * re-translating good text.
 */
export function foldForCompare(text: string | undefined): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * IS THERE AN AI TO ASK? ASKED ONCE PER PAGE, NOT ONCE PER BOX — 15.3.11.
 *
 * Every instance of this control used to run its own `/api/health` on mount,
 * with a two-second retry. That was fine while there were two of them on a
 * screen. This control is now on every property name, every help text and every
 * option label, so expanding one attribute with twenty options fires
 * twenty-two parallel probes at a host with a measured record of stalling and
 * answering 502 after forty seconds — and a probe that fails HIDES THE BUTTON,
 * which is the exact complaint being fixed. Some rows with a button and some
 * without would look worse than none at all.
 *
 * One promise, shared. It is still asked TWICE before it gives up, for the same
 * reason as before: one dropped request must not switch the feature off, and
 * only an answer FROM THE SERVER may take it off the screen.
 *
 * Deliberately not cached across a failure: `aiHealthPromise` is cleared when
 * the answer is `false`, so installing a key and reopening the dialog asks
 * again rather than requiring a reload.
 */
let aiHealthPromise: Promise<boolean> | null = null;
export function aiHealth(): Promise<boolean> {
  if (aiHealthPromise) return aiHealthPromise;
  const ask = (attempt: number): Promise<boolean> =>
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => d?.chat === true)
      .catch(() => {
        if (attempt === 0) {
          return new Promise<boolean>((resolve) => {
            window.setTimeout(() => resolve(ask(1)), 2000);
          });
        }
        return false;
      });
  aiHealthPromise = ask(0).then((on) => {
    if (!on) aiHealthPromise = null;
    return on;
  });
  return aiHealthPromise;
}

/**
 * ASK THE SHOP'S AI TO TRANSLATE ONE PIECE OF TEXT — 15.4.4.
 *
 * Lifted out of the control below so the SEO screen can use the same call. That
 * screen's boxes are a different shape — a character counter, a Google preview,
 * and a "primary" language that is whichever one the crawler is served — so it
 * keeps its own layout and borrows only this.
 *
 * It throws nothing and decides nothing: the caller owns the wording of every
 * message, because the wording is where this feature has failed before.
 */
export async function translateViaApi(
  source: string,
  languages: string[],
  kind: string,
  overwrite = false,
): Promise<{ ok: boolean; translations: Record<string, string>; echoed: string[]; upstream?: number }> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  const res = await fetch('/api/admin/translate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text: source, languages, kind, overwrite }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, translations: {}, echoed: [], upstream: Number(body?.upstream ?? 0) || undefined };
  }
  return {
    ok: true,
    translations: (body?.translations ?? {}) as Record<string, string>,
    echoed: Array.isArray(body?.echoed) ? (body.echoed as string[]) : [],
  };
}

/**
 * THE SAME CALL, FOR A WHOLE LIST AT ONCE — 15.4.5.
 *
 * One request instead of one per box. See the endpoint's own comment for why
 * that matters: this shop's rate limiter is fifteen requests a minute per IP,
 * shared with the chat and the contact form, and a property with fourteen
 * options would otherwise need sixteen.
 *
 * `results` is keyed by the id the caller sent. An id the model skipped is
 * simply missing, so the caller leaves that box alone rather than filling it
 * with a neighbour's answer.
 */
export async function translateManyViaApi(
  items: { id: string; text: string }[],
  languages: string[],
  kind: string,
): Promise<{
  ok: boolean;
  results: Record<string, Record<string, string>>;
  echoed: Record<string, string[]>;
  missed: string[];
  upstream?: number;
}> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  const res = await fetch('/api/admin/translate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ items, languages, kind }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, results: {}, echoed: {}, missed: [], upstream: Number(body?.upstream ?? 0) || undefined };
  }
  return {
    ok: true,
    results: (body?.results ?? {}) as Record<string, Record<string, string>>,
    echoed: (body?.echoed ?? {}) as Record<string, string[]>,
    missed: Array.isArray(body?.missed) ? (body.missed as string[]) : [],
  };
}

/**
 * A collapsible sv/da/no row for one piece of owner-authored text.
 *
 * Used for a PRODUCT's name and description, which the storefront renders
 * through localized() exactly the way it renders a field's name. Without it the
 * dashboard could only edit the English string, so a rename never reached the
 * Swedish shop and the owner had no way to see why.
 */
export function LocalizedTextFields({
  label,
  fallback,
  value,
  onChange,
  multiline,
}: {
  label: string;
  /** The English text, shown as the placeholder — that is what a blank box means. */
  fallback: string;
  value: LocalizedText;
  onChange: (next: LocalizedText) => void;
  multiline?: boolean;
}): React.ReactElement {
  const { t, language } = useAuth();
  const [open, setOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  // The line under the button, and whether it is a FAILURE or a nudge.
  //
  // It used to be one red box for both, so "all three are already filled" and
  // "write the English text first" — neither of which is anything going wrong —
  // were dressed as errors. `tone` is what separates them; the text still comes
  // from the same four-language table.
  const [note, setNote] = useState<{ text: string; tone: 'error' | 'hint' } | null>(null);
  const fail = (text: string) => setNote({ text, tone: 'error' });
  const hint = (text: string) => setNote({ text, tone: 'hint' });
  /**
   * The overwrite button is ARMED before it fires — 15.3.4.
   *
   * Two presses, with the warning in between, because this is the one action in
   * the control that can destroy work: the comment on `translate()` records the
   * evening of hand-written Swedish that machine text replaced, which is why
   * the ordinary button only ever fills empty boxes. A confirm dialog would be
   * heavier than the control itself; a button that says what it is about to do
   * and waits for a second press is the same guarantee.
   */
  const [armed, setArmed] = useState(false);

  // IS THERE AN AI TO ASK?
  //
  // Until 2026-09-13 the AI key was a server environment variable with no
  // dashboard panel, so the owner could not switch it on himself. He can now —
  // Payments & API keys, any of three providers. Without a key every click still
  // returns a 503 — and the shop already learned this lesson twice: the competitor
  // analyser and the chat launcher both ask /api/health first and hide
  // themselves rather than offer a button that cannot work. This is the third
  // AI feature and it does the same. null = not asked yet, so it never flashes
  // in and then out.
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    aiHealth().then((on) => { if (!cancelled) setAiAvailable(on); });
    return () => { cancelled = true; };
  }, []);

  // A translation takes seconds. The field can be unmounted by then — the
  // product modal is `{isModalOpen && …}` while the state it writes to lives on
  // the PARENT, so a late answer used to be applied to whatever product or
  // category had been opened next. This says which request is still the one
  // being waited for, and anything else is dropped.
  const liveRequest = useRef(0);
  useEffect(() => () => { liveRequest.current = -1; }, []);
  const filled = I18N_LANGS.filter(({ code }) => (value?.[code] ?? '').trim().length > 0).length;
  /** Is there English to translate FROM yet? It decides how the button looks, not whether it exists. */
  const hasSource = (fallback || '').trim().length > 0;

  /**
   * WHICH BOXES SAY THE SAME THING AS THE ENGLISH — 15.3.2.
   *
   * "الترجمه ما شغاله تظهر نفس المعلومات" — he opened a product, saw three
   * identical lines, and reported the translator as broken. It was not: the AI
   * had been asked and had answered "Roll-up Standard 85x200 Small" in all
   * three languages, because the prompt tells it to leave product codes, sizes
   * and identifiers alone and that name looks exactly like one. Nothing on the
   * screen said so — an answer identical to the question was stored, counted as
   * translated, and locked that language out of the button for ever.
   *
   * This is the count the chip needed. It is NOT treated as empty: "Banner",
   * "Standard" and "Design" are genuinely the same word in Swedish, Danish and
   * Norwegian, and auto-clearing them would spin the AI on strings that were
   * already right and could replace a correct word with a worse invented one.
   * It is shown, and he decides.
   */
  const sourceText = foldForCompare(fallback);
  const sameAsSource = I18N_LANGS.filter(({ code }) => {
    const text = (value?.[code] ?? '').trim();
    return text.length > 0 && sourceText.length > 0 && foldForCompare(text) === sourceText;
  }).map(({ code }) => code);

  /**
   * …AND BOXES THAT SAY THE SAME AS EACH OTHER — 15.3.2c.
   *
   * "تظهر نفس المعلومات" — the three boxes show the same information. That is
   * what he wrote, and the warning above does not catch it: it compares each box
   * with the ENGLISH, and on the product he photographed the boxes do not match
   * the English name at all. Live, `prod-pmp-49` is stored as
   *
   *     name    "Roll UP Standard"
   *     sv/da/no "Roll-up Standard 85x200 Small"   ← all three, byte for byte
   *
   * so nothing was flagged, the counter said 3/3, and the ordinary button
   * answered "all three are already filled". On the one screen that started this
   * round he saw exactly what he saw before.
   *
   * Three identical translations are not proof of a mistake — "Banner" really is
   * "Banner" in Danish and Norwegian — which is why this warns rather than
   * clears anything, and why the wording says what it sees instead of calling it
   * an error.
   */
  const duplicated = (() => {
    const byText = new Map<string, (keyof LocalizedText)[]>();
    for (const { code } of I18N_LANGS) {
      const text = foldForCompare(value?.[code] ?? '');
      if (!text) continue;
      byText.set(text, [...(byText.get(text) ?? []), code]);
    }
    return [...byText.values()].filter((codes) => codes.length > 1).flat();
  })();

  /** Every box worth a second look, whichever way it is suspicious. */
  const flagged = I18N_LANGS
    .map(({ code }) => code)
    .filter((code) => sameAsSource.includes(code) || duplicated.includes(code));

  // The nudge goes away the moment it stops being true. Without this, "write the
  // English text first" would sit under the box he has just written in,
  // contradicting the screen.
  useEffect(() => {
    if (hasSource) setNote((n) => (n?.tone === 'hint' ? null : n));
  }, [hasSource]);

  // A PRIMED OVERWRITE DOES NOT SURVIVE AN EDIT. He armed the button against
  // one piece of text; if he then changes the English, or the dialog is reused
  // for another product, the second press must not inherit that consent.
  useEffect(() => { setArmed(false); }, [fallback]);

  /**
   * Fill the three boxes from the English text.
   *
   * It fills the FORM, it does not save. The owner reads what came back and
   * presses Save like any other edit — a machine translation written straight
   * into the live shop with nobody looking is how a hero slide nearly offered
   * "tryckrullar", printing-press ROLLERS, to someone buying labels.
   *
   * Boxes he has already written in are left alone: this is help, not a
   * correction of his own words. `overwrite` is the deliberate exception —
   * a second, separate button behind a confirmation (15.3.4).
   */
  const translate = async (overwrite = false) => {
    const source = (fallback || '').trim();
    if (translating) return;
    // NOTHING TO TRANSLATE FROM — and this is the one case the button used to
    // answer by not existing. The owner opened a new product, expanded the three
    // language boxes, found no AI anywhere on the form and reported the
    // translator as missing; it was waiting for the English name he had not
    // typed yet, and nothing on screen said so. The button stays, and pressing
    // it now says what to do instead of doing nothing.
    if (!source) {
      hint(t('i18nTranslateNeedsSource'));
      setOpen(true);
      return;
    }
    setTranslating(true);
    setNote(null);
    try {
      // ONLY THE EMPTY ONES. When there is nothing empty this does nothing and
      // says so — it used to promote "nothing to fill" into "refill all three",
      // which is the one case the button promises is safe and the only case in
      // which an evening of hand-written Swedish was replaced by machine text.
      //
      // OVERWRITE asks for all three on purpose. It is a different button, it
      // says what it will do, and it is confirmed before it runs (15.3.4) —
      // because the honest answer to "the AI gave me the English back" is to
      // let him ask again, not to leave him editing three boxes by hand with a
      // button on screen that refuses to help.
      const wanted = overwrite
        ? I18N_LANGS.map(({ code }) => code)
        : I18N_LANGS.map(({ code }) => code).filter((code) => !(value?.[code] ?? '').trim());
      if (wanted.length === 0) {
        hint(t('i18nTranslateAllFilled'));
        setOpen(true);
        return;
      }

      const ticket = liveRequest.current + 1;
      liveRequest.current = ticket;

      // A STABLE English word for `kind`, not `label` — that is a translated UI
      // string, so a Swedish dashboard was telling Gemini the text is "a Rubrik
      // på andra språk".
      const body = await translateViaApi(
        source,
        wanted,
        multiline ? 'description' : 'short name or heading',
        overwrite,
      );
      // The field was closed, or another translation was started after this one.
      if (liveRequest.current !== ticket) return;
      if (!body.ok) {
        // THE TRANSLATED LINE ALWAYS, PLUS THE NUMBER.
        //
        // This used to show the server's English sentence to an English dashboard
        // and the generic translated line to everyone else — so a Swedish admin
        // could not tell a missing key from a quota from a retired model. The
        // server now sends `upstream`: a bare status number, which reads the same
        // in four languages, is quotable over WhatsApp, and cannot itself be
        // mistranslated. The provider's own words stay in the server log, where
        // they belong — they name quotas, models and sometimes the key.
        const upstream = body.upstream ?? 0;
        fail(upstream ? `${t('i18nTranslateFailed')} (${upstream})` : t('i18nTranslateFailed'));
        return;
      }
      const got = body.translations;
      const next: LocalizedTextDraft = { ...(value || {}) };
      let changed = 0;
      for (const code of wanted) {
        const text = typeof got[code] === 'string' ? got[code].trim() : '';
        if (!text) continue;
        next[code as keyof LocalizedText] = text;
        changed += 1;
      }
      if (changed === 0) {
        fail(t('i18nTranslateEmpty'));
        return;
      }
      /**
       * THE AI GAVE THE ENGLISH BACK, AND NOW IT SAYS SO — 15.3.7.
       *
       * The server compares each answer with the text it was given and names
       * the languages that came back unchanged. Before this the reply was
       * stored in silence and the screen showed three identical lines with a
       * counter saying they were translated, which is what "الترجمه ما شغاله"
       * was describing. It is a note and not an error: for "Banner", "Design"
       * or "Standard" the identical answer is the correct one, and only he can
       * tell those apart from a name the model refused to touch.
       */
      const echoed = body.echoed;
      if (echoed.length) {
        const names = echoed
          .map((code) => I18N_LANGS.find((l) => l.code === code)?.label ?? code)
          .join(', ');
        hint(t('i18nTranslateEchoed').replace('{0}', names));
      }
      if (liveRequest.current !== ticket) return;
      onChange(next as LocalizedText);
      setOpen(true);
    } catch (err) {
      console.error('Translation request failed:', err);
      fail(t('i18nTranslateFailed'));
    } finally {
      setTranslating(false);
    }
  };

  const set = (lang: keyof LocalizedText, text: string) => {
    // An emptied box writes an explicit null, it does NOT drop the key. The
    // screens that save one of these maps as part of a document — products,
    // categories, the site settings, the About and Services pages — all write
    // with { merge: true }, and the SDK builds its field mask one LEAF at a
    // time, so a dropped `nameI18n.da`
    // is simply not in the mask and the stored Danish string is left standing.
    // The owner cleared the Danish box, saved, saw an empty box, and Danish
    // visitors went on reading the old text with nothing in the dashboard to
    // explain it or any way to remove it. null is what clears a leaf;
    // localized() short-circuits on it exactly as it does on undefined, and the
    // "n/3" counter above already reads it as empty. The callers' `Object.keys
    // (map).length ? map : null` guard only covers the one case where every
    // language is cleared at once.
    const next: LocalizedTextDraft = { ...(value || {}) };
    next[lang] = text.trim() ? text : null;
    onChange(next as LocalizedText);
  };

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[0.625rem] font-black transition-colors',
          open
            ? 'border-blue-400 bg-blue-50 text-blue-700'
            : filled > 0
              ? 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
              : 'border-dashed border-gray-300 bg-white text-gray-400 hover:border-blue-300 hover:text-blue-600',
        )}
      >
        <Globe className="w-3.5 h-3.5" />
        <span>
          {label} — {t('i18nTranslatedCount')
            .replace('{0}', String(filled))
            .replace('{1}', String(I18N_LANGS.length))}
        </span>
      </button>

      {/* "N SAY THE SAME AS THE ENGLISH" — 15.3.2. The counter alone said
          "3/3 translated" over three identical lines, which is exactly the
          screen he photographed and called broken. This is the missing half of
          that sentence, and it is amber rather than red because an identical
          answer is sometimes the right one. */}
      {flagged.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={t('i18nSameAsEnglishHint')}
          className="ml-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-[0.625rem] font-black hover:border-amber-400 transition-colors"
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>
            {(sameAsSource.length > 0
              ? t('i18nSameAsEnglishCount').replace('{0}', String(sameAsSource.length))
              : t('i18nSameAsEachOther').replace('{0}', String(duplicated.length)))}
          </span>
        </button>
      )}

      {/* ON SCREEN WHENEVER THERE IS AN AI TO ASK — including before he has
          typed the English text. It used to be hidden until then, which is
          indistinguishable from a shop with no AI key at all, and that is how it
          was read: three empty language boxes, no button, "there is no
          translation". Waiting for a source is now something the button SAYS,
          in the dashboard's own language, when it is pressed. It still fills
          only the boxes he has left empty. */}
      {aiAvailable === true && (
        <button
          type="button"
          onClick={() => { setArmed(false); void translate(false); }}
          disabled={translating}
          title={hasSource ? t('i18nTranslateHint') : t('i18nTranslateNeedsSource')}
          className={cn(
            'ml-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[0.625rem] font-black transition-colors',
            hasSource
              ? 'border-purple-200 bg-purple-50 text-purple-700 hover:border-purple-400'
              : 'border-dashed border-purple-200 bg-white text-purple-400 hover:border-purple-400 hover:text-purple-600',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          )}
        >
          {translating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          <span>{translating ? t('i18nTranslating') : t('i18nTranslate')}</span>
        </button>
      )}

      {/* TRANSLATE AGAIN, ON PURPOSE — 15.3.4.
          A SECOND button, never what the first one does. It exists because the
          answer to "the AI returned my English" used to be a blue note telling
          him to empty a box by hand, with a button on screen that then refused
          to help. It arms on the first press, says what it will replace, and
          only the second press sends. Shown once something is in the boxes —
          before that the ordinary button already does the job. */}
      {aiAvailable === true && hasSource && filled > 0 && (
        <button
          type="button"
          onClick={() => {
            if (!armed) { setArmed(true); hint(t('i18nRetranslateConfirm')); setOpen(true); return; }
            setArmed(false);
            void translate(true);
          }}
          disabled={translating}
          title={t('i18nRetranslateHint')}
          className={cn(
            'ml-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[0.625rem] font-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
            armed
              ? 'border-red-300 bg-red-50 text-red-700 hover:border-red-500'
              : 'border-gray-200 bg-white text-gray-600 hover:border-purple-400 hover:text-purple-700',
          )}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', translating && 'animate-spin')} />
          <span>{armed ? t('i18nRetranslateAgain') : t('i18nRetranslate')}</span>
        </button>
      )}

      {note && (
        <p
          role={note.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={cn(
            'mt-1.5 text-[0.625rem] font-bold rounded-lg px-2 py-1 border',
            note.tone === 'error'
              ? 'text-red-600 bg-red-50 border-red-100'
              : 'text-blue-700 bg-blue-50 border-blue-100',
          )}
        >
          {note.text}
        </p>
      )}

      {open && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
            {I18N_LANGS.map(({ code, label: langLabel, flag }) => {
              const text = value?.[code] ?? '';
              const isSame = flagged.includes(code);
              const sameWhat = sameAsSource.includes(code) ? t('i18nSameAsEnglish') : t('i18nSameAsOther');
              return (
                <div key={code}>
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <label className="block text-[0.625rem] font-bold text-gray-500">
                      {flag} {langLabel}
                      {/* Named on the box itself, not only counted above it. */}
                      {isSame && <span className="ml-1 text-amber-600">· {sameWhat}</span>}
                    </label>
                    {/* EMPTY THIS ONE LANGUAGE — 15.3.3. The note that says
                        "clear a box first if you want it translated again" has
                        told him to do this by hand since round 14; there was
                        never a button for it. It goes through `set`, so a
                        cleared box travels as the explicit null a merge write
                        needs rather than as a dropped key. */}
                    {text.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() => set(code, '')}
                        title={t('i18nClearLanguage')}
                        aria-label={`${t('i18nClearLanguage')} — ${langLabel}`}
                        className="p-0.5 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {multiline ? (
                    <textarea
                      rows={3}
                      value={text}
                      onChange={(e) => set(code, e.target.value)}
                      placeholder={t('i18nEmptyBox')}
                      className={cn(
                        'w-full px-2.5 py-1.5 border rounded-lg text-[0.6875rem] font-bold text-gray-700 bg-white resize-none',
                        isSame ? 'border-amber-300' : 'border-gray-200',
                      )}
                    />
                  ) : (
                    <input
                      type="text"
                      value={text}
                      onChange={(e) => set(code, e.target.value)}
                      placeholder={t('i18nEmptyBox')}
                      className={cn(SMALL_INPUT, isSame && 'border-amber-300')}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {/* WHAT AN EMPTY BOX MEANS, SAID ONCE — 15.3.1.
              The three boxes used to carry the English text as their
              placeholder. A box he had never filled therefore showed the
              product's English name in grey, identical to the two beside it
              that really were translated: "الترجمه ما شغاله تظهر نفس المعلومات"
              — three lines of the same text, and a counter saying 2/3 with
              nothing on screen to say which one was the empty one. The English
              is still here, where it cannot be mistaken for an answer. */}
          {hasSource && (
            <p className="mt-1.5 text-[0.625rem] font-medium text-gray-400">
              {t('i18nEmptyBoxNote').replace('{0}', fallback.trim())}
            </p>
          )}
        </>
      )}
    </div>
  );
}
