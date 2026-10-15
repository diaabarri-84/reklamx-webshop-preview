import React, { useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../App';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { NEO } from '../components/NeumorphicSidebar';
import { cn } from '../lib/utils';
import { User, Mail, Lock, LogIn, UserPlus, RefreshCw } from 'lucide-react';

/**
 * The sign-in / sign-up page, built to the client's second reference video:
 * one giant neumorphic circle floating on the soft grey surface, with the
 * form living inside it — pressed-in pill inputs with little icons, a
 * "remember me" toggle, a raised pill button, and a brand-coloured link that
 * flips the circle between Login and Sign Up. Every way of signing in on the
 * site (navbar, checkout, guarded pages, even the staff door) leads here.
 *
 * All actual auth logic comes from the existing AuthProvider — this page is
 * a different face on the same machinery, so welcome points, friendly
 * errors and the Google fallback keep working unchanged.
 */

/**
 * The circle shell — exported so the staff login can wear the same face.
 *
 * A CIRCLE ONLY WHERE A CIRCLE FITS, and that is not a stylistic preference.
 *
 * The shape used to be `w-[min(92vw,37.5rem)]` square at every width, so on a
 * phone it became a 359px circle — and a circle 359px across has room for a
 * 254px-wide chord of content at its widest point, less everywhere else. The
 * form is taller than that: the client photographed his own phone and the
 * heading sat above the ring, the Google button below it, and the inputs ran
 * out through the sides. The reference video was filmed on a desktop.
 *
 * So the circle is kept where the viewport can hold one — from `sm` up, at the
 * fixed 600px the design was drawn at — and below that it relaxes into a
 * rounded card that grows with whatever is inside it. Same surface, same ring,
 * same everything the eye reads as "the neumorphic login"; it simply stops
 * pretending 359px is enough room for a 340px-tall form.
 */
export function NeoAuthCircle({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className={cn('min-h-screen flex items-center justify-center px-4 py-10', NEO.page)}>
      <div
        className={cn(
          'relative flex items-center justify-center',
          // Phone: a card that hugs its content. sm and up: the 600px circle.
          'w-full max-w-[25rem] rounded-[2.75rem] px-6 py-10',
          'sm:w-[37.5rem] sm:h-[37.5rem] sm:max-w-none sm:rounded-full sm:p-0',
          NEO.card, NEO.raised,
        )}
      >
        {/* The thin glass ring just inside the shape's edge, from the reference. */}
        <div className="absolute inset-3 rounded-[2.25rem] sm:rounded-full border border-white/70 shadow-[inset_3px_3px_8px_rgba(163,163,163,0.18)] pointer-events-none" />
        <div className="relative z-10 w-full sm:w-[72%] max-w-[22.5rem] text-center">
          <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight">{title}</h1>
          <p className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-gray-400 mt-1.5 mb-7">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

/** A pressed-in pill input with a leading icon, as in the reference. */
export function NeoInput({ icon, trailing, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { icon: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <label className={cn('flex items-center gap-2.5 rounded-full px-4 py-3 mb-3.5 bg-[#e9ebf2]', 'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-orange-500', NEO.inset)}>
      <span className="text-gray-400 shrink-0 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
      {/* aria-label from the placeholder: these pills carry no visible label by
          design (the reference video has none), so the placeholder is the only
          name the field has — and a placeholder vanishes the moment someone
          types, taking the only clue with it. An explicit aria-label survives.
          focus-visible: there was NO focus indicator at all, so a keyboard user
          could not tell which of the three pills they were in. */}
      <input
        aria-label={props['aria-label'] ?? (typeof props.placeholder === 'string' ? props.placeholder : undefined)}
        {...props}
        className="flex-1 min-w-0 bg-transparent outline-none border-none text-sm font-semibold text-gray-800 placeholder:text-gray-400"
      />
      {trailing}
    </label>
  );
}

/** The raised pill button. */
export function NeoButton({ children, busy, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cn(
        'w-full rounded-full py-3 font-black text-sm uppercase tracking-[0.18em] transition-all duration-300',
        NEO.ease,
        'bg-[#eceef4] text-gray-800 shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff]',
        'hover:text-white hover:bg-gradient-to-br hover:from-orange-500 hover:to-orange-700',
        'active:shadow-[inset_4px_4px_10px_#c9cdd8,inset_-4px_-4px_10px_#ffffff] disabled:opacity-60',
        'flex items-center justify-center gap-2',
      )}
    >
      {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : children}
    </button>
  );
}

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loginWithEmail, registerWithEmail, loginWithGoogle, resetPassword, t } = useAuth();
  const { settings } = useSiteSettings();

  const params = new URLSearchParams(location.search);
  const initialMode =
    location.pathname === '/register' || (location.state as any)?.mode === 'signup' || params.get('mode') === 'signup'
      ? 'signup'
      : 'signin';
  const from: string = (location.state as any)?.from || params.get('from') || '/';

  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Already signed in and landed here anyway → go where they were headed.
  if (user) {
    navigate(from, { replace: true });
    return null;
  }

  const friendly = (e: any): string => {
    const code = String(e?.code ?? '');
    if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
      return t('authErrInvalidCredential');
    if (code.includes('email-already-in-use')) return t('authErrEmailInUse');
    if (code.includes('weak-password')) return t('authErrWeakPassword');
    if (code.includes('invalid-email')) return t('authErrInvalidEmail');
    if (code.includes('too-many-requests')) return t('authErrTooManyRequests');
    // Google sign-in failures used to collapse into the generic line below, which
    // sent us looking at the shop's own code for a fault that was a missing
    // domain in the Firebase console. Each of these names its own cause.
    if (code.includes('unauthorized-domain'))
      return t('authErrUnauthorizedDomain');
    if (code.includes('popup-closed-by-user') || code.includes('user-cancelled'))
      return t('authErrPopupClosed');
    if (code.includes('popup-blocked'))
      return t('authErrPopupBlocked');
    if (code.includes('account-exists-with-different-credential'))
      return t('authErrAccountExists');
    if (code.includes('network-request-failed'))
      return t('authErrNetwork');
    if (code.includes('operation-not-allowed'))
      return t('authErrOperationNotAllowed');
    return t('authErrGeneric');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      // The "remember me" toggle is real: off means the session ends with the
      // browser, on means it survives restarts.
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      if (mode === 'signup') {
        if (!displayName.trim()) { setError(t('authErrNameRequired')); return; }
        await registerWithEmail(displayName.trim(), email.trim(), password);
      } else {
        await loginWithEmail(email.trim(), password);
      }
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGoogle();
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError(null);
    if (!email.trim()) { setError(t('authForgotNeedEmail')); return; }
    await resetPassword(email.trim()).catch(() => {});
    // Enumeration-safe on purpose: the same sentence whether the account exists or not.
    setNotice(t('authResetSent'));
  };

  const signin = mode === 'signin';

  return (
    <NeoAuthCircle
      title={signin ? t('authLoginTitle') : t('authSignUpTitle')}
      subtitle={signin ? `${t('authSubtitleSignInTo')} ${settings.siteName || 'ReklamX'}` : t('authSubtitleCreateAccount')}
    >
      <form onSubmit={submit}>
        {!signin && (
          <NeoInput icon={<User />} type="text" placeholder={t('authFullNamePlaceholder')} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" />
        )}
        <NeoInput icon={<Mail />} type="email" placeholder={t('authEmailPlaceholder')} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <NeoInput icon={<Lock />} type="password" placeholder={t('authPasswordPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signin ? 'current-password' : 'new-password'} required />

        {signin && (
          <div className="flex items-center justify-between mb-5 px-1">
            {/* The little toggle from the reference video. */}
            {/* A switch has to SAY whether it is on. This reported nothing: a
                screen-reader user heard "Remember me, button" whether it was
                set or not, and the only signal was a colour change. */}
            <button
              type="button"
              role="switch"
              aria-checked={remember}
              onClick={() => setRemember((r) => !r)}
              className="flex items-center gap-2 group rounded-full focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:outline-none"
            >
              <span
                className={cn(
                  'w-9 h-5 rounded-full p-0.5 transition-colors duration-300 flex',
                  remember ? 'bg-gradient-to-br from-orange-500 to-orange-700 justify-end' : cn('bg-[#e9ebf2] justify-start', NEO.inset),
                )}
              >
                <span className="w-4 h-4 rounded-full bg-white shadow" />
              </span>
              <span className="text-[0.6875rem] font-bold text-gray-500 group-hover:text-gray-700">{t('authRememberMe')}</span>
            </button>
            {/* py-2 -my-2: a 17px-tall line of text is not a target a thumb
                can hit. The padding grows the hit area without moving anything
                on screen. */}
            <button type="button" onClick={forgot} className="text-[0.6875rem] font-bold text-gray-400 hover:text-orange-600 py-2 -my-2">
              {t('authForgotPassword')}
            </button>
          </div>
        )}

        {error && <p className="text-xs font-bold text-red-600 mb-3">{error}</p>}
        {notice && <p className="text-xs font-bold text-emerald-700 mb-3">{notice}</p>}

        <NeoButton type="submit" busy={busy}>
          {signin ? <><LogIn className="w-4 h-4" /> {t('signIn')}</> : <><UserPlus className="w-4 h-4" /> {t('checkoutCreateAccount')}</>}
        </NeoButton>
      </form>

      {/* On the shop's own database there is no Google sign-in until it has its own
          Google OAuth client (migration/PLAN.md, "Logins"), so the button is not offered. */}
      {import.meta.env.VITE_DATA_BACKEND !== 'mysql' && (
      <button
        onClick={google}
        disabled={busy}
        className={cn(
          'w-full mt-3.5 rounded-full py-2.5 text-xs font-black text-gray-600 transition-all duration-300 flex items-center justify-center gap-2',
          NEO.ease, 'bg-[#eceef4] shadow-[6px_6px_14px_#c9cdd8,-6px_-6px_14px_#ffffff] hover:text-gray-900',
          'active:shadow-[inset_4px_4px_10px_#c9cdd8,inset_-4px_-4px_10px_#ffffff]',
        )}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
        </svg>
        {t('authContinueWithGoogle')}
      </button>
      )}

      <p className="mt-6 text-xs font-bold text-gray-500">
        {signin ? t('authNoAccount') : t('authHaveAccount')}{' '}
        <button
          onClick={() => { setMode(signin ? 'signup' : 'signin'); setError(null); setNotice(null); }}
          className="text-orange-600 hover:text-orange-700 underline underline-offset-2"
        >
          {signin ? t('authSignUpLink') : t('authLoginTitle')}
        </button>
      </p>

      <p className="mt-1 text-[0.625rem] font-bold text-gray-400">
        <Link to="/" className="hover:text-gray-600 inline-block py-2">← {settings.siteName || 'ReklamX'}</Link>
      </p>
    </NeoAuthCircle>
  );
}
