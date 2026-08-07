import { useEffect, useRef, useState } from 'react';
import { Menu, X, ArrowRight, LogOut, LayoutDashboard, ChevronDown } from 'lucide-react';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';
import { navigateTo, type Route } from '../router';
import {
  displayName,
  getUser,
  initials,
  onAuthChange,
  refreshSession,
  signOut,
  type AuthUser,
} from '../lib/auth';

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
  const [menuOpen, setMenuOpen] = useState(false);

  // Seeded from localStorage so a reload doesn't flash "Sign in" before the session is confirmed.
  const [user, setUser] = useState<AuthUser | null>(() => getUser());
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthChange(setUser);
    // Revalidate against the server: the token may have expired or been revoked elsewhere.
    void refreshSession().then(setUser);
    return unsubscribe;
  }, []);

  // Close the account menu on an outside click or Escape — a dropdown that only closes by
  // re-clicking its trigger feels broken.
  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    setMenuOpen(false);
    setOpen(false);
    await signOut();
    navigateTo('home');
  }

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'py-3' : 'py-5'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className={`flex items-center justify-between rounded-2xl px-4 sm:px-6 py-3 transition-all duration-300 ${scrolled ? 'glass-strong shadow-xl shadow-black/[0.07] dark:shadow-2xl dark:shadow-black/40' : ''}`}>
          <div className="shrink-0">
            <Logo onClick={() => navigateTo('home')} />
          </div>

          <nav className="hidden lg:flex items-center gap-6">
            {links.map((l) => (
              <button
                key={l.route}
                onClick={() => navigateTo(l.route)}
                className="text-sm font-medium text-content-muted hover:text-content transition-colors duration-200"
              >
                {l.label}
              </button>
            ))}
          </nav>

          <div className="hidden lg:flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex items-center gap-2 rounded-xl glass px-2 py-1.5 hover:bg-line/[0.06] transition-all"
                >
                  <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-emerald-400 text-ink-950 text-[11px] font-bold flex items-center justify-center">
                    {initials(user)}
                  </span>
                  <span className="text-sm font-medium text-content max-w-[10rem] truncate">
                    {displayName(user)}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-content-subtle transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-64 glass-strong rounded-xl p-1.5 shadow-xl shadow-black/10 dark:shadow-2xl dark:shadow-black/50 animate-fade-in"
                  >
                    <div className="px-3 py-2.5 border-b border-line/[0.10]">
                      {user.name && <div className="text-sm font-medium text-content truncate">{user.name}</div>}
                      <div className="text-xs text-content-subtle truncate">{user.email}</div>
                      <div className="mt-1 text-[10px] font-mono text-content-subtle truncate">
                        workspace {user.tenantId}
                      </div>
                    </div>
                    <button
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); navigateTo('dashboard'); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-content-muted hover:bg-line/[0.06] hover:text-content transition-colors"
                    >
                      <LayoutDashboard className="w-4 h-4" /> Dashboard
                    </button>
                    <button
                      role="menuitem"
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-content-muted hover:bg-line/[0.06] hover:text-content transition-colors"
                    >
                      <LogOut className="w-4 h-4" /> Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button
                  onClick={() => navigateTo('login')}
                  className="text-sm font-medium text-content-muted hover:text-content transition-colors"
                >
                  Sign in
                </button>
                <button
                  onClick={() => navigateTo('signup')}
                  className="group inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-4 py-2 text-sm font-semibold hover:shadow-lg hover:shadow-brand-500/30 transition-all duration-200 tap-target"
                >
                  Get Started
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </>
            )}
          </div>

          <button
            className="lg:hidden text-content-muted p-2 tap-target rounded-xl hover:bg-line/[0.06] transition-colors"
            onClick={() => setOpen(!open)}
            aria-label="Toggle menu"
          >
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {open && (
          <div className="lg:hidden mt-2 glass-strong rounded-2xl p-4 animate-fade-in">
            {user && (
              <div className="flex items-center gap-3 px-3 pb-3 mb-2 border-b border-line/[0.10]">
                <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-400 to-emerald-400 text-ink-950 text-xs font-bold flex items-center justify-center shrink-0">
                  {initials(user)}
                </span>
                <div className="min-w-0">
                  {user.name && <div className="text-sm font-medium text-content truncate">{user.name}</div>}
                  <div className="text-xs text-content-subtle truncate">{user.email}</div>
                </div>
              </div>
            )}

            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <button
                  key={l.route}
                  onClick={() => { navigateTo(l.route); setOpen(false); }}
                  className="px-3 py-2.5 rounded-lg text-left text-content-muted hover:bg-line/[0.06] hover:text-content transition-colors tap-target"
                >
                  {l.label}
                </button>
              ))}

              <div className="flex items-center justify-between px-3 py-2 mt-1 border-t border-line/[0.10]">
                <span className="text-sm text-content-muted">Appearance</span>
                <ThemeToggle />
              </div>

              {user ? (
                <button
                  onClick={handleSignOut}
                  className="mt-2 flex items-center justify-center gap-2 rounded-xl glass px-4 py-2.5 text-sm font-medium text-content"
                >
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              ) : (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => { navigateTo('login'); setOpen(false); }}
                    className="flex-1 rounded-xl glass px-4 py-2.5 text-sm font-medium text-content"
                  >
                    Sign in
                  </button>
                  <button
                    onClick={() => { navigateTo('signup'); setOpen(false); }}
                    className="flex-1 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-4 py-2.5 text-sm font-semibold tap-target"
                  >
                    Get Started
                  </button>
                </div>
              )}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
