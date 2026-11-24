import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  CallLog,
  ClientAccount,
  CsatSurvey,
  OnCallReportEntry,
  SlaPolicy,
  SupportAgent,
  Ticket,
  TicketPriority,
} from '../types/helpdesk';
import {
  AGENT_AVAILABILITY_LABELS,
  CLIENT_HEALTH_LABELS,
  evaluateSlaResponseAlert,
  formatDuration,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from './formatters';

export interface MonthlyReportTotals {
  totalCalls: number;
  avgCallDuration: number;
  totalSituationChecks: number;
  avgPlatformUsage: number;
  totalAssistance: number;
  totalPasswordUnlocks: number;
  totalOutOfZone: number;
  avgSla: string;
  teamLoadPct: number;
}

export interface MonthlyReportAiBrief {
  headline: string;
  slaRiskAssessment: string;
  capacityInsight: string;
  proactiveActions: string[];
}

interface ExportMonthlyPdfParams {
  monthValue: string; // YYYY-MM
  agents: SupportAgent[];
  tickets: Ticket[];
  clients: ClientAccount[];
  callLogs: CallLog[];
  totals: MonthlyReportTotals;
  aiBrief?: MonthlyReportAiBrief | null;
}

function toPdfText(input: string): string {
  return String(input ?? '')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00B7/g, '|')
    .replace(/\u2026/g, '...')
    .replace(/\u0153/g, 'oe')
    .replace(/\u0152/g, 'OE');
}

function formatMonthLabelFr(monthValue: string): string {
  const [yearStr, monthStr] = monthValue.split('-');
  const year = Number(yearStr);
  const monthIdx = Number(monthStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIdx) || monthIdx < 0 || monthIdx > 11) {
    return monthValue;
  }
  const date = new Date(year, monthIdx, 1);
  const formatted = date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function exportMonthlyPerformancePdf({
  monthValue,
  agents,
  tickets,
  clients,
  callLogs,
  totals,
  aiBrief,
}: ExportMonthlyPdfParams): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const monthLabel = formatMonthLabelFr(monthValue);

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(toPdfText('ZentraDesk - Bilan Mensuel de Performance Support Client'), margin, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  const generatedAt = new Date().toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(
    toPdfText(
      `Periode : ${monthLabel}  |  Genere le : ${generatedAt}  |  ${agents.length} agents  |  ${clients.length} clients  |  ${tickets.length} tickets`
    ),
    margin,
    20
  );

  let cursorY = 36;

  // Section 1: 8-Axis Support Capacity Summary
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(toPdfText('1. Synthese des 8 capacites operationnelles du support'), margin, cursorY);
  cursorY += 4;

  const nominalClients = clients.filter((c) => c.healthStatus === 'nominal').length;
  const outOfZoneClients = clients.filter((c) => c.outOfZoneSignal || c.healthStatus === 'out_of_zone').length;
  const lockedClients = clients.filter((c) => c.passwordLocked || c.healthStatus === 'password_locked').length;
  const outOfZoneCalls = callLogs.filter((c) => c.outcome === 'out_of_zone').length;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    head: [['Indicateur de capacite', 'Volume / Mesure', 'Detail operationnel']],
    body: [
      [
        '1. Appel telephonique',
        `${totals.totalCalls} appels`,
        toPdfText(`DMT moyenne : ${formatDuration(totals.avgCallDuration)} | Journal CTI : ${callLogs.length} appels recents`),
      ],
      [
        '2. Verifier la situation',
        `${totals.totalSituationChecks} audits`,
        'Controles de situation client et verifications telemetriques valides',
      ],
      [
        '3. Utilisation de la plateforme',
        `${totals.avgPlatformUsage}%`,
        'Indice moyen d adoption des outils, macros Zammad et portail',
      ],
      [
        '4. Monitoring des personnes',
        `${totals.teamLoadPct}% charge`,
        `Conformite SLA moyenne equipe : ${totals.avgSla}%`,
      ],
      [
        '5. Situation des etats des clients',
        `${nominalClients} / ${clients.length} nominaux`,
        `${outOfZoneClients} hors zone | ${lockedClients} mots de passe bloques`,
      ],
      [
        '6. Assistante du client',
        `${totals.totalAssistance} sessions`,
        'Accompagnements fonctionnels guides et resolution premier contact',
      ],
      [
        '7. Mot de passe bloque',
        `${totals.totalPasswordUnlocks} deblocages`,
        `Reinitialisations MFA/acces finalisees (${lockedClients} en attente)`,
      ],
      [
        '8. Appel des clients hors zone',
        `${totals.totalOutOfZone} suivis`,
        `Rappels proactifs et incidents reseau (${outOfZoneCalls} appels hors zone recents)`,
      ],
    ],
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;

  // Section 2: Detailed Performance per Support Agent
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(toPdfText('2. Rapport detaille par agent du support client'), margin, cursorY);
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
      9: { halign: 'right' },
      10: { halign: 'right' },
      11: { halign: 'right' },
    },
    head: [[
      'Agent',
      'Groupe',
      'Disponibilite',
      'Charge',
      'Appels',
      'DMT',
      'Verif.',
      'Usage',
      'Assist.',
      'MDP debl.',
      'Hors zone',
      'SLA %',
    ]],
    body: agents.map((a) => {
      const loadPct = Math.round((a.activeTickets / a.maxConcurrentTickets) * 100);
      return [
        toPdfText(a.name),
        toPdfText(a.group),
        toPdfText(AGENT_AVAILABILITY_LABELS[a.availability]),
        `${a.activeTickets}/${a.maxConcurrentTickets} (${loadPct}%)`,
        String(a.callsHandled),
        formatDuration(a.avgCallDurationSec),
        String(a.situationChecks),
        `${a.platformUsageScore}%`,
        String(a.clientAssistanceCount),
        String(a.passwordUnlocksCount),
        String(a.outOfZoneFollowups),
        `${a.slaCompliancePct.toFixed(1)}%`,
      ];
    }),
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;

  // Section 3: Tickets SLA & Client Health Alerts
  if (cursorY > 155) {
    doc.addPage();
    cursorY = 18;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(toPdfText('3. Etat des tickets SLA, incidents recurrents et comptes clients en vigilance'), margin, cursorY);
  cursorY += 4;

  const alertClients = clients.filter((c) => c.healthStatus !== 'nominal');
  const openTickets = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length;
  const escalatedTickets = tickets.filter((t) => t.status === 'escalated').length;
  const recurringTickets = tickets.filter((t) => t.isRecurringIncident).length;
  const resolvedTickets = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed').length;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    head: [['Tickets ouverts', 'Tickets escalades', 'Incidents recurrents', 'Tickets resolus / fermes']],
    body: [[String(openTickets), String(escalatedTickets), String(recurringTickets), String(resolvedTickets)]],
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  if (alertClients.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [180, 83, 9], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      head: [['Entreprise', 'Region', 'Niveau', 'Etat client', 'Derniere observation']],
      body: alertClients.map((c) => [
        toPdfText(c.companyName),
        toPdfText(c.region),
        toPdfText(c.tier),
        toPdfText(CLIENT_HEALTH_LABELS[c.healthStatus]),
        toPdfText(c.lastVerifiedNote || '-'),
      ]),
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // Optional Section 4: AI Executive Brief if generated
  if (aiBrief) {
    if (cursorY > 150) {
      doc.addPage();
      cursorY = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(37, 99, 235);
    doc.text(toPdfText('4. Synthese analytique IA Gemini'), margin, cursorY);
    cursorY += 5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    const headlineLines = doc.splitTextToSize(toPdfText(aiBrief.headline), pageWidth - margin * 2);
    doc.text(headlineLines, margin, cursorY);
    cursorY += headlineLines.length * 4.5 + 2;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const slaLines = doc.splitTextToSize(
      toPdfText(`Vigilance SLA : ${aiBrief.slaRiskAssessment}`),
      pageWidth - margin * 2
    );
    doc.text(slaLines, margin, cursorY);
    cursorY += slaLines.length * 4.2 + 2;

    const capLines = doc.splitTextToSize(
      toPdfText(`Capacite equipe : ${aiBrief.capacityInsight}`),
      pageWidth - margin * 2
    );
    doc.text(capLines, margin, cursorY);
    cursorY += capLines.length * 4.2 + 3;

    doc.setFont('helvetica', 'bold');
    doc.text('Actions proactives recommandees :', margin, cursorY);
    cursorY += 4.5;
    doc.setFont('helvetica', 'normal');
    for (const action of aiBrief.proactiveActions) {
      const actionLines = doc.splitTextToSize(toPdfText(`- ${action}`), pageWidth - margin * 2 - 4);
      doc.text(actionLines, margin + 2, cursorY);
      cursorY += actionLines.length * 4.2 + 1;
    }
  }

  // Paginated footer across all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      toPdfText(`ZentraDesk - Bilan mensuel (${monthLabel})`),
      margin,
      doc.internal.pageSize.getHeight() - 8
    );
    doc.text(
      `Page ${i} / ${totalPages}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'right' }
    );
  }

  doc.save(`bilan-mensuel-support-${monthValue}.pdf`);
}

export interface IsoWeekOption {
  weekKey: string; // YYYY-Www
  label: string;
  rangeLabel: string;
  startMs: number;
  endMs: number;
  isCurrent: boolean;
}

const DEFAULT_PRIORITY_SLA_MIN: Record<TicketPriority, number> = {
  critical: 15,
  high: 30,
  medium: 120,
  low: 240,
};

function getIsoWeekNumber(date: Date): { year: number; week: number } {
  const temp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = temp.getUTCDay() || 7;
  temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((temp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: temp.getUTCFullYear(), week };
}

export function getRecentIsoWeeks(count = 8, referenceDate: Date = new Date()): IsoWeekOption[] {
  const base = new Date(referenceDate);
  base.setHours(0, 0, 0, 0);
  const day = base.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const currentMonday = new Date(base);
  currentMonday.setDate(base.getDate() + diffToMonday);

  const options: IsoWeekOption[] = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(currentMonday);
    start.setDate(currentMonday.getDate() - i * 7);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const { year, week } = getIsoWeekNumber(start);
    const weekKey = `${year}-W${String(week).padStart(2, '0')}`;
    const startShort = start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    const endShort = end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    const rangeLabel = `${startShort} - ${endShort}`;
    const label =
      i === 0
        ? `S${String(week).padStart(2, '0')} · ${rangeLabel} (En cours)`
        : `S${String(week).padStart(2, '0')} · ${rangeLabel}`;

    options.push({
      weekKey,
      label,
      rangeLabel,
      startMs: start.getTime(),
      endMs: end.getTime(),
      isCurrent: i === 0,
    });
  }
  return options;
}

export interface WeeklyTicketMetricItem {
  ticket: Ticket;
  activityMs: number;
  responseMinutes: number;
  allocatedSlaMinutes: number;
  withinSla: boolean;
}

export interface WeeklyPerformanceSummary {
  week: IsoWeekOption;
  totalTickets: number;
  openTickets: number;
  resolvedTickets: number;
  escalatedTickets: number;
  criticalTicketsCount: number;
  slaBreachedCount: number;
  aiRoutedTickets: number;
  recurringTickets: number;
  resolutionRatePct: number;
  avgResponseMinutes: number;
  avgRespondedMinutes: number;
  slaCompliancePct: number;
  avgCallDurationSec: number;
  totalCallsInWeek: number;
  avgCsatScore: string;
  criticalTicketRefs: string[];
  criticalItems: WeeklyTicketMetricItem[];
  byPriority: {
    priority: TicketPriority;
    label: string;
    count: number;
    avgResponseMin: number;
    slaTargetMin: number;
    slaRespectPct: number;
  }[];
  byDay: {
    dayLabel: string;
    dateLabel: string;
    totalCount: number;
    resolvedCount: number;
    escalatedCount: number;
    avgResponseMin: number;
  }[];
  byGroup: {
    group: string;
    count: number;
    sharePct: number;
    avgResponseMin: number;
    aiRoutedPct: number;
  }[];
  ticketItems: WeeklyTicketMetricItem[];
}

export function formatMinutesCompact(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe} min`;
  const hrs = Math.floor(safe / 60);
  const mins = safe % 60;
  return mins > 0 ? `${hrs}h ${String(mins).padStart(2, '0')}m` : `${hrs}h`;
}

function getTicketReferenceTimestampMs(ticket: Ticket, slaPolicies: SlaPolicy[]): number {
  const createdMs = ticket.createdAt?.toMillis?.();
  if (typeof createdMs === 'number' && Number.isFinite(createdMs)) return createdMs;
  const updatedMs = ticket.updatedAt?.toMillis?.();
  if (typeof updatedMs === 'number' && Number.isFinite(updatedMs)) return updatedMs;
  const matchedPolicy =
    slaPolicies.find((p) => p.id === ticket.slaPolicyId) ||
    slaPolicies.find((p) => p.priorityScope === ticket.priority);
  const targetMin = matchedPolicy?.firstResponseMinutes ?? DEFAULT_PRIORITY_SLA_MIN[ticket.priority];
  return ticket.firstResponseDueMs - targetMin * 60000;
}

function estimateTicketResponseMetrics(
  ticket: Ticket,
  slaPolicies: SlaPolicy[],
  agents: SupportAgent[],
  nowMs: number
): { responseMinutes: number; allocatedSlaMinutes: number; withinSla: boolean } {
  const matchedPolicy =
    slaPolicies.find((p) => p.id === ticket.slaPolicyId) ||
    slaPolicies.find((p) => p.priorityScope === ticket.priority);
  const allocatedSlaMinutes = Math.max(
    1,
    matchedPolicy?.firstResponseMinutes ?? DEFAULT_PRIORITY_SLA_MIN[ticket.priority]
  );

  const createdMs = ticket.createdAt?.toMillis?.();
  const updatedMs = ticket.updatedAt?.toMillis?.();

  if (ticket.firstResponded) {
    let responseMinutes: number;
    if (
      typeof createdMs === 'number' &&
      typeof updatedMs === 'number' &&
      updatedMs - createdMs > 60000
    ) {
      responseMinutes = Math.max(1, Math.round((updatedMs - createdMs) / 60000));
    } else {
      const factor =
        ticket.status === 'resolved' || ticket.status === 'closed'
          ? 0.42
          : ticket.priority === 'critical'
          ? 0.55
          : 0.58;
      responseMinutes = Math.max(2, Math.round(allocatedSlaMinutes * factor));
    }
    return {
      responseMinutes,
      allocatedSlaMinutes,
      withinSla: responseMinutes <= allocatedSlaMinutes,
    };
  }

  const slaInfo = evaluateSlaResponseAlert(ticket, slaPolicies, agents, nowMs);
  const responseMinutes = Math.max(1, slaInfo.estimatedResponseMinutes);
  return {
    responseMinutes,
    allocatedSlaMinutes,
    withinSla: responseMinutes <= slaInfo.allocatedSlaMinutes && ticket.firstResponseDueMs >= nowMs,
  };
}

export function computeWeeklyPerformanceSummary({
  week,
  tickets,
  slaPolicies = [],
  agents,
  callLogs,
  csatSurveys = [],
}: {
  week: IsoWeekOption;
  tickets: Ticket[];
  slaPolicies?: SlaPolicy[];
  agents: SupportAgent[];
  callLogs: CallLog[];
  csatSurveys?: CsatSurvey[];
}): WeeklyPerformanceSummary {
  const nowMs = Date.now();

  const ticketItems: WeeklyTicketMetricItem[] = tickets
    .map((ticket) => {
      const createdMs = getTicketReferenceTimestampMs(ticket, slaPolicies);
      const updatedMs = ticket.updatedAt?.toMillis?.() ?? createdMs;
      const inRange =
        (createdMs >= week.startMs && createdMs <= week.endMs) ||
        (updatedMs >= week.startMs && updatedMs <= week.endMs) ||
        (ticket.firstResponseDueMs >= week.startMs && ticket.firstResponseDueMs <= week.endMs);
      if (!inRange) return null;

      const activityMs =
        createdMs >= week.startMs && createdMs <= week.endMs
          ? createdMs
          : updatedMs >= week.startMs && updatedMs <= week.endMs
          ? updatedMs
          : ticket.firstResponseDueMs;

      const metrics = estimateTicketResponseMetrics(ticket, slaPolicies, agents, nowMs);
      return {
        ticket,
        activityMs,
        ...metrics,
      };
    })
    .filter((item): item is WeeklyTicketMetricItem => item !== null)
    .sort((a, b) => b.responseMinutes - a.responseMinutes);

  const totalTickets = ticketItems.length;
  const resolvedTickets = ticketItems.filter(
    (i) => i.ticket.status === 'resolved' || i.ticket.status === 'closed'
  ).length;
  const openTickets = totalTickets - resolvedTickets;
  const escalatedTickets = ticketItems.filter((i) => i.ticket.status === 'escalated').length;
  const aiRoutedTickets = ticketItems.filter((i) => i.ticket.aiRouted).length;
  const recurringTickets = ticketItems.filter((i) => i.ticket.isRecurringIncident).length;
  const resolutionRatePct = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;

  const avgResponseMinutes =
    totalTickets > 0
      ? Math.round(ticketItems.reduce((s, i) => s + i.responseMinutes, 0) / totalTickets)
      : 0;

  const respondedItems = ticketItems.filter((i) => i.ticket.firstResponded);
  const avgRespondedMinutes =
    respondedItems.length > 0
      ? Math.round(respondedItems.reduce((s, i) => s + i.responseMinutes, 0) / respondedItems.length)
      : avgResponseMinutes;

  const slaRespectCount = ticketItems.filter((i) => i.withinSla).length;
  const slaCompliancePct =
    totalTickets > 0 ? Math.round((slaRespectCount / totalTickets) * 100) : 100;

  const weeklyCalls = callLogs.filter((c) => {
    const ms = c.createdAt?.toMillis?.();
    return typeof ms === 'number' && ms >= week.startMs && ms <= week.endMs;
  });
  const avgCallDurationSec =
    weeklyCalls.length > 0
      ? Math.round(weeklyCalls.reduce((s, c) => s + c.durationSeconds, 0) / weeklyCalls.length)
      : agents.length > 0
      ? Math.round(agents.reduce((s, a) => s + a.avgCallDurationSec, 0) / agents.length)
      : 0;

  const weeklyCsat = csatSurveys.filter((c) => {
    const ms = c.createdAt?.toMillis?.();
    return typeof ms === 'number' && ms >= week.startMs && ms <= week.endMs;
  });
  const csatPool = weeklyCsat.length > 0 ? weeklyCsat : csatSurveys;
  const avgCsatScore =
    csatPool.length > 0
      ? (csatPool.reduce((s, c) => s + c.rating, 0) / csatPool.length).toFixed(1)
      : '—';

  const priorities: TicketPriority[] = ['critical', 'high', 'medium', 'low'];
  const byPriority = priorities.map((priority) => {
    const items = ticketItems.filter((i) => i.ticket.priority === priority);
    const matchedPolicy = slaPolicies.find((p) => p.priorityScope === priority);
    const slaTargetMin = matchedPolicy?.firstResponseMinutes ?? DEFAULT_PRIORITY_SLA_MIN[priority];
    const avgMin =
      items.length > 0
        ? Math.round(items.reduce((s, i) => s + i.responseMinutes, 0) / items.length)
        : 0;
    const respectPct =
      items.length > 0
        ? Math.round((items.filter((i) => i.withinSla).length / items.length) * 100)
        : 100;
    return {
      priority,
      label: TICKET_PRIORITY_LABELS[priority],
      count: items.length,
      avgResponseMin: avgMin,
      slaTargetMin,
      slaRespectPct: respectPct,
    };
  });

  const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const byDay = dayNames.map((dayLabel, idx) => {
    const dayStart = week.startMs + idx * 86400000;
    const dayEnd = dayStart + 86400000 - 1;
    const dayDate = new Date(dayStart);
    const dateLabel = dayDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    const dayItems = ticketItems.filter((i) => i.activityMs >= dayStart && i.activityMs <= dayEnd);
    const dayResolved = dayItems.filter(
      (i) => i.ticket.status === 'resolved' || i.ticket.status === 'closed'
    ).length;
    const dayEscalated = dayItems.filter((i) => i.ticket.status === 'escalated').length;
    const dayAvgMin =
      dayItems.length > 0
        ? Math.round(dayItems.reduce((s, i) => s + i.responseMinutes, 0) / dayItems.length)
        : 0;
    return {
      dayLabel,
      dateLabel,
      totalCount: dayItems.length,
      resolvedCount: dayResolved,
      escalatedCount: dayEscalated,
      avgResponseMin: dayAvgMin,
    };
  });

  const groupMap = new Map<string, WeeklyTicketMetricItem[]>();
  for (const item of ticketItems) {
    const grp = item.ticket.assignedGroup || 'Non assigne';
    const arr = groupMap.get(grp) || [];
    arr.push(item);
    groupMap.set(grp, arr);
  }
  const byGroup = Array.from(groupMap.entries())
    .map(([group, items]) => ({
      group,
      count: items.length,
      sharePct: totalTickets > 0 ? Math.round((items.length / totalTickets) * 100) : 0,
      avgResponseMin: Math.round(items.reduce((s, i) => s + i.responseMinutes, 0) / items.length),
      aiRoutedPct: Math.round((items.filter((i) => i.ticket.aiRouted).length / items.length) * 100),
    }))
    .sort((a, b) => b.count - a.count);

  const criticalItems = ticketItems
    .filter(
      (i) =>
        i.ticket.priority === 'critical' ||
        i.ticket.status === 'escalated' ||
        !i.withinSla
    )
    .sort((a, b) => {
      const scoreA =
        (a.ticket.priority === 'critical' ? 4 : 0) +
        (a.withinSla ? 0 : 2) +
        (a.ticket.status === 'escalated' ? 1 : 0);
      const scoreB =
        (b.ticket.priority === 'critical' ? 4 : 0) +
        (b.withinSla ? 0 : 2) +
        (b.ticket.status === 'escalated' ? 1 : 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return b.responseMinutes - a.responseMinutes;
    });

  const criticalTicketsCount = ticketItems.filter(
    (i) => i.ticket.priority === 'critical'
  ).length;
  const slaBreachedCount = ticketItems.filter((i) => !i.withinSla).length;
  const criticalTicketRefs = criticalItems
    .slice(0, 20)
    .map((i) => i.ticket.reference);

  return {
    week,
    totalTickets,
    openTickets,
    resolvedTickets,
    escalatedTickets,
    criticalTicketsCount,
    slaBreachedCount,
    aiRoutedTickets,
    recurringTickets,
    resolutionRatePct,
    avgResponseMinutes,
    avgRespondedMinutes,
    slaCompliancePct,
    avgCallDurationSec,
    totalCallsInWeek: weeklyCalls.length,
    avgCsatScore,
    criticalTicketRefs,
    criticalItems,
    byPriority,
    byDay,
    byGroup,
    ticketItems,
  };
}

interface ExportWeeklyPdfParams {
  summary: WeeklyPerformanceSummary;
  agents: SupportAgent[];
}

export function exportWeeklyPerformancePdf({ summary, agents }: ExportWeeklyPdfParams): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(toPdfText('ZentraDesk - Rapport Hebdomadaire des Performances'), margin, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  const generatedAt = new Date().toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  doc.text(
    toPdfText(
      `Semaine : ${summary.week.weekKey} (${summary.week.rangeLabel})  |  Genere le : ${generatedAt}  |  ${summary.totalTickets} tickets agreges  |  Temps rep. moy. : ${formatMinutesCompact(summary.avgResponseMinutes)}`
    ),
    margin,
    20
  );

  let cursorY = 36;

  // Section 1: Weekly KPIs (Tickets & Average Response Time)
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(toPdfText('1. Agregation hebdomadaire des tickets et du temps de reponse moyen'), margin, cursorY);
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    head: [[
      'Tickets agreges',
      'Resolus / Fermes',
      'Ouverts / En cours',
      'Critiques P1 / Escalades',
      'Hors delai SLA',
      'Temps de reponse moyen',
      'Respect SLA',
      'DMT appels / CSAT',
    ]],
    body: [[
      String(summary.totalTickets),
      `${summary.resolvedTickets} (${summary.resolutionRatePct}%)`,
      String(summary.openTickets),
      `${summary.criticalTicketsCount} P1 / ${summary.escalatedTickets} esc.`,
      String(summary.slaBreachedCount),
      formatMinutesCompact(summary.avgResponseMinutes),
      `${summary.slaCompliancePct}%`,
      `${formatDuration(summary.avgCallDurationSec)} / ${summary.avgCsatScore === '—' ? '-' : `${summary.avgCsatScore}/5`}`,
    ]],
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // Section 2: Critical Tickets & SLA Breaches Highlight
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(185, 28, 28);
  doc.text(
    toPdfText('2. Tickets critiques (P1), escalades et depassements SLA de la semaine'),
    margin,
    cursorY
  );
  cursorY += 4;

  if (summary.criticalItems.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [185, 28, 28], textColor: 255, fontSize: 8.2, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.9, textColor: [30, 41, 59] },
      columnStyles: {
        5: { halign: 'right' },
        6: { halign: 'right' },
      },
      head: [[
        'Reference',
        'Sujet',
        'Client',
        'Priorite / Statut',
        'Equipe / Agent',
        'Temps rep.',
        'Cible SLA',
        'Diagnostic SLA',
      ]],
      body: summary.criticalItems.slice(0, 20).map((item) => [
        toPdfText(item.ticket.reference),
        toPdfText(item.ticket.subject.slice(0, 50)),
        toPdfText(item.ticket.clientName),
        toPdfText(`${TICKET_PRIORITY_LABELS[item.ticket.priority]} | ${TICKET_STATUS_LABELS[item.ticket.status]}`),
        toPdfText(item.ticket.assignedAgentName || item.ticket.assignedGroup),
        formatMinutesCompact(item.responseMinutes),
        formatMinutesCompact(item.allocatedSlaMinutes),
        item.withinSla ? 'Critique sous controle' : 'Depassement SLA',
      ]),
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.8);
    doc.setTextColor(5, 150, 105);
    doc.text(
      toPdfText('Aucun ticket critique P1, escalade ni depassement SLA releve sur cette semaine.'),
      margin,
      cursorY + 3
    );
    cursorY += 10;
  }

  if (cursorY > 150) {
    doc.addPage();
    cursorY = 18;
  }

  // Section 3: Breakdown by Priority
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(toPdfText('3. Temps de reponse moyen par niveau de priorite et objectif SLA'), margin, cursorY);
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
    },
    head: [['Priorite', 'Tickets', 'Temps de reponse moyen', 'Cible SLA 1ere reponse', 'Conformite SLA']],
    body: summary.byPriority.map((p) => [
      toPdfText(p.label),
      String(p.count),
      p.count > 0 ? formatMinutesCompact(p.avgResponseMin) : '-',
      formatMinutesCompact(p.slaTargetMin),
      p.count > 0 ? `${p.slaRespectPct}%` : '-',
    ]),
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // Section 4: Daily distribution Monday -> Sunday
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(toPdfText('4. Repartition journaliere de la semaine (Lundi - Dimanche)'), margin, cursorY);
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    columnStyles: {
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
    head: [['Jour', 'Date', 'Tickets traites', 'Resolus', 'Escalades', 'Temps de reponse moyen']],
    body: summary.byDay.map((d) => [
      d.dayLabel,
      d.dateLabel,
      String(d.totalCount),
      String(d.resolvedCount),
      String(d.escalatedCount),
      d.totalCount > 0 ? formatMinutesCompact(d.avgResponseMin) : '-',
    ]),
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // Section 4: Group distribution & Agent load
  if (cursorY > 145) {
    doc.addPage();
    cursorY = 18;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(toPdfText('5. Performance par groupe support et disponibilite des agents'), margin, cursorY);
  cursorY += 4;

  if (summary.byGroup.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
      head: [['Groupe support', 'Tickets', 'Part du volume', 'Temps reponse moy.', 'Routage IA']],
      body: summary.byGroup.map((g) => [
        toPdfText(g.group),
        String(g.count),
        `${g.sharePct}%`,
        formatMinutesCompact(g.avgResponseMin),
        `${g.aiRoutedPct}%`,
      ]),
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  if (agents.length > 0) {
    if (cursorY > 150) {
      doc.addPage();
      cursorY = 18;
    }
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      columnStyles: {
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
      },
      head: [['Agent', 'Groupe', 'Disponibilite', 'Tickets assignes', 'Appels', 'DMT', 'SLA %', 'CSAT']],
      body: agents.map((a) => {
        const assignedCount = summary.ticketItems.filter((i) => i.ticket.assignedAgentId === a.id).length;
        return [
          toPdfText(a.name),
          toPdfText(a.group),
          toPdfText(AGENT_AVAILABILITY_LABELS[a.availability]),
          String(assignedCount || a.activeTickets),
          String(a.callsHandled),
          formatDuration(a.avgCallDurationSec),
          `${a.slaCompliancePct.toFixed(1)}%`,
          `${a.csatScore.toFixed(1)} / 5`,
        ];
      }),
    });
    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  // Section 5: Weekly Ticket Detail Ledger
  if (summary.ticketItems.length > 0) {
    if (cursorY > 145) {
      doc.addPage();
      cursorY = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(15, 23, 42);
    doc.text(toPdfText('6. Detail des tickets de la semaine et temps de reponse'), margin, cursorY);
    cursorY += 4;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.8, textColor: [30, 41, 59] },
      columnStyles: {
        5: { halign: 'right' },
        6: { halign: 'right' },
      },
      head: [['Reference', 'Sujet', 'Client', 'Priorite', 'Statut', 'Temps reponse', 'Cible SLA', 'Conformite']],
      body: summary.ticketItems.slice(0, 35).map((item) => [
        toPdfText(item.ticket.reference),
        toPdfText(item.ticket.subject.slice(0, 56)),
        toPdfText(item.ticket.clientName),
        toPdfText(TICKET_PRIORITY_LABELS[item.ticket.priority]),
        toPdfText(TICKET_STATUS_LABELS[item.ticket.status]),
        formatMinutesCompact(item.responseMinutes),
        formatMinutesCompact(item.allocatedSlaMinutes),
        item.withinSla ? 'Conforme' : 'Depassement / Risque',
      ]),
    });
  }

  // Paginated footer across all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      toPdfText(`ZentraDesk - Rapport hebdomadaire (${summary.week.weekKey} | ${summary.week.rangeLabel})`),
      margin,
      doc.internal.pageSize.getHeight() - 8
    );
    doc.text(
      `Page ${i} / ${totalPages}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'right' }
    );
  }

  doc.save(`rapport-hebdomadaire-support-${summary.week.weekKey}.pdf`);
}

const REPORT_ENTRY_TYPE_LABELS: Record<OnCallReportEntry['entryType'], string> = {
  incident: 'Incident',
  action: 'Action corrective',
  escalation: 'Escalade N3',
  handover: 'Point de releve',
  resolved: 'Resolu',
};

const REPORT_STATUS_LABELS: Record<OnCallReportEntry['status'], string> = {
  open: 'Ouvert',
  resolved: 'Resolu',
  handed_over: 'Transmis releve',
};

export function exportOnCallShiftReportPdf({
  shiftLabel,
  entries,
  agentName,
}: {
  shiftLabel: string;
  entries: OnCallReportEntry[];
  agentName: string;
}): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(toPdfText("ZentraDesk - Rapport d'Astreinte & Releve Helpdesk"), margin, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  const generatedAt = new Date().toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const totalMinutes = entries.reduce((sum, item) => sum + (item.timeSpentMinutes || 0), 0);
  const handoverCount = entries.filter((item) => item.handoverRequired).length;
  const openCount = entries.filter((item) => item.status === 'open').length;

  doc.text(
    toPdfText(
      `Perimetre : ${shiftLabel}  |  Redacteur : ${agentName}  |  Genere le : ${generatedAt}`
    ),
    margin,
    20
  );

  let cursorY = 36;

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(toPdfText("1. Synthese de la periode d'astreinte"), margin, cursorY);
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    head: [['Entrees consignees', 'Points a transmettre (Releve)', 'Actions encore ouvertes', 'Temps cumule d intervention']],
    body: [[
      String(entries.length),
      String(handoverCount),
      String(openCount),
      formatMinutesCompact(totalMinutes),
    ]],
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  const handoverItems = entries.filter((e) => e.handoverRequired);
  if (handoverItems.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(180, 83, 9);
    doc.text(toPdfText('2. Points prioritaires pour la releve suivante'), margin, cursorY);
    cursorY += 4;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [180, 83, 9], textColor: 255, fontSize: 8.2, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      head: [['Heure', 'Ticket', 'Titre', 'Action / Consigne de releve', 'Statut']],
      body: handoverItems.map((item) => {
        const summaryBody = item.problemsEncountered
          ? `Problemes: ${item.problemsEncountered}${item.resolutionSteps ? ` | Resolutions: ${item.resolutionSteps}` : ''}`
          : item.details;
        return [
          toPdfText(item.occurredAtLabel),
          toPdfText(item.ticketRef || '-'),
          toPdfText(item.title),
          toPdfText(summaryBody),
          toPdfText(REPORT_STATUS_LABELS[item.status]),
        ];
      }),
    });

    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (cursorY > 150) {
    doc.addPage();
    cursorY = 18;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    toPdfText(handoverItems.length > 0 ? "3. Journal chronologique complet de l'astreinte" : "2. Journal chronologique complet de l'astreinte"),
    margin,
    cursorY
  );
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.8, textColor: [30, 41, 59] },
    columnStyles: {
      6: { halign: 'right' },
    },
    head: [['Horodatage', 'Agent', 'Type', 'Severite', 'Ticket', 'Titre, Problemes & Resolutions', 'Duree', 'Statut']],
    body: entries.map((item) => {
      const fullBody = item.problemsEncountered
        ? `${item.title} — Problemes: ${item.problemsEncountered}${item.resolutionSteps ? ` | Resolutions: ${item.resolutionSteps}` : ''}`
        : `${item.title} — ${item.details}`;
      return [
        toPdfText(item.occurredAtLabel),
        toPdfText(item.agentName),
        toPdfText(REPORT_ENTRY_TYPE_LABELS[item.entryType]),
        toPdfText(item.severity.toUpperCase()),
        toPdfText(item.ticketRef || '-'),
        toPdfText(fullBody),
        item.timeSpentMinutes > 0 ? `${item.timeSpentMinutes} min` : '-',
        toPdfText(REPORT_STATUS_LABELS[item.status]),
      ];
    }),
  });

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      toPdfText(`ZentraDesk - Rapport d astreinte (${shiftLabel})`),
      margin,
      doc.internal.pageSize.getHeight() - 8
    );
    doc.text(
      `Page ${i} / ${totalPages}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'right' }
    );
  }

  const slug = new Date().toISOString().slice(0, 10);
  doc.save(`rapport-astreinte-${slug}.pdf`);
}

export function exportOnCallReportsArchivePdf({
  entries,
  exportedBy,
}: {
  entries: OnCallReportEntry[];
  exportedBy: string;
}): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 30, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(toPdfText("ZentraDesk - Archive des Rapports d'Astreinte"), margin, 12.5);

  const generatedAt = new Date().toLocaleString('fr-FR', {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    toPdfText(
      `Archivage genere par : ${exportedBy}  |  Date : ${generatedAt}  |  Volume : ${entries.length} entree(s)`
    ),
    margin,
    21
  );

  let cursorY = 38;

  const resolvedCount = entries.filter(
    (e) => e.status === 'resolved' || e.entryType === 'resolved'
  ).length;
  const openCount = entries.filter((e) => e.status === 'open').length;
  const handoverCount = entries.filter((e) => e.handoverRequired).length;
  const criticalCount = entries.filter((e) => e.severity === 'critical').length;
  const totalMinutes = entries.reduce((sum, e) => sum + (e.timeSpentMinutes || 0), 0);

  // Section 1: Archive Summary
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(toPdfText("1. Synthese de l'archive d'astreinte"), margin, cursorY);
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    head: [[
      'Total entrees archivees',
      'Incidents / Suivis resolus',
      'Incidents critiques (P1)',
      'Suivis encore ouverts',
      'Points de releve',
      'Temps cumule',
    ]],
    body: [[
      String(entries.length),
      String(resolvedCount),
      String(criticalCount),
      String(openCount),
      String(handoverCount),
      formatMinutesCompact(totalMinutes),
    ]],
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // Section 2: Breakdown by Shift
  const shiftStatsMap = new Map<
    string,
    { count: number; resolved: number; handover: number; minutes: number }
  >();
  entries.forEach((item) => {
    const key = item.shiftLabel || 'Session libre';
    const current = shiftStatsMap.get(key) || { count: 0, resolved: 0, handover: 0, minutes: 0 };
    current.count += 1;
    if (item.status === 'resolved' || item.entryType === 'resolved') {
      current.resolved += 1;
    }
    if (item.handoverRequired) {
      current.handover += 1;
    }
    current.minutes += item.timeSpentMinutes || 0;
    shiftStatsMap.set(key, current);
  });

  if (shiftStatsMap.size > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(15, 23, 42);
    doc.text(toPdfText("2. Repartition par creneau d'astreinte (Shift)"), margin, cursorY);
    cursorY += 4;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: { fillColor: [51, 65, 85], textColor: 255, fontSize: 8.2, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
      head: [['Creneau / Shift', 'Entrees', 'Resolus', 'A relayer', 'Temps cumule']],
      body: Array.from(shiftStatsMap.entries()).map(([label, st]) => [
        toPdfText(label),
        String(st.count),
        String(st.resolved),
        String(st.handover),
        formatMinutesCompact(st.minutes),
      ]),
    });

    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  }

  if (cursorY > 150) {
    doc.addPage();
    cursorY = 18;
  }

  // Section 3: Full Chronological Archive Ledger
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(toPdfText("3. Registre complet des rapports d'astreinte"), margin, cursorY);
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59], cellPadding: 2.2 },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 38 },
      2: { cellWidth: 24 },
      3: { cellWidth: 20 },
      4: { cellWidth: 16 },
      5: { cellWidth: 18 },
      7: { cellWidth: 14, halign: 'right' },
      8: { cellWidth: 22 },
    },
    head: [[
      'Horodatage',
      'Shift',
      'Agent',
      'Type',
      'Severite',
      'Ticket',
      'Objet, Problemes & Resolutions',
      'Duree',
      'Statut',
    ]],
    body: entries.map((item) => {
      const createdDateStr =
        item.createdAt && typeof item.createdAt.toDate === 'function'
          ? item.createdAt.toDate().toLocaleDateString('fr-FR')
          : '';
      const timeLabel = createdDateStr
        ? `${createdDateStr} ${item.occurredAtLabel}`
        : item.occurredAtLabel;

      const structuredSummary = item.problemsEncountered
        ? `${item.title}\nProblemes : ${item.problemsEncountered}${
            item.resolutionSteps ? `\nResolutions : ${item.resolutionSteps}` : ''
          }`
        : `${item.title}\n${item.details}`;

      return [
        toPdfText(timeLabel),
        toPdfText(item.shiftLabel),
        toPdfText(item.agentName),
        toPdfText(REPORT_ENTRY_TYPE_LABELS[item.entryType]),
        toPdfText(item.severity.toUpperCase()),
        toPdfText(item.ticketRef || '-'),
        toPdfText(structuredSummary),
        item.timeSpentMinutes > 0 ? `${item.timeSpentMinutes} min` : '-',
        toPdfText(REPORT_STATUS_LABELS[item.status]),
      ];
    }),
  });

  const slug = new Date().toISOString().slice(0, 10);
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      toPdfText(`ZentraDesk - Archive officielle d astreinte (${slug})`),
      margin,
      doc.internal.pageSize.getHeight() - 8
    );
    doc.text(
      `Page ${i} / ${totalPages}`,
      pageWidth - margin,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'right' }
    );
  }

  doc.save(`archive-rapports-astreinte-${slug}.pdf`);
}

export { exportPlatformArchitecturePdf } from './architecturePdf';


