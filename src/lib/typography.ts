export type TypographyFontId = 'outfit' | 'jakarta' | 'manrope' | 'dmsans' | 'publicsans';
export type TypographyScale = 'compact' | 'standard' | 'comfortable';

export interface TypographyOption {
  id: TypographyFontId;
  label: string;
  subtitle: string;
  cssFamily: string;
  isDefault?: boolean;
}

export interface TypographyScaleOption {
  id: TypographyScale;
  label: string;
  rootPx: string;
}

export interface TypographySettings {
  fontId: TypographyFontId;
  scale: TypographyScale;
}

export const TYPOGRAPHY_STORAGE_KEY = 'zentradesk_typography_v1';

export const DEFAULT_TYPOGRAPHY_SETTINGS: TypographySettings = {
  fontId: 'outfit',
  scale: 'standard',
};

export const TYPOGRAPHY_FONTS: TypographyOption[] = [
  {
    id: 'outfit',
    label: 'Outfit',
    subtitle: 'Géométrique moderne · Par défaut',
    cssFamily: "'Outfit', 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    isDefault: true,
  },
  {
    id: 'jakarta',
    label: 'Plus Jakarta Sans',
    subtitle: 'Corporate nette · Haute lisibilité',
    cssFamily: "'Plus Jakarta Sans', 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  {
    id: 'manrope',
    label: 'Manrope',
    subtitle: 'Équilibrée & structurée pour tableaux SLA',
    cssFamily: "'Manrope', 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  {
    id: 'dmsans',
    label: 'DM Sans',
    subtitle: 'Compacte & contemporaine',
    cssFamily: "'DM Sans', 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  {
    id: 'publicsans',
    label: 'Public Sans',
    subtitle: 'Institutionnelle & neutre haute densité',
    cssFamily: "'Public Sans', 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif",
  },
];

export const TYPOGRAPHY_SCALES: TypographyScaleOption[] = [
  { id: 'compact', label: 'Dense (95%)', rootPx: '15.2px' },
  { id: 'standard', label: 'Standard (100%)', rootPx: '16px' },
  { id: 'comfortable', label: 'Confort (106%)', rootPx: '17px' },
];

export function loadTypographySettings(): TypographySettings {
  if (typeof window === 'undefined') return DEFAULT_TYPOGRAPHY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY);
    if (!raw) return DEFAULT_TYPOGRAPHY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<TypographySettings>;
    const validFont = TYPOGRAPHY_FONTS.some((f) => f.id === parsed.fontId)
      ? (parsed.fontId as TypographyFontId)
      : 'outfit';
    const validScale = TYPOGRAPHY_SCALES.some((s) => s.id === parsed.scale)
      ? (parsed.scale as TypographyScale)
      : 'standard';
    return { fontId: validFont, scale: validScale };
  } catch {
    return DEFAULT_TYPOGRAPHY_SETTINGS;
  }
}

export function saveTypographySettings(settings: TypographySettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function applyTypographySettings(settings: TypographySettings): void {
  if (typeof document === 'undefined') return;
  const fontOpt = TYPOGRAPHY_FONTS.find((f) => f.id === settings.fontId) ?? TYPOGRAPHY_FONTS[0];
  const scaleOpt = TYPOGRAPHY_SCALES.find((s) => s.id === settings.scale) ?? TYPOGRAPHY_SCALES[1];
  const root = document.documentElement;
  root.style.setProperty('--font-sans', fontOpt.cssFamily);
  root.style.setProperty('--font-display', fontOpt.cssFamily);
  root.style.fontSize = scaleOpt.rootPx;
}
