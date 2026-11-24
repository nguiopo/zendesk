import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { ShieldCheck, ArrowRight, Headphones, Clock, Cpu, Users } from 'lucide-react';
import { auth, googleProvider } from '../firebase';

const TEAM_PREVIEW = [
  {
    name: 'Claire Moreau',
    src: '/src/assets/images/avatar_agent_claire_1795211349040.jpg',
  },
  {
    name: 'Thomas Laurent',
    src: '/src/assets/images/avatar_agent_thomas_1795211348652.jpg',
  },
  {
    name: 'Nadia Benali',
    src: '/src/assets/images/avatar_agent_nadia_1795211349047.jpg',
  },
  {
    name: 'Lucas Bernard',
    src: '/src/assets/images/avatar_agent_lucas_1795211348429.jpg',
  },
];

export const AuthScreen: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connexion Google annulée ou bloquée.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

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
          Centre Support · SLA · Astreintes
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
              Connectez-vous avec votre compte Google professionnel pour piloter les files de tickets, les bilans mensuels PDF/CSV et le planning d’astreinte.
            </p>
          </div>

          <div className="flex items-center gap-3 py-3 border-y border-slate-100 dark:border-slate-800">
            <div className="flex -space-x-2.5 shrink-0">
              {TEAM_PREVIEW.map((member) => (
                <img
                  key={member.name}
                  src={member.src}
                  alt={member.name}
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-full object-cover ring-2 ring-white dark:ring-slate-900"
                />
              ))}
            </div>
            <div className="text-xs text-slate-600 dark:text-slate-300 leading-snug">
              <span className="font-semibold text-slate-900 dark:text-slate-100 block">
                4 pôles support opérationnels
              </span>
              <span>N1 Accès · N2 Plateforme · N3 Infra · CTI</span>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>{loading ? 'Connexion en cours...' : 'Continuer avec Google'}</span>
            <ArrowRight className="w-4 h-4" />
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
