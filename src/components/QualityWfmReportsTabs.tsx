import React, { useMemo, useState } from 'react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Award,
  BarChart3,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  GraduationCap,
  Plus,
  SlidersHorizontal,
  Star,
  TrendingUp,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ClientAccount,
  CsatSurvey,
  QaEvaluation,
  SupportAgent,
  SupportGroup,
  Ticket,
  WfmActivityType,
  WfmShift,
} from '../types/helpdesk';
import { downloadCsvFile, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from '../lib/formatters';
import { clampString } from '../lib/validation';
import { recordAuditLog } from '../lib/kbSuggestions';
import { exportMonthlyPerformancePdf } from '../lib/pdfExport';

interface CustomReportsPanelProps {
  agents: SupportAgent[];
  tickets: Ticket[];
  clients: ClientAccount[];
  csatSurveys: CsatSurvey[];
  qaEvaluations: QaEvaluation[];
}

export const CustomReportsPanel: React.FC<CustomReportsPanelProps> = ({
  agents,
  tickets,
  clients,
  csatSurveys,
  qaEvaluations,
}) => {
  const [groupFilter, setGroupFilter] = useState<'all' | SupportGroup>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [horizon, setHorizon] = useState<'7d' | '30d' | 'quarter'>('30d');
  const [selectedCols, setSelectedCols] = useState<string[]>([
    'tickets',
    'sla',
    'csat',
    'qa',
    'calls',
    'load',
  ]);

  const toggleCol = (col: string) => {
    setSelectedCols((prev) =>
      prev.includes(col) ? (prev.length > 1 ? prev.filter((c) => c !== col) : prev) : [...prev, col]
    );
  };

  const filteredAgents = useMemo(() => {
    if (groupFilter === 'all') return agents;
    return agents.filter((a) => a.group === groupFilter);
  }, [agents, groupFilter]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      if (groupFilter !== 'all' && t.assignedGroup !== groupFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      return true;
    });
  }, [groupFilter, priorityFilter, tickets]);

  const rows = useMemo(() => {
    return filteredAgents.map((ag) => {
      const agTickets = filteredTickets.filter((t) => t.assignedAgentId === ag.id);
      const agSurveys = csatSurveys.filter((s) => s.agentId === ag.id);
      const avgCsat =
        agSurveys.length > 0
          ? Number((agSurveys.reduce((s, c) => s + c.rating, 0) / agSurveys.length).toFixed(2))
          : ag.csatScore;
      const agQa = qaEvaluations.filter((q) => q.agentId === ag.id);
      const avgQa =
        agQa.length > 0
          ? Math.round(agQa.reduce((s, q) => s + q.totalScore, 0) / agQa.length)
          : 92;
      const loadPct = Math.round((ag.activeTickets / Math.max(1, ag.maxConcurrentTickets)) * 100);
      return {
        agent: ag,
        ticketCount: agTickets.length,
        avgCsat,
        avgQa,
        loadPct,
      };
    });
  }, [csatSurveys, filteredAgents, filteredTickets, qaEvaluations]);

  const handleExportCustomCsv = () => {
    const headers = ['Agent', 'Groupe'];
    if (selectedCols.includes('tickets')) headers.push('Tickets périmètre');
    if (selectedCols.includes('sla')) headers.push('Conformité SLA (%)');
    if (selectedCols.includes('csat')) headers.push('Score CSAT (/5)');
    if (selectedCols.includes('qa')) headers.push('Score Qualité QA (/100)');
    if (selectedCols.includes('calls')) headers.push('Appels CTI');
    if (selectedCols.includes('load')) headers.push('Charge (%)');

    const csvRows = rows.map((r) => {
      const line: (string | number)[] = [r.agent.name, r.agent.group];
      if (selectedCols.includes('tickets')) line.push(r.ticketCount);
      if (selectedCols.includes('sla')) line.push(r.agent.slaCompliancePct.toFixed(1));
      if (selectedCols.includes('csat')) line.push(r.avgCsat);
      if (selectedCols.includes('qa')) line.push(r.avgQa);
      if (selectedCols.includes('calls')) line.push(r.agent.callsHandled);
      if (selectedCols.includes('load')) line.push(r.loadPct);
      return line;
    });

    downloadCsvFile(`rapport-personnalise-${horizon}.csv`, headers, csvRows);
  };

  const handleExportSummaryPdf = () => {
    const now = new Date();
    const monthValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const totalCalls = filteredAgents.reduce((s, a) => s + a.callsHandled, 0);
    const avgCallDuration =
      filteredAgents.length > 0
        ? Math.round(filteredAgents.reduce((s, a) => s + a.avgCallDurationSec, 0) / filteredAgents.length)
        : 0;
    const totalSituationChecks = filteredAgents.reduce((s, a) => s + a.situationChecks, 0);
    const avgPlatformUsage =
      filteredAgents.length > 0
        ? Math.round(filteredAgents.reduce((s, a) => s + a.platformUsageScore, 0) / filteredAgents.length)
        : 0;
    const totalAssistance = filteredAgents.reduce((s, a) => s + a.clientAssistanceCount, 0);
    const totalPasswordUnlocks = filteredAgents.reduce((s, a) => s + a.passwordUnlocksCount, 0);
    const totalOutOfZone = filteredAgents.reduce((s, a) => s + a.outOfZoneFollowups, 0);
    const avgSla =
      filteredAgents.length > 0
        ? (filteredAgents.reduce((s, a) => s + a.slaCompliancePct, 0) / filteredAgents.length).toFixed(1)
        : '0.0';
    const totalLoad = filteredAgents.reduce((s, a) => s + a.activeTickets, 0);
    const totalCap = filteredAgents.reduce((s, a) => s + a.maxConcurrentTickets, 0);

    exportMonthlyPerformancePdf({
      monthValue,
      agents: filteredAgents,
      tickets: filteredTickets,
      clients,
      callLogs: [],
      totals: {
        totalCalls,
        avgCallDuration,
        totalSituationChecks,
        avgPlatformUsage,
        totalAssistance,
        totalPasswordUnlocks,
        totalOutOfZone,
        avgSla,
        teamLoadPct: totalCap > 0 ? Math.round((totalLoad / totalCap) * 100) : 0,
      },
      aiBrief: null,
    });
  };

  const colOptions = [
    { id: 'tickets', label: 'Volume tickets' },
    { id: 'sla', label: 'Conformité SLA' },
    { id: 'csat', label: 'CSAT client' },
    { id: 'qa', label: 'Grille QA' },
    { id: 'calls', label: 'Appels CTI' },
    { id: 'load', label: 'Charge %' },
  ];

  const avgResponseTarget = useMemo(() => {
    const counts = {
      open: filteredTickets.filter((t) => t.status === 'open' || t.status === 'new').length,
      escalated: filteredTickets.filter((t) => t.status === 'escalated').length,
      resolved: filteredTickets.filter((t) => t.status === 'resolved' || t.status === 'closed').length,
    };
    return counts;
  }, [filteredTickets]);

  return (
    <div className="space-y-5">
      {/* Builder Configuration Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-blue-600" />
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Constructeur de rapports personnalisables
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportSummaryPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Exporter PDF filtré</span>
            </button>
            <button
              type="button"
              onClick={handleExportCustomCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exporter CSV personnalisé</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Groupe support</span>
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value as 'all' | SupportGroup)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value="all">Tous les groupes</option>
              <option value="N1 Accès & Comptes">N1 Accès &amp; Comptes</option>
              <option value="N2 Plateforme">N2 Plateforme</option>
              <option value="N3 Infrastructure">N3 Infrastructure</option>
              <option value="Relation Client & CTI">Relation Client &amp; CTI</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Priorité SLA</span>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value="all">Toutes les priorités</option>
              {(['critical', 'high', 'medium', 'low'] as const).map((pr) => (
                <option key={pr} value={pr}>
                  {TICKET_PRIORITY_LABELS[pr]}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Période d’analyse</span>
            <select
              value={horizon}
              onChange={(e) => setHorizon(e.target.value as '7d' | '30d' | 'quarter')}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value="7d">7 derniers jours</option>
              <option value="30d">30 derniers jours</option>
              <option value="quarter">Trimestre en cours</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
            Colonnes affichées :
          </span>
          {colOptions.map((c) => {
            const active = selectedCols.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCol(c.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-200'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Breakdown Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Tickets sur périmètre</p>
          <p className="mt-1 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {filteredTickets.length}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {avgResponseTarget.open} en file · {avgResponseTarget.escalated} escaladés
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Taux de résolution périmètre</p>
          <p className="mt-1 font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {filteredTickets.length > 0
              ? `${Math.round((avgResponseTarget.resolved / filteredTickets.length) * 100)}%`
              : '0%'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {avgResponseTarget.resolved} ticket(s) résolu(s) / fermé(s)
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Satisfaction moyenne CSAT</p>
          <p className="mt-1 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {csatSurveys.length > 0
              ? `${(csatSurveys.reduce((s, c) => s + c.rating, 0) / csatSurveys.length).toFixed(1)} / 5`
              : '4.8 / 5'}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Basé sur {csatSurveys.length} enquête(s) post-résolution
          </p>
        </div>
      </div>

      {/* Custom Report Result Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Synthèse analytique multi-axes ({rows.length} agent(s))
            </h4>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
            Période : {horizon === '7d' ? '7j' : horizon === '30d' ? '30j' : 'Trimestre'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                <th className="py-3 px-4">Agent &amp; Groupe</th>
                {selectedCols.includes('tickets') && <th className="py-3 px-4 text-right">Tickets</th>}
                {selectedCols.includes('sla') && <th className="py-3 px-4 text-right">SLA %</th>}
                {selectedCols.includes('csat') && <th className="py-3 px-4 text-right">CSAT</th>}
                {selectedCols.includes('qa') && <th className="py-3 px-4 text-right">QA /100</th>}
                {selectedCols.includes('calls') && <th className="py-3 px-4 text-right">Appels CTI</th>}
                {selectedCols.includes('load') && <th className="py-3 px-4 text-right">Charge</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {rows.map((r) => (
                <tr key={r.agent.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{r.agent.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.agent.group}</div>
                  </td>
                  {selectedCols.includes('tickets') && (
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{r.ticketCount}</td>
                  )}
                  {selectedCols.includes('sla') && (
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-700 dark:text-emerald-400">
                      {r.agent.slaCompliancePct.toFixed(1)}%
                    </td>
                  )}
                  {selectedCols.includes('csat') && (
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{r.avgCsat} / 5</td>
                  )}
                  {selectedCols.includes('qa') && (
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">{r.avgQa}/100</td>
                  )}
                  {selectedCols.includes('calls') && (
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{r.agent.callsHandled}</td>
                  )}
                  {selectedCols.includes('load') && (
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{r.loadPct}%</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filtered Ticket Status Snapshot */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-3">
          Détail des demandes filtrées ({filteredTickets.length})
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {filteredTickets.slice(0, 6).map((tk) => (
            <div
              key={tk.id}
              className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40 flex items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                  <span className="font-mono text-blue-600 mr-1.5">{tk.reference}</span>
                  {tk.subject}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {tk.clientName} · {tk.assignedGroup}
                </p>
              </div>
              <span className="shrink-0 font-medium text-[11px] text-slate-700 dark:text-slate-300">
                {TICKET_STATUS_LABELS[tk.status]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface QualityCsatPanelProps {
  uid: string;
  currentUserName: string;
  agents: SupportAgent[];
  clients: ClientAccount[];
  tickets: Ticket[];
  csatSurveys: CsatSurvey[];
  qaEvaluations: QaEvaluation[];
}

export const QualityCsatPanel: React.FC<QualityCsatPanelProps> = ({
  uid,
  currentUserName,
  agents,
  clients,
  tickets,
  csatSurveys,
  qaEvaluations,
}) => {
  const [showQaModal, setShowQaModal] = useState(false);
  const [qaAgentId, setQaAgentId] = useState(agents[0]?.id || '');
  const [qaTicketRef, setQaTicketRef] = useState(tickets[0]?.reference || 'ZD-2041');
  const [greetingScore, setGreetingScore] = useState(23);
  const [diagnosticScore, setDiagnosticScore] = useState(22);
  const [slaComplianceScore, setSlaComplianceScore] = useState(24);
  const [toneResolutionScore, setToneResolutionScore] = useState(23);
  const [trainingNeed, setTrainingNeed] = useState('Aucun besoin prioritaire');
  const [feedback, setFeedback] = useState('');
  const [savingQa, setSavingQa] = useState(false);

  const [showCsatModal, setShowCsatModal] = useState(false);
  const [csatTicketId, setCsatTicketId] = useState(tickets[0]?.id || '');
  const [csatRating, setCsatRating] = useState(5);
  const [csatChannel, setCsatChannel] = useState<'email' | 'portal' | 'phone'>('portal');
  const [csatComment, setCsatComment] = useState('');
  const [savingCsat, setSavingCsat] = useState(false);

  const avgCsat = useMemo(() => {
    if (csatSurveys.length === 0) return 0;
    return Number((csatSurveys.reduce((s, c) => s + c.rating, 0) / csatSurveys.length).toFixed(2));
  }, [csatSurveys]);

  const csatPositivePct = useMemo(() => {
    if (csatSurveys.length === 0) return 0;
    const positive = csatSurveys.filter((c) => c.rating >= 4).length;
    return Math.round((positive / csatSurveys.length) * 100);
  }, [csatSurveys]);

  const avgQaScore = useMemo(() => {
    if (qaEvaluations.length === 0) return 0;
    return Math.round(qaEvaluations.reduce((s, q) => s + q.totalScore, 0) / qaEvaluations.length);
  }, [qaEvaluations]);

  const handleSaveQa = async (e: React.FormEvent) => {
    e.preventDefault();
    const ag = agents.find((a) => a.id === qaAgentId) || agents[0];
    if (!ag || !feedback.trim()) return;
    const g = Math.max(0, Math.min(25, Number(greetingScore) || 0));
    const d = Math.max(0, Math.min(25, Number(diagnosticScore) || 0));
    const s = Math.max(0, Math.min(25, Number(slaComplianceScore) || 0));
    const t = Math.max(0, Math.min(25, Number(toneResolutionScore) || 0));
    const total = g + d + s + t;

    setSavingQa(true);
    try {
      await addDoc(collection(db, 'qaEvaluations'), {
        agentId: ag.id,
        agentName: clampString(ag.name, 120),
        ticketRef: clampString(qaTicketRef || 'ZD-2041', 40),
        reviewerName: clampString(currentUserName, 120),
        greetingScore: g,
        diagnosticScore: d,
        slaComplianceScore: s,
        toneResolutionScore: t,
        totalScore: total,
        trainingNeed: clampString(trainingNeed || 'Suivi standard', 200),
        feedback: clampString(feedback, 1000),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'supervisor',
        action: `Évaluation QA enregistrée (${total}/100)`,
        category: 'qa',
        targetLabel: `${ag.name} · ${qaTicketRef}`,
        details: `Axe formation : ${trainingNeed || 'Aucun'}`,
      });
      setShowQaModal(false);
      setFeedback('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'qaEvaluations');
    } finally {
      setSavingQa(false);
    }
  };

  const handleSaveCsat = async (e: React.FormEvent) => {
    e.preventDefault();
    const tk = tickets.find((t) => t.id === csatTicketId) || tickets[0];
    const ag =
      (tk?.assignedAgentId ? agents.find((a) => a.id === tk.assignedAgentId) : undefined) || agents[0];
    const cl = (tk ? clients.find((c) => c.id === tk.clientId) : undefined) || clients[0];
    if (!tk || !ag || !cl) return;

    setSavingCsat(true);
    try {
      await addDoc(collection(db, 'csatSurveys'), {
        ticketId: tk.id,
        ticketRef: clampString(tk.reference, 40),
        clientId: cl.id,
        clientName: clampString(cl.companyName, 150),
        agentId: ag.id,
        agentName: clampString(ag.name, 120),
        rating: Math.max(1, Math.min(5, csatRating)),
        comment: clampString(csatComment || 'Retour client validé après résolution.', 1000),
        channel: csatChannel,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });
      setShowCsatModal(false);
      setCsatComment('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'csatSurveys');
    } finally {
      setSavingCsat(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* KPI Header Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Score CSAT moyen</span>
            <Star className="w-4 h-4 text-amber-500" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {avgCsat} / 5
          </p>
          <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
            {csatPositivePct}% de clients satisfaits (4★–5★)
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Score Contrôle Qualité (QA)</span>
            <Award className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {avgQaScore} / 100
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Sur {qaEvaluations.length} grille(s) évaluée(s)
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Plans de formation détectés</span>
            <GraduationCap className="w-4 h-4 text-violet-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {qaEvaluations.filter((q) => q.trainingNeed && !q.trainingNeed.toLowerCase().startsWith('aucun')).length}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Axes de coaching ciblés par la grille QA
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left: QA Evaluations & Coaching Needs */}
        <div className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600" />
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Grilles de Contrôle Qualité (QA) &amp; besoins en formation
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowQaModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Évaluer un ticket (QA)</span>
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {qaEvaluations.map((qa) => (
              <div key={qa.id} className="p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {qa.agentName}{' '}
                      <span className="font-mono text-xs text-blue-600 ml-1">· {qa.ticketRef}</span>
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Évalué par {qa.reviewerName}
                    </p>
                  </div>
                  <span
                    className={`font-mono tabular-nums text-sm font-bold px-2.5 py-1 rounded-md border ${
                      qa.totalScore >= 90
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {qa.totalScore}/100
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Accueil</span>
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {qa.greetingScore}/25
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Diagnostic</span>
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {qa.diagnosticScore}/25
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Respect SLA</span>
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {qa.slaComplianceScore}/25
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800">
                    <span className="text-slate-500 dark:text-slate-400">Ton &amp; Clôture</span>
                    <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {qa.toneResolutionScore}/25
                    </p>
                  </div>
                </div>

                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{qa.feedback}</p>
                <p className="text-[11px] font-medium text-violet-700 dark:text-violet-300 flex items-center gap-1.5">
                  <GraduationCap className="w-3.5 h-3.5 shrink-0" />
                  <span>Besoin formation : {qa.trainingNeed}</span>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Post-Resolution CSAT Surveys */}
        <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500" />
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Enquêtes de satisfaction CSAT ({csatSurveys.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => setShowCsatModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Enregistrer CSAT</span>
            </button>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {csatSurveys.map((csat) => (
              <div key={csat.id} className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {csat.clientName}{' '}
                    <span className="font-mono text-blue-600 ml-1">· {csat.ticketRef}</span>
                  </p>
                  <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                    <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                    {csat.rating}/5
                  </span>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{csat.comment}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Agent : {csat.agentName} · Canal : {csat.channel}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* QA Evaluation Modal */}
      {showQaModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Nouvelle évaluation Contrôle Qualité (QA)
              </h3>
              <button type="button" onClick={() => setShowQaModal(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleSaveQa} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Agent évalué</span>
                  <select
                    value={qaAgentId}
                    onChange={(e) => setQaAgentId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Référence ticket</span>
                  <input
                    type="text"
                    required
                    value={qaTicketRef}
                    onChange={(e) => setQaTicketRef(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Accueil /25</span>
                  <input
                    type="number"
                    min={0}
                    max={25}
                    value={greetingScore}
                    onChange={(e) => setGreetingScore(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Diagnostic /25</span>
                  <input
                    type="number"
                    min={0}
                    max={25}
                    value={diagnosticScore}
                    onChange={(e) => setDiagnosticScore(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Respect SLA /25</span>
                  <input
                    type="number"
                    min={0}
                    max={25}
                    value={slaComplianceScore}
                    onChange={(e) => setSlaComplianceScore(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Ton &amp; Clôture /25</span>
                  <input
                    type="number"
                    min={0}
                    max={25}
                    value={toneResolutionScore}
                    onChange={(e) => setToneResolutionScore(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Besoin en formation identifié
                </span>
                <input
                  type="text"
                  value={trainingNeed}
                  onChange={(e) => setTrainingNeed(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Commentaire coaching</span>
                <textarea
                  rows={3}
                  required
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Points forts et axes d'amélioration..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowQaModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingQa}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingQa ? 'Enregistrement...' : 'Valider la grille QA'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CSAT Modal */}
      {showCsatModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Enregistrer un retour client (CSAT)
              </h3>
              <button type="button" onClick={() => setShowCsatModal(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleSaveCsat} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Ticket concerné</span>
                <select
                  value={csatTicketId}
                  onChange={(e) => setCsatTicketId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  {tickets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.reference} — {t.clientName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Note (1 à 5 ★)</span>
                  <select
                    value={csatRating}
                    onChange={(e) => setCsatRating(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n} / 5
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Canal enquête</span>
                  <select
                    value={csatChannel}
                    onChange={(e) => setCsatChannel(e.target.value as 'email' | 'portal' | 'phone')}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    <option value="portal">Portail libre-service</option>
                    <option value="email">E-mail post-résolution</option>
                    <option value="phone">Enquête téléphonique</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Verbatims client</span>
                <textarea
                  rows={3}
                  required
                  value={csatComment}
                  onChange={(e) => setCsatComment(e.target.value)}
                  placeholder="Commentaire laissé par le client..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCsatModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingCsat}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingCsat ? 'Enregistrement...' : 'Enregistrer CSAT'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

interface WfmSchedulePanelProps {
  uid: string;
  agents: SupportAgent[];
  wfmShifts: WfmShift[];
  tickets: Ticket[];
}

const WFM_ACTIVITIES: WfmActivityType[] = [
  'Support N1/N2',
  'Téléphonie CTI',
  'Astreinte N3',
  'Formation / Coaching',
];

export const WfmSchedulePanel: React.FC<WfmSchedulePanelProps> = ({
  uid,
  agents,
  wfmShifts,
  tickets,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  const [shiftDate, setShiftDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [timeWindow, setTimeWindow] = useState('08:30 — 16:30');
  const [plannedHours, setPlannedHours] = useState(8);
  const [adherencePct, setAdherencePct] = useState(95);
  const [forecastTickets, setForecastTickets] = useState(18);
  const [activityType, setActivityType] = useState<WfmActivityType>('Support N1/N2');
  const [saving, setSaving] = useState(false);

  const avgAdherence = useMemo(() => {
    if (wfmShifts.length === 0) return 0;
    return Math.round(wfmShifts.reduce((s, w) => s + w.adherencePct, 0) / wfmShifts.length);
  }, [wfmShifts]);

  const totalPlannedHours = useMemo(
    () => wfmShifts.reduce((s, w) => s + w.plannedHours, 0),
    [wfmShifts]
  );

  const totalForecast = useMemo(
    () => wfmShifts.reduce((s, w) => s + w.forecastTickets, 0),
    [wfmShifts]
  );

  // 5-day volume forecast vs capacity breakdown
  const forecastSeries = useMemo(() => {
    const days = ['J', 'J+1', 'J+2', 'J+3', 'J+4'];
    const baseOpen = Math.max(12, tickets.length * 4);
    const teamDailyCap = Math.max(
      20,
      agents.reduce((s, a) => s + a.maxConcurrentTickets, 0)
    );
    return days.map((label, idx) => {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + idx);
      const iso = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(targetDate.getDate()).padStart(2, '0')}`;
      const shiftsForDay = wfmShifts.filter((w) => w.shiftDate === iso);
      const forecast =
        shiftsForDay.length > 0
          ? shiftsForDay.reduce((s, w) => s + w.forecastTickets, 0)
          : Math.round(baseOpen * (idx === 1 ? 1.18 : idx === 2 ? 0.92 : idx === 3 ? 1.08 : 0.85));
      const capacity =
        shiftsForDay.length > 0 ? shiftsForDay.length * 22 : Math.round(teamDailyCap * 0.95);
      return { label, iso, forecast, capacity };
    });
  }, [agents, tickets.length, wfmShifts]);

  const handleUpdateAdherence = async (shift: WfmShift, nextVal: number) => {
    try {
      await updateDoc(doc(db, 'wfmShifts', shift.id), {
        adherencePct: Math.max(0, Math.min(100, nextVal)),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `wfmShifts/${shift.id}`);
    }
  };

  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const ag = agents.find((a) => a.id === agentId) || agents[0];
    if (!ag || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(shiftDate)) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'wfmShifts'), {
        agentId: ag.id,
        agentName: clampString(ag.name, 120),
        shiftDate,
        timeWindow: clampString(timeWindow, 60),
        plannedHours: Math.max(0.5, Math.min(24, Number(plannedHours) || 8)),
        adherencePct: Math.max(0, Math.min(100, Number(adherencePct) || 95)),
        forecastTickets: Math.max(0, Math.min(1000, Number(forecastTickets) || 15)),
        activityType,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowModal(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'wfmShifts');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* WFM Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Adhérence moyenne au planning</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {avgAdherence}%
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Respect des créneaux planifiés sur {wfmShifts.length} shift(s)
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Volume prévisionnel couvert</span>
            <TrendingUp className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totalForecast} tickets
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Charge estimée sur la fenêtre WFM active
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Heures planifiées équipe</span>
            <CalendarRange className="w-4 h-4 text-slate-600 dark:text-slate-300" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totalPlannedHours} h
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Réparties entre Support, CTI &amp; Astreinte
          </p>
        </div>
      </div>

      {/* Volume Forecast vs Capacity Bars */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Prévision de volume entrant vs Capacité planifiée (5 jours)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Anticipez les pics de charge pour ajuster les shifts et préserver les délais SLA.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Planifier un shift WFM</span>
          </button>
        </div>

        <div className="grid grid-cols-5 gap-3 pt-2">
          {forecastSeries.map((day) => {
            const maxBar = Math.max(40, ...forecastSeries.map((d) => Math.max(d.forecast, d.capacity)));
            const fPct = Math.round((day.forecast / maxBar) * 100);
            const cPct = Math.round((day.capacity / maxBar) * 100);
            const underStaffed = day.forecast > day.capacity;
            return (
              <div key={day.iso} className="space-y-2">
                <div className="h-32 bg-slate-50 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg p-2 flex items-end justify-center gap-2">
                  <div
                    className={`w-5 rounded-t-sm transition-all ${
                      underStaffed ? 'bg-amber-500' : 'bg-blue-600'
                    }`}
                    style={{ height: `${Math.max(12, fPct)}%` }}
                    title={`Prévision : ${day.forecast} tickets`}
                  />
                  <div
                    className="w-5 rounded-t-sm bg-emerald-500/75"
                    style={{ height: `${Math.max(12, cPct)}%` }}
                    title={`Capacité : ${day.capacity} tickets`}
                  />
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{day.label}</p>
                  <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {day.forecast} prev / {day.capacity} cap
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* WFM Shifts & Adherence Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Planning des shifts &amp; suivi d’adhérence ({wfmShifts.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                <th className="py-3 px-4">Agent</th>
                <th className="py-3 px-4">Date &amp; Plage</th>
                <th className="py-3 px-4">Activité</th>
                <th className="py-3 px-4 text-right">Heures</th>
                <th className="py-3 px-4 text-right">Prévision</th>
                <th className="py-3 px-4 text-right">Adhérence (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {wfmShifts.map((sh) => (
                <tr key={sh.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                    {sh.agentName}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-mono text-slate-900 dark:text-slate-100">{sh.shiftDate}</div>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {sh.timeWindow}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{sh.activityType}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{sh.plannedHours}h</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{sh.forecastTickets} tks</td>
                  <td className="py-3 px-4 text-right">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={sh.adherencePct}
                      onChange={(e) => handleUpdateAdherence(sh, Number(e.target.value))}
                      aria-label={`Adhérence ${sh.agentName}`}
                      className="w-16 px-2 py-1 text-right font-mono text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-md"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add WFM Shift Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Planifier un shift WFM
              </h3>
              <button type="button" onClick={() => setShowModal(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleCreateShift} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Agent</span>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.name} — {ag.group}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Date</span>
                  <input
                    type="date"
                    required
                    value={shiftDate}
                    onChange={(e) => setShiftDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Plage horaire</span>
                  <input
                    type="text"
                    required
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Activité principale</span>
                <select
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value as WfmActivityType)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  {WFM_ACTIVITIES.map((act) => (
                    <option key={act} value={act}>
                      {act}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-3 gap-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Heures</span>
                  <input
                    type="number"
                    step="0.5"
                    min={1}
                    max={24}
                    value={plannedHours}
                    onChange={(e) => setPlannedHours(Number(e.target.value))}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Tickets prév.</span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={forecastTickets}
                    onChange={(e) => setForecastTickets(Number(e.target.value))}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Adhérence %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={adherencePct}
                    onChange={(e) => setAdherencePct(Number(e.target.value))}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {saving ? 'Enregistrement...' : 'Ajouter le shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
