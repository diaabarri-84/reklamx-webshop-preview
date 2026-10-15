import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { confirmPasswordReset } from 'firebase/auth';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { auth } from '../firebase';
import { useAuth } from '../App';

/**
 * WHERE THE PASSWORD-RESET E-MAIL LEADS (/reset-password?token=…).
 *
 * On Firebase the link opened Google's own page. On the shop's own database
 * (DATA_BACKEND=mysql) the e-mail is sent by this server and the new password is
 * chosen here; confirmPasswordReset is the stand-in in src/lib/local/auth.ts,
 * which spends the one-time token (one hour, single use) and signs the account
 * out everywhere.
 */
export default function ResetPasswordPage() {
  const { t } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? params.get('oobCode') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError(t('custPasswordTooShort'));
    if (password !== confirm) return setError(t('custPasswordMismatch'));
    setBusy(true);
    try {
      await confirmPasswordReset(auth, token, password);
      setDone(true);
    } catch (err: any) {
      const code = String(err?.code ?? '');
      setError(code.includes('invalid-action-code') || code.includes('expired') ? t('resetPwInvalid') : code.includes('weak-password') ? t('custPasswordTooShort') : t('authErrGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 focus:outline-hidden focus:border-orange-600 transition-colors';

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16 bg-gray-50/50">
      <div className="w-full max-w-md bg-white rounded-3xl border border-gray-200 shadow-sm p-8">
        {done ? (
          <div className="text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 mx-auto text-orange-600" strokeWidth={1.5} />
            <h1 className="text-2xl font-bold text-gray-900">{t('resetPwDone')}</h1>
            <button type="button" onClick={() => navigate('/login')} className="w-full rounded-full bg-gray-900 hover:bg-orange-600 text-white font-semibold py-3 transition-colors">
              {t('signIn')}
            </button>
          </div>
        ) : !token ? (
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold text-gray-900">{t('resetPwTitle')}</h1>
            <p className="text-gray-600">{t('resetPwInvalid')}</p>
            <Link to="/login" className="inline-block text-orange-700 underline underline-offset-4">{t('signIn')}</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="text-center space-y-3">
              <KeyRound className="w-10 h-10 mx-auto text-orange-600" strokeWidth={1.5} />
              <h1 className="text-2xl font-bold text-gray-900">{t('resetPwTitle')}</h1>
            </div>
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">{t('resetPwNew')}</span>
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} required />
            </label>
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">{t('resetPwConfirm')}</span>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} required />
            </label>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-full bg-gray-900 hover:bg-orange-600 text-white font-semibold py-3 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('resetPwSubmit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
