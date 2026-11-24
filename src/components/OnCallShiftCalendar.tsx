import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  PhoneCall,
  Plus,
  Shield,
  Trash2,
} from 'lucide-react';
import {
  AgentLeave,
  OnCallShift,
  OnCallSpecialty,
  OnCallStatus,
  SupportAgent,
} from '../types/helpdesk';

export type ShiftCalendarViewMode = 'week' | 'month';

interface OnCallShiftCalendarProps {
  agents: SupportAgent[];
  shifts: OnCallShift[];
  leaves: AgentLeave[];
  onScheduleShiftForDate: (dateIso: string) => void;
  onUpdateShiftStatus: (shift: OnCallShift, nextStatus: OnCallStatus) => void;
  onDeleteShift: (shift: OnCallShift) => void;
  onOpenReportForShift?: (shift: OnCallShift) => void;
}

const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const WEEKDAY_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

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

const SHIFT_STATUS_LABELS: Record<OnCallStatus, string> = {
  active: 'Active',
  scheduled: 'Planifiée',
  standby: 'Réserve',
  completed: 'Terminée',
};

const SHIFT_STATUS_STYLES: Record<OnCallStatus, { card: string; text: string; dot: string }> = {
  active: {
    card: 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/80',
    text: 'text-emerald-800 dark:text-emerald-200',
    dot: 'bg-emerald-600',
  },
  scheduled: {
    card: 'bg-blue-50/90 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/80',
    text: 'text-blue-800 dark:text-blue-200',
    dot: 'bg-blue-600',
  },
  standby: {
    card: 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/80',
    text: 'text-amber-800 dark:text-amber-200',
    dot: 'bg-amber-500',
  },
  completed: {
    card: 'bg-slate-100/90 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700',
    text: 'text-slate-700 dark:text-slate-300',
    dot: 'bg-slate-500',
  },
};

function dateToIso(dt: Date): string {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

function getMondayOfWeek(dt: Date): Date {
  const copy = new Date(dt);
  copy.setHours(0, 0, 0, 0);
  const jsDay = copy.getDay();
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  copy.setDate(copy.getDate() + diffToMonday);
  return copy;
}

function getIsoWeekLabel(monday: Date): number {
  const temp = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
  const dayNum = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  return Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export const OnCallShiftCalendar: React.FC<OnCallShiftCalendarProps> = ({
  agents,
  shifts,
  leaves,
  onScheduleShiftForDate,
  onUpdateShiftStatus,
  onDeleteShift,
  onOpenReportForShift,
}) => {
  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(() => dateToIso(today), [today]);

  const [viewMode, setViewMode] = useState<ShiftCalendarViewMode>('week');
  const [cursorDateIso, setCursorDateIso] = useState<string>(todayIso);
  const [specialtyFilter, setSpecialtyFilter] = useState<'all' | OnCallSpecialty>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [focusedShiftId, setFocusedShiftId] = useState<string | null>(null);

  const cursorDate = useMemo(() => isoToDate(cursorDateIso), [cursorDateIso]);

  const filteredShifts = useMemo(() => {
    return shifts.filter((sh) => {
      if (specialtyFilter !== 'all' && sh.specialty !== specialtyFilter) return false;
      if (agentFilter !== 'all' && sh.agentId !== agentFilter) return false;
      return true;
    });
  }, [shifts, specialtyFilter, agentFilter]);

  const weekDays = useMemo(() => {
    const monday = getMondayOfWeek(cursorDate);
    return Array.from({ length: 7 }, (_, idx) => {
      const dt = new Date(monday);
      dt.setDate(monday.getDate() + idx);
      return {
        iso: dateToIso(dt),
        dayNumber: dt.getDate(),
        monthShort: dt.toLocaleDateString('fr-FR', { month: 'short' }),
        weekdayShort: WEEKDAY_SHORT[idx],
        weekdayLong: WEEKDAY_LONG[idx],
        inCurrentMonth: dt.getMonth() === cursorDate.getMonth(),
      };
    });
  }, [cursorDate]);

  const monthCells = useMemo(() => {
    const yr = cursorDate.getFullYear();
    const mo = cursorDate.getMonth();
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();
    const firstDayOffset = (new Date(yr, mo, 1).getDay() + 6) % 7;

    const cells: { iso: string; dayNumber: number; inMonth: boolean }[] = [];
    const prevLast = new Date(yr, mo, 0).getDate();
    const prevYr = mo === 0 ? yr - 1 : yr;
    const prevMo = mo === 0 ? 11 : mo - 1;

    for (let i = firstDayOffset - 1; i >= 0; i--) {
      const d = prevLast - i;
      cells.push({
        iso: dateToIso(new Date(prevYr, prevMo, d)),
        dayNumber: d,
        inMonth: false,
      });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        iso: dateToIso(new Date(yr, mo, d)),
        dayNumber: d,
        inMonth: true,
      });
    }

    const nextYr = mo === 11 ? yr + 1 : yr;
    const nextMo = mo === 11 ? 0 : mo + 1;
    const remainder = cells.length % 7 === 0 ? 0 : 7 - (cells.length % 7);
    for (let d = 1; d <= remainder; d++) {
      cells.push({
        iso: dateToIso(new Date(nextYr, nextMo, d)),
        dayNumber: d,
        inMonth: false,
      });
    }

    return cells;
  }, [cursorDate]);

  const visibleDateIsos = useMemo(
    () => (viewMode === 'week' ? weekDays.map((d) => d.iso) : monthCells.map((c) => c.iso)),
    [viewMode, weekDays, monthCells]
  );

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, OnCallShift[]>();
    for (const sh of filteredShifts) {
      if (!sh.shiftDate) continue;
      const list = map.get(sh.shiftDate) || [];
      list.push(sh);
      map.set(sh.shiftDate, list);
    }
    return map;
  }, [filteredShifts]);

  const leavesByDate = useMemo(() => {
    const map = new Map<string, AgentLeave[]>();
    for (const iso of visibleDateIsos) {
      const onDay = leaves.filter((lv) => lv.startDate <= iso && lv.endDate >= iso);
      map.set(iso, onDay);
    }
    return map;
  }, [leaves, visibleDateIsos]);

  const periodShiftCount = useMemo(() => {
    if (viewMode === 'week') {
      return weekDays.reduce((sum, d) => sum + (shiftsByDate.get(d.iso)?.length || 0), 0);
    }
    const yr = cursorDate.getFullYear();
    const moPrefix = `${yr}-${String(cursorDate.getMonth() + 1).padStart(2, '0')}-`;
    return filteredShifts.filter((s) => s.shiftDate?.startsWith(moPrefix)).length;
  }, [viewMode, weekDays, shiftsByDate, cursorDate, filteredShifts]);

  const periodLabel = useMemo(() => {
    if (viewMode === 'week') {
      const monday = isoToDate(weekDays[0].iso);
      const sunday = isoToDate(weekDays[6].iso);
      const weekNum = getIsoWeekLabel(monday);
      const startStr = monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
      const endStr = sunday.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return `Semaine S${String(weekNum).padStart(2, '0')} · ${startStr} – ${endStr}`;
    }
    return `${MONTH_NAMES_FR[cursorDate.getMonth()]} ${cursorDate.getFullYear()}`;
  }, [viewMode, weekDays, cursorDate]);

  const handlePrevPeriod = () => {
    const next = new Date(cursorDate);
    if (viewMode === 'week') {
      next.setDate(next.getDate() - 7);
    } else {
      next.setMonth(next.getMonth() - 1, 1);
    }
    setCursorDateIso(dateToIso(next));
  };

  const handleNextPeriod = () => {
    const next = new Date(cursorDate);
    if (viewMode === 'week') {
      next.setDate(next.getDate() + 7);
    } else {
      next.setMonth(next.getMonth() + 1, 1);
    }
    setCursorDateIso(dateToIso(next));
  };

  const handleToday = () => {
    setCursorDateIso(todayIso);
  };

  const focusedShift = useMemo(
    () => shifts.find((s) => s.id === focusedShiftId) || null,
    [shifts, focusedShiftId]
  );

  const undatedShifts = useMemo(
    () => filteredShifts.filter((s) => !s.shiftDate),
    [filteredShifts]
  );

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {/* Interactive Calendar Toolbar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Week / Month Mode Toggle */}
            <div
              role="tablist"
              aria-label="Mode d'affichage du calendrier des astreintes"
              className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'week'}
                onClick={() => setViewMode('week')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'week'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Semaine</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'month'}
                onClick={() => setViewMode('month')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'month'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <CalendarDays className="w-3.5 h-3.5" />
                <span>Mois</span>
              </button>
            </div>

            {/* Period Navigation */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrevPeriod}
                aria-label={viewMode === 'week' ? 'Semaine précédente' : 'Mois précédent'}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 min-w-[190px] text-center tabular-nums">
                {periodLabel}
              </h3>
              <button
                type="button"
                onClick={handleNextPeriod}
                aria-label={viewMode === 'week' ? 'Semaine suivante' : 'Mois suivant'}
                className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                Aujourd’hui
              </button>
            </div>
          </div>

          {/* Filters & Period Summary */}
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={specialtyFilter}
              onChange={(e) => setSpecialtyFilter(e.target.value as 'all' | OnCallSpecialty)}
              aria-label="Filtrer les astreintes par spécialité"
              className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
            >
              <option value="all">Toutes spécialités</option>
              <option value="Infrastructure N3">Infrastructure N3</option>
              <option value="Réseau & Hors Zone">Réseau &amp; Hors Zone</option>
              <option value="Sécurité & Accès">Sécurité &amp; Accès</option>
              <option value="Support VIP">Support VIP</option>
            </select>

            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              aria-label="Filtrer les astreintes par agent"
              className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
            >
              <option value="all">Tous les agents ({agents.length})</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name}
                </option>
              ))}
            </select>

            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap">
              {periodShiftCount} créneau{periodShiftCount > 1 ? 'x' : ''} · Clic sur une date pour planifier
            </span>
          </div>
        </div>

        {/* WEEK VIEW */}
        {viewMode === 'week' ? (
          <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
            {weekDays.map((day) => {
              const dayShifts = shiftsByDate.get(day.iso) || [];
              const dayLeaves = leavesByDate.get(day.iso) || [];
              const absentIds = new Set(dayLeaves.map((l) => l.agentId));
              const isToday = day.iso === todayIso;

              return (
                <div
                  key={day.iso}
                  onClick={() => onScheduleShiftForDate(day.iso)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onScheduleShiftForDate(day.iso);
                    }
                  }}
                  title={`Cliquer pour ajouter un créneau d'astreinte le ${day.weekdayLong} ${day.dayNumber} ${day.monthShort}`}
                  className={`min-h-[290px] p-3 flex flex-col justify-between gap-3 transition-colors cursor-pointer group ${
                    isToday
                      ? 'bg-blue-50/40 dark:bg-blue-950/15 hover:bg-blue-50/70 dark:hover:bg-blue-950/25'
                      : 'bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/35'
                  }`}
                >
                  <div className="space-y-2.5">
                    {/* Day Column Header */}
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg font-mono tabular-nums text-xs font-bold shrink-0 ${
                            isToday
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {day.dayNumber}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {day.weekdayShort}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {day.monthShort}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onScheduleShiftForDate(day.iso);
                        }}
                        aria-label={`Ajouter une astreinte le ${day.iso}`}
                        className="p-1.5 rounded-md text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors cursor-pointer shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {dayLeaves.length > 0 && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                        {absentIds.size} agent(s) en congé
                      </p>
                    )}

                    {/* Shifts on this day */}
                    {dayShifts.length === 0 ? (
                      <p className="text-[11px] text-slate-400 dark:text-slate-500 py-4 text-center">
                        Aucun créneau planifié
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {dayShifts.map((shift) => {
                          const stStyle = SHIFT_STATUS_STYLES[shift.status] || SHIFT_STATUS_STYLES.scheduled;
                          const hasLeaveConflict = absentIds.has(shift.agentId);

                          return (
                            <div
                              key={shift.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setFocusedShiftId(focusedShiftId === shift.id ? null : shift.id);
                              }}
                              className={`p-2.5 rounded-lg border space-y-1.5 transition-colors cursor-pointer ${
                                stStyle.card
                              } ${focusedShiftId === shift.id ? 'ring-2 ring-blue-500/60' : ''}`}
                            >
                              <div className="flex items-start justify-between gap-1.5">
                                <div className="min-w-0">
                                  <p className={`text-xs font-semibold truncate ${stStyle.text}`}>
                                    {shift.agentName}
                                  </p>
                                  <p className="text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                    {shift.specialty}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteShift(shift);
                                  }}
                                  title="Supprimer ce créneau"
                                  className="p-1 rounded text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 cursor-pointer shrink-0"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>

                              <div className="flex items-center gap-1 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                <Clock className="w-3 h-3 shrink-0" />
                                <span className="truncate">{shift.timeWindow}</span>
                              </div>

                              {hasLeaveConflict && (
                                <div className="flex items-center gap-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                  <span>Conflit congé</span>
                                </div>
                              )}

                              <select
                                value={shift.status}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  onUpdateShiftStatus(shift, e.target.value as OnCallStatus);
                                }}
                                aria-label={`Statut de l'astreinte de ${shift.agentName}`}
                                className="w-full px-2 py-1 text-[11px] font-medium bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200 cursor-pointer"
                              >
                                {(Object.keys(SHIFT_STATUS_LABELS) as OnCallStatus[]).map((st) => (
                                  <option key={st} value={st}>
                                    {SHIFT_STATUS_LABELS[st]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Quick-Add Shift Affordance */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onScheduleShiftForDate(day.iso);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Ajouter astreinte</span>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          /* MONTH VIEW */
          <div>
            <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50">
              {WEEKDAY_SHORT.map((dayName) => (
                <div
                  key={dayName}
                  className="py-2.5 px-2 text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400"
                >
                  {dayName}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 divide-x divide-y divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800">
              {monthCells.map((cell) => {
                const dayShifts = shiftsByDate.get(cell.iso) || [];
                const dayLeaves = leavesByDate.get(cell.iso) || [];
                const absentIds = new Set(dayLeaves.map((l) => l.agentId));
                const isToday = cell.iso === todayIso;

                return (
                  <div
                    key={cell.iso}
                    onClick={() => onScheduleShiftForDate(cell.iso)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onScheduleShiftForDate(cell.iso);
                      }
                    }}
                    title={`Cliquer pour ajouter un créneau d'astreinte le ${cell.iso}`}
                    className={`min-h-[118px] p-2 flex flex-col justify-between gap-1.5 transition-colors cursor-pointer group ${
                      !cell.inMonth
                        ? 'bg-slate-50/60 dark:bg-slate-950/50 text-slate-400 dark:text-slate-600'
                        : isToday
                        ? 'bg-blue-50/40 dark:bg-blue-950/15 hover:bg-blue-50/70 dark:hover:bg-blue-950/25'
                        : 'bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 text-xs font-mono tabular-nums font-semibold rounded-md ${
                          isToday
                            ? 'bg-blue-600 text-white'
                            : cell.inMonth
                            ? 'text-slate-900 dark:text-slate-100'
                            : 'text-slate-400 dark:text-slate-600'
                        }`}
                      >
                        {cell.dayNumber}
                      </span>

                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 opacity-0 group-hover:opacity-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-opacity">
                        <Plus className="w-3 h-3" />
                        <span className="hidden sm:inline">Astreinte</span>
                      </span>
                    </div>

                    <div className="space-y-1 flex-1">
                      {dayShifts.slice(0, 3).map((shift) => {
                        const stStyle = SHIFT_STATUS_STYLES[shift.status] || SHIFT_STATUS_STYLES.scheduled;
                        const hasConflict = absentIds.has(shift.agentId);
                        return (
                          <button
                            key={shift.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFocusedShiftId(focusedShiftId === shift.id ? null : shift.id);
                            }}
                            title={`${shift.agentName} · ${shift.specialty} · ${shift.timeWindow}`}
                            className={`w-full px-1.5 py-1 rounded-md border text-left flex items-center justify-between gap-1 transition-colors cursor-pointer ${
                              stStyle.card
                            } ${focusedShiftId === shift.id ? 'ring-1 ring-blue-500' : ''}`}
                          >
                            <span className={`text-[10px] font-semibold truncate ${stStyle.text}`}>
                              {shift.agentName.split(' ')[0]} · {shift.timeWindow.split(' ')[0]}
                            </span>
                            {hasConflict && (
                              <AlertTriangle className="w-3 h-3 text-rose-600 shrink-0" />
                            )}
                          </button>
                        );
                      })}

                      {dayShifts.length > 3 && (
                        <p className="text-[10px] font-medium text-slate-500 dark:text-slate-400 px-1">
                          +{dayShifts.length - 3} autre(s)
                        </p>
                      )}
                    </div>

                    {dayLeaves.length > 0 && cell.inMonth && (
                      <div className="text-[10px] text-amber-700 dark:text-amber-400 truncate pt-0.5 border-t border-slate-100 dark:border-slate-800/70">
                        {absentIds.size} absent(s)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Calendar Legend */}
        <div className="px-4 py-3 bg-slate-50/70 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-600 dark:text-slate-300">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {(Object.keys(SHIFT_STATUS_LABELS) as OnCallStatus[]).map((statusKey) => (
              <span key={statusKey} className="inline-flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-xs ${SHIFT_STATUS_STYLES[statusKey].dot}`} />
                <span>{SHIFT_STATUS_LABELS[statusKey]}</span>
              </span>
            ))}
          </div>
          {undatedShifts.length > 0 && (
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {undatedShifts.length} créneau(x) sans date ISO affiché(s) dans la liste
            </span>
          )}
        </div>
      </div>

      {/* Focused Shift Quick Inspector (on click of an existing shift item) */}
      {focusedShift && (
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {focusedShift.agentName}
              </span>
              <span className="text-slate-400" aria-hidden="true">·</span>
              <span className="text-slate-600 dark:text-slate-300">{focusedShift.specialty}</span>
              <span className="text-slate-400" aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-700 dark:text-slate-200">
                {focusedShift.shiftDate || focusedShift.dayLabel} ({focusedShift.timeWindow})
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                <PhoneCall className="w-3 h-3" />
                {focusedShift.escalationPhone}
              </span>
              {focusedShift.notes && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{focusedShift.notes}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onOpenReportForShift && (
              <button
                type="button"
                onClick={() => onOpenReportForShift(focusedShift)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span>Rédiger un rapport</span>
              </button>
            )}

            <select
              value={focusedShift.status}
              onChange={(e) => onUpdateShiftStatus(focusedShift, e.target.value as OnCallStatus)}
              aria-label="Modifier le statut du créneau sélectionné"
              className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
            >
              {(Object.keys(SHIFT_STATUS_LABELS) as OnCallStatus[]).map((st) => (
                <option key={st} value={st}>
                  {SHIFT_STATUS_LABELS[st]}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => {
                onDeleteShift(focusedShift);
                setFocusedShiftId(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Supprimer</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
