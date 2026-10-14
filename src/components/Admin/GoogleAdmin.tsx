import React, { useEffect, useState } from 'react';
import { auth } from '../../firebase';
import {
  CheckCircle2, AlertTriangle, Loader2, FolderOpen, Link2, Unlink, ExternalLink, Copy, Check,
} from 'lucide-react';

/**
 * The Google panel — where the owner connects the shop to his own Google
 * account, once, and every paid order files itself in his Drive afterwards.
 *
 * Two steps on purpose. First the OAuth client from his Google Cloud project
 * (an id and a secret, pasted like any other key). Then Connect, which sends
 * him to Google's own consent screen — the shop never sees his password, and
 * the only permission asked for is drive.file: files this app itself creates,
 * nothing else in his Drive.
 */

type Status = {
  hasClient: boolean;
  connected: boolean;
  /** Whether the stored token can actually reach Drive — see the server. */
  healthy?: boolean;
  healthReason?: string | null;
  account: string | null;
  connectedAt: string | null;
  clientIdTail: string | null;
  redirectUri: string;
  driveFolder: string | null;
};

export default function GoogleAdmin() {
  const [status, setStatus] = useState<Status | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

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
      setStatus(await call('/api/admin/google'));
    } catch (err: any) {
      if (!silent) setBanner({ tone: 'bad', text: String(err?.message ?? err) });
    }
  };

  useEffect(() => {
    refresh();
    // The consent screen opens in another tab; when the owner comes back, the
    // status here should already reflect it.
    const onFocus = () => refresh(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveClient = async () => {
    setBusy('client');
    setBanner(null);
    try {
      await call('/api/admin/google', {
        method: 'POST',
        body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
      });
      setClientId('');
      setClientSecret('');
      setBanner({ tone: 'ok', text: 'OAuth client saved. Now press Connect and approve on Google.' });
      await refresh(true);
    } catch (err: any) {
      setBanner({ tone: 'bad', text: String(err?.message ?? err) });
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    setBusy('connect');
    setBanner(null);
    try {
      const { url } = await call('/api/admin/google/connect', { method: 'POST' });
      window.open(url, '_blank', 'noopener');
      setBanner({ tone: 'ok', text: 'Approve the shop in the tab that just opened, then come back here.' });
    } catch (err: any) {
      setBanner({ tone: 'bad', text: String(err?.message ?? err) });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await call('/api/admin/google/disconnect', { method: 'POST' });
      setBanner({ tone: 'ok', text: 'Disconnected. Orders will stop being filed in Drive.' });
      await refresh(true);
    } catch (err: any) {
      setBanner({ tone: 'bad', text: String(err?.message ?? err) });
    } finally {
      setBusy(null);
    }
  };

  const copyRedirect = () => {
    if (!status?.redirectUri) return;
    navigator.clipboard?.writeText(status.redirectUri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-white border border-gray-200 flex items-center justify-center font-black text-lg">
              <span className="text-[#4285F4]">G</span>
            </div>
            <div>
              <h2 className="text-lg font-black text-gray-900">Google Drive</h2>
              <p className="text-xs font-bold text-gray-500">
                Every paid order is filed in your own Drive: the customer's artwork, and a sheet of
                everything they chose.
              </p>
            </div>
          </div>
          {status && (
            <span
              className={
                'inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-[0.6875rem] font-black uppercase tracking-wide ' +
                (status.connected && status.healthy !== false
                  ? 'bg-emerald-50 text-emerald-700'
                  : status.connected
                    ? 'bg-red-50 text-red-700'
                    : 'bg-amber-50 text-amber-700')
              }
            >
              {status.connected && status.healthy !== false
                ? <CheckCircle2 className="w-3.5 h-3.5" />
                : <AlertTriangle className="w-3.5 h-3.5" />}
              <span>
                {status.connected
                  ? status.healthy === false ? 'Not working' : 'Connected'
                  : status.hasClient ? 'Not connected' : 'Not set up'}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Connected, and unable to do the one thing it is for. The commonest cause
          by far is the Drive tick-box left unticked on Google's own screen, so
          that is named rather than hinted at. */}
      {status?.connected && status.healthy === false && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm font-bold space-y-1.5">
          <p className="flex items-start space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>This account is linked but cannot reach Drive, so no order can be filed.</span>
          </p>
          {status.healthReason && (
            <p className="text-xs font-mono text-red-700 break-words">{status.healthReason}</p>
          )}
          <p className="text-xs font-bold">
            Press Disconnect, then Connect again — and on Google&rsquo;s screen tick
            &ldquo;See, edit, create and delete only the specific Google Drive files you use with
            this app&rdquo; before pressing Continue. Continue on its own does not grant it.
          </p>
        </div>
      )}

      {banner && (
        <div
          className={
            'p-4 rounded-2xl text-sm font-bold flex items-start space-x-2 ' +
            (banner.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200')
          }
        >
          {banner.tone === 'ok' ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      {/*
        * `connected` IS NOT `working`, and this card used to treat them as the
        * same thing.
        *
        * The server is honest about the difference — verifyDrive makes a real
        * Drive call that can fail, which is how the missing tick-box on Google's
        * consent screen is caught — and the red block above prints "Not working"
        * when it does. This card then rendered an emerald tick and
        * "Filing to <account>" underneath it, on the same connection, at the
        * same moment. Two opposite answers on one screen, and the green one is
        * the one people believe.
        */}
      {status?.connected && status.healthy !== false ? (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center space-x-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <p className="font-black text-gray-900 text-sm">
                Filing to {status.account ?? 'your Google account'}
              </p>
              <p className="text-xs font-bold text-gray-500">
                Connected {status.connectedAt ? new Date(status.connectedAt).toLocaleString('sv-SE') : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {status.driveFolder && (
              <a
                href={status.driveFolder}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center space-x-2 px-4 py-2.5 bg-gray-900 text-white text-xs font-black rounded-2xl hover:bg-gray-800 transition-colors"
              >
                <FolderOpen className="w-4 h-4" />
                <span>Open the orders folder</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
            <button
              type="button"
              onClick={disconnect}
              disabled={busy === 'disconnect'}
              className="inline-flex items-center space-x-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-xs font-black rounded-2xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {busy === 'disconnect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
              <span>Disconnect</span>
            </button>
          </div>
        </div>
      ) : status?.connected ? (
        /*
         * CONNECTED, AND NOT WORKING — a real state, and today's live one.
         *
         * Google's consent screen hands back a token whether or not the Drive
         * box was ticked, so an account can be linked while the one permission
         * the shop needs was never granted. Falling through to the setup wizard
         * below would ask the owner for an OAuth client he has already given and
         * take away the Disconnect button he needs, so this state gets its own
         * card: what is wrong, the one fix, and the button that starts it.
         */
        <div className="bg-white rounded-3xl border border-red-200 shadow-sm p-6 space-y-4">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-1">
              <p className="font-black text-gray-900 text-sm">
                {status.account ?? 'Your Google account'} is linked, but nothing can be filed
              </p>
              <p className="text-xs font-bold text-gray-500">
                The permission to write files was not granted, so orders are not reaching Drive. Nothing else
                is affected: no order and no payment depends on this.
              </p>
              <p className="text-xs font-bold text-gray-700">
                Press Disconnect, then Connect again — and on Google&rsquo;s screen tick
                &ldquo;See, edit, create and delete only the specific Google Drive files you use with this
                app&rdquo; before pressing Continue. Pressing Continue on its own does not grant it.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy === 'disconnect'}
            className="inline-flex items-center space-x-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 text-xs font-black rounded-2xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {busy === 'disconnect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
            <span>Disconnect</span>
          </button>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div>
              <h3 className="font-black text-gray-900 text-sm">Step 1 — your Google OAuth client</h3>
              <p className="text-xs font-bold text-gray-500 mt-1">
                In Google Cloud Console: enable the <strong>Google Drive API</strong>, then
                APIs &amp; Services → Credentials → Create credentials → OAuth client ID → Web application.
              </p>
            </div>

            <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-4">
              <p className="text-[0.6875rem] font-black text-blue-900 uppercase tracking-wide mb-2">
                Authorised redirect URI — paste this into Google exactly
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[0.6875rem] font-mono bg-white border border-blue-200 rounded-lg px-3 py-2 break-all text-gray-800">
                  {status?.redirectUri || '…'}
                </code>
                <button
                  type="button"
                  onClick={copyRedirect}
                  className="p-2.5 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors shrink-0"
                  title="Copy"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-blue-700" />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Client ID — …apps.googleusercontent.com"
                autoComplete="off"
                spellCheck={false}
                className="px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="Client secret"
                autoComplete="off"
                spellCheck={false}
                className="px-4 py-2.5 border border-gray-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>
            <button
              type="button"
              onClick={saveClient}
              disabled={busy === 'client' || !clientId.trim() || !clientSecret.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black rounded-2xl transition-colors inline-flex items-center space-x-2"
            >
              {busy === 'client' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              <span>Save client</span>
            </button>
            {status?.clientIdTail && (
              <p className="text-[0.6875rem] font-bold text-gray-400">Saved client: {status.clientIdTail}</p>
            )}
          </div>

          <div className={'bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-3 ' + (status?.hasClient ? '' : 'opacity-50')}>
            <div>
              <h3 className="font-black text-gray-900 text-sm">Step 2 — connect your Google account</h3>
              <p className="text-xs font-bold text-gray-500 mt-1">
                Opens Google's own approval screen. The shop asks for one permission only —{' '}
                <strong>files it creates itself</strong> — and never sees your password. Sign in with the
                account whose Drive should hold the orders.
              </p>
              {/* THE TICK-BOX, NAMED BEFORE HE GETS THERE. It was named only in
                  the red banner that appears AFTER the connection comes back
                  broken — which is how this was missed the first time: Google
                  hands back a token whether or not the box was ticked, so
                  "Continue" alone produces a linked account that can file
                  nothing. Saying it here costs one sentence and saves the round
                  trip. */}
              <p className="text-xs font-black text-gray-700 mt-2">
                On Google's screen you must TICK the box that reads &ldquo;See, edit, create and delete only
                the specific Google Drive files you use with this app&rdquo; before pressing Continue.
                Pressing Continue on its own links the account but grants nothing.
              </p>
            </div>
            <button
              type="button"
              onClick={connect}
              disabled={!status?.hasClient || busy === 'connect'}
              className="px-5 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-black rounded-2xl transition-colors inline-flex items-center space-x-2"
            >
              {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              <span>Connect Google Drive</span>
            </button>
          </div>
        </>
      )}

      <p className="text-[0.6875rem] font-bold text-gray-400 px-2 leading-relaxed">
        What gets filed, per paid order: a folder named for the order, the artwork the customer
        uploaded, a readable order sheet, and the same data as JSON. Orders placed before connecting
        can be pushed from the production screen.
      </p>
    </div>
  );
}
