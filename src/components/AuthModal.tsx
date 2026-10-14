import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  Mail, 
  Lock, 
  User, 
  Sparkles, 
  ShieldCheck, 
  Printer, 
  UserCheck, 
  AlertCircle, 
  CheckCircle2, 
  ArrowRight,
  Globe
, Eye, EyeOff} from 'lucide-react';
import { useAuth } from '../App';
import { useSiteSettings } from '../context/SiteSettingsContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup';
}

export default function AuthModal({ isOpen, onClose, initialMode }: AuthModalProps) {
  const { 
    loginWithGoogle, 
    loginWithEmail,
    resetPassword,
    registerWithEmail, 
    loginAsDemoUser, 
    language,
    t
  } = useAuth();
  const { settings } = useSiteSettings();
  const [activeTab, setActiveTab] = useState<'signin' | 'signup' | 'demo'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // These MUST sit above the `if (!isOpen) return null` below. Declared after it,
  // React saw a different number of hooks each time the modal opened and threw
  // "Rendered more hooks than during the previous render", which unmounted the
  // whole tree — a blank page the moment anyone opened sign-in.
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (isOpen) setActiveTab(initialMode ?? 'signin');
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setDisplayName('');
    setErrorMessage(null);
    setSuccessMessage(null);
    setLoading(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await loginWithGoogle();
      handleClose();
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        // User closed popup intentionally - log as info/warn and don't show alarming error
        console.warn("Google Sign-In popup closed by user.");
        setErrorMessage("Sign-in popup was closed. You can try again or use another sign-in option below.");
        return;
      }

      console.warn("Google Auth notice:", err);
      let msg = "Google Sign-In failed or popup was blocked by browser. Please use Email/Password or 1-Click Demo accounts below.";
      
      if (err?.code === 'auth/popup-blocked') {
        msg = "Browser blocked the Google sign-in popup. Please enable popups or sign in with Email.";
      }
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };


  /** Firebase error codes are for developers; shoppers need a sentence. */
  const friendlyError = (code: string | undefined, fallback: string) => {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        // Same message for all three on purpose — distinguishing them tells a
        // stranger which email addresses have accounts here.
        return 'Incorrect email or password.';
      case 'auth/email-already-in-use':
        return 'That email already has an account. Try signing in instead.';
      case 'auth/weak-password':
        return 'Choose a password of at least 6 characters.';
      case 'auth/invalid-email':
        return 'That does not look like an email address.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Wait a few minutes and try again.';
      case 'auth/network-request-failed':
        return 'No connection to the server. Check your internet and try again.';
      case 'auth/popup-blocked':
        return 'Your browser blocked the Google window. Allow pop-ups, or sign in with your email below.';
      case 'auth/popup-closed-by-user':
        return 'The Google window was closed before sign-in finished.';
      case 'auth/operation-not-allowed':
        return 'That sign-in method is turned off for this shop.';
      default:
        return fallback || 'Something went wrong. Please try again.';
    }
  };

  const handleForgotPassword = async () => {
    setErrorMessage(null);
    setResetSent(false);
    if (!email.trim()) {
      setErrorMessage('Enter your email address first, then choose “Forgot password”.');
      return;
    }
    try {
      await resetPassword(email.trim());
      setResetSent(true);
    } catch (err: any) {
      setErrorMessage(friendlyError(err?.code, err?.message));
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMessage('Please enter email and password');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      await loginWithEmail(email, password);
      handleClose();
    } catch (err: any) {
      console.warn("Email sign-in notice:", err);
      setErrorMessage(friendlyError(err?.code, err?.message));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !displayName) {
      setErrorMessage('Please fill in all required fields');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      await registerWithEmail(displayName, email, password);
      setSuccessMessage('Account created & logged in successfully!');
      setTimeout(() => {
        handleClose();
      }, 1000);
    } catch (err: any) {
      console.warn("Email sign-up notice:", err);
      setErrorMessage(err.message || ('Account creation failed'));
    } finally {
      setLoading(false);
    }
  };

  // The demo sign-in is a development convenience. loginAsDemoUser already
  // refuses to run in a production build, which left the buttons on screen doing
  // nothing but advertising a back door. Hide the whole tab instead.
  const showDemoTab = import.meta.env.DEV;

  const handleDemoSelect = async (role: 'admin' | 'staff' | 'client') => {
    setLoading(true);
    setErrorMessage(null);
    try {
      await loginAsDemoUser(role);
      handleClose();
    } catch (err: any) {
      console.warn("Demo login notice:", err);
      setErrorMessage('Failed to sign in demo account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden text-gray-900"
          dir={'ltr'}
        >
          {/* Header */}
          <div className="relative bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white p-6 pb-5">
            <button
              onClick={handleClose}
              className="absolute top-4 left-4 sm:left-4 right-auto text-gray-400 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-3 space-x-reverse mb-2">
              <div className="w-10 h-10 rounded-2xl bg-orange-600 text-white flex items-center justify-center shadow-md">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-black tracking-tight">
                  {`Sign in to ${settings.siteName || 'ReklamX'}`}
                </h2>
                <p className="text-xs text-gray-300 font-medium mt-0.5">
                  {'Access your portal, orders & design editor'}
                </p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex bg-white/10 p-1 rounded-2xl mt-4 text-xs font-bold">
              <button
                type="button"
                onClick={() => { setActiveTab('signin'); setErrorMessage(null); }}
                className={`flex-1 py-2 rounded-xl transition-all text-center ${
                  activeTab === 'signin' 
                    ? 'bg-orange-600 text-white shadow-sm font-black' 
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                {'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => { setActiveTab('signup'); setErrorMessage(null); }}
                className={`flex-1 py-2 rounded-xl transition-all text-center ${
                  activeTab === 'signup' 
                    ? 'bg-orange-600 text-white shadow-sm font-black' 
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                {'Register'}
              </button>
              {showDemoTab && (
              <button
                type="button"
                onClick={() => { setActiveTab('demo'); setErrorMessage(null); }}
                className={`flex-1 py-2 rounded-xl transition-all text-center flex items-center justify-center space-x-1 space-x-reverse ${
                  activeTab === 'demo' 
                    ? 'bg-orange-600 text-white shadow-sm font-black' 
                    : 'text-orange-400 hover:text-orange-300'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{'Quick Demo'}</span>
              </button>
              )}
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 space-y-4">

            {/* Error Message Alert */}
            {errorMessage && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 bg-red-50 border border-red-200 rounded-2xl flex items-start space-x-2.5 space-x-reverse text-xs text-red-700 font-medium leading-relaxed"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </motion.div>
            )}

            {/* Success Message Alert */}
            {successMessage && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center space-x-2.5 space-x-reverse text-xs text-emerald-800 font-bold"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{successMessage}</span>
              </motion.div>
            )}

            {/* Tab 1: SIGN IN */}
            {activeTab === 'signin' && (
              <form onSubmit={handleEmailSignIn} className="space-y-3">
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">
                    {'Email Address'}
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 right-auto top-3 w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@domain.com"
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:bg-white focus:border-orange-500 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <label className="block text-xs font-black text-gray-700">
                      {'Password'}
                    </label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="text-[0.6875rem] font-bold text-gray-500 hover:text-orange-600 underline underline-offset-2 transition-colors"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 right-auto top-3 w-4 h-4 text-gray-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-11 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:bg-white focus:border-orange-500 focus:outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {resetSent && (
                  <div role="status" className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-3.5 py-2.5">
                    <p className="text-[0.6875rem] font-bold leading-relaxed">
                      If that address has an account, a reset link is on its way. Check the spam folder too.
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gray-900 hover:bg-orange-600 text-white font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>{'Sign In'}</span>
                  )}
                </button>
              </form>
            )}

            {/* Tab 2: SIGN UP */}
            {activeTab === 'signup' && (
              <form onSubmit={handleEmailSignUp} className="space-y-3">
                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">
                    {'Full Name'}
                  </label>
                  <div className="relative">
                    <User className="absolute left-3.5 right-auto top-3 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      required
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={'e.g. John Doe'}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:bg-white focus:border-orange-500 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">
                    {'Email Address'}
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 right-auto top-3 w-4 h-4 text-gray-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@domain.com"
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:bg-white focus:border-orange-500 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 mb-1">
                    {'Password'}
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3.5 right-auto top-3 w-4 h-4 text-gray-400" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs font-medium focus:bg-white focus:border-orange-500 focus:outline-none transition-colors"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white font-black text-xs rounded-xl shadow-md transition-all flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span>{'Create Account'}</span>
                  )}
                </button>
              </form>
            )}

            {/* Tab 3: QUICK DEMO SWITCH */}
            {showDemoTab && activeTab === 'demo' && (
              <div className="space-y-2.5">
                <p className="text-xs text-gray-600 font-bold mb-2">
                  {'Select a role to test system capabilities instantly:'}
                </p>

                <button
                  type="button"
                  onClick={() => handleDemoSelect('admin')}
                  disabled={loading}
                  className="w-full p-3 bg-gradient-to-r from-slate-900 to-gray-800 hover:from-black hover:to-gray-900 text-white rounded-2xl border border-gray-700 flex items-center justify-between group transition-all text-right"
                >
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center font-bold">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-black">{'System Administrator'}</p>
                      <p className="text-[0.625rem] text-gray-400">{'Full access to Admin Panel & Settings'}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-orange-400 group-hover:translate-x-1 transition-transform" />
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoSelect('staff')}
                  disabled={loading}
                  className="w-full p-3 bg-purple-900/90 hover:bg-purple-900 text-white rounded-2xl border border-purple-700 flex items-center justify-between group transition-all text-right"
                >
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className="w-9 h-9 rounded-xl bg-purple-500 text-white flex items-center justify-center font-bold">
                      <Printer className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-black">{'Print Shop Staff'}</p>
                      <p className="text-[0.625rem] text-purple-200">{'Manage Print Queue & Production Steps'}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-purple-300 group-hover:translate-x-1 transition-transform" />
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoSelect('client')}
                  disabled={loading}
                  className="w-full p-3 bg-gray-50 hover:bg-orange-50 text-gray-900 rounded-2xl border border-gray-200 flex items-center justify-between group transition-all text-right"
                >
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-black">{'VIP Customer'}</p>
                      <p className="text-[0.625rem] text-gray-500">{'Track orders & loyalty reward points'}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-400 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            )}

            {/* Divider for Google Sign-In */}
            <div className="relative my-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-[0.625rem] font-extrabold uppercase">
                <span className="bg-white px-3 text-gray-400">
                  {'OR WITH GOOGLE'}
                </span>
              </div>
            </div>

            {/* Google Sign-In Button */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full py-2.5 bg-white hover:bg-gray-50 border border-gray-200 text-gray-800 font-black text-xs rounded-xl shadow-2xs transition-all flex items-center justify-center space-x-2 space-x-reverse disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{'Sign in with Google'}</span>
            </button>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
