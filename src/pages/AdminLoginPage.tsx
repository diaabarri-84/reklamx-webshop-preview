import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Lock, Mail, Eye, EyeOff, ShieldCheck, AlertCircle, ArrowLeft } from 'lucide-react';
import { useAuth } from '../App';
import { useSiteSettings } from '../context/SiteSettingsContext';
import { NeoAuthCircle, NeoInput, NeoButton } from './AuthPage';

/**
 * A sign-in page for staff, separate from the customer modal.
 *
 * The customer modal is built for shoppers: it offers registration, Google, and a
 * demo tab. None of that belongs on the door to the back office — a register link
 * there is an invitation to try, and every extra control is another thing to
 * mis-click. This page does one job, tells you plainly when it fails, and sends
 * you where you were going.
 */

/** Firebase's error codes are for developers. These are for people. */
function friendlyAuthError(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      // Deliberately identical for all three: saying "no such user" tells an
      // attacker which addresses are real.
      return 'Incorrect email or password.';
    case 'auth/invalid-email':
      return 'That does not look like an email address.';
    case 'auth/user-disabled':
      return 'This account has been suspended. Contact an administrator.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'No connection to the server. Check your internet and try again.';
    case 'auth/operation-not-allowed':
      return 'Email sign-in is turned off for this project.';
    default:
      return fallback || 'Sign-in failed. Please try again.';
  }
}

const STAFF_ROLES = ['admin', 'staff', 'production'];

export default function AdminLoginPage() {
  const { user, loading, loginWithEmail, resetPassword } = useAuth();
  const { settings } = useSiteSettings();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const destination = location.state?.from || '/admin';

  // Someone already signed in has no business on a sign-in page. Send staff to
  // the back office and customers to their own portal rather than leaving them
  // staring at a form they have already filled in.
  useEffect(() => {
    if (loading || !user) return;
    navigate(STAFF_ROLES.includes(user.role) ? destination : '/customer-dashboard', { replace: true });
  }, [user, loading, destination, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetSent(false);

    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      await loginWithEmail(email.trim(), password);
      // The redirect is handled by the effect above, once the profile has loaded
      // and its role is known — routing on the raw credential would send a
      // customer to a page they cannot open.
    } catch (err: any) {
      setError(friendlyAuthError(err?.code, err?.message));
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async () => {
    setError(null);
    if (!email.trim()) {
      setError('Enter your email address first, then choose “Forgot password”.');
      return;
    }
    try {
      await resetPassword(email.trim());
      setResetSent(true);
    } catch (err: any) {
      setError(friendlyAuthError(err?.code, err?.message));
    }
  };

  const shopName = settings.companyLegalName?.trim() || settings.siteName || 'ReklamX';

  // Same neumorphic circle as the customer auth page — the client wanted ONE
  // sign-in design everywhere. The staff-only logic above is untouched: no
  // registration, no Google, role-aware redirect, enumeration-safe reset.
  return (
    <NeoAuthCircle title="Staff Login" subtitle={`${shopName} — back office`}>
      <form onSubmit={handleSubmit}>
        <NeoInput
          icon={<Mail />}
          id="admin-email"
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <NeoInput
          icon={<Lock />}
          id="admin-password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="-m-2 p-2 text-gray-400 hover:text-gray-700 transition-colors shrink-0"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          }
        />

        <div className="flex justify-end mb-5 px-1">
          <button type="button" onClick={handleReset} className="text-[0.6875rem] font-bold text-gray-400 hover:text-orange-600 py-2 -my-2">
            Forgot password?
          </button>
        </div>

        {error && (
          <p role="alert" className="text-xs font-bold text-red-600 mb-3 flex items-center justify-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </p>
        )}
        {resetSent && (
          <p role="status" className="text-xs font-bold text-emerald-700 mb-3">
            If that address has an account, a reset link is on its way. Check the spam folder too.
          </p>
        )}

        <NeoButton type="submit" busy={submitting}>
          <ShieldCheck className="w-4 h-4" /> Sign in
        </NeoButton>
      </form>

      <p className="mt-6 text-[0.6875rem] font-bold text-gray-400 leading-relaxed">
        Staff accounts are created by an administrator.
        <br />If you are a customer, <button onClick={() => navigate('/login')} className="text-orange-600 hover:text-orange-700 underline underline-offset-2">sign in here</button>.
      </p>

      <p className="mt-3 text-[0.625rem] font-bold text-gray-400">
        <button onClick={() => navigate('/')} className="hover:text-gray-600 inline-flex items-center gap-1 py-2 -my-2">
          <ArrowLeft className="w-3 h-3" /> Back to the shop
        </button>
      </p>
    </NeoAuthCircle>
  );
}
