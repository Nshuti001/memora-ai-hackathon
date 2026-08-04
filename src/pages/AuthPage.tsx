import { useState } from 'react';
import { Mail, Lock, ArrowRight, BrainCircuit, Check } from 'lucide-react';
import Logo from '../components/Logo';
import { navigateTo } from '../router';

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const isSignup = mode === 'signup';
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => navigateTo('dashboard'), 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 grid-bg radial-fade" />
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-brand-500/15 blur-[120px] animate-glow" />

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex mb-6">
            <Logo onClick={() => navigateTo('home')} />
          </div>
          <h1 className="font-display text-3xl font-bold text-white">
            {isSignup ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="mt-2 text-sm text-ink-400">
            {isSignup
              ? 'Start building agents that never forget.'
              : 'Sign in to your Memora AI dashboard.'}
          </p>
        </div>

        <div className="glass-strong rounded-2xl p-6 sm:p-8">
          {submitted ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mb-4">
                <Check className="w-7 h-7 text-emerald-400" />
              </div>
              <h3 className="font-display text-lg font-semibold text-white mb-1">
                {isSignup ? 'Account created!' : 'Signed in!'}
              </h3>
              <p className="text-sm text-ink-400">Redirecting to dashboard...</p>
            </div>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="space-y-4">
                {isSignup && (
                  <div>
                    <label className="block text-xs font-medium text-ink-300 mb-1.5">Full name</label>
                    <input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full bg-ink-900/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 border border-white/[0.06] focus:border-brand-400/30 focus:outline-none transition-colors"
                      placeholder="Jane Doe"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1.5">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" />
                    <input
                      required
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full bg-ink-900/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-ink-500 border border-white/[0.06] focus:border-brand-400/30 focus:outline-none transition-colors"
                      placeholder="jane@company.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink-300 mb-1.5">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" />
                    <input
                      required
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      className="w-full bg-ink-900/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-ink-500 border border-white/[0.06] focus:border-brand-400/30 focus:outline-none transition-colors"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                {!isSignup && (
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-ink-400">
                      <input type="checkbox" className="rounded border-ink-600 bg-ink-900 text-brand-400 focus:ring-brand-400/20" />
                      Remember me
                    </label>
                    <a href="#" className="text-xs text-brand-400 hover:text-brand-300 transition-colors">Forgot password?</a>
                  </div>
                )}

                <button
                  type="submit"
                  className="group w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-6 py-3 text-sm font-semibold hover:shadow-lg hover:shadow-brand-500/30 transition-all"
                >
                  {isSignup ? 'Create account' : 'Sign in'}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-xs text-ink-500">or continue with</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>

              {/* OAuth buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button className="glass rounded-xl py-2.5 text-sm font-medium text-ink-200 hover:bg-white/[0.06] transition-all flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7v10l10 5 10-5V7L12 2z" opacity="0.4"/><path d="M12 2v20l10-5V7L12 2z" opacity="0.7"/><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
                  Google
                </button>
                <button className="glass rounded-xl py-2.5 text-sm font-medium text-ink-200 hover:bg-white/[0.06] transition-all flex items-center justify-center gap-2">
                  <BrainCircuit className="w-4 h-4 text-brand-400" />
                  Cognito
                </button>
              </div>

              <p className="text-center text-sm text-ink-400 mt-6">
                {isSignup ? 'Already have an account? ' : "Don't have an account? "}
                <button
                  onClick={() => navigateTo(isSignup ? 'login' : 'signup')}
                  className="text-brand-400 hover:text-brand-300 font-medium transition-colors"
                >
                  {isSignup ? 'Sign in' : 'Sign up'}
                </button>
              </p>
            </>
          )}
        </div>

        <p className="text-center text-xs text-ink-500 mt-6">
          By continuing, you agree to Memora AI's{' '}
          <a href="#" className="hover:text-ink-300 transition-colors">Terms</a> and{' '}
          <a href="#" className="hover:text-ink-300 transition-colors">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
