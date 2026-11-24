import {
  AiTriageResult,
  AppLocale,
  SmartRoutingPolicy,
  SupportAgent,
  SupportGroup,
  Ticket,
  TicketCategory,
  TicketChannel,
  TicketPriority,
  WorkspaceConfig,
} from '../types/helpdesk';
import { analyzeTicketSentiment, TicketSentimentLevel } from './sentiment';
import { clampString } from './validation';

export const DEFAULT_SMART_ROUTING_POLICY: SmartRoutingPolicy = {
  enabled: true,
  prioritizeTenseSentiment: true,
  respectAvailability: true,
  maxAgentLoadPct: 85,
};

export function resolveSmartRoutingPolicy(workspaceConfig?: WorkspaceConfig): SmartRoutingPolicy {
  return {
    enabled: workspaceConfig?.smartRoutingEnabled ?? DEFAULT_SMART_ROUTING_POLICY.enabled,
    prioritizeTenseSentiment:
      workspaceConfig?.smartRoutingPrioritizeTense ?? DEFAULT_SMART_ROUTING_POLICY.prioritizeTenseSentiment,
    respectAvailability:
      workspaceConfig?.smartRoutingRespectAvailability ?? DEFAULT_SMART_ROUTING_POLICY.respectAvailability,
    maxAgentLoadPct:
      typeof workspaceConfig?.smartRoutingMaxLoadPct === 'number'
        ? Math.min(100, Math.max(50, Math.round(workspaceConfig.smartRoutingMaxLoadPct)))
        : DEFAULT_SMART_ROUTING_POLICY.maxAgentLoadPct,
  };
}

export function getAgentLoadPct(agent: SupportAgent): number {
  const max = Math.max(1, agent.maxConcurrentTickets || 6);
  return Math.round(((agent.activeTickets || 0) / max) * 100);
}

export function isAgentAvailableForRouting(agent: SupportAgent, maxAgentLoadPct = 85): boolean {
  const readyStatus = agent.availability === 'available' || agent.availability === 'on_call';
  return readyStatus && getAgentLoadPct(agent) <= maxAgentLoadPct;
}

export function pickBestAgentForTicket(params: {
  agents: SupportAgent[];
  preferredGroup?: SupportGroup;
  preferredAgentId?: string;
  respectAvailability: boolean;
  maxAgentLoadPct: number;
  sentimentLevel: TicketSentimentLevel;
}): SupportAgent | undefined {
  const {
    agents,
    preferredGroup,
    preferredAgentId,
    respectAvailability,
    maxAgentLoadPct,
    sentimentLevel,
  } = params;

  if (agents.length === 0) return undefined;

  const isReady = (a: SupportAgent) => a.availability === 'available' || a.availability === 'on_call';
  const loadRatio = (a: SupportAgent) =>
    (a.activeTickets || 0) / Math.max(1, a.maxConcurrentTickets || 6);

  let pool = agents;
  if (respectAvailability) {
    const readyAgents = agents.filter((a) => isReady(a) && loadRatio(a) * 100 <= maxAgentLoadPct);
    const anyReady = agents.filter((a) => isReady(a));
    const nonOffDuty = agents.filter((a) => a.availability !== 'off_duty');

    if (readyAgents.length > 0) pool = readyAgents;
    else if (anyReady.length > 0) pool = anyReady;
    else if (nonOffDuty.length > 0) pool = nonOffDuty;
  }

  const scored = [...pool].sort((a, b) => {
    const scoreAgent = (agent: SupportAgent) => {
      let score = 0;

      // Availability weight
      if (agent.availability === 'available') score += 100;
      else if (agent.availability === 'on_call') score += 82;
      else if (agent.availability === 'busy') score -= 35;
      else if (agent.availability === 'in_call') score -= 45;
      else if (agent.availability === 'off_duty') score -= 200;

      // Capacity & load balancing
      const ratio = loadRatio(agent);
      if (ratio * 100 <= maxAgentLoadPct) score += 35;
      score -= ratio * 45;

      // Support group fit
      if (preferredGroup && agent.group === preferredGroup) score += 48;

      // AI suggested agent bonus when eligible
      if (preferredAgentId && agent.id === preferredAgentId) score += 26;

      // For tense or concerned exchanges, prioritize higher CSAT & SLA compliance
      if (sentimentLevel === 'tense' || sentimentLevel === 'concerned') {
        score += (agent.csatScore || 4.5) * 6;
        score += ((agent.slaCompliancePct || 90) - 85) * 0.5;
      }

      return score;
    };

    return scoreAgent(b) - scoreAgent(a);
  });

  return scored[0];
}

export interface SmartRoutingOutcome {
  category: TicketCategory;
  priority: TicketPriority;
  assignedGroup: SupportGroup;
  assignedAgentId?: string;
  assignedAgentName?: string;
  aiRouted: boolean;
  aiConfidence: number;
  aiSentiment: string;
  sentimentLevel: TicketSentimentLevel;
  tensionScore: number;
  aiSummary: string;
  isRecurringIncident: boolean;
  suggestedParentIncidentRef?: string;
  routingReason: string;
  suggestedReply: string;
}

function inferLocalCategory(text: string): { category: TicketCategory; group: SupportGroup } {
  const lower = text.toLowerCase();
  if (/(mot de passe|password|mfa|sso|401|auth|verrouill|bloqu)/i.test(lower)) {
    return { category: 'Mot de passe bloqué', group: 'N1 Accès & Comptes' };
  }
  if (/(hors zone|signal|connectivit|r[eé]seau|antenne|latence|offline|perte)/i.test(lower)) {
    return { category: 'Hors zone / Connectivité', group: 'N3 Infrastructure' };
  }
  if (/(panne|outage|crash|serveur|infra|base de donn)/i.test(lower)) {
    return { category: 'Incident infrastructure', group: 'N3 Infrastructure' };
  }
  if (/(v[eé]rifier|situation|audit|contr[oô]le)/i.test(lower)) {
    return { category: 'Vérification situation', group: 'Relation Client & CTI' };
  }
  if (/(export|tableau|rapport|plateforme|widget|interface|utilisation)/i.test(lower)) {
    return { category: 'Utilisation plateforme', group: 'N2 Plateforme' };
  }
  return { category: 'Assistance client', group: 'N2 Plateforme' };
}

export async function executeSmartTicketRouting(params: {
  subject: string;
  description: string;
  channel: TicketChannel;
  clientName: string;
  agents: SupportAgent[];
  activeIncidents?: string[];
  policy: SmartRoutingPolicy;
  locale?: AppLocale;
  fallbackCategory?: TicketCategory;
  fallbackPriority?: TicketPriority;
}): Promise<SmartRoutingOutcome> {
  const {
    subject,
    description,
    channel,
    clientName,
    agents,
    activeIncidents = [],
    policy,
    locale = 'fr',
    fallbackCategory,
    fallbackPriority = 'medium',
  } = params;

  const localSentiment = analyzeTicketSentiment(
    {
      id: 'pending',
      reference: 'ZD-NEW',
      subject,
      description,
      channel,
      status: 'new',
      priority: fallbackPriority,
      category: fallbackCategory || 'Assistance client',
      clientId: 'pending',
      clientName,
      assignedGroup: 'N2 Plateforme',
      firstResponseDueMs: Date.now() + 3600_000,
      resolutionDueMs: Date.now() + 28800_000,
      firstResponded: false,
      aiRouted: false,
      isRecurringIncident: false,
      tags: [],
      ownerId: 'pending',
      memberIds: [],
    } as Ticket,
    undefined,
    locale
  );

  let triage: AiTriageResult | null = null;
  try {
    const res = await fetch('/api/ai/triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        description,
        channel,
        clientName,
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
        activeIncidents,
        smartRoutingPolicy: {
          enabled: policy.enabled,
          prioritizeTenseSentiment: policy.prioritizeTenseSentiment,
          respectAvailability: policy.respectAvailability,
          maxAgentLoadPct: policy.maxAgentLoadPct,
        },
      }),
    });
    if (res.ok) {
      triage = (await res.json()) as AiTriageResult;
    }
  } catch {
    triage = null;
  }

  const inferred = inferLocalCategory(`${subject} ${description}`);
  const category = triage?.category || fallbackCategory || inferred.category;
  const assignedGroup = triage?.assignedGroup || inferred.group;

  // Merge AI sentiment & local cue analyzer
  let sentimentLevel: TicketSentimentLevel = localSentiment.level;
  if (triage?.sentimentLevel === 'tense' || localSentiment.level === 'tense') {
    sentimentLevel = 'tense';
  } else if (triage?.sentimentLevel === 'concerned' || localSentiment.level === 'concerned') {
    sentimentLevel = 'concerned';
  } else if (triage?.sentimentLevel === 'positive') {
    sentimentLevel = 'positive';
  } else if (triage?.sentimentLevel) {
    sentimentLevel = triage.sentimentLevel;
  }

  const tensionScore = Math.max(
    localSentiment.tensionScore,
    typeof triage?.tensionScore === 'number' ? Math.round(triage.tensionScore) : 0
  );

  let priority: TicketPriority = triage?.priority || fallbackPriority;
  if (policy.prioritizeTenseSentiment) {
    if (sentimentLevel === 'tense' && (priority === 'low' || priority === 'medium')) {
      priority = tensionScore >= 82 ? 'critical' : 'high';
    } else if (sentimentLevel === 'concerned' && priority === 'low') {
      priority = 'medium';
    }
  }

  const chosenAgent = pickBestAgentForTicket({
    agents,
    preferredGroup: assignedGroup,
    preferredAgentId: triage?.recommendedAgentId,
    respectAvailability: policy.respectAvailability,
    maxAgentLoadPct: policy.maxAgentLoadPct,
    sentimentLevel,
  });

  const sentimentLabel =
    triage?.sentiment ||
    (sentimentLevel === 'tense'
      ? 'Client frustré / tendu'
      : sentimentLevel === 'concerned'
      ? 'Client sous pression'
      : sentimentLevel === 'positive'
      ? 'Client constructif'
      : 'Client neutre');

  const availabilityNote = chosenAgent
    ? `Agent ${chosenAgent.name} (${chosenAgent.availability}, charge ${getAgentLoadPct(chosenAgent)}%)`
    : 'Groupe assigné';

  const routingReason = triage?.routingReason
    ? `${triage.routingReason} [Smart Routing · Sentiment: ${sentimentLabel} · ${availabilityNote}]`
    : `Routage automatique Smart Routing : sentiment "${sentimentLabel}" (${tensionScore}/100), affectation vers ${availabilityNote}.`;

  return {
    category,
    priority,
    assignedGroup,
    assignedAgentId: chosenAgent?.id,
    assignedAgentName: chosenAgent?.name,
    aiRouted: true,
    aiConfidence: typeof triage?.confidence === 'number' ? Math.min(1, Math.max(0, triage.confidence)) : 0.88,
    aiSentiment: clampString(sentimentLabel, 60),
    sentimentLevel,
    tensionScore,
    aiSummary: clampString(triage?.summary || subject, 600),
    isRecurringIncident: Boolean(triage?.isRecurringIncident),
    suggestedParentIncidentRef: triage?.suggestedParentIncidentRef
      ? clampString(triage.suggestedParentIncidentRef, 40)
      : undefined,
    routingReason,
    suggestedReply: triage?.suggestedReply || '',
  };
}
