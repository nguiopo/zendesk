import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  BellRing,
  BookOpen,
  CalendarClock,
  Cpu,
  Globe,
  Inbox,
  Keyboard,
  LogOut,
  Maximize2,
  Menu,
  MessageSquare,
  Minimize2,
  Moon,
  PlugZap,
  Plus,
  ShieldCheck,
  Star,
  Sun,
  Type,
  UserCog,
  X,
} from 'lucide-react';
import { auth, db, handleFirestoreError, OperationType, testConnection } from './firebase';
import { ensureUserWorkspaceSeeded } from './data/seedData';
import { useCollaborationSocket } from './hooks/useCollaborationSocket';
import { I18N, isValidLocale, loadSavedLocale, saveLocale, UI_LOCALE_OPTIONS } from './lib/i18n';
import {
  getSystemPrefersDark,
  getThemeDiagnostics,
  isValidThemeMode,
  loadSavedThemeMode,
  resolveEffectiveDarkMode,
  saveThemeMode,
  THEME_MODE_OPTIONS,
} from './lib/theme';
import {
  applyTypographySettings,
  loadTypographySettings,
  saveTypographySettings,
  TYPOGRAPHY_FONTS,
  TypographySettings,
} from './lib/typography';
import {
  AgentLeave,
  AppLocale,
  AuditLogEntry,
  AutomationRule,
  CallLog,
  ChartAnnotation,
  ClientAccount,
  CsatSurvey,
  ExternalIntegration,
  ForumTopic,
  KbArticle,
  KbPdfDocument,
  OnCallReportEntry,
  OnCallShift,
  QaEvaluation,
  SlaPolicy,
  SupportAgent,
  ThemePreferenceMode,
  Ticket,
  UserProfileDoc,
  WeeklyReportRecord,
  WfmShift,
  WorkspaceConfig,
} from './types/helpdesk';
import {
  computeWeeklyPerformanceSummary,
  formatMinutesCompact,
  getRecentIsoWeeks,
  IsoWeekOption,
} from './lib/pdfExport';
import { clampString } from './lib/validation';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthScreen } from './components/AuthScreen';
import { TicketsView } from './components/TicketsView';
import { ProactiveClientsView } from './components/ProactiveClientsView';
import { CapacityAnalyticsView } from './components/CapacityAnalyticsView';
import { OnCallScheduleView } from './components/OnCallScheduleView';
import { AiAutomationView } from './components/AiAutomationView';
import { CollaborationCallView } from './components/CollaborationCallView';
import { KnowledgePortalView } from './components/KnowledgePortalView';
import { IntegrationsAdminView } from './components/IntegrationsAdminView';
import { TypographyModal } from './components/TypographyModal';
import { AgentProfileModal } from './components/AgentProfileModal';
import { FloatingChatWidget } from './components/FloatingChatWidget';
import { GlobalHeaderSearch } from './components/GlobalHeaderSearch';

type NavTab =
  | 'tickets'
  | 'favorites'
  | 'clients'
  | 'collaboration'
  | 'analytics'
  | 'oncall'
  | 'automation'
  | 'knowledge'
  | 'integrations';

interface HighPriorityTicketToast {
  id: string;
  ticketId: string;
  reference: string;
  subject: string;
  clientName: string;
  priority: 'high' | 'critical';
  assignedGroup: string;
  createdAtLabel: string;
}

function buildNavGroups(locale: AppLocale): {
  heading: string;
  items: { id: NavTab; label: string; icon: React.FC<{ className?: string }> }[];
}[] {
  const dict = I18N[locale];
  return [
    {
      heading: dict.navGroups.operations,
      items: [
        { id: 'tickets', label: dict.navItems.tickets, icon: Inbox },
        { id: 'favorites', label: dict.navItems.favorites, icon: Star },
        { id: 'clients', label: dict.navItems.clients, icon: ShieldCheck },
        { id: 'collaboration', label: dict.navItems.collaboration, icon: MessageSquare },
      ],
    },
    {
      heading: dict.navGroups.analytics,
      items: [
        { id: 'analytics', label: dict.navItems.analytics, icon: BarChart3 },
        { id: 'oncall', label: dict.navItems.oncall, icon: CalendarClock },
        { id: 'automation', label: dict.navItems.automation, icon: Cpu },
      ],
    },
    {
      heading: dict.navGroups.ecosystem,
      items: [
        { id: 'knowledge', label: dict.navItems.knowledge, icon: BookOpen },
        { id: 'integrations', label: dict.navItems.integrations, icon: PlugZap },
      ],
    },
  ];
}

function HelpdeskShell() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [activeTab, setActiveTab] = useState<NavTab>('tickets');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemePreferenceMode>(() => loadSavedThemeMode());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => getSystemPrefersDark());
  const [themeClock, setThemeClock] = useState<Date>(() => new Date());
  const [userProfile, setUserProfile] = useState<UserProfileDoc | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [locale, setLocale] = useState<AppLocale>(() => loadSavedLocale());
  const [typography, setTypography] = useState<TypographySettings>(() => loadTypographySettings());
  const [typographyModalOpen, setTypographyModalOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [floatingChatOpen, setFloatingChatOpen] = useState(false);
  const [isFullscreenWorkspace, setIsFullscreenWorkspace] = useState(false);
  const [createTicketSignal, setCreateTicketSignal] = useState(0);
  const [ticketSearchRequest, setTicketSearchRequest] = useState<{
    query?: string;
    ticketId?: string;
    nonce: number;
  } | null>(null);
  const [clientSearchRequest, setClientSearchRequest] = useState<{
    query: string;
    nonce: number;
  } | null>(null);
  const [kbSearchRequest, setKbSearchRequest] = useState<{
    query?: string;
    articleId?: string;
    nonce: number;
  } | null>(null);

  // Firestore synced collections
  const [agents, setAgents] = useState<SupportAgent[]>([]);
  const [clients, setClients] = useState<ClientAccount[]>([]);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicy[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [shifts, setShifts] = useState<OnCallShift[]>([]);
  const [leaves, setLeaves] = useState<AgentLeave[]>([]);
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [kbArticles, setKbArticles] = useState<KbArticle[]>([]);
  const [forumTopics, setForumTopics] = useState<ForumTopic[]>([]);
  const [csatSurveys, setCsatSurveys] = useState<CsatSurvey[]>([]);
  const [qaEvaluations, setQaEvaluations] = useState<QaEvaluation[]>([]);
  const [wfmShifts, setWfmShifts] = useState<WfmShift[]>([]);
  const [integrations, setIntegrations] = useState<ExternalIntegration[]>([]);
  const [workspaceConfigs, setWorkspaceConfigs] = useState<WorkspaceConfig[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [chartAnnotations, setChartAnnotations] = useState<ChartAnnotation[]>([]);
  const [onCallReports, setOnCallReports] = useState<OnCallReportEntry[]>([]);
  const [kbPdfDocuments, setKbPdfDocuments] = useState<KbPdfDocument[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReportRecord[]>([]);
  const [weeklyReportsLoaded, setWeeklyReportsLoaded] = useState(false);
  const [weeklyAutoEnabled, setWeeklyAutoEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('zentradesk_weekly_auto_v1') !== 'false';
    } catch {
      return true;
    }
  });
  const [highPriorityToasts, setHighPriorityToasts] = useState<HighPriorityTicketToast[]>([]);

  const seedingRef = useRef(false);
  const ticketsInitializedRef = useRef(false);
  const seenTicketIdsRef = useRef<Set<string>>(new Set());
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const weeklyAutoAttemptedRef = useRef<string | null>(null);

  const dismissHighPriorityToast = useCallback((toastId: string) => {
    const timer = toastTimersRef.current.get(toastId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(toastId);
    }
    setHighPriorityToasts((prev) => prev.filter((item) => item.id !== toastId));
  }, []);

  const pushHighPriorityToast = useCallback(
    (ticket: Ticket) => {
      if (ticket.priority !== 'high' && ticket.priority !== 'critical') return;
      const toastId = `toast_${ticket.id}_${Date.now()}`;
      const timeLabel = new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });

      const nextToast: HighPriorityTicketToast = {
        id: toastId,
        ticketId: ticket.id,
        reference: ticket.reference,
        subject: ticket.subject,
        clientName: ticket.clientName,
        priority: ticket.priority,
        assignedGroup: ticket.assignedGroup,
        createdAtLabel: timeLabel,
      };

      setHighPriorityToasts((prev) => [nextToast, ...prev].slice(0, 4));
      const timeoutId = window.setTimeout(() => {
        toastTimersRef.current.delete(toastId);
        setHighPriorityToasts((prev) => prev.filter((item) => item.id !== toastId));
      }, 9500);
      toastTimersRef.current.set(toastId, timeoutId);
    },
    []
  );

  const darkMode = resolveEffectiveDarkMode(themeMode, systemPrefersDark, themeClock);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    saveThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemPrefersDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  useEffect(() => {
    if (themeMode !== 'schedule' && !profileModalOpen) return;
    setThemeClock(new Date());
    const interval = window.setInterval(() => setThemeClock(new Date()), 30000);
    const syncNow = () => setThemeClock(new Date());
    window.addEventListener('focus', syncNow);
    document.addEventListener('visibilitychange', syncNow);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', syncNow);
      document.removeEventListener('visibilitychange', syncNow);
    };
  }, [themeMode, profileModalOpen]);

  useEffect(() => {
    saveLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    applyTypographySettings(typography);
    saveTypographySettings(typography);
  }, [typography]);

  useEffect(() => {
    return () => {
      toastTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      toastTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    testConnection();
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (firebaseUser) {
        seedingRef.current = true;
        setSeeding(true);
        try {
          await ensureUserWorkspaceSeeded(firebaseUser);
        } finally {
          seedingRef.current = false;
          setSeeding(false);
        }
      }
    });
    return () => unsub();
  }, []);

  // Attach Firestore real-time listeners strictly when authenticated
  useEffect(() => {
    if (!authReady || !user) {
      ticketsInitializedRef.current = false;
      seenTicketIdsRef.current.clear();
      setHighPriorityToasts([]);
      setWeeklyReports([]);
      setWeeklyReportsLoaded(false);
      weeklyAutoAttemptedRef.current = null;
      return;
    }
    const uid = user.uid;
    ticketsInitializedRef.current = false;
    seenTicketIdsRef.current.clear();
    setWeeklyReportsLoaded(false);

    const unsubProfile = onSnapshot(
      doc(db, 'users', uid, 'public', 'profile'),
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as UserProfileDoc;
        setUserProfile(data);
        if (isValidThemeMode(data.themeMode)) {
          setThemeMode(data.themeMode);
        }
        if (isValidLocale(data.preferredLocale)) {
          setLocale(data.preferredLocale);
          saveLocale(data.preferredLocale);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}/public/profile`)
    );

    const unsubAgents = onSnapshot(
      query(collection(db, 'agents'), where('ownerId', '==', uid)),
      (snap) => setAgents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SupportAgent, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'agents')
    );

    const unsubClients = onSnapshot(
      query(collection(db, 'clients'), where('ownerId', '==', uid)),
      (snap) => setClients(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ClientAccount, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'clients')
    );

    const unsubSla = onSnapshot(
      query(collection(db, 'slaPolicies'), where('ownerId', '==', uid)),
      (snap) => setSlaPolicies(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SlaPolicy, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'slaPolicies')
    );

    const unsubTickets = onSnapshot(
      query(collection(db, 'tickets'), where('ownerId', '==', uid), orderBy('firstResponseDueMs', 'asc')),
      (snap) => {
        const mapped = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Ticket, 'id'>) }));
        setTickets(mapped);

        if (!ticketsInitializedRef.current) {
          mapped.forEach((tk) => seenTicketIdsRef.current.add(tk.id));
          ticketsInitializedRef.current = true;
          return;
        }

        snap.docChanges().forEach((change) => {
          if (change.type !== 'added') return;
          if (seenTicketIdsRef.current.has(change.doc.id)) return;
          seenTicketIdsRef.current.add(change.doc.id);

          if (seedingRef.current) return;
          const createdTicket: Ticket = {
            id: change.doc.id,
            ...(change.doc.data() as Omit<Ticket, 'id'>),
          };
          if (createdTicket.priority === 'high' || createdTicket.priority === 'critical') {
            pushHighPriorityToast(createdTicket);
          }
        });
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'tickets')
    );

    const unsubShifts = onSnapshot(
      query(collection(db, 'onCallShifts'), where('ownerId', '==', uid)),
      (snap) => setShifts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OnCallShift, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'onCallShifts')
    );

    const unsubLeaves = onSnapshot(
      query(collection(db, 'agentLeaves'), where('ownerId', '==', uid)),
      (snap) => setLeaves(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AgentLeave, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'agentLeaves')
    );

    const unsubRules = onSnapshot(
      query(collection(db, 'automationRules'), where('ownerId', '==', uid)),
      (snap) => setRules(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AutomationRule, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'automationRules')
    );

    const unsubCalls = onSnapshot(
      query(collection(db, 'callLogs'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
      (snap) => setCallLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CallLog, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'callLogs')
    );

    const unsubKb = onSnapshot(
      query(collection(db, 'kbArticles'), where('ownerId', '==', uid)),
      (snap) => setKbArticles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<KbArticle, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'kbArticles')
    );

    const unsubForum = onSnapshot(
      query(collection(db, 'forumTopics'), where('ownerId', '==', uid)),
      (snap) => setForumTopics(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ForumTopic, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'forumTopics')
    );

    const unsubCsat = onSnapshot(
      query(collection(db, 'csatSurveys'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
      (snap) => setCsatSurveys(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CsatSurvey, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'csatSurveys')
    );

    const unsubQa = onSnapshot(
      query(collection(db, 'qaEvaluations'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
      (snap) => setQaEvaluations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<QaEvaluation, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'qaEvaluations')
    );

    const unsubWfm = onSnapshot(
      query(collection(db, 'wfmShifts'), where('ownerId', '==', uid)),
      (snap) => setWfmShifts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WfmShift, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'wfmShifts')
    );

    const unsubIntegrations = onSnapshot(
      query(collection(db, 'integrations'), where('ownerId', '==', uid)),
      (snap) => setIntegrations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ExternalIntegration, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'integrations')
    );

    const unsubConfig = onSnapshot(
      query(collection(db, 'workspaceConfigs'), where('ownerId', '==', uid)),
      (snap) => setWorkspaceConfigs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WorkspaceConfig, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'workspaceConfigs')
    );

    const unsubAudit = onSnapshot(
      query(collection(db, 'auditLogs'), where('ownerId', '==', uid), orderBy('createdAt', 'desc')),
      (snap) => setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLogEntry, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    );

    const unsubAnnotations = onSnapshot(
      query(collection(db, 'chartAnnotations'), where('ownerId', '==', uid)),
      (snap) => setChartAnnotations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChartAnnotation, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'chartAnnotations')
    );

    const unsubOnCallReports = onSnapshot(
      query(collection(db, 'onCallReports'), where('ownerId', '==', uid)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OnCallReportEntry, 'id'>) }));
        items.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setOnCallReports(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'onCallReports')
    );

    const unsubKbPdfs = onSnapshot(
      query(collection(db, 'kbPdfDocuments'), where('ownerId', '==', uid)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<KbPdfDocument, 'id'>) }));
        items.sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
        setKbPdfDocuments(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'kbPdfDocuments')
    );

    const unsubWeeklyReports = onSnapshot(
      query(collection(db, 'weeklyReports'), where('ownerId', '==', uid)),
      (snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<WeeklyReportRecord, 'id'>) }));
        items.sort((a, b) => b.weekKey.localeCompare(a.weekKey));
        setWeeklyReports(items);
        setWeeklyReportsLoaded(true);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'weeklyReports')
    );

    return () => {
      unsubProfile();
      unsubAgents();
      unsubClients();
      unsubSla();
      unsubTickets();
      unsubShifts();
      unsubLeaves();
      unsubRules();
      unsubCalls();
      unsubKb();
      unsubForum();
      unsubCsat();
      unsubQa();
      unsubWfm();
      unsubIntegrations();
      unsubConfig();
      unsubAudit();
      unsubAnnotations();
      unsubOnCallReports();
      unsubKbPdfs();
      unsubWeeklyReports();
    };
  }, [authReady, user]);

  const handleThemeModeChange = useCallback(
    async (nextMode: ThemePreferenceMode) => {
      setThemeMode(nextMode);
      saveThemeMode(nextMode);
      if (!user) return;
      const profileRef = doc(db, 'users', user.uid, 'public', 'profile');
      try {
        if (userProfile) {
          await updateDoc(profileRef, {
            themeMode: nextMode,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(
            profileRef,
            {
              uid: user.uid,
              displayName: (user.displayName || user.email?.split('@')[0] || 'Agent Support').slice(0, 120),
              role: user.email === 'camillenguiopo@gmail.com' ? 'admin' : 'supervisor',
              department: 'Centre Support & Opérations',
              themeMode: nextMode,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/public/profile`);
      }
    },
    [user, userProfile]
  );

  const handleLocaleChange = useCallback(
    async (nextLocale: AppLocale) => {
      setLocale(nextLocale);
      saveLocale(nextLocale);
      if (!user) return;
      const profileRef = doc(db, 'users', user.uid, 'public', 'profile');
      try {
        if (userProfile) {
          await updateDoc(profileRef, {
            preferredLocale: nextLocale,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(
            profileRef,
            {
              uid: user.uid,
              displayName: (user.displayName || user.email?.split('@')[0] || 'Agent Support').slice(0, 120),
              role: user.email === 'camillenguiopo@gmail.com' ? 'admin' : 'supervisor',
              department: 'Centre Support & Opérations',
              themeMode,
              preferredLocale: nextLocale,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/public/profile`);
      }
    },
    [user, userProfile, themeMode]
  );

  const currentUserName =
    userProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Agent Support';
  const currentUserEmail = user?.email || '';

  const saveWeeklyReportSnapshot = useCallback(
    async (weekOption: IsoWeekOption, mode: 'auto' | 'manual') => {
      if (!user) return null;
      const uid = user.uid;
      const summary = computeWeeklyPerformanceSummary({
        week: weekOption,
        tickets,
        slaPolicies,
        agents,
        callLogs,
        csatSurveys,
      });

      const docId = `${uid}_${weekOption.weekKey}`;
      const existing = weeklyReports.find(
        (r) => r.id === docId || r.weekKey === weekOption.weekKey
      );
      const criticalRefs = summary.criticalTicketRefs
        .map((r) => clampString(r, 40))
        .filter(Boolean)
        .slice(0, 20);

      const highlightsText = clampString(
        `Conformité SLA ${summary.slaCompliancePct}% (${summary.resolvedTickets}/${summary.totalTickets} tickets résolus, temps rép. moyen ${formatMinutesCompact(summary.avgResponseMinutes)}). ${summary.criticalTicketsCount} ticket(s) critique(s) P1, ${summary.escalatedTickets} escaladé(s), ${summary.slaBreachedCount} hors délai SLA.${
          criticalRefs.length > 0 ? ` Réfs critiques : ${criticalRefs.slice(0, 6).join(', ')}.` : ''
        }`,
        1200
      );

      const payloadFields = {
        weekKey: weekOption.weekKey,
        weekLabel: clampString(weekOption.label, 120, weekOption.weekKey),
        rangeLabel: clampString(weekOption.rangeLabel, 80, weekOption.weekKey),
        generationMode: mode,
        totalTickets: Math.max(0, Math.round(summary.totalTickets)),
        resolvedTickets: Math.max(0, Math.round(summary.resolvedTickets)),
        openTickets: Math.max(0, Math.round(summary.openTickets)),
        escalatedTickets: Math.max(0, Math.round(summary.escalatedTickets)),
        criticalTicketsCount: Math.max(0, Math.round(summary.criticalTicketsCount)),
        slaBreachedCount: Math.max(0, Math.round(summary.slaBreachedCount)),
        slaCompliancePct: Math.max(0, Math.min(100, Math.round(summary.slaCompliancePct))),
        avgResponseMinutes: Math.max(0, Math.round(summary.avgResponseMinutes)),
        avgCsatScore: clampString(summary.avgCsatScore === '—' ? '-' : summary.avgCsatScore, 16, '-'),
        criticalTicketRefs: criticalRefs,
        highlights: highlightsText,
        generatedBy: clampString(
          mode === 'auto' ? 'Planificateur automatique ZentraDesk' : currentUserName,
          120,
          'ZentraDesk'
        ),
      };

      const targetPath = `weeklyReports/${existing?.id || docId}`;
      try {
        if (existing) {
          await updateDoc(doc(db, 'weeklyReports', existing.id), {
            ...payloadFields,
            updatedAt: serverTimestamp(),
          });
        } else {
          await setDoc(doc(db, 'weeklyReports', docId), {
            ...payloadFields,
            ownerId: uid,
            memberIds: [uid],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        return summary;
      } catch (err) {
        handleFirestoreError(err, existing ? OperationType.UPDATE : OperationType.CREATE, targetPath);
        return null;
      }
    },
    [user, tickets, slaPolicies, agents, callLogs, csatSurveys, weeklyReports, currentUserName]
  );

  const handleToggleWeeklyAuto = useCallback((nextVal: boolean) => {
    setWeeklyAutoEnabled(nextVal);
    try {
      window.localStorage.setItem('zentradesk_weekly_auto_v1', String(nextVal));
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (!authReady || !user || seeding || !weeklyReportsLoaded || !weeklyAutoEnabled) return;
    if (tickets.length === 0) return;
    const currentWeek = getRecentIsoWeeks(1)[0];
    if (!currentWeek) return;
    const attemptKey = `${user.uid}_${currentWeek.weekKey}`;
    if (weeklyAutoAttemptedRef.current === attemptKey) return;
    const alreadyExists = weeklyReports.some((r) => r.weekKey === currentWeek.weekKey);
    weeklyAutoAttemptedRef.current = attemptKey;
    if (!alreadyExists) {
      void saveWeeklyReportSnapshot(currentWeek, 'auto');
    }
  }, [
    authReady,
    user,
    seeding,
    weeklyReportsLoaded,
    weeklyAutoEnabled,
    tickets.length,
    weeklyReports,
    saveWeeklyReportSnapshot,
  ]);

  const {
    connected: wsConnected,
    presence,
    chatMessages,
    recentActivity,
    updatePresence,
    sendChatMessage,
    broadcastTicketActivity,
  } = useCollaborationSocket(user ? currentUserName : '', currentUserEmail);

  const handlePresenceTicket = useCallback(
    (ticketId: string | null, typingTicketId: string | null = null) => {
      updatePresence({ activeTicketId: ticketId, typingTicketId });
    },
    [updatePresence]
  );

  // Global Keyboard Shortcuts Manager (Productivity: Ctrl+N / Alt+N, Alt+1..8, Alt+C, Shift+?, Esc)
  useEffect(() => {
    if (!user) return;
    const TAB_ORDER: NavTab[] = [
      'tickets',
      'clients',
      'collaboration',
      'analytics',
      'oncall',
      'automation',
      'knowledge',
      'integrations',
      'favorites',
    ];

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toUpperCase() || '';
      const isEditingText =
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        Boolean(target?.isContentEditable);

      if (e.key === 'Escape') {
        if (profileModalOpen) {
          setProfileModalOpen(false);
          return;
        }
        if (shortcutsModalOpen) {
          setShortcutsModalOpen(false);
          return;
        }
        if (typographyModalOpen) {
          setTypographyModalOpen(false);
          return;
        }
        if (floatingChatOpen) {
          setFloatingChatOpen(false);
          return;
        }
        if (isFullscreenWorkspace) {
          setIsFullscreenWorkspace(false);
          return;
        }
      }

      // Open New Ticket Modal: Ctrl+N / Cmd+N / Alt+N
      if (((e.ctrlKey || e.metaKey || e.altKey) && e.key.toLowerCase() === 'n')) {
        e.preventDefault();
        setActiveTab('tickets');
        setCreateTicketSignal((n) => n + 1);
        return;
      }

      // Toggle Floating Chat: Alt+C
      if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setFloatingChatOpen((v) => !v);
        return;
      }

      // Toggle Workspace Fullscreen Mode: Alt+F
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setMobileNavOpen(false);
        setIsFullscreenWorkspace((v) => !v);
        return;
      }

      // Switch Main Tabs: Alt+1 .. Alt+9
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (TAB_ORDER[idx]) {
          e.preventDefault();
          setActiveTab(TAB_ORDER[idx]);
        }
        return;
      }

      // Open Keyboard Shortcuts Guide: Ctrl+/ or Shift+? (outside inputs)
      if ((e.ctrlKey && e.key === '/') || (!isEditingText && e.key === '?')) {
        e.preventDefault();
        setShortcutsModalOpen((v) => !v);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [user, profileModalOpen, shortcutsModalOpen, typographyModalOpen, floatingChatOpen, isFullscreenWorkspace]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F5F7FB] dark:bg-slate-950 flex items-center justify-center p-6">
        <p className="text-sm text-slate-600 dark:text-slate-400">{I18N[locale].header.initializing}</p>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  const navGroups = buildNavGroups(locale);
  const allNavItems = navGroups.flatMap((g) => g.items);
  const dictHeader = I18N[locale].header;
  const dictToasts = I18N[locale].toasts;
  const dictShortcuts = I18N[locale].shortcutsModal;
  const activeNavLabel = allNavItems.find((i) => i.id === activeTab)?.label || I18N[locale].navItems.tickets;
  const activeFontLabel =
    TYPOGRAPHY_FONTS.find((f) => f.id === typography.fontId)?.label || 'Outfit';
  const activeThemeShortLabel =
    dictHeader.themeShortLabels[themeMode] || dictHeader.themeShortLabels.light;
  const themeDiagnostics = getThemeDiagnostics(themeMode, systemPrefersDark, themeClock);
  const openTicketsCount = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length;
  const favoriteTicketsCount = tickets.filter((t) => Boolean(t.isFavorite)).length;
  const alertClientsCount = clients.filter((c) => c.healthStatus !== 'nominal').length;
  const activeShift = shifts.find((s) => s.status === 'active');
  const avgSla =
    agents.length > 0
      ? (agents.reduce((s, a) => s + a.slaCompliancePct, 0) / agents.length).toFixed(1)
      : '—';

  return (
    <div className="min-h-screen bg-[#F5F7FB] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex">
      {/* Signature Deep-Slate Enterprise Sidebar (256px) */}
      {!isFullscreenWorkspace && (
      <aside className="hidden lg:flex lg:flex-col w-64 shrink-0 bg-[#0B1120] text-slate-300 border-r border-slate-800/80">
        <div className="h-16 px-5 border-b border-slate-800/80 flex items-center gap-2.5">
          <svg
            width="26"
            height="26"
            viewBox="0 0 28 28"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <rect width="28" height="28" rx="7" fill="#1E293B" />
            <path d="M7 9.5H21L10.5 18.5H21" stroke="#60A5FA" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
            ZentraDesk
          </span>
        </div>

        <nav className="flex-1 p-3.5 space-y-5 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.heading} className="space-y-1">
              <p className="px-3 pb-1 text-[11px] font-medium text-slate-500">
                {group.heading}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                const count =
                  item.id === 'tickets'
                    ? openTicketsCount
                    : item.id === 'favorites'
                    ? favoriteTicketsCount
                    : item.id === 'clients'
                    ? alertClientsCount
                    : null;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-600 text-white font-semibold shadow-sm'
                        : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 whitespace-nowrap">
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                    </span>
                    {count !== null && count > 0 && (
                      <span
                        className={`font-mono tabular-nums text-[11px] ${
                          active ? 'text-blue-100' : 'text-slate-400'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Live WebSocket Activity Mini-Feed */}
        <div className="p-4 border-t border-slate-800/80 space-y-2.5 bg-slate-950/40">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="font-medium text-slate-300">{dictHeader.teamActivity}</span>
            <span>{wsConnected ? dictHeader.wsActive : dictHeader.wsReconnecting}</span>
          </div>
          {recentActivity.length > 0 ? (
            <div className="space-y-1.5">
              {recentActivity.slice(0, 2).map((act) => (
                <p key={act.id} className="text-[11px] text-slate-300 leading-snug">
                  <span className="font-semibold text-white">{act.agentName.split(' ')[0]}</span> {act.actionLabel}{' '}
                  <span className="font-mono text-blue-400">{act.ticketRef}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">
              {presence.length || 1} {dictHeader.agentsOnline}
            </p>
          )}

          <div className="pt-2.5 border-t border-slate-800 space-y-2">
            <div className="flex items-center justify-between px-2.5 py-1 text-xs text-slate-300">
              <span className="inline-flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-blue-400" />
                <span>{dictHeader.language}</span>
              </span>
              <div
                role="group"
                aria-label={dictHeader.language}
                className="flex items-center gap-1 bg-slate-900 rounded-md p-0.5 border border-slate-800"
              >
                {UI_LOCALE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleLocaleChange(opt.id)}
                    aria-pressed={locale === opt.id}
                    title={opt.label}
                    className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                      locale === opt.id
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {opt.short}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800/70 rounded-lg transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <UserCog className="w-3.5 h-3.5 text-blue-400" />
                <span>{dictHeader.profileSettings}</span>
              </span>
              <span className="text-[11px] text-slate-400 truncate max-w-[95px]">
                {activeThemeShortLabel}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setTypographyModalOpen(true)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800/70 rounded-lg transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-blue-400" />
                <span>{dictHeader.typography}</span>
              </span>
              <span className="text-[11px] text-slate-400 truncate max-w-[90px]">
                {activeFontLabel}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShortcutsModalOpen(true)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-800/70 rounded-lg transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5">
                <Keyboard className="w-3.5 h-3.5 text-blue-400" />
                <span>{dictHeader.shortcuts}</span>
              </span>
              <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-900 border border-slate-700 rounded text-slate-400">
                ?
              </kbd>
            </button>

            <div className="flex items-center justify-between gap-2 px-1">
              <button
                type="button"
                onClick={() => handleThemeModeChange(darkMode ? 'light' : 'dark')}
                title={themeDiagnostics.statusTitle}
                className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors cursor-pointer min-w-0"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5 shrink-0" /> : <Moon className="w-3.5 h-3.5 shrink-0" />}
                <span className="truncate">
                  {darkMode ? dictHeader.lightMode : dictHeader.darkMode}
                  {(themeMode === 'system' || themeMode === 'schedule') && (
                    <span className="text-[10px] text-slate-400 ml-1">
                      ({themeMode === 'schedule' ? '19h–8h' : 'Auto'})
                    </span>
                  )}
                </span>
              </button>

              <button
                type="button"
                onClick={() => signOut(auth)}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 transition-colors cursor-pointer shrink-0"
                title={dictHeader.signOutTooltip}
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{dictHeader.signOut}</span>
              </button>
            </div>
          </div>
        </div>
      </aside>
      )}

      {/* Mobile Sidebar Drawer */}
      {!isFullscreenWorkspace && mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden bg-slate-950/60 flex">
          <div className="w-64 bg-[#0B1120] text-slate-200 h-full p-4 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <span className="font-display text-lg font-bold text-white">ZentraDesk</span>
                <button type="button" onClick={() => setMobileNavOpen(false)} className="cursor-pointer text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="space-y-1">
                {allNavItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileNavOpen(false);
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium rounded-lg ${
                        activeTab === item.id
                          ? 'bg-blue-600 text-white font-semibold'
                          : 'text-slate-300 hover:bg-slate-800/70'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
            <div className="space-y-2 border-t border-slate-800 pt-3">
              <div className="flex items-center justify-between px-2 py-1 text-xs text-slate-300">
                <span className="inline-flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-400" />
                  <span>{dictHeader.language}</span>
                </span>
                <div
                  role="group"
                  aria-label={dictHeader.language}
                  className="flex items-center gap-1 bg-slate-900 rounded-md p-0.5 border border-slate-800"
                >
                  {UI_LOCALE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleLocaleChange(opt.id)}
                      aria-pressed={locale === opt.id}
                      title={opt.label}
                      className={`px-2 py-0.5 text-[10px] font-mono font-semibold rounded cursor-pointer transition-colors whitespace-nowrap shrink-0 ${
                        locale === opt.id
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {opt.short}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  setProfileModalOpen(true);
                }}
                className="w-full flex items-center justify-between text-xs text-slate-300 hover:text-white p-2 rounded-lg hover:bg-slate-800/70 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <UserCog className="w-4 h-4 text-blue-400" />
                  <span>{dictHeader.profileSettings}</span>
                </span>
                <span className="text-[11px] text-slate-400">{activeThemeShortLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  setTypographyModalOpen(true);
                }}
                className="w-full flex items-center justify-between text-xs text-slate-300 hover:text-white p-2 rounded-lg hover:bg-slate-800/70 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <Type className="w-4 h-4 text-blue-400" />
                  <span>{dictHeader.typography}</span>
                </span>
                <span className="text-[11px] text-slate-400">{activeFontLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => signOut(auth)}
                title={dictHeader.signOutTooltip}
                className="flex items-center gap-2 text-xs text-red-400 p-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>{dictHeader.signOut}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract (Breadcrumb left, Global Search center, 1 primary CTA + user on right) */}
        {!isFullscreenWorkspace && (
        <header className="h-16 px-4 md:px-6 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-xs md:text-sm truncate">
              <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">ZentraDesk</span>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">/</span>
              <h1 className="font-display font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[140px] md:max-w-[200px]">
                {activeNavLabel}
              </h1>
            </div>
          </div>

          <GlobalHeaderSearch
            tickets={tickets}
            clients={clients}
            kbArticles={kbArticles}
            locale={locale}
            onSelectTicket={(ticket) => {
              setActiveTab('tickets');
              setTicketSearchRequest({ ticketId: ticket.id, nonce: Date.now() });
            }}
            onSelectClient={(_client, queryText) => {
              setActiveTab('clients');
              setClientSearchRequest({ query: queryText, nonce: Date.now() });
            }}
            onSelectArticle={(article) => {
              setActiveTab('knowledge');
              setKbSearchRequest({ articleId: article.id, nonce: Date.now() });
            }}
            onApplyFilterToTab={(scope, queryText) => {
              const nonce = Date.now();
              if (scope === 'tickets') {
                setActiveTab('tickets');
                setTicketSearchRequest({ query: queryText, nonce });
              } else if (scope === 'clients') {
                setActiveTab('clients');
                setClientSearchRequest({ query: queryText, nonce });
              } else {
                setActiveTab('knowledge');
                setKbSearchRequest({ query: queryText, nonce });
              }
            }}
          />

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              title={dictHeader.profileTooltip}
              className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <UserCog className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
              <span className="truncate max-w-[140px]">{currentUserName}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileNavOpen(false);
                setIsFullscreenWorkspace(true);
              }}
              aria-label={dictHeader.fullscreen}
              aria-pressed={isFullscreenWorkspace}
              title={`${dictHeader.fullscreen} (Alt+F)`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Maximize2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
              <span className="hidden xl:inline">{dictHeader.fullscreen}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('tickets');
                setCreateTicketSignal((n) => n + 1);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{dictHeader.newTicket}</span>
            </button>
          </div>
        </header>
        )}

        {/* Executive Operations Context Strip */}
        {!isFullscreenWorkspace && (
        <div className="px-4 md:px-6 pt-4 pb-1">
          <div className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="text-slate-500 dark:text-slate-400">
                {dictHeader.activeTickets} : <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">{openTicketsCount}</strong>
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                {dictHeader.slaCompliance} : <strong className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400">{avgSla}%</strong>
              </span>
              <span className="text-slate-500 dark:text-slate-400">
                {dictHeader.clientsAlert} : <strong className="font-mono tabular-nums text-amber-700 dark:text-amber-400">{alertClientsCount}</strong>
              </span>
            </div>
            <span className="text-slate-600 dark:text-slate-300">
              {dictHeader.onCallNow} :{' '}
              <strong className="font-medium text-slate-900 dark:text-slate-100">
                {activeShift ? `${activeShift.agentName} (${activeShift.specialty})` : dictHeader.noShift}
              </strong>
            </span>
          </div>
        </div>
        )}

        {/* Main Viewport */}
        <main className={`flex-1 p-4 md:p-6 overflow-y-auto ${isFullscreenWorkspace ? '' : 'pt-4'}`}>
          {seeding && tickets.length === 0 ? (
            <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-3">
              <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
              <div className="h-4 w-80 bg-slate-100 dark:bg-slate-800/60 rounded animate-pulse" />
            </div>
          ) : (
            <motion.div
              key={activeTab === 'favorites' ? 'tickets' : activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {(activeTab === 'tickets' || activeTab === 'favorites') && (
                <TicketsView
                  uid={user.uid}
                  currentUserName={currentUserName}
                  tickets={tickets}
                  agents={agents}
                  clients={clients}
                  slaPolicies={slaPolicies}
                  kbArticles={kbArticles}
                  workspaceConfig={workspaceConfigs[0]}
                  locale={locale}
                  presence={presence}
                  onPresenceTicketChange={handlePresenceTicket}
                  onBroadcastActivity={broadcastTicketActivity}
                  openCreateModalSignal={createTicketSignal}
                  externalSearchRequest={ticketSearchRequest}
                  externalViewMode={activeTab === 'favorites' ? 'favorites' : 'all'}
                  onExitFavoritesView={() => setActiveTab('tickets')}
                />
              )}

              {activeTab === 'clients' && (
                <ProactiveClientsView
                  uid={user.uid}
                  currentUserName={currentUserName}
                  clients={clients}
                  agents={agents}
                  tickets={tickets}
                  callLogs={callLogs}
                  locale={locale}
                  onOpenTicket={(ticketId) => {
                    setActiveTab('tickets');
                    setTicketSearchRequest({ ticketId, nonce: Date.now() });
                  }}
                  externalSearchRequest={clientSearchRequest}
                />
              )}

              {activeTab === 'analytics' && (
                <CapacityAnalyticsView
                  uid={user.uid}
                  currentUserName={currentUserName}
                  agents={agents}
                  tickets={tickets}
                  slaPolicies={slaPolicies}
                  clients={clients}
                  callLogs={callLogs}
                  csatSurveys={csatSurveys}
                  qaEvaluations={qaEvaluations}
                  wfmShifts={wfmShifts}
                  leaves={leaves}
                  onCallShifts={shifts}
                  locale={locale}
                  chartAnnotations={chartAnnotations}
                  weeklyReports={weeklyReports}
                  weeklyAutoEnabled={weeklyAutoEnabled}
                  onToggleWeeklyAuto={handleToggleWeeklyAuto}
                  onGenerateWeeklySnapshot={saveWeeklyReportSnapshot}
                />
              )}

              {activeTab === 'oncall' && (
                <OnCallScheduleView
                  uid={user.uid}
                  currentUserName={currentUserName}
                  agents={agents}
                  shifts={shifts}
                  leaves={leaves}
                  tickets={tickets}
                  reports={onCallReports}
                />
              )}

              {activeTab === 'automation' && (
                <AiAutomationView
                  uid={user.uid}
                  locale={locale}
                  workspaceConfig={workspaceConfigs[0]}
                  rules={rules}
                  slaPolicies={slaPolicies}
                  agents={agents}
                  tickets={tickets}
                />
              )}

              {activeTab === 'collaboration' && (
                <CollaborationCallView
                  uid={user.uid}
                  currentUserName={currentUserName}
                  wsConnected={wsConnected}
                  presence={presence}
                  chatMessages={chatMessages}
                  onSendChat={sendChatMessage}
                  callLogs={callLogs}
                  clients={clients}
                  agents={agents}
                  tickets={tickets}
                  slaPolicies={slaPolicies}
                  onOpenTicket={() => setActiveTab('tickets')}
                />
              )}

              {activeTab === 'knowledge' && (
                <KnowledgePortalView
                  uid={user.uid}
                  currentUserName={currentUserName}
                  locale={locale}
                  kbArticles={kbArticles}
                  pdfDocuments={kbPdfDocuments}
                  forumTopics={forumTopics}
                  tickets={tickets}
                  clients={clients}
                  slaPolicies={slaPolicies}
                  agents={agents}
                  workspaceConfig={workspaceConfigs[0]}
                  externalSearchRequest={kbSearchRequest}
                />
              )}

              {activeTab === 'integrations' && (
                <IntegrationsAdminView
                  uid={user.uid}
                  currentUserName={currentUserName}
                  locale={locale}
                  onLocaleChange={handleLocaleChange}
                  integrations={integrations}
                  workspaceConfig={workspaceConfigs[0]}
                  auditLogs={auditLogs}
                  clients={clients}
                  tickets={tickets}
                  callLogs={callLogs}
                  csatSurveys={csatSurveys}
                />
              )}
            </motion.div>
          )}
        </main>
      </div>

      <TypographyModal
        open={typographyModalOpen}
        settings={typography}
        onChange={setTypography}
        onClose={() => setTypographyModalOpen(false)}
      />

      <AgentProfileModal
        open={profileModalOpen}
        uid={user.uid}
        userEmail={currentUserEmail}
        profile={userProfile}
        fallbackName={currentUserName}
        themeMode={themeMode}
        systemPrefersDark={systemPrefersDark}
        now={themeClock}
        activeFontLabel={activeFontLabel}
        onThemeModeChange={handleThemeModeChange}
        onOpenTypography={() => setTypographyModalOpen(true)}
        onClose={() => setProfileModalOpen(false)}
      />

      {/* Global Keyboard Shortcuts Reference Modal */}
      {shortcutsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-blue-600" />
                <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  {dictHeader.shortcuts}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShortcutsModalOpen(false)}
                aria-label={dictShortcuts.closeAria}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {dictShortcuts.items.map(([keys, desc]) => (
                <div key={keys} className="py-2.5 flex items-center justify-between gap-4">
                  <span className="text-slate-700 dark:text-slate-300">{desc}</span>
                  <kbd className="px-2 py-1 font-mono text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Floating Corner Exit Fullscreen Button */}
      {isFullscreenWorkspace && (
        <button
          type="button"
          onClick={() => setIsFullscreenWorkspace(false)}
          aria-label={dictHeader.exitFullscreen}
          title={`${dictHeader.exitFullscreen} (Alt+F / Échap)`}
          className="fixed top-4 right-4 z-40 inline-flex items-center gap-2 px-3 py-2 bg-white/95 dark:bg-slate-900/95 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 shadow-[0_8px_24px_rgba(15,23,42,0.14)] backdrop-blur-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Minimize2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="hidden sm:inline">{dictHeader.exitFullscreen}</span>
        </button>
      )}

      {/* Real-Time High-Priority Ticket Toast Notifications */}
      <div
        aria-live="polite"
        aria-label={dictToasts.regionLabel}
        className={`fixed right-4 z-50 w-[min(380px,calc(100vw-2rem))] space-y-2.5 pointer-events-none ${
          isFullscreenWorkspace ? 'top-16' : 'top-20'
        }`}
      >
        <AnimatePresence initial={false}>
          {highPriorityToasts.map((toast) => {
            const isCritical = toast.priority === 'critical';
            return (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, x: 24, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                role="alert"
                className={`pointer-events-auto rounded-xl border p-3.5 shadow-[0_12px_30px_rgba(15,23,42,0.16)] backdrop-blur-md bg-white/95 dark:bg-slate-900/95 space-y-2.5 ${
                  isCritical
                    ? 'border-red-300 dark:border-red-800/80'
                    : 'border-amber-300 dark:border-amber-800/80'
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isCritical
                          ? 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/70'
                          : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/70'
                      }`}
                    >
                      {isCritical ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : (
                        <BellRing className="w-4 h-4" />
                      )}
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[11px] font-bold uppercase tracking-wide ${
                            isCritical
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {isCritical ? dictToasts.criticalLabel : dictToasts.highLabel}
                        </span>
                        <span className="font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                          {toast.reference}
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">
                          · {toast.createdAtLabel}
                        </span>
                      </div>

                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                        {toast.subject}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {toast.clientName} · {toast.assignedGroup}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => dismissHighPriorityToast(toast.id)}
                    aria-label={dictToasts.dismissAria}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => dismissHighPriorityToast(toast.id)}
                    className="px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {dictToasts.ignore}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('tickets');
                      setTicketSearchRequest({ ticketId: toast.ticketId, nonce: Date.now() });
                      dismissHighPriorityToast(toast.id);
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      isCritical
                        ? 'bg-red-600 hover:bg-red-700'
                        : 'bg-amber-600 hover:bg-amber-700'
                    }`}
                  >
                    <span>{dictToasts.openTicket}</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Persistent Bottom-Right Floating Chat & Conversational AI Button */}
      <FloatingChatWidget
        uid={user.uid}
        currentUserName={currentUserName}
        open={floatingChatOpen}
        onToggle={() => setFloatingChatOpen((v) => !v)}
        onClose={() => setFloatingChatOpen(false)}
        wsConnected={wsConnected}
        chatMessages={chatMessages}
        onSendChat={sendChatMessage}
        kbArticles={kbArticles}
        clients={clients}
        tickets={tickets}
        slaPolicies={slaPolicies}
        agents={agents}
        workspaceConfig={workspaceConfigs[0]}
        onOpenTicket={() => setActiveTab('tickets')}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <HelpdeskShell />
    </ErrorBoundary>
  );
}
