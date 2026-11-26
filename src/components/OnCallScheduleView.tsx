import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FileDown,
  PhoneCall,
  Plus,
  Shield,
  UserCheck,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AgentAvailability,
  AgentLeave,
  LeaveStatus,
  LeaveType,
  OnCallReportEntry,
  OnCallShift,
  OnCallSpecialty,
  OnCallStatus,
  SupportAgent,
  Ticket,
} from '../types/helpdesk';
import { AGENT_AVAILABILITY_LABELS } from '../lib/formatters';
import { exportOnCallReportsArchivePdf } from '../lib/pdfExport';
import { clampString } from '../lib/validation';
import { TeamCalendarPanel } from './TeamCalendarPanel';
import { OnCallShiftCalendar } from './OnCallShiftCalendar';
import { OnCallReportPanel } from './OnCallReportPanel';
import { OnCallReportModal } from './OnCallReportModal';
import { OnCallResolvedTrendChart } from './OnCallResolvedTrendChart';
import { OnCallShiftQuickViewCard } from './OnCallShiftQuickViewCard';

interface OnCallScheduleViewProps {
  uid: string;
  currentUserName: string;
  agents: SupportAgent[];
  shifts: OnCallShift[];
  leaves: AgentLeave[];
  tickets: Ticket[];
  reports: OnCallReportEntry[];
}

type OnCallSubTab = 'shifts_calendar' | 'calendar' | 'roster' | 'reports';

const SPECIALTIES: OnCallSpecialty[] = [
  'Infrastructure N3',
  'Réseau & Hors Zone',
  'Sécurité & Accès',
  'Support VIP',
];

const LEAVE_TYPES: LeaveType[] = [
  'Congés payés',
  'RTT',
  'Formation',
  'Arrêt / Absence',
];

const SHIFT_STATUS_LABELS: Record<OnCallStatus, string> = {
  active: 'Astreinte active',
  scheduled: 'Planifiée',
  standby: 'Réserve',
  completed: 'Terminée',
};

function getTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

function formatFrenchDayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return 'Créneau planifié';
  const dt = new Date(y, m - 1, d);
  const str = dt.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export const OnCallScheduleView: React.FC<OnCallScheduleViewProps> = ({
  uid,
  currentUserName,
  agents,
  shifts,
  leaves,
  tickets,
  reports,
}) => {
  const [subTab, setSubTab] = useState<OnCallSubTab>('shifts_calendar');

  // Schedule On-Call Shift Modal state
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id || '');
  const [specialty, setSpecialty] = useState<OnCallSpecialty>('Infrastructure N3');
  const [shiftDate, setShiftDate] = useState(getTodayIso());
  const [dayLabel, setDayLabel] = useState(formatFrenchDayLabel(getTodayIso()));
  const [timeWindow, setTimeWindow] = useState('08:00 – 20:00');
  const [escalationPhone, setEscalationPhone] = useState('+33 6 40 22 19 88');
  const [notes, setNotes] = useState('');
  const [savingShift, setSavingShift] = useState(false);

  // Declare Leave Modal state
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [editingLeaveId, setEditingLeaveId] = useState<string | null>(null);
  const [leaveAgentId, setLeaveAgentId] = useState(agents[0]?.id || '');
  const [leaveType, setLeaveType] = useState<LeaveType>('Congés payés');
  const [leaveStartDate, setLeaveStartDate] = useState(getTodayIso());
  const [leaveEndDate, setLeaveEndDate] = useState(getTodayIso());
  const [leaveStatus, setLeaveStatus] = useState<LeaveStatus>('approved');
  const [leaveNotes, setLeaveNotes] = useState('');
  const [savingLeave, setSavingLeave] = useState(false);

  // OnCallReportModal state
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportModalShift, setReportModalShift] = useState<OnCallShift | null>(null);
  const [exportingArchivePdf, setExportingArchivePdf] = useState(false);

  const handleExportArchivePdf = () => {
    if (reports.length === 0 || exportingArchivePdf) return;
    setExportingArchivePdf(true);
    try {
      exportOnCallReportsArchivePdf({
        entries: reports,
        exportedBy: currentUserName,
      });
    } finally {
      window.setTimeout(() => setExportingArchivePdf(false), 400);
    }
  };

  const openReportModalForShift = (shift?: OnCallShift | null) => {
    setReportModalShift(shift || null);
    setShowReportModal(true);
  };

  const reportCountByShiftId = useMemo(() => {
    const counts = new Map<string, number>();
    reports.forEach((rep) => {
      if (rep.shiftId) {
        counts.set(rep.shiftId, (counts.get(rep.shiftId) || 0) + 1);
      }
    });
    return counts;
  }, [reports]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) || agents[0],
    [agents, selectedAgentId]
  );

  const selectedLeaveAgent = useMemo(
    () => agents.find((a) => a.id === leaveAgentId) || agents[0],
    [agents, leaveAgentId]
  );

  const isSelectedAgentEligible =
    selectedAgent &&
    (selectedAgent.availability === 'available' || selectedAgent.availability === 'on_call');

  const selectedAgentHasLeaveOnShiftDate = useMemo(() => {
    if (!selectedAgent || !shiftDate) return undefined;
    return leaves.find(
      (lv) => lv.agentId === selectedAgent.id && lv.startDate <= shiftDate && lv.endDate >= shiftDate
    );
  }, [leaves, selectedAgent, shiftDate]);

  // Count distinct overlap days in the current month for the tab badge
  const currentMonthOverlapCount = useMemo(() => {
    const now = new Date();
    const yr = now.getFullYear();
    const mo = now.getMonth();
    const lastDay = new Date(yr, mo + 1, 0).getDate();
    let count = 0;
    for (let d = 1; d <= lastDay; d++) {
      const iso = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const absentIds = new Set(
        leaves.filter((lv) => lv.startDate <= iso && lv.endDate >= iso).map((lv) => lv.agentId)
      );
      if (absentIds.size >= 2) count += 1;
    }
    return count;
  }, [leaves]);

  // Live overlap preview inside Leave Modal
  const leaveOverlapPreview = useMemo(() => {
    if (!leaveStartDate || !leaveEndDate || leaveEndDate < leaveStartDate) {
      return { overlappingLeaves: [] as AgentLeave[], conflictingShifts: [] as OnCallShift[] };
    }
    const overlappingLeaves = leaves.filter(
      (lv) =>
        lv.agentId !== (selectedLeaveAgent?.id || '') &&
        lv.startDate <= leaveEndDate &&
        lv.endDate >= leaveStartDate
    );
    const conflictingShifts = shifts.filter(
      (sh) =>
        sh.agentId === (selectedLeaveAgent?.id || '') &&
        Boolean(sh.shiftDate) &&
        sh.shiftDate! >= leaveStartDate &&
        sh.shiftDate! <= leaveEndDate
    );
    return { overlappingLeaves, conflictingShifts };
  }, [leaveEndDate, leaveStartDate, leaves, selectedLeaveAgent, shifts]);

  const handleToggleAgentAvailability = async (agent: SupportAgent, next: AgentAvailability) => {
    try {
      await updateDoc(doc(db, 'agents', agent.id), {
        availability: next,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `agents/${agent.id}`);
    }
  };

  const handleToggleShiftStatus = async (shift: OnCallShift, nextStatus: OnCallStatus) => {
    try {
      await updateDoc(doc(db, 'onCallShifts', shift.id), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `onCallShifts/${shift.id}`);
    }
  };

  const handleDeleteShift = async (shift: OnCallShift) => {
    try {
      await deleteDoc(doc(db, 'onCallShifts', shift.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `onCallShifts/${shift.id}`);
    }
  };

  const openShiftModalWithDate = (dateIso?: string) => {
    const targetDate = dateIso || getTodayIso();
    const firstAvailable = agents.find((a) => a.availability === 'available' || a.availability === 'on_call');
    if (firstAvailable) setSelectedAgentId(firstAvailable.id);
    setEditingShiftId(null);
    setShiftDate(targetDate);
    setDayLabel(formatFrenchDayLabel(targetDate));
    setTimeWindow('08:00 – 20:00');
    setNotes('');
    setShowShiftModal(true);
  };

  const openEditShift = (shift: OnCallShift) => {
    setEditingShiftId(shift.id);
    setSelectedAgentId(shift.agentId);
    setSpecialty(shift.specialty);
    setShiftDate(shift.shiftDate || getTodayIso());
    setDayLabel(shift.dayLabel);
    setTimeWindow(shift.timeWindow);
    setEscalationPhone(shift.escalationPhone || '+33 6 40 22 19 88');
    setNotes(shift.notes || '');
    setShowShiftModal(true);
  };

  const openLeaveModalWithDate = (dateIso?: string, preferredAgentId?: string) => {
    const targetDate = dateIso || getTodayIso();
    if (preferredAgentId) setLeaveAgentId(preferredAgentId);
    else if (!leaveAgentId && agents[0]) setLeaveAgentId(agents[0].id);
    setEditingLeaveId(null);
    setLeaveStartDate(targetDate);
    setLeaveEndDate(targetDate);
    setLeaveStatus('approved');
    setLeaveNotes('');
    setShowLeaveModal(true);
  };

  const openEditLeave = (leave: AgentLeave) => {
    setEditingLeaveId(leave.id);
    setLeaveAgentId(leave.agentId);
    setLeaveType(leave.leaveType);
    setLeaveStartDate(leave.startDate);
    setLeaveEndDate(leave.endDate);
    setLeaveStatus(leave.status);
    setLeaveNotes(leave.notes || '');
    setShowLeaveModal(true);
  };

  const handleSaveShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent) return;
    setSavingShift(true);
    const validIsoDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(shiftDate) ? shiftDate : undefined;
    try {
      const payload = {
        agentId: selectedAgent.id,
        agentName: clampString(selectedAgent.name, 120),
        specialty,
        dayLabel: clampString(dayLabel || 'Créneau planifié', 60),
        ...(validIsoDate ? { shiftDate: validIsoDate } : {}),
        timeWindow: clampString(timeWindow, 60),
        status: editingShiftId ? (shifts.find((s) => s.id === editingShiftId)?.status || 'scheduled') : 'scheduled',
        availabilityVerified: Boolean(isSelectedAgentEligible && !selectedAgentHasLeaveOnShiftDate),
        escalationPhone: clampString(escalationPhone, 40),
        ...(notes.trim() ? { notes: clampString(notes, 400) } : {}),
        ownerId: uid,
        memberIds: [uid],
        updatedAt: serverTimestamp(),
      };
      if (editingShiftId) await updateDoc(doc(db, 'onCallShifts', editingShiftId), payload);
      else await addDoc(collection(db, 'onCallShifts'), { ...payload, createdAt: serverTimestamp() });
      setShowShiftModal(false);
      setEditingShiftId(null);
      setNotes('');
    } catch (err) {
      handleFirestoreError(err, editingShiftId ? OperationType.UPDATE : OperationType.CREATE, editingShiftId ? `onCallShifts/${editingShiftId}` : 'onCallShifts');
    } finally {
      setSavingShift(false);
    }
  };

  const handleSaveLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLeaveAgent) return;
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(leaveStartDate)) return;
    const normalizedEnd = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(leaveEndDate) && leaveEndDate >= leaveStartDate ? leaveEndDate : leaveStartDate;
    setSavingLeave(true);
    try {
      const payload = {
        agentId: selectedLeaveAgent.id,
        agentName: clampString(selectedLeaveAgent.name, 120),
        leaveType, startDate: leaveStartDate, endDate: normalizedEnd, status: leaveStatus,
        ...(leaveNotes.trim() ? { notes: clampString(leaveNotes, 300) } : {}),
        ownerId: uid, memberIds: [uid], updatedAt: serverTimestamp(),
      };
      if (editingLeaveId) await updateDoc(doc(db, 'agentLeaves', editingLeaveId), payload);
      else await addDoc(collection(db, 'agentLeaves'), { ...payload, createdAt: serverTimestamp() });
      setShowLeaveModal(false); setEditingLeaveId(null); setLeaveNotes('');
    } catch (err) {
      handleFirestoreError(err, editingLeaveId ? OperationType.UPDATE : OperationType.CREATE, editingLeaveId ? `agentLeaves/${editingLeaveId}` : 'agentLeaves');
    } finally {
      setSavingLeave(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Astreintes, congés & disponibilités de l’équipe
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Visualisez les chevauchements de congés mois par mois, contrôlez la capacité réelle de l’équipe et planifiez les créneaux d’astreinte.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportArchivePdf}
            disabled={reports.length === 0 || exportingArchivePdf}
            title={
              reports.length === 0
                ? 'Aucun rapport d’astreinte disponible à archiver'
                : `Exporter les ${reports.length} rapport(s) d’astreinte en PDF pour archivage`
            }
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 text-white dark:text-slate-900 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed"
          >
            <FileDown className="w-4 h-4" />
            <span>
              {exportingArchivePdf
                ? 'Génération PDF...'
                : `Archiver PDF (${reports.length})`}
            </span>
          </button>

          <button
            type="button"
            onClick={() => openReportModalForShift(shifts.find((s) => s.status === 'active') || shifts[0] || null)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ClipboardList className="w-4 h-4 text-emerald-600" />
            <span>Rédiger un rapport</span>
          </button>

          <button
            type="button"
            onClick={() => openLeaveModalWithDate()}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CalendarPlus className="w-4 h-4 text-blue-600" />
            <span>Déclarer un congé</span>
          </button>

          <button
            type="button"
            onClick={() => openShiftModalWithDate()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(37,99,235,0.2)]"
          >
            <Plus className="w-4 h-4" />
            <span>Programmer une astreinte</span>
          </button>
        </div>
      </div>

      {/* Sub-View Switcher */}
      <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
        <button
          type="button"
          onClick={() => setSubTab('shifts_calendar')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            subTab === 'shifts_calendar'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Calendrier des astreintes ({shifts.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('calendar')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            subTab === 'calendar'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <CalendarDays className="w-4 h-4" />
          <span>Calendrier d’équipe</span>
          {currentMonthOverlapCount > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] ${
                subTab === 'calendar'
                  ? 'bg-blue-500 text-white'
                  : 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200'
              }`}
            >
              {currentMonthOverlapCount} chev.
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('roster')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            subTab === 'roster'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <CalendarClock className="w-4 h-4" />
          <span>Disponibilités &amp; Liste</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab('reports')}
          className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            subTab === 'reports'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ClipboardList className="w-4 h-4" />
          <span>Rapport d’astreinte</span>
          {reports.length > 0 && (
            <span
              className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] ${
                subTab === 'reports'
                  ? 'bg-blue-500 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              {reports.length}
            </span>
          )}
        </button>
      </div>

      {/* Shift Quick View Summary Card (Active Shifts & Upcoming Rotations) */}
      <OnCallShiftQuickViewCard
        agents={agents}
        shifts={shifts}
        leaves={leaves}
        onOpenReportForShift={(shift) => openReportModalForShift(shift)}
        onUpdateShiftStatus={handleToggleShiftStatus}
        onScheduleShift={() => openShiftModalWithDate()}
      />

      {/* 30-Day Recharts Trend of Resolved On-Call Incidents */}
      <OnCallResolvedTrendChart reports={reports} shifts={shifts} />

      {subTab === 'shifts_calendar' ? (
        <OnCallShiftCalendar
          agents={agents}
          shifts={shifts}
          leaves={leaves}
          onScheduleShiftForDate={(dateIso) => openShiftModalWithDate(dateIso)}
          onUpdateShiftStatus={handleToggleShiftStatus}
          onDeleteShift={handleDeleteShift}
          onOpenReportForShift={(shift) => openReportModalForShift(shift)}
        />
      ) : subTab === 'calendar' ? (
        <TeamCalendarPanel
          agents={agents}
          shifts={shifts}
          leaves={leaves}
          onDeclareLeaveForDate={(dateIso, agentId) => {
            const existing = leaves.find((l) => l.agentId === agentId && l.startDate <= dateIso && l.endDate >= dateIso);
            if (existing) openEditLeave(existing); else openLeaveModalWithDate(dateIso, agentId);
          }}
          onScheduleShiftForDate={(dateIso) => openShiftModalWithDate(dateIso)}
        />
      ) : subTab === 'reports' ? (
        <OnCallReportPanel
          uid={uid}
          currentUserName={currentUserName}
          shifts={shifts}
          tickets={tickets}
          reports={reports}
          onOpenReportModal={(shift) => openReportModalForShift(shift)}
        />
      ) : (
        <div className="space-y-6">
          {/* Availability Matrix of Technical Agents */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 space-y-4">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Disponibilité en direct des agents techniques
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {agents.map((agent) => {
                const loadPct = Math.round((agent.activeTickets / agent.maxConcurrentTickets) * 100);
                const eligible = agent.availability === 'available' || agent.availability === 'on_call';
                return (
                  <div
                    key={agent.id}
                    className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3 bg-slate-50/60 dark:bg-slate-950/40"
                  >
                    <div className="flex items-center gap-3">
                      {agent.avatarUrl && (
                        <img
                          src={agent.avatarUrl}
                          alt={agent.name}
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {agent.name}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {agent.group}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Charge actuelle</span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {agent.activeTickets}/{agent.maxConcurrentTickets} ({loadPct}%)
                      </span>
                    </div>

                    <label className="block space-y-1">
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">Statut de disponibilité</span>
                      <select
                        value={agent.availability}
                        onChange={(e) => handleToggleAgentAvailability(agent, e.target.value as AgentAvailability)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      >
                        {(Object.keys(AGENT_AVAILABILITY_LABELS) as AgentAvailability[]).map((av) => (
                          <option key={av} value={av}>
                            {AGENT_AVAILABILITY_LABELS[av]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="flex items-center gap-1.5 text-xs">
                      {eligible ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            Éligible à l’astreinte
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span className="text-amber-700 dark:text-amber-400 font-medium">
                            Indisponible / Occupé
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* On-Call Roster Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-blue-600" />
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Planning des astreintes programmées ({shifts.length})
                </h3>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4">Agent d’astreinte</th>
                    <th className="py-3 px-4">Spécialité</th>
                    <th className="py-3 px-4">Créneau</th>
                    <th className="py-3 px-4">Ligne d’escalade</th>
                    <th className="py-3 px-4">Disponibilité</th>
                    <th className="py-3 px-4">État du tour</th>
                    <th className="py-3 px-4 text-right">Rapport</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {shifts.map((shift) => {
                    const shiftReportCount = reportCountByShiftId.get(shift.id) || 0;
                    return (
                    <tr key={shift.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {shift.agentName}
                        </div>
                        {shift.notes && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-xs">
                            {shift.notes}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                          <Shield className="w-3.5 h-3.5 text-blue-600" />
                          {shift.specialty}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {shift.dayLabel}
                          {shift.shiftDate && (
                            <span className="ml-1.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              ({shift.shiftDate})
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {shift.timeWindow}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1.5">
                          <PhoneCall className="w-3.5 h-3.5 text-slate-400" />
                          {shift.escalationPhone}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            shift.availabilityVerified
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          {shift.availabilityVerified ? 'Vérifiée' : 'À confirmer'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <select
                          value={shift.status}
                          onChange={(e) => handleToggleShiftStatus(shift, e.target.value as OnCallStatus)}
                          className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                        >
                          {(Object.keys(SHIFT_STATUS_LABELS) as OnCallStatus[]).map((st) => (
                            <option key={st} value={st}>
                              {SHIFT_STATUS_LABELS[st]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          <button type="button" onClick={() => openReportModalForShift(shift)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800/70 rounded-lg cursor-pointer whitespace-nowrap shrink-0"><ClipboardList className="w-3.5 h-3.5" /><span>Rapport</span>{shiftReportCount > 0 && <span className="px-1.5 py-0.2 rounded bg-blue-600 text-white font-mono text-[10px]">{shiftReportCount}</span>}</button>
                          <button type="button" onClick={() => openEditShift(shift)} className="px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg cursor-pointer">Modifier</button>
                          <button type="button" onClick={() => handleDeleteShift(shift)} className="px-2.5 py-1.5 text-xs border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 rounded-lg cursor-pointer">Supprimer</button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Schedule On-Call Modal */}
      {showShiftModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingShiftId ? 'Modifier l’astreinte' : 'Planifier un créneau d’astreinte'}
              </h3>
              <button type="button" onClick={() => { setShowShiftModal(false); setEditingShiftId(null); }} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleSaveShift} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Agent technique (filtré par disponibilité)
                </span>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {AGENT_AVAILABILITY_LABELS[a.availability]} ({a.activeTickets}/{a.maxConcurrentTickets} tickets)
                    </option>
                  ))}
                </select>
              </label>

              {!isSelectedAgentEligible && selectedAgent && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-200">
                  Attention : {selectedAgent.name} est actuellement « {AGENT_AVAILABILITY_LABELS[selectedAgent.availability]} ». Privilégiez un agent disponible.
                </div>
              )}

              {selectedAgentHasLeaveOnShiftDate && selectedAgent && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>
                    Conflit calendrier : {selectedAgent.name} est en « {selectedAgentHasLeaveOnShiftDate.leaveType} » du{' '}
                    {selectedAgentHasLeaveOnShiftDate.startDate} au {selectedAgentHasLeaveOnShiftDate.endDate}.
                  </span>
                </div>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Spécialité</span>
                <select
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value as OnCallSpecialty)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  {SPECIALTIES.map((sp) => (
                    <option key={sp} value={sp}>
                      {sp}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Date du créneau</span>
                  <input
                    type="date"
                    required
                    value={shiftDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setShiftDate(val);
                      setDayLabel(formatFrenchDayLabel(val));
                    }}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-mono"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Plage horaire</span>
                  <input
                    type="text"
                    required
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-mono"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {['08:00 — 20:00', '20:00 — 08:00', '00:00 — 23:59'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTimeWindow(preset)}
                    className={`px-2 py-1 text-[11px] font-mono rounded-md border transition-colors cursor-pointer ${
                      timeWindow === preset
                        ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-400 text-blue-700 dark:text-blue-300'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Libellé affiché</span>
                <input
                  type="text"
                  required
                  value={dayLabel}
                  onChange={(e) => setDayLabel(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Téléphone d’escalade</span>
                <input
                  type="text"
                  required
                  value={escalationPhone}
                  onChange={(e) => setEscalationPhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-mono"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Consignes</span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Consignes d’escalade SLA ou périmètre technique..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => { setShowShiftModal(false); setEditingShiftId(null); }} className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">Annuler</button>
                <button type="submit" disabled={savingShift} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer">{savingShift ? 'Enregistrement...' : editingShiftId ? 'Mettre à jour' : 'Confirmer le tour'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Declare Leave Modal */}
      {showLeaveModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingLeaveId ? 'Modifier le congé' : 'Déclarer un congé ou une indisponibilité'}
              </h3>
              <button type="button" onClick={() => { setShowLeaveModal(false); setEditingLeaveId(null); }} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <form onSubmit={handleSaveLeave} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Agent concerné</span>
                <select
                  value={leaveAgentId}
                  onChange={(e) => setLeaveAgentId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.group}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Type d’absence</span>
                  <select
                    value={leaveType}
                    onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    {LEAVE_TYPES.map((lt) => (
                      <option key={lt} value={lt}>
                        {lt}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Statut</span>
                  <select
                    value={leaveStatus}
                    onChange={(e) => setLeaveStatus(e.target.value as LeaveStatus)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    <option value="approved">Validé</option>
                    <option value="pending">En attente</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Date de début</span>
                  <input
                    type="date"
                    required
                    value={leaveStartDate}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLeaveStartDate(val);
                      if (leaveEndDate < val) setLeaveEndDate(val);
                    }}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-mono"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Date de fin</span>
                  <input
                    type="date"
                    required
                    min={leaveStartDate}
                    value={leaveEndDate}
                    onChange={(e) => setLeaveEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-mono"
                  />
                </label>
              </div>

              {/* Live Overlap & Conflict Detection */}
              {leaveOverlapPreview.overlappingLeaves.length > 0 && (
                <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      Chevauchement détecté avec {leaveOverlapPreview.overlappingLeaves.length} autre(s) congé(s) :
                    </span>
                  </div>
                  <ul className="list-disc list-inside text-[11px] space-y-0.5">
                    {leaveOverlapPreview.overlappingLeaves.slice(0, 3).map((ov) => (
                      <li key={ov.id}>
                        {ov.agentName} ({ov.leaveType}, {ov.startDate} → {ov.endDate})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {leaveOverlapPreview.conflictingShifts.length > 0 && (
                <div className="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                  <Shield className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                  <span>
                    Conflit avec {leaveOverlapPreview.conflictingShifts.length} créneau(x) d’astreinte déjà programmé(s) pour{' '}
                    {selectedLeaveAgent?.name}.
                  </span>
                </div>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Motif / Relais prévu</span>
                <textarea
                  rows={2}
                  maxLength={300}
                  value={leaveNotes}
                  onChange={(e) => setLeaveNotes(e.target.value)}
                  placeholder="Ex : Relais assuré par le pôle N2, retour lundi 09h..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => { setShowLeaveModal(false); setEditingLeaveId(null); }} className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">Annuler</button>
                <button type="submit" disabled={savingLeave} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer">{savingLeave ? 'Enregistrement...' : editingLeaveId ? 'Mettre à jour' : 'Enregistrer le congé'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Structured Shift Report Modal */}
      <OnCallReportModal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        uid={uid}
        currentUserName={currentUserName}
        shifts={shifts}
        initialShift={reportModalShift}
        tickets={tickets}
        existingReports={reports}
        onSaved={() => {
          setSubTab('reports');
        }}
      />
    </div>
  );
};

