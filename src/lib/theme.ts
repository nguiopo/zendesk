import { ThemePreferenceMode } from '../types/helpdesk';

export const THEME_STORAGE_KEY = 'zentradesk_theme_mode_v1';
export const THEME_SCHEDULE_DARK_START_HOUR = 19; // 19h00
export const THEME_SCHEDULE_DARK_END_HOUR = 8; // 08h00

export interface ThemeModeOption {
  id: ThemePreferenceMode;
  label: string;
  shortLabel: string;
  description: string;
}

export const THEME_MODE_OPTIONS: ThemeModeOption[] = [
  {
    id: 'light',
    label: 'Thème clair',
    shortLabel: 'Clair',
    description: 'Affichage clair permanent pour les postes lumineux.',
  },
  {
    id: 'dark',
    label: 'Thème sombre',
    shortLabel: 'Sombre',
    description: 'Contraste sombre permanent pour réduire la fatigue visuelle.',
  },
  {
    id: 'system',
    label: 'Auto · Préférences système',
    shortLabel: 'Auto · Système',
    description: 'Suit automatiquement le réglage clair ou sombre de votre système.',
  },
  {
    id: 'schedule',
    label: 'Auto · Horaires 19h–8h',
    shortLabel: 'Auto · 19h–8h',
    description: 'Bascule en thème sombre hors heures ouvrées (19h00 à 08h00).',
  },
];

export function isValidThemeMode(value: unknown): value is ThemePreferenceMode {
  return value === 'light' || value === 'dark' || value === 'system' || value === 'schedule';
}

export function loadSavedThemeMode(): ThemePreferenceMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isValidThemeMode(raw)) return raw;
  } catch {
    // Ignore storage read errors
  }
  return 'light';
}

export function saveThemeMode(mode: ThemePreferenceMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore storage write errors
  }
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function isScheduleDarkHour(now: Date = new Date()): boolean {
  const hour = now.getHours();
  return hour >= THEME_SCHEDULE_DARK_START_HOUR || hour < THEME_SCHEDULE_DARK_END_HOUR;
}

export function resolveEffectiveDarkMode(
  mode: ThemePreferenceMode,
  systemPrefersDark: boolean,
  now: Date = new Date()
): boolean {
  switch (mode) {
    case 'dark':
      return true;
    case 'light':
      return false;
    case 'system':
      return systemPrefersDark;
    case 'schedule':
      return isScheduleDarkHour(now);
    default:
      return false;
  }
}

export function formatClockHHmm(now: Date = new Date()): string {
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function getThemeDiagnostics(
  mode: ThemePreferenceMode,
  systemPrefersDark: boolean,
  now: Date = new Date()
): {
  effectiveDark: boolean;
  statusTitle: string;
  detailLine: string;
  shortBadge: string;
} {
  const effectiveDark = resolveEffectiveDarkMode(mode, systemPrefersDark, now);
  const timeStr = formatClockHHmm(now);

  if (mode === 'light') {
    return {
      effectiveDark: false,
      statusTitle: 'Thème clair actif (manuel)',
      detailLine: 'Le thème clair reste appliqué en permanence.',
      shortBadge: 'Manuel',
    };
  }

  if (mode === 'dark') {
    return {
      effectiveDark: true,
      statusTitle: 'Thème sombre actif (manuel)',
      detailLine: 'Le thème sombre reste appliqué en permanence.',
      shortBadge: 'Manuel',
    };
  }

  if (mode === 'system') {
    return {
      effectiveDark,
      statusTitle: effectiveDark
        ? 'Thème sombre actif (Préférences système)'
        : 'Thème clair actif (Préférences système)',
      detailLine: systemPrefersDark
        ? 'Votre système signale actuellement une préférence sombre (prefers-color-scheme: dark).'
        : 'Votre système signale actuellement une préférence claire (prefers-color-scheme: light).',
      shortBadge: 'Auto · Système',
    };
  }

  // schedule (19h - 8h)
  return {
    effectiveDark,
    statusTitle: effectiveDark
      ? 'Thème sombre actif (Créneau 19h–8h)'
      : 'Thème clair actif (Journée 8h–19h)',
    detailLine: effectiveDark
      ? `Heure locale ${timeStr} · Plage nocturne (19h00–08h00) active. Passage automatique en thème clair à 08h00.`
      : `Heure locale ${timeStr} · Heures de travail (08h00–19h00). Passage automatique en thème sombre à 19h00.`,
    shortBadge: 'Auto · 19h–8h',
  };
}
