import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  PhoneCall,
  Plus,
  Radio,
  Shield,
  UserCheck,
} from 'lucide-react';
import {
  AgentAvailability,
  AgentLeave,
  OnCallShift,
  OnCallStatus,
  SupportAgent,
} from '../types/helpdesk';
import { AGENT_AVAILABILITY_LABELS } from '../lib/formatters';

interface OnCallShiftQuickViewCardProps {
  agents: SupportAgent[];
  shifts: OnCallShift[];
  leaves: AgentLeave[];
  onOpenReportForShift: (shift: OnCallShift) => void;
  onUpdateShiftStatus: (shift: OnCallShift, nextStatus: OnCallStatus) => void;
  onScheduleShift: () => void;
}

type QuickViewFilter = 'all' | 'active' | 'upcoming';

interface ShiftProgressMetrics {
  progressPct: number;
  timingLabel: string;
  barColorClass: string;
  phaseLabel: string;
}

function parseTimeWindowMinutes(timeWindow: string): { startMin: number; endMin: number } {
  const matches = timeWindow.match(/(\d{1,2}):(\d{2})/g);
  if (!matches || matches.length < 2) {
    return { startMin: 8 * 60, endMin: 20 * 60 };
  }
  const [sh, sm] = matches[0].split(':').map(Number);
  const [eh, em] = matches[1].split(':').map(Number);
  const startMin = Math.min(23 * 60 + 59, Math.max(0, (sh || 0) * 60 + (sm || 0)));
  const endMin = Math.min(23 * 60 + 59, Math.max(0, (eh || 0) * 60 + (em || 0)));
  return { startMin, endMin };
}

function parseShiftBoundsMs(shift: OnCallShift, nowMs: number): { startMs: number; endMs: number } {
  const { startMin, endMin } = parseTimeWindowMinutes(shift.timeWindow || '08:00 — 20:00');
  const baseDate = shift.shiftDate && /^\d{4}-\d{2}-\d{2}$/.test(shift.shiftDate)
    ? (() => {
        const [y, m, d] = shift.shiftDate.split('-').map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
      })()
    : (() => {
        const now = new Date(nowMs);
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      })();

  const startMs = baseDate.getTime() + startMin * 60_000;
  const crossesMidnight = endMin <= startMin;
  const endMs = baseDate.getTime() + (endMin + (crossesMidnight ? 24 * 60 : 0)) * 60_000;
  return { startMs, endMs };
}

function formatDurationCompact(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;
  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`;
  return `${mins} min`;
}

function computeShiftMetrics(shift: OnCallShift, nowMs: number): ShiftProgressMetrics {
  const { startMs, endMs } = parseShiftBoundsMs(shift, nowMs);
  const totalDurationMs = Math.max(60_000, endMs - startMs);

  if (shift.status === 'active') {
    if (nowMs >= startMs && nowMs <= endMs) {
      const pct = Math.min(100, Math.max(4, Math.round(((nowMs - startMs) / totalDurationMs) * 100)));
      const remaining = formatDurationCompact(endMs - nowMs);
      return {
        progressPct: pct,
        timingLabel: `${pct}% écoulé · ${remaining} rest.`,
        barColorClass: 'bg-emerald-600 dark:bg-emerald-500',
        phaseLabel: 'Astreinte active',
      };
    }

    // Fallback when active shift date/window falls outside current hour (e.g. shifted local clock)
    const nowDate = new Date(nowMs);
    const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes();
    const { startMin, endMin } = parseTimeWindowMinutes(shift.timeWindow || '08:00 — 20:00');
    const spanMin = endMin > startMin ? endMin - startMin : 24 * 60 - startMin + endMin;
    const elapsedMin =
      nowMinutes >= startMin
        ? nowMinutes - startMin
        : endMin <= startMin
        ? 24 * 60 - startMin + nowMinutes
        : 0;
    const pct = Math.min(100, Math.max(8, Math.round((elapsedMin / Math.max(60, spanMin)) * 100)));
    return {
      progressPct: pct,
      timingLabel: `${pct}% du créneau (${shift.timeWindow})`,
      barColorClass: 'bg-emerald-600 dark:bg-emerald-500',
      phaseLabel: 'Astreinte active',
    };
  }

  if (shift.status === 'completed') {
    return {
      progressPct: 100,
      timingLabel: '100% · Créneau clôturé',
      barColorClass: 'bg-slate-400 dark:bg-slate-600',
      phaseLabel: 'Terminée',
    };
  }

  // Upcoming rotation ('scheduled' or 'standby')
  const msUntilStart = startMs - nowMs;
  if (msUntilStart <= 0) {
    return {
      progressPct: shift.status === 'standby' ? 75 : 95,
      timingLabel: shift.status === 'standby' ? 'Réserve prête · Prise de relais immédiate' : 'Relève imminente',
      barColorClass: shift.status === 'standby' ? 'bg-amber-500' : 'bg-blue-600 dark:bg-blue-500',
      phaseLabel: shift.status === 'standby' ? 'Réserve' : 'Rotation à venir',
    };
  }

  // Proximity fill over a 72-hour lookahead window (closer shift => higher bar fill)
  const lookaheadMs = 72 * 3600_000;
  const proximityPct = Math.min(96, Math.max(12, Math.round((1 - Math.min(msUntilStart, lookaheadMs) / lookaheadMs) * 100)));
  return {
    progressPct: proximityPct,
    timingLabel: `Dans ${formatDurationCompact(msUntilStart)} · ${shift.dayLabel}`,
    barColorClass: shift.status === 'standby' ? 'bg-amber-500' : 'bg-blue-600 dark:bg-blue-500',
    phaseLabel: shift.status === 'standby' ? 'Réserve' : 'Rotation à venir',
  };
}

function getAgentStatusMeta(availability?: AgentAvailability) {
  switch (availability) {
    case 'on_call':
      return {
        label: AGENT_AVAILABILITY_LABELS.on_call,
        textClass: 'text-emerald-700 dark:text-emerald-400',
        Icon: Radio,
      };
    case 'available':
      return {
        label: AGENT_AVAILABILITY_LABELS.available,
        textClass: 'text-blue-700 dark:text-blue-400',
        Icon: CheckCircle2,
      };
    case 'in_call':
      return {
        label: AGENT_AVAILABILITY_LABELS.in_call,
        textClass: 'text-amber-700 dark:text-amber-400',
        Icon: PhoneCall,
      };
    case 'busy':
      return {
        label: AGENT_AVAILABILITY_LABELS.busy,
        textClass: 'text-amber-700 dark:text-amber-400',
        Icon: Clock,
      };
    case 'off_duty':
    default:
      return {
        label: availability ? AGENT_AVAILABILITY_LABELS[availability] : 'Inconnu',
        textClass: 'text-slate-500 dark:text-slate-400',
        Icon: AlertCircle,
      };
  }
}

export const OnCallShiftQuickViewCard: React.FC<OnCallShiftQuickViewCardProps> = ({
  agents,
  shifts,
  leaves,
  onOpenReportForShift,
  onUpdateShiftStatus,
  onScheduleShift,
}) => {
  const [filter, setFilter] = useState<QuickViewFilter>('all');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const agentById = useMemo(() => {
    const map = new Map<string, SupportAgent>();
    agents.forEach((a) => map.set(a.id, a));
    return map;
  }, [agents]);

  const orderedShifts = useMemo(() => {
    const statusWeight: Record<OnCallStatus, number> = {
      active: 0,
      scheduled: 1,
      standby: 2,
      completed: 3,
    };

    const sorted = [...shifts].sort((a, b) => {
      const wa = statusWeight[a.status] ?? 9;
      const wb = statusWeight[b.status] ?? 9;
      if (wa !== wb) return wa - wb;
      const da = a.shiftDate || '9999-99-99';
      const db = b.shiftDate || '9999-99-99';
      if (da !== db) return da.localeCompare(db);
      return (a.timeWindow || '').localeCompare(b.timeWindow || '');
    });

    const active = sorted.filter((s) => s.status === 'active');
    const upcoming = sorted.filter((s) => s.status === 'scheduled' || s.status === 'standby');

    return {
      all: sorted.filter((s) => s.status !== 'completed'),
      active,
      upcoming,
    };
  }, [shifts]);

  const displayedShifts = useMemo(() => {
    if (filter === 'active') return orderedShifts.active;
    if (filter === 'upcoming') return orderedShifts.upcoming;
    return orderedShifts.all;
  }, [filter, orderedShifts]);

  const summary = useMemo(() => {
    const activeCount = orderedShifts.active.length;
    const upcomingCount = orderedShifts.upcoming.length;
    const readyAgentsCount = agents.filter(
      (a) => a.availability === 'available' || a.availability === 'on_call'
    ).length;
    const verifiedUpcomingCount = orderedShifts.all.filter((s) => s.availabilityVerified).length;
    return {
      activeCount,
      upcomingCount,
      readyAgentsCount,
      verifiedUpcomingCount,
    };
  }, [agents, orderedShifts]);

  return (
    <section
      aria-labelledby="shift-quick-view-heading"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 space-y-4"
    >
      {/* Card Header + Interactive Segmented Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
            <CalendarClock className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id="shift-quick-view-heading"
                className="font-display text-sm font-bold text-slate-900 dark:text-slate-100"
              >
                Shift Quick View
              </h3>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Astreintes actives &amp; rotations à venir
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              <span>
                Actives :{' '}
                <strong className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {summary.activeCount}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Rotations à venir :{' '}
                <strong className="font-mono tabular-nums text-blue-700 dark:text-blue-400">
                  {summary.upcomingCount}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Agents disponibles :{' '}
                <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {summary.readyAgentsCount}/{agents.length}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Couverture vérifiée :{' '}
                <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {summary.verifiedUpcomingCount}/{orderedShifts.all.length}
                </strong>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg shrink-0">
          {(
            [
              ['all', `Toutes (${orderedShifts.all.length})`],
              ['active', `Actives (${orderedShifts.active.length})`],
              ['upcoming', `À venir (${orderedShifts.upcoming.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === key
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Shifts Progress & Agent Status List */}
      {displayedShifts.length === 0 ? (
        <div className="py-6 px-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {filter === 'active'
                ? 'Aucune astreinte active pour le moment'
                : filter === 'upcoming'
                ? 'Aucune rotation à venir planifiée'
                : 'Aucune astreinte active ou planifiée'}
            </p>
            <p className="text-slate-500 dark:text-slate-400">
              Programmez un créneau d’astreinte pour assurer la continuité de support N1–N3.
            </p>
          </div>
          <button
            type="button"
            onClick={onScheduleShift}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Programmer une astreinte</span>
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          {displayedShifts.map((shift) => {
            const agent = agentById.get(shift.agentId);
            const statusMeta = getAgentStatusMeta(agent?.availability);
            const StatusIcon = statusMeta.Icon;
            const metrics = computeShiftMetrics(shift, nowMs);
            const loadPct = agent
              ? Math.round((agent.activeTickets / Math.max(1, agent.maxConcurrentTickets)) * 100)
              : 0;
            const hasLeaveConflict = Boolean(
              shift.shiftDate &&
                leaves.some(
                  (lv) =>
                    lv.agentId === shift.agentId &&
                    lv.startDate <= shift.shiftDate! &&
                    lv.endDate >= shift.shiftDate!
                )
            );

            return (
              <div
                key={shift.id}
                className="px-4 py-3.5 bg-white dark:bg-slate-900 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-colors grid grid-cols-1 lg:grid-cols-12 items-center gap-3.5"
              >
                {/* Zone 1: Agent & Status Indicator */}
                <div className="lg:col-span-4 flex items-center gap-3 min-w-0">
                  {agent?.avatarUrl ? (
                    <img
                      src={agent.avatarUrl}
                      alt={shift.agentName}
                      referrerPolicy="no-referrer"
                      className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0">
                      {shift.agentName
                        .split(' ')
                        .map((p) => p[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {shift.agentName}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                      <span
                        className={`inline-flex items-center gap-1 text-[11px] font-semibold ${statusMeta.textClass}`}
                      >
                        <StatusIcon className="w-3 h-3 shrink-0" />
                        <span>{statusMeta.label}</span>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1 truncate">
                        <Shield className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span>{shift.specialty}</span>
                      </span>
                      {agent && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            Charge {agent.activeTickets}/{agent.maxConcurrentTickets} ({loadPct}%)
                          </span>
                        </>
                      )}
                      {hasLeaveConflict && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-rose-600 dark:text-rose-400">
                            Conflit congé
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Zone 2: Shift Progress Bar & Rotation Timing */}
                <div className="lg:col-span-5 space-y-1.5 min-w-0">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span
                      className={`font-semibold ${
                        shift.status === 'active'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : shift.status === 'standby'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-blue-700 dark:text-blue-400'
                      }`}
                    >
                      {metrics.phaseLabel}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300 truncate">
                      {metrics.timingLabel}
                    </span>
                  </div>

                  <div
                    role="progressbar"
                    aria-valuenow={metrics.progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progression du tour de ${shift.agentName} : ${metrics.progressPct}%`}
                    className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden"
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${metrics.barColorClass}`}
                      style={{ width: `${metrics.progressPct}%` }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-mono tabular-nums">
                      {shift.shiftDate || shift.dayLabel} · {shift.timeWindow}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <PhoneCall className="w-3 h-3 text-slate-400" />
                      <span>{shift.escalationPhone}</span>
                    </span>
                  </div>
                </div>

                {/* Zone 3: Quick Operational Controls */}
                <div className="lg:col-span-3 flex items-center justify-start lg:justify-end gap-2 shrink-0">
                  {shift.status !== 'active' ? (
                    <button
                      type="button"
                      onClick={() => onUpdateShiftStatus(shift, 'active')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Activer</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onUpdateShiftStatus(shift, 'completed')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
                      <span>Clôturer</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onOpenReportForShift(shift)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <ClipboardList className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Rapport</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
