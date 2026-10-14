import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AlertTriangle, CheckCircle2, ExternalLink, RotateCcw, Save, Shield } from 'lucide-react';
import { db } from '../../firebase';
import { useConfirmDialog } from '../ConfirmDialog';
import { LANGUAGES, type Language } from '../../lib/translations';
import { getLegalDocument, documentToText, type LegalKind } from '../../lib/legal';

/**
 * Lets the shop owner write the privacy policy, the terms and the cookie notice
 * himself, in each language.
 *
 * These pages carry statements only he can make truthfully — how long artwork is
 * kept, what the delivery times are, the complaint window — so the shipped
 * drafts leave those as visible gaps. Leaving a box empty here keeps the draft;
 * typing in it replaces that page entirely, for that language.
 *
 * The format is deliberately plain: a line starting with ## is a heading, blank
 * lines separate paragraphs. No rich-text editor to fight, and nothing that can
 * inject markup into the page.
 */

const KINDS: { key: LegalKind; label: string; path: string }[] = [
  { key: 'privacy', label: 'Privacy policy', path: '/privacy' },
  { key: 'terms', label: 'Terms and conditions', path: '/terms' },
  { key: 'cookies', label: 'Cookies', path: '/cookies' },
];

type Overrides = Partial<Record<LegalKind, Partial<Record<Language, string>>>>;

export default function LegalPagesAdmin() {
  // In-page dialogs, never window.confirm/alert — a browser that has been told
  // to stop prompting silences those, and the action then does nothing at all.
  const { confirm, notify, dialog: confirmDialog } = useConfirmDialog();
  const [kind, setKind] = useState<LegalKind>('privacy');
  const [language, setLanguage] = useState<Language>('en');
  const [overrides, setOverrides] = useState<Overrides>({});
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'settings', 'legalPages'))
      .then((snap) => setOverrides(snap.exists() ? ((snap.data()?.overrides ?? {}) as Overrides) : {}))
      .catch((err) => {
        console.error('Could not load the legal pages:', err);
        setMessage({ kind: 'error', text: 'The saved texts could not be loaded.' });
      })
      .finally(() => setLoading(false));
  }, []);

  // Follow the pickers.
  useEffect(() => {
    setDraft(overrides[kind]?.[language] ?? '');
    setMessage(null);
  }, [kind, language, overrides]);

  const shippedDraft = documentToText(getLegalDocument(kind, language));
  const isOverridden = Boolean(overrides[kind]?.[language]?.trim());

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const next: Overrides = {
        ...overrides,
        [kind]: { ...(overrides[kind] ?? {}), [language]: draft.trim() },
      };
      await setDoc(
        doc(db, 'settings', 'legalPages'),
        { overrides: next, updatedAt: new Date().toISOString() },
        { merge: true },
      );
      setOverrides(next);
      setMessage({ kind: 'ok', text: 'Saved. The page is live.' });
    } catch (err: any) {
      console.error('Saving the legal page failed:', err);
      setMessage({ kind: 'error', text: err?.message || 'That could not be saved.' });
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    const ok = await confirm({
      title: 'Go back to the supplied draft?',
      message: 'Your text for this page and language is cleared.',
      confirmLabel: 'Revert',
    });
    if (!ok) return;
    setDraft('');
  };

  if (loading) return <div className="py-16 text-center text-sm font-bold text-gray-400">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-black text-gray-900">Legal pages</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl leading-relaxed">
            Write your own privacy policy, terms and cookie notice. Leave a box empty to keep the supplied draft. These
            pages are linked from the footer on every page and are required for a shop trading in the EU.
          </p>
        </div>
        <a
          href={KINDS.find((k) => k.key === kind)?.path}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-blue-600"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          View the live page
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-colors ${
              kind === k.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map((l) => {
          const written = Boolean(overrides[kind]?.[l.code]?.trim());
          return (
            <button
              key={l.code}
              onClick={() => setLanguage(l.code)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-colors border ${
                language === l.code ? 'border-gray-900 bg-white text-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {l.flag} {l.name}
              {written && <span className="ml-1.5 text-emerald-600">●</span>}
            </button>
          );
        })}
      </div>

      {message && (
        <div
          role="alert"
          className={`flex items-start gap-2.5 rounded-2xl px-4 py-3 border ${
            message.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-300 text-amber-900'
          }`}
        >
          {message.kind === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          )}
          <p className="text-xs font-bold">{message.text}</p>
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <label className="text-xs font-black text-gray-700 uppercase tracking-wide">Your text</label>
          <span className="text-[0.6875rem] font-bold text-gray-400">
            {isOverridden ? 'Using your text' : 'Using the supplied draft'}
          </span>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={22}
          placeholder={'Leave empty to keep the supplied draft.\n\n## A heading\nA paragraph.\n\nAnother paragraph.'}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-2xl text-sm text-gray-900 leading-relaxed font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-[0.6875rem] text-gray-400 mt-1.5">
          A line starting with <code className="font-mono">##</code> is a heading. Blank lines separate paragraphs.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-xs font-black rounded-2xl hover:bg-blue-700 transition-colors disabled:opacity-60"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving…' : 'Save this page'}
        </button>
        {isOverridden && (
          <button
            onClick={revert}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 text-xs font-black rounded-2xl hover:bg-gray-200 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Back to the draft
          </button>
        )}
      </div>

      <details className="bg-gray-50 border border-gray-200 rounded-2xl">
        <summary className="px-4 py-3 text-xs font-black text-gray-700 cursor-pointer select-none">
          Show the supplied draft for this page — copy it and edit
        </summary>
        {/* The two AI tokens are filled on the page with the service in use —
            typed over with a company name, the policy would go on naming it
            after he switched. */}
        <p className="px-4 pb-2 text-[0.6875rem] font-bold text-amber-800">
          {'{AI_PROVIDER}'} and {'{AI_TRANSFER}'} are filled in on the page with the AI service in use (and, for DeepSeek,
          where it processes the chat). Keep them in your own text rather than writing a company name.
        </p>
        <pre className="px-4 pb-4 text-[0.75rem] text-gray-600 whitespace-pre-wrap leading-relaxed font-mono">
          {shippedDraft}
        </pre>
      </details>
      {confirmDialog}
    </div>
  );
}
