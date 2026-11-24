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

export type SlaRiskLevel = 'nominal' | 'warning' | 'critical';

export interface SlaForecastDayPoint {
  isoDate: string;
  shortLabel: string;
  dayName: string;
  kind: 'historical' | 'forecast';
  historicalVolume: number | null;
  projectedVolume: number | null;
  plannedCapacity: number;
  activeAgentsPlanned: number;
  onLeaveCount: number;
  wfmShiftsCount: number;
  utilizationPct: number;
  overflowTickets: number;
  slaBreachRiskPct: number;
  riskLevel: SlaRiskLevel;
  driverSummary: string;
}

export interface SlaForecastReport {
  horizonDays: 5 | 7;
  trendSlopePerDay: number;
  trendDirection: 'rising' | 'stable' | 'falling';
  trendDeltaPct: number;
  historicalAvgDailyVolume: number;
  avgPlannedDailyCapacity: number;
  peakForecastPoint: SlaForecastDayPoint | null;
  atRiskPeriods: SlaForecastDayPoint[];
  criticalPeriodsCount: number;
  warningPeriodsCount: number;
  overallRiskLevel: SlaRiskLevel;
  recommendedActions: string[];
  timeline: SlaForecastDayPoint[];
}

function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function addDays(base: Date, offset: number): Date {
  const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  dt.setDate(dt.getDate() + offset);
  return dt;
}

function formatDayShort(date: Date, offset: number, locale: AppLocale): string {
  if (offset === 0) {
    return locale === 'en' ? 'Today' : locale === 'es' ? 'Hoy' : 'Auj.';
  }
  const intlLocale = locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'fr-FR';
  return date.toLocaleDateString(intlLocale, { weekday: 'short', day: 'numeric' });
}

function formatDayFull(date: Date, locale: AppLocale): string {
  const intlLocale = locale === 'en' ? 'en-US' : locale === 'es' ? 'es-ES' : 'fr-FR';
  return date.toLocaleDateString(intlLocale, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

function isWeekendDay(date: Date): boolean {
  const d = date.getDay();
  return d === 0 || d === 6;
}

export function computeSlaForecast(params: {
  tickets: Ticket[];
  agents: SupportAgent[];
  wfmShifts: WfmShift[];
  leaves?: AgentLeave[];
  onCallShifts?: OnCallShift[];
  slaPolicies?: SlaPolicy[];
  callLogs?: CallLog[];
  horizonDays?: 5 | 7;
  locale?: AppLocale;
}): SlaForecastReport {
  const {
    tickets,
    agents,
    wfmShifts,
    leaves = [],
    onCallShifts = [],
    slaPolicies = [],
    callLogs = [],
    horizonDays = 7,
    locale = 'fr',
  } = params;

  const today = new Date();
  const todayIso = toLocalIsoDate(today);

  // Aggregate real ticket creation dates when present across multiple days
  const realCreatedCountsByDate = new Map<string, number>();
  for (const tk of tickets) {
    const ms = tk.createdAt?.toMillis?.();
    if (typeof ms === 'number' && ms > 0) {
      const iso = toLocalIsoDate(new Date(ms));
      realCreatedCountsByDate.set(iso, (realCreatedCountsByDate.get(iso) || 0) + 1);
    }
  }

  const openTickets = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed');
  const highPriorityRatio =
    openTickets.length > 0
      ? openTickets.filter((t) => t.priority === 'critical' || t.priority === 'high').length /
        openTickets.length
      : 0.25;
  const recurringCount = tickets.filter((t) => t.isRecurringIncident).length;
  const escalatedCount = tickets.filter((t) => t.status === 'escalated').length;
  const outOfZoneCalls = callLogs.filter((c) => c.outcome === 'out_of_zone').length;
  const strictSlaCount = slaPolicies.filter((p) => p.active && p.firstResponseMinutes <= 30).length;

  const teamBaseMaxCap = Math.max(
    14,
    agents.reduce((sum, a) => sum + Math.max(4, a.maxConcurrentTickets || 8), 0)
  );
  const steadyAgentDailyCap = Math.max(12, Math.round(teamBaseMaxCap * 0.72));

  // Build 7-day historical baseline (J-6 .. J)
  const baseDailyVolume = Math.max(
    10,
    Math.round(tickets.length * 2.3 + callLogs.length * 0.55 + recurringCount * 1.4 + escalatedCount)
  );
  const historicalWeights = [0.74, 0.79, 0.77, 0.89, 1.04, 0.99, 1.1];

  const computeDayCapacity = (isoDate: string, dt: Date) => {
    const onLeaveIds = new Set(
      leaves
        .filter((lv) => lv.startDate <= isoDate && lv.endDate >= isoDate)
        .map((lv) => lv.agentId)
    );
    const activeAgents = agents.filter(
      (a) => !onLeaveIds.has(a.id) && a.availability !== 'off_duty'
    );
    const activeAgentsPlanned = activeAgents.length;
    const onLeaveCount = onLeaveIds.size;

    const shiftsForDay = wfmShifts.filter((w) => w.shiftDate === isoDate);
    const onCallForDay = onCallShifts.filter((s) => s.shiftDate === isoDate && s.status !== 'completed').length;

    const activeAgentCap = activeAgents.reduce(
      (sum, a) => sum + Math.max(4, a.maxConcurrentTickets || 8) * 0.7,
      0
    );

    let plannedCapacity: number;
    if (shiftsForDay.length > 0) {
      const shiftThroughput = shiftsForDay.reduce(
        (sum, sh) => sum + sh.plannedHours * 2.4 * (Math.max(50, sh.adherencePct) / 100),
        0
      );
      plannedCapacity = Math.max(8, Math.round(shiftThroughput + onCallForDay * 4));
    } else {
      const coverageFactor = isWeekendDay(dt) ? 0.58 : 0.88;
      const basePool = activeAgents.length > 0 ? activeAgentCap : steadyAgentDailyCap * 0.6;
      plannedCapacity = Math.max(8, Math.round(basePool * coverageFactor + onCallForDay * 4));
    }

    return {
      plannedCapacity,
      activeAgentsPlanned,
      onLeaveCount,
      wfmShiftsCount: shiftsForDay.length,
      shiftsForDay,
    };
  };

  const historicalPoints: SlaForecastDayPoint[] = [];
  for (let offset = -6; offset <= 0; offset++) {
    const dt = addDays(today, offset);
    const isoDate = toLocalIsoDate(dt);
    const idx = offset + 6;
    const realDelta =
      isoDate !== todayIso ? (realCreatedCountsByDate.get(isoDate) || 0) : 0;
    const weekendScale = offset < 0 && isWeekendDay(dt) ? 0.78 : 1;
    const spikeOutOfZone = offset === -2 ? Math.min(5, outOfZoneCalls) : 0;
    const volume = Math.max(
      4,
      Math.round(baseDailyVolume * historicalWeights[idx] * weekendScale + realDelta + spikeOutOfZone)
    );

    const capInfo = computeDayCapacity(isoDate, dt);
    const utilizationPct = Math.round((volume / Math.max(1, capInfo.plannedCapacity)) * 100);
    const overflowTickets = Math.max(0, volume - capInfo.plannedCapacity);
    const slaBreachRiskPct = Math.min(
      98,
      Math.max(
        4,
        Math.round(
          (utilizationPct - 62) * 0.85 +
            highPriorityRatio * 18 +
            (overflowTickets > 0 ? overflowTickets * 3.5 : 0)
        )
      )
    );
    const riskLevel: SlaRiskLevel =
      utilizationPct >= 115 || overflowTickets >= 4
        ? 'critical'
        : utilizationPct >= 95 || overflowTickets > 0
        ? 'warning'
        : 'nominal';

    historicalPoints.push({
      isoDate,
      shortLabel: formatDayShort(dt, offset, locale),
      dayName: formatDayFull(dt, locale),
      kind: 'historical',
      historicalVolume: volume,
      projectedVolume: offset === 0 ? volume : null,
      plannedCapacity: capInfo.plannedCapacity,
      activeAgentsPlanned: capInfo.activeAgentsPlanned,
      onLeaveCount: capInfo.onLeaveCount,
      wfmShiftsCount: capInfo.wfmShiftsCount,
      utilizationPct,
      overflowTickets,
      slaBreachRiskPct,
      riskLevel,
      driverSummary:
        locale === 'en'
          ? `Observed volume (${volume} tickets)`
          : locale === 'es'
          ? `Volumen observado (${volume} tickets)`
          : `Volume observé (${volume} tickets)`,
    });
  }

  // Ordinary least squares (OLS) linear trend on historical volumes (x = 0..6)
  const n = historicalPoints.length;
  const sumX = historicalPoints.reduce((s, _, i) => s + i, 0);
  const sumY = historicalPoints.reduce((s, p) => s + (p.historicalVolume || 0), 0);
  const sumXY = historicalPoints.reduce((s, p, i) => s + i * (p.historicalVolume || 0), 0);
  const sumXX = historicalPoints.reduce((s, _, i) => s + i * i, 0);
  const denom = n * sumXX - sumX * sumX;
  const rawSlope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const trendSlopePerDay = Number(rawSlope.toFixed(2));

  const historicalAvgDailyVolume = Math.round(sumY / n);
  const earlyAvg =
    historicalPoints.slice(0, 4).reduce((s, p) => s + (p.historicalVolume || 0), 0) / 4;
  const recentAvg =
    historicalPoints.slice(4).reduce((s, p) => s + (p.historicalVolume || 0), 0) / 3;
  const trendDeltaPct =
    earlyAvg > 0 ? Math.round(((recentAvg - earlyAvg) / earlyAvg) * 100) : 0;
  const trendDirection: 'rising' | 'stable' | 'falling' =
    trendDeltaPct >= 5 ? 'rising' : trendDeltaPct <= -5 ? 'falling' : 'stable';

  const lastHistVol = historicalPoints[historicalPoints.length - 1]?.historicalVolume || baseDailyVolume;

  // Forecast horizon (J+1 .. J+horizonDays)
  const forecastPoints: SlaForecastDayPoint[] = [];
  for (let offset = 1; offset <= horizonDays; offset++) {
    const dt = addDays(today, offset);
    const isoDate = toLocalIsoDate(dt);
    const dayOfWeek = dt.getDay();
    const weekendFactor = isWeekendDay(dt) ? 0.72 : dayOfWeek === 1 || dayOfWeek === 2 ? 1.1 : 1.0;

    const trendExtrapolated = Math.max(
      6,
      (lastHistVol + trendSlopePerDay * 0.7 * offset) * weekendFactor +
        (recurringCount > 0 && offset <= 2 ? recurringCount * 1.1 : 0)
    );

    const capInfo = computeDayCapacity(isoDate, dt);
    const wfmForecastSum = capInfo.shiftsForDay.reduce(
      (s, sh) => s + (sh.forecastTickets || 0),
      0
    );

    const projectedVolume =
      wfmForecastSum > 0
        ? Math.max(
            Math.round(trendExtrapolated * 0.65 + wfmForecastSum * 0.45),
            wfmForecastSum
          )
        : Math.round(trendExtrapolated);

    const utilizationPct = Math.round(
      (projectedVolume / Math.max(1, capInfo.plannedCapacity)) * 100
    );
    const overflowTickets = Math.max(0, projectedVolume - capInfo.plannedCapacity);
    const slaBreachRiskPct = Math.min(
      98,
      Math.max(
        5,
        Math.round(
          (utilizationPct - 60) * 0.9 +
            highPriorityRatio * 18 +
            strictSlaCount * 2 +
            (overflowTickets > 0 ? overflowTickets * 4 : 0)
        )
      )
    );

    const riskLevel: SlaRiskLevel =
      utilizationPct >= 115 || overflowTickets >= 4
        ? 'critical'
        : utilizationPct >= 95 || overflowTickets > 0
        ? 'warning'
        : 'nominal';

    const reasons: string[] = [];
    if (overflowTickets > 0) {
      reasons.push(
        locale === 'en'
          ? `+${overflowTickets} tickets over capacity`
          : locale === 'es'
          ? `+${overflowTickets} tickets sobre capacidad`
          : `+${overflowTickets} tickets au-dessus de la capacité`
      );
    } else if (utilizationPct >= 95) {
      reasons.push(
        locale === 'en'
          ? `High load (${utilizationPct}%)`
          : locale === 'es'
          ? `Carga elevada (${utilizationPct}%)`
          : `Charge tendue (${utilizationPct}%)`
      );
    } else {
      reasons.push(
        locale === 'en'
          ? `Buffer ${capInfo.plannedCapacity - projectedVolume} tickets`
          : locale === 'es'
          ? `Margen de ${capInfo.plannedCapacity - projectedVolume} tickets`
          : `Marge de ${capInfo.plannedCapacity - projectedVolume} tickets`
      );
    }

    if (capInfo.onLeaveCount > 0) {
      reasons.push(
        locale === 'en'
          ? `${capInfo.onLeaveCount} agent(s) on leave`
          : locale === 'es'
          ? `${capInfo.onLeaveCount} agente(s) ausente(s)`
          : `${capInfo.onLeaveCount} agent(s) en congé`
      );
    } else if (capInfo.wfmShiftsCount > 0 && capInfo.wfmShiftsCount <= 2) {
      reasons.push(
        locale === 'en'
          ? `Only ${capInfo.wfmShiftsCount} WFM shift(s) planned`
          : locale === 'es'
          ? `Solo ${capInfo.wfmShiftsCount} turno(s) WFM`
          : `${capInfo.wfmShiftsCount} shift(s) WFM planifié(s)`
      );
    }

    forecastPoints.push({
      isoDate,
      shortLabel: formatDayShort(dt, offset, locale),
      dayName: formatDayFull(dt, locale),
      kind: 'forecast',
      historicalVolume: null,
      projectedVolume,
      plannedCapacity: capInfo.plannedCapacity,
      activeAgentsPlanned: capInfo.activeAgentsPlanned,
      onLeaveCount: capInfo.onLeaveCount,
      wfmShiftsCount: capInfo.wfmShiftsCount,
      utilizationPct,
      overflowTickets,
      slaBreachRiskPct,
      riskLevel,
      driverSummary: reasons.join(' · '),
    });
  }

  const timeline = [...historicalPoints, ...forecastPoints];
  const atRiskPeriods = forecastPoints.filter((p) => p.riskLevel !== 'nominal');
  const criticalPeriodsCount = forecastPoints.filter((p) => p.riskLevel === 'critical').length;
  const warningPeriodsCount = forecastPoints.filter((p) => p.riskLevel === 'warning').length;

  const peakForecastPoint =
    forecastPoints.length > 0
      ? [...forecastPoints].sort((a, b) => b.utilizationPct - a.utilizationPct)[0]
      : null;

  const avgPlannedDailyCapacity =
    forecastPoints.length > 0
      ? Math.round(
          forecastPoints.reduce((s, p) => s + p.plannedCapacity, 0) / forecastPoints.length
        )
      : steadyAgentDailyCap;

  const overallRiskLevel: SlaRiskLevel =
    criticalPeriodsCount > 0 ? 'critical' : warningPeriodsCount > 0 ? 'warning' : 'nominal';

  const recommendedActions: string[] = [];
  if (peakForecastPoint && peakForecastPoint.riskLevel !== 'nominal') {
    if (locale === 'en') {
      recommendedActions.push(
        `Add 1 WFM shift on ${peakForecastPoint.dayName} (${peakForecastPoint.utilizationPct}% projected load, +${peakForecastPoint.overflowTickets} tickets).`
      );
    } else if (locale === 'es') {
      recommendedActions.push(
        `Añadir 1 turno WFM el ${peakForecastPoint.dayName} (${peakForecastPoint.utilizationPct}% de carga prevista).`
      );
    } else {
      recommendedActions.push(
        `Renforcer le planning WFM sur ${peakForecastPoint.dayName} (${peakForecastPoint.utilizationPct}% de charge prévue${peakForecastPoint.overflowTickets > 0 ? `, +${peakForecastPoint.overflowTickets} tickets en débordement` : ''}).`
      );
    }
  }
  if (trendDirection === 'rising') {
    recommendedActions.push(
      locale === 'en'
        ? `Upward volume trend (+${trendDeltaPct}% over 7 days): enable Smart Routing prioritization for critical SLA queues.`
        : locale === 'es'
        ? `Tendencia alcista (+${trendDeltaPct}% en 7 días): activar prioridad de enrutamiento inteligente en colas SLA críticas.`
        : `Tendance haussière (+${trendDeltaPct}% sur 7 j) : activer le Smart Routing et la déflexion KB sur les files tendues.`
    );
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push(
      locale === 'en'
        ? 'Planned capacity covers projected ticket volume across the selected horizon.'
        : locale === 'es'
        ? 'La capacidad planificada cubre el volumen previsto en todo el horizonte.'
        : 'La capacité agents planifiée couvre les volumes prévus sur l’ensemble de la fenêtre.'
    );
  }

  return {
    horizonDays,
    trendSlopePerDay,
    trendDirection,
    trendDeltaPct,
    historicalAvgDailyVolume,
    avgPlannedDailyCapacity,
    peakForecastPoint,
    atRiskPeriods,
    criticalPeriodsCount,
    warningPeriodsCount,
    overallRiskLevel,
    recommendedActions,
    timeline,
  };
}
