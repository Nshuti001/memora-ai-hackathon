import { Twitter, Github, Linkedin } from 'lucide-react';
import Logo from './Logo';
import { navigateTo, type Route } from '../router';

const sections: { title: string; links: { label: string; route?: Route }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'Features', route: 'features' },
      { label: 'Pricing', route: 'pricing' },
      { label: 'Dashboard', route: 'dashboard' },
      { label: 'Architecture', route: 'architecture' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', route: 'docs' },
      { label: 'Developer Portal', route: 'developers' },
      { label: 'API Reference', route: 'docs' },
      { label: 'SDKs', route: 'developers' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Contact', route: 'contact' },
      { label: 'Sign in', route: 'login' },
      { label: 'Get Started', route: 'signup' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative border-t border-white/[0.06] py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          <div className="col-span-2">
            <Logo onClick={() => navigateTo('home')} />
            <p className="mt-4 text-sm text-ink-400 max-w-xs leading-relaxed">
              The memory layer for autonomous AI. Give your agents persistent,
              searchable, production-grade memory powered by CockroachDB and AWS.
            </p>
            <div className="flex items-center gap-3 mt-6">
              {[Twitter, Github, Linkedin].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="w-9 h-9 rounded-lg glass flex items-center justify-center text-ink-300 hover:text-white hover:bg-white/[0.06] transition-all"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {sections.map((s) => (
            <div key={s.title}>
              <h4 className="text-sm font-semibold text-white mb-4">{s.title}</h4>
              <ul className="space-y-2.5">
                {s.links.map((l) => (
                  <li key={l.label}>
                    <button
                      onClick={() => l.route && navigateTo(l.route)}
                      className="text-sm text-ink-400 hover:text-white transition-colors text-left"
                    >
                      {l.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-ink-500">© 2026 Memora AI. All rights reserved.</p>
          <div className="flex items-center gap-6 text-sm text-ink-500">
            <a href="#" className="hover:text-ink-300 transition-colors">Privacy</a>
            <a href="#" className="hover:text-ink-300 transition-colors">Terms</a>
            <a href="#" className="hover:text-ink-300 transition-colors">Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
