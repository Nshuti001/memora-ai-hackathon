import { useEffect, useRef, useState } from 'react';
import { Menu, X, ArrowRight, LogOut, LayoutDashboard, ChevronDown } from 'lucide-react';
import Logo from './Logo';
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
            {user ? (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="flex items-center gap-2 rounded-xl glass px-2 py-1.5 hover:bg-white/[0.06] transition-all"
                >
                  <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-400 to-emerald-400 text-ink-950 text-[11px] font-bold flex items-center justify-center">
                    {initials(user)}
                  </span>
                  <span className="text-sm font-medium text-white max-w-[10rem] truncate">
                    {displayName(user)}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-ink-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 mt-2 w-64 glass-strong rounded-xl p-1.5 shadow-2xl shadow-black/50 animate-fade-in"
                  >
                    <div className="px-3 py-2.5 border-b border-white/[0.06]">
                      {user.name && <div className="text-sm font-medium text-white truncate">{user.name}</div>}
                      <div className="text-xs text-ink-400 truncate">{user.email}</div>
                      <div className="mt-1 text-[10px] font-mono text-ink-500 truncate">
                        workspace {user.tenantId}
                      </div>
                    </div>
                    <button
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); navigateTo('dashboard'); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-ink-200 hover:bg-white/[0.06] hover:text-white transition-colors"
                    >
                      <LayoutDashboard className="w-4 h-4" /> Dashboard
                    </button>
                    <button
                      role="menuitem"
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-ink-200 hover:bg-white/[0.06] hover:text-white transition-colors"
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
              </>
            )}
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
            {user && (
              <div className="flex items-center gap-3 px-3 pb-3 mb-2 border-b border-white/[0.06]">
                <span className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-400 to-emerald-400 text-ink-950 text-xs font-bold flex items-center justify-center shrink-0">
                  {initials(user)}
                </span>
                <div className="min-w-0">
                  {user.name && <div className="text-sm font-medium text-white truncate">{user.name}</div>}
                  <div className="text-xs text-ink-400 truncate">{user.email}</div>
                </div>
              </div>
            )}

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

              {user ? (
                <button
                  onClick={handleSignOut}
                  className="mt-2 flex items-center justify-center gap-2 rounded-xl glass px-4 py-2.5 text-sm font-medium text-white"
                >
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              ) : (
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
              )}
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
