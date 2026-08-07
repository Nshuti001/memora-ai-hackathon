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
    <footer className="relative border-t border-line/[0.10] py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          <div className="col-span-2">
            <Logo onClick={() => navigateTo('home')} />
            <p className="mt-4 text-sm text-content-subtle max-w-xs leading-relaxed">
              The memory layer for autonomous AI. Give your agents persistent,
              searchable, production-grade memory powered by CockroachDB and AWS.
            </p>
            <div className="flex items-center gap-3 mt-6">
              {[Twitter, Github, Linkedin].map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  className="w-9 h-9 coarse:w-11 coarse:h-11 rounded-lg glass flex items-center justify-center text-content-muted hover:text-content hover:bg-line/[0.06] transition-all"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {sections.map((s) => (
            <div key={s.title}>
              <h4 className="text-sm font-semibold text-content mb-4">{s.title}</h4>
              <ul className="space-y-2.5 coarse:space-y-0.5">
                {s.links.map((l) => (
                  <li key={l.label}>
                    <button
                      onClick={() => l.route && navigateTo(l.route)}
                      className="flex items-center coarse:min-h-[44px] text-sm text-content-subtle hover:text-content transition-colors text-left"
                    >
                      {l.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="pt-8 border-t border-line/[0.10] flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-content-subtle">© 2026 Memora AI. All rights reserved.</p>
          <div className="flex items-center gap-6 coarse:gap-2 text-sm text-content-subtle">
            <a href="#" className="inline-flex items-center coarse:min-h-[44px] coarse:px-2 hover:text-content-muted transition-colors">Privacy</a>
            <a href="#" className="inline-flex items-center coarse:min-h-[44px] coarse:px-2 hover:text-content-muted transition-colors">Terms</a>
            <a href="#" className="inline-flex items-center coarse:min-h-[44px] coarse:px-2 hover:text-content-muted transition-colors">Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
