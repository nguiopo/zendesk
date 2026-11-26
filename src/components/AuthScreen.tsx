import React, { useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { ShieldCheck, ArrowRight, Headphones, Clock, Cpu, Users, Mail, Lock } from 'lucide-react';
import { auth, googleProvider } from '../firebase';

const TEAM_PREVIEW: { name: string; src: string }[] = [];

type AuthMode = 'signin' | 'signup';

const getAuthErrorMessage = (error: unknown): string => {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : '';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Email ou mot de passe incorrect.';
  }
  if (code === 'auth/email-already-in-use') return 'Un compte existe déjà avec cet email.';
  if (code === 'auth/weak-password') return 'Le mot de passe doit contenir au moins 6 caractères.';
  if (code === 'auth/invalid-email') return 'Adresse email invalide.';
  if (code === 'auth/too-many-requests') return 'Trop de tentatives. Réessayez plus tard.';
  if (code === 'auth/operation-not-allowed') return 'Méthode Email/Mot de passe non activée dans Firebase Authentication.';
  if (code === 'auth/unauthorized-domain') return 'Domaine non autorisé. Ajoutez localhost dans Firebase Authentication > Settings > Authorized domains.';
  if (code === 'auth/popup-blocked') return 'Popup bloquée par le navigateur. Autorisez les popups pour ce site.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Connexion Google annulée.';
  if (error instanceof Error) return error.message;
  return 'Une erreur est survenue lors de la connexion.';
};

export const AuthScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (err) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const isBusy = loading || googleLoading;

  return (
    <div className="min-h-screen bg-[#F5F7FB] dark:bg-slate-950 bg-architectural-grid flex flex-col justify-between p-6 md:p-12">
      <header className="max-w-6xl w-full mx-auto flex items-center justify-between gap-8">
        <div className="flex items-center gap-2.5 shrink-0">
          <svg
            width="28"
            height="28"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="28" height="28" rx="7" fill="#0F172A" />
            <path d="M7 9.5H21L10.5 18.5H21" stroke="#3B82F6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-display text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
            ZentraDesk
          </span>
        </div>
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Centre Support - SLA - Astreintes
        </span>
      </header>

      <main className="max-w-6xl w-full mx-auto my-auto py-12 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <div className="lg:col-span-7 space-y-7">
          <div className="space-y-4">
            <p className="text-xs font-semibold tracking-wide text-blue-700 dark:text-blue-400">
              Plateforme Helpdesk Proactif &amp; Supervision Temps Réel
            </p>
            <h1 className="font-display text-3xl md:text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-[1.12] [text-wrap:balance]">
              Orchestrez vos tickets SLA, votre IA de routage et vos astreintes
            </h1>
            <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              Centralisez les demandes multi-canaux, anticipez les ruptures SLA, mesurez les 8 capacités de votre équipe support et coordonnez les interventions techniques en direct.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Cpu className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Routage IA &amp; Récurrences
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Qualification automatique, corrélation des incidents récurrents et réponses assistées.
                </p>
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  SLA &amp; Astreintes
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Compteurs SLA en direct et planification selon la disponibilité réelle des techniciens.
                </p>
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Headphones className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Suivi Proactif &amp; Appels
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Appels CTI, clients hors zone, déblocage mot de passe et audits de situation.
                </p>
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <Users className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Collaboration Temps Réel
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  Présence multi-agents, détection de collision et notes internes synchronisées.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 shadow-[0_8px_30px_rgba(15,23,42,0.06)] space-y-6">
          <div className="space-y-2.5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
              <ShieldCheck className="w-4 h-4" />
              <span>Accès sécurisé espace agent</span>
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">
              Ouvrir votre poste de supervision
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              Connectez-vous avec Google ou avec votre email professionnel pour piloter les files de tickets, les bilans mensuels PDF/CSV et le planning d'astreinte.
            </p>
          </div>

          <div className="flex items-center gap-3 py-3 border-y border-slate-100 dark:border-slate-800">
            <div className="flex -space-x-2.5 shrink-0">
              {TEAM_PREVIEW.map((member) => (
                <img key={member.name} src={member.src} alt={member.name} referrerPolicy="no-referrer" className="w-9 h-9 rounded-full object-cover ring-2 ring-white dark:ring-slate-900" />
              ))}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
              <span className="font-semibold text-slate-900 dark:text-slate-100 block">Espace support configurable</span>
              <span>Créez vos agents, SLA et workflows dans l’application</span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <form className="space-y-3" onSubmit={handleEmailAuth}>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Email</span>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                  placeholder="agent@entreprise.com"
                />
              </div>
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Mot de passe</span>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500"
                  placeholder="••••••••"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={isBusy}
              className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              <span>{loading ? 'Connexion...' : mode === 'signup' ? 'Créer un compte' : 'Se connecter'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="text-xs text-slate-600 dark:text-slate-400 text-center">
            {mode === 'signin' ? (
              <button type="button" onClick={() => { setMode('signup'); setError(null); }} className="hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer">
                Pas de compte ? <span className="font-semibold">Créer un compte</span>
              </button>
            ) : (
              <button type="button" onClick={() => { setMode('signin'); setError(null); }} className="hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer">
                Déjà un compte ? <span className="font-semibold">Se connecter</span>
              </button>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-700" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400">ou</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 text-slate-700 dark:text-slate-200 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
              <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
              <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
              <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
            </svg>
            <span>{googleLoading ? 'Connexion...' : 'Continuer avec Google'}</span>
          </button>

          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Données persistées en temps réel sur Firestore avec détection de présence WebSocket.
          </p>
        </div>
      </main>

      <footer className="max-w-6xl w-full mx-auto text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span>ZentraDesk</span>
        <span>Synchronisation Firestore &amp; WebSocket active</span>
      </footer>
    </div>
  );
};
