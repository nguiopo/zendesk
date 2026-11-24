// Defensive sanitization & validation aligned verbatim with firebase-blueprint.json

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

export function assertValidId(id: string, label = 'ID'): string {
  const cleaned = id.trim();
  if (!cleaned || cleaned.length > 128 || !SAFE_ID_REGEX.test(cleaned)) {
    throw new Error(`${label} invalide.`);
  }
  return cleaned;
}

export function clampString(value: string, maxLength: number, fallback = ''): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLength);
}

export function clampTags(tags: string[]): string[] {
  return tags
    .map((t) => t.trim().slice(0, 40))
    .filter((t) => t.length > 0)
    .slice(0, 10);
}

export function clampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(Number.isFinite(value) ? value : min);
  return Math.min(max, Math.max(min, rounded));
}

export function clampNumber(value: number, min: number, max: number): number {
  const safe = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, Number(safe.toFixed(2))));
}

export function sanitizeTicketCreatePayload(input: {
  reference: string;
  subject: string;
  description: string;
  channel: string;
  status: string;
  priority: string;
  category: string;
  clientId: string;
  clientName: string;
  assignedAgentId?: string;
  assignedAgentName?: string;
  assignedGroup: string;
  slaPolicyId?: string;
  firstResponseDueMs: number;
  resolutionDueMs: number;
  snoozedUntilMs?: number;
  firstResponded: boolean;
  aiRouted: boolean;
  aiConfidence?: number;
  aiSentiment?: string;
  aiSummary?: string;
  isRecurringIncident: boolean;
  parentIncidentRef?: string;
  mergedIntoRef?: string;
  splitFromRef?: string;
  tags: string[];
  ownerId: string;
  memberIds: string[];
}) {
  const payload: Record<string, unknown> = {
    reference: clampString(input.reference, 40, 'ZD-NEW'),
    subject: clampString(input.subject, 240, 'Demande support'),
    description: clampString(input.description, 4000, 'Description non fournie.'),
    channel: input.channel,
    status: input.status,
    priority: input.priority,
    category: input.category,
    clientId: assertValidId(input.clientId, 'clientId'),
    clientName: clampString(input.clientName, 150, 'Client'),
    assignedGroup: clampString(input.assignedGroup, 100, 'N2 Plateforme'),
    firstResponseDueMs: Math.max(1, Math.round(input.firstResponseDueMs)),
    resolutionDueMs: Math.max(1, Math.round(input.resolutionDueMs)),
    firstResponded: Boolean(input.firstResponded),
    aiRouted: Boolean(input.aiRouted),
    isRecurringIncident: Boolean(input.isRecurringIncident),
    tags: clampTags(input.tags),
    ownerId: assertValidId(input.ownerId, 'ownerId'),
    memberIds: input.memberIds.slice(0, 20),
  };

  if (input.assignedAgentId) {
    payload.assignedAgentId = clampString(input.assignedAgentId, 128);
  }
  if (input.assignedAgentName) {
    payload.assignedAgentName = clampString(input.assignedAgentName, 120);
  }
  if (input.slaPolicyId) {
    payload.slaPolicyId = clampString(input.slaPolicyId, 128);
  }
  if (typeof input.snoozedUntilMs === 'number' && input.snoozedUntilMs > 0) {
    payload.snoozedUntilMs = Math.round(input.snoozedUntilMs);
  }
  if (typeof input.aiConfidence === 'number') {
    payload.aiConfidence = clampNumber(input.aiConfidence, 0, 1);
  }
  if (input.aiSentiment) {
    payload.aiSentiment = clampString(input.aiSentiment, 60);
  }
  if (input.aiSummary) {
    payload.aiSummary = clampString(input.aiSummary, 600);
  }
  if (input.parentIncidentRef) {
    payload.parentIncidentRef = clampString(input.parentIncidentRef, 40);
  }
  if (input.mergedIntoRef) {
    payload.mergedIntoRef = clampString(input.mergedIntoRef, 40);
  }
  if (input.splitFromRef) {
    payload.splitFromRef = clampString(input.splitFromRef, 40);
  }

  return payload;
}
