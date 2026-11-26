import React, { useMemo, useState } from 'react';
import { deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Shield,
  Trash2,
  UserCheck,
  UserMinus,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { AgentLeave, LeaveType, OnCallShift, SupportAgent } from '../types/helpdesk';
import { AGENT_AVAILABILITY_LABELS } from '../lib/formatters';

interface TeamCalendarPanelProps {
  agents: SupportAgent[];
  shifts: OnCallShift[];
  leaves: AgentLeave[];
  onDeclareLeaveForDate: (dateIso: string, agentId?: string) => void;
  onScheduleShiftForDate: (dateIso: string) => void;
}

const WEEKDAY_HEADERS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const MONTH_NAMES_FR = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
];

const LEAVE_STYLES: Record<LeaveType, { cell: string; dot: string; label: string }> = {
  'Congés payés': {
    cell: 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-800/80',
    dot: 'bg-blue-600',
    label: 'Congés payés',
  },
  RTT: {
    cell: 'bg-violet-50 dark:bg-violet-950/50 text-violet-800 dark:text-violet-200 border-violet-200 dark:border-violet-800/80',
    dot: 'bg-violet-600',
    label: 'RTT',
  },
  Formation: {
    cell: 'bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-200 border-teal-200 dark:border-teal-800/80',
    dot: 'bg-teal-600',
    label: 'Formation',
  },
  'Arrêt / Absence': {
    cell: 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800/80',
    dot: 'bg-rose-600',
    label: 'Arrêt / Absence',
  },
};

function toIsoDate(year: number, monthZero: number, day: number): string {
  return `${year}-${String(monthZero + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatFrenchLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  const formatted = dt.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatShortFrenchDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export const TeamCalendarPanel: React.FC<TeamCalendarPanelProps> = ({
  agents,
  shifts,
  leaves,
  onDeclareLeaveForDate,
  onScheduleShiftForDate,
}) => {
  const today = useMemo(() => new Date(), []);
  const todayIso = toIsoDate(today.getFullYear(), today.getMonth(), today.getDate());

  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [overlapsOnly, setOverlapsOnly] = useState(false);
  const [busyLeaveId, setBusyLeaveId] = useState<string | null>(null);

  const daysInMonth = useMemo(() => new Date(viewYear, viewMonth + 1, 0).getDate(), [viewYear, viewMonth]);

  // Monday-first grid offset (0 = Mon ... 6 = Sun)
  const leadingEmptyDays = useMemo(() => {
    const jsDay = new Date(viewYear, viewMonth, 1).getDay();
    return (jsDay + 6) % 7;
  }, [viewYear, viewMonth]);

  const calendarCells = useMemo(() => {
    const cells: { iso: string; day: number; inMonth: boolean }[] = [];
    const prevMonthLastDay = new Date(viewYear, viewMonth, 0).getDate();
    const prevYear = viewMonth === 0 ? viewYear - 1 : viewYear;
    const prevMo = viewMonth === 0 ? 11 : viewMonth - 1;

    for (let i = leadingEmptyDays - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i;
      cells.push({ iso: toIsoDate(prevYear, prevMo, d), day: d, inMonth: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: toIsoDate(viewYear, viewMonth, d), day: d, inMonth: true });
    }

    const nextYear = viewMonth === 11 ? viewYear + 1 : viewYear;
    const nextMo = viewMonth === 11 ? 0 : viewMonth + 1;
    const remainder = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
    for (let d = 1; d <= remainder; d++) {
      cells.push({ iso: toIsoDate(nextYear, nextMo, d), day: d, inMonth: false });
    }

    return cells;
  }, [daysInMonth, leadingEmptyDays, viewMonth, viewYear]);

  const filteredLeaves = useMemo(() => {
    if (agentFilter === 'all') return leaves;
    return leaves.filter((lv) => lv.agentId === agentFilter);
  }, [agentFilter, leaves]);

  // Precompute per-day leaves (all workspace agents for real overlap detection + filtered for display)
  const dayDataMap = useMemo(() => {
    const map = new Map<
      string,
      {
        allLeavesOnDay: AgentLeave[];
        displayedLeaves: AgentLeave[];
        distinctAbsentCount: number;
        isOverlap: boolean;
        shiftsOnDay: OnCallShift[];
        availableAgentsCount: number;
        onCallConflicts: OnCallShift[];
      }
    >();

    for (const cell of calendarCells) {
      const allOnDay = leaves.filter((lv) => lv.startDate <= cell.iso && lv.endDate >= cell.iso);
      const displayed = filteredLeaves.filter((lv) => lv.startDate <= cell.iso && lv.endDate >= cell.iso);
      const absentAgentIds = new Set(allOnDay.map((lv) => lv.agentId));
      const shiftsOnDay = shifts.filter((sh) => sh.shiftDate === cell.iso);
      const onCallConflicts = shiftsOnDay.filter((sh) => absentAgentIds.has(sh.agentId));
      const availableAgentsCount = agents.filter(
        (ag) => !absentAgentIds.has(ag.id) && ag.availability !== 'off_duty'
      ).length;

      map.set(cell.iso, {
        allLeavesOnDay: allOnDay,
        displayedLeaves: displayed,
        distinctAbsentCount: absentAgentIds.size,
        isOverlap: absentAgentIds.size >= 2,
        shiftsOnDay,
        availableAgentsCount,
        onCallConflicts,
      });
    }

    return map;
  }, [agents, calendarCells, filteredLeaves, leaves, shifts]);

  // Monthly KPIs
  const monthlyStats = useMemo(() => {
    let overlapDays = 0;
    let totalLeaveAgentDays = 0;
    let conflictCount = 0;
    const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-`;

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toIsoDate(viewYear, viewMonth, d);
      const info = dayDataMap.get(iso);
      if (!info) continue;
      if (info.isOverlap) overlapDays += 1;
      totalLeaveAgentDays += info.distinctAbsentCount;
      conflictCount += info.onCallConflicts.length;
    }

    const pendingInMonth = leaves.filter(
      (lv) =>
        lv.status === 'pending' &&
        (lv.startDate.startsWith(monthPrefix) || lv.endDate.startsWith(monthPrefix))
    ).length;

    const selectedInfo = dayDataMap.get(selectedDate);
    const availableSelected =
      selectedInfo?.availableAgentsCount ??
      agents.filter((ag) => {
        const onLeave = leaves.some(
          (lv) => lv.agentId === ag.id && lv.startDate <= selectedDate && lv.endDate >= selectedDate
        );
        return !onLeave && ag.availability !== 'off_duty';
      }).length;

    return {
      overlapDays,
      totalLeaveAgentDays,
      conflictCount,
      pendingInMonth,
      availableSelected,
    };
  }, [agents, dayDataMap, daysInMonth, leaves, selectedDate, viewMonth, viewYear]);

  const selectedDayInfo = useMemo(() => {
    const allOnDay = leaves.filter((lv) => lv.startDate <= selectedDate && lv.endDate >= selectedDate);
    const absentSet = new Set(allOnDay.map((lv) => lv.agentId));
    const shiftsOnDay = shifts.filter((sh) => sh.shiftDate === selectedDate);
    const onCallConflicts = shiftsOnDay.filter((sh) => absentSet.has(sh.agentId));
    return {
      allLeaves: allOnDay,
      absentSet,
      shiftsOnDay,
      onCallConflicts,
      isOverlap: absentSet.size >= 2,
    };
  }, [leaves, selectedDate, shifts]);

  const goPrevMonth = () => {
    const nextMo = viewMonth === 0 ? 11 : viewMonth - 1;
    const nextYr = viewMonth === 0 ? viewYear - 1 : viewYear;
    setViewMonth(nextMo);
    setViewYear(nextYr);
    setSelectedDate(toIsoDate(nextYr, nextMo, 1));
  };

  const goNextMonth = () => {
    const nextMo = viewMonth === 11 ? 0 : viewMonth + 1;
    const nextYr = viewMonth === 11 ? viewYear + 1 : viewYear;
    setViewMonth(nextMo);
    setViewYear(nextYr);
    setSelectedDate(toIsoDate(nextYr, nextMo, 1));
  };

  const goToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedDate(todayIso);
  };

  const handleApproveLeave = async (leave: AgentLeave) => {
    setBusyLeaveId(leave.id);
    try {
      await updateDoc(doc(db, 'agentLeaves', leave.id), {
        status: 'approved',
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `agentLeaves/${leave.id}`);
    } finally {
      setBusyLeaveId(null);
    }
  };

  const handleDeleteLeave = async (leave: AgentLeave) => {
    setBusyLeaveId(leave.id);
    try {
      await deleteDoc(doc(db, 'agentLeaves', leave.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `agentLeaves/${leave.id}`);
    } finally {
      setBusyLeaveId(null);
    }
  };

  const monthDaysArray = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => i + 1),
    [daysInMonth]
  );

  return (
    <div className="space-y-5">
      {/* Monthly KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Dispo réelle ({formatShortFrenchDate(selectedDate)})</span>
            <UserCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {monthlyStats.availableSelected} / {agents.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Agents disponibles hors congés et hors service
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Chevauchements ce mois</span>
            <AlertTriangle
              className={`w-4 h-4 ${
                monthlyStats.overlapDays > 0 ? 'text-amber-600' : 'text-emerald-600'
              }`}
            />
          </div>
          <p
            className={`mt-2 font-display text-2xl font-bold font-mono tabular-nums ${
              monthlyStats.overlapDays > 0
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {monthlyStats.overlapDays} j
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Jours avec 2+ agents simultanément absents
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Jours d’absence posés</span>
            <CalendarDays className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-2 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {monthlyStats.totalLeaveAgentDays} j·agent
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Dont {monthlyStats.pendingInMonth} demande(s) en attente
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Conflits astreinte / congé</span>
            <Shield
              className={`w-4 h-4 ${
                monthlyStats.conflictCount > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            />
          </div>
          <p
            className={`mt-2 font-display text-2xl font-bold font-mono tabular-nums ${
              monthlyStats.conflictCount > 0
                ? 'text-rose-700 dark:text-rose-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {monthlyStats.conflictCount}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {monthlyStats.conflictCount > 0
              ? 'Réaffectation astreinte requise'
              : 'Couverture astreinte sans conflit'}
          </p>
        </div>
      </div>

      {/* Main Split Grid: Month Calendar (8 cols) + Selected Day Inspector (4 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Interactive Month Calendar */}
        <div className="xl:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
          {/* Calendar Toolbar */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goPrevMonth}
                aria-label="Mois précédent"
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 min-w-[165px] text-center">
                {MONTH_NAMES_FR[viewMonth]} {viewYear}
              </h3>
              <button
                type="button"
                onClick={goNextMonth}
                aria-label="Mois suivant"
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={goToday}
                className="ml-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer transition-colors"
              >
                Aujourd’hui
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                aria-label="Filtrer par agent"
                className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
              >
                <option value="all">Tous les agents ({agents.length})</option>
                {agents.map((ag) => (
                  <option key={ag.id} value={ag.id}>
                    {ag.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setOverlapsOnly((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  overlapsOnly
                    ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span>Chevauchements ({monthlyStats.overlapDays})</span>
              </button>
            </div>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50">
            {WEEKDAY_HEADERS.map((dayName) => (
              <div
                key={dayName}
                className="py-2.5 px-2 text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400"
              >
                {dayName}
              </div>
            ))}
          </div>

          {/* Month Grid */}
          <div className="grid grid-cols-7 divide-x divide-y divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800">
            {calendarCells.map((cell) => {
              const info = dayDataMap.get(cell.iso);
              const isToday = cell.iso === todayIso;
              const isSelected = cell.iso === selectedDate;
              const isOverlap = Boolean(info?.isOverlap);
              const hasConflict = Boolean(info && info.onCallConflicts.length > 0);
              const dimmed = overlapsOnly && cell.inMonth && !isOverlap;

              const availRatio =
                agents.length > 0 && info ? info.availableAgentsCount / agents.length : 1;
              const availTone =
                availRatio <= 0.5
                  ? 'text-rose-700 dark:text-rose-400'
                  : availRatio < 1
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400';

              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => setSelectedDate(cell.iso)}
                  className={`min-h-[110px] p-2 text-left flex flex-col justify-between gap-1.5 transition-colors cursor-pointer relative ${
                    !cell.inMonth
                      ? 'bg-slate-50/60 dark:bg-slate-950/50 text-slate-400 dark:text-slate-600'
                      : isOverlap
                      ? 'bg-amber-50/55 dark:bg-amber-950/20 hover:bg-amber-50 dark:hover:bg-amber-950/35'
                      : 'bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                  } ${isSelected ? 'ring-2 ring-inset ring-blue-600 z-10' : ''} ${
                    dimmed ? 'opacity-40' : ''
                  }`}
                >
                  {/* Top Row: Day number & Real Availability Count */}
                  <div className="flex items-center justify-between gap-1 w-full">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 text-xs font-mono tabular-nums font-semibold rounded-md ${
                        isToday
                          ? 'bg-blue-600 text-white'
                          : cell.inMonth
                          ? 'text-slate-900 dark:text-slate-100'
                          : 'text-slate-400 dark:text-slate-600'
                      }`}
                    >
                      {cell.day}
                    </span>

                    {cell.inMonth && info && agents.length > 0 && (
                      <span className={`text-[10px] font-mono tabular-nums font-semibold ${availTone}`}>
                        {info.availableAgentsCount}/{agents.length} dispo
                      </span>
                    )}
                  </div>

                  {/* Leaves & Overlap Indicators */}
                  <div className="space-y-1 w-full flex-1">
                    {isOverlap && cell.inMonth && info && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/60 border border-amber-300 dark:border-amber-700 text-[10px] font-semibold text-amber-900 dark:text-amber-100 truncate">
                        <AlertTriangle className="w-3 h-3 text-amber-700 dark:text-amber-300 shrink-0" />
                        <span className="truncate">Chevauchement ({info.distinctAbsentCount})</span>
                      </div>
                    )}

                    {hasConflict && cell.inMonth && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-900/60 border border-rose-300 dark:border-rose-700 text-[10px] font-semibold text-rose-800 dark:text-rose-100 truncate">
                        <Shield className="w-3 h-3 text-rose-700 dark:text-rose-300 shrink-0" />
                        <span className="truncate">Conflit astreinte</span>
                      </div>
                    )}

                    {info?.displayedLeaves.slice(0, 2).map((lv) => {
                      const style = LEAVE_STYLES[lv.leaveType] || LEAVE_STYLES['Congés payés'];
                      return (
                        <div
                          key={lv.id}
                          className={`px-1.5 py-0.5 rounded-md border text-[10px] font-medium truncate ${style.cell}`}
                          title={`${lv.agentName} — ${lv.leaveType} (${lv.status === 'pending' ? 'En attente' : 'Validé'})`}
                        >
                          <span className="truncate">
                            {lv.agentName.split(' ')[0]} · {lv.leaveType === 'Congés payés' ? 'CP' : lv.leaveType}
                            {lv.status === 'pending' ? ' (Att.)' : ''}
                          </span>
                        </div>
                      );
                    })}

                    {info && info.displayedLeaves.length > 2 && (
                      <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 px-1">
                        +{info.displayedLeaves.length - 2} autre(s)
                      </p>
                    )}
                  </div>

                  {/* On-call badge at bottom of day cell */}
                  {cell.inMonth && info && info.shiftsOnDay.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] font-medium text-slate-600 dark:text-slate-300 pt-0.5 border-t border-slate-100 dark:border-slate-800/80 w-full truncate">
                      <Shield className="w-3 h-3 text-blue-600 shrink-0" />
                      <span className="truncate">
                        {info.shiftsOnDay[0].agentName.split(' ')[0]}
                        {info.shiftsOnDay.length > 1 ? ` +${info.shiftsOnDay.length - 1}` : ''}
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Calendar Legend */}
          <div className="px-4 py-3 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-600 dark:text-slate-300">
            {(Object.keys(LEAVE_STYLES) as LeaveType[]).map((type) => (
              <span key={type} className="inline-flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-sm ${LEAVE_STYLES[type].dot}`} />
                <span>{type}</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span>Chevauchement (2+ absents)</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-blue-700 dark:text-blue-300 font-medium">
              <Shield className="w-3.5 h-3.5 text-blue-600" />
              <span>Astreinte datée</span>
            </span>
          </div>
        </div>

        {/* Selected Day Inspector */}
        <div className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 space-y-5">
          <div className="space-y-3 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
                  Détail de la journée
                </p>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  {formatFrenchLongDate(selectedDate)}
                </h3>
              </div>
              <span className="px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                {selectedDate}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onDeclareLeaveForDate(selectedDate)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Poser un congé</span>
              </button>
              <button
                type="button"
                onClick={() => onScheduleShiftForDate(selectedDate)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-medium rounded-lg transition-colors cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5 text-blue-600" />
                <span>Planifier astreinte</span>
              </button>
            </div>
          </div>

          {/* Overlap Warning Banner */}
          {selectedDayInfo.isOverlap && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Chevauchement détecté ({selectedDayInfo.absentSet.size} agents absents)
                </span>
              </div>
              <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                Capacité opérationnelle réduite à{' '}
                <strong className="font-mono">
                  {agents.length - selectedDayInfo.absentSet.size}/{agents.length}
                </strong>{' '}
                agents ce jour. Vérifiez la répartition des tickets SLA et l’astreinte.
              </p>
            </div>
          )}

          {/* On-Call Shift Conflict Warning */}
          {selectedDayInfo.onCallConflicts.length > 0 && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-rose-900 dark:text-rose-200">
                <Shield className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Conflit astreinte / indisponibilité</span>
              </div>
              {selectedDayInfo.onCallConflicts.map((sh) => (
                <p key={sh.id} className="text-[11px] text-rose-800 dark:text-rose-300">
                  {sh.agentName} est programmé en astreinte ({sh.specialty}) tout en étant déclaré absent.
                </p>
              ))}
            </div>
          )}

          {/* Real Team Availability Roster on Selected Day */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Disponibilité réelle de l’équipe ({agents.length})
            </h4>
            <div className="space-y-2">
              {agents.map((agent) => {
                const agentLeave = selectedDayInfo.allLeaves.find((lv) => lv.agentId === agent.id);
                const agentShift = selectedDayInfo.shiftsOnDay.find((sh) => sh.agentId === agent.id);
                const isOffDuty = agent.availability === 'off_duty';

                return (
                  <div
                    key={agent.id}
                    className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {agent.name}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {agent.group} · Charge {agent.activeTickets}/{agent.maxConcurrentTickets}
                      </p>
                    </div>

                    <div className="shrink-0 text-right space-y-0.5">
                      {agentLeave ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
                          <UserMinus className="w-3 h-3" />
                          <span>{agentLeave.leaveType}</span>
                        </span>
                      ) : agentShift ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200">
                          <Shield className="w-3 h-3" />
                          <span>Astreinte</span>
                        </span>
                      ) : isOffDuty ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                          <Clock className="w-3 h-3" />
                          <span>Hors service</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{AGENT_AVAILABILITY_LABELS[agent.availability]}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Leaves Covering Selected Date */}
          <div className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Congés & indisponibilités à cette date ({selectedDayInfo.allLeaves.length})
            </h4>

            {selectedDayInfo.allLeaves.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Aucun congé posé à cette date. Toute l’équipe technique est mobilisable.
              </p>
            ) : (
              <div className="space-y-2">
                {selectedDayInfo.allLeaves.map((lv) => {
                  const style = LEAVE_STYLES[lv.leaveType] || LEAVE_STYLES['Congés payés'];
                  const isBusy = busyLeaveId === lv.id;
                  return (
                    <div
                      key={lv.id}
                      className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {lv.agentName}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {formatShortFrenchDate(lv.startDate)} → {formatShortFrenchDate(lv.endDate)}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-medium ${style.cell}`}>
                          {lv.leaveType}
                        </span>
                      </div>

                      {lv.notes && (
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                          {lv.notes}
                        </p>
                      )}

                      <div className="flex items-center justify-between pt-1">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                            lv.status === 'approved'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {lv.status === 'approved' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <Clock className="w-3.5 h-3.5" />
                          )}
                          <span>{lv.status === 'approved' ? 'Validé' : 'En attente de validation'}</span>
                        </span>

                        <div className="flex items-center gap-1.5">
                          {lv.status === 'pending' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleApproveLeave(lv)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer disabled:opacity-50"
                            >
                              <Check className="w-3 h-3" />
                              <span>Valider</span>
                            </button>
                          )}
                          <button type="button" disabled={isBusy} onClick={() => onDeclareLeaveForDate(lv.startDate, lv.agentId)} title="Modifier ce congé" className="px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50">Modifier</button>
                          <button type="button" disabled={isBusy} onClick={() => handleDeleteLeave(lv)} title="Supprimer ce congé" className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer disabled:opacity-50"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Monthly Team Availability & Overlap Matrix (Agents x Days) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Matrice mensuelle des disponibilités & chevauchements — {MONTH_NAMES_FR[viewMonth]} {viewYear}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Cliquez sur un jour pour inspecter les remplacements possibles et la capacité réelle de support.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3 min-w-[175px] font-sans text-[11px] font-semibold">
                  Agent support
                </th>
                {monthDaysArray.map((day) => {
                  const iso = toIsoDate(viewYear, viewMonth, day);
                  const info = dayDataMap.get(iso);
                  const isOverlap = Boolean(info?.isOverlap);
                  const isSelected = iso === selectedDate;
                  return (
                    <th key={day} className="p-1 text-center min-w-[26px]">
                      <button
                        type="button"
                        onClick={() => setSelectedDate(iso)}
                        className={`w-6 h-6 rounded-md font-mono tabular-nums text-[10px] font-semibold cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-600 text-white'
                            : isOverlap
                            ? 'bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100'
                            : 'hover:bg-slate-200/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                        title={isOverlap ? `Chevauchement le ${iso}` : iso}
                      >
                        {day}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {agents.map((agent) => (
                <tr key={agent.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {agent.name}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {agent.group}
                    </div>
                  </td>
                  {monthDaysArray.map((day) => {
                    const iso = toIsoDate(viewYear, viewMonth, day);
                    const info = dayDataMap.get(iso);
                    const leave = leaves.find(
                      (lv) => lv.agentId === agent.id && lv.startDate <= iso && lv.endDate >= iso
                    );
                    const hasShift = shifts.some((sh) => sh.agentId === agent.id && sh.shiftDate === iso);
                    const isWeekend = [0, 6].includes(new Date(viewYear, viewMonth, day).getDay());
                    const cellTone = leave
                      ? info?.isOverlap
                        ? 'bg-amber-400/80 dark:bg-amber-600/80'
                        : LEAVE_STYLES[leave.leaveType].dot
                      : hasShift
                      ? 'bg-blue-500/80'
                      : isWeekend
                      ? 'bg-slate-200/80 dark:bg-slate-800'
                      : 'bg-emerald-500/25 dark:bg-emerald-700/30';

                    return (
                      <td key={day} className="p-0.5 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedDate(iso)}
                          title={
                            leave
                              ? `${agent.name} : ${leave.leaveType} (${leave.startDate} → ${leave.endDate})`
                              : hasShift
                              ? `${agent.name} : Astreinte programmée`
                              : `${agent.name} : Disponible (${iso})`
                          }
                          className={`w-5 h-5 rounded-sm cursor-pointer transition-transform hover:scale-110 ${cellTone}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
