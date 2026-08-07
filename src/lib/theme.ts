/**
 * Theme selection.
 *
 * Three states, not two: 'light', 'dark', and 'system'. Defaulting to the OS preference is what most
 * people expect, and collapsing that into a boolean means someone who has never touched the toggle
 * gets whatever we guessed rather than what their machine already says.
 */
export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'memora.theme';

const listeners = new Set<(choice: ThemeChoice, resolved: ResolvedTheme) => void>();

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;
}

export function getThemeChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

export function resolveTheme(choice: ThemeChoice = getThemeChoice()): ResolvedTheme {
  if (choice !== 'system') return choice;
  return media()?.matches ? 'dark' : 'light';
}

/** Writes the resolved theme onto <html>, which is what the CSS variables key off. */
function paint(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  // Lets the browser theme form controls, scrollbars and the address bar to match.
  root.style.colorScheme = resolved;
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* storage unavailable — the choice still applies for this page */
  }

  const resolved = resolveTheme(choice);
  paint(resolved);
  for (const fn of listeners) fn(choice, resolved);
}

/** Cycles light → dark → system, so the toggle can reach every state without a menu. */
export function cycleTheme(): ThemeChoice {
  const next: Record<ThemeChoice, ThemeChoice> = {
    light: 'dark',
    dark: 'system',
    system: 'light',
  };
  const choice = next[getThemeChoice()];
  setTheme(choice);
  return choice;
}

export function onThemeChange(
  fn: (choice: ThemeChoice, resolved: ResolvedTheme) => void,
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Applies the stored theme and keeps following the OS while the choice is 'system'.
 *
 * Call once at startup. The initial paint also happens in a blocking inline script in index.html —
 * doing it only here would show a flash of the wrong theme before React mounts.
 */
export function initTheme(): void {
  paint(resolveTheme());

  const mq = media();
  mq?.addEventListener('change', () => {
    if (getThemeChoice() === 'system') {
      const resolved = resolveTheme('system');
      paint(resolved);
      for (const fn of listeners) fn('system', resolved);
    }
  });
}
