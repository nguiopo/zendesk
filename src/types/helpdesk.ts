import { Timestamp } from 'firebase/firestore';

export type SupportGroup =
  | 'N1 Accès & Comptes'
  | 'N2 Plateforme'
  | 'N3 Infrastructure'
  | 'Relation Client & CTI';

export type AgentAvailability = 'available' | 'busy' | 'on_call' | 'in_call' | 'off_duty';

export type ClientHealthStatus = 'nominal' | 'degraded' | 'out_of_zone' | 'password_locked' | 'critical';

export type ClientTier = 'Enterprise VIP' | 'Business' | 'Standard';

export type TicketChannel =
  | 'email'
  | 'phone'
  | 'chat'
  | 'portal'
  | 'web_form'
  | 'facebook'
  | 'twitter'
  | 'instagram'
  | 'whatsapp'
  | 'slack_teams'
  | 'auto_alert';

export type TicketStatus =
  | 'new'
  | 'open'
  | 'pending_client'
  | 'snoozed'
  | 'escalated'
  | 'resolved'
  | 'closed';

export type TicketPriority = 'critical' | 'high' | 'medium' | 'low';

export type TicketCategory =
  | 'Mot de passe bloqué'
  | 'Hors zone / Connectivité'
  | 'Utilisation plateforme'
  | 'Assistance client'
  | 'Vérification situation'
  | 'Incident infrastructure';

export type OnCallSpecialty =
  | 'Infrastructure N3'
  | 'Réseau & Hors Zone'
  | 'Sécurité & Accès'
  | 'Support VIP';

export type OnCallStatus = 'active' | 'scheduled' | 'standby' | 'completed';

export interface SupportAgent {
  id: string;
  name: string;
  roleTitle: string;
  group: SupportGroup;
  avatarUrl?: string;
  availability: AgentAvailability;
  maxConcurrentTickets: number;
  activeTickets: number;
  callsHandled: number;
  avgCallDurationSec: number;
  situationChecks: number;
  platformUsageScore: number;
  clientAssistanceCount: number;
  passwordUnlocksCount: number;
  outOfZoneFollowups: number;
  slaCompliancePct: number;
  csatScore: number;
  skills?: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ClientAccount {
  id: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  region: string;
  tier: ClientTier;
  healthStatus: ClientHealthStatus;
  platformAdoptionPct: number;
  passwordLocked: boolean;
  outOfZoneSignal: boolean;
  lastVerifiedNote?: string;
  lastVerifiedAt?: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface SlaPolicy {
  id: string;
  name: string;
  priorityScope: TicketPriority;
  firstResponseMinutes: number;
  updateMinutes: number;
  resolutionMinutes: number;
  escalationGroup: string;
  active: boolean;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface Ticket {
  id: string;
  reference: string;
  subject: string;
  description: string;
  channel: TicketChannel;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
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
  isFavorite?: boolean;
  tags: string[];
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface TicketEvent {
  id: string;
  ticketId: string;
  authorName: string;
  authorRole: 'agent' | 'client' | 'system' | 'ai';
  visibility: 'public' | 'internal';
  eventType: 'reply' | 'note' | 'status_change' | 'ai_triage' | 'call_log' | 'password_unlock' | 'macro' | 'merge_split';
  body: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
}

export type LeaveType = 'Congés payés' | 'RTT' | 'Formation' | 'Arrêt / Absence';

export type LeaveStatus = 'approved' | 'pending';

export interface OnCallShift {
  id: string;
  agentId: string;
  agentName: string;
  specialty: OnCallSpecialty;
  dayLabel: string;
  shiftDate?: string;
  timeWindow: string;
  status: OnCallStatus;
  availabilityVerified: boolean;
  escalationPhone: string;
  notes?: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface AgentLeave {
  id: string;
  agentId: string;
  agentName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  notes?: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type AutomationTriggerEvent =
  | 'ticket_created'
  | 'client_reply'
  | 'field_changed'
  | 'sla_warning';

export interface AutomationRule {
  id: string;
  name: string;
  triggerEvent?: AutomationTriggerEvent;
  triggerCategory: string;
  conditionPattern: string;
  actionSummary: string;
  targetGroup: string;
  autoCreateIncident: boolean;
  active: boolean;
  triggeredCount: number;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CallLog {
  id: string;
  clientId: string;
  clientName: string;
  agentId: string;
  agentName: string;
  direction: 'inbound' | 'outbound';
  outcome: 'answered' | 'missed' | 'out_of_zone' | 'callback_scheduled';
  durationSeconds: number;
  linkedTicketRef?: string;
  notes?: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
}

export interface AgentPresence {
  agentName: string;
  agentEmail: string;
  status: 'online' | 'in_call' | 'on_call';
  activeTicketId: string | null;
  typingTicketId: string | null;
  lastSeenAt: number;
}

export interface TeamChatMessage {
  id: string;
  authorName: string;
  authorRole: string;
  ticketRef?: string;
  body: string;
  createdAt: string;
}

export interface SmartRoutingPolicy {
  enabled: boolean;
  prioritizeTenseSentiment: boolean;
  respectAvailability: boolean;
  maxAgentLoadPct: number;
}

export interface AiTriageResult {
  category: TicketCategory;
  priority: TicketPriority;
  assignedGroup: SupportGroup;
  recommendedAgentId?: string;
  recommendedAgentName: string;
  confidence: number;
  sentiment: string;
  sentimentLevel?: 'tense' | 'concerned' | 'neutral' | 'positive';
  tensionScore?: number;
  summary: string;
  isRecurringIncident: boolean;
  suggestedParentIncidentRef?: string;
  routingReason: string;
  suggestedReply: string;
}

export type AppLocale = 'fr' | 'en' | 'es';

export type KbArticleType = 'article' | 'faq' | 'guide';

export interface KbArticle {
  id: string;
  title: string;
  summary: string;
  body: string;
  category: string;
  language: AppLocale;
  articleType: KbArticleType;
  tags: string[];
  published: boolean;
  viewsCount: number;
  deflectionsCount: number;
  helpfulCount: number;
  authorName: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type ForumTopicStatus = 'open' | 'answered' | 'pinned';

export interface ForumTopic {
  id: string;
  title: string;
  body: string;
  category: string;
  language: AppLocale;
  authorName: string;
  authorCompany: string;
  status: ForumTopicStatus;
  upvotes: number;
  repliesCount: number;
  lastReplyNote?: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CsatSurvey {
  id: string;
  ticketId: string;
  ticketRef: string;
  clientId: string;
  clientName: string;
  agentId: string;
  agentName: string;
  rating: number;
  comment: string;
  channel: 'email' | 'portal' | 'phone';
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
}

export interface QaEvaluation {
  id: string;
  agentId: string;
  agentName: string;
  ticketRef: string;
  reviewerName: string;
  greetingScore: number;
  diagnosticScore: number;
  slaComplianceScore: number;
  toneResolutionScore: number;
  totalScore: number;
  trainingNeed: string;
  feedback: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
}

export type WfmActivityType =
  | 'Support N1/N2'
  | 'Téléphonie CTI'
  | 'Astreinte N3'
  | 'Formation / Coaching';

export interface WfmShift {
  id: string;
  agentId: string;
  agentName: string;
  shiftDate: string;
  timeWindow: string;
  plannedHours: number;
  adherencePct: number;
  forecastTickets: number;
  activityType: WfmActivityType;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ExternalIntegration {
  id: string;
  kind: 'marketplace' | 'webhook';
  provider: string;
  name: string;
  category: string;
  endpointUrl?: string;
  eventsSummary: string;
  active: boolean;
  syncCount: number;
  lastSyncAt?: string;
  lastStatus?: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type UserRoleKey = 'agent' | 'supervisor' | 'admin';

export type RbacPermissionKey =
  | 'tickets_manage'
  | 'reports_export'
  | 'wfm_oncall'
  | 'qa_evaluate'
  | 'kb_publish'
  | 'integrations_api'
  | 'gdpr_privacy'
  | 'rbac_admin';

export interface WorkspaceConfig {
  id: string;
  defaultLanguage: AppLocale;
  gdprRetentionDays: number;
  anonymizeClosedAfterDays: number;
  apiKeyPrefix: string;
  agentPermissions: string[];
  supervisorPermissions: string[];
  adminPermissions: string[];
  smartRoutingEnabled?: boolean;
  smartRoutingPrioritizeTense?: boolean;
  smartRoutingRespectAvailability?: boolean;
  smartRoutingMaxLoadPct?: number;
  slaAlertThresholdPct?: number;
  ownerId: string;
  memberIds: string[];
  updatedAt?: Timestamp;
}

export interface AuditLogEntry {
  id: string;
  actorName: string;
  actorRole: UserRoleKey;
  action: string;
  category: 'rgpd' | 'rbac' | 'webhook' | 'integration' | 'qa' | 'kb';
  targetLabel: string;
  details: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
}

export interface SavedTicketView {
  id: string;
  label: string;
  statusFilter: 'all' | 'active' | 'sla_alert' | 'snoozed' | 'escalated' | 'resolved';
  channelGroup: 'all' | 'email_portal' | 'social_chat' | 'voice_team';
  onlyVip?: boolean;
  onlyFavorites?: boolean;
  priorityFilter?: 'all' | TicketPriority;
  priorityFilters?: TicketPriority[];
  supportLevelFilter?: 'all' | SupportGroup;
}

export interface CannedResponseItem {
  id: string;
  title: string;
  category: string;
  body: string;
}

export interface MacroDefinition {
  id: string;
  label: string;
  replyBody: string;
  statusUpdate: TicketStatus;
  targetGroup?: SupportGroup;
  addTag?: string;
}

export interface ChatbotMessage {
  id: string;
  sender: 'user' | 'bot' | 'system';
  text: string;
  timestamp: string;
  suggestedAction?: 'none' | 'unlock_password' | 'check_sla' | 'read_kb' | 'handoff_human';
  needsHumanHandoff?: boolean;
  handoffReason?: string;
  handoffCategory?: TicketCategory;
  handoffPriority?: TicketPriority;
  referencedArticleTitle?: string;
}

export interface CopilotInsight {
  conversationSummary: string;
  nextBestActions: string[];
  suggestedReply: string;
  toneDetected: string;
}

export interface ConversationSummaryResult {
  summary: string;
  keyPoints: string[];
  clientSentiment: string;
  recommendedNextStep: string;
  generatedAt: string;
}

export type ChartAnnotationColor = 'red' | 'amber' | 'blue' | 'emerald' | 'violet';

export type ChartAnnotationTarget =
  | 'operations_timeline'
  | 'capacity_bars'
  | 'client_health_donut';

export type ChartAnnotationCategory =
  | 'Incident majeur'
  | 'Pic hors zone'
  | 'Maintenance / Déploiement'
  | 'Jalon SLA'
  | 'Événement équipe';

export interface ChartAnnotation {
  id: string;
  title: string;
  notes?: string;
  color: ChartAnnotationColor;
  categoryLabel: ChartAnnotationCategory;
  targetChart: ChartAnnotationTarget;
  anchorLabel: string;
  positionPct: number;
  eventDate: string;
  authorName: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type ThemePreferenceMode = 'light' | 'dark' | 'system' | 'schedule';

export interface UserProfileDoc {
  uid: string;
  displayName: string;
  role: UserRoleKey;
  department: string;
  avatarUrl?: string;
  themeMode?: ThemePreferenceMode;
  preferredLocale?: AppLocale;
  updatedAt?: Timestamp;
}

export type OnCallReportEntryType = 'incident' | 'action' | 'escalation' | 'handover' | 'resolved';
export type OnCallReportSeverity = 'info' | 'warning' | 'critical';
export type OnCallReportStatus = 'open' | 'resolved' | 'handed_over';

export interface OnCallReportEntry {
  id: string;
  shiftId?: string;
  shiftLabel: string;
  agentName: string;
  entryType: OnCallReportEntryType;
  severity: OnCallReportSeverity;
  ticketRef?: string;
  title: string;
  details: string;
  problemsEncountered?: string;
  resolutionSteps?: string;
  timeSpentMinutes: number;
  handoverRequired: boolean;
  status: OnCallReportStatus;
  occurredAtLabel: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export type KbPdfContributionStatus = 'to_review' | 'drafting' | 'integrated';

export interface KbPdfDocument {
  id: string;
  title: string;
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  category: string;
  language: AppLocale;
  tags: string[];
  extractedText: string;
  agentNotes: string;
  readingProgressPct: number;
  lastReadPage: number;
  kbContributionStatus: KbPdfContributionStatus;
  linkedKbArticleId?: string;
  linkedKbArticleTitle?: string;
  uploadedBy: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface WeeklyReportRecord {
  id: string;
  weekKey: string;
  weekLabel: string;
  rangeLabel: string;
  generationMode: 'auto' | 'manual';
  totalTickets: number;
  resolvedTickets: number;
  openTickets: number;
  escalatedTickets: number;
  criticalTicketsCount: number;
  slaBreachedCount: number;
  slaCompliancePct: number;
  avgResponseMinutes: number;
  avgCsatScore: string;
  criticalTicketRefs: string[];
  highlights: string;
  generatedBy: string;
  ownerId: string;
  memberIds: string[];
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

