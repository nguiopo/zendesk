import React, { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Flame, ShieldCheck } from 'lucide-react';
import { AppLocale, SlaPolicy, SupportAgent, Ticket } from '../types/helpdesk';
import {
  DEFAULT_SLA_ALERT_THRESHOLD_PCT,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '../lib/formatters';
import {
  computeWeeklyHeatMap,
  HeatMapCell,
  HeatMapMetricMode,
  HeatMapPriorityScope,
} from '../lib/weeklyHeatMap';

interface WeeklyPerformanceHeatMapCardProps {
  tickets: Ticket[];
  slaPolicies?: SlaPolicy[];
  agents?: SupportAgent[];
  locale?: AppLocale;
  slaAlertThresholdPct?: number;
}

const HEATMAP_COPY: Record<
  AppLocale,
  {
    title: string;
    subtitle: string;
    modeCombined: string;
    modeVolume: string;
    modeBreach: string;
    scopeAll: string;
    scopeUrgent: string;
    scopeCritical: string;
    kpiTicketsMapped: string;
    kpiSlotsActiveSuffix: string;
    kpiBreachesAndRisk: string;
    kpiBreachedWord: string;
    kpiAtRiskWord: string;
    kpiPeakVolume: string;
    kpiPeakBreach: string;
    kpiNoBreach: string;
    dayHourCorner: string;
    totalColLabel: string;
    legendEmpty: string;
    legendLow: string;
    legendHigh: string;
    legendAtRisk: string;
    legendBreach: string;
    legendHealthy: string;
    inspectorTitle: string;
    inspectorVolume: string;
    inspectorBreached: string;
    inspectorAtRisk: string;
    inspectorEmptySlot: string;
    emptyStateTitle: string;
    emptyStateHint: string;
    ticketsWord: string;
  }
> = {
  fr: {
    title: 'Carte thermique de performance hebdomadaire',
    subtitle:
      'Distribution horaire du volume de tickets et de la densité de dépassements SLA sur les 7 jours de la semaine.',
    modeCombined: 'Combiné (Vol. + SLA)',
    modeVolume: 'Volume tickets',
    modeBreach: 'Densité SLA',
    scopeAll: 'Toutes priorités',
    scopeUrgent: 'Critique & Haute',
    scopeCritical: 'Critique (P1)',
    kpiTicketsMapped: 'Tickets cartographiés',
    kpiSlotsActiveSuffix: 'créneaux actifs / 168',
    kpiBreachesAndRisk: 'Dépassements & Vigilance SLA',
    kpiBreachedWord: 'hors délai',
    kpiAtRiskWord: 'alerte',
    kpiPeakVolume: 'Pic de volume horaire',
    kpiPeakBreach: 'Densité SLA maximale',
    kpiNoBreach: 'Aucun dépassement',
    dayHourCorner: 'Jour \\ Heure',
    totalColLabel: 'Total',
    legendEmpty: '0 ticket',
    legendLow: 'Volume faible',
    legendHigh: 'Pic volume',
    legendAtRisk: 'Alerte SLA',
    legendBreach: 'Dépassement SLA',
    legendHealthy: '0% hors délai',
    inspectorTitle: 'Détail du créneau',
    inspectorVolume: 'Volume',
    inspectorBreached: 'Hors délai SLA',
    inspectorAtRisk: 'Sous tension',
    inspectorEmptySlot: 'Aucun ticket enregistré sur ce créneau horaire.',
    emptyStateTitle: 'Aucun ticket pour cette sélection de priorité',
    emptyStateHint: 'Élargissez le filtre de priorité ou créez un ticket pour alimenter la carte thermique.',
    ticketsWord: 'tickets',
  },
  en: {
    title: 'Weekly Performance Heat Map',
    subtitle:
      'Hourly distribution of ticket volume and SLA breach density across each day of the week.',
    modeCombined: 'Combined (Vol + SLA)',
    modeVolume: 'Ticket volume',
    modeBreach: 'SLA breach density',
    scopeAll: 'All priorities',
    scopeUrgent: 'Critical & High',
    scopeCritical: 'Critical (P1)',
    kpiTicketsMapped: 'Mapped tickets',
    kpiSlotsActiveSuffix: 'active slots / 168',
    kpiBreachesAndRisk: 'SLA Breaches & Pressure',
    kpiBreachedWord: 'breached',
    kpiAtRiskWord: 'alert',
    kpiPeakVolume: 'Peak volume window',
    kpiPeakBreach: 'Highest SLA breach density',
    kpiNoBreach: 'No breaches',
    dayHourCorner: 'Day \\ Hour',
    totalColLabel: 'Total',
    legendEmpty: '0 tickets',
    legendLow: 'Low volume',
    legendHigh: 'Peak volume',
    legendAtRisk: 'SLA alert',
    legendBreach: 'SLA breach',
    legendHealthy: '0% breach',
    inspectorTitle: 'Slot breakdown',
    inspectorVolume: 'Volume',
    inspectorBreached: 'SLA breached',
    inspectorAtRisk: 'At risk',
    inspectorEmptySlot: 'No tickets recorded in this hourly window.',
    emptyStateTitle: 'No tickets match this priority filter',
    emptyStateHint: 'Broaden the priority scope or log a new ticket to populate the heat map.',
    ticketsWord: 'tickets',
  },
  es: {
    title: 'Mapa de Calor de Rendimiento Semanal',
    subtitle:
      'Distribución horaria del volumen de tickets y densidad de incumplimientos SLA por día de la semana.',
    modeCombined: 'Combinado (Vol + SLA)',
    modeVolume: 'Volumen tickets',
    modeBreach: 'Densidad SLA',
    scopeAll: 'Todas las prioridades',
    scopeUrgent: 'Crítica y Alta',
    scopeCritical: 'Crítica (P1)',
    kpiTicketsMapped: 'Tickets mapeados',
    kpiSlotsActiveSuffix: 'franjas activas / 168',
    kpiBreachesAndRisk: 'Incumplimientos y Riesgo SLA',
    kpiBreachedWord: 'vencidos',
    kpiAtRiskWord: 'alerta',
    kpiPeakVolume: 'Franja pico de volumen',
    kpiPeakBreach: 'Mayor densidad SLA',
    kpiNoBreach: 'Sin incumplimientos',
    dayHourCorner: 'Día \\ Hora',
    totalColLabel: 'Total',
    legendEmpty: '0 tickets',
    legendLow: 'Volumen bajo',
    legendHigh: 'Pico volumen',
    legendAtRisk: 'Alerta SLA',
    legendBreach: 'Incumplimiento SLA',
    legendHealthy: '0% vencidos',
    inspectorTitle: 'Detalle de franja',
    inspectorVolume: 'Volumen',
    inspectorBreached: 'SLA vencido',
    inspectorAtRisk: 'En riesgo',
    inspectorEmptySlot: 'No hay tickets registrados en esta franja horaria.',
    emptyStateTitle: 'Sin tickets para este filtro de prioridad',
    emptyStateHint: 'Amplía el filtro de prioridad para visualizar la distribución semanal.',
    ticketsWord: 'tickets',
  },
};

function getHeatMapCellClasses(
  cell: HeatMapCell,
  mode: HeatMapMetricMode,
  maxCellVolume: number
): string {
  if (cell.volume === 0) {
    return 'bg-slate-100/80 dark:bg-slate-800/45 text-transparent border border-slate-200/60 dark:border-slate-800/80 hover:bg-slate-200/70 dark:hover:bg-slate-800';
  }

  const volRatio = maxCellVolume > 0 ? cell.volume / maxCellVolume : 0;

  if (mode === 'breach') {
    if (cell.breachedCount > 0) {
      if (cell.breachDensityPct >= 60) {
        return 'bg-red-600 dark:bg-red-600 text-white border border-red-700 dark:border-red-500 font-semibold';
      }
      if (cell.breachDensityPct >= 30) {
        return 'bg-red-500/80 dark:bg-red-500/75 text-white border border-red-600/80 dark:border-red-400/70 font-semibold';
      }
      return 'bg-red-200 dark:bg-red-950/80 text-red-900 dark:text-red-200 border border-red-300 dark:border-red-800 font-semibold';
    }
    if (cell.atRiskCount > 0) {
      return 'bg-amber-200 dark:bg-amber-950/75 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 font-semibold';
    }
    return 'bg-emerald-100/90 dark:bg-emerald-950/55 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 font-medium';
  }

  if (mode === 'volume') {
    if (volRatio >= 0.75) {
      return 'bg-blue-700 dark:bg-blue-600 text-white border border-blue-800 dark:border-blue-500 font-semibold';
    }
    if (volRatio >= 0.5) {
      return 'bg-blue-500 dark:bg-blue-500/85 text-white border border-blue-600 dark:border-blue-400 font-semibold';
    }
    if (volRatio >= 0.25) {
      return 'bg-blue-200 dark:bg-blue-900/70 text-blue-900 dark:text-blue-100 border border-blue-300 dark:border-blue-800 font-medium';
    }
    return 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-900 font-medium';
  }

  // Combined mode: breaches dominate in crimson, at-risk pressure in amber, clean volume in blue
  if (cell.breachedCount > 0) {
    if (cell.breachDensityPct >= 50 || cell.breachedCount >= 2) {
      return 'bg-red-600 dark:bg-red-600 text-white border border-red-700 dark:border-red-500 font-semibold';
    }
    return 'bg-red-200 dark:bg-red-950/80 text-red-900 dark:text-red-200 border border-red-300 dark:border-red-800 font-semibold';
  }
  if (cell.atRiskCount > 0) {
    return 'bg-amber-200 dark:bg-amber-950/75 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 font-semibold';
  }
  if (volRatio >= 0.75) {
    return 'bg-blue-700 dark:bg-blue-600 text-white border border-blue-800 dark:border-blue-500 font-semibold';
  }
  if (volRatio >= 0.45) {
    return 'bg-blue-500 dark:bg-blue-500/85 text-white border border-blue-600 dark:border-blue-400 font-semibold';
  }
  return 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-900 font-medium';
}

export const WeeklyPerformanceHeatMapCard: React.FC<WeeklyPerformanceHeatMapCardProps> = ({
  tickets,
  slaPolicies = [],
  agents = [],
  locale = 'fr',
  slaAlertThresholdPct = DEFAULT_SLA_ALERT_THRESHOLD_PCT,
}) => {
  const copy = HEATMAP_COPY[locale] || HEATMAP_COPY.fr;
  const [metricMode, setMetricMode] = useState<HeatMapMetricMode>('combined');
  const [priorityScope, setPriorityScope] = useState<HeatMapPriorityScope>('all');
  const [selectedSlotKey, setSelectedSlotKey] = useState<string | null>(null);
  const [hoveredCell, setHoveredCell] = useState<HeatMapCell | null>(null);

  const report = useMemo(
    () =>
      computeWeeklyHeatMap({
        tickets,
        slaPolicies,
        agents,
        priorityScope,
        locale,
        slaAlertThresholdPct,
      }),
    [tickets, slaPolicies, agents, priorityScope, locale, slaAlertThresholdPct]
  );

  const selectedCell = useMemo(() => {
    if (hoveredCell) return hoveredCell;
    if (selectedSlotKey) {
      const [dStr, hStr] = selectedSlotKey.split('-');
      const dIdx = Number(dStr);
      const hIdx = Number(hStr);
      const match = report.rows[dIdx]?.cells[hIdx];
      if (match) return match;
    }
    return report.peakBreachCell || report.peakVolumeCell || null;
  }, [hoveredCell, selectedSlotKey, report]);

  return (
    <section
      aria-label={copy.title}
      className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4"
    >
      {/* Header & Controls */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {copy.title}
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{copy.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={priorityScope}
            onChange={(e) => setPriorityScope(e.target.value as HeatMapPriorityScope)}
            aria-label={copy.scopeAll}
            className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200"
          >
            <option value="all">{copy.scopeAll}</option>
            <option value="urgent">{copy.scopeUrgent}</option>
            <option value="critical">{copy.scopeCritical}</option>
          </select>

          <div
            role="group"
            aria-label={copy.title}
            className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
          >
            {(
              [
                ['combined', copy.modeCombined],
                ['volume', copy.modeVolume],
                ['breach', copy.modeBreach],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setMetricMode(mode)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  metricMode === mode
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4-Column Tabular Telemetry Strip (hairline dividers, no nested card boxes) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-3 border-y border-slate-200 dark:border-slate-800 py-3 sm:divide-x sm:divide-slate-200 dark:sm:divide-slate-800">
        <div className="sm:pr-4 space-y-0.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {copy.kpiTicketsMapped}
          </div>
          <div className="font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100">
            {report.totalTickets}
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {report.activeSlotsCount} {copy.kpiSlotsActiveSuffix}
          </div>
        </div>

        <div className="sm:px-4 space-y-0.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {copy.kpiBreachesAndRisk}
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-lg font-bold ${
                report.totalBreached > 0
                  ? 'text-red-700 dark:text-red-400'
                  : report.totalAtRisk > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {report.overallBreachRatePct}%
            </span>
            <span className="text-[11px] text-slate-600 dark:text-slate-300">
              {report.totalBreached} {copy.kpiBreachedWord}
            </span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {report.totalAtRisk} {copy.kpiAtRiskWord} ≥{slaAlertThresholdPct}%
          </div>
        </div>

        <div className="sm:px-4 space-y-0.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {copy.kpiPeakVolume}
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-bold text-blue-700 dark:text-blue-400">
              {report.peakVolumeCell ? report.peakVolumeCell.volume : 0}
            </span>
            <span className="text-xs font-sans font-semibold text-slate-800 dark:text-slate-200 truncate">
              {report.peakVolumeCell
                ? `${report.peakVolumeCell.dayShortLabel} · ${report.peakVolumeCell.hourLabel}`
                : '—'}
            </span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {report.peakVolumeCell ? report.peakVolumeCell.hourRangeLabel : '—'}
          </div>
        </div>

        <div className="sm:pl-4 space-y-0.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {copy.kpiPeakBreach}
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-lg font-bold ${
                report.peakBreachCell && report.peakBreachCell.breachedCount > 0
                  ? 'text-red-700 dark:text-red-400'
                  : report.peakBreachCell && report.peakBreachCell.atRiskCount > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {report.peakBreachCell
                ? report.peakBreachCell.breachedCount > 0
                  ? `${report.peakBreachCell.breachDensityPct}%`
                  : `${report.peakBreachCell.pressureDensityPct}%`
                : '0%'}
            </span>
            <span className="text-xs font-sans font-semibold text-slate-800 dark:text-slate-200 truncate">
              {report.peakBreachCell
                ? `${report.peakBreachCell.dayShortLabel} · ${report.peakBreachCell.hourLabel}`
                : copy.kpiNoBreach}
            </span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {report.peakBreachCell
              ? `${report.peakBreachCell.breachedCount} ${copy.kpiBreachedWord} · ${report.peakBreachCell.atRiskCount} ${copy.kpiAtRiskWord} ≥${slaAlertThresholdPct}%`
              : copy.legendHealthy}
          </div>
        </div>
      </div>

      {/* Heat Map 7 x 24 Grid */}
      {report.totalTickets === 0 ? (
        <div className="py-10 text-center space-y-1.5">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {copy.emptyStateTitle}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{copy.emptyStateHint}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto pb-1">
            <div className="min-w-[720px] space-y-1">
              {/* Hour Column Headers */}
              <div className="grid grid-cols-[56px_repeat(24,minmax(0,1fr))_52px] gap-1 items-center text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 pb-1">
                <span className="text-left font-sans font-medium truncate">{copy.dayHourCorner}</span>
                {Array.from({ length: 24 }, (_, hour) => (
                  <span key={hour} className="text-center">
                    {String(hour).padStart(2, '0')}
                  </span>
                ))}
                <span className="text-right font-sans font-medium">{copy.totalColLabel}</span>
              </div>

              {/* Day Rows */}
              {report.rows.map((row) => (
                <div
                  key={row.dayIndex}
                  className="grid grid-cols-[56px_repeat(24,minmax(0,1fr))_52px] gap-1 items-center"
                >
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 pr-1 truncate">
                    {row.dayShortLabel}
                  </div>

                  {row.cells.map((cell) => {
                    const slotKey = `${cell.dayIndex}-${cell.hour}`;
                    const isPinned = selectedSlotKey === slotKey;
                    const cellClasses = getHeatMapCellClasses(
                      cell,
                      metricMode,
                      report.maxCellVolume
                    );

                    const displayValue =
                      cell.volume === 0
                        ? ''
                        : metricMode === 'breach'
                        ? cell.breachedCount > 0
                          ? `${cell.breachDensityPct}%`
                          : cell.atRiskCount > 0
                          ? `!`
                          : '0'
                        : String(cell.volume);

                    return (
                      <button
                        key={slotKey}
                        type="button"
                        onMouseEnter={() => setHoveredCell(cell)}
                        onMouseLeave={() => setHoveredCell(null)}
                        onFocus={() => setHoveredCell(cell)}
                        onClick={() =>
                          setSelectedSlotKey((prev) => (prev === slotKey ? null : slotKey))
                        }
                        aria-label={`${cell.dayFullLabel} ${cell.hourRangeLabel}: ${cell.volume} ${copy.ticketsWord}, ${cell.breachedCount} ${copy.kpiBreachedWord}, ${cell.atRiskCount} ${copy.kpiAtRiskWord}`}
                        title={`${cell.dayFullLabel} (${cell.hourRangeLabel}) — ${cell.volume} ${copy.ticketsWord} · ${cell.breachedCount} ${copy.kpiBreachedWord} · ${cell.atRiskCount} ${copy.kpiAtRiskWord}`}
                        className={`relative h-7 rounded-sm text-[10px] font-mono tabular-nums flex items-center justify-center transition-transform duration-150 hover:scale-[1.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer ${cellClasses} ${
                          isPinned ? 'ring-2 ring-slate-900 dark:ring-white' : ''
                        }`}
                      >
                        <span>{displayValue}</span>
                        {metricMode === 'volume' && cell.breachedCount > 0 && (
                          <span
                            className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-xs bg-red-500"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    );
                  })}

                  <div className="text-right font-mono tabular-nums text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <span>{row.totalVolume}</span>
                    {row.totalBreached > 0 && (
                      <span className="text-red-600 dark:text-red-400 ml-0.5">
                        ({row.totalBreached})
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Color Scale Legend */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 inline-block" />
                <span>{copy.legendEmpty}</span>
              </span>
              {metricMode !== 'breach' ? (
                <>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-blue-100 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 inline-block" />
                    <span>{copy.legendLow}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-blue-700 dark:bg-blue-600 inline-block" />
                    <span>{copy.legendHigh}</span>
                  </span>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 inline-block" />
                  <span>{copy.legendHealthy}</span>
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-amber-200 dark:bg-amber-950/75 border border-amber-300 dark:border-amber-800 inline-block" />
                <span>
                  {copy.legendAtRisk} ≥{slaAlertThresholdPct}%
                </span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-xs bg-red-600 inline-block" />
                <span>{copy.legendBreach}</span>
              </span>
            </div>
          </div>

          {/* Selected / Hovered Slot Inspector Strip */}
          {selectedCell && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {copy.inspectorTitle} · {selectedCell.dayFullLabel} ({selectedCell.hourRangeLabel})
                </span>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">
                  |
                </span>
                <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {copy.inspectorVolume}: <strong>{selectedCell.volume}</strong>
                </span>
                <span aria-hidden="true" className="text-slate-400">
                  ·
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-mono tabular-nums ${
                    selectedCell.breachedCount > 0
                      ? 'text-red-700 dark:text-red-400 font-semibold'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {selectedCell.breachedCount > 0 ? (
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                  ) : (
                    <ShieldCheck className="w-3 h-3 shrink-0" />
                  )}
                  <span>
                    {copy.inspectorBreached}: {selectedCell.breachedCount} (
                    {selectedCell.breachDensityPct}%)
                  </span>
                </span>
                {selectedCell.atRiskCount > 0 && (
                  <>
                    <span aria-hidden="true" className="text-slate-400">
                      ·
                    </span>
                    <span className="font-mono tabular-nums text-amber-700 dark:text-amber-400 font-semibold">
                      {copy.inspectorAtRisk} (≥{slaAlertThresholdPct}%): {selectedCell.atRiskCount}
                    </span>
                  </>
                )}
              </div>

              {selectedCell.tickets.length === 0 ? (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  {copy.inspectorEmptySlot}
                </span>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  {selectedCell.tickets.slice(0, 4).map((tk, idx) => (
                    <React.Fragment key={tk.id}>
                      {idx > 0 && (
                        <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">
                          ·
                        </span>
                      )}
                      <span
                        className={
                          tk.isBreached
                            ? 'text-red-700 dark:text-red-400 font-semibold'
                            : tk.isAtRisk
                            ? 'text-amber-700 dark:text-amber-400 font-semibold'
                            : 'text-slate-800 dark:text-slate-200'
                        }
                        title={tk.subject}
                      >
                        {tk.reference} ({TICKET_PRIORITY_LABELS[tk.priority]} /{' '}
                        {TICKET_STATUS_LABELS[tk.status]})
                      </span>
                    </React.Fragment>
                  ))}
                  {selectedCell.tickets.length > 4 && (
                    <span className="text-slate-500 dark:text-slate-400">
                      +{selectedCell.tickets.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
