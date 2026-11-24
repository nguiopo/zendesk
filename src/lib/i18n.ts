import { AppLocale } from '../types/helpdesk';

const LOCALE_STORAGE_KEY = 'zentradesk_locale_v1';

export const LOCALE_OPTIONS: { id: AppLocale; label: string; short: string }[] = [
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'es', label: 'Español', short: 'ES' },
];

export const UI_LOCALE_OPTIONS: { id: 'fr' | 'en'; label: string; short: string }[] = [
  { id: 'fr', label: 'Français', short: 'FR' },
  { id: 'en', label: 'English', short: 'EN' },
];

export function isValidLocale(value: unknown): value is AppLocale {
  return value === 'fr' || value === 'en' || value === 'es';
}

export interface UiDictionary {
  navGroups: {
    operations: string;
    analytics: string;
    ecosystem: string;
  };
  navItems: {
    tickets: string;
    favorites: string;
    clients: string;
    collaboration: string;
    analytics: string;
    oncall: string;
    automation: string;
    knowledge: string;
    integrations: string;
  };
  header: {
    newTicket: string;
    activeTickets: string;
    slaCompliance: string;
    clientsAlert: string;
    onCallNow: string;
    noShift: string;
    language: string;
    typography: string;
    darkMode: string;
    lightMode: string;
    signOut: string;
    signOutTooltip: string;
    shortcuts: string;
    floatingChat: string;
    profileSettings: string;
    profileTooltip: string;
    fullscreen: string;
    exitFullscreen: string;
    teamActivity: string;
    wsActive: string;
    wsReconnecting: string;
    agentsOnline: string;
    initializing: string;
    themeShortLabels: {
      light: string;
      dark: string;
      system: string;
      schedule: string;
    };
  };
  toasts: {
    regionLabel: string;
    criticalLabel: string;
    highLabel: string;
    dismissAria: string;
    ignore: string;
    openTicket: string;
  };
  shortcutsModal: {
    closeAria: string;
    items: [string, string][];
  };
  search: {
    placeholder: string;
    ariaLabel: string;
    clearAria: string;
    resultsAria: string;
    scopeAll: string;
    scopeTickets: string;
    scopeClients: string;
    scopeKb: string;
    navHint: string;
    noResults: string;
    noResultsHint: string;
    openInTab: string;
    sectionTickets: string;
    sectionClients: string;
    sectionKb: string;
    viewsLabel: string;
  };
  tickets: {
    statusTabs: {
      all: string;
      active: string;
      slaAlert: string;
      snoozed: string;
      escalated: string;
      resolved: string;
    };
    channelAll: string;
    channelEmailPortal: string;
    channelSocialChat: string;
    channelVoiceTeam: string;
    favorites: string;
    vipOnly: string;
    quickPriority: string;
    resetFilters: string;
    allPriorities: string;
    priorityLabels: {
      critical: string;
      high: string;
      medium: string;
      low: string;
    };
    supportLevel: string;
    allLevels: string;
    levelLabels: {
      n1: string;
      n2: string;
      n3: string;
      cti: string;
    };
    emptyFavoritesTitle: string;
    emptyViewTitle: string;
    emptyFavoritesHint: string;
    emptyViewHint: string;
    seeAllTickets: string;
    addFavoriteTooltip: string;
    removeFavoriteTooltip: string;
    newTicketTitle: string;
    sentimentFilter: string;
    allSentiments: string;
    sentimentTense: string;
    sentimentConcerned: string;
    sentimentNeutral: string;
    sentimentPositive: string;
    sortTenseFirst: string;
    sentimentLabel: string;
    analyzeSentimentAi: string;
    analyzingSentiment: string;
    tensionScoreLabel: string;
    sentimentChartTitle: string;
    sentimentChartSubtitle: string;
    sentimentChartPositive: string;
    sentimentChartNeutral: string;
    sentimentChartTense: string;
    sentimentChartEmpty: string;
    sentimentChartTicketsWord: string;
    queueSaturationTitle: string;
    queueSaturationSubtitle: string;
    queueSaturationNominal: string;
    queueSaturationSaturatedLabel: string;
    queueSaturationElevatedLabel: string;
    queueSaturationNormalLabel: string;
    queueSaturationSaturatedCountSuffix: string;
    queueSaturationElevatedCountSuffix: string;
    queueSaturationRowTag: string;
    queueSaturationCapShort: string;
    generateAiReply: string;
    generatingAiReply: string;
    aiDraftReadyLabel: string;
    aiDraftSourcesLabel: string;
    aiDraftRegenerate: string;
    aiDraftClear: string;
    bulkSelectAllAria: string;
    bulkSelectRowAria: string;
    bulkSelectAllLabel: string;
    bulkSelectedCountSuffix: string;
    bulkClearSelection: string;
    bulkAssignAgentPlaceholder: string;
    bulkUnassignedOption: string;
    bulkAssignGroupPlaceholder: string;
    bulkPriorityPlaceholder: string;
    bulkStatusPlaceholder: string;
    bulkApplyAction: string;
    bulkApplying: string;
    bulkQuickResolve: string;
    bulkQuickEscalate: string;
    bulkSuccessNotice: string;
    bulkSkippedClosedSuffix: string;
    bulkAllClosedNotice: string;
    priorityDropdownLabel: string;
    prioritySelectedSuffix: string;
    priorityUrgentPreset: string;
    priorityClearSelection: string;
    priorityMultiHint: string;
  };
  clients: {
    kpiNominal: string;
    kpiOutOfZone: string;
    kpiPasswordLocked: string;
    kpiAvgAdoption: string;
    searchPlaceholder: string;
    filterAll: string;
    filterAttention: string;
    filterOutOfZone: string;
    filterPasswordLocked: string;
    addClient: string;
    colClient: string;
    colHealth: string;
    colAdoption: string;
    colLastCheck: string;
    colActions: string;
    btnCard: string;
    btnVerify: string;
    btnUnlock: string;
    btnOutOfZone: string;
    ticketWord: string;
    callWord: string;
    cardHeaderLabel: string;
    closeCardAria: string;
    adoptionLabel: string;
    noVerification: string;
    interactionHistoryTitle: string;
    entryWord: string;
    linkedTickets: string;
    activeWord: string;
    voipCalls: string;
    lastTrace: string;
    noneLabel: string;
    tabAll: string;
    tabTickets: string;
    tabCalls: string;
    noInteractionsTitle: string;
    noTicketsHint: string;
    noCallsHint: string;
    noInteractionsHint: string;
    openTicket: string;
    inboundCall: string;
    outboundCall: string;
    agentPrefix: string;
    noCallNotes: string;
    showAllHistory: string;
    collapseHistory: string;
  };
  kb: {
    title: string;
    subtitle: string;
    tabArticles: string;
    tabPdfLibrary: string;
    tabPortal: string;
    tabForum: string;
    newArticle: string;
    newTopic: string;
    searchPlaceholder: string;
    suggestedArticles: string;
    deflectButton: string;
    portalHeading: string;
    portalSubtitle: string;
    forumHeading: string;
  };
  admin: {
    title: string;
    subtitle: string;
    tabMarketplace: string;
    tabWebhooks: string;
    tabRbac: string;
    tabGdpr: string;
    auditDashboardTitle: string;
    auditDashboardSubtitle: string;
    auditViewByDay: string;
    auditViewByCategory: string;
    auditAllCategories: string;
    auditMetricTotal30d: string;
    auditMetricActorsSuffix: string;
    auditMetricActiveDays: string;
    auditMetricPeakDay: string;
    auditMetricTopCategory: string;
    auditEmptyTitle: string;
    auditEmptyHint: string;
    auditFilterHint: string;
    auditTooltipTotal: string;
    auditTooltipNoEvents: string;
    slaPulseTitle: string;
    slaPulseSubtitle: string;
    slaPulseInputLabel: string;
    slaPulseActivePrefix: string;
    slaPulsePreviewPill: string;
    slaPulseSave: string;
    slaPulseSaving: string;
    slaPulseSavedNotice: string;
    slaPulseRangeError: string;
    slaPulseRangeHint: string;
  };
}

export const I18N: Record<AppLocale, UiDictionary> = {
  fr: {
    navGroups: {
      operations: 'Opérations Support',
      analytics: 'Performance & Pilotage',
      ecosystem: 'Portail & Administration',
    },
    navItems: {
      tickets: 'Tickets & SLA',
      favorites: 'Favoris',
      clients: 'Suivi Proactif Clients',
      collaboration: 'Canaux, Tchat & VoIP',
      analytics: 'Rapports, Qualité & WFM',
      oncall: 'Astreintes & Dispos',
      automation: 'IA & Automatisations',
      knowledge: 'Base de connaissances',
      integrations: 'Intégrations & Admin',
    },
    header: {
      newTicket: 'Nouveau ticket',
      activeTickets: 'Tickets actifs',
      slaCompliance: 'Conformité SLA',
      clientsAlert: 'Clients en vigilance',
      onCallNow: 'Astreinte en cours',
      noShift: 'Aucun créneau actif',
      language: 'Langue',
      typography: 'Typographie',
      darkMode: 'Mode sombre',
      lightMode: 'Mode clair',
      signOut: 'Quitter',
      signOutTooltip: 'Déconnexion',
      shortcuts: 'Raccourcis clavier',
      floatingChat: 'Ouvrir le tchat',
      profileSettings: 'Profil & Thème',
      profileTooltip: 'Paramètres du profil de l’agent et thème automatique',
      fullscreen: 'Plein écran',
      exitFullscreen: 'Quitter plein écran',
      teamActivity: 'Activité équipe',
      wsActive: 'WebSocket actif',
      wsReconnecting: 'Reconnexion',
      agentsOnline: 'agent(s) en ligne',
      initializing: 'Initialisation ZentraDesk...',
      themeShortLabels: {
        light: 'Clair',
        dark: 'Sombre',
        system: 'Auto',
        schedule: '19h–8h',
      },
    },
    toasts: {
      regionLabel: 'Alertes temps réel des tickets urgents',
      criticalLabel: 'Ticket Critique (P1)',
      highLabel: 'Ticket Haute Priorité',
      dismissAria: 'Fermer la notification',
      ignore: 'Ignorer',
      openTicket: 'Ouvrir le ticket',
    },
    shortcutsModal: {
      closeAria: 'Fermer les raccourcis clavier',
      items: [
        ['Ctrl+K / Cmd+K', 'Activer la barre de recherche globale (tickets, clients, KB)'],
        ['Ctrl+N / Alt+N', 'Ouvrir le modal de création de ticket'],
        ['Alt+C', 'Ouvrir / Fermer le bouton flottant Tchat & Agent IA'],
        ['Alt+F', 'Activer / Quitter le mode plein écran de l’espace de travail'],
        ['Alt+1 … Alt+3', 'Basculer : Tickets (1), Clients (2), Canaux & VoIP (3)'],
        ['Alt+4 … Alt+6', 'Basculer : Rapports (4), Astreintes (5), IA & Règles (6)'],
        ['Alt+7 / Alt+8', 'Basculer : Base de connaissances (7), Intégrations (8)'],
        ['Alt+9', 'Basculer : Tickets favoris'],
        ['? ou Ctrl+/', 'Afficher cette fenêtre de raccourcis clavier'],
        ['Échap (Esc)', 'Fermer la fenêtre active ou quitter le plein écran'],
      ],
    },
    search: {
      placeholder: 'Rechercher tickets, clients, articles KB...',
      ariaLabel: 'Recherche globale dans les tickets, clients et base de connaissances',
      clearAria: 'Effacer la recherche',
      resultsAria: 'Résultats de la recherche globale',
      scopeAll: 'Tout',
      scopeTickets: 'Tickets',
      scopeClients: 'Clients',
      scopeKb: 'Base KB',
      navHint: '↑↓ naviguer · Entrée ouvrir',
      noResults: 'Aucun résultat pour',
      noResultsHint: 'Essayez une référence (ex. ZD-2041), un nom de société client ou un mot-clé MFA / hors-zone.',
      openInTab: 'Voir tout dans l’onglet',
      sectionTickets: 'Tickets & SLA',
      sectionClients: 'Comptes clients',
      sectionKb: 'Base de connaissances',
      viewsLabel: 'vues',
    },
    tickets: {
      statusTabs: {
        all: 'Tous',
        active: 'Ouverts',
        slaAlert: 'Alerte',
        snoozed: 'Snoozés',
        escalated: 'Escaladés',
        resolved: 'Résolus',
      },
      channelAll: 'File : Tous les canaux',
      channelEmailPortal: 'File Email, Portail & Web',
      channelSocialChat: 'File Chat & Réseaux sociaux',
      channelVoiceTeam: 'File VoIP, Slack/Teams & Alertes',
      favorites: 'Favoris',
      vipOnly: 'VIP uniquement',
      quickPriority: 'Priorité rapide',
      resetFilters: 'Réinitialiser',
      allPriorities: 'Toutes',
      priorityLabels: {
        critical: 'Critique',
        high: 'Haute',
        medium: 'Moyenne',
        low: 'Basse',
      },
      supportLevel: 'Niveau de support',
      allLevels: 'Tous niveaux',
      levelLabels: {
        n1: 'N1 Accès',
        n2: 'N2 Plateforme',
        n3: 'N3 Infra',
        cti: 'Relation Client',
      },
      emptyFavoritesTitle: 'Aucun ticket favori',
      emptyViewTitle: 'Aucun ticket dans cette vue',
      emptyFavoritesHint: 'Cliquez sur le bouton étoile d’un ticket pour l’épingler dans vos favoris.',
      emptyViewHint: 'Modifiez vos filtres ou créez une nouvelle demande client.',
      seeAllTickets: 'Voir tous les tickets',
      addFavoriteTooltip: 'Ajouter aux favoris',
      removeFavoriteTooltip: 'Retirer des favoris',
      newTicketTitle: 'Créer un ticket support (Routage IA & SLA)',
      sentimentFilter: 'Sentiment client',
      allSentiments: 'Tous',
      sentimentTense: 'Tendus',
      sentimentConcerned: 'Sous pression',
      sentimentNeutral: 'Neutres',
      sentimentPositive: 'Positifs',
      sortTenseFirst: 'Tendus d’abord',
      sentimentLabel: 'Sentiment détecté',
      analyzeSentimentAi: 'Analyser sentiment IA',
      analyzingSentiment: 'Analyse...',
      tensionScoreLabel: 'Tension',
      sentimentChartTitle: 'Charge émotionnelle du support',
      sentimentChartSubtitle: 'Répartition instantanée (cliquez pour filtrer)',
      sentimentChartPositive: 'Positif',
      sentimentChartNeutral: 'Neutre',
      sentimentChartTense: 'Tendu',
      sentimentChartEmpty: 'Aucun ticket à analyser',
      sentimentChartTicketsWord: 'tickets',
      queueSaturationTitle: 'Saturation de file d’attente',
      queueSaturationSubtitle: 'Volume actif vs capacité historique par groupe (clic pour filtrer)',
      queueSaturationNominal: 'Capacité nominale',
      queueSaturationSaturatedLabel: 'Saturé',
      queueSaturationElevatedLabel: 'Tension',
      queueSaturationNormalLabel: 'Nominal',
      queueSaturationSaturatedCountSuffix: 'groupe(s) saturé(s)',
      queueSaturationElevatedCountSuffix: 'sous tension',
      queueSaturationRowTag: 'File saturée',
      queueSaturationCapShort: 'cap. hist.',
      generateAiReply: 'Générer réponse IA',
      generatingAiReply: 'Génération IA...',
      aiDraftReadyLabel: 'Proposition Gemini prête',
      aiDraftSourcesLabel: 'Sources KB :',
      aiDraftRegenerate: 'Régénérer',
      aiDraftClear: 'Effacer',
      bulkSelectAllAria: 'Tout sélectionner dans la liste filtrée',
      bulkSelectRowAria: 'Sélectionner le ticket',
      bulkSelectAllLabel: 'Tout sélectionner',
      bulkSelectedCountSuffix: 'sélectionné(s)',
      bulkClearSelection: 'Désélectionner',
      bulkAssignAgentPlaceholder: 'Agent : inchangé',
      bulkUnassignedOption: 'Non assigné',
      bulkAssignGroupPlaceholder: 'Groupe : inchangé',
      bulkPriorityPlaceholder: 'Priorité : inchangée',
      bulkStatusPlaceholder: 'Statut : inchangé',
      bulkApplyAction: 'Appliquer au lot',
      bulkApplying: 'Application...',
      bulkQuickResolve: 'Résoudre',
      bulkQuickEscalate: 'Escalader',
      bulkSuccessNotice: 'Action groupée appliquée sur {count} ticket(s).',
      bulkSkippedClosedSuffix: '({skipped} clôturé(s) ignoré(s))',
      bulkAllClosedNotice: 'Les tickets clôturés ne peuvent pas être modifiés par lot.',
      priorityDropdownLabel: 'Priorité',
      prioritySelectedSuffix: 'sélectionnée(s)',
      priorityUrgentPreset: 'Urgents (Critique + Haute)',
      priorityClearSelection: 'Tout afficher',
      priorityMultiHint: 'Sélection multiple',
    },
    clients: {
      kpiNominal: 'Clients suivis · Nominal',
      kpiOutOfZone: 'Signaux hors zone réseau',
      kpiPasswordLocked: 'Mots de passe bloqués',
      kpiAvgAdoption: 'Utilisation moyenne plateforme',
      searchPlaceholder: 'Rechercher entreprise, contact, région...',
      filterAll: 'Tous les clients',
      filterAttention: 'Alertes actives',
      filterOutOfZone: 'Hors zone',
      filterPasswordLocked: 'Mot de passe bloqué',
      addClient: 'Ajouter un client',
      colClient: 'Client & Contact',
      colHealth: 'Situation état client',
      colAdoption: 'Usage plateforme',
      colLastCheck: 'Dernière vérification',
      colActions: 'Actions proactives',
      btnCard: 'Fiche',
      btnVerify: 'Vérifier situation',
      btnUnlock: 'Débloquer mot de passe',
      btnOutOfZone: 'Appel hors zone',
      ticketWord: 'ticket',
      callWord: 'appel',
      cardHeaderLabel: 'Fiche client',
      closeCardAria: 'Fermer la fiche client',
      adoptionLabel: 'Adoption plateforme',
      noVerification: 'Aucune vérification récente enregistrée.',
      interactionHistoryTitle: 'Historique des interactions',
      entryWord: 'entrée',
      linkedTickets: 'Tickets liés',
      activeWord: 'actif',
      voipCalls: 'Appels VoIP',
      lastTrace: 'Dernière trace',
      noneLabel: 'Aucune',
      tabAll: 'Tous',
      tabTickets: 'Tickets',
      tabCalls: 'Appels',
      noInteractionsTitle: 'Aucune interaction enregistrée',
      noTicketsHint: 'Aucun ticket lié à ce compte client.',
      noCallsHint: 'Aucun appel VoIP journalisé pour ce client.',
      noInteractionsHint: 'Les nouveaux tickets et appels liés à ce client apparaîtront ici en temps réel.',
      openTicket: 'Ouvrir',
      inboundCall: 'Appel entrant',
      outboundCall: 'Appel sortant',
      agentPrefix: 'Agent :',
      noCallNotes: 'Appel journalisé sans commentaire complémentaire.',
      showAllHistory: 'Afficher toutes les interactions',
      collapseHistory: 'Réduire l’historique',
    },
    kb: {
      title: 'Base de connaissances, Portail libre-service & Communauté',
      subtitle: 'Publiez des guides multilingues, déflectez les demandes via suggestions IA/mots-clés et animez les échanges communautaires.',
      tabArticles: 'Base de connaissances',
      tabPdfLibrary: 'Bibliothèque & Lecteur PDF',
      tabPortal: 'Portail libre-service',
      tabForum: 'Forums communautaires',
      newArticle: 'Nouvel article / FAQ',
      newTopic: 'Nouveau sujet',
      searchPlaceholder: 'Rechercher un guide, une FAQ ou une erreur...',
      suggestedArticles: 'Articles suggérés automatiquement pendant la saisie',
      deflectButton: 'Résolu grâce à cet article (Déflection)',
      portalHeading: 'Portail client en libre-service',
      portalSubtitle: 'Trouvez une réponse immédiate, suivez vos demandes SLA en direct ou soumettez un ticket.',
      forumHeading: 'Forum d’entraide clients & experts',
    },
    admin: {
      title: 'Intégrations API, Rôles RBAC & Conformité RGPD',
      subtitle: 'Connectez vos outils CRM/ERP/Jira, pilotez les droits d’accès granulaires et tracez les opérations de confidentialité.',
      tabMarketplace: 'Place de marché',
      tabWebhooks: 'API & Webhooks',
      tabRbac: 'Rôles & Langues',
      tabGdpr: 'Confidentialité RGPD & Audit',
      auditDashboardTitle: 'Tableau de bord Audit (30 derniers jours)',
      auditDashboardSubtitle: 'Distribution chronologique et par domaine des événements du journal immuable.',
      auditViewByDay: 'Par jour (30 j)',
      auditViewByCategory: 'Par catégorie',
      auditAllCategories: 'Toutes',
      auditMetricTotal30d: 'Événements (30 j)',
      auditMetricActorsSuffix: 'acteur(s) distinct(s)',
      auditMetricActiveDays: 'Jours avec activité',
      auditMetricPeakDay: 'Pic journalier',
      auditMetricTopCategory: 'Catégorie dominante',
      auditEmptyTitle: 'Aucun événement d’audit sur les 30 derniers jours',
      auditEmptyHint: 'Les actions RGPD, RBAC, webhooks, intégrations, QA et base de connaissances apparaîtront ici en temps réel.',
      auditFilterHint: 'Cliquez sur une catégorie pour filtrer le journal ci-dessous.',
      auditTooltipTotal: 'Total du jour',
      auditTooltipNoEvents: 'Aucun événement enregistré',
      slaPulseTitle: 'Seuil d’alerte visuelle SLA (sla-alert-pulse)',
      slaPulseSubtitle: 'Définit le pourcentage personnalisé déclenchant l’animation d’alerte visuelle sur les indicateurs SLA et la file des tickets.',
      slaPulseInputLabel: 'Seuil de déclenchement (%)',
      slaPulseActivePrefix: 'Seuil actif',
      slaPulsePreviewPill: 'Aperçu alerte',
      slaPulseSave: 'Enregistrer le seuil',
      slaPulseSaving: 'Sauvegarde...',
      slaPulseSavedNotice: 'Seuil d’alerte SLA enregistré à {pct}%. Les indicateurs visuels sont synchronisés.',
      slaPulseRangeError: 'Veuillez saisir un seuil entier compris entre 50% et 100%.',
      slaPulseRangeHint: 'Plage autorisée : 50% – 100% (défaut : 80%)',
    },
  },
  en: {
    navGroups: {
      operations: 'Support Operations',
      analytics: 'Performance & Workforce',
      ecosystem: 'Self-Service & Admin',
    },
    navItems: {
      tickets: 'Tickets & SLA',
      favorites: 'Favorites',
      clients: 'Proactive Client Health',
      collaboration: 'Channels, Chat & VoIP',
      analytics: 'Reports, QA & WFM',
      oncall: 'On-Call & Team Calendar',
      automation: 'AI & Automations',
      knowledge: 'Knowledge & Portal',
      integrations: 'Integrations & Admin',
    },
    header: {
      newTicket: 'New ticket',
      activeTickets: 'Active tickets',
      slaCompliance: 'SLA compliance',
      clientsAlert: 'Clients at risk',
      onCallNow: 'Active on-call',
      noShift: 'No active shift',
      language: 'Language',
      typography: 'Typography',
      darkMode: 'Dark mode',
      lightMode: 'Light mode',
      signOut: 'Sign out',
      signOutTooltip: 'Sign out',
      shortcuts: 'Keyboard shortcuts',
      floatingChat: 'Open chat',
      profileSettings: 'Profile & Theme',
      profileTooltip: 'Agent profile settings and automatic dark theme',
      fullscreen: 'Fullscreen',
      exitFullscreen: 'Exit fullscreen',
      teamActivity: 'Team activity',
      wsActive: 'WebSocket live',
      wsReconnecting: 'Reconnecting',
      agentsOnline: 'agent(s) online',
      initializing: 'Initializing ZentraDesk...',
      themeShortLabels: {
        light: 'Light',
        dark: 'Dark',
        system: 'Auto',
        schedule: '7pm–8am',
      },
    },
    toasts: {
      regionLabel: 'Real-time high-priority ticket alerts',
      criticalLabel: 'Critical Ticket (P1)',
      highLabel: 'High Priority Ticket',
      dismissAria: 'Dismiss notification',
      ignore: 'Dismiss',
      openTicket: 'Open ticket',
    },
    shortcutsModal: {
      closeAria: 'Close keyboard shortcuts',
      items: [
        ['Ctrl+K / Cmd+K', 'Focus global search bar (tickets, clients, KB)'],
        ['Ctrl+N / Alt+N', 'Open new ticket creation modal'],
        ['Alt+C', 'Toggle floating Team Chat & AI Assistant'],
        ['Alt+F', 'Toggle workspace fullscreen mode'],
        ['Alt+1 … Alt+3', 'Switch: Tickets (1), Clients (2), Channels & VoIP (3)'],
        ['Alt+4 … Alt+6', 'Switch: Analytics (4), On-Call (5), AI & Rules (6)'],
        ['Alt+7 / Alt+8', 'Switch: Knowledge Base (7), Integrations (8)'],
        ['Alt+9', 'Switch: Favorite tickets'],
        ['? or Ctrl+/', 'Show or hide this keyboard shortcuts guide'],
        ['Esc', 'Close active modal or exit fullscreen mode'],
      ],
    },
    search: {
      placeholder: 'Search tickets, clients, KB articles...',
      ariaLabel: 'Global search across tickets, clients, and knowledge base',
      clearAria: 'Clear search',
      resultsAria: 'Global search results',
      scopeAll: 'All',
      scopeTickets: 'Tickets',
      scopeClients: 'Clients',
      scopeKb: 'KB',
      navHint: '↑↓ navigate · Enter open',
      noResults: 'No results for',
      noResultsHint: 'Try a ticket reference (e.g. ZD-2041), client company name, or MFA / out-of-zone keyword.',
      openInTab: 'View all in tab',
      sectionTickets: 'Tickets & SLA',
      sectionClients: 'Client Accounts',
      sectionKb: 'Knowledge Base',
      viewsLabel: 'views',
    },
    tickets: {
      statusTabs: {
        all: 'All',
        active: 'Open',
        slaAlert: 'Alert',
        snoozed: 'Snoozed',
        escalated: 'Escalated',
        resolved: 'Resolved',
      },
      channelAll: 'Queue: All channels',
      channelEmailPortal: 'Queue: Email, Portal & Web',
      channelSocialChat: 'Queue: Live Chat & Social',
      channelVoiceTeam: 'Queue: VoIP, Slack/Teams & Alerts',
      favorites: 'Favorites',
      vipOnly: 'VIP only',
      quickPriority: 'Quick priority',
      resetFilters: 'Reset',
      allPriorities: 'All',
      priorityLabels: {
        critical: 'Critical',
        high: 'High',
        medium: 'Medium',
        low: 'Low',
      },
      supportLevel: 'Support tier',
      allLevels: 'All tiers',
      levelLabels: {
        n1: 'L1 Access',
        n2: 'L2 Platform',
        n3: 'L3 Infra',
        cti: 'Client Relations',
      },
      emptyFavoritesTitle: 'No favorite tickets',
      emptyViewTitle: 'No tickets in this view',
      emptyFavoritesHint: 'Click the star icon on a ticket to pin it to your favorites.',
      emptyViewHint: 'Adjust your filters or create a new customer support request.',
      seeAllTickets: 'Show all tickets',
      addFavoriteTooltip: 'Add to favorites',
      removeFavoriteTooltip: 'Remove from favorites',
      newTicketTitle: 'Create support ticket (AI Triage & SLA)',
      sentimentFilter: 'Client sentiment',
      allSentiments: 'All',
      sentimentTense: 'Tense',
      sentimentConcerned: 'Pressured',
      sentimentNeutral: 'Neutral',
      sentimentPositive: 'Positive',
      sortTenseFirst: 'Tense first',
      sentimentLabel: 'Detected sentiment',
      analyzeSentimentAi: 'Analyze sentiment AI',
      analyzingSentiment: 'Analyzing...',
      tensionScoreLabel: 'Tension',
      sentimentChartTitle: 'Support Emotional Load',
      sentimentChartSubtitle: 'Instant breakdown (click slice to filter)',
      sentimentChartPositive: 'Positive',
      sentimentChartNeutral: 'Neutral',
      sentimentChartTense: 'Tense',
      sentimentChartEmpty: 'No tickets to analyze',
      sentimentChartTicketsWord: 'tickets',
      queueSaturationTitle: 'Queue Saturation',
      queueSaturationSubtitle: 'Active load vs. historical group capacity (click to filter)',
      queueSaturationNominal: 'Nominal capacity',
      queueSaturationSaturatedLabel: 'Saturated',
      queueSaturationElevatedLabel: 'High load',
      queueSaturationNormalLabel: 'Nominal',
      queueSaturationSaturatedCountSuffix: 'saturated group(s)',
      queueSaturationElevatedCountSuffix: 'high load',
      queueSaturationRowTag: 'Queue saturated',
      queueSaturationCapShort: 'hist. cap.',
      generateAiReply: 'Generate AI reply',
      generatingAiReply: 'Generating...',
      aiDraftReadyLabel: 'Gemini draft ready',
      aiDraftSourcesLabel: 'KB sources:',
      aiDraftRegenerate: 'Regenerate',
      aiDraftClear: 'Clear',
      bulkSelectAllAria: 'Select all tickets in filtered list',
      bulkSelectRowAria: 'Select ticket',
      bulkSelectAllLabel: 'Select all',
      bulkSelectedCountSuffix: 'selected',
      bulkClearSelection: 'Clear',
      bulkAssignAgentPlaceholder: 'Agent: unchanged',
      bulkUnassignedOption: 'Unassigned',
      bulkAssignGroupPlaceholder: 'Group: unchanged',
      bulkPriorityPlaceholder: 'Priority: unchanged',
      bulkStatusPlaceholder: 'Status: unchanged',
      bulkApplyAction: 'Apply batch',
      bulkApplying: 'Applying...',
      bulkQuickResolve: 'Resolve',
      bulkQuickEscalate: 'Escalate',
      bulkSuccessNotice: 'Batch action applied to {count} ticket(s).',
      bulkSkippedClosedSuffix: '({skipped} closed skipped)',
      bulkAllClosedNotice: 'Closed tickets cannot be modified in batch.',
      priorityDropdownLabel: 'Priority',
      prioritySelectedSuffix: 'selected',
      priorityUrgentPreset: 'Urgent (Critical + High)',
      priorityClearSelection: 'Show all',
      priorityMultiHint: 'Multi-select',
    },
    clients: {
      kpiNominal: 'Monitored clients · Nominal',
      kpiOutOfZone: 'Out-of-zone signals',
      kpiPasswordLocked: 'Locked passwords',
      kpiAvgAdoption: 'Average platform usage',
      searchPlaceholder: 'Search company, contact, region...',
      filterAll: 'All clients',
      filterAttention: 'Active alerts',
      filterOutOfZone: 'Out of zone',
      filterPasswordLocked: 'Password locked',
      addClient: 'Add client',
      colClient: 'Client & Contact',
      colHealth: 'Client health status',
      colAdoption: 'Platform usage',
      colLastCheck: 'Last verification',
      colActions: 'Proactive actions',
      btnCard: 'Profile',
      btnVerify: 'Verify status',
      btnUnlock: 'Unlock password',
      btnOutOfZone: 'Out-of-zone call',
      ticketWord: 'ticket',
      callWord: 'call',
      cardHeaderLabel: 'Client profile',
      closeCardAria: 'Close client profile',
      adoptionLabel: 'Platform adoption',
      noVerification: 'No recent verification recorded.',
      interactionHistoryTitle: 'Interaction history',
      entryWord: 'entry',
      linkedTickets: 'Linked tickets',
      activeWord: 'active',
      voipCalls: 'VoIP calls',
      lastTrace: 'Last activity',
      noneLabel: 'None',
      tabAll: 'All',
      tabTickets: 'Tickets',
      tabCalls: 'Calls',
      noInteractionsTitle: 'No interactions recorded',
      noTicketsHint: 'No tickets linked to this client account.',
      noCallsHint: 'No VoIP calls logged for this client.',
      noInteractionsHint: 'New tickets and calls linked to this client will appear here in real time.',
      openTicket: 'Open',
      inboundCall: 'Inbound call',
      outboundCall: 'Outbound call',
      agentPrefix: 'Agent:',
      noCallNotes: 'Call logged without additional notes.',
      showAllHistory: 'Show all interactions',
      collapseHistory: 'Collapse history',
    },
    kb: {
      title: 'Knowledge Base, Self-Service Portal & Community',
      subtitle: 'Publish multilingual guides, deflect incoming tickets with real-time article suggestions, and host customer forums.',
      tabArticles: 'Knowledge Base',
      tabPdfLibrary: 'PDF Library & Reader',
      tabPortal: 'Self-Service Portal',
      tabForum: 'Community Forums',
      newArticle: 'New Article / FAQ',
      newTopic: 'New Topic',
      searchPlaceholder: 'Search guides, FAQs, or error codes...',
      suggestedArticles: 'Articles automatically suggested while typing',
      deflectButton: 'This solved my issue (Deflect ticket)',
      portalHeading: 'Customer Self-Service Portal',
      portalSubtitle: 'Find instant answers, track live SLA tickets, or submit a support request.',
      forumHeading: 'Customer & Expert Community Forum',
    },
    admin: {
      title: 'API Integrations, RBAC Roles & GDPR Privacy',
      subtitle: 'Connect CRM/ERP/Jira workflows, manage granular role permissions, and maintain an immutable compliance audit trail.',
      tabMarketplace: 'App Marketplace',
      tabWebhooks: 'API & Webhooks',
      tabRbac: 'Roles & Languages',
      tabGdpr: 'GDPR Privacy & Audit',
      auditDashboardTitle: 'Audit Dashboard (Last 30 Days)',
      auditDashboardSubtitle: 'Daily distribution and category breakdown of immutable audit log events.',
      auditViewByDay: 'By day (30d)',
      auditViewByCategory: 'By category',
      auditAllCategories: 'All',
      auditMetricTotal30d: 'Events (30d)',
      auditMetricActorsSuffix: 'distinct actor(s)',
      auditMetricActiveDays: 'Active days',
      auditMetricPeakDay: 'Daily peak',
      auditMetricTopCategory: 'Top category',
      auditEmptyTitle: 'No audit events in the last 30 days',
      auditEmptyHint: 'GDPR, RBAC, webhook, integration, QA, and knowledge base actions will appear here automatically.',
      auditFilterHint: 'Click any category to filter the audit log below.',
      auditTooltipTotal: 'Daily total',
      auditTooltipNoEvents: 'No events recorded',
      slaPulseTitle: 'SLA Visual Alert Threshold (sla-alert-pulse)',
      slaPulseSubtitle: 'Set the custom percentage threshold that triggers the visual alert pulse animation across SLA KPIs and ticket indicators.',
      slaPulseInputLabel: 'Trigger threshold (%)',
      slaPulseActivePrefix: 'Active threshold',
      slaPulsePreviewPill: 'Alert preview',
      slaPulseSave: 'Save threshold',
      slaPulseSaving: 'Saving...',
      slaPulseSavedNotice: 'SLA alert threshold saved at {pct}%. Visual indicators are now synchronized.',
      slaPulseRangeError: 'Please enter a whole threshold between 50% and 100%.',
      slaPulseRangeHint: 'Allowed range: 50% – 100% (default: 80%)',
    },
  },
  es: {
    navGroups: {
      operations: 'Operaciones de Soporte',
      analytics: 'Rendimiento y WFM',
      ecosystem: 'Autoservicio y Admin',
    },
    navItems: {
      tickets: 'Tickets y SLA',
      favorites: 'Favoritos',
      clients: 'Seguimiento Proactivo',
      collaboration: 'Canales, Chat y VoIP',
      analytics: 'Informes, QA y WFM',
      oncall: 'Guardias y Calendario',
      automation: 'IA y Automatización',
      knowledge: 'Base de Conocimiento',
      integrations: 'Integraciones y Admin',
    },
    header: {
      newTicket: 'Nuevo ticket',
      activeTickets: 'Tickets activos',
      slaCompliance: 'Cumplimiento SLA',
      clientsAlert: 'Clientes en alerta',
      onCallNow: 'Guardia activa',
      noShift: 'Sin turno activo',
      language: 'Idioma',
      typography: 'Tipografía',
      darkMode: 'Modo oscuro',
      lightMode: 'Modo claro',
      signOut: 'Salir',
      signOutTooltip: 'Cerrar sesión',
      shortcuts: 'Atajos de teclado',
      floatingChat: 'Abrir chat',
      profileSettings: 'Perfil y Tema',
      profileTooltip: 'Configuración de perfil del agente y tema automático',
      fullscreen: 'Pantalla completa',
      exitFullscreen: 'Salir de pantalla completa',
      teamActivity: 'Actividad del equipo',
      wsActive: 'WebSocket activo',
      wsReconnecting: 'Reconectando',
      agentsOnline: 'agente(s) en línea',
      initializing: 'Inicializando ZentraDesk...',
      themeShortLabels: {
        light: 'Claro',
        dark: 'Oscuro',
        system: 'Auto',
        schedule: '19h–8h',
      },
    },
    toasts: {
      regionLabel: 'Alertas en tiempo real de tickets urgentes',
      criticalLabel: 'Ticket Crítico (P1)',
      highLabel: 'Ticket Prioridad Alta',
      dismissAria: 'Cerrar notificación',
      ignore: 'Ignorar',
      openTicket: 'Abrir ticket',
    },
    shortcutsModal: {
      closeAria: 'Cerrar atajos de teclado',
      items: [
        ['Ctrl+K / Cmd+K', 'Activar barra de búsqueda global (tickets, clientes, KB)'],
        ['Ctrl+N / Alt+N', 'Abrir modal de creación de ticket'],
        ['Alt+C', 'Abrir / Cerrar chat flotante y agente IA'],
        ['Alt+F', 'Activar / Salir del modo pantalla completa'],
        ['Alt+1 … Alt+3', 'Cambiar: Tickets (1), Clientes (2), Canales y VoIP (3)'],
        ['Alt+4 … Alt+6', 'Cambiar: Informes (4), Guardias (5), IA y Reglas (6)'],
        ['Alt+7 / Alt+8', 'Cambiar: Base de Conocimiento (7), Integraciones (8)'],
        ['Alt+9', 'Cambiar: Tickets favoritos'],
        ['? o Ctrl+/', 'Mostrar esta guía de atajos de teclado'],
        ['Esc', 'Cerrar ventana activa o salir de pantalla completa'],
      ],
    },
    search: {
      placeholder: 'Buscar tickets, clientes, artículos KB...',
      ariaLabel: 'Búsqueda global en tickets, clientes y base de conocimiento',
      clearAria: 'Limpiar búsqueda',
      resultsAria: 'Resultados de búsqueda global',
      scopeAll: 'Todo',
      scopeTickets: 'Tickets',
      scopeClients: 'Clientes',
      scopeKb: 'Base KB',
      navHint: '↑↓ navegar · Enter abrir',
      noResults: 'Sin resultados para',
      noResultsHint: 'Prueba una referencia (ej. ZD-2041), empresa cliente o palabra clave MFA.',
      openInTab: 'Ver todo en pestaña',
      sectionTickets: 'Tickets y SLA',
      sectionClients: 'Cuentas de clientes',
      sectionKb: 'Base de conocimiento',
      viewsLabel: 'vistas',
    },
    tickets: {
      statusTabs: {
        all: 'Todos',
        active: 'Abiertos',
        slaAlert: 'Alerta',
        snoozed: 'Pospuestos',
        escalated: 'Escalados',
        resolved: 'Resueltos',
      },
      channelAll: 'Cola: Todos los canales',
      channelEmailPortal: 'Cola: Email, Portal y Web',
      channelSocialChat: 'Cola: Chat y Redes sociales',
      channelVoiceTeam: 'Cola: VoIP, Slack/Teams y Alertas',
      favorites: 'Favoritos',
      vipOnly: 'Solo VIP',
      quickPriority: 'Prioridad rápida',
      resetFilters: 'Restablecer',
      allPriorities: 'Todas',
      priorityLabels: {
        critical: 'Crítica',
        high: 'Alta',
        medium: 'Media',
        low: 'Baja',
      },
      supportLevel: 'Nivel de soporte',
      allLevels: 'Todos los niveles',
      levelLabels: {
        n1: 'N1 Acceso',
        n2: 'N2 Plataforma',
        n3: 'N3 Infra',
        cti: 'Relación Cliente',
      },
      emptyFavoritesTitle: 'Sin tickets favoritos',
      emptyViewTitle: 'No hay tickets en esta vista',
      emptyFavoritesHint: 'Pulsa la estrella de un ticket para fijarlo en favoritos.',
      emptyViewHint: 'Ajusta los filtros o crea una nueva solicitud.',
      seeAllTickets: 'Ver todos los tickets',
      addFavoriteTooltip: 'Añadir a favoritos',
      removeFavoriteTooltip: 'Quitar de favoritos',
      newTicketTitle: 'Crear ticket de soporte (IA y SLA)',
      sentimentFilter: 'Sentimiento del cliente',
      allSentiments: 'Todos',
      sentimentTense: 'Tensos',
      sentimentConcerned: 'Bajo presión',
      sentimentNeutral: 'Neutrales',
      sentimentPositive: 'Positivos',
      sortTenseFirst: 'Tensos primero',
      sentimentLabel: 'Sentimiento detectado',
      analyzeSentimentAi: 'Analizar sentimiento IA',
      analyzingSentiment: 'Analizando...',
      tensionScoreLabel: 'Tensión',
      sentimentChartTitle: 'Carga emocional del soporte',
      sentimentChartSubtitle: 'Distribución instantánea (clic para filtrar)',
      sentimentChartPositive: 'Positivo',
      sentimentChartNeutral: 'Neutral',
      sentimentChartTense: 'Tenso',
      sentimentChartEmpty: 'Sin tickets para analizar',
      sentimentChartTicketsWord: 'tickets',
      queueSaturationTitle: 'Saturación de cola',
      queueSaturationSubtitle: 'Volumen activo frente a capacidad histórica (clic para filtrar)',
      queueSaturationNominal: 'Capacidad nominal',
      queueSaturationSaturatedLabel: 'Saturado',
      queueSaturationElevatedLabel: 'Tensión',
      queueSaturationNormalLabel: 'Nominal',
      queueSaturationSaturatedCountSuffix: 'grupo(s) saturado(s)',
      queueSaturationElevatedCountSuffix: 'bajo tensión',
      queueSaturationRowTag: 'Cola saturada',
      queueSaturationCapShort: 'cap. hist.',
      generateAiReply: 'Generar respuesta IA',
      generatingAiReply: 'Generando...',
      aiDraftReadyLabel: 'Borrador Gemini listo',
      aiDraftSourcesLabel: 'Fuentes KB:',
      aiDraftRegenerate: 'Regenerar',
      aiDraftClear: 'Limpiar',
      bulkSelectAllAria: 'Seleccionar todos los tickets filtrados',
      bulkSelectRowAria: 'Seleccionar ticket',
      bulkSelectAllLabel: 'Seleccionar todo',
      bulkSelectedCountSuffix: 'seleccionado(s)',
      bulkClearSelection: 'Limpiar',
      bulkAssignAgentPlaceholder: 'Agente: sin cambios',
      bulkUnassignedOption: 'Sin asignar',
      bulkAssignGroupPlaceholder: 'Grupo: sin cambios',
      bulkPriorityPlaceholder: 'Prioridad: sin cambios',
      bulkStatusPlaceholder: 'Estado: sin cambios',
      bulkApplyAction: 'Aplicar lote',
      bulkApplying: 'Aplicando...',
      bulkQuickResolve: 'Resolver',
      bulkQuickEscalate: 'Escalar',
      bulkSuccessNotice: 'Acción masiva aplicada a {count} ticket(s).',
      bulkSkippedClosedSuffix: '({skipped} cerrado(s) omitido(s))',
      bulkAllClosedNotice: 'Los tickets cerrados no se pueden modificar en lote.',
      priorityDropdownLabel: 'Prioridad',
      prioritySelectedSuffix: 'seleccionada(s)',
      priorityUrgentPreset: 'Urgentes (Crítica + Alta)',
      priorityClearSelection: 'Mostrar todas',
      priorityMultiHint: 'Selección múltiple',
    },
    clients: {
      kpiNominal: 'Clientes seguidos · Nominal',
      kpiOutOfZone: 'Señales fuera de zona',
      kpiPasswordLocked: 'Contraseñas bloqueadas',
      kpiAvgAdoption: 'Uso medio plataforma',
      searchPlaceholder: 'Buscar empresa, contacto, región...',
      filterAll: 'Todos los clientes',
      filterAttention: 'Alertas activas',
      filterOutOfZone: 'Fuera de zona',
      filterPasswordLocked: 'Contraseña bloqueada',
      addClient: 'Añadir cliente',
      colClient: 'Cliente y Contacto',
      colHealth: 'Estado del cliente',
      colAdoption: 'Uso plataforma',
      colLastCheck: 'Última verificación',
      colActions: 'Acciones proactivas',
      btnCard: 'Ficha',
      btnVerify: 'Verificar estado',
      btnUnlock: 'Desbloquear clave',
      btnOutOfZone: 'Llamada fuera zona',
      ticketWord: 'ticket',
      callWord: 'llamada',
      cardHeaderLabel: 'Ficha de cliente',
      closeCardAria: 'Cerrar ficha de cliente',
      adoptionLabel: 'Adopción de plataforma',
      noVerification: 'Sin verificación reciente registrada.',
      interactionHistoryTitle: 'Historial de interacciones',
      entryWord: 'registro',
      linkedTickets: 'Tickets vinculados',
      activeWord: 'activo',
      voipCalls: 'Llamadas VoIP',
      lastTrace: 'Última actividad',
      noneLabel: 'Ninguna',
      tabAll: 'Todos',
      tabTickets: 'Tickets',
      tabCalls: 'Llamadas',
      noInteractionsTitle: 'Sin interacciones registradas',
      noTicketsHint: 'No hay tickets vinculados a este cliente.',
      noCallsHint: 'No hay llamadas VoIP registradas para este cliente.',
      noInteractionsHint: 'Los nuevos tickets y llamadas aparecerán aquí en tiempo real.',
      openTicket: 'Abrir',
      inboundCall: 'Llamada entrante',
      outboundCall: 'Llamada saliente',
      agentPrefix: 'Agente:',
      noCallNotes: 'Llamada registrada sin comentarios adicionales.',
      showAllHistory: 'Mostrar todo el historial',
      collapseHistory: 'Contraer historial',
    },
    kb: {
      title: 'Base de Conocimiento, Portal Autoservicio y Comunidad',
      subtitle: 'Publica guías multilingües, reduce tickets con sugerencias en vivo y gestiona foros comunitarios.',
      tabArticles: 'Base de Conocimiento',
      tabPdfLibrary: 'Biblioteca y Lector PDF',
      tabPortal: 'Portal Autoservicio',
      tabForum: 'Foros Comunitarios',
      newArticle: 'Nuevo artículo / FAQ',
      newTopic: 'Nuevo tema',
      searchPlaceholder: 'Buscar guías, preguntas frecuentes o errores...',
      suggestedArticles: 'Artículos sugeridos automáticamente al escribir',
      deflectButton: 'Resuelto con este artículo (Deflexión)',
      portalHeading: 'Portal de autoservicio para clientes',
      portalSubtitle: 'Encuentra respuestas inmediatas, sigue tus tickets SLA o envía una solicitud.',
      forumHeading: 'Foro comunitario de clientes y expertos',
    },
    admin: {
      title: 'Integraciones API, Roles RBAC y Privacidad RGPD',
      subtitle: 'Conecta herramientas CRM/ERP/Jira, configura permisos granulares y registra la auditoría de privacidad.',
      tabMarketplace: 'Mercado de Apps',
      tabWebhooks: 'API y Webhooks',
      tabRbac: 'Roles e Idiomas',
      tabGdpr: 'Privacidad RGPD y Auditoría',
      auditDashboardTitle: 'Panel de Auditoría (Últimos 30 días)',
      auditDashboardSubtitle: 'Distribución diaria y por categoría de los eventos del registro inmutable.',
      auditViewByDay: 'Por día (30 d)',
      auditViewByCategory: 'Por categoría',
      auditAllCategories: 'Todas',
      auditMetricTotal30d: 'Eventos (30 d)',
      auditMetricActorsSuffix: 'actor(es) distinto(s)',
      auditMetricActiveDays: 'Días con actividad',
      auditMetricPeakDay: 'Pico diario',
      auditMetricTopCategory: 'Categoría principal',
      auditEmptyTitle: 'Sin eventos de auditoría en los últimos 30 días',
      auditEmptyHint: 'Las acciones de RGPD, RBAC, webhooks, integraciones, QA y base KB aparecerán aquí automáticamente.',
      auditFilterHint: 'Haz clic en una categoría para filtrar el registro inferior.',
      auditTooltipTotal: 'Total del día',
      auditTooltipNoEvents: 'Sin eventos registrados',
      slaPulseTitle: 'Umbral de alerta visual SLA (sla-alert-pulse)',
      slaPulseSubtitle: 'Define el porcentaje personalizado que activa la animación de alerta visual en los indicadores SLA y la cola de tickets.',
      slaPulseInputLabel: 'Umbral de activación (%)',
      slaPulseActivePrefix: 'Umbral activo',
      slaPulsePreviewPill: 'Vista previa alerta',
      slaPulseSave: 'Guardar umbral',
      slaPulseSaving: 'Guardando...',
      slaPulseSavedNotice: 'Umbral de alerta SLA guardado en {pct}%. Los indicadores visuales están sincronizados.',
      slaPulseRangeError: 'Introduce un umbral entero entre 50% y 100%.',
      slaPulseRangeHint: 'Rango permitido: 50% – 100% (por defecto: 80%)',
    },
  },
};

export function loadSavedLocale(): AppLocale {
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isValidLocale(raw)) return raw;
  } catch {
    // Ignore storage read errors
  }
  return 'fr';
}

export function saveLocale(locale: AppLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage write errors
  }
}
