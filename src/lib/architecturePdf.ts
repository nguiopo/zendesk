import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface StakeholderRoleItem {
  actor: string;
  category: 'Humain / Metier' | 'Moteur IA / Service' | 'Donnees & Infra';
  responsibilities: string;
  modules: string;
}

export interface FeatureFlowItem {
  id: string;
  module: string;
  feature: string;
  stakeholders: string;
  executionFlow: string;
  dataAndServices: string;
}

export interface TechnicalCrossFlowItem {
  flowName: string;
  trigger: string;
  pipeline: string;
  actorsInvolved: string;
  safeguards: string;
}

export const PLATFORM_STAKEHOLDERS: StakeholderRoleItem[] = [
  {
    actor: 'Client final / Contact entreprise',
    category: 'Humain / Metier',
    responsibilities:
      'Soumet des demandes multicanales (email, portail, tchat, VoIP), consulte la base KB en libre-service, evalue la resolution (CSAT) et participe au forum.',
    modules: 'Tickets, Portail Libre-Service, Forum, CSAT, Chatbot',
  },
  {
    actor: 'Agent Support N1 (Acces & Comptes)',
    category: 'Humain / Metier',
    responsibilities:
      'Traite la file entrante, dicte les tickets par voix, debloque les mots de passe/MFA, verifie la situation client et applique les macros/reponses types.',
    modules: 'Tickets & SLA, Suivi Proactif Clients, Tchat & VoIP, Base KB',
  },
  {
    actor: 'Agent Support N2 (Plateforme)',
    category: 'Humain / Metier',
    responsibilities:
      'Diagnostique les anomalies applicatives, utilise le Copilote et le Resume IA, fusionne/fractionne les tickets complexes et enrichit les guides KB/PDF.',
    modules: 'Tickets & SLA, Base KB & Lecteur PDF, Collaboration',
  },
  {
    actor: 'Ingenieur Astreinte / N3 Infrastructure',
    category: 'Humain / Metier',
    responsibilities:
      'Prend en charge les escalades critiques (P1) et incidents hors-zone, consigne les rapports d astreinte et transmet les points de releve.',
    modules: 'Astreintes & Dispos, Tickets P1, Automatisation',
  },
  {
    actor: 'Specialiste CTI & Relation Client',
    category: 'Humain / Metier',
    responsibilities:
      'Gere les appels VoIP entrants/sortants, journalise les rappels hors-zone et assure la continuite de l historique client.',
    modules: 'Canaux, Tchat & VoIP, Suivi Proactif Clients',
  },
  {
    actor: 'Superviseur / Team Lead Support',
    category: 'Humain / Metier',
    responsibilities:
      'Pilote les KPIs temps reel (Volume, MTTR, CSAT, SLA), surveille la repartition emotionnelle (Positif/Neutre/Tendu), evalue la qualite QA, planifie le WFM et genere/archive les rapports hebdomadaires et mensuels PDF.',
    modules: 'Tickets (Vue Supervision), Rapports, Qualite & WFM, Astreintes',
  },
  {
    actor: 'Administrateur Plateforme & DPO',
    category: 'Humain / Metier',
    responsibilities:
      'Configure les regles RBAC, la retention/anonymisation RGPD, les connecteurs CRM/ERP/Jira, les webhooks API et audite les journaux immuables.',
    modules: 'Integrations & Admin, Profil & Langue, Regles Securite',
  },
  {
    actor: 'Moteur IA Gemini (Proxy Serveur)',
    category: 'Moteur IA / Service',
    responsibilities:
      'Execute le triage automatique, l analyse de sentiment, la redaction de reponses, le copilote, le resume conversationnel, le diagnostic analytique et la synthese PDF->KB.',
    modules: 'Proxy /api/ai/* (@google/genai)',
  },
  {
    actor: 'Serveur Express & WebSocket',
    category: 'Donnees & Infra',
    responsibilities:
      'Sert l API REST securisee (IA, test webhooks anti-SSRF) et diffuse la presence temps reel, les indicateurs de saisie et le tchat d equipe via WebSocket.',
    modules: 'server.ts, /api/*, /ws',
  },
  {
    actor: 'Firebase Auth & Cloud Firestore',
    category: 'Donnees & Infra',
    responsibilities:
      'Authentifie les intervenants, isole les donnees PII, persiste les collections metier en temps reel (onSnapshot) et applique les regles RBAC/validation.',
    modules: 'Auth, Firestore, Regles firestore.rules',
  },
];

export const PLATFORM_FEATURES_INVENTORY: FeatureFlowItem[] = [
  {
    id: 'F-01',
    module: '1. Tickets & SLA',
    feature: 'Creation de ticket, dictee vocale Web Speech & deflection KB',
    stakeholders: 'Agent Support N1/N2, Client final, Moteur IA Gemini, Firestore',
    executionFlow:
      '1) L agent ouvre le modal (bouton ou Ctrl+N) et saisit ou dicte la description via Web Speech API (fr-FR/en-US/es-ES). 2) Des suggestions KB temps reel proposent une deflection immediate. 3) A la soumission, /api/ai/triage classe priorite/categorie/groupe/agent si active. 4) Le ticket + 1er TicketEvent sont ecrits dans Firestore avec echeances SLA.',
    dataAndServices: 'TicketsView, VoiceDictationModule, /api/ai/triage, tickets/{id}/events',
  },
  {
    id: 'F-02',
    module: '1. Tickets & SLA',
    feature: 'Filtrage rapide par priorite, niveau de support & vues sauvegardees',
    stakeholders: 'Agent Support N1/N2/N3, Superviseur',
    executionFlow:
      '1) L utilisateur active les filtres rapides de priorite (Critique, Haute, Moyenne, Basse) et de niveau (N1, N2, N3, Relation Client) ou une vue sauvegardee. 2) Le moteur memoise calcule les compteurs dynamiques et filtre la file instantanement. 3) Les vues personnalisees sont persistees localement.',
    dataAndServices: 'TicketsView, savedViews (localStorage)',
  },
  {
    id: 'F-03',
    module: '1. Tickets & SLA',
    feature: 'Analyse de sentiment du contenu & graphique en secteurs (Pie Chart)',
    stakeholders: 'Agent Support, Superviseur, Moteur IA Gemini, Firestore',
    executionFlow:
      '1) Le moteur local evalue en continu le sujet, la description et les echanges pour calculer un score de tension et afficher un indicateur couleur/emoji a cote du sujet (Positif, Neutre, Sous pression, Tendu). 2) Le graphique en secteurs Recharts agrege la repartition Positif / Neutre / Tendu et permet un clic-filtre. 3) L agent peut declencher une re-analyse Gemini (/api/ai/sentiment) persistee dans aiSentiment.',
    dataAndServices: 'sentiment.ts, TicketsView (Recharts PieChart), /api/ai/sentiment, tickets/{id}.aiSentiment',
  },
  {
    id: 'F-04',
    module: '1. Tickets & SLA',
    feature: 'Notifications toast temps reel pour tickets haute priorite / critiques',
    stakeholders: 'Agents connectes, Superviseur, Cloud Firestore (onSnapshot)',
    executionFlow:
      '1) A la creation d un ticket de priorite high ou critical dans Firestore (hors initialisation/seeding), le listener onSnapshot de App.tsx detecte docChanges() de type added. 2) Une alerte toast animee (auto-fermeture 9.5s) s affiche en haut a droite avec action directe "Ouvrir le ticket".',
    dataAndServices: 'App.tsx (HighPriorityTicketToast), listener tickets',
  },
  {
    id: 'F-05',
    module: '1. Tickets & SLA',
    feature: 'Alertes SLA >80%, attribution Round-Robin, macros, fusion/fractionnement & favoris',
    stakeholders: 'Agent Support, Superviseur, Firestore, WebSocket',
    executionFlow:
      '1) Un timer 30s recalcule la consommation SLA et active le badge alerte >80%. 2) Les actions workbench (macros reponse+statut+tag, Round-Robin par charge/groupe, Snooze, Fusion/Sous-ticket, Etoile favori) mettent a jour Firestore, journalisent un TicketEvent interne et diffusent l activite en WebSocket.',
    dataAndServices: 'formatters.ts, TicketsView, tickets/{id}, useCollaborationSocket',
  },
  {
    id: 'F-06',
    module: '1. Tickets & SLA',
    feature: 'Copilote IA, redaction assistee & resume de conversation',
    stakeholders: 'Agent Support N1/N2, Moteur IA Gemini, Serveur Express',
    executionFlow:
      '1) L agent sollicite le Copilote (/api/ai/copilot), la redaction (/api/ai/draft-reply) ou le Resume (/api/ai/summarize-conversation). 2) Le backend interroge Gemini avec le contexte ticket + 8 derniers evenements + articles KB. 3) Le resultat peut etre insere dans l editeur ou consigne en note interne.',
    dataAndServices: 'server.ts (/api/ai/*), TicketsView, tickets/{id}/events',
  },
  {
    id: 'F-07',
    module: '2. Suivi Proactif Clients',
    feature: 'Monitoring sante client, deblocage mot de passe & appel hors zone',
    stakeholders: 'Agent Support N1, Specialiste CTI, Client final, Firestore',
    executionFlow:
      '1) La vue liste l etat de sante (Nominal, Degrade, Hors zone, Mot de passe bloque, Critique) et le taux d adoption. 2) Les actions 1-clic "Verifier situation", "Debloquer mot de passe" ou "Appel hors zone" mettent a jour clients/{id}, incrementent les compteurs agent et creent un log VoIP/note.',
    dataAndServices: 'ProactiveClientsView, clients/{id}, agents/{id}, callLogs',
  },
  {
    id: 'F-08',
    module: '2. Suivi Proactif Clients',
    feature: 'Fiche client & Historique des interactions (tickets et appels)',
    stakeholders: 'Agent Support, Superviseur, Specialiste CTI, Firestore',
    executionFlow:
      '1) Au clic sur "Fiche", le tiroir extrait dynamiquement tous les tickets (clientId) et appels VoIP (callLogs) lies au client. 2) Une timeline chronologique fusionnee filtrable (Tous / Tickets / Appels) permet de consulter les notes d appel ou d ouvrir directement un ticket.',
    dataAndServices: 'ProactiveClientsView, tickets, callLogs',
  },
  {
    id: 'F-09',
    module: '3. Canaux, Tchat & VoIP',
    feature: 'Collaboration WebSocket temps reel, presence & detection de collision',
    stakeholders: 'Agents Support, Superviseur, Serveur Express WebSocket',
    executionFlow:
      '1) Chaque session connectee maintient un socket /ws envoyant presence_update (ticket actif, etat de saisie). 2) Le serveur diffuse presence_state a toute l equipe. 3) TicketsView affiche une banniere de collision si un collegue consulte ou redige deja sur le meme ticket.',
    dataAndServices: 'server.ts (WebSocketServer), useCollaborationSocket.ts, CollaborationCallView',
  },
  {
    id: 'F-10',
    module: '3. Canaux, Tchat & VoIP',
    feature: 'Console VoIP / CTI & widget Chatbot IA flottant avec transfert humain',
    stakeholders: 'Client final, Specialiste CTI, Agent Support, Moteur IA Gemini',
    executionFlow:
      '1) Le journal CTI enregistre les appels entrants/sortants et leur issue (repondu, manque, hors_zone, rappel) lies a un ticket. 2) Le widget flottant (Alt+C) combine tchat equipe et assistant IA (/api/ai/chatbot) capable d escalader vers un ticket humain.',
    dataAndServices: 'CollaborationCallView, FloatingChatWidget, /api/ai/chatbot, callLogs',
  },
  {
    id: 'F-11',
    module: '4. Rapports, Qualite & WFM',
    feature: 'Tableau de bord KPIs temps reel (Volume, MTTR, CSAT, Conformite SLA)',
    stakeholders: 'Superviseur, Direction Support, Firestore',
    executionFlow:
      '1) CapacityAnalyticsView agrege en direct les collections tickets, slaPolicies, csatSurveys et agents. 2) Il calcule le volume total/ouvert/resolu, le MTTR compare a la cible SLA, le CSAT moyen et le taux de charge equipe avec rendu synchrone.',
    dataAndServices: 'CapacityAnalyticsView (realtimeKpis), tickets, csatSurveys, agents',
  },
  {
    id: 'F-12',
    module: '4. Rapports, Qualite & WFM',
    feature: 'Generation automatisee de rapports hebdomadaires SLA & tickets critiques + Export PDF',
    stakeholders: 'Superviseur, Administrateur, Cloud Firestore, Moteur PDF jsPDF',
    executionFlow:
      '1) Lorsque l automatisation hebdomadaire est activee, App.tsx detecte l absence de snapshot pour la semaine ISO en cours et cree automatiquement le document dans weeklyReports (conformite SLA, MTTR, liste des tickets critiques P1 et depassements SLA). 2) Le superviseur peut consulter l archive Firestore, regenerer a la demande et exporter chaque rapport en PDF multi-sections.',
    dataAndServices: 'App.tsx, CapacityAnalyticsView, pdfExport.ts, weeklyReports/{id}',
  },
  {
    id: 'F-13',
    module: '4. Rapports, Qualite & WFM',
    feature: 'Bilans mensuels PDF/CSV, annotations graphiques, QA, CSAT & Planning WFM',
    stakeholders: 'Superviseur, Agent Support, Moteur IA Gemini, Firestore',
    executionFlow:
      '1) Le superviseur annote les pics sur les graphiques (chartAnnotations), evalue la qualite QA (4 criteres /100), suit les retours CSAT et ajuste les shifts WFM + adherence. 2) Il exporte un bilan mensuel PDF (incluant la synthese IA /api/ai/analytics-brief) ou CSV.',
    dataAndServices: 'CapacityAnalyticsView, QualityWfmReportsTabs, ChartAnnotationsSection, pdfExport.ts',
  },
  {
    id: 'F-14',
    module: '5. Astreintes & Dispos',
    feature: 'Planification astreintes, conges equipe, tendance 30j & export PDF archive',
    stakeholders: 'Ingenieur Astreinte N3, Superviseur, Firestore, Moteur PDF jsPDF',
    executionFlow:
      '1) Gestion des creneaux d astreinte (onCallShifts) et absences (agentLeaves) avec controle de disponibilite. 2) Saisie continue des incidents et points de releve via OnCallReportModal (onCallReports). 3) Graphique Recharts 30 jours des incidents resolus et export PDF du rapport de shift ou de l archive complete.',
    dataAndServices: 'OnCallScheduleView, OnCallReportModal, OnCallResolvedTrendChart, pdfExport.ts',
  },
  {
    id: 'F-15',
    module: '6. IA & Automatisations',
    feature: 'Regles d automatisation evenementielles & detection d incidents recurrents',
    stakeholders: 'Superviseur, Administrateur, Moteur IA, Firestore',
    executionFlow:
      '1) Definition de regles (ticket_created, client_reply, field_changed, sla_warning) ciblant une categorie et un groupe. 2) Les declencheurs automatiques escaladent ou creent un incident parent recurrent et incrementent triggeredCount.',
    dataAndServices: 'AiAutomationView, automationRules/{id}',
  },
  {
    id: 'F-16',
    module: '7. Connaissances & Portail',
    feature: 'Base KB multilingue, Lecteur PDF + synthese IA, Portail & Forum',
    stakeholders: 'Client final, Agent Support N1/N2, Moteur IA Gemini, IndexedDB/Firestore',
    executionFlow:
      '1) Publication d articles/FAQ (FR/EN/ES) consultables sur le portail libre-service et le forum. 2) Le module Bibliotheque PDF stocke le binaire localement (IndexedDB) et l extrait texte/notes dans Firestore (kbPdfDocuments), avec bouton de synthese IA (/api/ai/pdf-to-kb) convertissant un manuel PDF en article KB.',
    dataAndServices: 'KnowledgePortalView, KbPdfLibraryPanel, pdfLocalStore.ts, /api/ai/pdf-to-kb',
  },
  {
    id: 'F-17',
    module: '8. Admin, RBAC, RGPD & UX',
    feature: 'Authentification Firebase, RBAC, RGPD, Webhooks anti-SSRF, Langue FR/EN & Themes',
    stakeholders: 'Administrateur, DPO, Tous les agents, Firebase Auth & Express',
    executionFlow:
      '1) Auth Firebase email-verifie avec isolation PII (/users/{uid}/private/info). 2) Matrice RBAC, retention/anonymisation RGPD et journal d audit immuable (auditLogs). 3) Testeur webhooks bloque les IP privees/locales cote serveur (/api/webhooks/test). 4) Selecteur de langue FR/EN persistant (menu lateral + Firestore) et themes Clair/Sombre/Auto/Horaire.',
    dataAndServices: 'IntegrationsAdminView, AgentProfileModal, App.tsx, i18n.ts, server.ts',
  },
];

export const TECHNICAL_CROSS_FLOWS: TechnicalCrossFlowItem[] = [
  {
    flowName: 'Flux Temps Reel & Alertes',
    trigger: 'Ecriture Firestore (create/update ticket, appel, rapport)',
    pipeline:
      'SDK Client -> Regles Firestore (validation 8 Piliers) -> onSnapshot -> Mise a jour React + Toast P1/Haute priorite',
    actorsInvolved: 'Agent createur, Firebase Firestore, Tous clients abonnes',
    safeguards: 'Email verifie requis, bornes strictes de champs, anti-doublon seedingRef/seenTicketIdsRef',
  },
  {
    flowName: 'Flux Collaboratif WebSocket',
    trigger: 'Selection ticket ou frappe dans le compositeur',
    pipeline:
      'Client React (useCollaborationSocket) -> ws://.../ws -> Serveur Express -> Broadcast presence_state / chat / activite',
    actorsInvolved: 'Agents connectes, Serveur Node/Express',
    safeguards: 'Reconnexion exponentielle automatique, absence de stockage secret en memoire client',
  },
  {
    flowName: 'Flux Intelligence Artificielle',
    trigger: 'Clic Triage, Sentiment, Copilote, Resume, Brief analytique ou PDF->KB',
    pipeline:
      'Composant React -> POST /api/ai/* (Express) -> Validation payload -> SDK @google/genai (Gemini) -> JSON structure',
    actorsInvolved: 'Agent/Superviseur, Serveur Express, API Gemini',
    safeguards: 'Cle GEMINI_API_KEY strictement cote serveur, reponse JSON schematisee, fallback propre en erreur',
  },
  {
    flowName: 'Flux Reporting & Export PDF',
    trigger: 'Ouverture session (auto hebdo) ou clic export PDF',
    pipeline:
      'Agregation tickets/SLA/CSAT/astreintes -> Persistance weeklyReports (Firestore) -> Mise en page jsPDF + autoTable -> Telechargement .pdf',
    actorsInvolved: 'Superviseur, App.tsx, CapacityAnalyticsView, OnCallScheduleView, Firestore',
    safeguards: 'Normalisation Latin-1 toPdfText(), pagination automatique et pieds de page horodates',
  },
];

function toPdfSafe(input: string): string {
  return String(input ?? '')
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00B7/g, '|')
    .replace(/\u2026/g, '...')
    .replace(/\u0153/g, 'oe')
    .replace(/\u0152/g, 'OE')
    .replace(/\u2192/g, '->');
}

export function buildPlatformArchitecturePdfDoc(generatedBy = 'Superviseur ZentraDesk'): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;

  // Header Banner
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 32, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(
    toPdfSafe("ZentraDesk - Referentiel des Fonctionnalites, Flux d'Execution & Intervenants"),
    margin,
    13
  );

  const generatedAt = new Date().toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    toPdfSafe(
      `Architecture & Cartographie Operationnelle  |  8 Modules  |  ${PLATFORM_FEATURES_INVENTORY.length} Fonctionnalites  |  ${PLATFORM_STAKEHOLDERS.length} Intervenants  |  Genere par : ${generatedBy} (${generatedAt})`
    ),
    margin,
    22
  );

  let cursorY = 39;

  // Executive Overview Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(margin, cursorY, pageWidth - margin * 2, 18, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(toPdfSafe('Synthese de la plateforme ZentraDesk'), margin + 4, cursorY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  const overviewLines = doc.splitTextToSize(
    toPdfSafe(
      'Ce document recense l ensemble des capacites fonctionnelles de ZentraDesk, detaille le flux d execution bout-en-bout de chaque brique (declencheur, traitement metier/IA, persistance Firestore/WebSocket, restitution UI) et identifie precisement les differents intervenants humains et techniques impliques.'
    ),
    pageWidth - margin * 2 - 8
  );
  doc.text(overviewLines, margin + 4, cursorY + 11.5);

  cursorY += 25;

  // Section 1: Stakeholders Map
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    toPdfSafe('1. Cartographie des Intervenants (Acteurs Humains, Services IA & Infrastructure)'),
    margin,
    cursorY
  );
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'striped',
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 8.2, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.8, textColor: [30, 41, 59], cellPadding: 2.3 },
    columnStyles: {
      0: { cellWidth: 58, fontStyle: 'bold' },
      1: { cellWidth: 34 },
      3: { cellWidth: 66 },
    },
    head: [['Intervenant / Acteur', 'Type', 'Responsabilites & Actions cles', 'Modules couverts']],
    body: PLATFORM_STAKEHOLDERS.map((s) => [
      toPdfSafe(s.actor),
      toPdfSafe(s.category),
      toPdfSafe(s.responsibilities),
      toPdfSafe(s.modules),
    ]),
  });

  // Section 2: Complete Feature Inventory with Execution Flow & Stakeholders
  doc.addPage();
  cursorY = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    toPdfSafe("2. Inventaire Complet des Fonctionnalites, Flux d'Execution & Intervenants"),
    margin,
    cursorY
  );
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59], cellPadding: 2.3, valign: 'top' },
    columnStyles: {
      0: { cellWidth: 13, fontStyle: 'bold', halign: 'center' },
      1: { cellWidth: 34, fontStyle: 'bold' },
      2: { cellWidth: 48, fontStyle: 'bold' },
      3: { cellWidth: 44 },
      4: { cellWidth: 92 },
      5: { cellWidth: 38 },
    },
    head: [[
      'Ref',
      'Module',
      'Fonctionnalite',
      'Intervenants impliques',
      "Flux d'execution detaille (Etape par etape)",
      'Composants & Donnees',
    ]],
    body: PLATFORM_FEATURES_INVENTORY.map((item) => [
      toPdfSafe(item.id),
      toPdfSafe(item.module),
      toPdfSafe(item.feature),
      toPdfSafe(item.stakeholders),
      toPdfSafe(item.executionFlow),
      toPdfSafe(item.dataAndServices),
    ]),
  });

  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
  if (cursorY > pageHeight - 58) {
    doc.addPage();
    cursorY = 18;
  }

  // Section 3: Technical Cross-Cutting Flows & Security Guarantees
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    toPdfSafe('3. Flux Techniques Transverses, Securite & Gouvernance des Donnees'),
    margin,
    cursorY
  );
  cursorY += 4;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'striped',
    headStyles: { fillColor: [5, 150, 105], textColor: 255, fontSize: 8.2, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.8, textColor: [30, 41, 59], cellPadding: 2.4, valign: 'top' },
    columnStyles: {
      0: { cellWidth: 44, fontStyle: 'bold' },
      1: { cellWidth: 44 },
      2: { cellWidth: 82 },
      3: { cellWidth: 46 },
    },
    head: [[
      'Flux transverse',
      'Declencheur',
      'Chaine d execution technique',
      'Intervenants',
      'Garde-fous & Securite',
    ]],
    body: TECHNICAL_CROSS_FLOWS.map((flow) => [
      toPdfSafe(flow.flowName),
      toPdfSafe(flow.trigger),
      toPdfSafe(flow.pipeline),
      toPdfSafe(flow.actorsInvolved),
      toPdfSafe(flow.safeguards),
    ]),
  });

  // Paginated Footer
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(
      toPdfSafe("ZentraDesk - Referentiel Fonctionnalites, Flux d'Execution & Intervenants"),
      margin,
      pageHeight - 8
    );
    doc.text(`Page ${i} / ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  return doc;
}

export function exportPlatformArchitecturePdf(generatedBy?: string): void {
  const doc = buildPlatformArchitecturePdfDoc(generatedBy);
  doc.save('ZentraDesk_Fonctionnalites_Flows_Intervenants.pdf');
}
