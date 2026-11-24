import {
  AgentAvailability,
  ClientHealthStatus,
  SlaPolicy,
  SupportAgent,
  Ticket,
  TicketChannel,
  TicketPriority,
  TicketStatus,
  WorkspaceConfig,
} from '../types/helpdesk';

export const DEFAULT_SLA_ALERT_THRESHOLD_PCT = 80;
export const MIN_SLA_ALERT_THRESHOLD_PCT = 50;
export const MAX_SLA_ALERT_THRESHOLD_PCT = 100;

export function resolveSlaAlertThresholdPct(workspaceConfig?: WorkspaceConfig): number {
  const raw = workspaceConfig?.slaAlertThresholdPct;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_SLA_ALERT_THRESHOLD_PCT;
  }
  return Math.min(MAX_SLA_ALERT_THRESHOLD_PCT, Math.max(MIN_SLA_ALERT_THRESHOLD_PCT, Math.round(raw)));
}

const DEFAULT_FIRST_RESPONSE_MIN: Record<TicketPriority, number> = {
  critical: 15,
  high: 30,
  medium: 120,
  low: 240,
};

const DEFAULT_RESOLUTION_MIN: Record<TicketPriority, number> = {
  critical: 120,
  high: 240,
  medium: 1440,
  low: 2880,
};

export interface SlaResponseAlertInfo {
  isAlert: boolean;
  thresholdPct: number;
  estimatedResponseMinutes: number;
  allocatedSlaMinutes: number;
  estimatedPct: number;
  scopeLabel: '1ère réponse' | 'Résolution SLA';
  summary: string;
}

export function evaluateSlaResponseAlert(
  ticket: Ticket,
  slaPolicies: SlaPolicy[],
  agents: SupportAgent[],
  nowMs: number = Date.now(),
  thresholdPct: number = DEFAULT_SLA_ALERT_THRESHOLD_PCT
): SlaResponseAlertInfo {
  const safeThresholdPct = Math.min(
    MAX_SLA_ALERT_THRESHOLD_PCT,
    Math.max(MIN_SLA_ALERT_THRESHOLD_PCT, Math.round(thresholdPct))
  );
  const isDone = ticket.status === 'resolved' || ticket.status === 'closed';
  const matchedPolicy =
    slaPolicies.find((p) => p.id === ticket.slaPolicyId) ||
    slaPolicies.find((p) => p.priorityScope === ticket.priority);

  const isFirstResponsePending = !ticket.firstResponded;
  const allocatedSlaMinutes = Math.max(
    1,
    isFirstResponsePending
      ? matchedPolicy?.firstResponseMinutes ?? DEFAULT_FIRST_RESPONSE_MIN[ticket.priority]
      : matchedPolicy?.resolutionMinutes ?? DEFAULT_RESOLUTION_MIN[ticket.priority]
  );

  if (isDone) {
    return {
      isAlert: false,
      thresholdPct: safeThresholdPct,
      estimatedResponseMinutes: 0,
      allocatedSlaMinutes,
      estimatedPct: 0,
      scopeLabel: isFirstResponsePending ? '1ère réponse' : 'Résolution SLA',
      summary: 'Ticket clôturé dans le cycle SLA.',
    };
  }

  const dueMs = isFirstResponsePending ? ticket.firstResponseDueMs : ticket.resolutionDueMs;
  const remainingMin = (dueMs - nowMs) / 60000;
  const elapsedMin = Math.max(0, allocatedSlaMinutes - remainingMin);

  const assignedAgent = ticket.assignedAgentId
    ? agents.find((a) => a.id === ticket.assignedAgentId)
    : undefined;

  let handlingEstimateMin = 0;
  if (assignedAgent) {
    const loadRatio =
      assignedAgent.activeTickets / Math.max(1, assignedAgent.maxConcurrentTickets);
    const availabilityPenalty =
      assignedAgent.availability === 'busy'
        ? 6
        : assignedAgent.availability === 'in_call'
        ? 4
        : assignedAgent.availability === 'off_duty'
        ? 15
        : 0;
    const baseWindow = isFirstResponsePending
      ? Math.min(14, Math.max(6, allocatedSlaMinutes * 0.4))
      : Math.min(45, Math.max(15, allocatedSlaMinutes * 0.15));
    handlingEstimateMin = Math.round(loadRatio * baseWindow) + availabilityPenalty;
  } else {
    handlingEstimateMin = isFirstResponsePending
      ? Math.round(Math.min(16, Math.max(8, allocatedSlaMinutes * 0.45)))
      : Math.round(Math.min(60, Math.max(20, allocatedSlaMinutes * 0.2)));
  }

  const estimatedResponseMinutes = Math.max(1, Math.round(elapsedMin + handlingEstimateMin));
  const estimatedPct = Math.round((estimatedResponseMinutes / allocatedSlaMinutes) * 100);
  const isAlert = estimatedPct >= safeThresholdPct;
  const scopeLabel = isFirstResponsePending ? '1ère réponse' : 'Résolution SLA';

  return {
    isAlert,
    thresholdPct: safeThresholdPct,
    estimatedResponseMinutes,
    allocatedSlaMinutes,
    estimatedPct,
    scopeLabel,
    summary: `Temps estimé (${scopeLabel.toLowerCase()}) : ${estimatedResponseMinutes} min sur ${allocatedSlaMinutes} min allouées (${estimatedPct}%)`,
  };
}

export function formatSlaRemaining(dueMs: number, isClosedOrResolved: boolean): {
  label: string;
  severity: 'nominal' | 'warning' | 'breached' | 'done';
} {
  if (isClosedOrResolved) {
    return { label: 'SLA clôturé', severity: 'done' };
  }
  const diffMin = Math.round((dueMs - Date.now()) / 60000);
  if (diffMin < 0) {
    const abs = Math.abs(diffMin);
    const hrs = Math.floor(abs / 60);
    const mins = abs % 60;
    return {
      label: hrs > 0 ? `SLA dépassé (-${hrs}h ${mins}m)` : `SLA dépassé (-${mins}m)`,
      severity: 'breached',
    };
  }
  if (diffMin <= 20) {
    return { label: `SLA ${diffMin} min`, severity: 'warning' };
  }
  const hrs = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  return {
    label: hrs > 0 ? `SLA ${hrs}h ${mins}m` : `SLA ${mins}m`,
    severity: 'nominal',
  };
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'Nouveau',
  open: 'En cours',
  pending_client: 'Attente client',
  snoozed: 'Snoozé',
  escalated: 'Escaladé',
  resolved: 'Résolu',
  closed: 'Fermé',
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  critical: 'Critique',
  high: 'Haute',
  medium: 'Normale',
  low: 'Basse',
};

export const TICKET_CHANNEL_LABELS: Record<TicketChannel, string> = {
  email: 'E-mail entrant',
  phone: 'Téléphone VoIP',
  chat: 'Chat en direct',
  portal: 'Portail client',
  web_form: 'Formulaire web',
  facebook: 'Facebook',
  twitter: 'Twitter / X',
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  slack_teams: 'Slack / Teams',
  auto_alert: 'Alerte auto',
};

export const CLIENT_HEALTH_LABELS: Record<ClientHealthStatus, string> = {
  nominal: 'Nominal',
  degraded: 'Dégradé',
  out_of_zone: 'Hors zone réseau',
  password_locked: 'Mot de passe bloqué',
  critical: 'Incident critique',
};

export const AGENT_AVAILABILITY_LABELS: Record<AgentAvailability, string> = {
  available: 'Disponible',
  busy: 'Occupé',
  on_call: 'En astreinte',
  in_call: 'En appel',
  off_duty: 'Hors service',
};

export function downloadCsvFile(filename: string, headers: string[], rows: (string | number | boolean)[][]) {
  const escape = (val: string | number | boolean) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
