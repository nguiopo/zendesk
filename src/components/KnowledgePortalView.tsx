import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  increment,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  FileText,
  Globe,
  HelpCircle,
  LifeBuoy,
  MessageSquarePlus,
  MessagesSquare,
  Plus,
  Search,
  Send,
  Sparkles,
  ThumbsUp,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AppLocale,
  ClientAccount,
  ForumTopic,
  ForumTopicStatus,
  KbArticle,
  KbArticleType,
  KbPdfDocument,
  SlaPolicy,
  SupportAgent,
  Ticket,
  TicketCategory,
  WorkspaceConfig,
} from '../types/helpdesk';
import { I18N, LOCALE_OPTIONS } from '../lib/i18n';
import { formatSlaRemaining, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from '../lib/formatters';
import { recordAuditLog, suggestKbArticles } from '../lib/kbSuggestions';
import { executeSmartTicketRouting, resolveSmartRoutingPolicy } from '../lib/smartRouting';
import { clampString, clampTags, sanitizeTicketCreatePayload } from '../lib/validation';
import { KbPdfLibraryPanel } from './KbPdfLibraryPanel';

interface KnowledgePortalViewProps {
  uid: string;
  currentUserName: string;
  locale: AppLocale;
  kbArticles: KbArticle[];
  pdfDocuments: KbPdfDocument[];
  forumTopics: ForumTopic[];
  tickets: Ticket[];
  clients: ClientAccount[];
  slaPolicies: SlaPolicy[];
  agents?: SupportAgent[];
  workspaceConfig?: WorkspaceConfig;
  externalSearchRequest?: { query?: string; articleId?: string; nonce: number } | null;
}

const ARTICLE_TYPE_LABELS: Record<KbArticleType, string> = {
  article: 'Article',
  faq: 'FAQ',
  guide: 'Guide pratique',
};

const PORTAL_CATEGORIES: TicketCategory[] = [
  'Mot de passe bloqué',
  'Hors zone / Connectivité',
  'Utilisation plateforme',
  'Assistance client',
  'Vérification situation',
  'Incident infrastructure',
];

export const KnowledgePortalView: React.FC<KnowledgePortalViewProps> = ({
  uid,
  currentUserName,
  locale,
  kbArticles,
  pdfDocuments,
  forumTopics,
  tickets,
  clients,
  slaPolicies,
  agents = [],
  workspaceConfig,
  externalSearchRequest,
}) => {
  const dict = I18N[locale].kb;
  const [subTab, setSubTab] = useState<'articles' | 'pdf_library' | 'portal' | 'forum'>('articles');

  // Knowledge Base state
  const [kbSearch, setKbSearch] = useState('');
  const [kbLangFilter, setKbLangFilter] = useState<'all' | AppLocale>('all');
  const [kbTypeFilter, setKbTypeFilter] = useState<'all' | KbArticleType>('all');
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [showArticleModal, setShowArticleModal] = useState(false);

  useEffect(() => {
    if (!externalSearchRequest) return;
    setSubTab('articles');
    setKbLangFilter('all');
    setKbTypeFilter('all');
    if (externalSearchRequest.articleId) {
      setKbSearch('');
      setSelectedArticleId(externalSearchRequest.articleId);
    } else if (externalSearchRequest.query !== undefined) {
      setKbSearch(externalSearchRequest.query);
    }
  }, [externalSearchRequest]);

  // Create KB Article form
  const [artTitle, setArtTitle] = useState('');
  const [artSummary, setArtSummary] = useState('');
  const [artBody, setArtBody] = useState('');
  const [artCategory, setArtCategory] = useState<string>('Mot de passe bloqué');
  const [artLang, setArtLang] = useState<AppLocale>(locale);
  const [artType, setArtType] = useState<KbArticleType>('guide');
  const [artTags, setArtTags] = useState('mfa, accès, support');
  const [savingArticle, setSavingArticle] = useState(false);

  // Self-Service Portal state
  const [portalClientId, setPortalClientId] = useState(clients[0]?.id || '');
  const [portalSubject, setPortalSubject] = useState('');
  const [portalDescription, setPortalDescription] = useState('');
  const [portalCategory, setPortalCategory] = useState<TicketCategory>('Utilisation plateforme');
  const [portalNotice, setPortalNotice] = useState<string | null>(null);
  const [submittingPortalTicket, setSubmittingPortalTicket] = useState(false);

  // Community Forum state
  const [forumSearch, setForumSearch] = useState('');
  const [forumStatusFilter, setForumStatusFilter] = useState<'all' | ForumTopicStatus>('all');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [topicTitle, setTopicTitle] = useState('');
  const [topicBody, setTopicBody] = useState('');
  const [topicCategory, setTopicCategory] = useState('Bonnes pratiques');
  const [topicLang, setTopicLang] = useState<AppLocale>(locale);
  const [savingTopic, setSavingTopic] = useState(false);

  const activePortalClientId = portalClientId || clients[0]?.id || '';
  const activePortalClient = clients.find((c) => c.id === activePortalClientId);

  const kbMetrics = useMemo(() => {
    const published = kbArticles.filter((a) => a.published).length;
    const views = kbArticles.reduce((s, a) => s + a.viewsCount, 0);
    const deflections = kbArticles.reduce((s, a) => s + a.deflectionsCount, 0);
    const languages = new Set(kbArticles.map((a) => a.language)).size;
    return { published, views, deflections, languages };
  }, [kbArticles]);

  const filteredArticles = useMemo(() => {
    const q = kbSearch.trim().toLowerCase();
    return kbArticles.filter((art) => {
      if (kbLangFilter !== 'all' && art.language !== kbLangFilter) return false;
      if (kbTypeFilter !== 'all' && art.articleType !== kbTypeFilter) return false;
      if (!q) return true;
      return (
        art.title.toLowerCase().includes(q) ||
        art.summary.toLowerCase().includes(q) ||
        art.category.toLowerCase().includes(q) ||
        art.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [kbArticles, kbLangFilter, kbSearch, kbTypeFilter]);

  const activeArticle = useMemo(() => {
    if (selectedArticleId) {
      const found = kbArticles.find((a) => a.id === selectedArticleId);
      if (found) return found;
    }
    return filteredArticles[0] ?? kbArticles[0] ?? null;
  }, [filteredArticles, kbArticles, selectedArticleId]);

  const portalSuggestions = useMemo(
    () => suggestKbArticles(`${portalSubject} ${portalDescription}`, kbArticles, locale),
    [kbArticles, locale, portalDescription, portalSubject]
  );

  const portalClientTickets = useMemo(() => {
    if (!activePortalClientId) return [];
    return tickets.filter((t) => t.clientId === activePortalClientId);
  }, [activePortalClientId, tickets]);

  const filteredTopics = useMemo(() => {
    const q = forumSearch.trim().toLowerCase();
    return forumTopics.filter((tp) => {
      if (forumStatusFilter !== 'all' && tp.status !== forumStatusFilter) return false;
      if (!q) return true;
      return (
        tp.title.toLowerCase().includes(q) ||
        tp.body.toLowerCase().includes(q) ||
        tp.category.toLowerCase().includes(q) ||
        tp.authorCompany.toLowerCase().includes(q)
      );
    });
  }, [forumSearch, forumStatusFilter, forumTopics]);

  const handleSelectArticle = async (article: KbArticle) => {
    setSelectedArticleId(article.id);
    try {
      await updateDoc(doc(db, 'kbArticles', article.id), {
        viewsCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Non-blocking view increment
    }
  };

  const handleMarkHelpful = async (article: KbArticle) => {
    try {
      await updateDoc(doc(db, 'kbArticles', article.id), {
        helpfulCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `kbArticles/${article.id}`);
    }
  };

  const handleTogglePublished = async (article: KbArticle) => {
    try {
      await updateDoc(doc(db, 'kbArticles', article.id), {
        published: !article.published,
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'supervisor',
        action: !article.published ? 'Article KB publié' : 'Article KB mis en brouillon',
        category: 'kb',
        targetLabel: article.title,
        details: `Langue ${article.language.toUpperCase()} · ${article.articleType}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `kbArticles/${article.id}`);
    }
  };

  const handleCreateArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!artTitle.trim() || !artBody.trim()) return;
    setSavingArticle(true);
    try {
      const tagsList = clampTags(
        artTags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      );
      const created = await addDoc(collection(db, 'kbArticles'), {
        title: clampString(artTitle, 200),
        summary: clampString(artSummary || artBody.slice(0, 180), 500),
        body: clampString(artBody, 6000),
        category: clampString(artCategory, 100, 'Utilisation plateforme'),
        language: artLang,
        articleType: artType,
        tags: tagsList.length > 0 ? tagsList : ['guide'],
        published: true,
        viewsCount: 1,
        deflectionsCount: 0,
        helpfulCount: 0,
        authorName: clampString(currentUserName, 120, 'Support Lead'),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: 'Création article base de connaissances',
        category: 'kb',
        targetLabel: clampString(artTitle, 180),
        details: `Type ${artType} · Langue ${artLang.toUpperCase()}`,
      });
      setSelectedArticleId(created.id);
      setShowArticleModal(false);
      setArtTitle('');
      setArtSummary('');
      setArtBody('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'kbArticles');
    } finally {
      setSavingArticle(false);
    }
  };

  const handleDeflectFromPortal = async (article: KbArticle) => {
    try {
      await updateDoc(doc(db, 'kbArticles', article.id), {
        deflectionsCount: increment(1),
        helpfulCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      setPortalNotice(
        `Demande résolue en libre-service grâce à « ${article.title} ». Aucun ticket n’a été ouvert (+1 déflection enregistrée).`
      );
      setPortalSubject('');
      setPortalDescription('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `kbArticles/${article.id}`);
    }
  };

  const handleCreatePortalTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePortalClient || !portalSubject.trim() || !portalDescription.trim()) return;
    setSubmittingPortalTicket(true);
    setPortalNotice(null);
    try {
      const smartPolicy = resolveSmartRoutingPolicy(workspaceConfig);
      let finalCategory: TicketCategory = portalCategory;
      let finalPriority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
      let assignedGroup = 'N2 Plateforme';
      let assignedAgentId: string | undefined;
      let assignedAgentName: string | undefined;
      let aiRouted = false;
      let aiConfidence: number | undefined;
      let aiSentiment: string | undefined;
      let aiSummary: string | undefined;
      let isRecurringIncident = false;
      let parentIncidentRef: string | undefined;
      let routingNote: string | null = null;

      if (smartPolicy.enabled && agents.length > 0) {
        const outcome = await executeSmartTicketRouting({
          subject: portalSubject,
          description: portalDescription,
          channel: 'portal',
          clientName: activePortalClient.companyName,
          agents,
          policy: smartPolicy,
          locale,
          fallbackCategory: portalCategory,
          fallbackPriority: 'medium',
        });
        finalCategory = outcome.category;
        finalPriority = outcome.priority;
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

      const now = Date.now();
      const matchedPolicy =
        slaPolicies.find((p) => p.priorityScope === finalPriority) || slaPolicies[0];
      const firstRespMin = matchedPolicy?.firstResponseMinutes ?? 60;
      const resMin = matchedPolicy?.resolutionMinutes ?? 480;
      const reference = `ZD-${Math.floor(2100 + Math.random() * 7800)}`;

      const payload = sanitizeTicketCreatePayload({
        reference,
        subject: portalSubject,
        description: portalDescription,
        channel: 'portal',
        status: finalPriority === 'critical' ? 'escalated' : 'new',
        priority: finalPriority,
        category: finalCategory,
        clientId: activePortalClient.id,
        clientName: activePortalClient.companyName,
        assignedAgentId,
        assignedAgentName,
        assignedGroup,
        slaPolicyId: matchedPolicy?.id,
        firstResponseDueMs: now + firstRespMin * 60 * 1000,
        resolutionDueMs: now + resMin * 60 * 1000,
        firstResponded: false,
        aiRouted,
        aiConfidence,
        aiSentiment,
        aiSummary,
        isRecurringIncident,
        parentIncidentRef,
        tags: aiRouted ? ['portail-client', 'smart-routing'] : ['portail-client', 'self-service'],
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
        authorName: activePortalClient.contactName,
        authorRole: 'client',
        visibility: 'public',
        eventType: 'reply',
        body: clampString(portalDescription, 4000),
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

      setPortalNotice(
        aiRouted && assignedAgentName
          ? `Ticket ${reference} créé et routé vers ${assignedAgentName} (${assignedGroup}) via Smart Routing.`
          : `Ticket ${reference} créé via le portail libre-service pour ${activePortalClient.companyName}. Suivi SLA actif.`
      );
      setPortalSubject('');
      setPortalDescription('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tickets');
    } finally {
      setSubmittingPortalTicket(false);
    }
  };

  const handleUpvoteTopic = async (topic: ForumTopic) => {
    try {
      await updateDoc(doc(db, 'forumTopics', topic.id), {
        upvotes: increment(1),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `forumTopics/${topic.id}`);
    }
  };

  const handleMarkTopicAnswered = async (topic: ForumTopic) => {
    try {
      await updateDoc(doc(db, 'forumTopics', topic.id), {
        status: topic.status === 'answered' ? 'open' : 'answered',
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `forumTopics/${topic.id}`);
    }
  };

  const handleSendTopicReply = async (topic: ForumTopic) => {
    const draft = (replyDrafts[topic.id] || '').trim();
    if (!draft) return;
    try {
      await updateDoc(doc(db, 'forumTopics', topic.id), {
        repliesCount: increment(1),
        lastReplyNote: clampString(`${currentUserName} : ${draft}`, 600),
        status: 'answered',
        updatedAt: serverTimestamp(),
      });
      setReplyDrafts((prev) => ({ ...prev, [topic.id]: '' }));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `forumTopics/${topic.id}`);
    }
  };

  const handleCreateTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topicTitle.trim() || !topicBody.trim()) return;
    setSavingTopic(true);
    try {
      await addDoc(collection(db, 'forumTopics'), {
        title: clampString(topicTitle, 200),
        body: clampString(topicBody, 3000),
        category: clampString(topicCategory, 100, 'Entraide'),
        language: topicLang,
        authorName: clampString(currentUserName, 120),
        authorCompany: clampString(activePortalClient?.companyName || 'Communauté ZentraDesk', 150),
        status: 'open',
        upvotes: 1,
        repliesCount: 0,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setShowTopicModal(false);
      setTopicTitle('');
      setTopicBody('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'forumTopics');
    } finally {
      setSavingTopic(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {dict.title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{dict.subtitle}</p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
          {(
            [
              ['articles', dict.tabArticles, BookOpen],
              ['pdf_library', dict.tabPdfLibrary, FileText],
              ['portal', dict.tabPortal, LifeBuoy],
              ['forum', dict.tabForum, MessagesSquare],
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
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Articles &amp; FAQ publiés</span>
            <BookOpen className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kbMetrics.published} / {kbArticles.length}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Lectures portail</span>
            <Search className="w-4 h-4 text-slate-500" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kbMetrics.views.toLocaleString('fr-FR')}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Tickets évités (Déflections)</span>
            <Sparkles className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
            {kbMetrics.deflections}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Couverture multilingue</span>
            <Globe className="w-4 h-4 text-blue-600" />
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {kbMetrics.languages} langues
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">FR · EN · ES actifs</p>
        </div>
      </div>

      {/* TAB 1: KNOWLEDGE BASE */}
      {subTab === 'articles' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Left Article Directory */}
          <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Catalogue ({filteredArticles.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowArticleModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{dict.newArticle}</span>
                </button>
              </div>

              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={kbSearch}
                  onChange={(e) => setKbSearch(e.target.value)}
                  placeholder={dict.searchPlaceholder}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={kbLangFilter}
                  onChange={(e) => setKbLangFilter(e.target.value as 'all' | AppLocale)}
                  className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  <option value="all">Toutes langues</option>
                  {LOCALE_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label} ({opt.short})
                    </option>
                  ))}
                </select>
                <select
                  value={kbTypeFilter}
                  onChange={(e) => setKbTypeFilter(e.target.value as 'all' | KbArticleType)}
                  className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  <option value="all">Tous formats</option>
                  <option value="article">Articles</option>
                  <option value="faq">FAQs</option>
                  <option value="guide">Guides pratiques</option>
                </select>
              </div>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 overflow-y-auto max-h-[540px]">
              {filteredArticles.map((art) => {
                const isSelected = activeArticle?.id === art.id;
                return (
                  <button
                    key={art.id}
                    type="button"
                    onClick={() => handleSelectArticle(art)}
                    className={`w-full text-left p-4 transition-colors cursor-pointer block ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-950/35 ring-1 ring-inset ring-blue-200 dark:ring-blue-800'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono font-semibold text-slate-700 dark:text-slate-300 uppercase">
                          {art.language}
                        </span>
                        <span className="font-medium text-blue-700 dark:text-blue-400">
                          {ARTICLE_TYPE_LABELS[art.articleType]}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="text-slate-500 dark:text-slate-400 truncate max-w-[120px]">
                          {art.category}
                        </span>
                      </div>
                      <span
                        className={`font-mono text-[11px] ${
                          art.published
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {art.published ? 'Publié' : 'Brouillon'}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-1">
                      {art.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                      {art.summary}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Article Reader */}
          <div className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            {!activeArticle ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sélectionnez un article dans la liste ou créez-en un nouveau.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold uppercase font-mono">
                        {activeArticle.language}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                        {ARTICLE_TYPE_LABELS[activeArticle.articleType]}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {activeArticle.category}
                      </span>
                    </div>
                    <h3 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
                      {activeArticle.title}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Rédigé par {activeArticle.authorName} ·{' '}
                      <span className="font-mono tabular-nums">{activeArticle.viewsCount}</span> lectures ·{' '}
                      <span className="font-mono tabular-nums">{activeArticle.deflectionsCount}</span> déflections
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleMarkHelpful(activeArticle)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      <ThumbsUp className="w-3.5 h-3.5 text-blue-600" />
                      <span>Utile ({activeArticle.helpfulCount})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTogglePublished(activeArticle)}
                      className="px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      {activeArticle.published ? 'Passer en brouillon' : 'Publier'}
                    </button>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                  <strong>Résumé :</strong> {activeArticle.summary}
                </div>

                <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {activeArticle.body}
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Mots-clés :</span>
                  {activeArticle.tags.map((tg) => (
                    <span
                      key={tg}
                      className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-slate-700 dark:text-slate-300"
                    >
                      #{tg}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* TAB 1B: PDF LIBRARY & READER FOR KB IMPROVEMENT */}
      {subTab === 'pdf_library' && (
        <KbPdfLibraryPanel
          uid={uid}
          currentUserName={currentUserName}
          locale={locale}
          pdfDocuments={pdfDocuments}
          kbArticles={kbArticles}
          onOpenKbArticle={(articleId) => {
            setSelectedArticleId(articleId);
            setSubTab('articles');
          }}
        />
      )}

      {/* TAB 2: SELF-SERVICE PORTAL */}
      {subTab === 'portal' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Left: Portal Ticket Creation + Live KB Article Suggestions */}
          <div className="xl:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  {dict.portalHeading}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{dict.portalSubtitle}</p>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Compte client :</span>
                <select
                  value={activePortalClientId}
                  onChange={(e) => setPortalClientId(e.target.value)}
                  className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-medium"
                >
                  {clients.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.companyName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {portalNotice && (
              <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{portalNotice}</span>
              </div>
            )}

            <form onSubmit={handleCreatePortalTicket} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Sujet de votre demande
                  </span>
                  <input
                    type="text"
                    required
                    value={portalSubject}
                    onChange={(e) => setPortalSubject(e.target.value)}
                    placeholder="Ex: Mot de passe bloqué MFA ou hors zone réseau..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Catégorie
                  </span>
                  <select
                    value={portalCategory}
                    onChange={(e) => setPortalCategory(e.target.value as TicketCategory)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    {PORTAL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Détails du problème
                </span>
                <textarea
                  rows={4}
                  required
                  value={portalDescription}
                  onChange={(e) => setPortalDescription(e.target.value)}
                  placeholder="Tapez quelques mots (ex: webhook, mfa, password, hors zone) pour obtenir des suggestions d’articles en direct..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              {/* Real-time KB Suggestions Box */}
              {portalSuggestions.length > 0 && (
                <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/35 border border-blue-200 dark:border-blue-900 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-800 dark:text-blue-200">
                    <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>{dict.suggestedArticles}</span>
                  </div>
                  <div className="space-y-2.5">
                    {portalSuggestions.map((sug) => (
                      <div
                        key={sug.id}
                        className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-blue-100 dark:border-blue-900/60 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                              {sug.title}
                            </p>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                              {sug.summary}
                            </p>
                          </div>
                          <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[10px] uppercase shrink-0">
                            {sug.language}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedArticleId(sug.id);
                              setSubTab('articles');
                            }}
                            className="text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline cursor-pointer"
                          >
                            Lire le guide complet
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeflectFromPortal(sug)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold rounded-md cursor-pointer"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{dict.deflectButton}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submittingPortalTicket}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {submittingPortalTicket ? 'Envoi en cours...' : 'Soumettre la demande au support'}
                  </span>
                </button>
              </div>
            </form>
          </div>

          {/* Right: Customer Self-Service Ticket Tracker */}
          <div className="xl:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Mes demandes en cours — {activePortalClient?.companyName || 'Client'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Suivi autonome sans contacter l’équipe support.
                </p>
              </div>
              <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300">
                {portalClientTickets.length} ticket(s)
              </span>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 overflow-y-auto max-h-[500px]">
              {portalClientTickets.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  Aucune demande ouverte pour ce client.
                </div>
              ) : (
                portalClientTickets.map((tk) => {
                  const isDone = tk.status === 'resolved' || tk.status === 'closed';
                  const sla = formatSlaRemaining(tk.resolutionDueMs, isDone);
                  return (
                    <div key={tk.id} className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono font-semibold text-blue-700 dark:text-blue-400">
                          {tk.reference}
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                          <Clock className="w-3 h-3" />
                          {sla.label}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        {tk.subject}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>
                          {TICKET_STATUS_LABELS[tk.status]} · {TICKET_PRIORITY_LABELS[tk.priority]}
                        </span>
                        <span>{tk.assignedGroup}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: COMMUNITY FORUMS */}
      {subTab === 'forum' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={forumSearch}
                  onChange={(e) => setForumSearch(e.target.value)}
                  placeholder="Rechercher une discussion communautaire..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
              <select
                value={forumStatusFilter}
                onChange={(e) => setForumStatusFilter(e.target.value as 'all' | ForumTopicStatus)}
                className="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              >
                <option value="all">Tous les sujets</option>
                <option value="pinned">Épinglés</option>
                <option value="answered">Réponse validée</option>
                <option value="open">Ouverts</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => setShowTopicModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
            >
              <MessageSquarePlus className="w-3.5 h-3.5" />
              <span>{dict.newTopic}</span>
            </button>
          </div>

          <div className="space-y-3">
            {filteredTopics.map((tp) => (
              <div
                key={tp.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono uppercase text-slate-700 dark:text-slate-300">
                        {tp.language}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-md font-medium ${
                          tp.status === 'answered'
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                            : tp.status === 'pinned'
                            ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                            : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {tp.status === 'answered'
                          ? 'Réponse validée'
                          : tp.status === 'pinned'
                          ? 'Épinglé'
                          : 'Discussion ouverte'}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        {tp.category} · {tp.authorName} ({tp.authorCompany})
                      </span>
                    </div>
                    <h4 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      {tp.title}
                    </h4>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleUpvoteTopic(tp)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-mono font-semibold rounded-lg cursor-pointer"
                    >
                      <ThumbsUp className="w-3.5 h-3.5 text-blue-600" />
                      <span>{tp.upvotes}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMarkTopicAnswered(tp)}
                      className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      {tp.status === 'answered' ? 'Rouvrir' : 'Valider réponse'}
                    </button>
                  </div>
                </div>

                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{tp.body}</p>

                {tp.lastReplyNote && (
                  <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                    <strong className="text-slate-900 dark:text-slate-100">Dernière réponse ({tp.repliesCount}) :</strong>{' '}
                    {tp.lastReplyNote}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={replyDrafts[tp.id] || ''}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [tp.id]: e.target.value }))}
                    placeholder="Partager une solution avec la communauté..."
                    className="flex-1 px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => handleSendTopicReply(tp)}
                    disabled={!(replyDrafts[tp.id] || '').trim()}
                    className="px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-50 text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    Répondre
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create Article Modal */}
      {showArticleModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Publier un article ou une FAQ multilingue
              </h3>
              <button type="button" onClick={() => setShowArticleModal(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleCreateArticle} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Titre</span>
                <input
                  type="text"
                  required
                  value={artTitle}
                  onChange={(e) => setArtTitle(e.target.value)}
                  placeholder="Ex: Procédure de réinitialisation MFA"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <div className="grid grid-cols-3 gap-2.5">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Langue</span>
                  <select
                    value={artLang}
                    onChange={(e) => setArtLang(e.target.value as AppLocale)}
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    {LOCALE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Format</span>
                  <select
                    value={artType}
                    onChange={(e) => setArtType(e.target.value as KbArticleType)}
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    <option value="guide">Guide pratique</option>
                    <option value="faq">FAQ</option>
                    <option value="article">Article</option>
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Catégorie</span>
                  <input
                    type="text"
                    value={artCategory}
                    onChange={(e) => setArtCategory(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Résumé court</span>
                <input
                  type="text"
                  value={artSummary}
                  onChange={(e) => setArtSummary(e.target.value)}
                  placeholder="Résumé affiché dans les suggestions automatiques..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Contenu détaillé</span>
                <textarea
                  rows={5}
                  required
                  value={artBody}
                  onChange={(e) => setArtBody(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Mots-clés (séparés par virgule)
                </span>
                <input
                  type="text"
                  value={artTags}
                  onChange={(e) => setArtTags(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowArticleModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingArticle}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingArticle ? 'Publication...' : 'Publier dans la KB'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Forum Topic Modal */}
      {showTopicModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Ouvrir un sujet communautaire
              </h3>
              <button type="button" onClick={() => setShowTopicModal(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleCreateTopic} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Titre du sujet</span>
                <input
                  type="text"
                  required
                  value={topicTitle}
                  onChange={(e) => setTopicTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Catégorie</span>
                  <input
                    type="text"
                    value={topicCategory}
                    onChange={(e) => setTopicCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Langue</span>
                  <select
                    value={topicLang}
                    onChange={(e) => setTopicLang(e.target.value as AppLocale)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    {LOCALE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Message</span>
                <textarea
                  rows={4}
                  required
                  value={topicBody}
                  onChange={(e) => setTopicBody(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTopicModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingTopic}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingTopic ? 'Publication...' : 'Publier le sujet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
