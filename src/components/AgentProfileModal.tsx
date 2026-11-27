import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  Check,
  Clock,
  Monitor,
  Moon,
  Save,
  Sun,
  Type,
  UserCog,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { uploadToCloudinary } from '../lib/cloudinary';
import { ThemePreferenceMode, UserProfileDoc, UserRoleKey } from '../types/helpdesk';
import {
  getThemeDiagnostics,
  THEME_MODE_OPTIONS,
} from '../lib/theme';

interface AgentProfileModalProps {
  open: boolean;
  uid: string;
  userEmail: string;
  profile: UserProfileDoc | null;
  fallbackName: string;
  themeMode: ThemePreferenceMode;
  systemPrefersDark: boolean;
  now: Date;
  activeFontLabel: string;
  onThemeModeChange: (mode: ThemePreferenceMode) => void;
  onOpenTypography: () => void;
  onClose: () => void;
}

const ROLE_LABELS: Record<UserRoleKey, string> = {
  admin: 'Administrateur',
  supervisor: 'Superviseur',
  agent: 'Agent Support',
};

export const AgentProfileModal: React.FC<AgentProfileModalProps> = ({
  open,
  uid,
  userEmail,
  profile,
  fallbackName,
  themeMode,
  systemPrefersDark,
  now,
  activeFontLabel,
  onThemeModeChange,
  onOpenTypography,
  onClose,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [department, setDepartment] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDisplayName(profile?.displayName || fallbackName || 'Agent Support');
    setDepartment(profile?.department || 'Centre Support & Opérations');
    setSaveMessage(null);
    setSaveError(null);
  }, [open, profile?.displayName, profile?.department, fallbackName]);

  if (!open) return null;

  const role: UserRoleKey = profile?.role || 'supervisor';
  const diagnostics = getThemeDiagnostics(themeMode, systemPrefersDark, now);

  const renderModeIcon = (mode: ThemePreferenceMode, active: boolean) => {
    const cls = `w-4 h-4 shrink-0 ${active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'}`;
    switch (mode) {
      case 'light':
        return <Sun className={cls} />;
      case 'dark':
        return <Moon className={cls} />;
      case 'system':
        return <Monitor className={cls} />;
      case 'schedule':
        return <Clock className={cls} />;
    }
  };

  const handleSelectThemeMode = (mode: ThemePreferenceMode) => {
    setSaveError(null);
    setSaveMessage(null);
    onThemeModeChange(mode);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = displayName.trim().slice(0, 120);
    const cleanDept = department.trim().slice(0, 80);

    if (cleanName.length < 1) {
      setSaveError('Le nom affiché de l’agent est obligatoire.');
      return;
    }
    if (cleanDept.length < 1) {
      setSaveError('Le service ou pôle support est obligatoire.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      await setDoc(
        doc(db, 'users', uid, 'public', 'profile'),
        {
          uid,
          displayName: cleanName,
          role,
          department: cleanDept,
          ...(profile?.avatarUrl ? { avatarUrl: profile.avatarUrl.slice(0, 500) } : {}),
          themeMode,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setSaveMessage('Paramètres du profil et préférence de thème enregistrés.');
    } catch (err) {
      setSaveError('Impossible d’enregistrer les paramètres du profil.');
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/public/profile`);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarFile = async (file: File) => {
    setSaveError(null);
    setSaveMessage(null);
    if (!file.type.startsWith('image/')) {
      setSaveError('Veuillez choisir une image (JPG, PNG, WebP...).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setSaveError('L’image dépasse 5 Mo.');
      return;
    }
    setUploadingAvatar(true);
    try {
      // Le fichier est hébergé sur Cloudinary, seul le lien est stocké dans Firestore
      const up = await uploadToCloudinary(file, 'avatars', file.name);
      await setDoc(
        doc(db, 'users', uid, 'public', 'profile'),
        {
          uid,
          displayName: (displayName.trim() || fallbackName || 'Agent Support').slice(0, 120),
          role,
          department: (department.trim() || 'Centre Support & Opérations').slice(0, 80),
          avatarUrl: up.url.slice(0, 500),
          themeMode,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      setSaveMessage('Photo de profil mise à jour.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Impossible d’envoyer la photo.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-profile-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <UserCog className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3
                id="agent-profile-modal-title"
                className="font-display text-base font-bold text-slate-900 dark:text-slate-100"
              >
                Paramètres du profil de l’agent
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Identité support, rôle actif et basculement automatique du thème sombre.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer les paramètres du profil"
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-5">
          {/* Avatar (Cloudinary) */}
          <div className="flex items-center gap-4">
            {profile?.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt="Photo de profil"
                referrerPolicy="no-referrer"
                className="w-14 h-14 rounded-full object-cover border border-slate-200 dark:border-slate-700"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                <UserCog className="w-6 h-6" />
              </div>
            )}
            <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
              <span>{uploadingAvatar ? 'Envoi...' : 'Changer la photo'}</span>
              <input
                type="file"
                accept="image/*"
                disabled={uploadingAvatar}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void handleAvatarFile(f);
                }}
              />
            </label>
          </div>
          {/* Identity Fields */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Identité de l’agent
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                <span>Rôle : <strong className="text-slate-800 dark:text-slate-200">{ROLE_LABELS[role]}</strong></span>
                {userEmail && (
                  <>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="font-mono">{userEmail}</span>
                  </>
                )}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Nom affiché
                </span>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={120}
                  required
                  placeholder="Ex : Camille N."
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Service / Pôle support
                </span>
                <input
                  type="text"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  maxLength={80}
                  required
                  placeholder="Ex : Centre Support & Opérations"
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                />
              </label>
            </div>
          </div>

          <hr className="border-slate-200/80 dark:border-slate-800" />

          {/* Automatic & Manual Dark Theme Preferences */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">
                Apparence &amp; basculement automatique du thème sombre
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                Plage nocturne : <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">19h00 – 08h00</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {THEME_MODE_OPTIONS.map((option) => {
                const selected = themeMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleSelectThemeMode(option.id)}
                    className={`p-3.5 text-left rounded-xl border transition-colors cursor-pointer flex items-start justify-between gap-2.5 ${
                      selected
                        ? 'bg-blue-50/75 dark:bg-blue-950/40 border-blue-500 dark:border-blue-500 ring-1 ring-blue-500/30'
                        : 'bg-slate-50/60 dark:bg-slate-950/40 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="mt-0.5">{renderModeIcon(option.id, selected)}</div>
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {option.label}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          {option.description}
                        </p>
                      </div>
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

            {/* Live Theme Resolution Diagnostics */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  {diagnostics.effectiveDark ? (
                    <Moon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  ) : (
                    <Sun className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  )}
                  <span>{diagnostics.statusTitle}</span>
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Système : {systemPrefersDark ? 'Sombre' : 'Clair'}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed tabular-nums">
                {diagnostics.detailLine}
              </p>
            </div>
          </div>

          {saveError && (
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">{saveError}</p>
          )}
          {saveMessage && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">{saveMessage}</p>
          )}

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenTypography();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            >
              <Type className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Typographie : {activeFontLabel}</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Fermer
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-[0_1px_2px_rgba(37,99,235,0.2)]"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Enregistrement...' : 'Enregistrer le profil'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
