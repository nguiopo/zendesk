import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  Clock,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AgentLeave,
  AppLocale,
  CallLog,
  OnCallShift,
  SlaPolicy,
  SupportAgent,
  Ticket,
  WfmShift,
} from '../types/helpdesk';
import { computeSlaForecast, SlaForecastDayPoint } from '../lib/slaForecast';

interface SlaForecastCardProps {
  tickets: Ticket[];
  agents: SupportAgent[];
  wfmShifts: WfmShift[];
  leaves?: AgentLeave[];
  onCallShifts?: OnCallShift[];
  slaPolicies?: SlaPolicy[];
  callLogs?: CallLog[];
  locale?: AppLocale;
  onOpenWfmTab?: () => void;
}

const FORECAST_COPY: Record<
  AppLocale,
  {
    title: string;
    subtitle: string;
    horizon5: string;
    horizon7: string;
    statusCriticalSuffix: string;
    statusWarningSuffix: string;
    statusNominal: string;
    metricTrendLabel: string;
    metricTrendAvg: string;
    metricPeakLabel: string;
    metricRiskLabel: string;
    legendHistorical: string;
    legendProjected: string;
    legendCapacity: string;
    todayMarker: string;
    atRiskHeading: string;
    noRiskBanner: string;
    overflowLabel: string;
    riskPctLabel: string;
    capacityShort: string;
    forecastShort: string;
    agentsActiveShort: string;
    recommendationLabel: string;
    adjustWfmBtn: string;
    tooltipObserved: string;
    tooltipProjected: string;
    tooltipCapacity: string;
    tooltipLoad: string;
    tooltipSlaRisk: string;
    tooltipAgents: string;
    tooltipLeaves: string;
  }
> = {
  fr: {
    title: 'Prévision SLA — Analyse de tendance & Risque de débordement',
    subtitle:
      'Projection du volume de tickets (régression sur 7 jours) comparée à la capacité agents planifiée (shifts WFM, astreintes & congés).',
    horizon5: '5 jours',
    horizon7: '7 jours',
    statusCriticalSuffix: 'période(s) en débordement SLA critique',
    statusWarningSuffix: 'période(s) sous tension SLA',
    statusNominal: 'Capacité nominale sur la fenêtre',
    metricTrendLabel: 'Tendance volume passé (7 j)',
    metricTrendAvg: 'Moy. observée :',
    metricPeakLabel: 'Pic de charge prévu',
    metricRiskLabel: 'Périodes à risque SLA',
    legendHistorical: 'Volume passé (7 j)',
    legendProjected: 'Volume prévu',
    legendCapacity: 'Capacité agents prévue',
    todayMarker: 'Auj.',
    atRiskHeading: 'Périodes à risque de débordement SLA détectées',
    noRiskBanner:
      'Aucun risque de débordement SLA détecté : la capacité planifiée couvre la tendance de volume prévue.',
    overflowLabel: 'Débordement',
    riskPctLabel: 'Risque SLA',
    capacityShort: 'cap.',
    forecastShort: 'prév.',
    agentsActiveShort: 'agents',
    recommendationLabel: 'Action recommandée :',
    adjustWfmBtn: 'Ajuster planning WFM',
    tooltipObserved: 'Volume observé',
    tooltipProjected: 'Volume prévu',
    tooltipCapacity: 'Capacité agents',
    tooltipLoad: 'Charge prévue',
    tooltipSlaRisk: 'Risque débordement SLA',
    tooltipAgents: 'Agents actifs prévus',
    tooltipLeaves: 'En congé',
  },
  en: {
    title: 'SLA Forecast — Trend Analysis & Overflow Risk',
    subtitle:
      'Ticket volume projection (7-day trend regression) compared against planned agent capacity (WFM shifts, on-call & leaves).',
    horizon5: '5 days',
    horizon7: '7 days',
    statusCriticalSuffix: 'critical SLA overflow period(s)',
    statusWarningSuffix: 'high-tension SLA period(s)',
    statusNominal: 'Nominal capacity across horizon',
    metricTrendLabel: 'Past volume trend (7d)',
    metricTrendAvg: 'Observed avg:',
    metricPeakLabel: 'Projected peak load',
    metricRiskLabel: 'SLA at-risk periods',
    legendHistorical: 'Past volume (7d)',
    legendProjected: 'Projected volume',
    legendCapacity: 'Planned agent capacity',
    todayMarker: 'Today',
    atRiskHeading: 'Detected SLA overflow risk periods',
    noRiskBanner:
      'No SLA overflow risk detected: planned capacity absorbs the projected ticket volume trend.',
    overflowLabel: 'Overflow',
    riskPctLabel: 'SLA Risk',
    capacityShort: 'cap.',
    forecastShort: 'fcst.',
    agentsActiveShort: 'agents',
    recommendationLabel: 'Recommended action:',
    adjustWfmBtn: 'Adjust WFM schedule',
    tooltipObserved: 'Observed volume',
    tooltipProjected: 'Projected volume',
    tooltipCapacity: 'Agent capacity',
    tooltipLoad: 'Projected load',
    tooltipSlaRisk: 'SLA overflow risk',
    tooltipAgents: 'Planned active agents',
    tooltipLeaves: 'On leave',
  },
  es: {
    title: 'Previsión SLA — Tendencia y Riesgo de Desbordamiento',
    subtitle:
      'Proyección de volumen de tickets (regresión de 7 días) frente a la capacidad planificada de agentes (turnos WFM, guardias y ausencias).',
    horizon5: '5 días',
    horizon7: '7 días',
    statusCriticalSuffix: 'período(s) de desbordamiento SLA crítico',
    statusWarningSuffix: 'período(s) bajo tensión SLA',
    statusNominal: 'Capacidad nominal en el horizonte',
    metricTrendLabel: 'Tendencia volumen pasado (7 d)',
    metricTrendAvg: 'Prom. observado:',
    metricPeakLabel: 'Pico de carga previsto',
    metricRiskLabel: 'Períodos con riesgo SLA',
    legendHistorical: 'Volumen pasado (7 d)',
    legendProjected: 'Volumen previsto',
    legendCapacity: 'Capacidad agentes prevista',
    todayMarker: 'Hoy',
    atRiskHeading: 'Períodos con riesgo de desbordamiento SLA',
    noRiskBanner:
      'Sin riesgo de desbordamiento SLA: la capacidad planificada cubre la tendencia de volumen prevista.',
    overflowLabel: 'Exceso',
    riskPctLabel: 'Riesgo SLA',
    capacityShort: 'cap.',
    forecastShort: 'prev.',
    agentsActiveShort: 'agentes',
    recommendationLabel: 'Acción recomendada:',
    adjustWfmBtn: 'Ajustar turnos WFM',
    tooltipObserved: 'Volumen observado',
    tooltipProjected: 'Volumen previsto',
    tooltipCapacity: 'Capacidad agentes',
    tooltipLoad: 'Carga prevista',
    tooltipSlaRisk: 'Riesgo desbordamiento SLA',
    tooltipAgents: 'Agentes activos previstos',
    tooltipLeaves: 'De baja / vacaciones',
  },
};

export const SlaForecastCard: React.FC<SlaForecastCardProps> = ({
  tickets,
  agents,
  wfmShifts,
  leaves = [],
  onCallShifts = [],
  slaPolicies = [],
  callLogs = [],
  locale = 'fr',
  onOpenWfmTab,
}) => {
  const [horizonDays, setHorizonDays] = useState<5 | 7>(7);
  const [focusedIsoDate, setFocusedIsoDate] = useState<string | null>(null);
  const copy = FORECAST_COPY[locale];

  const report = useMemo(
    () =>
      computeSlaForecast({
        tickets,
        agents,
        wfmShifts,
        leaves,
        onCallShifts,
        slaPolicies,
        callLogs,
        horizonDays,
        locale,
      }),
    [tickets, agents, wfmShifts, leaves, onCallShifts, slaPolicies, callLogs, horizonDays, locale]
  );

  const todayPointLabel = useMemo(
    () => report.timeline.find((p) => p.kind === 'historical' && p.projectedVolume !== null)?.shortLabel || copy.todayMarker,
    [report.timeline, copy.todayMarker]
  );

  const statusText =
    report.criticalPeriodsCount > 0
      ? `${report.criticalPeriodsCount} ${copy.statusCriticalSuffix}`
      : report.warningPeriodsCount > 0
      ? `${report.warningPeriodsCount} ${copy.statusWarningSuffix}`
      : copy.statusNominal;

  const focusedPoint: SlaForecastDayPoint | null = useMemo(() => {
    if (!focusedIsoDate) return null;
    return report.atRiskPeriods.find((p) => p.isoDate === focusedIsoDate) || null;
  }, [focusedIsoDate, report.atRiskPeriods]);

  return (
    <section
      aria-label={copy.title}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 space-y-4"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {report.overallRiskLevel === 'critical' ? (
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
            ) : report.overallRiskLevel === 'warning' ? (
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            )}
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              {copy.title}
            </h3>
            <span
              className={`font-mono tabular-nums text-xs font-semibold ${
                report.overallRiskLevel === 'critical'
                  ? 'text-red-700 dark:text-red-400'
                  : report.overallRiskLevel === 'warning'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              · {statusText}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{copy.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Horizon de prévision SLA"
            className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
          >
            {([5, 7] as const).map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={horizonDays === days}
                onClick={() => setHorizonDays(days)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                  horizonDays === days
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {days === 5 ? copy.horizon5 : copy.horizon7}
              </button>
            ))}
          </div>

          {onOpenWfmTab && report.atRiskPeriods.length > 0 && (
            <button
              type="button"
              onClick={onOpenWfmTab}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <CalendarRange className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>{copy.adjustWfmBtn}</span>
            </button>
          )}
        </div>
      </div>

      {/* 3-Column Trend & Risk Telemetry Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-1">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-medium">{copy.metricTrendLabel}</span>
            {report.trendDirection === 'rising' ? (
              <TrendingUp className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            ) : report.trendDirection === 'falling' ? (
              <TrendingDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <Minus className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            )}
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-lg font-bold ${
                report.trendDirection === 'rising'
                  ? 'text-amber-700 dark:text-amber-400'
                  : report.trendDirection === 'falling'
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {report.trendDeltaPct >= 0 ? `+${report.trendDeltaPct}%` : `${report.trendDeltaPct}%`}
            </span>
            <span className="text-[11px] text-slate-600 dark:text-slate-300">
              ({report.trendSlopePerDay >= 0 ? `+${report.trendSlopePerDay}` : report.trendSlopePerDay} tk/j)
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {copy.metricTrendAvg} {report.historicalAvgDailyVolume} tk/j · {copy.capacityShort} moy.{' '}
            {report.avgPlannedDailyCapacity} tk/j
          </p>
        </div>

        <div className="p-3 rounded-lg bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-1">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-medium">{copy.metricPeakLabel}</span>
            <AlertTriangle
              className={`w-3.5 h-3.5 shrink-0 ${
                report.peakForecastPoint?.riskLevel === 'critical'
                  ? 'text-red-600 dark:text-red-400'
                  : report.peakForecastPoint?.riskLevel === 'warning'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            />
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-lg font-bold ${
                report.peakForecastPoint?.riskLevel === 'critical'
                  ? 'text-red-700 dark:text-red-400'
                  : report.peakForecastPoint?.riskLevel === 'warning'
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {report.peakForecastPoint ? `${report.peakForecastPoint.utilizationPct}%` : '—'}
            </span>
            <span className="text-[11px] font-sans font-semibold text-slate-800 dark:text-slate-200 truncate">
              {report.peakForecastPoint?.dayName || '—'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            {report.peakForecastPoint
              ? `${copy.forecastShort} ${report.peakForecastPoint.projectedVolume} / ${copy.capacityShort} ${report.peakForecastPoint.plannedCapacity} (${report.peakForecastPoint.activeAgentsPlanned} ${copy.agentsActiveShort})`
              : '—'}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-1">
          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-medium">{copy.metricRiskLabel}</span>
            <Clock className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span
              className={`text-lg font-bold ${
                report.criticalPeriodsCount > 0
                  ? 'text-red-700 dark:text-red-400'
                  : report.warningPeriodsCount > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {report.atRiskPeriods.length} / {horizonDays} j
            </span>
            <span className="text-[11px] text-slate-600 dark:text-slate-300">
              {report.criticalPeriodsCount} crit. · {report.warningPeriodsCount} vig.
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
            {report.peakForecastPoint
              ? `${copy.riskPctLabel} max : ${report.peakForecastPoint.slaBreachRiskPct}%`
              : '0%'}
          </p>
        </div>
      </div>

      {/* Trend & Capacity Forecast Chart */}
      <div className="p-3.5 rounded-lg bg-slate-50/70 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-slate-500 inline-block" aria-hidden="true" />
              <span>{copy.legendHistorical}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-3 border-t-2 border-dashed border-blue-600 inline-block"
                aria-hidden="true"
              />
              <span>{copy.legendProjected}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-emerald-600 inline-block" aria-hidden="true" />
              <span>{copy.legendCapacity}</span>
            </span>
          </div>
          {focusedPoint && (
            <span className="font-mono tabular-nums text-[11px] font-semibold text-blue-700 dark:text-blue-400">
              {focusedPoint.dayName} · {focusedPoint.utilizationPct}% ({focusedPoint.driverSummary})
            </span>
          )}
        </div>

        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={report.timeline} margin={{ top: 10, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="slaCapFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.22} vertical={false} />
              <XAxis
                dataKey="shortLabel"
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <ReferenceLine
                x={todayPointLabel}
                stroke="#64748b"
                strokeDasharray="4 4"
                label={{
                  value: copy.todayMarker,
                  position: 'top',
                  fill: '#64748b',
                  fontSize: 10,
                }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || payload.length === 0) return null;
                  const pt = payload[0]?.payload as SlaForecastDayPoint | undefined;
                  if (!pt) return null;
                  const vol = pt.kind === 'historical' ? pt.historicalVolume : pt.projectedVolume;
                  const volLabel = pt.kind === 'historical' ? copy.tooltipObserved : copy.tooltipProjected;
                  return (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 shadow-md text-xs text-slate-800 dark:text-slate-100 space-y-1 min-w-[200px]">
                      <div className="flex items-center justify-between gap-2 font-semibold border-b border-slate-100 dark:border-slate-800 pb-1">
                        <span>{pt.dayName}</span>
                        <span className="font-mono text-[10px] text-slate-400">{pt.isoDate}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 font-mono tabular-nums">
                        <span className="font-sans text-slate-500 dark:text-slate-400">{volLabel}</span>
                        <span className="font-bold">{vol ?? 0} tk</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 font-mono tabular-nums">
                        <span className="font-sans text-slate-500 dark:text-slate-400">{copy.tooltipCapacity}</span>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                          {pt.plannedCapacity} tk
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 font-mono tabular-nums">
                        <span className="font-sans text-slate-500 dark:text-slate-400">{copy.tooltipLoad}</span>
                        <span
                          className={`font-semibold ${
                            pt.riskLevel === 'critical'
                              ? 'text-red-600 dark:text-red-400'
                              : pt.riskLevel === 'warning'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {pt.utilizationPct}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 font-mono tabular-nums">
                        <span className="font-sans text-slate-500 dark:text-slate-400">{copy.tooltipSlaRisk}</span>
                        <span className="font-semibold">{pt.slaBreachRiskPct}%</span>
                      </div>
                      <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                        {copy.tooltipAgents} : {pt.activeAgentsPlanned}
                        {pt.onLeaveCount > 0 ? ` · ${copy.tooltipLeaves} : ${pt.onLeaveCount}` : ''}
                      </div>
                    </div>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="plannedCapacity"
                name={copy.legendCapacity}
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#slaCapFill)"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="historicalVolume"
                name={copy.legendHistorical}
                stroke="#475569"
                strokeWidth={2.25}
                dot={{ r: 3, fill: '#475569', strokeWidth: 0 }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="projectedVolume"
                name={copy.legendProjected}
                stroke="#2563eb"
                strokeWidth={2.5}
                strokeDasharray="5 4"
                connectNulls={false}
                dot={(dotProps) => {
                  const { cx, cy, payload } = dotProps as {
                    cx?: number;
                    cy?: number;
                    payload?: SlaForecastDayPoint;
                  };
                  if (typeof cx !== 'number' || typeof cy !== 'number' || !payload || payload.projectedVolume === null) {
                    return <g key={`empty-${payload?.isoDate || Math.random()}`} />;
                  }
                  const fill =
                    payload.riskLevel === 'critical'
                      ? '#dc2626'
                      : payload.riskLevel === 'warning'
                      ? '#d97706'
                      : '#2563eb';
                  const r = payload.riskLevel === 'nominal' ? 3.5 : 5;
                  return (
                    <circle
                      key={`dot-${payload.isoDate}`}
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={fill}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                    />
                  );
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* At-Risk Overflow Periods List */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {copy.atRiskHeading} ({report.atRiskPeriods.length})
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {copy.recommendationLabel} {report.recommendedActions[0]}
          </span>
        </div>

        {report.atRiskPeriods.length === 0 ? (
          <div className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/60 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{copy.noRiskBanner}</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {report.atRiskPeriods.map((period) => {
              const isCritical = period.riskLevel === 'critical';
              const isFocused = focusedIsoDate === period.isoDate;
              return (
                <button
                  key={period.isoDate}
                  type="button"
                  onClick={() =>
                    setFocusedIsoDate((prev) => (prev === period.isoDate ? null : period.isoDate))
                  }
                  className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer space-y-1.5 ${
                    isCritical
                      ? 'bg-red-50/70 dark:bg-red-950/25 border-red-200/90 dark:border-red-900/70 hover:bg-red-50 dark:hover:bg-red-950/40'
                      : 'bg-amber-50/70 dark:bg-amber-950/25 border-amber-200/90 dark:border-amber-900/70 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                  } ${isFocused ? 'ring-1 ring-blue-500' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100 min-w-0">
                      {isCritical ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      )}
                      <span className="truncate">{period.dayName}</span>
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                        · {period.isoDate}
                      </span>
                    </span>
                    <span
                      className={`font-mono tabular-nums text-[11px] font-bold whitespace-nowrap shrink-0 ${
                        isCritical
                          ? 'text-red-700 dark:text-red-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {copy.riskPctLabel} {period.slaBreachRiskPct}%
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-slate-700 dark:text-slate-300">
                      {period.driverSummary}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400 shrink-0">
                      <strong className="text-slate-900 dark:text-slate-100">
                        {period.projectedVolume}
                      </strong>{' '}
                      {copy.forecastShort} / {period.plannedCapacity} {copy.capacityShort} ({period.utilizationPct}%)
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
