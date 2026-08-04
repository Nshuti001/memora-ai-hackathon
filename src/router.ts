import { useEffect, useState, useCallback } from 'react';

export type Route =
  | 'home'
  | 'features'
  | 'how-it-works'
  | 'dashboard'
  | 'architecture'
  | 'pricing'
  | 'docs'
  | 'developers'
  | 'contact'
  | 'login'
  | 'signup';

const routeMap: Record<string, Route> = {
  '': 'home',
  '#': 'home',
  '#home': 'home',
  '#features': 'features',
  '#how-it-works': 'how-it-works',
  '#dashboard': 'dashboard',
  '#architecture': 'architecture',
  '#pricing': 'pricing',
  '#docs': 'docs',
  '#developers': 'developers',
  '#contact': 'contact',
  '#login': 'login',
  '#signup': 'signup',
};

export function useRouter() {
  const [route, setRoute] = useState<Route>('home');

  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash || '#home';
      setRoute(routeMap[hash] ?? 'home');
      window.scrollTo(0, 0);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.location.hash = r === 'home' ? '#home' : `#${r}`;
  }, []);

  return { route, navigate };
}

export function navigateTo(r: Route) {
  window.location.hash = r === 'home' ? '#home' : `#${r}`;
}
