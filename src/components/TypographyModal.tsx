import React from 'react';
import { Check, RotateCcw, Type, X } from 'lucide-react';
import {
  DEFAULT_TYPOGRAPHY_SETTINGS,
  TYPOGRAPHY_FONTS,
  TYPOGRAPHY_SCALES,
  TypographyFontId,
  TypographyScale,
  TypographySettings,
} from '../lib/typography';

interface TypographyModalProps {
  open: boolean;
  settings: TypographySettings;
  onChange: (next: TypographySettings) => void;
  onClose: () => void;
}

export const TypographyModal: React.FC<TypographyModalProps> = ({
  open,
  settings,
  onChange,
  onClose,
}) => {
  if (!open) return null;

  const activeFont = TYPOGRAPHY_FONTS.find((f) => f.id === settings.fontId) ?? TYPOGRAPHY_FONTS[0];

  const handleSelectFont = (fontId: TypographyFontId) => {
    onChange({ ...settings, fontId });
  };

  const handleSelectScale = (scale: TypographyScale) => {
    onChange({ ...settings, scale });
  };

  const handleReset = () => {
    onChange(DEFAULT_TYPOGRAPHY_SETTINGS);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="typography-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <Type className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3
                id="typography-modal-title"
                className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
              >
                Gestion de la typographie
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Choisissez la police principale de l’interface (Outfit par défaut) et le confort de lecture.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la gestion de la typographie"
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Font Selection Grid */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Famille typographique
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              Active : <strong className="text-slate-900 dark:text-slate-100">{activeFont.label}</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {TYPOGRAPHY_FONTS.map((font) => {
              const selected = settings.fontId === font.id;
              return (
                <button
                  key={font.id}
                  type="button"
                  onClick={() => handleSelectFont(font.id)}
                  className={`p-3.5 text-left rounded-xl border transition-colors cursor-pointer flex items-start justify-between gap-2 ${
                    selected
                      ? 'bg-blue-50/75 dark:bg-blue-950/40 border-blue-500 dark:border-blue-500 ring-1 ring-blue-500/30'
                      : 'bg-slate-50/60 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div
                      className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate"
                      style={{ fontFamily: font.cssFamily }}
                    >
                      {font.label}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {font.subtitle}
                    </p>
                  </div>

                  {selected && (
                    <span className="w-5 h-5 rounded-md bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Reading Scale */}
        <div className="space-y-2">
          <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Échelle de lecture
          </span>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {TYPOGRAPHY_SCALES.map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => handleSelectScale(sc.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  settings.scale === sc.id
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>

        {/* Live Specimen Preview */}
        <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Aperçu en direct · {activeFont.label}</span>
            <span className="font-mono tabular-nums">Métriques : JetBrains Mono</span>
          </div>
          <p
            className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug"
            style={{ fontFamily: activeFont.cssFamily }}
          >
            ZD-2042 · Déblocage MFA administrateur HexaPay Finance
          </p>
          <p
            className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
            style={{ fontFamily: activeFont.cssFamily }}
          >
            Suivi proactif des demandes critiques avec surveillance du délai SLA alloué et routage automatique vers le groupe N1 Accès &amp; Comptes.
          </p>
          <div className="pt-1 flex items-center gap-3 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300">
            <span>SLA alloué : 30m</span>
            <span aria-hidden="true">·</span>
            <span>Conformité : 98.4%</span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Réinitialiser par défaut (Outfit)</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shadow-[0_1px_2px_rgba(37,99,235,0.2)]"
          >
            Appliquer et fermer
          </button>
        </div>
      </div>
    </div>
  );
};
