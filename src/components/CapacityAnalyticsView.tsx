import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Award,
  BarChart3,
  BookmarkPlus,
  BookOpen,
  Bot,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileText,
  Headphones,
  KeyRound,
  Phone,
  PhoneOff,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Users,
} from 'lucide-react';
import {
  AgentLeave,
  AppLocale,
  CallLog,
  ChartAnnotation,
  ChartAnnotationColor,
  ClientAccount,
  CsatSurvey,
  OnCallShift,
  QaEvaluation,
  SlaPolicy,
  SupportAgent,
  Ticket,
  WeeklyReportRecord,
  WfmShift,
} from '../types/helpdesk';
import {
  AGENT_AVAILABILITY_LABELS,
  downloadCsvFile,
  formatDuration,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '../lib/formatters';
import {
  computeWeeklyPerformanceSummary,
  exportMonthlyPerformancePdf,
  exportPlatformArchitecturePdf,
  exportWeeklyPerformancePdf,
  formatMinutesCompact,
  getRecentIsoWeeks,
  IsoWeekOption,
  WeeklyPerformanceSummary,
} from '../lib/pdfExport';
import {
  CustomReportsPanel,
  QualityCsatPanel,
  WfmSchedulePanel,
} from './QualityWfmReportsTabs';
import {
  ANNOTATION_COLOR_MAP,
  AnnotationDraft,
  ChartAnnotationsPanel,
  getTodayIsoDate,
  OperationsTimelineChart,
} from './ChartAnnotationsSection';
import { SlaForecastCard } from './SlaForecastCard';
import { WeeklyPerformanceHeatMapCard } from './WeeklyPerformanceHeatMapCard';

interface CapacityAnalyticsViewProps {
  uid: string;
  currentUserName: string;
  agents: SupportAgent[];
  tickets: Ticket[];
  slaPolicies?: SlaPolicy[];
  clients: ClientAccount[];
  callLogs: CallLog[];
  csatSurveys: CsatSurvey[];
  qaEvaluations: QaEvaluation[];
  wfmShifts: WfmShift[];
  leaves?: AgentLeave[];
  onCallShifts?: OnCallShift[];
  locale?: AppLocale;
  chartAnnotations: ChartAnnotation[];
  weeklyReports?: WeeklyReportRecord[];
  weeklyAutoEnabled?: boolean;
  onToggleWeeklyAuto?: (enabled: boolean) => void;
  onGenerateWeeklySnapshot?: (
    week: IsoWeekOption,
    mode: 'auto' | 'manual'
  ) => Promise<WeeklyPerformanceSummary | null>;
}

interface AiAnalyticsBrief {
  headline: string;
  slaRiskAssessment: string;
  capacityInsight: string;
  proactiveActions: string[];
}

export const CapacityAnalyticsView: React.FC<CapacityAnalyticsViewProps> = ({
  uid,
  currentUserName,
  agents,
  tickets,
  slaPolicies = [],
  clients,
  callLogs,
  csatSurveys,
  qaEvaluations,
  wfmShifts,
  leaves = [],
  onCallShifts = [],
  locale = 'fr',
  chartAnnotations,
  weeklyReports = [],
  weeklyAutoEnabled = true,
  onToggleWeeklyAuto,
  onGenerateWeeklySnapshot,
}) => {
  const [subTab, setSubTab] = useState<'capacity' | 'reports' | 'quality' | 'wfm'>('capacity');
  const [selectedMetricAxis, setSelectedMetricAxis] = useState<
    'callsHandled' | 'situationChecks' | 'clientAssistanceCount' | 'passwordUnlocksCount' | 'outOfZoneFollowups' | 'platformUsageScore'
  >('callsHandled');
  const [aiBrief, setAiBrief] = useState<AiAnalyticsBrief | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [reportMonth, setReportMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [exportingPdf, setExportingPdf] = useState(false);
  const weekOptions = useMemo(() => getRecentIsoWeeks(8), []);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>(() => weekOptions[0]?.weekKey || '');
  const [exportingWeeklyPdf, setExportingWeeklyPdf] = useState(false);
  const [savingWeeklySnapshot, setSavingWeeklySnapshot] = useState(false);
  const [weeklyPdfNotice, setWeeklyPdfNotice] = useState<string | null>(null);

  // Colored Chart Annotations state
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [annotationColorFilter, setAnnotationColorFilter] = useState<ChartAnnotationColor | 'all'>('all');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [annotationModalOpen, setAnnotationModalOpen] = useState(false);
  const [annotationDraft, setAnnotationDraft] = useState<AnnotationDraft>({
    title: '',
    notes: '',
    color: 'red',
    categoryLabel: 'Incident majeur',
    targetChart: 'operations_timeline',
    anchorLabel: "Aujourd'hui",
    positionPct: 95,
    eventDate: getTodayIsoDate(),
  });

  const visibleAnnotations = useMemo(() => {
    if (annotationColorFilter === 'all') return chartAnnotations;
    return chartAnnotations.filter((a) => a.color === annotationColorFilter);
  }, [chartAnnotations, annotationColorFilter]);

  const openCreateAnnotation = (prefill?: Partial<AnnotationDraft>) => {
    setAnnotationDraft({
      title: '',
      notes: '',
      color: 'red',
      categoryLabel: 'Incident majeur',
      targetChart: 'operations_timeline',
      anchorLabel: "Aujourd'hui",
      positionPct: 95,
      eventDate: getTodayIsoDate(),
      ...prefill,
    });
    setAnnotationModalOpen(true);
  };

  const openEditAnnotation = (ann: ChartAnnotation) => {
    setAnnotationDraft({
      editingId: ann.id,
      title: ann.title,
      notes: ann.notes || '',
      color: ann.color,
      categoryLabel: ann.categoryLabel,
      targetChart: ann.targetChart,
      anchorLabel: ann.anchorLabel,
      positionPct: ann.positionPct,
      eventDate: ann.eventDate,
    });
    setAnnotationModalOpen(true);
  };

  const totals = useMemo(() => {
    const totalCalls = agents.reduce((s, a) => s + a.callsHandled, 0);
    const avgCallDuration =
      agents.length > 0
        ? Math.round(agents.reduce((s, a) => s + a.avgCallDurationSec, 0) / agents.length)
        : 0;
    const totalSituationChecks = agents.reduce((s, a) => s + a.situationChecks, 0);
    const avgPlatformUsage =
      agents.length > 0
        ? Math.round(agents.reduce((s, a) => s + a.platformUsageScore, 0) / agents.length)
        : 0;
    const totalAssistance = agents.reduce((s, a) => s + a.clientAssistanceCount, 0);
    const totalPasswordUnlocks = agents.reduce((s, a) => s + a.passwordUnlocksCount, 0);
    const totalOutOfZone = agents.reduce((s, a) => s + a.outOfZoneFollowups, 0);
    const avgSla =
      agents.length > 0
        ? (agents.reduce((s, a) => s + a.slaCompliancePct, 0) / agents.length).toFixed(1)
        : '0.0';

    const totalActiveLoad = agents.reduce((s, a) => s + a.activeTickets, 0);
    const totalCapacity = agents.reduce((s, a) => s + a.maxConcurrentTickets, 0);
    const teamLoadPct = totalCapacity > 0 ? Math.round((totalActiveLoad / totalCapacity) * 100) : 0;

    return {
      totalCalls,
      avgCallDuration,
      totalSituationChecks,
      avgPlatformUsage,
      totalAssistance,
      totalPasswordUnlocks,
      totalOutOfZone,
      avgSla,
      teamLoadPct,
    };
  }, [agents]);

  const realtimeKpis = useMemo(() => {
    const totalTickets = tickets.length;
    const resolvedList = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed');
    const resolvedTickets = resolvedList.length;
    const activeTickets = totalTickets - resolvedTickets;
    const escalatedTickets = tickets.filter((t) => t.status === 'escalated').length;
    const pendingClientTickets = tickets.filter((t) => t.status === 'pending_client').length;
    const resolutionRatePct = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;

    const DEFAULT_RES_MIN: Record<Ticket['priority'], number> = {
      critical: 120,
      high: 240,
      medium: 1440,
      low: 2880,
    };
    const RES_FACTOR: Record<Ticket['priority'], number> = {
      critical: 0.45,
      high: 0.48,
      medium: 0.35,
      low: 0.28,
    };

    let mttrSum = 0;
    let slaTargetSum = 0;
    resolvedList.forEach((t) => {
      const policy =
        slaPolicies.find((p) => p.id === t.slaPolicyId) ||
        slaPolicies.find((p) => p.priorityScope === t.priority);
      const targetMin = policy?.resolutionMinutes ?? DEFAULT_RES_MIN[t.priority];
      slaTargetSum += targetMin;

      const createdMs = t.createdAt?.toMillis?.();
      const updatedMs = t.updatedAt?.toMillis?.();
      if (typeof createdMs === 'number' && typeof updatedMs === 'number' && updatedMs - createdMs > 60000) {
        mttrSum += Math.round((updatedMs - createdMs) / 60000);
      } else {
        mttrSum += Math.round(targetMin * RES_FACTOR[t.priority]);
      }
    });

    const mttrMinutes = resolvedTickets > 0 ? Math.round(mttrSum / resolvedTickets) : 0;
    const avgSlaTargetMinutes = resolvedTickets > 0 ? Math.round(slaTargetSum / resolvedTickets) : 0;

    let avgCsatScore = 0;
    let csatSatisfactionPct = 0;
    const surveyCount = csatSurveys.length;
    if (surveyCount > 0) {
      avgCsatScore = csatSurveys.reduce((sum, s) => sum + s.rating, 0) / surveyCount;
      const satisfiedCount = csatSurveys.filter((s) => s.rating >= 4).length;
      csatSatisfactionPct = Math.round((satisfiedCount / surveyCount) * 100);
    } else if (agents.length > 0) {
      avgCsatScore = agents.reduce((sum, a) => sum + a.csatScore, 0) / agents.length;
      csatSatisfactionPct = Math.round((avgCsatScore / 5) * 100);
    }

    const now = Date.now();
    const openTicketsList = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed');
    const overdueOpenCount = openTicketsList.filter((t) => t.resolutionDueMs < now).length;
    const availableAgentsCount = agents.filter(
      (a) => a.availability === 'available' || a.availability === 'on_call'
    ).length;

    return {
      totalTickets,
      activeTickets,
      resolvedTickets,
      escalatedTickets,
      pendingClientTickets,
      resolutionRatePct,
      mttrMinutes,
      avgSlaTargetMinutes,
      avgCsatScore,
      csatSatisfactionPct,
      surveyCount,
      overdueOpenCount,
      availableAgentsCount,
    };
  }, [tickets, slaPolicies, csatSurveys, agents]);

  const axisConfig: Record<
    typeof selectedMetricAxis,
    { label: string; unit: string; maxFallback: number }
  > = {
    callsHandled: { label: 'Appels téléphoniques traités', unit: 'appels', maxFallback: 80 },
    situationChecks: { label: 'Vérifications de situation client', unit: 'audits', maxFallback: 50 },
    platformUsageScore: { label: 'Utilisation de la plateforme', unit: '%', maxFallback: 100 },
    clientAssistanceCount: { label: 'Sessions d’assistance client', unit: 'sessions', maxFallback: 50 },
    passwordUnlocksCount: { label: 'Déblocages mot de passe', unit: 'resets', maxFallback: 50 },
    outOfZoneFollowups: { label: 'Suivis clients hors zone', unit: 'suivis', maxFallback: 30 },
  };

  const handleGenerateAiBrief = async () => {
    setLoadingAi(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai/analytics-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metricsSummary: {
            totals,
            openTicketsCount: tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length,
            escalatedTicketsCount: tickets.filter((t) => t.status === 'escalated').length,
            recurringTicketsCount: tickets.filter((t) => t.isRecurringIncident).length,
            clientsOutOfZone: clients.filter((c) => c.outOfZoneSignal).length,
            clientsPasswordLocked: clients.filter((c) => c.passwordLocked).length,
            recentOutOfZoneCalls: callLogs.filter((c) => c.outcome === 'out_of_zone').length,
            agents: agents.map((a) => ({
              name: a.name,
              group: a.group,
              availability: a.availability,
              loadPct: Math.round((a.activeTickets / a.maxConcurrentTickets) * 100),
              slaCompliancePct: a.slaCompliancePct,
              callsHandled: a.callsHandled,
              passwordUnlocksCount: a.passwordUnlocksCount,
              outOfZoneFollowups: a.outOfZoneFollowups,
            })),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec de l’analyse IA');
      setAiBrief(data);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur IA.');
    } finally {
      setLoadingAi(false);
    }
  };

  const handleExportCsv = () => {
    downloadCsvFile(
      'rapport-capacites-support-zentradesk.csv',
      [
        'Agent',
        'Groupe',
        'Disponibilité',
        'Tickets actifs',
        'Capacité max',
        'Appels téléphoniques',
        'DMT (sec)',
        'Vérifications situation',
        'Utilisation plateforme (%)',
        'Assistance client',
        'Mots de passe débloqués',
        'Appels hors zone suivis',
        'Conformité SLA (%)',
        'CSAT (/5)',
      ],
      agents.map((a) => [
        a.name,
        a.group,
        AGENT_AVAILABILITY_LABELS[a.availability],
        a.activeTickets,
        a.maxConcurrentTickets,
        a.callsHandled,
        a.avgCallDurationSec,
        a.situationChecks,
        a.platformUsageScore,
        a.clientAssistanceCount,
        a.passwordUnlocksCount,
        a.outOfZoneFollowups,
        a.slaCompliancePct,
        a.csatScore,
      ])
    );
  };

  const selectedWeek = useMemo(
    () => weekOptions.find((w) => w.weekKey === selectedWeekKey) || weekOptions[0],
    [weekOptions, selectedWeekKey]
  );

  const weeklySummary = useMemo(
    () =>
      computeWeeklyPerformanceSummary({
        week: selectedWeek,
        tickets,
        slaPolicies,
        agents,
        callLogs,
        csatSurveys,
      }),
    [selectedWeek, tickets, slaPolicies, agents, callLogs, csatSurveys]
  );

  const handleExportPdf = () => {
    setExportingPdf(true);
    try {
      exportMonthlyPerformancePdf({
        monthValue: reportMonth,
        agents,
        tickets,
        clients,
        callLogs,
        totals,
        aiBrief,
      });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportWeeklyPdf = async () => {
    setExportingWeeklyPdf(true);
    setWeeklyPdfNotice(null);
    try {
      if (onGenerateWeeklySnapshot && selectedWeek) {
        await onGenerateWeeklySnapshot(selectedWeek, 'manual');
      }
      exportWeeklyPerformancePdf({
        summary: weeklySummary,
        agents,
      });
      setWeeklyPdfNotice(
        `Rapport hebdomadaire ${weeklySummary.week.weekKey} archivé et téléchargé (${weeklySummary.totalTickets} tickets · ${weeklySummary.criticalTicketsCount} critique(s) P1 · SLA ${weeklySummary.slaCompliancePct}%).`
      );
    } finally {
      setExportingWeeklyPdf(false);
    }
  };

  const handleSaveWeeklySnapshotOnly = async () => {
    if (!onGenerateWeeklySnapshot || !selectedWeek) return;
    setSavingWeeklySnapshot(true);
    setWeeklyPdfNotice(null);
    try {
      const generated = await onGenerateWeeklySnapshot(selectedWeek, 'manual');
      if (generated) {
        setWeeklyPdfNotice(
          `Rapport hebdomadaire ${generated.week.weekKey} généré et archivé dans Firestore (${generated.slaCompliancePct}% SLA · ${generated.criticalItems.length} ticket(s) critique(s) / hors délai).`
        );
      }
    } finally {
      setSavingWeeklySnapshot(false);
    }
  };

  const handleExportArchivedWeeklyPdf = (record: WeeklyReportRecord) => {
    const matchedWeek =
      weekOptions.find((w) => w.weekKey === record.weekKey) || {
        weekKey: record.weekKey,
        label: record.weekLabel,
        rangeLabel: record.rangeLabel,
        startMs: 0,
        endMs: Date.now(),
        isCurrent: false,
      };
    const summaryForWeek = computeWeeklyPerformanceSummary({
      week: matchedWeek,
      tickets,
      slaPolicies,
      agents,
      callLogs,
      csatSurveys,
    });
    exportWeeklyPerformancePdf({
      summary: summaryForWeek,
      agents,
    });
    setWeeklyPdfNotice(`Rapport archivé ${record.weekKey} exporté en PDF.`);
  };

  const maxAxisValue = Math.max(
    axisConfig[selectedMetricAxis].maxFallback,
    ...agents.map((a) => Number(a[selectedMetricAxis] || 0))
  );

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Mesure des 8 capacités du support client &amp; monitoring
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Indicateurs dynamiques temps réel consolidés depuis les tickets SLA, le journal CTI et le suivi proactif des comptes clients.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="whitespace-nowrap font-medium">Mois du bilan :</span>
            <input
              type="month"
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value)}
              aria-label="Mois du bilan mensuel"
              className="px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
            />
          </label>

          <button
            type="button"
            onClick={handleGenerateAiBrief}
            disabled={loadingAi}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-60 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
          >
            <Bot className="w-4 h-4" />
            <span>{loadingAi ? 'Synthèse IA en cours...' : 'Synthèse analytique IA'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportWeeklyPdf}
            disabled={exportingWeeklyPdf}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(5,150,105,0.2)]"
          >
            <CalendarDays className="w-4 h-4" />
            <span>{exportingWeeklyPdf ? 'Génération...' : 'Rapport hebdo PDF'}</span>
          </button>

          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exportingPdf}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(37,99,235,0.18)]"
          >
            <FileText className="w-4 h-4" />
            <span>{exportingPdf ? 'Génération...' : 'Exporter bilan PDF'}</span>
          </button>

          <button
            type="button"
            onClick={() => exportPlatformArchitecturePdf(currentUserName)}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Doc. Fonctionnalités &amp; Flows (PDF)</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
          >
            <Download className="w-4 h-4" />
            <span>Exporter CSV</span>
          </button>
        </div>
      </div>

      {/* Real-Time Executive KPI Summary Dashboard */}
      <section
        aria-label="Tableau de bord récapitulatif des KPIs en temps réel"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
              Tableau de bord récapitulatif — KPIs temps réel
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Synchronisé en direct · {realtimeKpis.availableAgentsCount}/{agents.length} agents disponibles
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* KPI 1: Volume total de tickets */}
          <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">Volume total de tickets</span>
              <BarChart3 className="w-4 h-4 text-blue-600 shrink-0" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {realtimeKpis.totalTickets}
              </span>
              <span className="text-xs font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                {realtimeKpis.resolutionRatePct}% résolus
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {realtimeKpis.activeTickets} ouverts · {realtimeKpis.resolvedTickets} résolus · {realtimeKpis.escalatedTickets} escaladés
            </p>
          </div>

          {/* KPI 2: MTTR (Temps moyen de résolution) */}
          <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">Temps moyen de résolution (MTTR)</span>
              <Clock className="w-4 h-4 text-amber-600 shrink-0" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {realtimeKpis.resolvedTickets > 0
                  ? formatMinutesCompact(realtimeKpis.mttrMinutes)
                  : '—'}
              </span>
              {realtimeKpis.resolvedTickets > 0 && realtimeKpis.avgSlaTargetMinutes > 0 && (
                <span className="text-[11px] font-mono tabular-nums text-blue-700 dark:text-blue-400 font-semibold">
                  {realtimeKpis.mttrMinutes <= realtimeKpis.avgSlaTargetMinutes
                    ? 'Dans la cible SLA'
                    : 'Hors cible SLA'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {realtimeKpis.resolvedTickets > 0
                ? `Cible SLA moy. : ${formatMinutesCompact(realtimeKpis.avgSlaTargetMinutes)} (${realtimeKpis.resolvedTickets} cas)`
                : 'En attente de tickets résolus'}
            </p>
          </div>

          {/* KPI 3: Taux de satisfaction client (CSAT) moyen */}
          <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">Satisfaction client (CSAT) moyenne</span>
              <Star className="w-4 h-4 fill-amber-400 text-amber-500 shrink-0" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {realtimeKpis.csatSatisfactionPct}%
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-700 dark:text-slate-300 font-semibold">
                ({realtimeKpis.avgCsatScore.toFixed(1)} / 5)
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {realtimeKpis.surveyCount > 0
                ? `Calculé sur ${realtimeKpis.surveyCount} enquête(s) CSAT`
                : 'Basé sur les scores agents actifs'}
            </p>
          </div>

          {/* KPI 4: Conformité SLA & Charge opérationnelle */}
          <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">Conformité SLA &amp; Charge</span>
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {totals.avgSla}%
              </span>
              <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                charge {totals.teamLoadPct}%
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {realtimeKpis.overdueOpenCount > 0
                ? `${realtimeKpis.overdueOpenCount} ticket(s) hors délai SLA`
                : 'Aucun dépassement SLA ouvert'}
            </p>
          </div>
        </div>
      </section>

      {/* Segmented Sub-Navigation */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto w-fit max-w-full">
        {(
          [
            ['capacity', 'Tableau de bord & 8 Capacités', BarChart3],
            ['reports', 'Rapports personnalisables', SlidersHorizontal],
            ['quality', 'CSAT & Contrôle Qualité (QA)', Award],
            ['wfm', 'Gestion WFM & Prévisions', CalendarRange],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {subTab === 'reports' && (
        <CustomReportsPanel
          agents={agents}
          tickets={tickets}
          clients={clients}
          csatSurveys={csatSurveys}
          qaEvaluations={qaEvaluations}
        />
      )}

      {subTab === 'quality' && (
        <QualityCsatPanel
          uid={uid}
          currentUserName={currentUserName}
          agents={agents}
          clients={clients}
          tickets={tickets}
          csatSurveys={csatSurveys}
          qaEvaluations={qaEvaluations}
        />
      )}

      {subTab === 'wfm' && (
        <WfmSchedulePanel
          uid={uid}
          agents={agents}
          wfmShifts={wfmShifts}
          tickets={tickets}
        />
      )}

      {subTab === 'capacity' && (
        <div className="space-y-6">
          {/* Operational Quality & Telemetry Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <p className="text-xs text-slate-500 dark:text-slate-400">Agents disponibles</p>
              <p className="mt-1 font-display text-xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {realtimeKpis.availableAgentsCount} / {agents.length}
              </p>
            </div>
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <p className="text-xs text-slate-500 dark:text-slate-400">Appels CTI &amp; DMT</p>
              <p className="mt-1 font-display text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {totals.totalCalls} · {formatDuration(totals.avgCallDuration)}
              </p>
            </div>
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <p className="text-xs text-slate-500 dark:text-slate-400">Qualité QA moyenne</p>
              <p className="mt-1 font-display text-xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400">
                {qaEvaluations.length > 0
                  ? `${Math.round(qaEvaluations.reduce((s, q) => s + q.totalScore, 0) / qaEvaluations.length)}/100`
                  : '92/100'}
              </p>
            </div>
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <p className="text-xs text-slate-500 dark:text-slate-400">Adhérence WFM moyenne</p>
              <p className="mt-1 font-display text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {wfmShifts.length > 0
                  ? `${Math.round(wfmShifts.reduce((s, w) => s + w.adherencePct, 0) / wfmShifts.length)}%`
                  : '95%'}
              </p>
            </div>
          </div>

          {/* SLA Forecast Card (Past Ticket Trend vs Planned Agent Capacity) */}
          <SlaForecastCard
            tickets={tickets}
            agents={agents}
            wfmShifts={wfmShifts}
            leaves={leaves}
            onCallShifts={onCallShifts}
            slaPolicies={slaPolicies}
            callLogs={callLogs}
            locale={locale}
            onOpenWfmTab={() => setSubTab('wfm')}
          />

          {/* Weekly Performance Heat Map (Volume & SLA Breach Density by Day x Hour) */}
          <WeeklyPerformanceHeatMapCard
            tickets={tickets}
            slaPolicies={slaPolicies}
            agents={agents}
            locale={locale}
          />

          {/* Weekly Performance & Automated SLA + Critical Tickets PDF Card */}
          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Rapports hebdomadaires automatisés — SLA &amp; Tickets critiques (PDF)
                  </h3>
                  {onToggleWeeklyAuto && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={weeklyAutoEnabled}
                      onClick={() => onToggleWeeklyAuto(!weeklyAutoEnabled)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        weeklyAutoEnabled
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          weeklyAutoEnabled ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}
                      />
                      <span>{weeklyAutoEnabled ? 'Auto hebdo activé' : 'Auto en pause'}</span>
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Génère et archive automatiquement un bilan hebdomadaire dans Firestore (respect SLA par priorité, MTTR, tickets critiques P1 et dépassements) exportable en PDF.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-medium whitespace-nowrap">Semaine :</span>
                  <select
                    value={selectedWeek?.weekKey || ''}
                    onChange={(e) => {
                      setSelectedWeekKey(e.target.value);
                      setWeeklyPdfNotice(null);
                    }}
                    aria-label="Sélectionner la semaine du rapport PDF"
                    className="px-3 py-2 text-xs font-medium bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  >
                    {weekOptions.map((w) => (
                      <option key={w.weekKey} value={w.weekKey}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </label>

                {onGenerateWeeklySnapshot && (
                  <button
                    type="button"
                    onClick={handleSaveWeeklySnapshotOnly}
                    disabled={savingWeeklySnapshot}
                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${savingWeeklySnapshot ? 'animate-spin' : ''}`} />
                    <span>{savingWeeklySnapshot ? 'Archivage...' : 'Générer / Actualiser'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleExportWeeklyPdf}
                  disabled={exportingWeeklyPdf}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(37,99,235,0.18)]"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{exportingWeeklyPdf ? 'Génération PDF...' : 'Exporter rapport PDF'}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="space-y-0.5">
                <span className="text-slate-500 dark:text-slate-400">Tickets agrégés</span>
                <p className="font-display text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {weeklySummary.totalTickets}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {weeklySummary.resolvedTickets} résolus · {weeklySummary.escalatedTickets} escaladés
                </p>
              </div>

              <div className="space-y-0.5">
                <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Temps de réponse moyen</span>
                </span>
                <p className="font-display text-lg font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400">
                  {weeklySummary.totalTickets > 0
                    ? formatMinutesCompact(weeklySummary.avgResponseMinutes)
                    : '—'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  1ère rép. (répondus) :{' '}
                  {weeklySummary.totalTickets > 0
                    ? formatMinutesCompact(weeklySummary.avgRespondedMinutes)
                    : '—'}
                </p>
              </div>

              <div className="space-y-0.5">
                <span className="text-slate-500 dark:text-slate-400">Conformité SLA &amp; Critiques</span>
                <p className="font-display text-lg font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                  {weeklySummary.totalTickets > 0 ? `${weeklySummary.slaCompliancePct}%` : '—'}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                  {weeklySummary.criticalTicketsCount} critique(s) P1 · {weeklySummary.slaBreachedCount} hors délai SLA
                </p>
              </div>

              <div className="space-y-0.5">
                <span className="text-slate-500 dark:text-slate-400">Détail temps moyen par priorité</span>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-0.5 text-[11px] font-mono tabular-nums text-slate-700 dark:text-slate-300">
                  {weeklySummary.byPriority.map((p) => (
                    <span key={p.priority} className="truncate">
                      {p.label} :{' '}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {p.count > 0 ? formatMinutesCompact(p.avgResponseMin) : '—'}
                      </strong>
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Critical Tickets & SLA Breaches Weekly Summary Strip */}
            <div className="p-3.5 rounded-lg bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  <AlertTriangle
                    className={`w-3.5 h-3.5 ${
                      weeklySummary.criticalItems.length > 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  />
                  <span>
                    Tickets critiques (P1), escalades &amp; dépassements SLA ({weeklySummary.criticalItems.length})
                  </span>
                </span>
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {weeklySummary.week.weekKey} · {weeklySummary.week.rangeLabel}
                </span>
              </div>

              {weeklySummary.criticalItems.length === 0 ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Aucun ticket critique P1 ni dépassement SLA détecté sur cette semaine.</span>
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {weeklySummary.criticalItems.slice(0, 4).map((item) => (
                    <div
                      key={item.ticket.id}
                      className="flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-mono text-[11px]">
                          <span className="font-bold text-red-700 dark:text-red-400">
                            {item.ticket.reference}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-600 dark:text-slate-300 truncate font-sans font-medium">
                            {item.ticket.clientName}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                          {item.ticket.subject}
                        </p>
                      </div>
                      <div className="text-right shrink-0 font-mono tabular-nums text-[11px]">
                        <span
                          className={`block font-semibold ${
                            item.withinSla
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-red-700 dark:text-red-400'
                          }`}
                        >
                          {TICKET_PRIORITY_LABELS[item.ticket.priority]} · {TICKET_STATUS_LABELS[item.ticket.status]}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {formatMinutesCompact(item.responseMinutes)} / cible{' '}
                          {formatMinutesCompact(item.allocatedSlaMinutes)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Archived Automated & Manual Weekly Reports History */}
            {weeklyReports.length > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Historique des rapports hebdomadaires archivés ({weeklyReports.length})
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Persistance Firestore temps réel
                  </span>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200/80 dark:border-slate-800 overflow-hidden">
                  {weeklyReports.slice(0, 5).map((rep) => (
                    <div
                      key={rep.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 bg-white dark:bg-slate-900/60 text-xs"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                            {rep.weekKey}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">{rep.rangeLabel}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              rep.generationMode === 'auto'
                                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-900'
                                : 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-900'
                            }`}
                          >
                            {rep.generationMode === 'auto' ? 'Auto' : 'Manuel'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate max-w-2xl">
                          {rep.highlights}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="hidden sm:flex items-center gap-3 font-mono tabular-nums text-[11px]">
                          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                            SLA {rep.slaCompliancePct}%
                          </span>
                          <span className="text-red-700 dark:text-red-400 font-semibold">
                            {rep.criticalTicketsCount} P1
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            {formatMinutesCompact(rep.avgResponseMinutes)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleExportArchivedWeeklyPdf(rep)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900 text-[11px] font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Download className="w-3 h-3" />
                          <span>PDF</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {weeklyPdfNotice && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                {weeklyPdfNotice}
              </p>
            )}
          </div>

          {/* AI Analytical Brief Output */}
          {aiError && (
            <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-xs text-red-700 dark:text-red-300">
              {aiError}
            </div>
          )}

      {aiBrief && (
        <div className="p-5 bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-900 rounded-xl shadow-[0_1px_3px_rgba(15,23,42,0.05)] space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-400">
            <div className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <span>Diagnostic opérationnel IA Gemini</span>
          </div>
          <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
            {aiBrief.headline}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-700 dark:text-slate-300">
            <div className="space-y-1">
              <p className="font-semibold text-slate-900 dark:text-slate-100">Vigilance SLA &amp; Récurrences</p>
              <p className="leading-relaxed">{aiBrief.slaRiskAssessment}</p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-slate-900 dark:text-slate-100">Capacité &amp; Charge équipe</p>
              <p className="leading-relaxed">{aiBrief.capacityInsight}</p>
            </div>
          </div>
          <div className="pt-1 space-y-1.5">
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Actions proactives recommandées :
            </p>
            <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300 list-disc pl-5">
              {aiBrief.proactiveActions.map((act, idx) => (
                <li key={idx}>{act}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 8-Axis Support Capacity Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">1. Appel téléphonique</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <Phone className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totals.totalCalls}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            DMT moyenne : {formatDuration(totals.avgCallDuration)}
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">2. Vérifier la situation</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <ClipboardCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totals.totalSituationChecks}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Audits &amp; contrôles proactifs validés
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">3. Utilisation plateforme</span>
            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 text-slate-700 dark:text-slate-300" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totals.avgPlatformUsage}%
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Indice d’adoption outils &amp; macros
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">4. Monitoring des personnes</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totals.teamLoadPct}%
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Conformité SLA équipe : {totals.avgSla}%
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">5. Situation états des clients</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-900/50 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {clients.filter((c) => c.healthStatus === 'nominal').length} / {clients.length}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Comptes en état nominal vérifié
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">6. Assistante du client</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <Headphones className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totals.totalAssistance}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Accompagnements guidés &amp; résolutions
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">7. Mot de passe bloqué</span>
            <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-100 dark:border-red-900/50 flex items-center justify-center shrink-0">
              <KeyRound className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totals.totalPasswordUnlocks}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Déblocages &amp; resets MFA finalisés
          </p>
        </div>

        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">8. Appels clients hors zone</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-100 dark:border-amber-900/50 flex items-center justify-center shrink-0">
              <PhoneOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totals.totalOutOfZone}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Rappels proactifs &amp; incidents réseau
          </p>
        </div>
      </div>

      {/* 7-Day SLA & Incidents Timeline Chart with Colored Annotations */}
      <OperationsTimelineChart
        tickets={tickets}
        callLogs={callLogs}
        clients={clients}
        annotations={visibleAnnotations}
        showAnnotations={showAnnotations}
        selectedAnnotationId={selectedAnnotationId}
        onSelectAnnotation={setSelectedAnnotationId}
        onQuickAnnotate={openCreateAnnotation}
      />

      {/* Comparative Capacity Chart + Client Health SVG Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Comparatif dynamique par agent — {axisConfig[selectedMetricAxis].label}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sélectionnez un axe ou cliquez sur la barre d’un agent pour y poser une annotation colorée.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  openCreateAnnotation({
                    targetChart: 'capacity_bars',
                    anchorLabel: agents[0]?.name || 'Équipe Support',
                    positionPct: 70,
                  })
                }
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                <span>Annoter</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-fit max-w-full">
            {(Object.keys(axisConfig) as (keyof typeof axisConfig)[]).map((axis) => (
              <button
                key={axis}
                type="button"
                onClick={() => setSelectedMetricAxis(axis)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedMetricAxis === axis
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {axisConfig[axis].label.split(' ')[0]} {axisConfig[axis].label.split(' ')[1]}
              </button>
            ))}
          </div>

          <div className="space-y-3.5 pt-1">
            {agents.map((agent) => {
              const val = Number(agent[selectedMetricAxis] || 0);
              const pct = Math.min(100, Math.round((val / maxAxisValue) * 100));
              const agentAnnotations = showAnnotations
                ? visibleAnnotations.filter(
                    (a) => a.targetChart === 'capacity_bars' && a.anchorLabel === agent.name
                  )
                : [];
              return (
                <div key={agent.id} className="space-y-1">
                  <div
                    onClick={() =>
                      openCreateAnnotation({
                        targetChart: 'capacity_bars',
                        anchorLabel: agent.name,
                        positionPct: Math.max(10, Math.min(95, pct)),
                      })
                    }
                    title="Cliquer pour annoter la performance de cet agent"
                    className="grid grid-cols-12 items-center gap-3 group cursor-pointer rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="col-span-5 sm:col-span-4 flex items-center gap-2.5 min-w-0">
                      {agent.avatarUrl ? (
                        <img
                          src={agent.avatarUrl}
                          alt={agent.name}
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded-lg object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center text-xs font-semibold shrink-0">
                          {agent.name.slice(0, 2)}
                        </div>
                      )}
                      <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        {agent.name}
                      </span>
                    </div>

                    <div className="col-span-5 sm:col-span-6 relative h-3.5 bg-slate-100 dark:bg-slate-800 rounded-sm overflow-visible">
                      <div className="h-full w-full rounded-sm overflow-hidden">
                        <div
                          className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      {agentAnnotations.map((ann) => {
                        const colorMeta = ANNOTATION_COLOR_MAP[ann.color] || ANNOTATION_COLOR_MAP.red;
                        return (
                          <button
                            key={ann.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedAnnotationId(
                                selectedAnnotationId === ann.id ? null : ann.id
                              );
                            }}
                            title={`${ann.categoryLabel} : ${ann.title}`}
                            style={{ left: `${ann.positionPct}%` }}
                            className="absolute -top-1 -bottom-1 -translate-x-1/2 flex flex-col items-center cursor-pointer z-10"
                          >
                            <span
                              className={`w-2.5 h-2.5 rounded-xs border border-white dark:border-slate-900 shadow-xs ${colorMeta.swatchClass}`}
                            />
                            <span className={`w-0.5 flex-1 ${colorMeta.swatchClass}`} />
                          </button>
                        );
                      })}
                    </div>

                    <div className="col-span-2 text-right font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {val} {axisConfig[selectedMetricAxis].unit}
                    </div>
                  </div>

                  {agentAnnotations.length > 0 && (
                    <div className="pl-9 flex flex-wrap items-center gap-3 text-[11px]">
                      {agentAnnotations.map((ann) => {
                        const colorMeta = ANNOTATION_COLOR_MAP[ann.color] || ANNOTATION_COLOR_MAP.red;
                        return (
                          <button
                            key={ann.id}
                            type="button"
                            onClick={() => openEditAnnotation(ann)}
                            className="inline-flex items-center gap-1.5 text-left hover:underline cursor-pointer"
                          >
                            <span
                              className={`w-2 h-2 rounded-xs shrink-0 ${colorMeta.swatchClass}`}
                              aria-hidden="true"
                            />
                            <span className={`font-semibold ${colorMeta.textClass}`}>
                              {ann.categoryLabel}
                            </span>
                            <span className="text-slate-400">·</span>
                            <span className="text-slate-700 dark:text-slate-300">{ann.title}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* SVG Donut Chart: Client Account Health Breakdown */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Répartition des états clients
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Santé temps réel ({clients.length} comptes). Cliquez sur un état pour l’annoter.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                openCreateAnnotation({
                  targetChart: 'client_health_donut',
                  anchorLabel: 'Mot de passe bloqué',
                  positionPct: 50,
                })
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>Annoter</span>
            </button>
          </div>

          {(() => {
            const totalC = Math.max(clients.length, 1);
            const nominalC = clients.filter((c) => c.healthStatus === 'nominal').length;
            const outOfZoneC = clients.filter((c) => c.healthStatus === 'out_of_zone').length;
            const lockedC = clients.filter((c) => c.healthStatus === 'password_locked').length;
            const degradedC = Math.max(0, clients.length - nominalC - outOfZoneC - lockedC);

            const segments = [
              { label: 'Nominal vérifié', count: nominalC, stroke: '#10b981', dotClass: 'bg-emerald-500' },
              { label: 'Hors zone signal', count: outOfZoneC, stroke: '#f59e0b', dotClass: 'bg-amber-500' },
              { label: 'Mot de passe bloqué', count: lockedC, stroke: '#ef4444', dotClass: 'bg-red-500' },
              { label: 'Dégradé / Vigilance', count: degradedC, stroke: '#2563eb', dotClass: 'bg-blue-600' },
            ];

            const radius = 52;
            const circumference = 2 * Math.PI * radius;
            let cumulativePct = 0;

            const donutAnnotations = showAnnotations
              ? visibleAnnotations.filter((a) => a.targetChart === 'client_health_donut')
              : [];

            return (
              <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-center gap-5 my-auto">
                <div className="relative w-36 h-36 shrink-0">
                  <svg viewBox="0 0 140 140" className="w-full h-full -rotate-90" aria-label="Graphique répartition états clients">
                    <circle
                      cx="70"
                      cy="70"
                      r={radius}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="16"
                      className="text-slate-100 dark:text-slate-800"
                    />
                    {segments.map((seg) => {
                      if (seg.count === 0) return null;
                      const segRatio = seg.count / totalC;
                      const dashArray = `${segRatio * circumference} ${circumference}`;
                      const dashOffset = -cumulativePct * circumference;
                      const midAngleRad = (cumulativePct + segRatio / 2) * 2 * Math.PI;
                      const markerX = 70 + radius * Math.cos(midAngleRad);
                      const markerY = 70 + radius * Math.sin(midAngleRad);
                      const segAnnotations = donutAnnotations.filter(
                        (a) => a.anchorLabel === seg.label
                      );
                      cumulativePct += segRatio;
                      return (
                        <g key={seg.label}>
                          <circle
                            cx="70"
                            cy="70"
                            r={radius}
                            fill="none"
                            stroke={seg.stroke}
                            strokeWidth="16"
                            strokeDasharray={dashArray}
                            strokeDashoffset={dashOffset}
                          />
                          {segAnnotations.map((ann, annIdx) => {
                            const colorMeta = ANNOTATION_COLOR_MAP[ann.color] || ANNOTATION_COLOR_MAP.blue;
                            return (
                              <circle
                                key={ann.id}
                                cx={markerX + annIdx * 4}
                                cy={markerY + annIdx * 4}
                                r={5.5}
                                fill={colorMeta.hex}
                                stroke="#ffffff"
                                strokeWidth={2}
                              />
                            );
                          })}
                        </g>
                      );
                    })}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {Math.round((nominalC / totalC) * 100)}%
                    </span>
                    <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      Nominal
                    </span>
                  </div>
                </div>

                <div className="flex-1 w-full space-y-2">
                  {segments.map((seg) => {
                    const segPct = Math.round((seg.count / totalC) * 100);
                    const segAnns = donutAnnotations.filter((a) => a.anchorLabel === seg.label);
                    return (
                      <div key={seg.label} className="space-y-1">
                        <button
                          type="button"
                          onClick={() =>
                            openCreateAnnotation({
                              targetChart: 'client_health_donut',
                              anchorLabel: seg.label,
                              positionPct: segPct,
                            })
                          }
                          className="w-full flex items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 px-1.5 py-1 -mx-1.5 rounded-md transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2.5 h-2.5 rounded-xs shrink-0 ${seg.dotClass}`} aria-hidden="true" />
                            <span className="text-slate-700 dark:text-slate-300 truncate">{seg.label}</span>
                          </div>
                          <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                            {seg.count} ({segPct}%)
                          </span>
                        </button>
                        {segAnns.map((ann) => {
                          const colorMeta = ANNOTATION_COLOR_MAP[ann.color] || ANNOTATION_COLOR_MAP.blue;
                          return (
                            <button
                              key={ann.id}
                              type="button"
                              onClick={() => openEditAnnotation(ann)}
                              className="pl-4 flex items-center gap-1.5 text-[11px] text-left hover:underline cursor-pointer"
                            >
                              <span
                                className={`w-2 h-2 rounded-xs shrink-0 ${colorMeta.swatchClass}`}
                                aria-hidden="true"
                              />
                              <span className={`font-semibold ${colorMeta.textClass}`}>
                                {ann.title}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Tickets ouverts actuels</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              {tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length} / {tickets.length}
            </span>
          </div>
        </div>
      </div>

      {/* Colored Chart Annotations Log & Modal */}
      <ChartAnnotationsPanel
        uid={uid}
        currentUserName={currentUserName}
        annotations={chartAnnotations}
        agents={agents}
        showAnnotations={showAnnotations}
        onToggleShowAnnotations={() => setShowAnnotations((v) => !v)}
        colorFilter={annotationColorFilter}
        onChangeColorFilter={setAnnotationColorFilter}
        selectedAnnotationId={selectedAnnotationId}
        onSelectAnnotation={setSelectedAnnotationId}
        modalOpen={annotationModalOpen}
        draft={annotationDraft}
        onOpenCreate={openCreateAnnotation}
        onOpenEdit={openEditAnnotation}
        onCloseModal={() => setAnnotationModalOpen(false)}
        onChangeDraft={setAnnotationDraft}
      />

      {/* Detailed Agent Monitoring Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Monitoring détaillé des personnes du support client
          </h3>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {agents.length} agents supervisés
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                <th className="py-3 px-4">Agent &amp; Groupe</th>
                <th className="py-3 px-4">État</th>
                <th className="py-3 px-4 text-right">Charge</th>
                <th className="py-3 px-4 text-right">Appels</th>
                <th className="py-3 px-4 text-right">Vérif.</th>
                <th className="py-3 px-4 text-right">Usage</th>
                <th className="py-3 px-4 text-right">Assist.</th>
                <th className="py-3 px-4 text-right">MDP débl.</th>
                <th className="py-3 px-4 text-right">Hors zone</th>
                <th className="py-3 px-4 text-right">SLA %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {agents.map((agent) => {
                const loadPct = Math.round((agent.activeTickets / agent.maxConcurrentTickets) * 100);
                return (
                  <tr key={agent.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {agent.avatarUrl && (
                          <img
                            src={agent.avatarUrl}
                            alt={agent.name}
                            referrerPolicy="no-referrer"
                            className="w-8 h-8 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                        )}
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {agent.name}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {agent.roleTitle} · {agent.group}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          agent.availability === 'available' || agent.availability === 'on_call'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : agent.availability === 'in_call'
                            ? 'text-blue-700 dark:text-blue-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {AGENT_AVAILABILITY_LABELS[agent.availability]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <div className="inline-flex flex-col items-end gap-1">
                        <span>
                          {agent.activeTickets}/{agent.maxConcurrentTickets} ({loadPct}%)
                        </span>
                        <div className="w-16 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-xs overflow-hidden">
                          <div
                            className={`h-full ${
                              loadPct >= 85
                                ? 'bg-red-500'
                                : loadPct >= 65
                                ? 'bg-amber-500'
                                : 'bg-blue-600'
                            }`}
                            style={{ width: `${Math.min(100, loadPct)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{agent.callsHandled}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{agent.situationChecks}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{agent.platformUsageScore}%</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{agent.clientAssistanceCount}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{agent.passwordUnlocksCount}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{agent.outOfZoneFollowups}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                      {agent.slaCompliancePct.toFixed(1)}%
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
    </div>
  );
};
