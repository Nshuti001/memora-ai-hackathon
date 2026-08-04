import { useEffect, useState } from 'react';
import { Menu, X, ArrowRight } from 'lucide-react';
import Logo from './Logo';
import { navigateTo, type Route } from '../router';

const links: { label: string; route: Route }[] = [
  { label: 'Features', route: 'features' },
  { label: 'How it Works', route: 'how-it-works' },
  { label: 'Dashboard', route: 'dashboard' },
  { label: 'Architecture', route: 'architecture' },
  { label: 'Pricing', route: 'pricing' },
  { label: 'Docs', route: 'docs' },
  { label: 'Developers', route: 'developers' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'py-3' : 'py-5'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className={`flex items-center justify-between rounded-2xl px-4 sm:px-6 py-3 transition-all duration-300 ${scrolled ? 'glass-strong shadow-2xl shadow-black/40' : ''}`}>
          <div className="shrink-0">
            <Logo onClick={() => navigateTo('home')} />
          </div>

          <nav className="hidden lg:flex items-center gap-6">
            {links.map((l) => (
              <button
                key={l.route}
                onClick={() => navigateTo(l.route)}
                className="text-sm font-medium text-ink-300 hover:text-white transition-colors duration-200"
              >
                {l.label}
              </button>
            ))}
          </nav>

          <div className="hidden lg:flex items-center gap-3">
            <button
              onClick={() => navigateTo('login')}
              className="text-sm font-medium text-ink-300 hover:text-white transition-colors"
            >
              Sign in
            </button>
            <button
              onClick={() => navigateTo('signup')}
              className="group inline-flex items-center gap-1.5 rounded-xl bg-white text-ink-950 px-4 py-2 text-sm font-semibold hover:bg-brand-400 transition-all duration-200 shadow-lg shadow-white/10"
            >
              Get Started
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          <button
            className="lg:hidden text-ink-200 p-2"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {open && (
          <div className="lg:hidden mt-2 glass-strong rounded-2xl p-4 animate-fade-in">
            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <button
                  key={l.route}
                  onClick={() => { navigateTo(l.route); setOpen(false); }}
                  className="px-3 py-2.5 rounded-lg text-left text-ink-200 hover:bg-white/5 hover:text-white transition-colors"
                >
                  {l.label}
                </button>
              ))}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { navigateTo('login'); setOpen(false); }}
                  className="flex-1 rounded-xl glass px-4 py-2.5 text-sm font-medium text-white"
                >
                  Sign in
                </button>
                <button
                  onClick={() => { navigateTo('signup'); setOpen(false); }}
                  className="flex-1 rounded-xl bg-white text-ink-950 px-4 py-2.5 text-sm font-semibold"
                >
                  Get Started
                </button>
              </div>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
