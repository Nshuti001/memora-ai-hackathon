import { useEffect, useState } from 'react';
import { Mail, Lock, User as UserIcon, ArrowRight, AlertTriangle, Loader2 } from 'lucide-react';
import Logo from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import { navigateTo } from '../router';
import { getUser, signIn, signUp } from '../lib/auth';

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const isSignup = mode === 'signup';

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in? Nothing here to do — send them where they were going.
  useEffect(() => {
    if (getUser()) navigateTo('dashboard');
  }, []);

  // Switching between sign-in and sign-up should not carry an error about the other form.
  useEffect(() => {
    setError(null);
  }, [mode]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    setError(null);
    setBusy(true);

    try {
      if (isSignup) {
        await signUp({ name: form.name.trim(), email: form.email, password: form.password });
      } else {
        await signIn({ email: form.email, password: form.password });
      }
      navigateTo('dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  const passwordTooShort = isSignup && form.password.length > 0 && form.password.length < 8;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20 relative overflow-hidden">
      <div className="absolute inset-0 grid-bg radial-fade" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-accent/[0.12] blur-[120px] animate-glow" />

      {/* The auth screens render without the navbar, so the toggle needs its own home here. */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6 z-10">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex mb-6">
            <Logo onClick={() => navigateTo('home')} />
          </div>
          <h1 className="font-display text-3xl font-bold text-content">
            {isSignup ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-2 text-sm text-content-subtle">
            {isSignup
              ? 'Your agent gets its own private memory workspace.'
              : 'Sign in to your Memora AI dashboard.'}
          </p>
        </div>

        <div className="glass-strong rounded-2xl p-6 sm:p-8">
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/[0.08] px-3 py-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <p className="text-sm text-danger leading-relaxed">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {isSignup && (
              <div>
                <label htmlFor="name" className="block text-xs font-medium text-content-muted mb-1.5">
                  Full name
                </label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-subtle" />
                  <input
                    id="name"
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-surface-sunken rounded-xl pl-10 pr-4 py-2.5 text-sm text-content placeholder:text-content-subtle border border-line/[0.10] focus:border-accent/40 focus:outline-none transition-colors"
                    placeholder="Jane Doe"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-medium text-content-muted mb-1.5">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-subtle" />
                <input
                  id="email"
                  required
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="w-full bg-surface-sunken rounded-xl pl-10 pr-4 py-2.5 text-sm text-content placeholder:text-content-subtle border border-line/[0.10] focus:border-accent/40 focus:outline-none transition-colors"
                  placeholder="jane@company.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-content-muted mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-content-subtle" />
                <input
                  id="password"
                  required
                  type="password"
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={`w-full bg-surface-sunken rounded-xl pl-10 pr-4 py-2.5 text-sm text-content placeholder:text-content-subtle border focus:outline-none transition-colors ${
                    passwordTooShort
                      ? 'border-warning/50 focus:border-warning/60'
                      : 'border-line/[0.10] focus:border-accent/40'
                  }`}
                  placeholder="••••••••"
                />
              </div>
              {isSignup && (
                <p className={`mt-1.5 text-[11px] ${passwordTooShort ? 'text-warning' : 'text-content-subtle'}`}>
                  At least 8 characters.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="group w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-6 py-3 text-sm font-semibold hover:shadow-lg hover:shadow-brand-500/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isSignup ? 'Creating account…' : 'Signing in…'}
                </>
              ) : (
                <>
                  {isSignup ? 'Create account' : 'Sign in'}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-content-subtle mt-6">
            {isSignup ? 'Already have an account? ' : "Don't have an account? "}
            <button
              onClick={() => navigateTo(isSignup ? 'login' : 'signup')}
              className="text-accent hover:text-accent font-medium transition-colors"
            >
              {isSignup ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        </div>

        <p className="text-center text-xs text-content-subtle mt-6">
          Passwords are hashed with scrypt; session tokens are stored only as a hash server-side.
        </p>
      </div>
    </div>
  );
}
