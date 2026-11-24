import React, { useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileDown,
  Filter,
  Flame,
  Plus,
  Search,
  Trash2,
  Wrench,
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
import { exportOnCallShiftReportPdf, formatMinutesCompact } from '../lib/pdfExport';

interface OnCallReportPanelProps {
  uid: string;
  currentUserName: string;
  shifts: OnCallShift[];
  tickets: Ticket[];
  reports: OnCallReportEntry[];
  onOpenReportModal?: (shift?: OnCallShift | null) => void;
}

const ENTRY_TYPE_LABELS: Record<OnCallReportEntryType, string> = {
  incident: 'Incident détecté',
  action: 'Action corrective',
  escalation: 'Escalade N3',
  handover: 'Consigne relève',
  resolved: 'Résolution',
};

const SEVERITY_LABELS: Record<OnCallReportSeverity, string> = {
  info: 'Info',
  warning: 'Vigilance',
  critical: 'Critique',
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

export const OnCallReportPanel: React.FC<OnCallReportPanelProps> = ({
  uid,
  currentUserName,
  shifts,
  tickets,
  reports,
  onOpenReportModal,
}) => {
  const defaultShift = useMemo(
    () => shifts.find((s) => s.status === 'active') || shifts[0] || null,
    [shifts]
  );

  // Quick incremental entry form state
  const [selectedShiftId, setSelectedShiftId] = useState<string>(defaultShift?.id || 'general');
  const [entryType, setEntryType] = useState<OnCallReportEntryType>('action');
  const [severity, setSeverity] = useState<OnCallReportSeverity>('info');
  const [ticketRef, setTicketRef] = useState('');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [timeSpentMinutes, setTimeSpentMinutes] = useState<number>(15);
  const [handoverRequired, setHandoverRequired] = useState<boolean>(false);
  const [savingEntry, setSavingEntry] = useState(false);

  // Filters
  const [filterShiftId, setFilterShiftId] = useState<string>('all');
  const [filterType, setFilterType] = useState<'all' | OnCallReportEntryType>('all');
  const [onlyHandover, setOnlyHandover] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const activeShiftForForm = useMemo(() => {
    if (selectedShiftId === 'general') return null;
    return shifts.find((s) => s.id === selectedShiftId) || null;
  }, [selectedShiftId, shifts]);

  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return reports.filter((item) => {
      if (filterShiftId !== 'all') {
        if (filterShiftId === 'general' && item.shiftId) return false;
        if (filterShiftId !== 'general' && item.shiftId !== filterShiftId) return false;
      }
      if (filterType !== 'all' && item.entryType !== filterType) return false;
      if (onlyHandover && !item.handoverRequired) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.details.toLowerCase().includes(q) ||
        (item.problemsEncountered || '').toLowerCase().includes(q) ||
        (item.resolutionSteps || '').toLowerCase().includes(q) ||
        item.agentName.toLowerCase().includes(q) ||
        (item.ticketRef || '').toLowerCase().includes(q) ||
        item.shiftLabel.toLowerCase().includes(q)
      );
    });
  }, [filterShiftId, filterType, onlyHandover, reports, searchQuery]);

  const metrics = useMemo(() => {
    const totalEntries = filteredReports.length;
    const openCount = filteredReports.filter((r) => r.status === 'open').length;
    const handoverCount = filteredReports.filter((r) => r.handoverRequired).length;
    const totalMinutes = filteredReports.reduce((sum, r) => sum + (r.timeSpentMinutes || 0), 0);
    return { totalEntries, openCount, handoverCount, totalMinutes };
  }, [filteredReports]);

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !details.trim()) return;

    setSavingEntry(true);
    try {
      const shiftLabel = activeShiftForForm
        ? `${activeShiftForForm.dayLabel} (${activeShiftForForm.timeWindow}) — ${activeShiftForForm.agentName}`
        : `Session astreinte libre — ${currentUserName}`;

      const cleanTicketRef = ticketRef.trim();
      const status: OnCallReportStatus =
        entryType === 'resolved'
          ? 'resolved'
          : entryType === 'handover'
          ? 'handed_over'
          : 'open';

      await addDoc(collection(db, 'onCallReports'), {
        ...(activeShiftForForm ? { shiftId: activeShiftForForm.id } : {}),
        shiftLabel: clampString(shiftLabel, 120, 'Astreinte en cours'),
        agentName: clampString(currentUserName, 120, 'Agent Helpdesk'),
        entryType,
        severity,
        ...(cleanTicketRef ? { ticketRef: clampString(cleanTicketRef, 40) } : {}),
        title: clampString(title, 180),
        details: clampString(details, 2000),
        timeSpentMinutes: clampInt(timeSpentMinutes, 0, 1440),
        handoverRequired: Boolean(handoverRequired || entryType === 'handover'),
        status,
        occurredAtLabel: clampString(getCurrentTimeLabel(), 40),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setTitle('');
      setDetails('');
      setTicketRef('');
      setHandoverRequired(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'onCallReports');
    } finally {
      setSavingEntry(false);
    }
  };

  const handleStatusChange = async (entry: OnCallReportEntry, nextStatus: OnCallReportStatus) => {
    try {
      await updateDoc(doc(db, 'onCallReports', entry.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `onCallReports/${entry.id}`);
    }
  };

  const handleToggleHandover = async (entry: OnCallReportEntry) => {
    try {
      await updateDoc(doc(db, 'onCallReports', entry.id), {
        handoverRequired: !entry.handoverRequired,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `onCallReports/${entry.id}`);
    }
  };

  const handleDeleteEntry = async (entry: OnCallReportEntry) => {
    try {
      await deleteDoc(doc(db, 'onCallReports', entry.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `onCallReports/${entry.id}`);
    }
  };

  const handleExportPdf = () => {
    const scopeLabel =
      filterShiftId === 'all'
        ? 'Toutes les astreintes'
        : filterShiftId === 'general'
        ? 'Sessions libres'
        : shifts.find((s) => s.id === filterShiftId)?.dayLabel || 'Créneau sélectionné';

    exportOnCallShiftReportPdf({
      shiftLabel: scopeLabel,
      entries: filteredReports,
      agentName: currentUserName,
    });
  };

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Entrées consignées</span>
            <ClipboardList className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {metrics.totalEntries}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Journal progressif en temps réel
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Actions en cours</span>
            <Flame className="w-4 h-4 text-amber-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
            {metrics.openCount}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Suivis ouverts durant la garde
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Points pour la relève</span>
            <ArrowRightLeft className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400">
            {metrics.handoverCount}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Signalés à l’équipe entrante
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Temps d’intervention</span>
            <Clock className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatMinutesCompact(metrics.totalMinutes)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Cumulé sur la sélection
          </p>
        </div>
      </div>

      {/* Main Split: Progressive Composer + Chronological Shift Report Feed */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left: Incremental Entry Composer */}
        <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 h-fit">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Consigner au fil de l’astreinte
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Ajoutez chaque intervention, incident ou consigne dès qu’il survient.
              </p>
            </div>
            {onOpenReportModal ? (
              <button
                type="button"
                onClick={() => onOpenReportModal(activeShiftForForm)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/70 text-blue-700 dark:text-blue-300 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span>Rapport structuré</span>
              </button>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-mono text-[10px] font-semibold whitespace-nowrap">
                Temps réel
              </span>
            )}
          </div>

          <form onSubmit={handleAddEntry} className="space-y-3.5">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Créneau d’astreinte rattaché
              </span>
              <select
                value={selectedShiftId}
                onChange={(e) => setSelectedShiftId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="general">Session libre — {currentUserName}</option>
                {shifts.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.dayLabel} ({sh.timeWindow}) — {sh.agentName}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Type d’entrée
                </span>
                <select
                  value={entryType}
                  onChange={(e) => setEntryType(e.target.value as OnCallReportEntryType)}
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
                  <option value="info">Info / Nominal</option>
                  <option value="warning">Vigilance</option>
                  <option value="critical">Critique / P1</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Ticket lié (optionnel)
                </span>
                <select
                  value={ticketRef}
                  onChange={(e) => setTicketRef(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  <option value="">Aucun ticket lié</option>
                  {tickets.slice(0, 30).map((tk) => (
                    <option key={tk.id} value={tk.reference}>
                      {tk.reference} · {tk.clientName.slice(0, 22)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Durée passée (min)
                </span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={timeSpentMinutes}
                  onChange={(e) => setTimeSpentMinutes(Number(e.target.value) || 0)}
                  className="w-full px-2.5 py-2 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Objet / Résumé court
              </span>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Bascule passerelle VPN Nord-Est + vérification terminaux..."
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Détails techniques &amp; actions réalisées
              </span>
              <textarea
                rows={4}
                required
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Décrivez le constat, les commandes/actions exécutées, les impacts client et ce qu’il reste à surveiller..."
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </label>

            <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/70 cursor-pointer">
              <input
                type="checkbox"
                checked={handoverRequired}
                onChange={(e) => setHandoverRequired(e.target.checked)}
                className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs font-medium text-amber-900 dark:text-amber-200">
                Mettre en avant pour la relève suivante (Point de passation)
              </span>
            </label>

            <div className="pt-1 flex justify-end">
              <button
                type="submit"
                disabled={savingEntry || !title.trim() || !details.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{savingEntry ? 'Enregistrement...' : 'Ajouter au rapport'}</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right: Chronological Journal & Export */}
        <div className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Wrench className="w-4 h-4 text-blue-600" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Journal chronologique d’astreinte ({filteredReports.length})
                </h3>
              </div>

              <button
                type="button"
                onClick={handleExportPdf}
                disabled={filteredReports.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 text-white dark:text-slate-900 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileDown className="w-3.5 h-3.5" />
                <span>Exporter rapport PDF</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrer par mot-clé, ticket, agent..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              <select
                value={filterShiftId}
                onChange={(e) => setFilterShiftId(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="all">Tous les créneaux</option>
                <option value="general">Sessions libres</option>
                {shifts.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.dayLabel} — {sh.agentName}
                  </option>
                ))}
              </select>

              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as 'all' | OnCallReportEntryType)}
                className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="all">Tous types</option>
                {(Object.keys(ENTRY_TYPE_LABELS) as OnCallReportEntryType[]).map((t) => (
                  <option key={t} value={t}>
                    {ENTRY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setOnlyHandover((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  onlyHandover
                    ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Relève uniquement</span>
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[620px] overflow-y-auto">
            {filteredReports.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <ClipboardList className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Aucune entrée dans ce journal d’astreinte
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Consignez votre première intervention à gauche ou élargissez les filtres.
                </p>
              </div>
            ) : (
              filteredReports.map((entry) => {
                const severityClass =
                  entry.severity === 'critical'
                    ? 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900'
                    : entry.severity === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300';

                return (
                  <div key={entry.id} className="p-4 space-y-2.5 hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono font-semibold text-slate-700 dark:text-slate-300">
                          {entry.occurredAtLabel}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md font-semibold ${severityClass}`}>
                          {SEVERITY_LABELS[entry.severity]}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-medium">
                          {ENTRY_TYPE_LABELS[entry.entryType]}
                        </span>
                        {entry.ticketRef && (
                          <span className="px-2 py-0.5 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-mono font-semibold">
                            {entry.ticketRef}
                          </span>
                        )}
                        {entry.handoverRequired && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 font-semibold">
                            <AlertTriangle className="w-3 h-3" />
                            <span>À relayer</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <select
                          value={entry.status}
                          onChange={(e) => handleStatusChange(entry, e.target.value as OnCallReportStatus)}
                          className="px-2 py-1 text-[11px] font-medium bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md text-slate-800 dark:text-slate-200 cursor-pointer"
                        >
                          {(Object.keys(STATUS_LABELS) as OnCallReportStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => handleToggleHandover(entry)}
                          title="Basculer l’indicateur de passation relève"
                          className={`p-1.5 rounded-md border text-xs cursor-pointer transition-colors ${
                            entry.handoverRequired
                              ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteEntry(entry)}
                          title="Supprimer cette entrée"
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        {entry.status === 'resolved' && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        )}
                        <span>{entry.title}</span>
                      </h4>
                      {entry.problemsEncountered || entry.resolutionSteps ? (
                        <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {entry.problemsEncountered && (
                            <div className="p-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/70 dark:border-amber-900/50 space-y-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                                Problèmes rencontrés
                              </p>
                              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                {entry.problemsEncountered}
                              </p>
                            </div>
                          )}
                          {entry.resolutionSteps && (
                            <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/25 border border-emerald-200/70 dark:border-emerald-900/50 space-y-1">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
                                Résolutions appliquées
                              </p>
                              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                                {entry.resolutionSteps}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                          {entry.details}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                      <span>
                        Consigné par <strong className="text-slate-700 dark:text-slate-300">{entry.agentName}</strong> ·{' '}
                        {entry.shiftLabel}
                      </span>
                      <span className="font-mono tabular-nums">
                        {entry.timeSpentMinutes > 0 ? `${entry.timeSpentMinutes} min` : 'Note instantanée'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
