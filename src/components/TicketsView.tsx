import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  increment,
} from 'firebase/firestore';
import {
  AlertTriangle,
  BellRing,
  BookOpen,
  Bot,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  FileText,
  Filter,
  Gauge,
  GitMerge,
  KeyRound,
  Link2,
  Lock,
  MessageSquare,
  Moon,
  Phone,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Star,
  Tag,
  TrendingUp,
  UserCheck,
  X,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AgentPresence,
  AppLocale,
  CannedResponseItem,
  ClientAccount,
  ConversationSummaryResult,
  CopilotInsight,
  KbArticle,
  MacroDefinition,
  SavedTicketView,
  SlaPolicy,
  SupportAgent,
  SupportGroup,
  Ticket,
  TicketCategory,
  TicketChannel,
  TicketEvent,
  TicketPriority,
  TicketStatus,
  WorkspaceConfig,
} from '../types/helpdesk';
import {
  evaluateSlaResponseAlert,
  formatSlaRemaining,
  SlaResponseAlertInfo,
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '../lib/formatters';
import { suggestKbArticles } from '../lib/kbSuggestions';
import { I18N } from '../lib/i18n';
import {
  analyzeTicketSentiment,
  TicketSentimentAnalysis,
  TicketSentimentLevel,
} from '../lib/sentiment';
import { executeSmartTicketRouting, resolveSmartRoutingPolicy } from '../lib/smartRouting';
import { computeGroupQueueSaturation, GroupQueueSaturation } from '../lib/queueSaturation';
import { clampString, clampTags, sanitizeTicketCreatePayload } from '../lib/validation';
import { VoiceDictationModule } from './VoiceDictationModule';

interface TicketsViewProps {
  uid: string;
  currentUserName: string;
  tickets: Ticket[];
  agents: SupportAgent[];
  clients: ClientAccount[];
  slaPolicies: SlaPolicy[];
  kbArticles?: KbArticle[];
  workspaceConfig?: WorkspaceConfig;
  locale?: AppLocale;
  presence: AgentPresence[];
  onPresenceTicketChange: (ticketId: string | null, typingTicketId?: string | null) => void;
  onBroadcastActivity: (ticketId: string, ticketRef: string, actionLabel: string) => void;
  openCreateModalSignal: number;
  externalSearchRequest?: { query?: string; ticketId?: string; nonce: number } | null;
  externalViewMode?: 'all' | 'favorites';
  onExitFavoritesView?: () => void;
}

const CATEGORIES: TicketCategory[] = [
  'Mot de passe bloqué',
  'Hors zone / Connectivité',
  'Utilisation plateforme',
  'Assistance client',
  'Vérification situation',
  'Incident infrastructure',
];

const GROUPS: SupportGroup[] = [
  'N1 Accès & Comptes',
  'N2 Plateforme',
  'N3 Infrastructure',
  'Relation Client & CTI',
];

const PRIORITY_ORDER: readonly TicketPriority[] = ['critical', 'high', 'medium', 'low'];

const SAVED_VIEWS_STORAGE_KEY = 'zentradesk_saved_views_v1';
const CANNED_STORAGE_KEY = 'zentradesk_canned_responses_v1';
const MACROS_STORAGE_KEY = 'zentradesk_macros_v1';

const DEFAULT_SAVED_VIEWS: SavedTicketView[] = [
  { id: 'view_all', label: 'Tous les tickets', statusFilter: 'all', channelGroup: 'all' },
  { id: 'view_social', label: 'Social & Chat', statusFilter: 'active', channelGroup: 'social_chat' },
  { id: 'view_vip', label: 'Comptes VIP actifs', statusFilter: 'active', channelGroup: 'all', onlyVip: true },
  { id: 'view_snoozed', label: 'Snoozés', statusFilter: 'snoozed', channelGroup: 'all' },
];

const DEFAULT_CANNED_RESPONSES: CannedResponseItem[] = [
  {
    id: 'can_ack',
    title: 'Accusé de réception SLA',
    category: 'Assistance client',
    body: 'Bonjour,\n\nNous avons bien pris en charge votre demande. Notre équipe technique analyse actuellement les journaux associés et reviendra vers vous dans le respect de vos engagements SLA.',
  },
  {
    id: 'can_mfa',
    title: 'Procédure réinitialisation MFA',
    category: 'Mot de passe bloqué',
    body: 'Bonjour,\n\nPour sécuriser votre accès, veuillez cliquer sur le lien de réinitialisation MFA valable 30 minutes puis scanner le nouveau QR Code depuis votre application d’authentification.',
  },
  {
    id: 'can_horszone',
    title: 'Activation cache hors zone 72h',
    category: 'Hors zone / Connectivité',
    body: 'Bonjour,\n\nVotre terminal étant actuellement en zone blanche, nous avons activé le mode tampon hors-ligne 72h. Les données seront automatiquement synchronisées dès le retour du signal GSM/4G.',
  },
];

const DEFAULT_MACROS: MacroDefinition[] = [
  {
    id: 'macro_pwd',
    label: 'Macro : Débloquer MFA + Résoudre + Tag mfa-ok',
    replyBody:
      'Bonjour, nous avons vérifié votre compte et réinitialisé votre verrouillage de sécurité. Vous pouvez dès maintenant vous reconnecter avec le lien temporaire envoyé sur votre messagerie de secours.',
    statusUpdate: 'resolved',
    targetGroup: 'N1 Accès & Comptes',
    addTag: 'mfa-resolu',
  },
  {
    id: 'macro_horszone',
    label: 'Macro : Suivi hors zone + Attente + N3',
    replyBody:
      'Bonjour, nous avons tenté de vous joindre par téléphone mais votre terminal apparaît hors zone de couverture. Nous avons activé le suivi proactif et transféré le diagnostic réseau à l’équipe N3.',
    statusUpdate: 'pending_client',
    targetGroup: 'N3 Infrastructure',
    addTag: 'suivi-hors-zone',
  },
  {
    id: 'macro_verif',
    label: 'Macro : Situation validée + Résolu',
    replyBody:
      'Bonjour, la vérification complète de votre situation plateforme et de vos accès vient d’être effectuée par notre équipe : tous les services sont opérationnels et conformes à votre contrat SLA.',
    statusUpdate: 'resolved',
    addTag: 'situation-verifiee',
  },
];

function loadLocalList<T>(key: string, fallback: T[]): T[] {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export const TicketsView: React.FC<TicketsViewProps> = ({
  uid,
  currentUserName,
  tickets,
  agents,
  clients,
  slaPolicies,
  kbArticles = [],
  workspaceConfig,
  locale = 'fr',
  presence,
  onPresenceTicketChange,
  onBroadcastActivity,
  openCreateModalSignal,
  externalSearchRequest,
  externalViewMode = 'all',
  onExitFavoritesView,
}) => {
  const dictTickets = I18N[locale].tickets;
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'sla_alert' | 'snoozed' | 'escalated' | 'resolved'>('all');
  const [channelGroup, setChannelGroup] = useState<'all' | 'email_portal' | 'social_chat' | 'voice_team'>('all');
  const [selectedPriorities, setSelectedPriorities] = useState<TicketPriority[]>([]);
  const [priorityDropdownOpen, setPriorityDropdownOpen] = useState(false);
  const priorityDropdownRef = React.useRef<HTMLDivElement | null>(null);
  const [supportLevelFilter, setSupportLevelFilter] = useState<'all' | SupportGroup>('all');
  const [sentimentFilter, setSentimentFilter] = useState<'all' | TicketSentimentLevel | 'tense_group'>('all');
  const [sortTenseFirst, setSortTenseFirst] = useState(false);
  const [onlyVipFilter, setOnlyVipFilter] = useState(false);
  const [onlyFavoritesFilter, setOnlyFavoritesFilter] = useState(externalViewMode === 'favorites');
  const [savedViews, setSavedViews] = useState<SavedTicketView[]>(() => loadLocalList(SAVED_VIEWS_STORAGE_KEY, DEFAULT_SAVED_VIEWS));
  const [newViewLabel, setNewViewLabel] = useState('');
  const [showSaveViewForm, setShowSaveViewForm] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [composerMode, setComposerMode] = useState<'public' | 'internal'>('public');
  const [composerText, setComposerText] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDraftLoading, setAiDraftLoading] = useState(false);
  const [aiDraftMeta, setAiDraftMeta] = useState<{
    ticketId: string;
    usedKbTitles: string[];
    rationale: string;
  } | null>(null);
  const [sentimentAnalyzing, setSentimentAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Copilot IA state
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [copilotInsight, setCopilotInsight] = useState<CopilotInsight | null>(null);

  // Dedicated Conversation Summary IA state
  const [ticketSummaries, setTicketSummaries] = useState<Record<string, ConversationSummaryResult>>({});
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Merge / Split / Tags / Canned / Macros state
  const [newTagInput, setNewTagInput] = useState('');
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [workbenchNotice, setWorkbenchNotice] = useState<string | null>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);
  const [lastBulkAnchorId, setLastBulkAnchorId] = useState<string | null>(null);
  const [bulkAgentId, setBulkAgentId] = useState<string>('__keep__');
  const [bulkGroup, setBulkGroup] = useState<string>('__keep__');
  const [bulkPriority, setBulkPriority] = useState<'__keep__' | TicketPriority>('__keep__');
  const [bulkStatus, setBulkStatus] = useState<'__keep__' | TicketStatus>('__keep__');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [bulkNotice, setBulkNotice] = useState<{ tone: 'info' | 'warn'; text: string } | null>(null);
  const shiftHeldRef = React.useRef(false);
  const bulkNoticeTimerRef = React.useRef<number | null>(null);
  const [cannedResponses, setCannedResponses] = useState<CannedResponseItem[]>(() =>
    loadLocalList(CANNED_STORAGE_KEY, DEFAULT_CANNED_RESPONSES)
  );
  const [showNewCannedForm, setShowNewCannedForm] = useState(false);
  const [newCannedTitle, setNewCannedTitle] = useState('');
  const [newCannedBody, setNewCannedBody] = useState('');
  const [macros, setMacros] = useState<MacroDefinition[]>(() =>
    loadLocalList(MACROS_STORAGE_KEY, DEFAULT_MACROS)
  );
  const [showNewMacroForm, setShowNewMacroForm] = useState(false);
  const [newMacroLabel, setNewMacroLabel] = useState('');
  const [newMacroReply, setNewMacroReply] = useState('');
  const [newMacroStatus, setNewMacroStatus] = useState<TicketStatus>('resolved');

  // Quick CSAT popover state for resolved tickets
  const [showCsatBox, setShowCsatBox] = useState(false);
  const [csatScoreInput, setCsatScoreInput] = useState(5);
  const [csatCommentInput, setCsatCommentInput] = useState('');
  const [csatSavedNotice, setCsatSavedNotice] = useState<string | null>(null);

  const smartPolicy = useMemo(() => resolveSmartRoutingPolicy(workspaceConfig), [workspaceConfig]);

  // Create Ticket modal state
  const [newSubject, setNewSubject] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newClientId, setNewClientId] = useState('');
  const [newChannel, setNewChannel] = useState<TicketChannel>('email');
  const [newAutoRouteAi, setNewAutoRouteAi] = useState<boolean>(smartPolicy.enabled);
  const [creatingTicket, setCreatingTicket] = useState(false);
  const [dictationStopSignal, setDictationStopSignal] = useState(0);

  useEffect(() => {
    setNewAutoRouteAi(smartPolicy.enabled);
  }, [smartPolicy.enabled]);

  const vipClientIds = useMemo(
    () => new Set(clients.filter((c) => c.tier === 'Enterprise VIP').map((c) => c.id)),
    [clients]
  );

  const showTempNotice = (msg: string) => {
    setWorkbenchNotice(msg);
    window.setTimeout(() => setWorkbenchNotice(null), 4500);
  };

  const modalKbSuggestions = useMemo(
    () => suggestKbArticles(`${newSubject} ${newDescription}`, kbArticles, locale),
    [kbArticles, locale, newDescription, newSubject]
  );

  const handleDeflectNewTicket = async (article: KbArticle) => {
    try {
      await updateDoc(doc(db, 'kbArticles', article.id), {
        deflectionsCount: increment(1),
        helpfulCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      setShowCreateModal(false);
      setNewSubject('');
      setNewDescription('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `kbArticles/${article.id}`);
    }
  };

  const handleSaveTicketCsat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket) return;
    const matchedAgent =
      (activeTicket.assignedAgentId
        ? agents.find((a) => a.id === activeTicket.assignedAgentId)
        : undefined) || agents[0];
    if (!matchedAgent) return;
    try {
      await addDoc(collection(db, 'csatSurveys'), {
        ticketId: activeTicket.id,
        ticketRef: clampString(activeTicket.reference, 40),
        clientId: activeTicket.clientId,
        clientName: clampString(activeTicket.clientName, 150),
        agentId: matchedAgent.id,
        agentName: clampString(matchedAgent.name, 120),
        rating: Math.max(1, Math.min(5, csatScoreInput)),
        comment: clampString(csatCommentInput || 'Enquête post-résolution validée.', 1000),
        channel: 'portal',
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });
      setShowCsatBox(false);
      setCsatCommentInput('');
      setCsatSavedNotice(`Enquête CSAT (${csatScoreInput}/5) enregistrée pour ${activeTicket.reference}.`);
      window.setTimeout(() => setCsatSavedNotice(null), 4000);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'csatSurveys');
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (openCreateModalSignal > 0) {
      setShowCreateModal(true);
    }
  }, [openCreateModalSignal]);

  useEffect(() => {
    if (!priorityDropdownOpen) return;
    const handleOutsideMouseDown = (e: MouseEvent) => {
      if (priorityDropdownRef.current && !priorityDropdownRef.current.contains(e.target as Node)) {
        setPriorityDropdownOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPriorityDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideMouseDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideMouseDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [priorityDropdownOpen]);

  const togglePrioritySelection = (priority: TicketPriority) => {
    setSelectedPriorities((prev) => {
      const next = prev.includes(priority)
        ? prev.filter((item) => item !== priority)
        : [...prev, priority];
      return PRIORITY_ORDER.filter((p) => next.includes(p));
    });
  };

  useEffect(() => {
    if (externalViewMode === 'favorites') {
      setOnlyFavoritesFilter(true);
      setStatusFilter('all');
      setChannelGroup('all');
      setSelectedPriorities([]);
      setSupportLevelFilter('all');
      setSentimentFilter('all');
      setOnlyVipFilter(false);
    } else {
      setOnlyFavoritesFilter(false);
    }
  }, [externalViewMode]);

  useEffect(() => {
    if (!externalSearchRequest) return;
    setStatusFilter('all');
    setChannelGroup('all');
    setSelectedPriorities([]);
    setSupportLevelFilter('all');
    setSentimentFilter('all');
    setOnlyVipFilter(false);
    setOnlyFavoritesFilter(false);
    if (externalSearchRequest.ticketId) {
      setSearchQuery('');
      setSelectedTicketId(externalSearchRequest.ticketId);
    } else if (externalSearchRequest.query !== undefined) {
      setSearchQuery(externalSearchRequest.query);
    }
  }, [externalSearchRequest]);

  useEffect(() => {
    if (!newClientId && clients.length > 0) {
      setNewClientId(clients[0].id);
    }
  }, [clients, newClientId]);

  const slaAlertMap = useMemo(() => {
    const map = new Map<string, SlaResponseAlertInfo>();
    for (const t of tickets) {
      map.set(t.id, evaluateSlaResponseAlert(t, slaPolicies, agents, nowMs));
    }
    return map;
  }, [tickets, slaPolicies, agents, nowMs]);

  const slaAlertCount = useMemo(() => {
    let count = 0;
    for (const info of slaAlertMap.values()) {
      if (info.isAlert) count += 1;
    }
    return count;
  }, [slaAlertMap]);

  const favoriteCount = useMemo(
    () => tickets.filter((t) => Boolean(t.isFavorite)).length,
    [tickets]
  );

  const priorityCounts = useMemo(() => {
    const counts: Record<TicketPriority, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    tickets.forEach((t) => {
      counts[t.priority] = (counts[t.priority] || 0) + 1;
    });
    return counts;
  }, [tickets]);

  const supportLevelCounts = useMemo(() => {
    const counts: Record<SupportGroup, number> = {
      'N1 Accès & Comptes': 0,
      'N2 Plateforme': 0,
      'N3 Infrastructure': 0,
      'Relation Client & CTI': 0,
    };
    tickets.forEach((t) => {
      if (t.assignedGroup in counts) {
        counts[t.assignedGroup as SupportGroup] += 1;
      }
    });
    return counts;
  }, [tickets]);

  const queueSaturation = useMemo(
    () => computeGroupQueueSaturation(tickets, agents),
    [tickets, agents]
  );

  const saturationByGroup = useMemo(() => {
    const map = new Map<SupportGroup, GroupQueueSaturation>();
    for (const item of queueSaturation) {
      map.set(item.group, item);
    }
    return map;
  }, [queueSaturation]);

  const saturatedGroupsCount = useMemo(
    () => queueSaturation.filter((item) => item.level === 'saturated').length,
    [queueSaturation]
  );

  const elevatedGroupsCount = useMemo(
    () => queueSaturation.filter((item) => item.level === 'elevated').length,
    [queueSaturation]
  );

  const sentimentMap = useMemo(() => {
    const map = new Map<string, TicketSentimentAnalysis>();
    for (const t of tickets) {
      map.set(t.id, analyzeTicketSentiment(t, t.id === selectedTicketId ? events : undefined, locale));
    }
    return map;
  }, [tickets, selectedTicketId, events, locale]);

  const sentimentCounts = useMemo(() => {
    const counts: Record<TicketSentimentLevel, number> = {
      tense: 0,
      concerned: 0,
      neutral: 0,
      positive: 0,
    };
    for (const info of sentimentMap.values()) {
      counts[info.level] += 1;
    }
    return counts;
  }, [sentimentMap]);

  const filteredTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = tickets.filter((t) => {
      if (onlyFavoritesFilter && !t.isFavorite) return false;
      if (statusFilter === 'active' && (t.status === 'resolved' || t.status === 'closed' || t.status === 'snoozed')) return false;
      if (statusFilter === 'sla_alert' && !slaAlertMap.get(t.id)?.isAlert) return false;
      if (statusFilter === 'snoozed' && t.status !== 'snoozed') return false;
      if (statusFilter === 'escalated' && t.status !== 'escalated') return false;
      if (statusFilter === 'resolved' && t.status !== 'resolved' && t.status !== 'closed') return false;

      if (selectedPriorities.length > 0 && !selectedPriorities.includes(t.priority)) return false;
      if (supportLevelFilter !== 'all' && t.assignedGroup !== supportLevelFilter) return false;
      if (sentimentFilter !== 'all') {
        const level = sentimentMap.get(t.id)?.level;
        if (sentimentFilter === 'tense_group') {
          if (level !== 'tense' && level !== 'concerned') return false;
        } else if (level !== sentimentFilter) {
          return false;
        }
      }

      if (channelGroup === 'email_portal' && !['email', 'portal', 'web_form'].includes(t.channel)) return false;
      if (channelGroup === 'social_chat' && !['chat', 'facebook', 'twitter', 'instagram', 'whatsapp'].includes(t.channel)) return false;
      if (channelGroup === 'voice_team' && !['phone', 'slack_teams', 'auto_alert'].includes(t.channel)) return false;
      if (onlyVipFilter && !vipClientIds.has(t.clientId)) return false;

      if (!q) return true;
      return (
        t.reference.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.clientName.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some((tg) => tg.toLowerCase().includes(q))
      );
    });

    if (sortTenseFirst) {
      return [...list].sort(
        (a, b) =>
          (sentimentMap.get(b.id)?.tensionScore ?? 0) -
          (sentimentMap.get(a.id)?.tensionScore ?? 0)
      );
    }
    return list;
  }, [
    tickets,
    onlyFavoritesFilter,
    statusFilter,
    selectedPriorities,
    supportLevelFilter,
    sentimentFilter,
    sortTenseFirst,
    sentimentMap,
    channelGroup,
    onlyVipFilter,
    vipClientIds,
    searchQuery,
    slaAlertMap,
  ]);

  const ticketById = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);

  const activeBulkIds = useMemo(
    () => selectedBulkIds.filter((id) => ticketById.has(id)),
    [selectedBulkIds, ticketById]
  );

  const selectedBulkSet = useMemo(() => new Set(activeBulkIds), [activeBulkIds]);

  const allFilteredSelected =
    filteredTickets.length > 0 && filteredTickets.every((t) => selectedBulkSet.has(t.id));
  const someFilteredSelected =
    filteredTickets.some((t) => selectedBulkSet.has(t.id)) && !allFilteredSelected;

  const hasQuickFiltersActive =
    selectedPriorities.length > 0 ||
    supportLevelFilter !== 'all' ||
    sentimentFilter !== 'all' ||
    statusFilter !== 'all' ||
    channelGroup !== 'all' ||
    onlyVipFilter ||
    onlyFavoritesFilter ||
    Boolean(searchQuery.trim());

  const activeTicket = useMemo(() => {
    if (selectedTicketId) {
      const inFiltered = filteredTickets.find((t) => t.id === selectedTicketId);
      if (inFiltered) return inFiltered;
      if (!hasQuickFiltersActive) {
        const found = tickets.find((t) => t.id === selectedTicketId);
        if (found) return found;
      }
    }
    if (hasQuickFiltersActive) {
      return filteredTickets[0] ?? null;
    }
    return filteredTickets[0] ?? tickets[0] ?? null;
  }, [selectedTicketId, filteredTickets, hasQuickFiltersActive, tickets]);

  const activeTicketSlaAlert = activeTicket ? slaAlertMap.get(activeTicket.id) : undefined;
  const activeSentiment = useMemo(
    () => (activeTicket ? analyzeTicketSentiment(activeTicket, events, locale) : null),
    [activeTicket, events, locale]
  );
  const activeTicketKbSuggestions = useMemo(() => {
    if (!activeTicket) return [];
    return suggestKbArticles(`${activeTicket.subject} ${activeTicket.description} ${activeTicket.category}`, kbArticles, locale);
  }, [activeTicket, kbArticles, locale]);

  // Notify WebSocket presence when active ticket changes
  useEffect(() => {
    onPresenceTicketChange(activeTicket?.id ?? null, null);
    setAiExplanation(null);
    setAiError(null);
    setAiDraftMeta(null);
    setCopilotInsight(null);
    setSummaryError(null);
    setSummaryOpen(Boolean(activeTicket?.id && ticketSummaries[activeTicket.id]));
  }, [activeTicket?.id, onPresenceTicketChange]);

  // Subscribe to ticket timeline events
  useEffect(() => {
    if (!activeTicket) {
      setEvents([]);
      return;
    }
    const eventsPath = `tickets/${activeTicket.id}/events`;
    const q = query(
      collection(db, eventsPath),
      where('ownerId', '==', uid),
      orderBy('createdAt', 'asc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TicketEvent, 'id'>) }));
        setEvents(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, eventsPath);
      }
    );

    return () => unsub();
  }, [activeTicket?.id, uid]);

  const collaboratorsOnTicket = useMemo(() => {
    if (!activeTicket) return [];
    return presence.filter(
      (p) => p.activeTicketId === activeTicket.id && p.agentName !== currentUserName
    );
  }, [presence, activeTicket, currentUserName]);

  const handleComposerChange = (val: string) => {
    setComposerText(val);
    if (activeTicket) {
      onPresenceTicketChange(activeTicket.id, val.trim().length > 0 ? activeTicket.id : null);
    }
  };

  const handleUpdateTicketField = async (patch: Record<string, unknown>, activityLabel: string) => {
    if (!activeTicket) return;
    const path = `tickets/${activeTicket.id}`;
    try {
      await updateDoc(doc(db, 'tickets', activeTicket.id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
      onBroadcastActivity(activeTicket.id, activeTicket.reference, activityLabel);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleToggleFavorite = async (ticket: Ticket) => {
    const nextFavorite = !ticket.isFavorite;
    const path = `tickets/${ticket.id}`;
    try {
      await updateDoc(doc(db, 'tickets', ticket.id), {
        isFavorite: nextFavorite,
        updatedAt: serverTimestamp(),
      });
      onBroadcastActivity(
        ticket.id,
        ticket.reference,
        nextFavorite ? 'a ajouté aux favoris' : 'a retiré des favoris'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const showBulkNotice = (text: string, tone: 'info' | 'warn' = 'info') => {
    setBulkNotice({ text, tone });
    if (bulkNoticeTimerRef.current) {
      window.clearTimeout(bulkNoticeTimerRef.current);
    }
    bulkNoticeTimerRef.current = window.setTimeout(() => {
      setBulkNotice(null);
      bulkNoticeTimerRef.current = null;
    }, 4800);
  };

  const handleToggleSelectAllFiltered = () => {
    const filteredIds = filteredTickets.map((t) => t.id);
    if (filteredIds.length === 0) return;
    setSelectedBulkIds((prev) => {
      const validPrev = prev.filter((id) => ticketById.has(id));
      const prevSet = new Set(validPrev);
      const allSelected = filteredIds.every((id) => prevSet.has(id));
      if (allSelected) {
        const filteredSet = new Set(filteredIds);
        return validPrev.filter((id) => !filteredSet.has(id));
      }
      const next = [...validPrev];
      for (const id of filteredIds) {
        if (!prevSet.has(id)) next.push(id);
      }
      return next;
    });
  };

  const handleToggleBulkTicket = (ticketId: string, useRange: boolean) => {
    setSelectedBulkIds((prev) => {
      const validPrev = prev.filter((id) => ticketById.has(id));
      const prevSet = new Set(validPrev);
      const willCheck = !prevSet.has(ticketId);

      if (useRange && lastBulkAnchorId) {
        const startIdx = filteredTickets.findIndex((t) => t.id === lastBulkAnchorId);
        const endIdx = filteredTickets.findIndex((t) => t.id === ticketId);
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const rangeIds = filteredTickets.slice(lo, hi + 1).map((t) => t.id);
          if (willCheck) {
            const next = [...validPrev];
            for (const id of rangeIds) {
              if (!prevSet.has(id)) {
                prevSet.add(id);
                next.push(id);
              }
            }
            return next;
          }
          const rangeSet = new Set(rangeIds);
          return validPrev.filter((id) => !rangeSet.has(id));
        }
      }

      if (prevSet.has(ticketId)) {
        return validPrev.filter((id) => id !== ticketId);
      }
      return [...validPrev, ticketId];
    });
    setLastBulkAnchorId(ticketId);
  };

  const handleClearBulkSelection = () => {
    setSelectedBulkIds([]);
    setLastBulkAnchorId(null);
    setBulkAgentId('__keep__');
    setBulkGroup('__keep__');
    setBulkPriority('__keep__');
    setBulkStatus('__keep__');
  };

  const hasAnyBatchFieldSelected =
    bulkAgentId !== '__keep__' ||
    bulkGroup !== '__keep__' ||
    bulkPriority !== '__keep__' ||
    bulkStatus !== '__keep__';

  const handleApplyBatchActions = async (overrides?: {
    agentId?: string;
    group?: string;
    priority?: '__keep__' | TicketPriority;
    status?: '__keep__' | TicketStatus;
  }) => {
    if (bulkApplying || activeBulkIds.length === 0) return;

    const targetAgentId = overrides?.agentId ?? bulkAgentId;
    const targetGroup = overrides?.group ?? bulkGroup;
    const targetPriority = overrides?.priority ?? bulkPriority;
    const targetStatus = overrides?.status ?? bulkStatus;

    if (
      targetAgentId === '__keep__' &&
      targetGroup === '__keep__' &&
      targetPriority === '__keep__' &&
      targetStatus === '__keep__'
    ) {
      return;
    }

    const selectedTickets = activeBulkIds
      .map((id) => ticketById.get(id))
      .filter((t): t is Ticket => Boolean(t));
    const editableTickets = selectedTickets.filter((t) => t.status !== 'closed');
    const skippedClosed = selectedTickets.length - editableTickets.length;

    if (editableTickets.length === 0) {
      showBulkNotice(dictTickets.bulkAllClosedNotice, 'warn');
      return;
    }

    const updatePatch: Record<string, unknown> = {};
    const changeParts: string[] = [];

    if (targetAgentId !== '__keep__') {
      if (targetAgentId === '__unassign__') {
        updatePatch.assignedAgentId = '';
        updatePatch.assignedAgentName = 'Non assigné';
        changeParts.push(`Agent → ${dictTickets.bulkUnassignedOption}`);
      } else {
        const matchedAgent = agents.find((a) => a.id === targetAgentId);
        if (matchedAgent) {
          updatePatch.assignedAgentId = matchedAgent.id;
          updatePatch.assignedAgentName = clampString(matchedAgent.name, 120);
          changeParts.push(`Agent → ${matchedAgent.name}`);
        }
      }
    }

    if (targetGroup !== '__keep__') {
      updatePatch.assignedGroup = clampString(targetGroup, 100);
      changeParts.push(`Groupe → ${targetGroup}`);
    }

    if (targetPriority !== '__keep__') {
      updatePatch.priority = targetPriority;
      changeParts.push(`Priorité → ${TICKET_PRIORITY_LABELS[targetPriority]}`);
    }

    if (targetStatus !== '__keep__') {
      updatePatch.status = targetStatus;
      changeParts.push(`Statut → ${TICKET_STATUS_LABELS[targetStatus]}`);
    }

    if (Object.keys(updatePatch).length === 0) return;

    setBulkApplying(true);
    try {
      const CHUNK_SIZE = 200; // 2 writes per ticket (update + event) stays safely below 500 ops/batch
      for (let i = 0; i < editableTickets.length; i += CHUNK_SIZE) {
        const chunk = editableTickets.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        for (const ticket of chunk) {
          batch.update(doc(db, 'tickets', ticket.id), {
            ...updatePatch,
            updatedAt: serverTimestamp(),
          });
          const eventRef = doc(collection(db, `tickets/${ticket.id}/events`));
          batch.set(eventRef, {
            ticketId: ticket.id,
            authorName: clampString(currentUserName, 120, 'Superviseur'),
            authorRole: 'agent',
            visibility: 'internal',
            eventType: 'status_change',
            body: clampString(`[Action groupée] ${changeParts.join(' · ')}`, 4000),
            ownerId: uid,
            memberIds: [uid],
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }

      onBroadcastActivity(
        editableTickets[0].id,
        editableTickets.length === 1
          ? editableTickets[0].reference
          : `${editableTickets.length} tickets`,
        changeParts.join(' · ')
      );

      let msg = dictTickets.bulkSuccessNotice.replace('{count}', String(editableTickets.length));
      if (skippedClosed > 0) {
        msg = `${msg} ${dictTickets.bulkSkippedClosedSuffix.replace('{skipped}', String(skippedClosed))}`;
      }
      showBulkNotice(msg, skippedClosed > 0 ? 'warn' : 'info');
      showTempNotice(msg);
      handleClearBulkSelection();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'tickets/batch');
    } finally {
      setBulkApplying(false);
    }
  };

  const handleSendTimelineMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeTicket || !composerText.trim()) return;
    setSubmittingNote(true);
    const eventsPath = `tickets/${activeTicket.id}/events`;
    try {
      await addDoc(collection(db, eventsPath), {
        ticketId: activeTicket.id,
        authorName: clampString(currentUserName, 120, 'Agent'),
        authorRole: 'agent',
        visibility: composerMode,
        eventType: composerMode === 'internal' ? 'note' : 'reply',
        body: clampString(composerText, 4000),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });

      if (composerMode === 'public' && !activeTicket.firstResponded) {
        await updateDoc(doc(db, 'tickets', activeTicket.id), {
          firstResponded: true,
          status: activeTicket.status === 'new' ? 'open' : activeTicket.status,
          updatedAt: serverTimestamp(),
        });
      }

      setComposerText('');
      onPresenceTicketChange(activeTicket.id, null);
      onBroadcastActivity(
        activeTicket.id,
        activeTicket.reference,
        composerMode === 'internal' ? 'a ajouté une note interne' : 'a répondu au client'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, eventsPath);
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleAiRouteTicket = async (ticket: Ticket) => {
    setAiLoading(true);
    setAiError(null);
    setAiExplanation(null);
    try {
      const activeIncidents = tickets
        .filter((t) => t.isRecurringIncident && t.parentIncidentRef)
        .map((t) => `${t.parentIncidentRef} (${t.category})`);

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
          outcome.isRecurringIncident ? 'incident-recurrent' : 'smart-routing',
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
        body: `Smart Routing (${Math.round(outcome.aiConfidence * 100)}% confiance) : Catégorie "${outcome.category}", Priorité "${TICKET_PRIORITY_LABELS[outcome.priority]}", Groupe "${outcome.assignedGroup}"${outcome.assignedAgentName ? `, Agent "${outcome.assignedAgentName}"` : ''}. ${outcome.routingReason}`,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });

      if (outcome.suggestedReply && !composerText.trim()) {
        setComposerMode('public');
        setComposerText(outcome.suggestedReply);
      }
      setAiExplanation(outcome.routingReason);
      onBroadcastActivity(ticket.id, ticket.reference, 'a exécuté le routage IA');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur lors du routage IA.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAnalyzeSentimentAi = async (ticket: Ticket) => {
    if (ticket.status === 'closed') return;
    setSentimentAnalyzing(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: ticket.subject,
          description: ticket.description,
          recentEvents: events,
          locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Échec de l’analyse de sentiment IA.');
      }
      const nextSentiment = clampString(data.aiSentiment || 'Analysé', 60);
      await updateDoc(doc(db, 'tickets', ticket.id), {
        aiSentiment: nextSentiment,
        updatedAt: serverTimestamp(),
      });
      showTempNotice(
        `${dictTickets.sentimentLabel} (${ticket.reference}) : ${nextSentiment} (${Number(data.tensionScore) || 0}/100)`
      );
      onBroadcastActivity(ticket.id, ticket.reference, 'a analysé le sentiment client');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur analyse sentiment IA.');
    } finally {
      setSentimentAnalyzing(false);
    }
  };

  const handleAiDraftReply = async () => {
    if (!activeTicket || activeTicket.status === 'closed') return;
    setAiDraftLoading(true);
    setAiError(null);
    try {
      const clientMessages = events
        .filter((e) => e.authorRole === 'client')
        .slice(-5)
        .map((e) => ({
          authorName: e.authorName,
          body: e.body,
        }));

      const kbQuery = [
        activeTicket.subject,
        activeTicket.description,
        activeTicket.category,
        ...clientMessages.map((m) => m.body),
      ]
        .filter(Boolean)
        .join(' ');

      const matchedKb = suggestKbArticles(kbQuery, kbArticles, locale, 5);
      const matchedIds = new Set(matchedKb.map((a) => a.id));
      const categoryFallback =
        matchedKb.length < 3
          ? kbArticles.filter(
              (a) =>
                a.published &&
                !matchedIds.has(a.id) &&
                a.category.toLowerCase() === activeTicket.category.toLowerCase()
            )
          : [];
      const relevantKb = [...matchedKb, ...categoryFallback].slice(0, 5);

      const res = await fetch('/api/ai/draft-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: activeTicket.reference,
          subject: activeTicket.subject,
          description: activeTicket.description,
          category: activeTicket.category,
          clientName: activeTicket.clientName,
          recentEvents: events.slice(-10),
          clientMessages,
          kbArticles: relevantKb.map((a) => ({
            id: a.id,
            title: a.title,
            category: a.category,
            summary: a.summary,
            body: a.body,
          })),
          mode: composerMode,
          locale,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur de rédaction IA');
      setComposerText(data.draft || '');
      setAiDraftMeta({
        ticketId: activeTicket.id,
        usedKbTitles: Array.isArray(data.usedKbTitles) ? data.usedKbTitles : [],
        rationale: typeof data.rationale === 'string' ? data.rationale : '',
      });
      onBroadcastActivity(activeTicket.id, activeTicket.reference, 'a généré une proposition de réponse IA');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur de rédaction IA.');
    } finally {
      setAiDraftLoading(false);
    }
  };

  const handleQuickPasswordUnlock = async () => {
    if (!activeTicket) return;
    const client = clients.find((c) => c.id === activeTicket.clientId);
    try {
      if (client) {
        await updateDoc(doc(db, 'clients', client.id), {
          passwordLocked: false,
          healthStatus: client.outOfZoneSignal ? 'out_of_zone' : 'nominal',
          lastVerifiedNote: `Mot de passe débloqué via ticket ${activeTicket.reference}.`,
          lastVerifiedAt: 'À l’instant',
          updatedAt: serverTimestamp(),
        });
      }
      if (activeTicket.assignedAgentId) {
        await updateDoc(doc(db, 'agents', activeTicket.assignedAgentId), {
          passwordUnlocksCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      }
      await addDoc(collection(db, `tickets/${activeTicket.id}/events`), {
        ticketId: activeTicket.id,
        authorName: currentUserName,
        authorRole: 'agent',
        visibility: 'public',
        eventType: 'password_unlock',
        body: `Déblocage du mot de passe et réinitialisation MFA déclenchés pour ${activeTicket.clientName}. Le compte client est de nouveau actif.`,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });
      await handleUpdateTicketField({ status: 'resolved', firstResponded: true }, 'a débloqué le mot de passe client');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tickets/${activeTicket.id}`);
    }
  };

  const handleApplyMacro = async (macro: MacroDefinition) => {
    if (!activeTicket) return;
    try {
      const nextTags = macro.addTag
        ? clampTags([...activeTicket.tags, macro.addTag])
        : activeTicket.tags;

      await addDoc(collection(db, `tickets/${activeTicket.id}/events`), {
        ticketId: activeTicket.id,
        authorName: clampString(currentUserName, 120, 'Agent'),
        authorRole: 'agent',
        visibility: 'public',
        eventType: 'macro',
        body: clampString(macro.replyBody, 4000),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });

      const patch: Record<string, unknown> = {
        status: macro.statusUpdate,
        firstResponded: true,
        tags: nextTags,
        updatedAt: serverTimestamp(),
      };
      if (macro.targetGroup) {
        patch.assignedGroup = macro.targetGroup;
      }

      await updateDoc(doc(db, 'tickets', activeTicket.id), patch);
      onBroadcastActivity(activeTicket.id, activeTicket.reference, `a exécuté la macro « ${macro.label} »`);
      showTempNotice(`Macro exécutée sur ${activeTicket.reference} (réponse + statut ${TICKET_STATUS_LABELS[macro.statusUpdate]}).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tickets/${activeTicket.id}`);
    }
  };

  const handleRoundRobinAssign = async (targetTicket?: Ticket) => {
    const t = targetTicket || activeTicket;
    if (!t || agents.length === 0) return;

    const poolInGroup = agents.filter(
      (a) => a.group === t.assignedGroup && (a.availability === 'available' || a.availability === 'on_call')
    );
    const fallbackPool = agents.filter((a) => a.availability === 'available' || a.availability === 'on_call');
    const candidates = poolInGroup.length > 0 ? poolInGroup : fallbackPool.length > 0 ? fallbackPool : agents;

    const sorted = [...candidates].sort((a, b) => {
      const ratioA = a.activeTickets / Math.max(1, a.maxConcurrentTickets);
      const ratioB = b.activeTickets / Math.max(1, b.maxConcurrentTickets);
      return ratioA - ratioB;
    });

    const chosen = sorted.find((a) => a.id !== t.assignedAgentId) || sorted[0];
    if (!chosen) return;

    try {
      await updateDoc(doc(db, 'tickets', t.id), {
        assignedAgentId: chosen.id,
        assignedAgentName: chosen.name,
        assignedGroup: chosen.group,
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, `tickets/${t.id}/events`), {
        ticketId: t.id,
        authorName: currentUserName,
        authorRole: 'system',
        visibility: 'internal',
        eventType: 'status_change',
        body: `Attribution Round-Robin automatique → ${chosen.name} (${chosen.group}, charge ${chosen.activeTickets}/${chosen.maxConcurrentTickets}).`,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });
      onBroadcastActivity(t.id, t.reference, `a attribué en Round-Robin à ${chosen.name}`);
      showTempNotice(`${t.reference} attribué en Round-Robin à ${chosen.name}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tickets/${t.id}`);
    }
  };

  const handleSnoozeTicket = async (hours: number) => {
    if (!activeTicket) return;
    const snoozedUntilMs = Date.now() + hours * 3600 * 1000;
    const label = hours <= 4 ? `+${hours}h` : hours <= 24 ? 'Demain' : `+${hours}h`;
    try {
      await updateDoc(doc(db, 'tickets', activeTicket.id), {
        status: 'snoozed',
        snoozedUntilMs,
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, `tickets/${activeTicket.id}/events`), {
        ticketId: activeTicket.id,
        authorName: currentUserName,
        authorRole: 'agent',
        visibility: 'internal',
        eventType: 'status_change',
        body: `Ticket mis en sommeil (Snoozé ${label}) jusqu’au ${new Date(snoozedUntilMs).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.`,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });
      onBroadcastActivity(activeTicket.id, activeTicket.reference, `a snoozé (${label})`);
      showTempNotice(`${activeTicket.reference} snoozé (${label}).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tickets/${activeTicket.id}`);
    }
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !newTagInput.trim()) return;
    const nextTags = clampTags([...activeTicket.tags, newTagInput.trim().toLowerCase()]);
    setNewTagInput('');
    await handleUpdateTicketField({ tags: nextTags }, 'a ajouté une étiquette');
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!activeTicket) return;
    const nextTags = activeTicket.tags.filter((t) => t !== tagToRemove);
    await handleUpdateTicketField({ tags: nextTags }, 'a retiré une étiquette');
  };

  const handleSplitTicket = async () => {
    if (!activeTicket) return;
    const reference = `ZD-${2065 + tickets.length}`;
    const now = Date.now();
    const payload = sanitizeTicketCreatePayload({
      reference,
      subject: clampString(`[Sous-ticket] ${activeTicket.subject}`, 240),
      description: clampString(
        `Ticket fractionné depuis ${activeTicket.reference} pour traitement parallèle :\n\n${activeTicket.description}`,
        4000
      ),
      channel: activeTicket.channel,
      status: 'open',
      priority: activeTicket.priority,
      category: activeTicket.category,
      clientId: activeTicket.clientId,
      clientName: activeTicket.clientName,
      assignedAgentId: activeTicket.assignedAgentId,
      assignedAgentName: activeTicket.assignedAgentName,
      assignedGroup: activeTicket.assignedGroup,
      slaPolicyId: activeTicket.slaPolicyId,
      firstResponseDueMs: now + 60 * 60 * 1000,
      resolutionDueMs: now + 480 * 60 * 1000,
      firstResponded: false,
      aiRouted: false,
      isRecurringIncident: activeTicket.isRecurringIncident,
      parentIncidentRef: activeTicket.parentIncidentRef,
      splitFromRef: activeTicket.reference,
      tags: clampTags([...activeTicket.tags, 'fractionne']),
      ownerId: uid,
      memberIds: [uid],
    });

    try {
      const created = await addDoc(collection(db, 'tickets'), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, `tickets/${activeTicket.id}/events`), {
        ticketId: activeTicket.id,
        authorName: currentUserName,
        authorRole: 'agent',
        visibility: 'internal',
        eventType: 'merge_split',
        body: `Ticket fractionné vers le nouveau sous-ticket ${reference}.`,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });
      setSelectedTicketId(created.id);
      onBroadcastActivity(activeTicket.id, activeTicket.reference, `a fractionné vers ${reference}`);
      showTempNotice(`Sous-ticket ${reference} créé depuis ${activeTicket.reference}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tickets');
    }
  };

  const handleConfirmMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !mergeTargetId) return;
    const primary = tickets.find((t) => t.id === mergeTargetId);
    if (!primary || primary.id === activeTicket.id) return;

    try {
      await addDoc(collection(db, `tickets/${primary.id}/events`), {
        ticketId: primary.id,
        authorName: currentUserName,
        authorRole: 'agent',
        visibility: 'internal',
        eventType: 'merge_split',
        body: `Fusion du ticket ${activeTicket.reference} (« ${activeTicket.subject} ») dans ce ticket principal.`,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });

      await addDoc(collection(db, `tickets/${activeTicket.id}/events`), {
        ticketId: activeTicket.id,
        authorName: currentUserName,
        authorRole: 'agent',
        visibility: 'internal',
        eventType: 'merge_split',
        body: `Ticket fermé et fusionné dans le ticket principal ${primary.reference}.`,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'tickets', activeTicket.id), {
        status: 'closed',
        mergedIntoRef: primary.reference,
        tags: clampTags([...activeTicket.tags, 'fusionne']),
        updatedAt: serverTimestamp(),
      });

      setShowMergeModal(false);
      setMergeTargetId('');
      setSelectedTicketId(primary.id);
      onBroadcastActivity(primary.id, primary.reference, `a fusionné ${activeTicket.reference}`);
      showTempNotice(`${activeTicket.reference} fusionné dans ${primary.reference}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `tickets/${activeTicket.id}`);
    }
  };

  const handleRunCopilot = async () => {
    if (!activeTicket) return;
    setCopilotOpen(true);
    setCopilotLoading(true);
    setAiError(null);
    try {
      const res = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket: {
            reference: activeTicket.reference,
            subject: activeTicket.subject,
            description: activeTicket.description,
            category: activeTicket.category,
            priority: activeTicket.priority,
            clientName: activeTicket.clientName,
          },
          events: events.slice(-8),
          kbArticles: activeTicketKbSuggestions.map((a) => ({ title: a.title, summary: a.summary })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur Copilote IA');
      setCopilotInsight(data as CopilotInsight);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur du Copilote IA.');
    } finally {
      setCopilotLoading(false);
    }
  };

  const handleGenerateConversationSummary = async () => {
    if (!activeTicket) return;
    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetch('/api/ai/summarize-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket: {
            reference: activeTicket.reference,
            subject: activeTicket.subject,
            description: activeTicket.description,
            category: activeTicket.category,
            priority: activeTicket.priority,
            status: activeTicket.status,
            clientName: activeTicket.clientName,
          },
          events: events.map((ev) => ({
            authorName: ev.authorName,
            authorRole: ev.authorRole,
            visibility: ev.visibility,
            body: ev.body,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Échec du résumé IA');
      setTicketSummaries((prev) => ({
        ...prev,
        [activeTicket.id]: data as ConversationSummaryResult,
      }));
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : 'Erreur lors de la génération du résumé IA.'
      );
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleSaveSummaryAsInternalNote = async (summaryData: ConversationSummaryResult) => {
    if (!activeTicket) return;
    try {
      const noteText = [
        `[Résumé IA · ${activeTicket.reference}]`,
        summaryData.summary,
        summaryData.keyPoints.length > 0
          ? `Points clés :\n${summaryData.keyPoints.map((p) => `- ${p}`).join('\n')}`
          : '',
        `Prochaine étape : ${summaryData.recommendedNextStep}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      await addDoc(collection(db, `tickets/${activeTicket.id}/events`), {
        ticketId: activeTicket.id,
        authorName: clampString(currentUserName, 120, 'Agent'),
        authorRole: 'ai',
        visibility: 'internal',
        eventType: 'ai_triage',
        body: clampString(noteText, 4000),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });
      showTempNotice(`Résumé IA consigné en note interne sur ${activeTicket.reference}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `tickets/${activeTicket.id}/events`);
    }
  };

  const handleSaveCurrentView = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newViewLabel.trim()) return;
    const next: SavedTicketView = {
      id: `view_${Date.now()}`,
      label: newViewLabel.trim().slice(0, 32),
      statusFilter,
      channelGroup,
      onlyVip: onlyVipFilter,
      onlyFavorites: onlyFavoritesFilter,
      ...(selectedPriorities.length > 0
        ? {
            priorityFilters: selectedPriorities,
            ...(selectedPriorities.length === 1 ? { priorityFilter: selectedPriorities[0] } : {}),
          }
        : {}),
      ...(supportLevelFilter !== 'all' ? { supportLevelFilter } : {}),
    };
    const updated = [...savedViews, next];
    setSavedViews(updated);
    window.localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(updated));
    setNewViewLabel('');
    setShowSaveViewForm(false);
  };

  const handleDeleteSavedView = (id: string) => {
    const updated = savedViews.filter((v) => v.id !== id);
    setSavedViews(updated);
    window.localStorage.setItem(SAVED_VIEWS_STORAGE_KEY, JSON.stringify(updated));
  };

  const handleCreateCannedResponse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCannedTitle.trim() || !newCannedBody.trim()) return;
    const next: CannedResponseItem = {
      id: `can_${Date.now()}`,
      title: newCannedTitle.trim().slice(0, 60),
      category: activeTicket?.category || 'Général',
      body: newCannedBody.trim().slice(0, 2000),
    };
    const updated = [next, ...cannedResponses];
    setCannedResponses(updated);
    window.localStorage.setItem(CANNED_STORAGE_KEY, JSON.stringify(updated));
    setNewCannedTitle('');
    setNewCannedBody('');
    setShowNewCannedForm(false);
  };

  const handleCreateMacro = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMacroLabel.trim() || !newMacroReply.trim()) return;
    const next: MacroDefinition = {
      id: `macro_${Date.now()}`,
      label: newMacroLabel.trim().slice(0, 60),
      replyBody: newMacroReply.trim().slice(0, 2000),
      statusUpdate: newMacroStatus,
      addTag: 'macro-perso',
    };
    const updated = [next, ...macros];
    setMacros(updated);
    window.localStorage.setItem(MACROS_STORAGE_KEY, JSON.stringify(updated));
    setNewMacroLabel('');
    setNewMacroReply('');
    setShowNewMacroForm(false);
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim() || !newDescription.trim() || !newClientId) return;
    setCreatingTicket(true);
    setAiError(null);

    try {
      const client = clients.find((c) => c.id === newClientId);
      const refNum = 2048 + tickets.length;
      const reference = `ZD-${refNum}`;

      let category: TicketCategory = 'Assistance client';
      let priority: TicketPriority = 'medium';
      let assignedGroup: SupportGroup = 'N2 Plateforme';
      let assignedAgentId: string | undefined;
      let assignedAgentName: string | undefined;
      let aiRouted = false;
      let aiConfidence: number | undefined;
      let aiSentiment: string | undefined;
      let aiSummary: string | undefined;
      let isRecurringIncident = false;
      let parentIncidentRef: string | undefined;

      let routingNote: string | null = null;

      if (newAutoRouteAi) {
        const activeIncidents = tickets
          .filter((t) => t.isRecurringIncident && t.parentIncidentRef)
          .map((t) => `${t.parentIncidentRef} (${t.category})`);
        const outcome = await executeSmartTicketRouting({
          subject: newSubject,
          description: newDescription,
          channel: newChannel,
          clientName: client?.companyName || 'Client',
          agents,
          activeIncidents,
          policy: smartPolicy,
          locale,
        });
        category = outcome.category;
        priority = outcome.priority;
        assignedGroup = outcome.assignedGroup;
        assignedAgentId = outcome.assignedAgentId;
        assignedAgentName = outcome.assignedAgentName;
        aiRouted = true;
        aiConfidence = outcome.aiConfidence;
        aiSentiment = outcome.aiSentiment;
        aiSummary = outcome.aiSummary;
        isRecurringIncident = outcome.isRecurringIncident;
        parentIncidentRef = outcome.suggestedParentIncidentRef;
        routingNote = outcome.routingReason;
      }

      const matchedSla = slaPolicies.find((s) => s.priorityScope === priority) || slaPolicies[0];
      const firstRespMin = matchedSla?.firstResponseMinutes ?? 60;
      const resMin = matchedSla?.resolutionMinutes ?? 480;
      const now = Date.now();

      const payload = sanitizeTicketCreatePayload({
        reference,
        subject: newSubject,
        description: newDescription,
        channel: newChannel,
        status: priority === 'critical' ? 'escalated' : 'new',
        priority,
        category,
        clientId: newClientId,
        clientName: client?.companyName || 'Client',
        assignedAgentId,
        assignedAgentName,
        assignedGroup,
        slaPolicyId: matchedSla?.id,
        firstResponseDueMs: now + firstRespMin * 60 * 1000,
        resolutionDueMs: now + resMin * 60 * 1000,
        firstResponded: false,
        aiRouted,
        aiConfidence,
        aiSentiment,
        aiSummary,
        isRecurringIncident,
        parentIncidentRef,
        tags: aiRouted ? ['smart-routing', category.toLowerCase().split(' ')[0]] : ['nouveau'],
        ownerId: uid,
        memberIds: [uid],
      });

      const created = await addDoc(collection(db, 'tickets'), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await addDoc(collection(db, `tickets/${created.id}/events`), {
        ticketId: created.id,
        authorName: client?.contactName || 'Client',
        authorRole: 'client',
        visibility: 'public',
        eventType: 'reply',
        body: clampString(newDescription, 4000),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });

      if (routingNote) {
        await addDoc(collection(db, `tickets/${created.id}/events`), {
          ticketId: created.id,
          authorName: 'Smart Routing IA',
          authorRole: 'ai',
          visibility: 'internal',
          eventType: 'ai_triage',
          body: clampString(routingNote, 4000),
          ownerId: uid,
          memberIds: [uid],
          createdAt: serverTimestamp(),
        });
      }

      setDictationStopSignal((n) => n + 1);
      setSelectedTicketId(created.id);
      setShowCreateModal(false);
      setNewSubject('');
      setNewDescription('');
      onBroadcastActivity(created.id, reference, 'a créé un nouveau ticket');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Erreur lors de la création du ticket.');
    } finally {
      setCreatingTicket(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 h-full">
      {/* Left Queue Panel (Zammad Split List) */}
      <section className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
              {onlyFavoritesFilter && (
                <Star className="w-4 h-4 fill-amber-400 text-amber-500 dark:text-amber-400 shrink-0" />
              )}
              <span>{onlyFavoritesFilter ? 'Tickets favoris' : 'File des tickets'}</span>
              <span className="font-mono text-slate-500 dark:text-slate-400 font-medium">
                ({filteredTickets.length})
              </span>
            </h2>
            <div className="flex items-center gap-2 shrink-0">
              {onlyFavoritesFilter && onExitFavoritesView && (
                <button
                  type="button"
                  onClick={() => {
                    setOnlyFavoritesFilter(false);
                    onExitFavoritesView();
                  }}
                  className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Tous les tickets
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(37,99,235,0.2)]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Créer</span>
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher réf., client, tag, mot-clé..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          {/* Saved Custom Views Strip */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <Bookmark className="w-3 h-3 text-blue-600" />
                <span>Vues sauvegardées</span>
              </span>
              <button
                type="button"
                onClick={() => setShowSaveViewForm((v) => !v)}
                className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                + Sauvegarder vue
              </button>
            </div>

            {showSaveViewForm && (
              <form onSubmit={handleSaveCurrentView} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newViewLabel}
                  onChange={(e) => setNewViewLabel(e.target.value)}
                  placeholder="Nom de la vue (ex: VIP N3)"
                  className="flex-1 px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 bg-blue-600 text-white text-xs font-semibold rounded-md cursor-pointer"
                >
                  OK
                </button>
              </form>
            )}

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {savedViews.map((view) => {
                const isDefault = DEFAULT_SAVED_VIEWS.some((d) => d.id === view.id);
                const viewPriorities = PRIORITY_ORDER.filter((p) =>
                  (
                    view.priorityFilters ??
                    (view.priorityFilter && view.priorityFilter !== 'all' ? [view.priorityFilter] : [])
                  ).includes(p)
                );
                const prioritiesMatch =
                  viewPriorities.length === selectedPriorities.length &&
                  viewPriorities.every((p, idx) => p === selectedPriorities[idx]);
                const isActive =
                  statusFilter === view.statusFilter &&
                  channelGroup === view.channelGroup &&
                  prioritiesMatch &&
                  supportLevelFilter === (view.supportLevelFilter ?? 'all') &&
                  Boolean(onlyVipFilter) === Boolean(view.onlyVip) &&
                  Boolean(onlyFavoritesFilter) === Boolean(view.onlyFavorites);
                return (
                  <div
                    key={view.id}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setStatusFilter(view.statusFilter);
                        setChannelGroup(view.channelGroup);
                        setSelectedPriorities(viewPriorities);
                        setSupportLevelFilter(view.supportLevelFilter ?? 'all');
                        setOnlyVipFilter(Boolean(view.onlyVip));
                        setOnlyFavoritesFilter(Boolean(view.onlyFavorites));
                      }}
                      className="cursor-pointer"
                    >
                      {view.label}
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        onClick={() => handleDeleteSavedView(view.id)}
                        aria-label={`Supprimer vue ${view.label}`}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto">
            {(
              [
                ['all', dictTickets.statusTabs.all],
                ['active', dictTickets.statusTabs.active],
                ['sla_alert', `${dictTickets.statusTabs.slaAlert} (${slaAlertCount})`],
                ['snoozed', dictTickets.statusTabs.snoozed],
                ['escalated', dictTickets.statusTabs.escalated],
                ['resolved', dictTickets.statusTabs.resolved],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === key
                    ? key === 'sla_alert'
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : key === 'sla_alert' && slaAlertCount > 0
                    ? 'text-red-700 dark:text-red-400 hover:bg-red-50/70 dark:hover:bg-red-950/40 sla-alert-pulse'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Queue / Channel Group Filter */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
            <select
              value={channelGroup}
              onChange={(e) => setChannelGroup(e.target.value as typeof channelGroup)}
              className="flex-1 min-w-[160px] px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
            >
              <option value="all">{dictTickets.channelAll}</option>
              <option value="email_portal">{dictTickets.channelEmailPortal}</option>
              <option value="social_chat">{dictTickets.channelSocialChat}</option>
              <option value="voice_team">{dictTickets.channelVoiceTeam}</option>
            </select>
            <button
              type="button"
              onClick={() => {
                if (onlyFavoritesFilter) {
                  setOnlyFavoritesFilter(false);
                  onExitFavoritesView?.();
                } else {
                  setOnlyFavoritesFilter(true);
                }
              }}
              aria-pressed={onlyFavoritesFilter}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                onlyFavoritesFilter
                  ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                  : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
              }`}
            >
              <Star
                className={`w-3.5 h-3.5 shrink-0 ${
                  onlyFavoritesFilter
                    ? 'fill-amber-400 text-amber-500 dark:text-amber-400'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              />
              <span>{dictTickets.favorites}</span>
              <span className="font-mono tabular-nums text-[11px] opacity-80">({favoriteCount})</span>
            </button>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-600 dark:text-slate-300 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={onlyVipFilter}
                onChange={(e) => setOnlyVipFilter(e.target.checked)}
              />
              <span>{dictTickets.vipOnly}</span>
            </label>
          </div>

          {/* Quick Filters: Multi-Select Priority Dropdown + Priority Pills + Support Level */}
          <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                  {dictTickets.quickPriority}
                </span>

                {/* Multi-select Priority Dropdown */}
                <div ref={priorityDropdownRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={priorityDropdownOpen}
                    onClick={() => setPriorityDropdownOpen((open) => !open)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedPriorities.length > 0
                        ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Filter className="w-3.5 h-3.5 shrink-0 opacity-80" />
                    <span className="max-w-[180px] truncate">
                      {selectedPriorities.length === 0
                        ? `${dictTickets.priorityDropdownLabel}: ${dictTickets.allPriorities}`
                        : selectedPriorities.length === 1
                        ? `${dictTickets.priorityDropdownLabel}: ${dictTickets.priorityLabels[selectedPriorities[0]]}`
                        : `${selectedPriorities.map((p) => dictTickets.priorityLabels[p]).join(', ')} (${selectedPriorities.length})`}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                        priorityDropdownOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {priorityDropdownOpen && (
                    <div className="absolute left-0 top-full mt-1.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg p-2 z-40 space-y-1.5">
                      <div className="flex items-center justify-between px-1.5 py-0.5 text-[11px]">
                        <span className="font-medium text-slate-500 dark:text-slate-400">
                          {dictTickets.priorityMultiHint}
                        </span>
                        {selectedPriorities.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectedPriorities([])}
                            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                          >
                            {dictTickets.priorityClearSelection}
                          </button>
                        )}
                      </div>

                      <div
                        role="listbox"
                        aria-multiselectable="true"
                        aria-label={dictTickets.priorityDropdownLabel}
                        className="space-y-1"
                      >
                        {(
                          [
                            {
                              key: 'critical',
                              label: dictTickets.priorityLabels.critical,
                              count: priorityCounts.critical,
                              dotClass: 'bg-red-500',
                            },
                            {
                              key: 'high',
                              label: dictTickets.priorityLabels.high,
                              count: priorityCounts.high,
                              dotClass: 'bg-amber-500',
                            },
                            {
                              key: 'medium',
                              label: dictTickets.priorityLabels.medium,
                              count: priorityCounts.medium,
                              dotClass: 'bg-blue-500',
                            },
                            {
                              key: 'low',
                              label: dictTickets.priorityLabels.low,
                              count: priorityCounts.low,
                              dotClass: 'bg-emerald-500',
                            },
                          ] as const
                        ).map((opt) => {
                          const isChecked = selectedPriorities.includes(opt.key);
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              role="option"
                              aria-selected={isChecked}
                              onClick={() => togglePrioritySelection(opt.key)}
                              className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                                isChecked
                                  ? 'bg-blue-50/80 dark:bg-blue-950/40 text-slate-900 dark:text-slate-100 font-semibold'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                              }`}
                            >
                              <span className="inline-flex items-center gap-2 min-w-0">
                                <span
                                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                    isChecked
                                      ? 'bg-blue-600 border-blue-600 text-white'
                                      : 'bg-white dark:bg-slate-950 border-slate-300 dark:border-slate-600'
                                  }`}
                                >
                                  {isChecked && <Check className="w-3 h-3 stroke-[2.5]" />}
                                </span>
                                <span className={`w-2 h-2 rounded-xs shrink-0 ${opt.dotClass}`} />
                                <span className="truncate">{opt.label}</span>
                              </span>
                              <span className="font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                                {opt.count}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="pt-1.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedPriorities(['critical', 'high'])}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/70 border border-red-200 dark:border-red-900/70 text-[11px] font-semibold text-red-700 dark:text-red-300 transition-colors cursor-pointer"
                        >
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span className="truncate">{dictTickets.priorityUrgentPreset}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {(selectedPriorities.length > 0 || supportLevelFilter !== 'all' || sentimentFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPriorities([]);
                    setSupportLevelFilter('all');
                    setSentimentFilter('all');
                  }}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  {dictTickets.resetFilters}
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={dictTickets.quickPriority}>
              {(
                [
                  {
                    key: 'all',
                    label: dictTickets.allPriorities,
                    count: tickets.length,
                    dotClass: '',
                    activeClass:
                      'bg-slate-900 dark:bg-slate-100 border-slate-900 dark:border-slate-100 text-white dark:text-slate-900',
                  },
                  {
                    key: 'critical',
                    label: dictTickets.priorityLabels.critical,
                    count: priorityCounts.critical,
                    dotClass: 'bg-red-500',
                    activeClass:
                      'bg-red-600 border-red-600 text-white',
                  },
                  {
                    key: 'high',
                    label: dictTickets.priorityLabels.high,
                    count: priorityCounts.high,
                    dotClass: 'bg-amber-500',
                    activeClass:
                      'bg-amber-600 border-amber-600 text-white',
                  },
                  {
                    key: 'medium',
                    label: dictTickets.priorityLabels.medium,
                    count: priorityCounts.medium,
                    dotClass: 'bg-blue-500',
                    activeClass:
                      'bg-blue-600 border-blue-600 text-white',
                  },
                  {
                    key: 'low',
                    label: dictTickets.priorityLabels.low,
                    count: priorityCounts.low,
                    dotClass: 'bg-emerald-500',
                    activeClass:
                      'bg-emerald-600 border-emerald-600 text-white',
                  },
                ] as const
              ).map((item) => {
                const isSelected =
                  item.key === 'all'
                    ? selectedPriorities.length === 0
                    : selectedPriorities.includes(item.key);
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (item.key === 'all') {
                        setSelectedPriorities([]);
                      } else {
                        togglePrioritySelection(item.key);
                      }
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? item.activeClass
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {item.dotClass && (
                      <span
                        className={`w-2 h-2 rounded-xs shrink-0 ${
                          isSelected ? 'bg-white' : item.dotClass
                        }`}
                      />
                    )}
                    <span>{item.label}</span>
                    <span className="font-mono tabular-nums opacity-80">({item.count})</span>
                  </button>
                );
              })}
            </div>

            <div className="space-y-1">
              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {dictTickets.supportLevel}
              </span>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={dictTickets.supportLevel}>
                {(
                  [
                    { key: 'all', label: dictTickets.allLevels, count: tickets.length },
                    { key: 'N1 Accès & Comptes', label: dictTickets.levelLabels.n1, count: supportLevelCounts['N1 Accès & Comptes'] },
                    { key: 'N2 Plateforme', label: dictTickets.levelLabels.n2, count: supportLevelCounts['N2 Plateforme'] },
                    { key: 'N3 Infrastructure', label: dictTickets.levelLabels.n3, count: supportLevelCounts['N3 Infrastructure'] },
                    { key: 'Relation Client & CTI', label: dictTickets.levelLabels.cti, count: supportLevelCounts['Relation Client & CTI'] },
                  ] as const
                ).map((lvl) => {
                  const isSelected = supportLevelFilter === lvl.key;
                  const sat = lvl.key !== 'all' ? saturationByGroup.get(lvl.key) : undefined;
                  const isSaturated = sat?.level === 'saturated';
                  const isElevated = sat?.level === 'elevated';

                  return (
                    <button
                      key={lvl.key}
                      type="button"
                      aria-pressed={isSelected}
                      title={
                        sat
                          ? `${lvl.label}: ${sat.currentVolume}/${sat.historicalCapacity} ${dictTickets.queueSaturationCapShort} (${sat.saturationPct}%)`
                          : undefined
                      }
                      onClick={() =>
                        setSupportLevelFilter((prev) =>
                          prev === lvl.key && lvl.key !== 'all' ? 'all' : lvl.key
                        )
                      }
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isSelected
                          ? isSaturated
                            ? 'bg-red-600 border-red-600 text-white'
                            : 'bg-blue-600 border-blue-600 text-white'
                          : isSaturated
                          ? 'bg-red-50/80 dark:bg-red-950/35 border-red-300/90 dark:border-red-800/80 text-red-700 dark:text-red-300 hover:bg-red-100/80 dark:hover:bg-red-950/55'
                          : isElevated
                          ? 'bg-amber-50/75 dark:bg-amber-950/30 border-amber-300/90 dark:border-amber-800/80 text-amber-800 dark:text-amber-300 hover:bg-amber-100/80 dark:hover:bg-amber-950/50'
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {isSaturated && (
                        <AlertTriangle
                          className={`w-3 h-3 shrink-0 ${
                            isSelected ? 'text-white' : 'text-red-600 dark:text-red-400'
                          }`}
                        />
                      )}
                      {isElevated && (
                        <TrendingUp
                          className={`w-3 h-3 shrink-0 ${
                            isSelected ? 'text-white' : 'text-amber-600 dark:text-amber-400'
                          }`}
                        />
                      )}
                      <span>{lvl.label}</span>
                      <span className="font-mono tabular-nums opacity-80">({lvl.count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {dictTickets.sentimentFilter}
                </span>
                <button
                  type="button"
                  aria-pressed={sortTenseFirst}
                  onClick={() => setSortTenseFirst((v) => !v)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    sortTenseFirst
                      ? 'bg-red-600 border-red-600 text-white'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span aria-hidden="true">😠</span>
                  <span>{dictTickets.sortTenseFirst}</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={dictTickets.sentimentFilter}>
                {(
                  [
                    {
                      key: 'all',
                      emoji: '',
                      label: dictTickets.allSentiments,
                      count: tickets.length,
                      activeClass:
                        'bg-slate-900 dark:bg-slate-100 border-slate-900 dark:border-slate-100 text-white dark:text-slate-900',
                    },
                    {
                      key: 'tense',
                      emoji: '😠',
                      label: dictTickets.sentimentTense,
                      count: sentimentCounts.tense,
                      activeClass: 'bg-red-600 border-red-600 text-white',
                    },
                    {
                      key: 'concerned',
                      emoji: '😟',
                      label: dictTickets.sentimentConcerned,
                      count: sentimentCounts.concerned,
                      activeClass: 'bg-amber-600 border-amber-600 text-white',
                    },
                    {
                      key: 'neutral',
                      emoji: '😐',
                      label: dictTickets.sentimentNeutral,
                      count: sentimentCounts.neutral,
                      activeClass: 'bg-slate-700 border-slate-700 text-white',
                    },
                    {
                      key: 'positive',
                      emoji: '😊',
                      label: dictTickets.sentimentPositive,
                      count: sentimentCounts.positive,
                      activeClass: 'bg-emerald-600 border-emerald-600 text-white',
                    },
                  ] as const
                ).map((item) => {
                  const isSelected = sentimentFilter === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() =>
                        setSentimentFilter((prev) =>
                          prev === item.key && item.key !== 'all' ? 'all' : item.key
                        )
                      }
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isSelected
                          ? item.activeClass
                          : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {item.emoji && (
                        <span aria-hidden="true" className="leading-none">
                          {item.emoji}
                        </span>
                      )}
                      <span>{item.label}</span>
                      <span className="font-mono tabular-nums opacity-80">({item.count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Supervisor Emotional Load Sentiment Pie Chart (Positif / Neutre / Tendu) */}
            {(() => {
              const totalAnalyzed = tickets.length;
              const tenseCombined = sentimentCounts.tense + sentimentCounts.concerned;
              const pieSlices = [
                {
                  key: 'positive' as const,
                  name: dictTickets.sentimentChartPositive,
                  value: sentimentCounts.positive,
                  color: '#10b981',
                  dotClass: 'bg-emerald-500',
                  filterValue: 'positive' as const,
                },
                {
                  key: 'neutral' as const,
                  name: dictTickets.sentimentChartNeutral,
                  value: sentimentCounts.neutral,
                  color: '#64748b',
                  dotClass: 'bg-slate-500',
                  filterValue: 'neutral' as const,
                },
                {
                  key: 'tense_group' as const,
                  name: dictTickets.sentimentChartTense,
                  value: tenseCombined,
                  color: '#ef4444',
                  dotClass: 'bg-red-500',
                  filterValue: 'tense_group' as const,
                },
              ];
              const chartSlices = pieSlices.filter((s) => s.value > 0);
              const tensePct =
                totalAnalyzed > 0 ? Math.round((tenseCombined / totalAnalyzed) * 100) : 0;

              return (
                <div
                  aria-label={dictTickets.sentimentChartTitle}
                  className="p-2.5 rounded-lg bg-slate-50/80 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {dictTickets.sentimentChartTitle}
                      </p>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                        {dictTickets.sentimentChartSubtitle}
                      </p>
                    </div>
                    <span
                      className={`font-mono tabular-nums text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                        tensePct >= 40
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {tensePct}% {dictTickets.sentimentChartTense.toLowerCase()}
                    </span>
                  </div>

                  {totalAnalyzed === 0 ? (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 py-2 text-center">
                      {dictTickets.sentimentChartEmpty}
                    </p>
                  ) : (
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-24 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={chartSlices}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={24}
                              outerRadius={42}
                              paddingAngle={chartSlices.length > 1 ? 3 : 0}
                              stroke="none"
                              onClick={(_data, index) => {
                                const fv = chartSlices[index]?.filterValue;
                                if (!fv) return;
                                setSentimentFilter((prev) => (prev === fv ? 'all' : fv));
                              }}
                              className="cursor-pointer focus:outline-none"
                            >
                              {chartSlices.map((slice) => {
                                const isDimmed =
                                  sentimentFilter !== 'all' &&
                                  sentimentFilter !== slice.filterValue &&
                                  !(
                                    slice.filterValue === 'tense_group' &&
                                    (sentimentFilter === 'tense' || sentimentFilter === 'concerned')
                                  );
                                return (
                                  <Cell
                                    key={slice.key}
                                    fill={slice.color}
                                    fillOpacity={isDimmed ? 0.35 : 1}
                                  />
                                );
                              })}
                            </Pie>
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload || payload.length === 0) return null;
                                const item = payload[0]?.payload as (typeof pieSlices)[number] | undefined;
                                if (!item) return null;
                                const pct = Math.round((item.value / totalAnalyzed) * 100);
                                return (
                                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1.5 shadow-md text-[11px] text-slate-800 dark:text-slate-100">
                                    <span className="font-semibold">{item.name}</span>:{' '}
                                    <span className="font-mono tabular-nums font-bold">
                                      {item.value}
                                    </span>{' '}
                                    ({pct}%)
                                  </div>
                                );
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="flex-1 min-w-0 space-y-1">
                        {pieSlices.map((slice) => {
                          const pct =
                            totalAnalyzed > 0
                              ? Math.round((slice.value / totalAnalyzed) * 100)
                              : 0;
                          const isActive =
                            sentimentFilter === slice.filterValue ||
                            (slice.filterValue === 'tense_group' &&
                              (sentimentFilter === 'tense' || sentimentFilter === 'concerned'));

                          return (
                            <button
                              key={slice.key}
                              type="button"
                              aria-pressed={isActive}
                              onClick={() =>
                                setSentimentFilter((prev) =>
                                  prev === slice.filterValue ? 'all' : slice.filterValue
                                )
                              }
                              className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11px] transition-colors cursor-pointer ${
                                isActive
                                  ? 'bg-white dark:bg-slate-900 ring-1 ring-slate-300 dark:ring-slate-700 font-semibold text-slate-900 dark:text-slate-100'
                                  : 'text-slate-700 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-900/60'
                              }`}
                            >
                              <span className="inline-flex items-center gap-1.5 min-w-0">
                                <span
                                  className={`w-2 h-2 rounded-xs shrink-0 ${slice.dotClass}`}
                                  aria-hidden="true"
                                />
                                <span className="truncate">{slice.name}</span>
                              </span>
                              <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-400 shrink-0">
                                <strong className="text-slate-900 dark:text-slate-100">
                                  {slice.value}
                                </strong>{' '}
                                ({pct}%)
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Queue Saturation Visual Indicator by Support Group */}
            {(() => {
              const shortGroupLabels: Record<SupportGroup, string> = {
                'N1 Accès & Comptes': dictTickets.levelLabels.n1,
                'N2 Plateforme': dictTickets.levelLabels.n2,
                'N3 Infrastructure': dictTickets.levelLabels.n3,
                'Relation Client & CTI': dictTickets.levelLabels.cti,
              };
              const scaleMax = Math.max(
                150,
                ...queueSaturation.map((item) => item.saturationPct)
              );
              const baselineTickPct = Math.round((100 / scaleMax) * 100);

              return (
                <div
                  aria-label={dictTickets.queueSaturationTitle}
                  className="p-2.5 rounded-lg bg-slate-50/80 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Gauge
                        className={`w-3.5 h-3.5 shrink-0 ${
                          saturatedGroupsCount > 0
                            ? 'text-red-600 dark:text-red-400'
                            : elevatedGroupsCount > 0
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate">
                          {dictTickets.queueSaturationTitle}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                          {dictTickets.queueSaturationSubtitle}
                        </p>
                      </div>
                    </div>

                    <span
                      className={`font-mono tabular-nums text-[11px] font-semibold whitespace-nowrap shrink-0 ${
                        saturatedGroupsCount > 0
                          ? 'text-red-600 dark:text-red-400'
                          : elevatedGroupsCount > 0
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {saturatedGroupsCount > 0
                        ? `${saturatedGroupsCount} ${dictTickets.queueSaturationSaturatedCountSuffix}`
                        : elevatedGroupsCount > 0
                        ? `${elevatedGroupsCount} ${dictTickets.queueSaturationElevatedCountSuffix}`
                        : dictTickets.queueSaturationNominal}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {queueSaturation.map((item) => {
                      const isActive = supportLevelFilter === item.group;
                      const fillWidthPct = Math.min(
                        100,
                        Math.max(4, Math.round((item.saturationPct / scaleMax) * 100))
                      );
                      const isSaturated = item.level === 'saturated';
                      const isElevated = item.level === 'elevated';

                      return (
                        <button
                          key={item.group}
                          type="button"
                          aria-pressed={isActive}
                          onClick={() =>
                            setSupportLevelFilter((prev) =>
                              prev === item.group ? 'all' : item.group
                            )
                          }
                          className={`w-full text-left px-2 py-1.5 rounded-md border transition-colors cursor-pointer space-y-1 ${
                            isActive
                              ? 'bg-white dark:bg-slate-900 border-blue-400 dark:border-blue-600 ring-1 ring-blue-300/70 dark:ring-blue-700/70'
                              : isSaturated
                              ? 'bg-red-50/70 dark:bg-red-950/25 border-red-200/90 dark:border-red-900/70 hover:bg-red-50 dark:hover:bg-red-950/40'
                              : 'bg-white/70 dark:bg-slate-900/50 border-slate-200/70 dark:border-slate-800/80 hover:bg-white dark:hover:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="inline-flex items-center gap-1.5 min-w-0">
                              <span className="font-medium text-slate-800 dark:text-slate-200 truncate">
                                {shortGroupLabels[item.group]}
                              </span>
                              <span
                                className={`inline-flex items-center gap-0.5 font-semibold shrink-0 ${
                                  isSaturated
                                    ? 'text-red-700 dark:text-red-400'
                                    : isElevated
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-emerald-700 dark:text-emerald-400'
                                }`}
                              >
                                {isSaturated ? (
                                  <AlertTriangle className="w-3 h-3 shrink-0" />
                                ) : isElevated ? (
                                  <TrendingUp className="w-3 h-3 shrink-0" />
                                ) : (
                                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                                )}
                                <span>
                                  {isSaturated
                                    ? dictTickets.queueSaturationSaturatedLabel
                                    : isElevated
                                    ? dictTickets.queueSaturationElevatedLabel
                                    : dictTickets.queueSaturationNormalLabel}
                                </span>
                              </span>
                            </span>

                            <span className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap shrink-0">
                              <strong className="text-slate-900 dark:text-slate-100">
                                {item.currentVolume}
                              </strong>
                              /{item.historicalCapacity} {dictTickets.queueSaturationCapShort} ·{' '}
                              <span
                                className={
                                  isSaturated
                                    ? 'text-red-700 dark:text-red-400 font-semibold'
                                    : isElevated
                                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                    : 'text-slate-700 dark:text-slate-300 font-semibold'
                                }
                              >
                                {item.saturationPct}%
                              </span>
                              {item.excessPct > 0 && (
                                <span
                                  className={
                                    isSaturated
                                      ? ' text-red-600 dark:text-red-400 font-semibold'
                                      : ' text-amber-600 dark:text-amber-400 font-semibold'
                                  }
                                >
                                  {' '}
                                  (+{item.excessPct}%)
                                </span>
                              )}
                            </span>
                          </div>

                          <div
                            className="relative h-1.5 w-full rounded-full bg-slate-200/90 dark:bg-slate-800 overflow-hidden"
                            aria-hidden="true"
                          >
                            <div
                              className={`h-full rounded-full transition-all ${
                                isSaturated
                                  ? 'bg-red-600 dark:bg-red-500'
                                  : isElevated
                                  ? 'bg-amber-500 dark:bg-amber-400'
                                  : 'bg-emerald-600 dark:bg-emerald-500'
                              }`}
                              style={{ width: `${fillWidthPct}%` }}
                            />
                            <span
                              className="absolute top-0 bottom-0 w-px bg-slate-500/70 dark:bg-slate-300/60"
                              style={{ left: `${baselineTickPct}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Bulk Selection Column Header & Batch Actions Bar */}
        {filteredTickets.length > 0 && (
          <div className="border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2 px-3.5 sm:px-4 py-2 bg-slate-50/85 dark:bg-slate-950/60">
              <label className="inline-flex items-center gap-3 min-w-0 cursor-pointer select-none">
                <span className="w-4 flex items-center justify-center shrink-0">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = someFilteredSelected;
                    }}
                    checked={allFilteredSelected}
                    onChange={handleToggleSelectAllFiltered}
                    aria-label={dictTickets.bulkSelectAllAria}
                    className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer accent-blue-600"
                  />
                </span>
                <span
                  className={`text-xs truncate ${
                    activeBulkIds.length > 0
                      ? 'font-semibold text-blue-700 dark:text-blue-300'
                      : 'font-medium text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {activeBulkIds.length > 0 ? (
                    <span className="font-mono tabular-nums">
                      {activeBulkIds.length} {dictTickets.bulkSelectedCountSuffix}
                    </span>
                  ) : (
                    <span>
                      {dictTickets.bulkSelectAllLabel} ({filteredTickets.length})
                    </span>
                  )}
                </span>
              </label>

              {activeBulkIds.length > 0 ? (
                <button
                  type="button"
                  onClick={handleClearBulkSelection}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  <X className="w-3 h-3" />
                  <span>{dictTickets.bulkClearSelection}</span>
                </button>
              ) : (
                <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                  {filteredTickets.length}/{tickets.length}
                </span>
              )}
            </div>

            {activeBulkIds.length > 0 && (
              <div className="px-3.5 sm:px-4 py-2.5 bg-blue-50/75 dark:bg-blue-950/30 border-t border-blue-200/80 dark:border-blue-900/70 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={bulkAgentId}
                    onChange={(e) => setBulkAgentId(e.target.value)}
                    aria-label={dictTickets.bulkAssignAgentPlaceholder}
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
                  >
                    <option value="__keep__">{dictTickets.bulkAssignAgentPlaceholder}</option>
                    <option value="__unassign__">{dictTickets.bulkUnassignedOption}</option>
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.name} ({ag.activeTickets}/{ag.maxConcurrentTickets})
                      </option>
                    ))}
                  </select>

                  <select
                    value={bulkPriority}
                    onChange={(e) => setBulkPriority(e.target.value as '__keep__' | TicketPriority)}
                    aria-label={dictTickets.bulkPriorityPlaceholder}
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
                  >
                    <option value="__keep__">{dictTickets.bulkPriorityPlaceholder}</option>
                    {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map((pr) => (
                      <option key={pr} value={pr}>
                        {TICKET_PRIORITY_LABELS[pr]}
                      </option>
                    ))}
                  </select>

                  <select
                    value={bulkGroup}
                    onChange={(e) => setBulkGroup(e.target.value)}
                    aria-label={dictTickets.bulkAssignGroupPlaceholder}
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
                  >
                    <option value="__keep__">{dictTickets.bulkAssignGroupPlaceholder}</option>
                    {GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>

                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value as '__keep__' | TicketStatus)}
                    aria-label={dictTickets.bulkStatusPlaceholder}
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200"
                  >
                    <option value="__keep__">{dictTickets.bulkStatusPlaceholder}</option>
                    {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {TICKET_STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={bulkApplying}
                      onClick={() =>
                        handleApplyBatchActions({
                          status: 'resolved',
                          agentId: '__keep__',
                          group: '__keep__',
                          priority: '__keep__',
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      <span>{dictTickets.bulkQuickResolve}</span>
                    </button>
                    <button
                      type="button"
                      disabled={bulkApplying}
                      onClick={() =>
                        handleApplyBatchActions({
                          status: 'escalated',
                          agentId: '__keep__',
                          group: '__keep__',
                          priority: '__keep__',
                        })
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>{dictTickets.bulkQuickEscalate}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={bulkApplying || !hasAnyBatchFieldSelected}
                    onClick={() => handleApplyBatchActions()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed transition-colors"
                  >
                    <UserCheck className="w-3.5 h-3.5 shrink-0" />
                    <span>{bulkApplying ? dictTickets.bulkApplying : dictTickets.bulkApplyAction}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {bulkNotice && (
          <div
            role="status"
            className={`flex items-center justify-between gap-2 px-3.5 sm:px-4 py-2 text-xs border-b ${
              bulkNotice.tone === 'warn'
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
            }`}
          >
            <span className="truncate">{bulkNotice.text}</span>
            <button
              type="button"
              onClick={() => setBulkNotice(null)}
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer shrink-0"
              aria-label={dictTickets.bulkClearSelection}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="divide-y divide-slate-200 dark:divide-slate-800 overflow-y-auto max-h-[680px]">
          {filteredTickets.length === 0 ? (
            <div className="p-8 text-center space-y-2.5">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {onlyFavoritesFilter ? dictTickets.emptyFavoritesTitle : dictTickets.emptyViewTitle}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {onlyFavoritesFilter
                  ? dictTickets.emptyFavoritesHint
                  : dictTickets.emptyViewHint}
              </p>
              {(onlyFavoritesFilter || selectedPriorities.length > 0 || supportLevelFilter !== 'all' || sentimentFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setOnlyFavoritesFilter(false);
                    setSelectedPriorities([]);
                    setSupportLevelFilter('all');
                    setSentimentFilter('all');
                    onExitFavoritesView?.();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <span>{dictTickets.seeAllTickets}</span>
                </button>
              )}
            </div>
          ) : (
            filteredTickets.map((ticket) => {
              const isSelected = activeTicket?.id === ticket.id;
              const isBulkSelected = selectedBulkSet.has(ticket.id);
              const isDone = ticket.status === 'resolved' || ticket.status === 'closed';
              const sla = formatSlaRemaining(ticket.firstResponseDueMs, isDone || ticket.firstResponded);
              const slaAlert = slaAlertMap.get(ticket.id);
              const viewers = presence.filter(
                (p) => p.activeTicketId === ticket.id && p.agentName !== currentUserName
              );
              const assignedAgent = agents.find((a) => a.id === ticket.assignedAgentId);
              const ticketSentiment = sentimentMap.get(ticket.id);
              const groupSaturation = !isDone
                ? saturationByGroup.get(ticket.assignedGroup as SupportGroup)
                : undefined;

              return (
                <div
                  key={ticket.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTicketId(ticket.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedTicketId(ticket.id);
                    }
                  }}
                  className={`w-full text-left p-3.5 sm:p-4 transition-colors cursor-pointer flex items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                    isSelected
                      ? 'bg-blue-50/75 dark:bg-blue-950/35 ring-1 ring-inset ring-blue-200 dark:ring-blue-800/70'
                      : isBulkSelected
                      ? 'bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50/65 dark:hover:bg-blue-950/30'
                      : 'hover:bg-slate-50/90 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div
                    className="pt-0.5 w-4 flex items-center justify-center shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isBulkSelected}
                      onMouseDown={(e) => {
                        shiftHeldRef.current = e.shiftKey;
                      }}
                      onKeyDown={(e) => {
                        shiftHeldRef.current = e.shiftKey;
                      }}
                      onChange={() => handleToggleBulkTicket(ticket.id, shiftHeldRef.current)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${dictTickets.bulkSelectRowAria} ${ticket.reference}`}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer accent-blue-600"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1.5">
                    <div className="flex items-center gap-1.5 font-mono tabular-nums min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite(ticket);
                        }}
                        aria-label={
                          ticket.isFavorite
                            ? `${dictTickets.removeFavoriteTooltip} (${ticket.reference})`
                            : `${dictTickets.addFavoriteTooltip} (${ticket.reference})`
                        }
                        aria-pressed={Boolean(ticket.isFavorite)}
                        title={ticket.isFavorite ? dictTickets.removeFavoriteTooltip : dictTickets.addFavoriteTooltip}
                        className={`p-1 -ml-1 rounded-md transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                          ticket.isFavorite
                            ? 'text-amber-500 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50'
                            : 'text-slate-400 dark:text-slate-500 hover:text-amber-500 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        <Star
                          className={`w-3.5 h-3.5 ${
                            ticket.isFavorite ? 'fill-amber-400 text-amber-500 dark:text-amber-400' : ''
                          }`}
                        />
                      </button>
                      <span className="font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                        {ticket.reference}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate max-w-[140px] font-sans font-medium text-slate-700 dark:text-slate-300">
                        {ticket.clientName}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {slaAlert?.isAlert && (
                        <span
                          title={slaAlert.summary}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-600/12 dark:bg-red-500/20 border border-red-300/80 dark:border-red-700/70 text-red-700 dark:text-red-300 font-mono text-[11px] font-semibold tabular-nums whitespace-nowrap shrink-0 sla-alert-pulse"
                        >
                          <BellRing className="w-3 h-3 shrink-0" />
                          <span>Alerte SLA {slaAlert.estimatedPct}%</span>
                        </span>
                      )}

                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[11px] tabular-nums whitespace-nowrap shrink-0 ${
                          sla.severity === 'breached'
                            ? 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-400 font-semibold'
                            : sla.severity === 'warning'
                            ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 font-semibold'
                            : sla.severity === 'done'
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        {sla.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mb-2 min-w-0">
                    {ticketSentiment && (
                      <span
                        title={`${ticketSentiment.label} (${ticketSentiment.tensionScore}/100) · ${ticketSentiment.reason}`}
                        aria-label={`${dictTickets.sentimentLabel}: ${ticketSentiment.label} (${ticketSentiment.tensionScore}/100)`}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap shrink-0 ${ticketSentiment.badgeClass}`}
                      >
                        <span
                          className={`w-2 h-2 rounded-xs shrink-0 ${ticketSentiment.dotClass}`}
                          aria-hidden="true"
                        />
                        <span aria-hidden="true" className="leading-none">
                          {ticketSentiment.emoji}
                        </span>
                        <span>{ticketSentiment.shortLabel}</span>
                      </span>
                    )}
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-1 min-w-0">
                      {ticket.subject}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          ticket.priority === 'critical'
                            ? 'text-red-700 dark:text-red-400'
                            : ticket.priority === 'high'
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {ticket.priority === 'critical' && <AlertTriangle className="w-3 h-3" />}
                        {TICKET_PRIORITY_LABELS[ticket.priority]}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{TICKET_STATUS_LABELS[ticket.status]}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1.5 truncate">
                        {assignedAgent?.avatarUrl && (
                          <img
                            src={assignedAgent.avatarUrl}
                            alt={assignedAgent.name}
                            referrerPolicy="no-referrer"
                            className="w-4 h-4 rounded-sm object-cover shrink-0 border border-slate-200 dark:border-slate-700"
                          />
                        )}
                        <span className="truncate">{ticket.assignedAgentName || ticket.assignedGroup}</span>
                      </span>
                      {groupSaturation?.level === 'saturated' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span
                            title={`${groupSaturation.group}: ${groupSaturation.currentVolume}/${groupSaturation.historicalCapacity} ${dictTickets.queueSaturationCapShort} (${groupSaturation.saturationPct}%)`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-400 whitespace-nowrap shrink-0 font-mono tabular-nums"
                          >
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            <span>
                              {dictTickets.queueSaturationRowTag} {groupSaturation.saturationPct}%
                            </span>
                          </span>
                        </>
                      )}
                    </div>

                    {viewers.length > 0 && (
                      <span className="text-[11px] text-blue-700 dark:text-blue-400 font-medium whitespace-nowrap shrink-0">
                        {viewers[0].agentName.split(' ')[0]} en ligne
                      </span>
                    )}
                  </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Right Detail Workbench */}
      <section className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col overflow-hidden">
        {!activeTicket ? (
          <div className="p-12 text-center my-auto space-y-2">
            <p className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {onlyFavoritesFilter ? 'Aucun ticket favori sélectionné' : 'Sélectionnez un ticket dans la file'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {onlyFavoritesFilter
                ? 'Épinglez un ticket avec l’icône étoile pour le retrouver instantanément dans cette vue.'
                : 'Toutes les propriétés SLA, le routage IA et la chronologie collaborative s’afficheront ici.'}
            </p>
          </div>
        ) : (
          <>
            {/* Real-time Collaboration Collision Banner */}
            {collaboratorsOnTicket.length > 0 && (
              <div className="px-5 py-2.5 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-900 flex items-center justify-between gap-3 text-xs text-blue-800 dark:text-blue-200">
                <span className="font-medium">
                  Collaboration en direct :{' '}
                  {collaboratorsOnTicket
                    .map((c) =>
                      c.typingTicketId === activeTicket.id
                        ? `${c.agentName} rédige une réponse`
                        : `${c.agentName} consulte ce ticket`
                    )
                    .join(' · ')}
                </span>
                <span className="font-mono text-[11px]">WebSocket actif</span>
              </div>
            )}

            {/* SLA >80% Threshold Alert Banner */}
            {activeTicketSlaAlert?.isAlert && (
              <div className="px-5 py-2.5 bg-red-50 dark:bg-red-950/50 border-b border-red-200 dark:border-red-900/70 flex flex-wrap items-center justify-between gap-2 text-xs text-red-800 dark:text-red-200">
                <div className="flex items-center gap-2 font-medium">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-red-100 dark:bg-red-900/60 border border-red-200 dark:border-red-800 sla-alert-pulse shrink-0">
                    <BellRing className="w-3.5 h-3.5 text-red-600 dark:text-red-300" />
                  </span>
                  <span>
                    Alerte SLA (&gt; 80%) : {activeTicketSlaAlert.summary}
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-red-100/80 dark:bg-red-900/50 border border-red-200/80 dark:border-red-800 font-mono tabular-nums font-semibold text-red-700 dark:text-red-300 sla-alert-pulse">
                  {activeTicketSlaAlert.estimatedPct}% du délai alloué
                </span>
              </div>
            )}

            {/* Ticket Header & SLA Controls */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
                      {activeTicket.reference}
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {activeTicket.clientName}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{TICKET_CHANNEL_LABELS[activeTicket.channel]}</span>
                    {activeTicket.isRecurringIncident && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                          <Link2 className="w-3.5 h-3.5" />
                          Incident récurrent {activeTicket.parentIncidentRef || ''}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 leading-snug">
                      {activeTicket.subject}
                    </h3>
                    {activeSentiment && (
                      <span
                        title={`${activeSentiment.label} (${activeSentiment.tensionScore}/100) · ${activeSentiment.reason}`}
                        aria-label={`${dictTickets.sentimentLabel}: ${activeSentiment.label} (${activeSentiment.tensionScore}/100)`}
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-medium whitespace-nowrap shrink-0 ${activeSentiment.badgeClass}`}
                      >
                        <span
                          className={`w-2 h-2 rounded-xs shrink-0 ${activeSentiment.dotClass}`}
                          aria-hidden="true"
                        />
                        <span aria-hidden="true" className="leading-none">
                          {activeSentiment.emoji}
                        </span>
                        <span>{activeSentiment.label}</span>
                        <span className="font-mono tabular-nums text-[11px] opacity-80">
                          {activeSentiment.tensionScore}/100
                        </span>
                      </span>
                    )}
                    {activeTicket.status !== 'closed' && (
                      <button
                        type="button"
                        onClick={() => handleAnalyzeSentimentAi(activeTicket)}
                        disabled={sentimentAnalyzing}
                        title={dictTickets.analyzeSentimentAi}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                      >
                        <RefreshCw
                          className={`w-3 h-3 text-blue-600 dark:text-blue-400 ${
                            sentimentAnalyzing ? 'animate-spin' : ''
                          }`}
                        />
                        <span>
                          {sentimentAnalyzing
                            ? dictTickets.analyzingSentiment
                            : dictTickets.analyzeSentimentAi}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite(activeTicket)}
                    aria-label={
                      activeTicket.isFavorite
                        ? `Retirer ${activeTicket.reference} des favoris`
                        : `Ajouter ${activeTicket.reference} aux favoris`
                    }
                    aria-pressed={Boolean(activeTicket.isFavorite)}
                    title={activeTicket.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-2 border text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      activeTicket.isFavorite
                        ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                        : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        activeTicket.isFavorite
                          ? 'fill-amber-400 text-amber-500 dark:text-amber-400'
                          : 'text-slate-400 dark:text-slate-400'
                      }`}
                    />
                    <span>{activeTicket.isFavorite ? 'Favori' : 'Épingler'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateConversationSummary}
                    disabled={summaryLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-700 disabled:opacity-60 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>{summaryLoading ? 'Résumé en cours...' : 'Résumé IA'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRunCopilot}
                    disabled={copilotLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{copilotLoading ? 'Copilote...' : 'Copilote IA'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAiRouteTicket(activeTicket)}
                    disabled={aiLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-60 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.06)]"
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    <span>{aiLoading ? 'Analyse IA...' : 'Routage IA'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRoundRobinAssign(activeTicket)}
                    title="Assigner automatiquement à l'agent le moins chargé du groupe"
                    className="inline-flex items-center gap-1.5 px-2.5 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Round-Robin</span>
                  </button>
                  {activeTicket.category === 'Mot de passe bloqué' && (
                    <button
                      type="button"
                      onClick={handleQuickPasswordUnlock}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(37,99,235,0.2)]"
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Débloquer accès</span>
                    </button>
                  )}
                  {(activeTicket.status === 'resolved' || activeTicket.status === 'closed') && (
                    <button
                      type="button"
                      onClick={() => setShowCsatBox((v) => !v)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Star className="w-3.5 h-3.5 text-amber-500" />
                      <span>Collecter CSAT</span>
                    </button>
                  )}
                </div>
              </div>

              {workbenchNotice && (
                <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-200">
                  {workbenchNotice}
                </div>
              )}

              {/* Lifecycle Quick Bar: Snooze, Split, Merge, Linked Refs */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 mr-1">
                    <Moon className="w-3.5 h-3.5" />
                    <span>Snooze :</span>
                  </span>
                  {[
                    [2, '+2h'],
                    [16, 'Demain'],
                    [48, '+48h'],
                  ].map(([hrs, lbl]) => (
                    <button
                      key={lbl}
                      type="button"
                      disabled={activeTicket.status === 'closed'}
                      onClick={() => handleSnoozeTicket(Number(hrs))}
                      className="px-2 py-1 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 rounded-md text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      {lbl}
                    </button>
                  ))}
                  {activeTicket.status === 'snoozed' && activeTicket.snoozedUntilMs && (
                    <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400 ml-1">
                      Réveil {new Date(activeTicket.snoozedUntilMs).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {activeTicket.splitFromRef && (
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mr-1">
                      Issu de {activeTicket.splitFromRef}
                    </span>
                  )}
                  {activeTicket.mergedIntoRef && (
                    <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400 mr-1">
                      Fusionné dans {activeTicket.mergedIntoRef}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleSplitTicket}
                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    <Scissors className="w-3 h-3" />
                    <span>Fractionner</span>
                  </button>
                  <button
                    type="button"
                    disabled={activeTicket.status === 'closed'}
                    onClick={() => setShowMergeModal(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 rounded-md text-[11px] font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    <GitMerge className="w-3 h-3" />
                    <span>Fusionner</span>
                  </button>
                </div>
              </div>

              {csatSavedNotice && (
                <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200">
                  {csatSavedNotice}
                </div>
              )}

              {showCsatBox && (
                <form
                  onSubmit={handleSaveTicketCsat}
                  className="p-3.5 rounded-lg bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/60 space-y-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                      Enquête de satisfaction post-résolution ({activeTicket.reference})
                    </span>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((score) => (
                        <button
                          key={score}
                          type="button"
                          onClick={() => setCsatScoreInput(score)}
                          className={`px-2 py-0.5 rounded-md text-xs font-mono font-semibold cursor-pointer ${
                            csatScoreInput === score
                              ? 'bg-amber-500 text-white'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {score}★
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={csatCommentInput}
                      onChange={(e) => setCsatCommentInput(e.target.value)}
                      placeholder="Commentaire du client..."
                      className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800 rounded-lg"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Valider CSAT
                    </button>
                  </div>
                </form>
              )}

              {/* Controls Grid (Status, Priority, Group, Agent) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Statut</span>
                  <select
                    value={activeTicket.status}
                    onChange={(e) =>
                      handleUpdateTicketField(
                        { status: e.target.value as TicketStatus },
                        `a passé le statut à ${TICKET_STATUS_LABELS[e.target.value as TicketStatus]}`
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map((st) => (
                      <option key={st} value={st}>
                        {TICKET_STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Priorité SLA</span>
                  <select
                    value={activeTicket.priority}
                    onChange={(e) =>
                      handleUpdateTicketField(
                        { priority: e.target.value as TicketPriority },
                        `a modifié la priorité (${e.target.value})`
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map((pr) => (
                      <option key={pr} value={pr}>
                        {TICKET_PRIORITY_LABELS[pr]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Groupe</span>
                  <select
                    value={activeTicket.assignedGroup}
                    onChange={(e) =>
                      handleUpdateTicketField(
                        { assignedGroup: e.target.value },
                        `a réaffecté au groupe ${e.target.value}`
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {GROUPS.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Agent assigné</span>
                  <select
                    value={activeTicket.assignedAgentId || ''}
                    onChange={(e) => {
                      const ag = agents.find((a) => a.id === e.target.value);
                      handleUpdateTicketField(
                        {
                          assignedAgentId: ag ? ag.id : '',
                          assignedAgentName: ag ? ag.name : 'Non assigné',
                        },
                        ag ? `a assigné le ticket à ${ag.name}` : 'a retiré l’assignation'
                      );
                    }}
                    className="w-full px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Non assigné</option>
                    {agents.map((ag) => (
                      <option key={ag.id} value={ag.id}>
                        {ag.name} ({ag.activeTickets}/{ag.maxConcurrentTickets})
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* Editable Tags Bar */}
              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <Tag className="w-3 h-3" />
                  <span>Tags :</span>
                </span>
                {activeTicket.tags.map((tg) => (
                  <span
                    key={tg}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-700 dark:text-slate-300"
                  >
                    <span>#{tg}</span>
                    {activeTicket.status !== 'closed' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tg)}
                        aria-label={`Retirer tag ${tg}`}
                        className="text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </span>
                ))}
                {activeTicket.status !== 'closed' && (
                  <form onSubmit={handleAddTag} className="inline-flex items-center gap-1">
                    <input
                      type="text"
                      value={newTagInput}
                      onChange={(e) => setNewTagInput(e.target.value)}
                      placeholder="+ tag"
                      maxLength={32}
                      className="w-24 px-2 py-0.5 text-[11px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md"
                    />
                  </form>
                )}
              </div>

              {/* SLA & AI Insights Summary */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
                <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-400">
                  <span>Catégorie : <strong className="text-slate-900 dark:text-slate-200">{activeTicket.category}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Résolution cible : {formatSlaRemaining(activeTicket.resolutionDueMs, activeTicket.status === 'resolved' || activeTicket.status === 'closed').label}
                  </span>
                  {activeSentiment && activeSentiment.matchedCues.length > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {dictTickets.tensionScoreLabel} :{' '}
                        <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-200">
                          {activeSentiment.tensionScore}/100
                        </strong>{' '}
                        ({activeSentiment.matchedCues.join(', ')})
                      </span>
                    </>
                  )}
                </div>
                {activeTicket.aiRouted && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-medium">
                    <Bot className="w-3.5 h-3.5" />
                    Routé par IA ({Math.round((activeTicket.aiConfidence ?? 0.9) * 100)}%) · {activeTicket.aiSentiment || 'Analysé'}
                  </span>
                )}
              </div>

              {/* Dedicated Gemini Conversation Summary Block */}
              {summaryOpen && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span className="font-display font-semibold text-slate-900 dark:text-slate-100">
                        Résumé IA de la conversation ({activeTicket.reference})
                      </span>
                      {ticketSummaries[activeTicket.id] && (
                        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          · {new Date(ticketSummaries[activeTicket.id].generatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {ticketSummaries[activeTicket.id] && !summaryLoading && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSaveSummaryAsInternalNote(ticketSummaries[activeTicket.id])}
                            className="px-2.5 py-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Enregistrer en note interne
                          </button>
                          <button
                            type="button"
                            onClick={handleGenerateConversationSummary}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Actualiser
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setSummaryOpen(false)}
                        aria-label="Fermer le résumé IA"
                        className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {summaryLoading ? (
                    <div className="space-y-2 py-1">
                      <div className="h-3 w-3/4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                      <div className="h-3 w-full bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                      <div className="h-3 w-2/3 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
                    </div>
                  ) : summaryError ? (
                    <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                      {summaryError}
                    </div>
                  ) : ticketSummaries[activeTicket.id] ? (
                    <div className="space-y-3">
                      <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                        {ticketSummaries[activeTicket.id].summary}
                      </p>

                      {ticketSummaries[activeTicket.id].keyPoints.length > 0 && (
                        <div className="space-y-1">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            Points clés extraits :
                          </p>
                          <ul className="list-disc pl-4 space-y-0.5 text-slate-700 dark:text-slate-300">
                            {ticketSummaries[activeTicket.id].keyPoints.map((pt, i) => (
                              <li key={i}>{pt}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                        <span>
                          <strong className="text-slate-900 dark:text-slate-100">Prochaine étape :</strong>{' '}
                          {ticketSummaries[activeTicket.id].recommendedNextStep}
                        </span>
                        <span>
                          Ton client :{' '}
                          <strong className="text-blue-700 dark:text-blue-400">
                            {ticketSummaries[activeTicket.id].clientSentiment}
                          </strong>
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Real-Time Agent AI Copilot Panel */}
              {copilotOpen && (
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-blue-200 dark:border-blue-900/70 space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-blue-800 dark:text-blue-300">
                      <Sparkles className="w-4 h-4" />
                      <span>Copilote IA en temps réel ({activeTicket.reference})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCopilotOpen(false)}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {copilotLoading ? (
                    <p className="text-slate-500 dark:text-slate-400">
                      Synthèse de la conversation et recherche d’articles pertinents...
                    </p>
                  ) : copilotInsight ? (
                    <div className="space-y-2.5">
                      <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">Résumé conversation</span>
                          <span className="font-mono text-[11px] text-blue-700 dark:text-blue-400">
                            Ton : {copilotInsight.toneDetected}
                          </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                          {copilotInsight.conversationSummary}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">Actions recommandées</p>
                          <ul className="list-disc pl-4 space-y-0.5 text-slate-600 dark:text-slate-300">
                            {copilotInsight.nextBestActions.map((act, idx) => (
                              <li key={idx}>{act}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1.5">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            Articles KB associés ({activeTicketKbSuggestions.length})
                          </p>
                          {activeTicketKbSuggestions.length === 0 ? (
                            <p className="text-slate-500 dark:text-slate-400">Aucun article correspondant.</p>
                          ) : (
                            activeTicketKbSuggestions.slice(0, 2).map((art) => (
                              <div key={art.id} className="flex items-center justify-between gap-2">
                                <span className="truncate text-slate-700 dark:text-slate-300">{art.title}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setComposerMode('public');
                                    setComposerText((prev) =>
                                      prev ? `${prev}\n\nGuide utile : ${art.title} — ${art.summary}` : `Bonjour,\n\nVous pouvez consulter notre guide « ${art.title} » : ${art.summary}`
                                    );
                                  }}
                                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0 cursor-pointer"
                                >
                                  Insérer
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1">
                        <p className="text-slate-500 dark:text-slate-400 truncate">
                          Réponse prête : {copilotInsight.suggestedReply}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setComposerMode('public');
                            setComposerText(copilotInsight.suggestedReply);
                          }}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Utiliser cette réponse
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {aiExplanation && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200">
                  <strong className="font-semibold">Analyse IA :</strong> {aiExplanation}
                </div>
              )}

              {aiError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  {aiError}
                </div>
              )}
            </div>

            {/* Chronological Zammad Timeline */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 max-h-[340px] bg-slate-50/60 dark:bg-slate-950/40">
              <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-1.5">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Demande initiale · {activeTicket.clientName}
                  </span>
                  <span>{TICKET_CHANNEL_LABELS[activeTicket.channel]}</span>
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {activeTicket.description}
                </p>
              </div>

              {events.map((evt) => {
                const isInternal = evt.visibility === 'internal';
                return (
                  <div
                    key={evt.id}
                    className={`p-4 rounded-lg border shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-1.5 ${
                      isInternal
                        ? 'bg-amber-50/75 dark:bg-amber-950/25 border-amber-200 dark:border-amber-900/60'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        {isInternal ? (
                          <Lock className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                        ) : evt.eventType === 'call_log' ? (
                          <Phone className="w-3.5 h-3.5 text-blue-600" />
                        ) : evt.eventType === 'password_unlock' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
                        )}
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {evt.authorName}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span
                          className={
                            isInternal
                              ? 'text-amber-800 dark:text-amber-300 font-medium'
                              : 'text-slate-500 dark:text-slate-400'
                          }
                        >
                          {isInternal ? 'Note interne équipe' : 'Message public'}
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                      {evt.body}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Reply / Internal Note Composer */}
            <form
              onSubmit={handleSendTimelineMessage}
              className="p-4 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setComposerMode('public')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      composerMode === 'public'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Réponse publique client
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerMode('internal')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      composerMode === 'internal'
                        ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-900 dark:text-amber-200 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Note interne (Temps réel)
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Canned Responses Picker */}
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const canned = cannedResponses.find((c) => c.id === e.target.value);
                      if (canned) {
                        setComposerMode('public');
                        setComposerText(canned.body);
                      }
                      e.target.value = '';
                    }}
                    className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
                  >
                    <option value="">Réponses types ({cannedResponses.length})...</option>
                    {cannedResponses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setShowNewCannedForm((v) => !v);
                      setShowNewMacroForm(false);
                    }}
                    className="px-2 py-1.5 text-[11px] font-medium border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    + Modèle
                  </button>

                  {/* Multi-Action Macros */}
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const macro = macros.find((m) => m.id === e.target.value);
                      if (macro) handleApplyMacro(macro);
                      e.target.value = '';
                    }}
                    className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-300"
                  >
                    <option value="">Macros 1-clic ({macros.length})...</option>
                    {macros.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setShowNewMacroForm((v) => !v);
                      setShowNewCannedForm(false);
                    }}
                    className="px-2 py-1.5 text-[11px] font-medium border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    + Macro
                  </button>

                  <button
                    type="button"
                    onClick={handleAiDraftReply}
                    disabled={aiDraftLoading || activeTicket.status === 'closed'}
                    title={`${dictTickets.generateAiReply} (Gemini · ${activeTicketKbSuggestions.length} KB)`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 disabled:opacity-50 text-blue-700 dark:text-blue-300 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {aiDraftLoading ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>
                      {aiDraftLoading
                        ? dictTickets.generatingAiReply
                        : dictTickets.generateAiReply}
                    </span>
                  </button>
                </div>
              </div>

              {showNewCannedForm && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Nouvelle réponse type</span>
                    <button type="button" onClick={() => setShowNewCannedForm(false)} className="cursor-pointer">
                      <X className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCannedTitle}
                      onChange={(e) => setNewCannedTitle(e.target.value)}
                      placeholder="Titre du modèle..."
                      className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md"
                    />
                    <button
                      type="button"
                      onClick={handleCreateCannedResponse}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-md cursor-pointer"
                    >
                      Enregistrer
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={newCannedBody}
                    onChange={(e) => setNewCannedBody(e.target.value)}
                    placeholder="Contenu de la réponse type..."
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md"
                  />
                </div>
              )}

              {showNewMacroForm && (
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Nouvelle macro multi-actions (Réponse + Statut + Tag)</span>
                    <button type="button" onClick={() => setShowNewMacroForm(false)} className="cursor-pointer">
                      <X className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={newMacroLabel}
                      onChange={(e) => setNewMacroLabel(e.target.value)}
                      placeholder="Nom de la macro..."
                      className="flex-1 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md"
                    />
                    <select
                      value={newMacroStatus}
                      onChange={(e) => setNewMacroStatus(e.target.value as TicketStatus)}
                      className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md"
                    >
                      {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map((st) => (
                        <option key={st} value={st}>
                          Statut → {TICKET_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleCreateMacro}
                      className="px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-md cursor-pointer"
                    >
                      Créer macro
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    value={newMacroReply}
                    onChange={(e) => setNewMacroReply(e.target.value)}
                    placeholder="Réponse envoyée automatiquement lors du clic..."
                    className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md"
                  />
                </div>
              )}

              {aiDraftMeta && aiDraftMeta.ticketId === activeTicket.id && composerText.trim() && (
                <div className="px-3 py-2 rounded-lg bg-blue-50/75 dark:bg-blue-950/35 border border-blue-200/80 dark:border-blue-900/70 flex flex-wrap items-start justify-between gap-2 text-xs">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-blue-800 dark:text-blue-200 font-semibold">
                      <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                      <span>{dictTickets.aiDraftReadyLabel}</span>
                      {aiDraftMeta.rationale && (
                        <>
                          <span aria-hidden="true" className="text-blue-400">·</span>
                          <span className="font-normal text-slate-700 dark:text-slate-300">
                            {aiDraftMeta.rationale}
                          </span>
                        </>
                      )}
                    </div>
                    {aiDraftMeta.usedKbTitles.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                        <BookOpen className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span className="font-medium text-slate-700 dark:text-slate-200">
                          {dictTickets.aiDraftSourcesLabel}
                        </span>
                        <span>{aiDraftMeta.usedKbTitles.join(' · ')}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleAiDraftReply}
                      disabled={aiDraftLoading}
                      className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:underline cursor-pointer disabled:opacity-50"
                    >
                      {dictTickets.aiDraftRegenerate}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setComposerText('');
                        setAiDraftMeta(null);
                      }}
                      className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                    >
                      {dictTickets.aiDraftClear}
                    </button>
                  </div>
                </div>
              )}

              <textarea
                rows={3}
                value={composerText}
                onChange={(e) => handleComposerChange(e.target.value)}
                placeholder={
                  composerMode === 'internal'
                    ? 'Écrire une note interne visible uniquement par les agents support...'
                    : 'Rédiger votre réponse client (déclenche la validation 1ère réponse SLA)...'
                }
                className="w-full p-3 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />

              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>Signé par {currentUserName}</span>
                </div>
                <button
                  type="submit"
                  disabled={submittingNote || !composerText.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(37,99,235,0.2)]"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {submittingNote
                      ? 'Envoi...'
                      : composerMode === 'internal'
                      ? 'Publier note interne'
                      : 'Envoyer au client'}
                  </span>
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      {/* Create Ticket Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                {dictTickets.newTicketTitle}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setDictationStopSignal((n) => n + 1);
                  setShowCreateModal(false);
                }}
                className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Client</span>
                  <select
                    value={newClientId}
                    onChange={(e) => setNewClientId(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.companyName} ({c.tier})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Canal</span>
                  <select
                    value={newChannel}
                    onChange={(e) => setNewChannel(e.target.value as TicketChannel)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {(Object.keys(TICKET_CHANNEL_LABELS) as TicketChannel[]).map((ch) => (
                      <option key={ch} value={ch}>
                        {TICKET_CHANNEL_LABELS[ch]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Sujet de la demande</span>
                <input
                  type="text"
                  required
                  maxLength={240}
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Ex: Mot de passe bloqué suite rotation MFA ou client hors zone..."
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </label>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="create-ticket-description"
                    className="text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Description détaillée
                  </label>
                </div>

                <VoiceDictationModule
                  defaultLocale={locale}
                  stopSignal={dictationStopSignal}
                  disabled={creatingTicket}
                  onTranscriptAppend={(spoken) =>
                    setNewDescription((prev) => {
                      const trimmed = prev.trimEnd();
                      if (!trimmed) return spoken.slice(0, 4000);
                      return `${trimmed} ${spoken}`.slice(0, 4000);
                    })
                  }
                />

                <textarea
                  id="create-ticket-description"
                  required
                  rows={4}
                  maxLength={4000}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Décrivez ou dictez la situation client, le message d’erreur ou le contexte de l’appel..."
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              {modalKbSuggestions.length > 0 && (
                <div className="p-3 rounded-lg bg-blue-50/70 dark:bg-blue-950/35 border border-blue-200 dark:border-blue-900 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-200">
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    <span>Articles Base de connaissances suggérés ({modalKbSuggestions.length})</span>
                  </div>
                  <div className="space-y-1.5">
                    {modalKbSuggestions.map((art) => (
                      <div
                        key={art.id}
                        className="p-2 rounded-md bg-white dark:bg-slate-900 border border-blue-100 dark:border-blue-900/60 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                            <BookOpen className="w-3 h-3 text-blue-600 shrink-0" />
                            <span className="truncate">{art.title}</span>
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {art.summary}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeflectNewTicket(art)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded-md shrink-0 cursor-pointer"
                        >
                          Déflecter
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newAutoRouteAi}
                  onChange={(e) => setNewAutoRouteAi(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>
                  Smart Routing IA ({smartPolicy.enabled ? 'actif par défaut' : 'en pause superviseur'}) — sentiment IA, priorité SLA et disponibilité des agents
                </span>
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setDictationStopSignal((n) => n + 1);
                    setShowCreateModal(false);
                  }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={creatingTicket}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{creatingTicket ? 'Routage & création...' : 'Créer le ticket'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Merge Ticket Modal */}
      {showMergeModal && activeTicket && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                Fusionner {activeTicket.reference} dans un ticket principal
              </h3>
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Le ticket <strong className="font-mono">{activeTicket.reference}</strong> sera clôturé et son contexte sera rattaché au ticket sélectionné.
            </p>
            <form onSubmit={handleConfirmMerge} className="space-y-3">
              <select
                required
                value={mergeTargetId}
                onChange={(e) => setMergeTargetId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              >
                <option value="">Sélectionner le ticket principal...</option>
                {tickets
                  .filter((t) => t.id !== activeTicket.id && t.status !== 'closed')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.reference} · {t.clientName} — {t.subject.slice(0, 48)}
                    </option>
                  ))}
              </select>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMergeModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  Confirmer la fusion
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
