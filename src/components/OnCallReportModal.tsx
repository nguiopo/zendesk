import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileCheck2,
  PhoneCall,
  Shield,
  Wrench,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  OnCallReportEntry,
  OnCallReportEntryType,
  OnCallReportSeverity,
  OnCallReportStatus,
  OnCallShift,
  Ticket,
} from '../types/helpdesk';
import { clampInt, clampString } from '../lib/validation';

interface OnCallReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
  currentUserName: string;
  shifts: OnCallShift[];
  initialShift?: OnCallShift | null;
  tickets?: Ticket[];
  existingReports?: OnCallReportEntry[];
  onSaved?: (savedShiftId?: string) => void;
}

const ENTRY_TYPE_LABELS: Record<OnCallReportEntryType, string> = {
  incident: 'Incident détecté',
  action: 'Action corrective',
  escalation: 'Escalade N3',
  handover: 'Consigne relève',
  resolved: 'Résolution',
};

const SEVERITY_LABELS: Record<OnCallReportSeverity, string> = {
  info: 'Info / Nominal',
  warning: 'Vigilance',
  critical: 'Critique / P1',
};

const STATUS_LABELS: Record<OnCallReportStatus, string> = {
  open: 'En cours',
  resolved: 'Résolu',
  handed_over: 'Transmis relève',
};

function getCurrentTimeLabel(): string {
  const now = new Date();
  const datePart = now.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  const timePart = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${datePart} · ${timePart}`;
}

export const OnCallReportModal: React.FC<OnCallReportModalProps> = ({
  isOpen,
  onClose,
  uid,
  currentUserName,
  shifts,
  initialShift = null,
  tickets = [],
  existingReports = [],
  onSaved,
}) => {
  const defaultShiftId = useMemo(() => {
    if (initialShift?.id) return initialShift.id;
    const active = shifts.find((s) => s.status === 'active') || shifts[0];
    return active?.id || 'general';
  }, [initialShift, shifts]);

  const [selectedShiftId, setSelectedShiftId] = useState<string>(defaultShiftId);
  const [entryType, setEntryType] = useState<OnCallReportEntryType>('incident');
  const [severity, setSeverity] = useState<OnCallReportSeverity>('warning');
  const [status, setStatus] = useState<OnCallReportStatus>('open');
  const [ticketRef, setTicketRef] = useState('');
  const [title, setTitle] = useState('');
  const [problemsEncountered, setProblemsEncountered] = useState('');
  const [resolutionSteps, setResolutionSteps] = useState('');
  const [timeSpentMinutes, setTimeSpentMinutes] = useState<number>(20);
  const [handoverRequired, setHandoverRequired] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedShiftId(defaultShiftId);
    setEntryType('incident');
    setSeverity('warning');
    setStatus('open');
    setTicketRef('');
    setTitle('');
    setProblemsEncountered('');
    setResolutionSteps('');
    setTimeSpentMinutes(20);
    setHandoverRequired(false);
    setErrorMessage(null);
  }, [isOpen, defaultShiftId]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, saving, onClose]);

  const selectedShift = useMemo(() => {
    if (selectedShiftId === 'general') return null;
    return shifts.find((s) => s.id === selectedShiftId) || null;
  }, [selectedShiftId, shifts]);

  const shiftRecentEntries = useMemo(() => {
    if (!selectedShift) {
      return existingReports.filter((r) => !r.shiftId).slice(0, 2);
    }
    return existingReports.filter((r) => r.shiftId === selectedShift.id).slice(0, 2);
  }, [existingReports, selectedShift]);

  if (!isOpen) return null;

  const handleEntryTypeChange = (nextType: OnCallReportEntryType) => {
    setEntryType(nextType);
    if (nextType === 'resolved') {
      setStatus('resolved');
    } else if (nextType === 'handover') {
      setStatus('handed_over');
      setHandoverRequired(true);
    } else if (status === 'resolved' && nextType === 'incident') {
      setStatus('open');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    const cleanProblems = problemsEncountered.trim();
    const cleanResolution = resolutionSteps.trim();

    if (!cleanTitle || !cleanProblems) {
      setErrorMessage(
        'Veuillez renseigner un objet ainsi que les problèmes rencontrés avant de sauvegarder.'
      );
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const shiftLabel = selectedShift
        ? `${selectedShift.dayLabel} (${selectedShift.timeWindow}) — ${selectedShift.agentName}`
        : `Session astreinte libre — ${currentUserName}`;

      const combinedDetails = cleanResolution
        ? `Problèmes rencontrés :\n${cleanProblems}\n\nRésolutions appliquées :\n${cleanResolution}`
        : `Problèmes rencontrés :\n${cleanProblems}`;

      const cleanTicketRef = ticketRef.trim();
      const effectiveStatus: OnCallReportStatus =
        status === 'open' && handoverRequired ? 'handed_over' : status;

      await addDoc(collection(db, 'onCallReports'), {
        ...(selectedShift ? { shiftId: selectedShift.id } : {}),
        shiftLabel: clampString(shiftLabel, 120, 'Astreinte en cours'),
        agentName: clampString(currentUserName, 120, 'Agent Helpdesk'),
        entryType,
        severity,
        ...(cleanTicketRef ? { ticketRef: clampString(cleanTicketRef, 40) } : {}),
        title: clampString(cleanTitle, 180),
        details: clampString(combinedDetails, 2000),
        problemsEncountered: clampString(cleanProblems, 2000),
        ...(cleanResolution ? { resolutionSteps: clampString(cleanResolution, 2000) } : {}),
        timeSpentMinutes: clampInt(timeSpentMinutes, 0, 1440),
        handoverRequired: Boolean(handoverRequired || entryType === 'handover'),
        status: effectiveStatus,
        occurredAtLabel: clampString(getCurrentTimeLabel(), 40),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      onSaved?.(selectedShift?.id);
      onClose();
    } catch (err) {
      setErrorMessage("Impossible d'enregistrer le rapport dans Firestore. Veuillez réessayer.");
      handleFirestoreError(err, OperationType.CREATE, 'onCallReports');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="oncall-report-modal-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
        {/* Modal Header */}
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 flex items-center justify-center shrink-0">
              <ClipboardList className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <h3
                id="oncall-report-modal-title"
                className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate"
              >
                Rédiger un rapport d’astreinte
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Consignez les problèmes rencontrés et leurs résolutions pour le shift sélectionné.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fermer la fenêtre de rapport"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Linked Shift Selector + Context Strip */}
          <div className="space-y-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Créneau d’astreinte (Shift)
              </span>
              <select
                value={selectedShiftId}
                onChange={(e) => setSelectedShiftId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="general">Session libre — {currentUserName}</option>
                {shifts.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.shiftDate ? `${sh.shiftDate} · ` : ''}
                    {sh.dayLabel} ({sh.timeWindow}) — {sh.agentName} [{sh.specialty}]
                  </option>
                ))}
              </select>
            </label>

            {selectedShift && (
              <div className="px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <div className="flex flex-wrap items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {selectedShift.agentName}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span>{selectedShift.specialty}</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-mono tabular-nums">{selectedShift.timeWindow}</span>
                </div>
                <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  <PhoneCall className="w-3 h-3" />
                  {selectedShift.escalationPhone}
                </span>
              </div>
            )}

            {shiftRecentEntries.length > 0 && (
              <div className="px-3.5 py-2 rounded-lg bg-blue-50/60 dark:bg-blue-950/25 border border-blue-200/80 dark:border-blue-900/50 space-y-1">
                <p className="text-[11px] font-semibold text-blue-800 dark:text-blue-300">
                  Dernières entrées déjà consignées sur ce shift :
                </p>
                <ul className="space-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                  {shiftRecentEntries.map((entry) => (
                    <li key={entry.id} className="truncate font-mono">
                      [{entry.occurredAtLabel}] {entry.title}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Classification & Metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Type d’entrée
              </span>
              <select
                value={entryType}
                onChange={(e) => handleEntryTypeChange(e.target.value as OnCallReportEntryType)}
                className="w-full px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                {(Object.keys(ENTRY_TYPE_LABELS) as OnCallReportEntryType[]).map((t) => (
                  <option key={t} value={t}>
                    {ENTRY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Sévérité
              </span>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as OnCallReportSeverity)}
                className="w-full px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                {(Object.keys(SEVERITY_LABELS) as OnCallReportSeverity[]).map((sv) => (
                  <option key={sv} value={sv}>
                    {SEVERITY_LABELS[sv]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Statut du suivi
              </span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as OnCallReportStatus)}
                className="w-full px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                {(Object.keys(STATUS_LABELS) as OnCallReportStatus[]).map((st) => (
                  <option key={st} value={st}>
                    {STATUS_LABELS[st]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Title */}
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Objet de l’entrée <span className="text-rose-500">*</span>
            </span>
            <input
              type="text"
              required
              maxLength={180}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex : Perte passerelle VPN secteur Nord / Déblocage accès VIP..."
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </label>

          {/* Problems Encountered */}
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>
                Problèmes rencontrés <span className="text-rose-500">*</span>
              </span>
            </span>
            <textarea
              rows={3}
              required
              maxLength={2000}
              value={problemsEncountered}
              onChange={(e) => setProblemsEncountered(e.target.value)}
              placeholder="Décrivez les anomalies observées, messages d’erreur, clients ou services impactés et contexte de déclenchement..."
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 leading-relaxed"
            />
          </label>

          {/* Resolutions */}
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5 text-emerald-600" />
              <span>Résolutions &amp; actions appliquées</span>
            </span>
            <textarea
              rows={3}
              maxLength={2000}
              value={resolutionSteps}
              onChange={(e) => setResolutionSteps(e.target.value)}
              placeholder="Détaillez les correctifs appliqués, vérifications effectuées, contournements ou actions restant à mener..."
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 leading-relaxed"
            />
          </label>

          {/* Ticket Reference & Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Ticket associé (optionnel)
              </span>
              <input
                type="text"
                maxLength={40}
                list="oncall-report-ticket-refs"
                value={ticketRef}
                onChange={(e) => setTicketRef(e.target.value)}
                placeholder="Ex : ZD-1042 ou sélectionner..."
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
              <datalist id="oncall-report-ticket-refs">
                {tickets.slice(0, 40).map((tk) => (
                  <option key={tk.id} value={tk.reference}>
                    {tk.reference} · {tk.clientName} — {tk.subject.slice(0, 45)}
                  </option>
                ))}
              </datalist>
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>Durée d’intervention (min)</span>
              </span>
              <input
                type="number"
                min={0}
                max={1440}
                value={timeSpentMinutes}
                onChange={(e) => setTimeSpentMinutes(Number(e.target.value) || 0)}
                className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>
          </div>

          {/* Handover Flag */}
          <label className="flex items-center gap-2.5 p-3 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/70 cursor-pointer">
            <input
              type="checkbox"
              checked={handoverRequired}
              onChange={(e) => setHandoverRequired(e.target.checked)}
              className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
            />
            <ArrowRightLeft className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" />
            <span className="text-xs font-medium text-amber-900 dark:text-amber-200">
              Signaler cette entrée pour la relève suivante (passation prioritaire)
            </span>
          </label>

          {/* Actions Footer */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Persistance temps réel dans le journal d’astreinte</span>
            </span>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving || !title.trim() || !problemsEncountered.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileCheck2 className="w-3.5 h-3.5" />
                <span>{saving ? 'Sauvegarde...' : 'Enregistrer le rapport'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
