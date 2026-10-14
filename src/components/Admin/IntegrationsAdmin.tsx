import React, { useEffect, useRef, useState } from 'react';
import { auth } from '../../firebase';
import { CreditCard, Truck, KeyRound, CheckCircle2, AlertTriangle, Loader2, ShieldCheck, Sparkles, Mail, Send } from 'lucide-react';
import { AI_PROVIDER_NAMES, keyMismatchSentence, providerForKey, type AiProvider } from '../../lib/aiProvider';

/**
 * The key panel — where the owner connects the shop to the outside services.
 *
 * The point of this screen is that a secret never has to travel through a chat
 * or an e-mail again: the owner copies the key from the provider's own
 * dashboard and pastes it here. The server checks it against the provider
 * BEFORE saving, so a typo fails in this screen, to the person who can fix it —
 * not at the next customer's payment.
 *
 * Keys are write-only. What comes back is the last four characters and who
 * changed it when; reading a saved key back out is deliberately impossible.
 */

type KeyStatus = {
  configured: boolean;
  /** Set only on the AI key: the model that answered when it was saved. */
  verifiedModel?: string | null;
  /** Set only on the AI key: stored, but no model ever answered. An amber state. */
  verifiedWarning?: string | null;
  /** Set only on the AI key: which service it is from. */
  provider?: string | null;
  source: 'dashboard' | 'server' | 'none';
  last4: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  mode?: 'live' | 'test' | null;
};

type Notify = {
  orderEmails: string[];
  updatedAt: string | null;
  updatedBy: string | null;
  mail: { configured: boolean; from: string | null; defaultInbox: string | null };
};
type AiSlotStatus = {
  configured: boolean;
  last4?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  verifiedModel?: string | null;
  verifiedWarning?: string | null;
  transferConfirmed?: boolean;
};
type AiStatus = {
  active: AiProvider | null;
  providers: Record<AiProvider, AiSlotStatus>;
  server: { provider: AiProvider | null; last4: string } | null;
};
type Status = { mollie: KeyStatus; zendr: KeyStatus; gemini: KeyStatus; notify?: Notify; ai?: AiStatus };

/** What the mail server's refusal means, for the person who can act on it. */
function mailProblem(reason: string | null | undefined): string {
  const r = String(reason ?? '');
  if (r === 'smtp_not_configured') {
    return 'The mail server is not set up on the hosting (its SMTP settings), so the shop cannot send any e-mail — not to you, not to customers. Your developer sets SMTP_HOST, SMTP_USER and SMTP_PASSWORD on the server.';
  }
  if (/\b535\b|Username and Password not accepted|Invalid login|BadCredentials/i.test(r)) {
    return 'Google refused the mail password. On the server, SMTP_PASSWORD must be a Google App Password (myaccount.google.com → Security → App passwords), not the account password. Your developer changes it there.';
  }
  return `The mail server answered: ${r || 'no reason given'}`;
}

/**
 * NEW-ORDER E-MAILS — client, 2026-10-07: "when an order is created I must get an
 * e-mail". The notice already existed; it went to an address set on the server
 * only, and nothing showed whether the mail server could send at all. Here he
 * chooses where it goes, and a test proves the road.
 */
function OrderMailCard({
  notify,
  call,
  onSaved,
}: {
  notify: Notify | null;
  call: (path: string, init?: RequestInit) => Promise<any>;
  onSaved: () => Promise<void>;
}) {
  const [value, setValue] = useState('');
  // Refilled from the server only when ITS list changes, and only while he is not
  // typing: run on "typing finished" as well, it wrote the old list back over the
  // one just saved, until the refresh landed (or for good, if it failed).
  const typing = useRef(false);
  // What the server holds: from its status, and straight from a save's own answer —
  // the status refresh after a save may fail, and must not leave the old list "saved".
  const [savedList, setSavedList] = useState<string[] | null>(null);
  useEffect(() => {
    if (!notify) return;
    setSavedList(notify.orderEmails);
    if (!typing.current) setValue(notify.orderEmails.join(', '));
  }, [notify]);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [result, setResult] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const mail = notify?.mail ?? null;
  const typed = value.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Gmail files a message an account sends to ITSELF under "Sent": he would never see it.
  const toItself = !!mail?.from && typed.includes(mail.from.toLowerCase());
  const saved = (savedList ?? notify?.orderEmails ?? []).join(', ');
  // The test goes to the SAVED addresses — with others typed and not saved, it would
  // prove a road he is not about to use.
  const unsaved = value.trim() !== saved;
  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4" data-rx-order-mail>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-black text-gray-900">New-order e-mails</h3>
            <p className="text-[0.6875rem] font-bold text-gray-400">An e-mail to you for every order whose payment is confirmed</p>
          </div>
        </div>
        {mail && (
          <span
            className={
              'inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wide ' +
              (mail.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')
            }
            data-rx-mail-ready={mail.configured ? 'yes' : 'no'}
          >
            {mail.configured ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            <span>{mail.configured ? 'Mail server set up' : 'Mail server not set up'}</span>
          </span>
        )}
      </div>
      {mail && !mail.configured && (
        <p className="text-[0.6875rem] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{mailProblem('smtp_not_configured')}</p>
      )}
      {mail?.configured && (
        <p className="text-[0.6875rem] font-bold text-gray-500">
          Sent from <span className="text-gray-800">{mail.from}</span>.
          {!saved && mail.defaultInbox ? <> With no address below, they go to <span className="text-gray-800">{mail.defaultInbox}</span>.</> : null}
        </p>
      )}
      <label className="block space-y-1.5">
        <span className="text-[0.6875rem] font-black text-gray-700">Send new-order e-mails to (up to five, separated by commas)</span>
        <div className="flex items-stretch gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              typing.current = true;
              setValue(e.target.value);
            }}
            placeholder="you@example.com, workshop@example.com"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 px-4 py-2.5 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            data-rx-order-mail-input
          />
          <button
            type="button"
            disabled={busy !== null || value.trim() === saved}
            onClick={async () => {
              setBusy('save');
              setResult(null);
              try {
                const r = await call('/api/admin/notifications', { method: 'POST', body: JSON.stringify({ orderEmails: value }) });
                setValue((r.orderEmails ?? []).join(', '));
                setSavedList(r.orderEmails ?? []);
                typing.current = false;
                setResult({ tone: 'ok', text: r.orderEmails?.length ? `Saved — new orders are e-mailed to ${r.orderEmails.join(', ')}.` : 'Saved — new orders go to the server’s default address.' });
                await onSaved();
              } catch (err: any) {
                setResult({ tone: 'bad', text: String(err?.message ?? err) });
              } finally {
                setBusy(null);
              }
            }}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black rounded-2xl transition-colors"
            data-rx-order-mail-save
          >
            {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
          </button>
        </div>
      </label>
      {toItself && (
        <p className="text-[0.6875rem] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-order-mail-self>
          {mail?.from} is the address the shop sends FROM — Gmail files a message to itself under &ldquo;Sent&rdquo;, so you would not see it. Use another address.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null || unsaved}
          title={unsaved ? 'Save the addresses first — the test goes to the saved ones.' : undefined}
          onClick={async () => {
            setBusy('test');
            setResult(null);
            try {
              const r = await call('/api/admin/notifications/test', { method: 'POST', body: '{}' });
              setResult(r.sent ? { tone: 'ok', text: `Test e-mail sent to ${r.to}. If it is not in the inbox within a few minutes, look in spam.` } : { tone: 'bad', text: mailProblem(r.reason) });
            } catch (err: any) {
              setResult({ tone: 'bad', text: String(err?.message ?? err) });
            } finally {
              setBusy(null);
            }
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border border-gray-200 text-sm font-black text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          data-rx-order-mail-test
        >
          {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send a test e-mail
        </button>
        {unsaved && (
          <p className="text-[0.6875rem] font-bold text-amber-800" data-rx-order-mail-unsaved>
            Save the addresses first — the test goes to the saved ones.
          </p>
        )}
        <p className="text-[0.6875rem] font-bold text-gray-400">
          It comes when the payment is confirmed. A checkout that is never paid sends nothing — it would e-mail you for every abandoned basket.
        </p>
      </div>
      {result && (
        <p
          role="status"
          className={'text-[0.75rem] font-bold rounded-xl px-3 py-2 ' + (result.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200')}
          data-rx-order-mail-result={result.tone}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<KeyStatus['source'], string> = {
  dashboard: 'Set from this dashboard',
  server: 'Set on the server (.env)',
  none: 'Not configured',
};

function KeyCard({
  title,
  icon,
  hint,
  placeholder,
  status,
  saving,
  onSave,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  hint: string;
  placeholder: string;
  status: KeyStatus | null;
  saving: boolean;
  onSave: (value: string) => Promise<boolean>;
  children?: React.ReactNode;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center">{icon}</div>
          <div>
            <h3 className="font-black text-gray-900">{title}</h3>
            <p className="text-[0.6875rem] font-bold text-gray-400">{hint}</p>
          </div>
        </div>
        {status && (
          <div className="text-right">
            <span
              className={
                'inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wide ' +
                (!status.configured
                  ? 'bg-amber-50 text-amber-700'
                  : status.verifiedWarning
                    ? 'bg-amber-50 text-amber-800'
                    : 'bg-emerald-50 text-emerald-700')
              }
            >
              {/* A KEY THAT WAS STORED WITHOUT ANSWERING IS NOT "CONNECTED".
                  verifyAiKey deliberately keeps a key whose provider was merely
                  busy — refusing on a 429 would red-light a good key at random —
                  but the badge then said Connected, and a reload was all it took
                  for the amber banner to vanish and leave an emerald tick over a
                  provider that had never spoken. */}
              {status.configured && !status.verifiedWarning ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              <span>
                {!status.configured ? 'Missing' : status.verifiedWarning ? 'Stored, not answered' : 'Connected'}
              </span>
            </span>
            <p className="text-[0.625rem] font-bold text-gray-400 mt-1">
              {SOURCE_LABEL[status.source]}
              {status.last4 ? ` · ends …${status.last4}` : ''}
            </p>
            {status.updatedAt && (
              <p className="text-[0.625rem] text-gray-400">
                {new Date(status.updatedAt).toLocaleString('sv-SE')} · {status.updatedBy}
              </p>
            )}
          </div>
        )}
      </div>

      {children}

      <div className="flex items-stretch space-x-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <button
          type="button"
          disabled={saving || !value.trim()}
          onClick={async () => {
            // Keep the pasted key in the box until the save SUCCEEDS — a
            // failed verification must not cost the admin their paste.
            const saved = await onSave(value.trim());
            if (saved) setValue('');
          }}
          className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black rounded-2xl transition-colors flex items-center space-x-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          <span>Verify & save</span>
        </button>
      </div>
    </div>
  );
}

/**
 * The AI services he can choose — round 16, item 8 ("the AI on DeepSeek"). He
 * NAMES the service and the key goes to that one only: keys used to be tried
 * against every service in turn, and a DeepSeek key looks exactly like OpenAI's.
 */
const AI_CHOICES: { id: AiProvider; label: string; where: string; placeholder: string }[] = [
  { id: 'google', label: 'Google AI (Gemini)', where: 'aistudio.google.com → Get API key', placeholder: 'AIza… or AQ.…' },
  { id: 'openai', label: 'OpenAI', where: 'platform.openai.com → API keys', placeholder: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic (Claude)', where: 'console.anthropic.com → API keys', placeholder: 'sk-ant-…' },
  { id: 'deepseek', label: 'DeepSeek', where: 'platform.deepseek.com → API keys', placeholder: 'sk-…' },
];

/**
 * THE AI ASSISTANT'S KEYS — one per service, all kept, one IN USE (client, 2026-10-07:
 * "more than one option, the ability to choose and switch on any of them while
 * keeping the saved keys"). A key is checked with its own service only before it is
 * saved; "Use this one" switches between saved keys without pasting anything again.
 */
function AiKeysCard({
  ai,
  call,
  onChanged,
  setBanner,
}: {
  ai: AiStatus | null;
  call: (path: string, init?: RequestInit) => Promise<any>;
  onChanged: () => Promise<void>;
  setBanner: (b: { tone: 'ok' | 'warn' | 'bad'; text: string } | null) => void;
}) {
  const [values, setValues] = useState<Record<AiProvider, string>>({ google: '', openai: '', anthropic: '', deepseek: '' });
  const [busy, setBusy] = useState<AiProvider | null>(null);
  // DeepSeek: his word that an agreement covers the transfer out of the EU — the
  // privacy policy claims it only then. It starts from what is SAVED: an unticked
  // box over a confirmed agreement would clear it with the next key he pasted.
  const savedTransfer = ai?.providers?.deepseek?.transferConfirmed === true;
  const [transferConfirmed, setTransferConfirmed] = useState(savedTransfer);
  const transferTouched = useRef(false);
  useEffect(() => {
    if (!transferTouched.current) setTransferConfirmed(savedTransfer);
  }, [savedTransfer]);
  const active = ai?.active ?? null;

  /**
   * The tick, for a key that is ALREADY saved: recorded at once — there is no key to
   * paste, so no "Verify & save" would ever carry it. (With a key typed, the tick
   * goes with that key's save instead.)
   */
  const recordTransfer = async (confirmed: boolean) => {
    setBusy('deepseek');
    setBanner(null);
    try {
      await call('/api/admin/integrations/ai-transfer', { method: 'POST', body: JSON.stringify({ confirmed }) });
      transferTouched.current = false;
      setBanner({
        tone: 'ok',
        text: confirmed
          ? 'Saved: you have an agreement with DeepSeek that covers transfers from the EU. The privacy policy says so while DeepSeek is in use.'
          : 'Saved: no agreement with DeepSeek is confirmed. The privacy policy says so while DeepSeek is in use.',
      });
      await onChanged();
    } catch (err: any) {
      setTransferConfirmed(!confirmed);
      setBanner({ tone: 'bad', text: String(err?.message ?? err) });
    } finally {
      setBusy(null);
    }
  };

  const save = async (provider: AiProvider) => {
    const value = values[provider].trim();
    setBusy(provider);
    setBanner(null);
    try {
      const r = await call('/api/admin/integrations', {
        method: 'POST',
        body: JSON.stringify({ name: 'gemini', value, provider, ...(provider === 'deepseek' ? { transferConfirmed } : {}) }),
      });
      const who = AI_PROVIDER_NAMES[provider];
      setBanner(
        r.warning
          ? { tone: 'warn', text: String(r.warning) }
          : {
              tone: 'ok',
              text:
                r.active === provider
                  ? `${who} accepted the key (…${r.last4})${r.model ? `, answering on ${r.model}` : ''}. It is saved and in use now.`
                  : `${who} accepted the key (…${r.last4}). It is saved beside the others — press "Use this one" to switch to it.`,
            },
      );
      setValues((v) => ({ ...v, [provider]: '' }));
      if (provider === 'deepseek') transferTouched.current = false;
      await onChanged();
    } catch (err: any) {
      // The paste stays in the box: a refused key must not cost him the paste.
      setBanner({ tone: 'bad', text: String(err?.message ?? err) });
    } finally {
      setBusy(null);
    }
  };

  const use = async (provider: AiProvider) => {
    setBusy(provider);
    setBanner(null);
    try {
      const r = await call('/api/admin/integrations/ai-active', { method: 'POST', body: JSON.stringify({ provider }) });
      setBanner({ tone: 'ok', text: `${AI_PROVIDER_NAMES[provider]} is in use now${r.model ? ` (${r.model})` : ''}. The other keys are kept.` });
      await onChanged();
    } catch (err: any) {
      setBanner({ tone: 'bad', text: String(err?.message ?? err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4" data-rx-ai-keys>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-black text-gray-900">AI assistant</h3>
            <p className="text-[0.6875rem] font-bold text-gray-400">A key for each service you use — all kept; one is in use</p>
          </div>
        </div>
        <p className="text-[0.6875rem] font-black text-gray-700 text-right" data-rx-ai-in-use>
          {active ? <>In use now: {AI_PROVIDER_NAMES[active]}{ai?.providers?.[active]?.verifiedModel ? ` · ${ai.providers[active].verifiedModel}` : ''}</> : ai?.server ? 'In use now: the key set on the server' : 'No AI service in use'}
        </p>
      </div>
      <div className="text-[0.6875rem] font-bold text-gray-500 leading-relaxed">
        <p>All four run the assistant, the translator and the product analysis (photos included).</p>
        <p className="mt-1">
          <span className="text-gray-700">Google</span> can also search the web and answer questions about places — the others cannot, so with those the
          assistant answers from what it knows and from this shop&rsquo;s own information.
        </p>
      </div>
      <div className="space-y-3">
        {AI_CHOICES.map((choice) => {
          const id = choice.id;
          const slot = ai?.providers?.[id];
          const inUse = active === id;
          const value = values[id];
          const check = value.trim() ? providerForKey(id, value.trim()) : null;
          const problem = check?.kind === 'mismatch' ? keyMismatchSentence(id, check.looksLike) : null;
          return (
            <div
              key={id}
              className={'rounded-2xl border p-4 space-y-3 ' + (inUse ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-200 bg-white')}
              data-rx-ai-row={id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-gray-900">{choice.label}</p>
                  <p className="text-[0.625rem] font-bold text-gray-400">{choice.where}</p>
                </div>
                <div className="flex items-center gap-2">
                  {slot?.configured ? (
                    <span
                      className={
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wide ' +
                        (slot.verifiedWarning ? 'bg-amber-50 text-amber-800' : inUse ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700')
                      }
                      data-rx-ai-state={inUse ? 'in-use' : 'saved'}
                    >
                      {inUse ? <CheckCircle2 className="w-3 h-3" /> : <KeyRound className="w-3 h-3" />}
                      {inUse ? 'In use' : 'Saved'} · …{slot.last4}
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-[0.625rem] font-black uppercase tracking-wide bg-gray-50 text-gray-400" data-rx-ai-state="none">
                      No key saved
                    </span>
                  )}
                  {slot?.configured && !inUse && (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void use(id)}
                      className="px-3 py-1.5 rounded-xl bg-gray-900 hover:bg-black text-white text-[0.6875rem] font-black disabled:opacity-50"
                      data-rx-ai-use={id}
                    >
                      {busy === id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Use this one'}
                    </button>
                  )}
                </div>
              </div>
              <div className="flex items-stretch gap-2">
                <input
                  type="password"
                  value={value}
                  onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
                  placeholder={slot?.configured ? `Replace the ${choice.label} key — ${choice.placeholder}` : choice.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  data-rx-ai-input={id}
                />
                <button
                  type="button"
                  disabled={busy !== null || !value.trim() || Boolean(problem)}
                  onClick={() => void save(id)}
                  className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black rounded-2xl transition-colors flex items-center gap-2"
                  data-rx-ai-save={id}
                >
                  {busy === id ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  <span>Verify & save</span>
                </button>
              </div>
              {problem && (
                <p role="alert" className="text-[0.6875rem] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-rx-key-problem>
                  {problem}
                </p>
              )}
              {slot?.verifiedWarning && <p className="text-[0.6875rem] font-bold text-amber-800">{slot.verifiedWarning}</p>}
              {/* DeepSeek — SAID BEFORE HE SAVES, not discovered afterwards. */}
              {id === 'deepseek' && (value.trim() || slot?.configured) && (
                <div
                  className="text-[0.6875rem] font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 leading-relaxed space-y-2"
                  data-rx-deepseek-warning
                  aria-live="polite"
                >
                  <p className="font-black flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> DeepSeek processes data in China — outside the EU/EEA.</p>
                  <p>
                    What your customers type into the chat, and the texts and product photos you send to the translator and the analysis, go
                    to DeepSeek&rsquo;s servers there. The privacy policy names DeepSeek and China while it is in use. Under the GDPR this is a
                    transfer outside the EU: it needs a data processing agreement with DeepSeek that includes the EU&rsquo;s standard contractual
                    clauses. Until you confirm one below, the privacy policy says the agreement is not yet confirmed. Chat messages are also kept
                    on DeepSeek&rsquo;s side under its own rules, not this shop&rsquo;s ninety days.
                  </p>
                  <label className="flex items-start gap-2 cursor-pointer text-amber-950">
                    <input
                      type="checkbox"
                      checked={transferConfirmed}
                      disabled={busy !== null}
                      onChange={(e) => {
                        const next = e.target.checked;
                        transferTouched.current = true;
                        setTransferConfirmed(next);
                        if (slot?.configured && !value.trim()) void recordTransfer(next);
                      }}
                      data-rx-deepseek-confirm
                      className="mt-0.5 accent-amber-600"
                    />
                    <span>
                      I have a data processing agreement with DeepSeek that covers transfers from the EU (standard contractual clauses). The
                      privacy policy will say so.
                    </span>
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function IntegrationsAdmin() {
  const [status, setStatus] = useState<Status | null>(null);
  const [savingKey, setSavingKey] = useState<'mollie' | 'zendr' | null>(null);
  // THREE TONES, because there are three outcomes. A key whose provider was busy
  // is stored and is probably fine — but it has not been proven, and an emerald
  // "in use" over a provider that never answered is the same green-badge-on-a-
  // dead-connection that hid a retired model for months.
  const [banner, setBanner] = useState<{ tone: 'ok' | 'warn' | 'bad'; text: string } | null>(null);

  const call = async (path: string, init?: RequestInit) => {
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    const resp = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status}).`);
    return data;
  };

  const refresh = async (silent = false) => {
    try {
      setStatus(await call('/api/admin/integrations'));
    } catch (err: any) {
      // A status refresh that fails right after a successful save must not
      // replace the success banner with an error about something else.
      if (!silent) setBanner({ tone: 'bad', text: String(err?.message ?? err) });
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Mollie and Zendr. The AI keys have their own card (AiKeysCard). */
  const save = async (name: 'mollie' | 'zendr', value: string): Promise<boolean> => {
    setSavingKey(name);
    setBanner(null);
    try {
      const result = await call('/api/admin/integrations', {
        method: 'POST',
        body: JSON.stringify({ name, value }),
      });
      const who = name === 'mollie' ? 'Mollie' : 'Zendr';
      // AMBER, NOT GREEN, when nothing actually answered.
      setBanner(
        result.warning
          ? { tone: 'warn', text: String(result.warning) }
          : {
              tone: 'ok',
              text: `${who} accepted the key (…${result.last4})${result.model ? `, answering on ${result.model}` : ''}. It is saved and already in use.`,
            },
      );
      await refresh(true);
      return true;
    } catch (err: any) {
      setBanner({ tone: 'bad', text: String(err?.message ?? err) });
      return false;
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-900">Payments & API keys</h2>
            <p className="text-xs font-bold text-gray-500">
              Paste a key, and it is checked against the provider before anything is saved. Saved keys are
              write-only — no one can read them back out of this screen.
            </p>
          </div>
        </div>
      </div>

      {banner && (
        <div
          className={
            'p-4 rounded-2xl text-sm font-bold flex items-center space-x-2 ' +
            (banner.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : banner.tone === 'warn'
                ? 'bg-amber-50 text-amber-900 border border-amber-200'
                : 'bg-red-50 text-red-800 border border-red-200')
          }
        >
          {banner.tone === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      <OrderMailCard notify={status?.notify ?? null} call={call} onSaved={() => refresh(true)} />

      <KeyCard
        title="Mollie — online payments"
        icon={<CreditCard className="w-5 h-5" />}
        hint="my.mollie.com → Developers → API keys"
        placeholder="live_… or test_…"
        status={status?.mollie ?? null}
        saving={savingKey === 'mollie'}
        onSave={(v) => save('mollie', v)}
      >
        <p className="text-[0.625rem] font-bold text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          Switching to a key from a DIFFERENT Mollie account? Payments started in the last few minutes
          settle against the old account — check my.mollie.com for them before the switch.
        </p>
        {status?.mollie?.configured && (
          <div
            className={
              'px-3 py-2 rounded-xl text-[0.6875rem] font-black inline-flex items-center space-x-1.5 ' +
              (status.mollie.mode === 'live' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')
            }
          >
            <span>
              {status.mollie.mode === 'live'
                ? 'LIVE mode — real payments are on.'
                : 'TEST mode — payments are simulated. Paste the live_ key to accept real money.'}
            </span>
          </div>
        )}
      </KeyCard>

      <KeyCard
        title="Zendr — shipping"
        icon={<Truck className="w-5 h-5" />}
        hint="portal.zendr.se → Tillägg → Zendr API"
        placeholder="Zendr API key"
        status={status?.zendr ?? null}
        saving={savingKey === 'zendr'}
        onSave={(v) => save('zendr', v)}
      />

      {/* THE AI ASSISTANT — one saved key per service, and the one in use (client,
          2026-10-07: "more than one option, choose and switch on any of them, keeping
          the saved keys"). Each key is still checked with ITS service only. */}
      <AiKeysCard ai={status?.ai ?? null} call={call} onChanged={() => refresh(true)} setBanner={setBanner} />

      <p className="text-[0.6875rem] font-bold text-gray-400 px-2">
        The mail server&rsquo;s password is changed on the hosting panel, not here — ask your developer if it needs rotating.
      </p>
    </div>
  );
}
