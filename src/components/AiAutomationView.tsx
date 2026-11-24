import React, { useMemo, useState } from 'react';
import { addDoc, collection, doc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  Clock,
  Cpu,
  HeartPulse,
  Link2,
  Play,
  Plus,
  Route,
  Sliders,
  Sparkles,
  Target,
  UserCheck,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AiTriageResult,
  AppLocale,
  AutomationRule,
  AutomationTriggerEvent,
  SlaPolicy,
  SupportAgent,
  SupportGroup,
  Ticket,
  WorkspaceConfig,
} from '../types/helpdesk';
import { TICKET_PRIORITY_LABELS } from '../lib/formatters';
import { analyzeTicketSentiment } from '../lib/sentiment';
import {
  executeSmartTicketRouting,
  getAgentLoadPct,
  isAgentAvailableForRouting,
  resolveSmartRoutingPolicy,
} from '../lib/smartRouting';
import { clampInt, clampString, clampTags } from '../lib/validation';

interface AiAutomationViewProps {
  uid: string;
  locale?: AppLocale;
  workspaceConfig?: WorkspaceConfig;
  rules: AutomationRule[];
  slaPolicies: SlaPolicy[];
  agents: SupportAgent[];
  tickets: Ticket[];
}

const DEFAULT_AGENT_PERMS = ['tickets_manage', 'kb_publish'];
const DEFAULT_SUPERVISOR_PERMS = ['tickets_manage', 'reports_export', 'wfm_oncall', 'qa_evaluate', 'kb_publish'];
const DEFAULT_ADMIN_PERMS = [
  'tickets_manage',
  'reports_export',
  'wfm_oncall',
  'qa_evaluate',
  'kb_publish',
  'integrations_api',
  'gdpr_privacy',
  'rbac_admin',
];

const AVAILABILITY_LABELS: Record<SupportAgent['availability'], string> = {
  available: 'Disponible',
  on_call: 'Astreinte',
  in_call: 'En appel',
  busy: 'Occupé',
  off_duty: 'Hors service',
};

export const AiAutomationView: React.FC<AiAutomationViewProps> = ({
  uid,
  locale = 'fr',
  workspaceConfig,
  rules,
  slaPolicies,
  agents,
  tickets,
}) => {
  const [simSubject, setSimSubject] = useState('Erreur AUTH-401 répétée et compte bloqué sur secteur Nord');
  const [simDescription, setSimDescription] = useState(
    'Plusieurs utilisateurs de notre site Nord ont leur mot de passe bloqué depuis 15 minutes et les terminaux terrain passent en hors zone.'
  );
  const [simResult, setSimResult] = useState<AiTriageResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [automationFeedback, setAutomationFeedback] = useState<string | null>(null);
  const [savingSmartRouting, setSavingSmartRouting] = useState(false);
  const [routingBatchLoading, setRoutingBatchLoading] = useState(false);
  const [smartRoutingNotice, setSmartRoutingNotice] = useState<string | null>(null);

  // New rule form
  const [ruleName, setRuleName] = useState('');
  const [ruleTriggerEvent, setRuleTriggerEvent] = useState<AutomationTriggerEvent>('ticket_created');
  const [ruleCategory, setRuleCategory] = useState('Hors zone / Connectivité');
  const [rulePattern, setRulePattern] = useState('');
  const [ruleAction, setRuleAction] = useState('');
  const [ruleGroup, setRuleGroup] = useState<SupportGroup>('N3 Infrastructure');
  const [ruleAutoIncident, setRuleAutoIncident] = useState(true);
  const [distView, setDistView] = useState<'group' | 'category' | 'priority'>('group');

  const smartPolicy = useMemo(
    () => resolveSmartRoutingPolicy(workspaceConfig),
    [workspaceConfig]
  );

  const smartReadiness = useMemo(() => {
    const eligibleAgents = agents.filter((a) =>
      smartPolicy.respectAvailability
        ? isAgentAvailableForRouting(a, smartPolicy.maxAgentLoadPct)
        : a.availability !== 'off_duty'
    );
    const openTickets = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed');
    const unroutedOpenTickets = openTickets.filter((t) => !t.aiRouted);
    const tenseOpenTickets = openTickets.filter((t) => {
      const s = analyzeTicketSentiment(t, undefined, locale);
      return s.level === 'tense' || s.level === 'concerned';
    });

    return {
      eligibleAgents,
      openTicketsCount: openTickets.length,
      unroutedOpenTickets,
      tenseOpenCount: tenseOpenTickets.length,
    };
  }, [agents, tickets, smartPolicy, locale]);

  const persistSmartRoutingPatch = async (patch: {
    smartRoutingEnabled?: boolean;
    smartRoutingPrioritizeTense?: boolean;
    smartRoutingRespectAvailability?: boolean;
    smartRoutingMaxLoadPct?: number;
  }) => {
    setSavingSmartRouting(true);
    setSmartRoutingNotice(null);
    const configDocId = workspaceConfig?.id || `cfg_${uid.slice(0, 8)}`;
    try {
      if (workspaceConfig) {
        await updateDoc(doc(db, 'workspaceConfigs', workspaceConfig.id), {
          ...patch,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'workspaceConfigs', configDocId), {
          defaultLanguage: locale,
          gdprRetentionDays: 730,
          anonymizeClosedAfterDays: 365,
          apiKeyPrefix: `zd_live_${uid.slice(0, 6)}`,
          agentPermissions: DEFAULT_AGENT_PERMS,
          supervisorPermissions: DEFAULT_SUPERVISOR_PERMS,
          adminPermissions: DEFAULT_ADMIN_PERMS,
          smartRoutingEnabled: smartPolicy.enabled,
          smartRoutingPrioritizeTense: smartPolicy.prioritizeTenseSentiment,
          smartRoutingRespectAvailability: smartPolicy.respectAvailability,
          smartRoutingMaxLoadPct: smartPolicy.maxAgentLoadPct,
          ...patch,
          ownerId: uid,
          memberIds: [uid],
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workspaceConfigs/${configDocId}`);
    } finally {
      setSavingSmartRouting(false);
    }
  };

  const handleBatchSmartRoutePending = async () => {
    if (!smartPolicy.enabled || smartReadiness.unroutedOpenTickets.length === 0 || routingBatchLoading) {
      return;
    }
    setRoutingBatchLoading(true);
    setSmartRoutingNotice(null);
    const activeIncidents = tickets
      .filter((t) => t.isRecurringIncident && t.parentIncidentRef)
      .map((t) => `${t.parentIncidentRef} (${t.category})`);

    let routedCount = 0;
    try {
      for (const ticket of smartReadiness.unroutedOpenTickets.slice(0, 5)) {
        const outcome = await executeSmartTicketRouting({
          subject: ticket.subject,
          description: ticket.description,
          channel: ticket.channel,
          clientName: ticket.clientName,
          agents,
          activeIncidents,
          policy: smartPolicy,
          locale,
          fallbackCategory: ticket.category,
          fallbackPriority: ticket.priority,
        });

        const updatePayload: Record<string, unknown> = {
          category: outcome.category,
          priority: outcome.priority,
          assignedGroup: outcome.assignedGroup,
          aiRouted: true,
          aiConfidence: outcome.aiConfidence,
          aiSentiment: outcome.aiSentiment,
          aiSummary: outcome.aiSummary,
          isRecurringIncident: outcome.isRecurringIncident,
          tags: clampTags([
            ...ticket.tags,
            'smart-routing',
            outcome.sentimentLevel === 'tense' ? 'priorite-sentiment' : 'routage-ia',
          ]),
          updatedAt: serverTimestamp(),
        };
        if (outcome.assignedAgentId && outcome.assignedAgentName) {
          updatePayload.assignedAgentId = outcome.assignedAgentId;
          updatePayload.assignedAgentName = outcome.assignedAgentName;
        }
        if (outcome.suggestedParentIncidentRef) {
          updatePayload.parentIncidentRef = outcome.suggestedParentIncidentRef;
        }

        await updateDoc(doc(db, 'tickets', ticket.id), updatePayload);
        await addDoc(collection(db, `tickets/${ticket.id}/events`), {
          ticketId: ticket.id,
          authorName: 'Smart Routing IA',
          authorRole: 'ai',
          visibility: 'internal',
          eventType: 'ai_triage',
          body: outcome.routingReason,
          ownerId: uid,
          memberIds: [uid],
          createdAt: serverTimestamp(),
        });
        routedCount += 1;
      }

      setSmartRoutingNotice(
        `${routedCount} ticket(s) entrant(s) routé(s) automatiquement selon le sentiment IA et la disponibilité des agents.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'tickets');
    } finally {
      setRoutingBatchLoading(false);
    }
  };

  const TRIGGER_EVENT_LABELS: Record<AutomationTriggerEvent, string> = {
    ticket_created: 'Nouveau ticket',
    client_reply: 'Réponse client',
    field_changed: 'Changement de champ',
    sla_warning: 'Risque SLA (>80%)',
  };

  const expectedGroupByCategory: Record<string, SupportGroup[]> = {
    'Mot de passe bloqué': ['N1 Accès & Comptes'],
    'Hors zone / Connectivité': ['N3 Infrastructure', 'Relation Client & CTI'],
    'Utilisation plateforme': ['N2 Plateforme'],
    'Assistance client': ['N2 Plateforme', 'Relation Client & CTI'],
    'Vérification situation': ['N2 Plateforme', 'Relation Client & CTI'],
    'Incident infrastructure': ['N3 Infrastructure'],
  };

  const aiDashboard = useMemo(() => {
    const routed = tickets.filter((t) => t.aiRouted);
    const totalTickets = tickets.length;
    const routedRatePct = totalTickets > 0 ? Math.round((routed.length / totalTickets) * 100) : 0;

    const avgConfidencePct =
      routed.length > 0
        ? Math.round(
            (routed.reduce((sum, t) => sum + (typeof t.aiConfidence === 'number' ? t.aiConfidence : 0.9), 0) /
              routed.length) *
              1000
          ) / 10
        : 0;

    // Assignment precision: tickets routed by AI whose assigned group & agent match category specialty
    let accurateCount = 0;
    const enrichedRouted = routed.map((t) => {
      const expectedGroups = expectedGroupByCategory[t.category] || [];
      const groupAligned = expectedGroups.length === 0 || expectedGroups.includes(t.assignedGroup as SupportGroup);
      const assignedAgent = agents.find((a) => a.id === t.assignedAgentId);
      const agentAligned = !assignedAgent || assignedAgent.group === t.assignedGroup;
      const isAccurate = groupAligned && agentAligned;
      if (isAccurate) accurateCount += 1;
      return { ticket: t, isAccurate };
    });

    const assignmentPrecisionPct =
      routed.length > 0 ? Math.round((accurateCount / routed.length) * 1000) / 10 : 0;

    const recurringRoutedCount = routed.filter((t) => t.isRecurringIncident).length;

    // Build distribution buckets dynamically from live routed tickets
    const bucketMap = new Map<string, { label: string; count: number; confidenceSum: number; accurateCount: number }>();

    for (const item of enrichedRouted) {
      const t = item.ticket;
      const key =
        distView === 'group'
          ? t.assignedGroup
          : distView === 'category'
          ? t.category
          : TICKET_PRIORITY_LABELS[t.priority];

      const prev = bucketMap.get(key) || { label: key, count: 0, confidenceSum: 0, accurateCount: 0 };
      prev.count += 1;
      prev.confidenceSum += typeof t.aiConfidence === 'number' ? t.aiConfidence : 0.9;
      if (item.isAccurate) prev.accurateCount += 1;
      bucketMap.set(key, prev);
    }

    const distribution = Array.from(bucketMap.values())
      .map((b) => ({
        label: b.label,
        count: b.count,
        sharePct: routed.length > 0 ? Math.round((b.count / routed.length) * 100) : 0,
        avgConfidencePct: b.count > 0 ? Math.round((b.confidenceSum / b.count) * 100) : 0,
        precisionPct: b.count > 0 ? Math.round((b.accurateCount / b.count) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalTickets,
      routedCount: routed.length,
      unroutedCount: totalTickets - routed.length,
      routedRatePct,
      avgConfidencePct,
      assignmentPrecisionPct,
      accurateCount,
      recurringRoutedCount,
      distribution,
      enrichedRouted,
    };
  }, [tickets, agents, distView]);

  const handleToggleRule = async (rule: AutomationRule) => {
    try {
      await updateDoc(doc(db, 'automationRules', rule.id), {
        active: !rule.active,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `automationRules/${rule.id}`);
    }
  };

  const handleRunRuleNow = async (rule: AutomationRule) => {
    setAutomationFeedback(null);
    try {
      const matchingTickets = tickets.filter(
        (t) =>
          t.status !== 'resolved' &&
          t.status !== 'closed' &&
          (t.category === rule.triggerCategory ||
            t.subject.toLowerCase().includes('hors zone') ||
            t.subject.toLowerCase().includes('bloqué'))
      );

      await updateDoc(doc(db, 'automationRules', rule.id), {
        triggeredCount: increment(1),
        updatedAt: serverTimestamp(),
      });

      for (const t of matchingTickets.slice(0, 3)) {
        await updateDoc(doc(db, 'tickets', t.id), {
          isRecurringIncident: true,
          parentIncidentRef: rule.autoCreateIncident ? 'INC-AUTO-204' : t.parentIncidentRef || 'INC-REL-09',
          assignedGroup: rule.targetGroup,
          updatedAt: serverTimestamp(),
        });
      }

      setAutomationFeedback(
        `Règle « ${rule.name} » exécutée : ${matchingTickets.length} ticket(s) corrélé(s) et routé(s) vers ${rule.targetGroup}.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `automationRules/${rule.id}`);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim() || !rulePattern.trim() || !ruleAction.trim()) return;
    try {
      await addDoc(collection(db, 'automationRules'), {
        name: clampString(ruleName, 150),
        triggerEvent: ruleTriggerEvent,
        triggerCategory: clampString(ruleCategory, 100),
        conditionPattern: clampString(rulePattern, 300),
        actionSummary: clampString(ruleAction, 300),
        targetGroup: ruleGroup,
        autoCreateIncident: ruleAutoIncident,
        active: true,
        triggeredCount: 0,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowRuleModal(false);
      setRuleName('');
      setRulePattern('');
      setRuleAction('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'automationRules');
    }
  };

  const handleUpdateSlaTarget = async (policy: SlaPolicy, firstResponseMinutes: number) => {
    try {
      await updateDoc(doc(db, 'slaPolicies', policy.id), {
        firstResponseMinutes: clampInt(firstResponseMinutes, 5, 1440),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `slaPolicies/${policy.id}`);
    }
  };

  const handleSimulateAi = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimLoading(true);
    setSimError(null);
    setSimResult(null);
    try {
      const res = await fetch('/api/ai/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: simSubject,
          description: simDescription,
          channel: 'email',
          clientName: 'Client Simulation',
          agents: agents.map((a) => ({
            id: a.id,
            name: a.name,
            group: a.group,
            availability: a.availability,
            activeTickets: a.activeTickets,
            maxConcurrentTickets: a.maxConcurrentTickets,
            csatScore: a.csatScore,
            skills: a.skills,
          })),
          activeIncidents: ['INC-REL-09 (Hors zone Nord-Est)', 'INC-AUTH-12 (Mots de passe bloqués)'],
          smartRoutingPolicy: {
            enabled: smartPolicy.enabled,
            prioritizeTenseSentiment: smartPolicy.prioritizeTenseSentiment,
            respectAvailability: smartPolicy.respectAvailability,
            maxAgentLoadPct: smartPolicy.maxAgentLoadPct,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de simulation IA');
      setSimResult(data);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Erreur IA.');
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Supervisor Smart Routing Control Card */}
      <section
        aria-labelledby="smart-routing-heading"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 space-y-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <Route className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  id="smart-routing-heading"
                  className="font-display text-sm font-bold text-slate-900 dark:text-slate-100"
                >
                  Smart Routing
                </h2>
                <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">·</span>
                <span
                  className={`text-xs font-semibold ${
                    smartPolicy.enabled
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {smartPolicy.enabled ? 'Routage automatique actif' : 'Routage automatique en pause'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Active ou suspend l’affectation automatique des nouveaux tickets entrants selon l’analyse de sentiment IA et la disponibilité réelle des agents.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {smartPolicy.enabled && smartReadiness.unroutedOpenTickets.length > 0 && (
              <button
                type="button"
                onClick={handleBatchSmartRoutePending}
                disabled={routingBatchLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span className="tabular-nums">
                  {routingBatchLoading
                    ? 'Routage en cours...'
                    : `Router les en attente (${smartReadiness.unroutedOpenTickets.length})`}
                </span>
              </button>
            )}

            <button
              type="button"
              role="switch"
              aria-checked={smartPolicy.enabled}
              aria-label="Activer le Smart Routing automatique des tickets entrants"
              disabled={savingSmartRouting}
              onClick={() => persistSmartRoutingPatch({ smartRoutingEnabled: !smartPolicy.enabled })}
              className={`inline-flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                smartPolicy.enabled
                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300'
              }`}
            >
              <span>{smartPolicy.enabled ? 'Activé' : 'Désactivé'}</span>
              <span
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                  smartPolicy.enabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                    smartPolicy.enabled ? 'translate-x-4.5' : 'translate-x-1'
                  }`}
                />
              </span>
            </button>
          </div>
        </div>

        {smartRoutingNotice && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-2">
            <span>{smartRoutingNotice}</span>
            <button
              type="button"
              onClick={() => setSmartRoutingNotice(null)}
              className="text-emerald-700 dark:text-emerald-300 hover:underline shrink-0 cursor-pointer"
            >
              Fermer
            </button>
          </div>
        )}

        {/* Mechanism-to-Outcome Configuration Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Criterion 1: AI Sentiment Prioritization */}
          <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-950/40 flex flex-col justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <HeartPulse className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                  <span>Analyse de sentiment IA</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={smartPolicy.prioritizeTenseSentiment}
                  aria-label="Prioriser les tickets selon le sentiment IA"
                  disabled={savingSmartRouting || !smartPolicy.enabled}
                  onClick={() =>
                    persistSmartRoutingPatch({
                      smartRoutingPrioritizeTense: !smartPolicy.prioritizeTenseSentiment,
                    })
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-45 ${
                    smartPolicy.prioritizeTenseSentiment ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      smartPolicy.prioritizeTenseSentiment ? 'translate-x-4.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Détecte la frustration ou l’urgence client, élève la priorité SLA et oriente vers un agent à fort CSAT.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">Tickets sous tension ouverts</span>
              <span className="font-mono tabular-nums font-semibold text-red-700 dark:text-red-400">
                {smartReadiness.tenseOpenCount}
              </span>
            </div>
          </div>

          {/* Criterion 2: Agent Availability & Load Cap */}
          <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-950/40 flex flex-col justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Disponibilité des agents</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={smartPolicy.respectAvailability}
                  aria-label="Filtrer selon la disponibilité et charge agent"
                  disabled={savingSmartRouting || !smartPolicy.enabled}
                  onClick={() =>
                    persistSmartRoutingPatch({
                      smartRoutingRespectAvailability: !smartPolicy.respectAvailability,
                    })
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-45 ${
                    smartPolicy.respectAvailability ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      smartPolicy.respectAvailability ? 'translate-x-4.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                Exclut les agents hors service ou en appel et équilibre la charge selon le plafond configuré.
              </p>
            </div>
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 text-[11px]">
              <label htmlFor="smart-routing-max-load" className="text-slate-500 dark:text-slate-400">
                Seuil de charge max
              </label>
              <select
                id="smart-routing-max-load"
                value={smartPolicy.maxAgentLoadPct}
                disabled={savingSmartRouting || !smartPolicy.enabled || !smartPolicy.respectAvailability}
                onChange={(e) =>
                  persistSmartRoutingPatch({ smartRoutingMaxLoadPct: Number(e.target.value) })
                }
                className="px-2 py-0.5 text-[11px] font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100 disabled:opacity-50"
              >
                <option value={75}>75%</option>
                <option value={85}>85%</option>
                <option value={95}>95%</option>
                <option value={100}>100%</option>
              </select>
            </div>
          </div>

          {/* Criterion 3: Live Readiness Summary */}
          <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-950/40 flex flex-col justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <Activity className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Capacité prête au routage</span>
                </span>
                <span className="font-mono tabular-nums text-xs font-bold text-slate-900 dark:text-slate-100">
                  {smartReadiness.eligibleAgents.length} / {agents.length}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {smartPolicy.enabled
                  ? 'Chaque nouveau ticket (file tickets, portail client, transfert tchat IA) déclenche le routage intelligent.'
                  : 'Mode manuel actif : les nouveaux tickets conservent les valeurs saisies sans affectation automatique.'}
              </p>
            </div>
            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400">Tickets ouverts non routés</span>
              <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                {smartReadiness.unroutedOpenTickets.length} / {smartReadiness.openTicketsCount}
              </span>
            </div>
          </div>
        </div>

        {/* Live Agent Availability Roster for Smart Routing */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Éligibilité des agents en direct
            </span>
            <span className="font-mono tabular-nums">
              {smartReadiness.eligibleAgents.length} éligible(s) · seuil {smartPolicy.maxAgentLoadPct}%
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {agents.map((agent) => {
              const loadPct = getAgentLoadPct(agent);
              const eligible = smartPolicy.respectAvailability
                ? isAgentAvailableForRouting(agent, smartPolicy.maxAgentLoadPct)
                : agent.availability !== 'off_duty';
              return (
                <div
                  key={agent.id}
                  className={`px-3 py-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                    eligible && smartPolicy.enabled
                      ? 'border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/30 dark:bg-emerald-950/15'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/30 opacity-75'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {agent.name}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {AVAILABILITY_LABELS[agent.availability]} · {agent.group.split(' ')[0]}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono tabular-nums text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                      {agent.activeTickets}/{agent.maxConcurrentTickets}
                    </p>
                    <p
                      className={`font-mono tabular-nums text-[10px] ${
                        eligible && smartPolicy.enabled
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {loadPct}% · CSAT {agent.csatScore.toFixed(1)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Real-Time AI Routing Distribution & Assignment Accuracy Dashboard */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Distribution en temps réel des tickets routés par l’IA &amp; précision des affectations
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Suivi en direct de la répartition par groupe, catégorie ou priorité et de la justesse des affectations vers les agents.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {(
              [
                ['group', 'Par groupe'],
                ['category', 'Par catégorie'],
                ['priority', 'Par priorité'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setDistView(key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  distView === key
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 4 Live Routing KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1 bg-slate-50/60 dark:bg-slate-950/40">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Tickets routés par l’IA</span>
            <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {aiDashboard.routedCount} / {aiDashboard.totalTickets}
            </p>
            <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Couverture : {aiDashboard.routedRatePct}% ({aiDashboard.unroutedCount} en attente)
            </p>
          </div>

          <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1 bg-slate-50/60 dark:bg-slate-950/40">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
              <span>Précision des affectations</span>
              <Target className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <p className="font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {aiDashboard.assignmentPrecisionPct}%
            </p>
            <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {aiDashboard.accurateCount} / {aiDashboard.routedCount} affectations conformes
            </p>
          </div>

          <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1 bg-slate-50/60 dark:bg-slate-950/40">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Confiance moyenne modèle</span>
            <p className="font-display text-2xl font-bold font-mono tabular-nums text-blue-700 dark:text-blue-400">
              {aiDashboard.avgConfidencePct}%
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Score moyen sur triage structuré
            </p>
          </div>

          <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1 bg-slate-50/60 dark:bg-slate-950/40">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Récurrences détectées</span>
            <p className="font-display text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
              {aiDashboard.recurringRoutedCount}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Tickets corrélés automatiquement
            </p>
          </div>
        </div>

        {/* Distribution Bars + Live Assignment Audit Table */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-1">
          <div className="lg:col-span-6 space-y-3">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Répartition des tickets routés ({aiDashboard.routedCount})
            </h3>
            {aiDashboard.distribution.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                Aucun ticket routé par l’IA pour le moment. Lancez un routage depuis la file des tickets.
              </p>
            ) : (
              <div className="space-y-3">
                {aiDashboard.distribution.map((row) => (
                  <div key={row.label} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-900 dark:text-slate-100 truncate pr-3">
                        {row.label}
                      </span>
                      <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 shrink-0">
                        {row.count} ticket(s) · {row.sharePct}% · Précision {row.precisionPct}%
                      </span>
                    </div>
                    <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${row.sharePct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-6 space-y-3">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Contrôle en direct des affectations IA
            </h3>
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="py-2 px-3">Ticket</th>
                    <th className="py-2 px-3">Affectation</th>
                    <th className="py-2 px-3 text-right">Confiance</th>
                    <th className="py-2 px-3 text-right">Précision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {aiDashboard.enrichedRouted.slice(0, 6).map(({ ticket, isAccurate }) => (
                    <tr key={ticket.id}>
                      <td className="py-2 px-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {ticket.reference}
                      </td>
                      <td className="py-2 px-3">
                        <div className="text-slate-900 dark:text-slate-100 font-medium truncate max-w-[160px]">
                          {ticket.assignedAgentName || 'Groupe seul'}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[160px]">
                          {ticket.assignedGroup}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {Math.round((ticket.aiConfidence ?? 0.9) * 100)}%
                      </td>
                      <td className="py-2 px-3 text-right">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            isAccurate
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isAccurate ? 'Exacte' : 'Ajustée'}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Recurring Technical Issues Automation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Automatisation des tickets pour problèmes techniques récurrents
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Détectez les schémas récurrents (hors zone, blocages MFA, rupture SLA) et déclenchez un routage automatique.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowRuleModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nouvelle règle</span>
          </button>
        </div>

        {automationFeedback && (
          <div className="mx-4 mt-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg text-xs text-emerald-800 dark:text-emerald-200">
            {automationFeedback}
          </div>
        )}

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {rules.map((rule) => (
            <div key={rule.id} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                    {rule.name}
                  </span>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-medium text-[11px]">
                    Événement : {TRIGGER_EVENT_LABELS[rule.triggerEvent || 'ticket_created']}
                  </span>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="text-slate-600 dark:text-slate-400">{rule.triggerCategory}</span>
                  {rule.autoCreateIncident && (
                    <>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                        <Link2 className="w-3.5 h-3.5" />
                        Auto-incident parent
                      </span>
                    </>
                  )}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Condition : {rule.conditionPattern}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Action : {rule.actionSummary} → <strong className="text-slate-700 dark:text-slate-200">{rule.targetGroup}</strong> ·{' '}
                  <span className="font-mono tabular-nums">{rule.triggeredCount} déclenchements</span>
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleRunRuleNow(rule)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 rounded-lg cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 text-blue-600" />
                  <span>Exécuter</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleRule(rule)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                    rule.active
                      ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {rule.active ? 'Active' : 'En pause'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Gemini AI Routing Simulator */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Simulateur de routage automatique IA Gemini
            </h3>
          </div>

          <form onSubmit={handleSimulateAi} className="space-y-3">
            <input
              type="text"
              value={simSubject}
              onChange={(e) => setSimSubject(e.target.value)}
              placeholder="Sujet du ticket entrant..."
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            />
            <textarea
              rows={3}
              value={simDescription}
              onChange={(e) => setSimDescription(e.target.value)}
              placeholder="Message client à analyser..."
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
            />
            <button
              type="submit"
              disabled={simLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold rounded-lg cursor-pointer"
            >
              <Bot className="w-4 h-4" />
              <span>{simLoading ? 'Analyse Gemini en cours...' : 'Tester le routage automatique'}</span>
            </button>
          </form>

          {simError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-700 dark:text-red-300">
              {simError}
            </div>
          )}

          {simResult && (
            <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-slate-900 dark:text-slate-100">
                  {simResult.category} · {TICKET_PRIORITY_LABELS[simResult.priority]} · {simResult.assignedGroup}
                </span>
                <span className="font-mono text-blue-700 dark:text-blue-400">
                  ({Math.round(simResult.confidence * 100)}% confiance)
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-300">
                <strong className="text-slate-900 dark:text-slate-100">Agent recommandé :</strong>{' '}
                {simResult.recommendedAgentName} · Sentiment : {simResult.sentiment}
                {typeof simResult.tensionScore === 'number' && (
                  <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {' '}(tension {Math.round(simResult.tensionScore)}/100)
                  </span>
                )}
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                <strong className="text-slate-900 dark:text-slate-100">Justification :</strong> {simResult.routingReason}
              </p>
              <div className="pt-1 border-t border-slate-200 dark:border-slate-800">
                <p className="font-semibold text-slate-900 dark:text-slate-100 mb-1">Réponse suggérée :</p>
                <p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{simResult.suggestedReply}</p>
              </div>
            </div>
          )}
        </div>

        {/* SLA Policies Configuration */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Politiques SLA actives
            </h3>
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {slaPolicies.map((pol) => (
              <div key={pol.id} className="py-3 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{pol.name}</span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    {TICKET_PRIORITY_LABELS[pol.priorityScope]}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    1ère réponse (min) :
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={5}
                      max={1440}
                      defaultValue={pol.firstResponseMinutes}
                      onBlur={(e) => handleUpdateSlaTarget(pol, Number(e.target.value))}
                      className="w-20 px-2 py-1 text-right font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded"
                    />
                    <span className="font-mono text-[11px]">Résol. {pol.resolutionMinutes}m</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Add Automation Rule Modal */}
      {showRuleModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Nouvelle règle d’automatisation
              </h3>
              <button type="button" onClick={() => setShowRuleModal(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleCreateRule} className="space-y-3">
              <input
                type="text"
                required
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="Nom de la règle"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500">Déclencheur événementiel</span>
                  <select
                    value={ruleTriggerEvent}
                    onChange={(e) => setRuleTriggerEvent(e.target.value as AutomationTriggerEvent)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    <option value="ticket_created">Nouveau ticket</option>
                    <option value="client_reply">Réponse client</option>
                    <option value="field_changed">Changement de champ</option>
                    <option value="sla_warning">Risque SLA (&gt;80%)</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500">Catégorie cible</span>
                  <select
                    value={ruleCategory}
                    onChange={(e) => setRuleCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    <option value="Hors zone / Connectivité">Hors zone / Connectivité</option>
                    <option value="Mot de passe bloqué">Mot de passe bloqué</option>
                    <option value="Utilisation plateforme">Utilisation plateforme</option>
                    <option value="Incident infrastructure">Incident infrastructure</option>
                  </select>
                </label>
              </div>
              <input
                type="text"
                required
                value={rulePattern}
                onChange={(e) => setRulePattern(e.target.value)}
                placeholder="Condition de déclenchement (ex: 3+ erreurs AUTH en 15 min)"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <input
                type="text"
                required
                value={ruleAction}
                onChange={(e) => setRuleAction(e.target.value)}
                placeholder="Action automatique exécutée"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <select
                value={ruleGroup}
                onChange={(e) => setRuleGroup(e.target.value as SupportGroup)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              >
                <option value="N1 Accès & Comptes">N1 Accès &amp; Comptes</option>
                <option value="N2 Plateforme">N2 Plateforme</option>
                <option value="N3 Infrastructure">N3 Infrastructure</option>
                <option value="Relation Client & CTI">Relation Client &amp; CTI</option>
              </select>
              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={ruleAutoIncident}
                  onChange={(e) => setRuleAutoIncident(e.target.checked)}
                />
                <span>Créer automatiquement un ticket incident parent</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRuleModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
