import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import {
  cycleTheme,
  getThemeChoice,
  onThemeChange,
  resolveTheme,
  type ThemeChoice,
} from '../lib/theme';

const LABEL: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/**
 * Cycles light → dark → system.
 *
 * The label announces the *current* state rather than the next one. "Switch to dark" on a button
 * that currently shows a sun is ambiguous — people read the icon as the state, so the accessible
 * name has to agree with it.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [choice, setChoice] = useState<ThemeChoice>(() => getThemeChoice());

  useEffect(() => onThemeChange((next) => setChoice(next)), []);

  const Icon = ICON[choice];
  const resolved = resolveTheme(choice);

  return (
    <button
      type="button"
      onClick={() => setChoice(cycleTheme())}
      title={`Theme: ${LABEL[choice]}${choice === 'system' ? ` (currently ${resolved})` : ''}`}
      aria-label={`Theme: ${LABEL[choice]}. Activate to change.`}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl glass px-2.5 py-2 text-content-muted hover:text-content hover:bg-line/[0.06] transition-colors tap-target ${className}`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {/* The word is useful on wide screens and only noise on a phone, where the icon is enough. */}
      <span className="hidden xl:inline text-xs font-medium">{LABEL[choice]}</span>
    </button>
  );
}
