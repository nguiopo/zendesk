import {
  AppLocale,
  SlaPolicy,
  SupportAgent,
  Ticket,
  TicketPriority,
} from '../types/helpdesk';
import { DEFAULT_SLA_ALERT_THRESHOLD_PCT, evaluateSlaResponseAlert } from './formatters';

export type HeatMapMetricMode = 'combined' | 'volume' | 'breach';
export type HeatMapPriorityScope = 'all' | 'urgent' | 'critical';

export interface HeatMapTicketSummary {
  id: string;
  reference: string;
  subject: string;
  priority: TicketPriority;
  status: Ticket['status'];
  isBreached: boolean;
  isAtRisk: boolean;
}

export interface HeatMapCell {
  dayIndex: number; // 0 = Mon .. 6 = Sun
  hour: number; // 0 .. 23
  dayShortLabel: string;
  dayFullLabel: string;
  hourLabel: string;
  hourRangeLabel: string;
  volume: number;
  breachedCount: number;
  atRiskCount: number;
  breachDensityPct: number;
  pressureDensityPct: number;
  tickets: HeatMapTicketSummary[];
}

export interface HeatMapDayRow {
  dayIndex: number;
  dayShortLabel: string;
  dayFullLabel: string;
  totalVolume: number;
  totalBreached: number;
  totalAtRisk: number;
  cells: HeatMapCell[];
}

export interface WeeklyHeatMapReport {
  rows: HeatMapDayRow[];
  hourlyTotals: number[];
  hourlyBreaches: number[];
  totalTickets: number;
  totalBreached: number;
  totalAtRisk: number;
  activeSlotsCount: number;
  overallBreachRatePct: number;
  maxCellVolume: number;
  maxCellBreached: number;
  peakVolumeCell: HeatMapCell | null;
  peakBreachCell: HeatMapCell | null;
}

const DAY_SHORT_LABELS: Record<AppLocale, string[]> = {
  fr: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  es: ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'],
};

const DAY_FULL_LABELS: Record<AppLocale, string[]> = {
  fr: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  es: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'],
};

const DEFAULT_FIRST_RESPONSE_MIN: Record<TicketPriority, number> = {
  critical: 15,
  high: 30,
  medium: 120,
  low: 240,
};

function resolveTicketTimestampMs(ticket: Ticket, fallbackMs: number): number {
  const created = ticket.createdAt;
  if (created && typeof created.toMillis === 'function') {
    return created.toMillis();
  }
  if (created && typeof created.seconds === 'number') {
    return created.seconds * 1000;
  }
  const updated = ticket.updatedAt;
  if (updated && typeof updated.toMillis === 'function') {
    return updated.toMillis();
  }
  if (updated && typeof updated.seconds === 'number') {
    return updated.seconds * 1000;
  }
  return fallbackMs;
}

function evaluateTicketSlaState(
  ticket: Ticket,
  slaPolicies: SlaPolicy[],
  agents: SupportAgent[],
  nowMs: number,
  slaAlertThresholdPct: number
): { isBreached: boolean; isAtRisk: boolean } {
  const isDone = ticket.status === 'resolved' || ticket.status === 'closed';
  const matchedPolicy =
    slaPolicies.find((p) => p.id === ticket.slaPolicyId) ||
    slaPolicies.find((p) => p.priorityScope === ticket.priority);
  const allocatedMin = Math.max(
    1,
    matchedPolicy?.firstResponseMinutes ?? DEFAULT_FIRST_RESPONSE_MIN[ticket.priority]
  );

  if (isDone) {
    const createdMs = ticket.createdAt?.toMillis?.();
    const updatedMs = ticket.updatedAt?.toMillis?.();
    if (
      typeof createdMs === 'number' &&
      typeof updatedMs === 'number' &&
      updatedMs > createdMs
    ) {
      const elapsedMin = (updatedMs - createdMs) / 60000;
      return {
        isBreached: elapsedMin > allocatedMin * 4,
        isAtRisk: false,
      };
    }
    return { isBreached: false, isAtRisk: false };
  }

  const isPastFirstResponse = !ticket.firstResponded && ticket.firstResponseDueMs < nowMs;
  const isPastResolution = ticket.resolutionDueMs < nowMs;
  const isBreached = isPastFirstResponse || isPastResolution;

  if (isBreached) {
    return { isBreached: true, isAtRisk: false };
  }

  const slaAlert = evaluateSlaResponseAlert(
    ticket,
    slaPolicies,
    agents,
    nowMs,
    slaAlertThresholdPct
  );
  const isAtRisk = slaAlert.isAlert || ticket.status === 'escalated';
  return { isBreached: false, isAtRisk };
}

export function computeWeeklyHeatMap(params: {
  tickets: Ticket[];
  slaPolicies?: SlaPolicy[];
  agents?: SupportAgent[];
  priorityScope?: HeatMapPriorityScope;
  locale?: AppLocale;
  nowMs?: number;
  slaAlertThresholdPct?: number;
}): WeeklyHeatMapReport {
  const {
    tickets,
    slaPolicies = [],
    agents = [],
    priorityScope = 'all',
    locale = 'fr',
    nowMs = Date.now(),
    slaAlertThresholdPct = DEFAULT_SLA_ALERT_THRESHOLD_PCT,
  } = params;

  const shortDays = DAY_SHORT_LABELS[locale] || DAY_SHORT_LABELS.fr;
  const fullDays = DAY_FULL_LABELS[locale] || DAY_FULL_LABELS.fr;

  const rows: HeatMapDayRow[] = Array.from({ length: 7 }, (_, dayIndex) => ({
    dayIndex,
    dayShortLabel: shortDays[dayIndex],
    dayFullLabel: fullDays[dayIndex],
    totalVolume: 0,
    totalBreached: 0,
    totalAtRisk: 0,
    cells: Array.from({ length: 24 }, (_, hour) => {
      const hh = String(hour).padStart(2, '0');
      return {
        dayIndex,
        hour,
        dayShortLabel: shortDays[dayIndex],
        dayFullLabel: fullDays[dayIndex],
        hourLabel: `${hh}h`,
        hourRangeLabel: `${hh}:00 – ${hh}:59`,
        volume: 0,
        breachedCount: 0,
        atRiskCount: 0,
        breachDensityPct: 0,
        pressureDensityPct: 0,
        tickets: [],
      };
    }),
  }));

  const hourlyTotals = new Array<number>(24).fill(0);
  const hourlyBreaches = new Array<number>(24).fill(0);

  const filteredTickets = tickets.filter((ticket) => {
    if (priorityScope === 'critical') return ticket.priority === 'critical';
    if (priorityScope === 'urgent') {
      return ticket.priority === 'critical' || ticket.priority === 'high';
    }
    return true;
  });

  let totalTickets = 0;
  let totalBreached = 0;
  let totalAtRisk = 0;

  for (const ticket of filteredTickets) {
    const tsMs = resolveTicketTimestampMs(ticket, nowMs);
    const dt = new Date(tsMs);
    const jsDay = dt.getDay(); // 0 = Sun .. 6 = Sat
    const dayIndex = (jsDay + 6) % 7; // 0 = Mon .. 6 = Sun
    const hour = dt.getHours();

    const row = rows[dayIndex];
    const cell = row?.cells[hour];
    if (!row || !cell) continue;

    const { isBreached, isAtRisk } = evaluateTicketSlaState(
      ticket,
      slaPolicies,
      agents,
      nowMs,
      slaAlertThresholdPct
    );

    cell.volume += 1;
    row.totalVolume += 1;
    hourlyTotals[hour] += 1;
    totalTickets += 1;

    if (isBreached) {
      cell.breachedCount += 1;
      row.totalBreached += 1;
      hourlyBreaches[hour] += 1;
      totalBreached += 1;
    } else if (isAtRisk) {
      cell.atRiskCount += 1;
      row.totalAtRisk += 1;
      totalAtRisk += 1;
    }

    cell.tickets.push({
      id: ticket.id,
      reference: ticket.reference,
      subject: ticket.subject,
      priority: ticket.priority,
      status: ticket.status,
      isBreached,
      isAtRisk,
    });
  }

  let activeSlotsCount = 0;
  let maxCellVolume = 0;
  let maxCellBreached = 0;
  let peakVolumeCell: HeatMapCell | null = null;
  let peakBreachCell: HeatMapCell | null = null;

  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.volume > 0) {
        activeSlotsCount += 1;
        cell.breachDensityPct = Math.round((cell.breachedCount / cell.volume) * 100);
        cell.pressureDensityPct = Math.round(
          ((cell.breachedCount + cell.atRiskCount) / cell.volume) * 100
        );

        if (cell.volume > maxCellVolume) {
          maxCellVolume = cell.volume;
          peakVolumeCell = cell;
        }
        if (cell.breachedCount > maxCellBreached) {
          maxCellBreached = cell.breachedCount;
          peakBreachCell = cell;
        } else if (
          maxCellBreached === 0 &&
          cell.atRiskCount > 0 &&
          (!peakBreachCell || cell.pressureDensityPct > peakBreachCell.pressureDensityPct)
        ) {
          peakBreachCell = cell;
        }
      }
    }
  }

  const overallBreachRatePct =
    totalTickets > 0 ? Math.round((totalBreached / totalTickets) * 100) : 0;

  return {
    rows,
    hourlyTotals,
    hourlyBreaches,
    totalTickets,
    totalBreached,
    totalAtRisk,
    activeSlotsCount,
    overallBreachRatePct,
    maxCellVolume,
    maxCellBreached,
    peakVolumeCell,
    peakBreachCell,
  };
}
