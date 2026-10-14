import React, { useEffect, useState } from 'react';
import { auth } from '../../firebase';
import { Mail, Phone, Loader2, CheckCircle2, AlertTriangle, Inbox, RotateCcw } from 'lucide-react';
import { formatDateTime } from '../../lib/dateFormat';

/**
 * The messages people send through the contact form.
 *
 * They were being saved and never shown: the shop had a real enquiry sitting in
 * Firestore for hours with nobody able to see it. This is the screen that was
 * missing. New ones are highlighted, answering is one click through the mail
 * client, and marking one handled is what keeps the list meaningful in a month.
 */

type Inquiry = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
  createdAt?: string;
  status?: string;
  handledAt?: string | null;
};

export default function InquiriesAdmin() {
  const [rows, setRows] = useState<Inquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showHandled, setShowHandled] = useState(false);

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

  const load = async () => {
    try {
      const data = await call('/api/admin/inquiries');
      setRows(data.inquiries ?? []);
      setError(null);
    } catch (err: any) {
      setError(String(err?.message ?? err));
      setRows([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = async (id: string, status: 'new' | 'handled') => {
    setBusyId(id);
    try {
      await call(`/api/admin/inquiries/${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      setRows((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusyId(null);
    }
  };

  const all = rows ?? [];
  const newOnes = all.filter((r) => r.status !== 'handled');
  const visible = showHandled ? all : newOnes;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center">
            <Inbox className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-gray-900">Messages</h2>
            <p className="text-xs font-bold text-gray-500">
              Sent from the contact form on the website. Replies go straight to the customer.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {newOnes.length > 0 && (
            <span className="px-3 py-1.5 bg-orange-600 text-white text-[0.6875rem] font-black rounded-full">
              {newOnes.length} new
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowHandled((v) => !v)}
            className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-[0.6875rem] font-black rounded-full hover:bg-gray-50 transition-colors"
          >
            {showHandled ? 'Hide handled' : 'Show handled'}
          </button>
          <button
            type="button"
            onClick={load}
            className="p-2 bg-white border border-gray-300 rounded-full hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RotateCcw className="w-3.5 h-3.5 text-gray-600" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm font-bold flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {rows === null ? (
        <div className="bg-white rounded-3xl border border-gray-100 p-10 text-center">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" />
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-3xl border border-gray-100 p-10 text-center">
          <Inbox className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <p className="font-black text-gray-900">
            {showHandled ? 'No messages yet.' : 'Nothing new.'}
          </p>
          <p className="text-xs font-bold text-gray-400 mt-1">
            Messages from the website's contact form appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((r) => {
            const handled = r.status === 'handled';
            return (
              <div
                key={r.id}
                className={
                  'bg-white rounded-3xl border shadow-sm p-6 space-y-4 ' +
                  (handled ? 'border-gray-100 opacity-70' : 'border-orange-200')
                }
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-gray-900">{r.name || 'Unnamed'}</span>
                      {!handled && (
                        <span className="px-2 py-0.5 bg-orange-600 text-white text-[0.5625rem] font-black rounded uppercase tracking-wide">
                          New
                        </span>
                      )}
                      {r.subject && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-[0.625rem] font-black rounded">
                          {r.subject}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap text-xs font-bold">
                      {r.email && (
                        <a href={`mailto:${r.email}`} className="text-blue-700 hover:underline inline-flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {r.email}
                        </a>
                      )}
                      {r.phone && (
                        <a href={`tel:${r.phone.replace(/\s+/g, '')}`} className="text-blue-700 hover:underline inline-flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {r.phone}
                        </a>
                      )}
                    </div>
                  </div>
                  <span className="text-[0.6875rem] font-bold text-gray-400 whitespace-nowrap">
                    {r.createdAt ? formatDateTime(r.createdAt) : ''}
                  </span>
                </div>

                {/* The customer's own words — printed as typed, never as markup. */}
                <div className="bg-gray-50 rounded-2xl p-4 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                  {r.message}
                </div>

                <div className="flex flex-wrap gap-2">
                  {r.email && (
                    <a
                      href={`mailto:${r.email}?subject=${encodeURIComponent('Re: ' + (r.subject || 'Your message'))}`}
                      className="px-4 py-2 bg-gray-900 text-white text-xs font-black rounded-xl hover:bg-gray-800 transition-colors inline-flex items-center gap-1.5"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Reply
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setStatus(r.id, handled ? 'new' : 'handled')}
                    disabled={busyId === r.id}
                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-xs font-black rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
                  >
                    {busyId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    {handled ? 'Mark as new' : 'Mark handled'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
