import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';

export async function ensureUserWorkspaceSeeded(user: User): Promise<void> {
  const uid = user.uid;
  const prefix = uid.slice(0, 8).replace(/[^a-zA-Z0-9]/g, 'u');

  // Ensure split user profile documents exist without overwriting custom agent preferences
  try {
    const publicProfileRef = doc(db, 'users', uid, 'public', 'profile');
    const existingPublicProfile = await getDoc(publicProfileRef);
    if (!existingPublicProfile.exists()) {
      await setDoc(publicProfileRef, {
        uid,
        displayName: (user.displayName || user.email?.split('@')[0] || 'Agent Support').slice(0, 120),
        role: user.email === 'camillenguiopo@gmail.com' ? 'admin' : 'supervisor',
        department: 'Centre Support & Opérations',
        ...(user.photoURL ? { avatarUrl: user.photoURL.slice(0, 500) } : {}),
        updatedAt: serverTimestamp(),
      });
    }

    const existingPrivate = await getDocs(
      query(collection(db, 'agents'), where('ownerId', '==', uid), limit(1))
    );

    await setDoc(
      doc(db, 'users', uid, 'private', 'info'),
      {
        uid,
        email: (user.email || 'agent@zentradesk.fr').slice(0, 200),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (!existingPrivate.empty) {
      // Ensure current-month agentLeaves exist even on previously seeded workspaces
      const existingLeaves = await getDocs(
        query(collection(db, 'agentLeaves'), where('ownerId', '==', uid), limit(1))
      );
      if (existingLeaves.empty) {
        const workspaceAgentsSnap = await getDocs(
          query(collection(db, 'agents'), where('ownerId', '==', uid))
        );
        const workspaceAgents = workspaceAgentsSnap.docs.map((d) => ({
          id: d.id,
          name: String(d.data().name || 'Agent Support'),
        }));
        if (workspaceAgents.length > 0) {
          const findAgent = (hint: string, fallbackIdx: number) =>
            workspaceAgents.find((a) => a.name.toLowerCase().includes(hint)) ||
            workspaceAgents[fallbackIdx % workspaceAgents.length];

          const a1 = findAgent('claire', 0);
          const a2 = findAgent('lucas', 1);
          const a3 = findAgent('nadia', 2);
          const a4 = findAgent('thomas', 3);

          const todayRef = new Date();
          const yr = todayRef.getFullYear();
          const mo = todayRef.getMonth();
          const lastDay = new Date(yr, mo + 1, 0).getDate();
          const iso = (d: number) => {
            const clamped = Math.max(1, Math.min(lastDay, d));
            return `${yr}-${String(mo + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
          };

          const leavesBatch = writeBatch(db);
          const seedLeaves = [
            {
              id: `lv_${prefix}_1`,
              agentId: a1.id,
              agentName: a1.name,
              leaveType: 'Congés payés',
              startDate: iso(11),
              endDate: iso(15),
              status: 'approved',
              notes: 'Congés annuels validés — relais assuré par le pôle N2.',
            },
            {
              id: `lv_${prefix}_2`,
              agentId: a2.id,
              agentName: a2.name,
              leaveType: 'RTT',
              startDate: iso(13),
              endDate: iso(15),
              status: 'approved',
              notes: 'Pont RTT posé — chevauchement détecté sur 3 jours avec N2.',
            },
            {
              id: `lv_${prefix}_3`,
              agentId: a3.id,
              agentName: a3.name,
              leaveType: 'Formation',
              startDate: iso(19),
              endDate: iso(21),
              status: 'approved',
              notes: 'Certification téléphonie CTI & gestion des incidents hors zone.',
            },
            {
              id: `lv_${prefix}_4`,
              agentId: a4.id,
              agentName: a4.name,
              leaveType: 'RTT',
              startDate: iso(20),
              endDate: iso(22),
              status: 'pending',
              notes: 'Demande en attente — vérifier couverture astreinte N3 le 20 et 21.',
            },
          ];

          for (const lv of seedLeaves) {
            const { id, ...rest } = lv;
            leavesBatch.set(doc(db, 'agentLeaves', id), {
              ...rest,
              ownerId: uid,
              memberIds: [uid],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
          await leavesBatch.commit();
        }
      }
      await ensureExtendedModulesSeeded(uid, prefix);
      return;
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }

  const now = Date.now();
  const memberIds = [uid];

  // Deterministic IDs per workspace
  const agentClaireId = `ag_${prefix}_claire`;
  const agentThomasId = `ag_${prefix}_thomas`;
  const agentNadiaId = `ag_${prefix}_nadia`;
  const agentLucasId = `ag_${prefix}_lucas`;

  const clientAlpineId = `cl_${prefix}_alpine`;
  const clientHexaId = `cl_${prefix}_hexa`;
  const clientVeloceId = `cl_${prefix}_veloce`;
  const clientMedisysId = `cl_${prefix}_medisys`;
  const clientNordicId = `cl_${prefix}_nordic`;
  const clientOrionId = `cl_${prefix}_orion`;

  const slaCritId = `sla_${prefix}_crit`;
  const slaHighId = `sla_${prefix}_high`;
  const slaMedId = `sla_${prefix}_med`;
  const slaLowId = `sla_${prefix}_low`;

  const ticket1Id = `tk_${prefix}_2041`;
  const ticket2Id = `tk_${prefix}_2042`;
  const ticket3Id = `tk_${prefix}_2043`;
  const ticket4Id = `tk_${prefix}_2044`;
  const ticket5Id = `tk_${prefix}_2045`;
  const ticket6Id = `tk_${prefix}_2046`;
  const ticket7Id = `tk_${prefix}_2047`;

  // Pass 1: Agents, Clients, SLA Policies, Automation Rules
  const batch1 = writeBatch(db);

  const agentsSeed = [
    {
      id: agentClaireId,
      name: 'Claire Moreau',
      roleTitle: 'Responsable Support N2',
      group: 'N2 Plateforme',
      avatarUrl: '/src/assets/images/avatar_agent_claire_1795211349040.jpg',
      availability: 'available',
      maxConcurrentTickets: 12,
      activeTickets: 6,
      callsHandled: 42,
      avgCallDurationSec: 265,
      situationChecks: 31,
      platformUsageScore: 96,
      clientAssistanceCount: 28,
      passwordUnlocksCount: 14,
      outOfZoneFollowups: 9,
      slaCompliancePct: 98.4,
      csatScore: 4.9,
      skills: 'Plateforme SaaS, SLA VIP, Diagnostics avancés, Escalades N2',
    },
    {
      id: agentThomasId,
      name: 'Thomas Laurent',
      roleTitle: 'Ingénieur Astreinte N3',
      group: 'N3 Infrastructure',
      avatarUrl: '/src/assets/images/avatar_agent_thomas_1795211348652.jpg',
      availability: 'on_call',
      maxConcurrentTickets: 10,
      activeTickets: 5,
      callsHandled: 19,
      avgCallDurationSec: 340,
      situationChecks: 44,
      platformUsageScore: 94,
      clientAssistanceCount: 15,
      passwordUnlocksCount: 7,
      outOfZoneFollowups: 22,
      slaCompliancePct: 97.1,
      csatScore: 4.8,
      skills: 'Infrastructure, Relais Hors Zone, Incidents récurrents, Réseau',
    },
    {
      id: agentNadiaId,
      name: 'Nadia Benali',
      roleTitle: 'Spécialiste Relation Client & CTI',
      group: 'Relation Client & CTI',
      avatarUrl: '/src/assets/images/avatar_agent_nadia_1795211349047.jpg',
      availability: 'in_call',
      maxConcurrentTickets: 14,
      activeTickets: 8,
      callsHandled: 76,
      avgCallDurationSec: 215,
      situationChecks: 38,
      platformUsageScore: 92,
      clientAssistanceCount: 49,
      passwordUnlocksCount: 19,
      outOfZoneFollowups: 27,
      slaCompliancePct: 95.8,
      csatScore: 4.9,
      skills: 'Téléphonie CTI, Rappels Hors Zone, Accompagnement client, VIP',
    },
    {
      id: agentLucasId,
      name: 'Lucas Bernard',
      roleTitle: 'Technicien Support N1',
      group: 'N1 Accès & Comptes',
      avatarUrl: '/src/assets/images/avatar_agent_lucas_1795211348429.jpg',
      availability: 'available',
      maxConcurrentTickets: 15,
      activeTickets: 7,
      callsHandled: 58,
      avgCallDurationSec: 185,
      situationChecks: 29,
      platformUsageScore: 89,
      clientAssistanceCount: 34,
      passwordUnlocksCount: 46,
      outOfZoneFollowups: 11,
      slaCompliancePct: 94.2,
      csatScore: 4.7,
      skills: 'Déblocage mot de passe, SSO/MFA, Vérification compte, Onboarding',
    },
  ];

  for (const agent of agentsSeed) {
    const { id, ...rest } = agent;
    batch1.set(doc(db, 'agents', id), {
      ...rest,
      ownerId: uid,
      memberIds,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const clientsSeed = [
    {
      id: clientAlpineId,
      companyName: 'Alpine Logistique SAS',
      contactName: 'Marc Delacroix',
      contactEmail: 'm.delacroix@alpinelog.fr',
      contactPhone: '+33 4 76 42 18 90',
      region: 'Auvergne-Rhône-Alpes (Zone Montagne)',
      tier: 'Enterprise VIP',
      healthStatus: 'out_of_zone',
      platformAdoptionPct: 84,
      passwordLocked: false,
      outOfZoneSignal: true,
      lastVerifiedNote: 'Ligne mobile chauffeur hors zone de couverture vallée Tarentaise. Rappel programmé.',
      lastVerifiedAt: 'Il y a 18 min',
    },
    {
      id: clientHexaId,
      companyName: 'HexaPay Finance',
      contactName: 'Sophie Marchand',
      contactEmail: 's.marchand@hexapay.fr',
      contactPhone: '+33 1 42 68 55 10',
      region: 'Île-de-France',
      tier: 'Enterprise VIP',
      healthStatus: 'password_locked',
      platformAdoptionPct: 93,
      passwordLocked: true,
      outOfZoneSignal: false,
      lastVerifiedNote: 'Compte administrateur verrouillé après 5 tentatives SSO infructueuses.',
      lastVerifiedAt: 'Il y a 9 min',
    },
    {
      id: clientVeloceId,
      companyName: 'Véloce Distribution Nord',
      contactName: 'Julien Carpentier',
      contactEmail: 'j.carpentier@veloce-nord.fr',
      contactPhone: '+33 3 20 88 14 22',
      region: 'Hauts-de-France (Nord-Est)',
      tier: 'Business',
      healthStatus: 'critical',
      platformAdoptionPct: 71,
      passwordLocked: false,
      outOfZoneSignal: true,
      lastVerifiedNote: 'Déconnexion récurrente des terminaux livreurs sur le relais Nord-Est.',
      lastVerifiedAt: 'Il y a 12 min',
    },
    {
      id: clientMedisysId,
      companyName: 'Médisys Cliniques',
      contactName: 'Dr. Hélène Garnier',
      contactEmail: 'h.garnier@medisys.fr',
      contactPhone: '+33 5 61 33 70 40',
      region: 'Occitanie',
      tier: 'Enterprise VIP',
      healthStatus: 'degraded',
      platformAdoptionPct: 62,
      passwordLocked: false,
      outOfZoneSignal: false,
      lastVerifiedNote: 'Besoin d’accompagnement sur le module d’export analytique de la plateforme.',
      lastVerifiedAt: 'Il y a 42 min',
    },
    {
      id: clientNordicId,
      companyName: 'Nordic Fret Maritime',
      contactName: 'Olivier Lefèvre',
      contactEmail: 'o.lefevre@nordicfret.fr',
      contactPhone: '+33 2 35 19 44 08',
      region: 'Normandie',
      tier: 'Business',
      healthStatus: 'nominal',
      platformAdoptionPct: 91,
      passwordLocked: false,
      outOfZoneSignal: false,
      lastVerifiedNote: 'Situation vérifiée ce matin : tous les services et accès sont opérationnels.',
      lastVerifiedAt: 'Il y a 2 h',
    },
    {
      id: clientOrionId,
      companyName: 'Orion Énergie Services',
      contactName: 'Camille Deschamps',
      contactEmail: 'c.deschamps@orion-energie.fr',
      contactPhone: '+33 4 91 22 60 15',
      region: 'Provence-Alpes-Côte d’Azur',
      tier: 'Standard',
      healthStatus: 'password_locked',
      platformAdoptionPct: 58,
      passwordLocked: true,
      outOfZoneSignal: false,
      lastVerifiedNote: 'Mot de passe expiré non renouvelé sur le portail technicien.',
      lastVerifiedAt: 'Il y a 31 min',
    },
  ];

  for (const client of clientsSeed) {
    const { id, ...rest } = client;
    batch1.set(doc(db, 'clients', id), {
      ...rest,
      ownerId: uid,
      memberIds,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const slaSeed = [
    {
      id: slaCritId,
      name: 'SLA Critique VIP / Infrastructure',
      priorityScope: 'critical',
      firstResponseMinutes: 15,
      updateMinutes: 30,
      resolutionMinutes: 120,
      escalationGroup: 'N3 Infrastructure',
      active: true,
    },
    {
      id: slaHighId,
      name: 'SLA Haute Priorité (Accès & Hors Zone)',
      priorityScope: 'high',
      firstResponseMinutes: 30,
      updateMinutes: 60,
      resolutionMinutes: 240,
      escalationGroup: 'N2 Plateforme',
      active: true,
    },
    {
      id: slaMedId,
      name: 'SLA Standard Plateforme',
      priorityScope: 'medium',
      firstResponseMinutes: 120,
      updateMinutes: 240,
      resolutionMinutes: 1440,
      escalationGroup: 'N1 Accès & Comptes',
      active: true,
    },
    {
      id: slaLowId,
      name: 'SLA Accompagnement & Conseil',
      priorityScope: 'low',
      firstResponseMinutes: 240,
      updateMinutes: 480,
      resolutionMinutes: 2880,
      escalationGroup: 'Relation Client & CTI',
      active: true,
    },
  ];

  for (const sla of slaSeed) {
    const { id, ...rest } = sla;
    batch1.set(doc(db, 'slaPolicies', id), {
      ...rest,
      ownerId: uid,
      memberIds,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const rulesSeed = [
    {
      id: `rule_${prefix}_horszone`,
      name: 'Regroupement automatique : Clients hors zone secteur Nord-Est',
      triggerCategory: 'Hors zone / Connectivité',
      conditionPattern: '2+ appels ou tickets "hors zone" dans la même région en moins de 45 min',
      actionSummary: 'Création automatique du ticket incident parent + escalade vers l’astreinte Réseau',
      targetGroup: 'N3 Infrastructure',
      autoCreateIncident: true,
      active: true,
      triggeredCount: 14,
    },
    {
      id: `rule_${prefix}_pwd`,
      name: 'Routage express : Mot de passe bloqué VIP',
      triggerCategory: 'Mot de passe bloqué',
      conditionPattern: 'Client Enterprise VIP avec mention "verrouillé", "bloqué" ou "SSO 403"',
      actionSummary: 'Assignation directe N1 Accès + vérification identité et préparation lien reset',
      targetGroup: 'N1 Accès & Comptes',
      autoCreateIncident: false,
      active: true,
      triggeredCount: 38,
    },
    {
      id: `rule_${prefix}_sla`,
      name: 'Alerte proactive pré-rupture SLA (< 15 min)',
      triggerCategory: 'Vérification situation',
      conditionPattern: 'Compte à rebours 1ère réponse < 15 minutes et ticket non pris en charge',
      actionSummary: 'Notification temps réel équipe + bascule vers agent disponible ou astreinte',
      targetGroup: 'N2 Plateforme',
      autoCreateIncident: false,
      active: true,
      triggeredCount: 9,
    },
    {
      id: `rule_${prefix}_usage`,
      name: 'Suivi adoption plateforme sous 65%',
      triggerCategory: 'Utilisation plateforme',
      conditionPattern: 'Score d’utilisation plateforme client < 65% sur 7 jours glissants',
      actionSummary: 'Ouverture proactive d’un ticket d’assistance client et planification appel conseil',
      targetGroup: 'Relation Client & CTI',
      autoCreateIncident: true,
      active: true,
      triggeredCount: 6,
    },
  ];

  for (const rule of rulesSeed) {
    const { id, ...rest } = rule;
    batch1.set(doc(db, 'automationRules', id), {
      ...rest,
      ownerId: uid,
      memberIds,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch1.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'batch1_seed');
  }

  // Pass 2: Tickets, Events, OnCallShifts, CallLogs
  const batch2 = writeBatch(db);

  const ticketsSeed = [
    {
      id: ticket1Id,
      reference: 'ZD-2041',
      subject: 'Perte de signal et clients hors zone sur relais Nord-Est',
      description:
        'Plusieurs livreurs de Véloce Distribution Nord basculent en statut hors zone depuis 10h12. Impossibilité de synchroniser les bordereaux de livraison sur la plateforme mobile.',
      channel: 'auto_alert',
      status: 'escalated',
      priority: 'critical',
      category: 'Hors zone / Connectivité',
      clientId: clientVeloceId,
      clientName: 'Véloce Distribution Nord',
      assignedAgentId: agentThomasId,
      assignedAgentName: 'Thomas Laurent',
      assignedGroup: 'N3 Infrastructure',
      slaPolicyId: slaCritId,
      firstResponseDueMs: now + 9 * 60 * 1000,
      resolutionDueMs: now + 82 * 60 * 1000,
      firstResponded: true,
      aiRouted: true,
      aiConfidence: 0.96,
      aiSentiment: 'Urgent — Impact opérationnel',
      aiSummary: 'Incident récurrent relais Nord-Est affectant les terminaux mobiles en tournée.',
      isRecurringIncident: true,
      parentIncidentRef: 'INC-REL-09',
      tags: ['hors-zone', 'incident-recurrent', 'astreinte'],
    },
    {
      id: ticket2Id,
      reference: 'ZD-2042',
      subject: 'Mot de passe bloqué sur compte administrateur HexaPay',
      description:
        'Bonjour, mon compte administrateur est bloqué suite à un changement de téléphone MFA. J’ai une clôture de paie dans 40 minutes, merci de débloquer l’accès.',
      channel: 'phone',
      status: 'open',
      priority: 'high',
      category: 'Mot de passe bloqué',
      clientId: clientHexaId,
      clientName: 'HexaPay Finance',
      assignedAgentId: agentLucasId,
      assignedAgentName: 'Lucas Bernard',
      assignedGroup: 'N1 Accès & Comptes',
      slaPolicyId: slaHighId,
      firstResponseDueMs: now + 11 * 60 * 1000,
      resolutionDueMs: now + 145 * 60 * 1000,
      firstResponded: false,
      aiRouted: true,
      aiConfidence: 0.98,
      aiSentiment: 'Pressé — VIP',
      aiSummary: 'Verrouillage MFA/Mot de passe administrateur HexaPay nécessitant déblocage immédiat.',
      isRecurringIncident: false,
      tags: ['mot-de-passe', 'vip', 'acces'],
    },
    {
      id: ticket3Id,
      reference: 'ZD-2043',
      subject: 'Client injoignable hors zone vallée Tarentaise — Rappel proactif',
      description:
        'Appel sortant vers Marc Delacroix (Alpine Logistique) tombé en répondeur réseau hors zone. Vérifier la couverture et reprogrammer un créneau de vérification situation.',
      channel: 'phone',
      status: 'pending_client',
      priority: 'high',
      category: 'Hors zone / Connectivité',
      clientId: clientAlpineId,
      clientName: 'Alpine Logistique SAS',
      assignedAgentId: agentNadiaId,
      assignedAgentName: 'Nadia Benali',
      assignedGroup: 'Relation Client & CTI',
      slaPolicyId: slaHighId,
      firstResponseDueMs: now - 5 * 60 * 1000,
      resolutionDueMs: now + 180 * 60 * 1000,
      firstResponded: true,
      aiRouted: true,
      aiConfidence: 0.91,
      aiSentiment: 'Neutre — Suivi proactif',
      aiSummary: 'Client hors zone lors de l’appel téléphonique sortant ; suivi de rappel actif.',
      isRecurringIncident: true,
      parentIncidentRef: 'INC-REL-09',
      tags: ['appel-hors-zone', 'rappel', 'vip'],
    },
    {
      id: ticket4Id,
      reference: 'ZD-2044',
      subject: 'Assistance prise en main module export analytique plateforme',
      description:
        'Nous utilisons la plateforme depuis deux semaines mais notre équipe n’arrive pas à configurer les filtres hebdomadaires ni les alertes SLA personnalisées.',
      channel: 'portal',
      status: 'open',
      priority: 'medium',
      category: 'Utilisation plateforme',
      clientId: clientMedisysId,
      clientName: 'Médisys Cliniques',
      assignedAgentId: agentClaireId,
      assignedAgentName: 'Claire Moreau',
      assignedGroup: 'N2 Plateforme',
      slaPolicyId: slaMedId,
      firstResponseDueMs: now + 75 * 60 * 1000,
      resolutionDueMs: now + 720 * 60 * 1000,
      firstResponded: true,
      aiRouted: true,
      aiConfidence: 0.93,
      aiSentiment: 'Constructif',
      aiSummary: 'Demande d’accompagnement sur l’utilisation avancée de la plateforme analytique.',
      isRecurringIncident: false,
      tags: ['utilisation-plateforme', 'formation'],
    },
    {
      id: ticket5Id,
      reference: 'ZD-2045',
      subject: 'Vérification situation facturation et état des licences Q4',
      description:
        'Merci de vérifier la situation de nos 45 licences actives et de confirmer qu’aucun compte secondaire n’est en statut suspendu avant notre audit interne.',
      channel: 'email',
      status: 'new',
      priority: 'medium',
      category: 'Vérification situation',
      clientId: clientNordicId,
      clientName: 'Nordic Fret Maritime',
      assignedGroup: 'N2 Plateforme',
      slaPolicyId: slaMedId,
      firstResponseDueMs: now + 42 * 60 * 1000,
      resolutionDueMs: now + 960 * 60 * 1000,
      firstResponded: false,
      aiRouted: false,
      isRecurringIncident: false,
      tags: ['verification-situation', 'audit'],
    },
    {
      id: ticket6Id,
      reference: 'ZD-2046',
      subject: 'Mot de passe expiré — Portail technicien terrain Orion',
      description:
        'Trois techniciens terrain signalent que leur mot de passe est bloqué après renouvellement automatique ce matin. Erreur AUTH-401 sur la page de connexion.',
      channel: 'chat',
      status: 'new',
      priority: 'high',
      category: 'Mot de passe bloqué',
      clientId: clientOrionId,
      clientName: 'Orion Énergie Services',
      assignedGroup: 'N1 Accès & Comptes',
      slaPolicyId: slaHighId,
      firstResponseDueMs: now + 18 * 60 * 1000,
      resolutionDueMs: now + 190 * 60 * 1000,
      firstResponded: false,
      aiRouted: true,
      aiConfidence: 0.95,
      aiSentiment: 'Frustré',
      aiSummary: 'Blocage groupé de mots de passe techniciens suite à rotation automatique.',
      isRecurringIncident: true,
      parentIncidentRef: 'INC-AUTH-12',
      tags: ['mot-de-passe', 'incident-recurrent'],
    },
    {
      id: ticket7Id,
      reference: 'ZD-2047',
      subject: 'Assistante client : paramétrage webhook alertes temps réel',
      description:
        'Demande d’assistance technique guidée pour relier notre outil interne de supervision au flux d’alertes ZentraDesk.',
      channel: 'email',
      status: 'resolved',
      priority: 'low',
      category: 'Assistance client',
      clientId: clientNordicId,
      clientName: 'Nordic Fret Maritime',
      assignedAgentId: agentClaireId,
      assignedAgentName: 'Claire Moreau',
      assignedGroup: 'N2 Plateforme',
      slaPolicyId: slaLowId,
      firstResponseDueMs: now + 120 * 60 * 1000,
      resolutionDueMs: now + 1200 * 60 * 1000,
      firstResponded: true,
      aiRouted: true,
      aiConfidence: 0.89,
      aiSentiment: 'Positif',
      aiSummary: 'Session d’assistance client terminée avec validation complète du webhook.',
      isRecurringIncident: false,
      tags: ['assistance-client', 'resolu'],
    },
  ];

  for (const ticket of ticketsSeed) {
    const { id, ...rest } = ticket;
    batch2.set(doc(db, 'tickets', id), {
      ...rest,
      ownerId: uid,
      memberIds,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // Initial timeline events for key tickets
  batch2.set(doc(db, 'tickets', ticket1Id, 'events', `evt_${prefix}_1a`), {
    ticketId: ticket1Id,
    authorName: 'Moteur IA ZentraDesk',
    authorRole: 'ai',
    visibility: 'internal',
    eventType: 'ai_triage',
    body: 'Routage automatique vers N3 Infrastructure (confiance 96%). Corrélation détectée avec l’incident récurrent INC-REL-09 (clients hors zone Nord-Est).',
    ownerId: uid,
    memberIds,
    createdAt: serverTimestamp(),
  });
  batch2.set(doc(db, 'tickets', ticket1Id, 'events', `evt_${prefix}_1b`), {
    ticketId: ticket1Id,
    authorName: 'Thomas Laurent',
    authorRole: 'agent',
    visibility: 'internal',
    eventType: 'note',
    body: 'Prise en charge en astreinte N3. Bascule de trafic en cours sur le relais secondaire de Lille pour rétablir les terminaux hors zone.',
    ownerId: uid,
    memberIds,
    createdAt: serverTimestamp(),
  });
  batch2.set(doc(db, 'tickets', ticket2Id, 'events', `evt_${prefix}_2a`), {
    ticketId: ticket2Id,
    authorName: 'Sophie Marchand',
    authorRole: 'client',
    visibility: 'public',
    eventType: 'call_log',
    body: 'Appel entrant enregistré (02:45). La cliente signale un blocage de mot de passe suite au changement de téléphone MFA.',
    ownerId: uid,
    memberIds,
    createdAt: serverTimestamp(),
  });

  // Current month ISO helpers for shifts & team calendar leaves
  const todayDate = new Date();
  const calYear = todayDate.getFullYear();
  const calMonth = todayDate.getMonth();
  const calLastDay = new Date(calYear, calMonth + 1, 0).getDate();
  const formatCalIso = (d: number) => {
    const clamped = Math.max(1, Math.min(calLastDay, d));
    return `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
  };
  const offsetFromTodayIso = (offsetDays: number) => {
    const dt = new Date(todayDate);
    dt.setDate(dt.getDate() + offsetDays);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  // On-call Shifts (Astreintes)
  const shiftsSeed = [
    {
      id: `sh_${prefix}_1`,
      agentId: agentThomasId,
      agentName: 'Thomas Laurent',
      specialty: 'Infrastructure N3',
      dayLabel: 'Aujourd’hui · Vendredi',
      shiftDate: offsetFromTodayIso(0),
      timeWindow: '08:00 — 20:00',
      status: 'active',
      availabilityVerified: true,
      escalationPhone: '+33 6 44 12 88 01',
      notes: 'Astreinte active sur incidents relais Nord-Est et SLA critiques.',
    },
    {
      id: `sh_${prefix}_2`,
      agentId: agentClaireId,
      agentName: 'Claire Moreau',
      specialty: 'Support VIP',
      dayLabel: 'Aujourd’hui · Vendredi',
      shiftDate: offsetFromTodayIso(0),
      timeWindow: '20:00 — 08:00',
      status: 'scheduled',
      availabilityVerified: true,
      escalationPhone: '+33 6 72 90 14 55',
      notes: 'Relève de nuit confirmée selon disponibilité.',
    },
    {
      id: `sh_${prefix}_3`,
      agentId: agentNadiaId,
      agentName: 'Nadia Benali',
      specialty: 'Réseau & Hors Zone',
      dayLabel: 'Demain · Samedi',
      shiftDate: offsetFromTodayIso(1),
      timeWindow: '08:00 — 20:00',
      status: 'scheduled',
      availabilityVerified: true,
      escalationPhone: '+33 6 19 38 77 20',
      notes: 'Gestion proactive des rappels clients hors zone et continuité CTI.',
    },
    {
      id: `sh_${prefix}_4`,
      agentId: agentLucasId,
      agentName: 'Lucas Bernard',
      specialty: 'Sécurité & Accès',
      dayLabel: 'Après-demain · Dimanche',
      shiftDate: offsetFromTodayIso(2),
      timeWindow: '08:00 — 20:00',
      status: 'standby',
      availabilityVerified: true,
      escalationPhone: '+33 6 85 04 31 99',
      notes: 'Déblocage mots de passe urgents et réinitialisations MFA.',
    },
  ];

  for (const shift of shiftsSeed) {
    const { id, ...rest } = shift;
    batch2.set(doc(db, 'onCallShifts', id), {
      ...rest,
      ownerId: uid,
      memberIds,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // Team Calendar Leaves (Congés & Indisponibilités)
  const leavesSeed = [
    {
      id: `lv_${prefix}_1`,
      agentId: agentClaireId,
      agentName: 'Claire Moreau',
      leaveType: 'Congés payés',
      startDate: formatCalIso(11),
      endDate: formatCalIso(15),
      status: 'approved',
      notes: 'Congés annuels validés — relais assuré par le pôle N2.',
    },
    {
      id: `lv_${prefix}_2`,
      agentId: agentLucasId,
      agentName: 'Lucas Bernard',
      leaveType: 'RTT',
      startDate: formatCalIso(13),
      endDate: formatCalIso(15),
      status: 'approved',
      notes: 'Pont RTT posé — chevauchement détecté sur 3 jours avec N2.',
    },
    {
      id: `lv_${prefix}_3`,
      agentId: agentNadiaId,
      agentName: 'Nadia Benali',
      leaveType: 'Formation',
      startDate: formatCalIso(19),
      endDate: formatCalIso(21),
      status: 'approved',
      notes: 'Certification téléphonie CTI & gestion des incidents hors zone.',
    },
    {
      id: `lv_${prefix}_4`,
      agentId: agentThomasId,
      agentName: 'Thomas Laurent',
      leaveType: 'RTT',
      startDate: formatCalIso(20),
      endDate: formatCalIso(22),
      status: 'pending',
      notes: 'Demande en attente — vérifier couverture astreinte N3 le 20 et 21.',
    },
  ];

  for (const leave of leavesSeed) {
    const { id, ...rest } = leave;
    batch2.set(doc(db, 'agentLeaves', id), {
      ...rest,
      ownerId: uid,
      memberIds,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // Call Logs
  const callsSeed = [
    {
      id: `call_${prefix}_1`,
      clientId: clientHexaId,
      clientName: 'HexaPay Finance',
      agentId: agentLucasId,
      agentName: 'Lucas Bernard',
      direction: 'inbound',
      outcome: 'answered',
      durationSeconds: 165,
      linkedTicketRef: 'ZD-2042',
      notes: 'Vérification d’identité effectuée, procédure de déblocage mot de passe lancée.',
    },
    {
      id: `call_${prefix}_2`,
      clientId: clientAlpineId,
      clientName: 'Alpine Logistique SAS',
      agentId: agentNadiaId,
      agentName: 'Nadia Benali',
      direction: 'outbound',
      outcome: 'out_of_zone',
      durationSeconds: 32,
      linkedTicketRef: 'ZD-2043',
      notes: 'Client hors zone réseau en vallée de Tarentaise — rappel programmé dans 45 min.',
    },
    {
      id: `call_${prefix}_3`,
      clientId: clientVeloceId,
      clientName: 'Véloce Distribution Nord',
      agentId: agentThomasId,
      agentName: 'Thomas Laurent',
      direction: 'outbound',
      outcome: 'answered',
      durationSeconds: 290,
      linkedTicketRef: 'ZD-2041',
      notes: 'Point technique avec le responsable logistique sur les terminaux hors zone.',
    },
    {
      id: `call_${prefix}_4`,
      clientId: clientMedisysId,
      clientName: 'Médisys Cliniques',
      agentId: agentClaireId,
      agentName: 'Claire Moreau',
      direction: 'inbound',
      outcome: 'answered',
      durationSeconds: 410,
      linkedTicketRef: 'ZD-2044',
      notes: 'Session d’assistance plateforme et démonstration des rapports SLA.',
    },
  ];

  for (const call of callsSeed) {
    const { id, ...rest } = call;
    batch2.set(doc(db, 'callLogs', id), {
      ...rest,
      ownerId: uid,
      memberIds,
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch2.commit();
    await ensureExtendedModulesSeeded(uid, prefix);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'batch2_seed');
  }
}

async function ensureExtendedModulesSeeded(uid: string, prefix: string): Promise<void> {
  const memberIds = [uid];
  const [kbCheck, cfgCheck, annCheck, reportCheck, pdfCheck] = await Promise.all([
    getDocs(query(collection(db, 'kbArticles'), where('ownerId', '==', uid), limit(1))),
    getDocs(query(collection(db, 'workspaceConfigs'), where('ownerId', '==', uid), limit(1))),
    getDocs(query(collection(db, 'chartAnnotations'), where('ownerId', '==', uid), limit(1))),
    getDocs(query(collection(db, 'onCallReports'), where('ownerId', '==', uid), limit(1))),
    getDocs(query(collection(db, 'kbPdfDocuments'), where('ownerId', '==', uid), limit(1))),
  ]);

  if (
    !kbCheck.empty &&
    !cfgCheck.empty &&
    !annCheck.empty &&
    !reportCheck.empty &&
    !pdfCheck.empty
  ) {
    return;
  }

  const [agentsSnap, clientsSnap, ticketsSnap] = await Promise.all([
    getDocs(query(collection(db, 'agents'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'clients'), where('ownerId', '==', uid))),
    getDocs(query(collection(db, 'tickets'), where('ownerId', '==', uid))),
  ]);

  const workspaceAgents = agentsSnap.docs.map((d) => ({
    id: d.id,
    name: String(d.data().name || 'Agent Support'),
  }));
  const workspaceClients = clientsSnap.docs.map((d) => ({
    id: d.id,
    companyName: String(d.data().companyName || 'Client'),
  }));
  const workspaceTickets = ticketsSnap.docs.map((d) => ({
    id: d.id,
    reference: String(d.data().reference || 'ZD-2041'),
  }));

  const findAgent = (hint: string, idx: number) =>
    workspaceAgents.find((a) => a.name.toLowerCase().includes(hint)) ||
    workspaceAgents[idx % Math.max(1, workspaceAgents.length)] || {
      id: `ag_${prefix}_claire`,
      name: 'Claire Moreau',
    };
  const findClient = (hint: string, idx: number) =>
    workspaceClients.find((c) => c.companyName.toLowerCase().includes(hint)) ||
    workspaceClients[idx % Math.max(1, workspaceClients.length)] || {
      id: `cl_${prefix}_hexa`,
      companyName: 'HexaPay Finance',
    };
  const findTicket = (ref: string, idx: number) =>
    workspaceTickets.find((t) => t.reference === ref) ||
    workspaceTickets[idx % Math.max(1, workspaceTickets.length)] || {
      id: `tk_${prefix}_2041`,
      reference: ref,
    };

  const aClaire = findAgent('claire', 0);
  const aThomas = findAgent('thomas', 1);
  const aNadia = findAgent('nadia', 2);
  const aLucas = findAgent('lucas', 3);

  const cAlpine = findClient('alpine', 0);
  const cHexa = findClient('hexa', 1);
  const cVeloce = findClient('véloce', 2);
  const cNordic = findClient('nordic', 3);

  const t1 = findTicket('ZD-2041', 0);
  const t2 = findTicket('ZD-2042', 1);
  const t3 = findTicket('ZD-2044', 2);
  const t4 = findTicket('ZD-2047', 3);

  const today = new Date();
  const shiftIso = (offset: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + offset);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
      dt.getDate()
    ).padStart(2, '0')}`;
  };

  const batch3 = writeBatch(db);

  if (kbCheck.empty) {
    const kbSeed = [
      {
        id: `kb_${prefix}_pwd`,
        title: 'Débloquer un compte et réinitialiser la double authentification (MFA)',
        summary: 'Procédure complète pour lever un verrouillage après 5 tentatives SSO ou changement de mobile.',
        body: '1. Ouvrez la fiche client dans Suivi Proactif Clients.\n2. Vérifiez l’identité du demandeur via téléphone ou email secondaire.\n3. Déclenchez l’action "Débloquer mot de passe" qui génère un lien temporaire valide 20 minutes.\n4. Demandez à l’utilisateur de ré-enrôler son code TOTP lors de la première connexion.',
        category: 'Mot de passe bloqué',
        language: 'fr',
        articleType: 'guide',
        tags: ['mot-de-passe', 'mfa', 'sso', 'deblocage'],
        published: true,
        viewsCount: 342,
        deflectionsCount: 47,
        helpfulCount: 68,
        authorName: 'Lucas Bernard',
      },
      {
        id: `kb_${prefix}_horszone`,
        title: 'Client hors zone réseau : activer le mode hors-ligne et la file de rappel',
        summary: 'Que faire lorsqu’un terminal terrain perd la couverture GSM/4G en zone blanche ou montagne.',
        body: 'Lorsqu’un terminal bascule hors zone :\n- Les bordereaux sont stockés localement pendant 72h sans perte de données.\n- Dès le retour en couverture, la synchronisation reprend automatiquement.\n- Côté support, vérifiez l’état du relais régional dans Astreintes N3 avant de programmer un rappel CTI.',
        category: 'Hors zone / Connectivité',
        language: 'fr',
        articleType: 'article',
        tags: ['hors-zone', 'connectivite', 'relais', 'mobile'],
        published: true,
        viewsCount: 218,
        deflectionsCount: 31,
        helpfulCount: 44,
        authorName: 'Thomas Laurent',
      },
      {
        id: `kb_${prefix}_export`,
        title: 'FAQ : Configurer les rapports analytiques SLA et exports mensuels PDF/CSV',
        summary: 'Guide pas-à-pas pour filtrer les délais de première réponse et planifier les exports mensuels.',
        body: 'Rendez-vous dans Rapports, Qualité & WFM > Rapports personnalisables.\nSélectionnez vos groupes de support (N1, N2, N3), cochez les colonnes SLA et CSAT puis cliquez sur Exporter PDF ou CSV.',
        category: 'Utilisation plateforme',
        language: 'fr',
        articleType: 'faq',
        tags: ['utilisation', 'export', 'pdf', 'sla', 'analytique'],
        published: true,
        viewsCount: 164,
        deflectionsCount: 22,
        helpfulCount: 35,
        authorName: 'Claire Moreau',
      },
      {
        id: `kb_${prefix}_en_sso`,
        title: 'How to unlock an administrator account and reset MFA tokens',
        summary: 'Step-by-step instructions when SSO or password attempts lock an enterprise workspace account.',
        body: '1. Verify the account holder identity.\n2. Trigger an instant password unlock from the Proactive Client Health view.\n3. Issue a temporary 20-minute recovery link and re-enroll the authenticator device.',
        category: 'Mot de passe bloqué',
        language: 'en',
        articleType: 'guide',
        tags: ['password', 'mfa', 'unlock', 'sso'],
        published: true,
        viewsCount: 129,
        deflectionsCount: 19,
        helpfulCount: 27,
        authorName: 'Claire Moreau',
      },
      {
        id: `kb_${prefix}_es_offline`,
        title: 'Guía rápida: terminales fuera de cobertura y sincronización automática',
        summary: 'Cómo recuperar los datos pendientes cuando un equipo de campo pierde la señal de red.',
        body: 'El modo sin conexión conserva todas las operaciones hasta 72 horas. Al restablecer la cobertura, pulse Sincronizar o espere el reintento automático cada 5 minutos.',
        category: 'Hors zone / Connectivité',
        language: 'es',
        articleType: 'faq',
        tags: ['fuera-de-zona', 'red', 'sincronizacion'],
        published: true,
        viewsCount: 84,
        deflectionsCount: 11,
        helpfulCount: 16,
        authorName: 'Nadia Benali',
      },
      {
        id: `kb_${prefix}_webhook`,
        title: 'Connecter ZentraDesk à Jira, Salesforce ou votre ERP via Webhooks signés',
        summary: 'Format des en-têtes HMAC-SHA256 et liste des événements disponibles pour l’API externe.',
        body: 'Chaque appel webhook inclut l’en-tête X-ZentraDesk-Signature (HMAC SHA-256) et un payload JSON contenant la référence du ticket, la priorité SLA et l’identifiant client.',
        category: 'Assistance client',
        language: 'fr',
        articleType: 'article',
        tags: ['api', 'webhook', 'jira', 'salesforce', 'erp'],
        published: true,
        viewsCount: 145,
        deflectionsCount: 18,
        helpfulCount: 29,
        authorName: 'Thomas Laurent',
      },
    ];

    for (const art of kbSeed) {
      const { id, ...rest } = art;
      batch3.set(doc(db, 'kbArticles', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const forumSeed = [
      {
        id: `frm_${prefix}_1`,
        title: 'Meilleure pratique pour synchroniser les terminaux en vallée blanche',
        body: 'Nous opérons plusieurs tournées en zone montagneuse : quelle fréquence de synchronisation conseillez-vous pour éviter les alertes hors zone répétées ?',
        category: 'Hors zone / Connectivité',
        language: 'fr',
        authorName: 'Marc Delacroix',
        authorCompany: 'Alpine Logistique SAS',
        status: 'answered',
        upvotes: 19,
        repliesCount: 4,
        lastReplyNote: 'Réponse officielle N3 : activer le cache 72h et le seuil de regroupement à 15 min.',
      },
      {
        id: `frm_${prefix}_2`,
        title: 'Intégration Jira + Slack : recevoir uniquement les escalades SLA Critiques',
        body: 'Est-il possible de filtrer les notifications Slack uniquement sur les tickets dont le temps estimé dépasse 80% du délai SLA ?',
        category: 'Intégrations & API',
        language: 'fr',
        authorName: 'Sophie Marchand',
        authorCompany: 'HexaPay Finance',
        status: 'pinned',
        upvotes: 27,
        repliesCount: 6,
        lastReplyNote: 'Oui, sélectionnez l’événement "sla.warning_80pct" dans la fiche webhook Slack.',
      },
      {
        id: `frm_${prefix}_3`,
        title: 'Partage de modèles de tableaux de bord mensuels pour comités de direction',
        body: 'Comment personnaliser les colonnes du rapport mensuel PDF pour mettre en avant le CSAT et les déblocages MFA ?',
        category: 'Reporting & Qualité',
        language: 'fr',
        authorName: 'Dr. Hélène Garnier',
        authorCompany: 'Médisys Cliniques',
        status: 'open',
        upvotes: 11,
        repliesCount: 2,
      },
    ];

    for (const topic of forumSeed) {
      const { id, ...rest } = topic;
      batch3.set(doc(db, 'forumTopics', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const csatSeed = [
      {
        id: `csat_${prefix}_1`,
        ticketId: t4.id,
        ticketRef: t4.reference,
        clientId: cNordic.id,
        clientName: cNordic.companyName,
        agentId: aClaire.id,
        agentName: aClaire.name,
        rating: 5,
        comment: 'Accompagnement très clair sur le paramétrage webhook, résolu en un seul échange.',
        channel: 'email',
      },
      {
        id: `csat_${prefix}_2`,
        ticketId: t2.id,
        ticketRef: t2.reference,
        clientId: cHexa.id,
        clientName: cHexa.companyName,
        agentId: aLucas.id,
        agentName: aLucas.name,
        rating: 5,
        comment: 'Déblocage MFA ultra rapide avant notre clôture de paie, merci Lucas !',
        channel: 'phone',
      },
      {
        id: `csat_${prefix}_3`,
        ticketId: t3.id,
        ticketRef: t3.reference,
        clientId: cAlpine.id,
        clientName: cAlpine.companyName,
        agentId: aNadia.id,
        agentName: aNadia.name,
        rating: 4,
        comment: 'Suivi proactif apprécié malgré la coupure réseau en vallée.',
        channel: 'portal',
      },
      {
        id: `csat_${prefix}_4`,
        ticketId: t1.id,
        ticketRef: t1.reference,
        clientId: cVeloce.id,
        clientName: cVeloce.companyName,
        agentId: aThomas.id,
        agentName: aThomas.name,
        rating: 4,
        comment: 'Prise en charge N3 efficace, bascule sur relais secondaire rapide.',
        channel: 'email',
      },
    ];

    for (const survey of csatSeed) {
      const { id, ...rest } = survey;
      batch3.set(doc(db, 'csatSurveys', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
      });
    }

    const qaSeed = [
      {
        id: `qa_${prefix}_1`,
        agentId: aClaire.id,
        agentName: aClaire.name,
        ticketRef: 'ZD-2044',
        reviewerName: 'Superviseur Qualité',
        greetingScore: 25,
        diagnosticScore: 24,
        slaComplianceScore: 25,
        toneResolutionScore: 24,
        totalScore: 98,
        trainingNeed: 'Aucun — Référente mentoring N2',
        feedback: 'Excellente structuration de la réponse et documentation de la base de connaissances.',
      },
      {
        id: `qa_${prefix}_2`,
        agentId: aLucas.id,
        agentName: aLucas.name,
        ticketRef: 'ZD-2042',
        reviewerName: 'Claire Moreau',
        greetingScore: 23,
        diagnosticScore: 21,
        slaComplianceScore: 24,
        toneResolutionScore: 22,
        totalScore: 90,
        trainingNeed: 'Procédure d’escalade SSO multi-tenant',
        feedback: 'Très bon délai de prise en charge. Pensez à joindre le lien FAQ MFA dans la réponse finale.',
      },
      {
        id: `qa_${prefix}_3`,
        agentId: aNadia.id,
        agentName: aNadia.name,
        ticketRef: 'ZD-2043',
        reviewerName: 'Claire Moreau',
        greetingScore: 24,
        diagnosticScore: 22,
        slaComplianceScore: 23,
        toneResolutionScore: 24,
        totalScore: 93,
        trainingNeed: 'Outils de diagnostic relais hors zone',
        feedback: 'Écoute client exemplaire et traçabilité claire des tentatives de rappel.',
      },
      {
        id: `qa_${prefix}_4`,
        agentId: aThomas.id,
        agentName: aThomas.name,
        ticketRef: 'ZD-2041',
        reviewerName: 'Superviseur Qualité',
        greetingScore: 21,
        diagnosticScore: 25,
        slaComplianceScore: 24,
        toneResolutionScore: 21,
        totalScore: 91,
        trainingNeed: 'Vulgarisation des comptes-rendus clients VIP',
        feedback: 'Diagnostic N3 irréprochable. Simplifier légèrement les termes réseau dans les messages publics.',
      },
    ];

    for (const qa of qaSeed) {
      const { id, ...rest } = qa;
      batch3.set(doc(db, 'qaEvaluations', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
      });
    }

    const wfmSeed = [
      {
        id: `wfm_${prefix}_1`,
        agentId: aClaire.id,
        agentName: aClaire.name,
        shiftDate: shiftIso(0),
        timeWindow: '08:30 — 16:30',
        plannedHours: 8,
        adherencePct: 97,
        forecastTickets: 18,
        activityType: 'Support N1/N2',
      },
      {
        id: `wfm_${prefix}_2`,
        agentId: aNadia.id,
        agentName: aNadia.name,
        shiftDate: shiftIso(0),
        timeWindow: '09:00 — 17:00',
        plannedHours: 8,
        adherencePct: 94,
        forecastTickets: 24,
        activityType: 'Téléphonie CTI',
      },
      {
        id: `wfm_${prefix}_3`,
        agentId: aThomas.id,
        agentName: aThomas.name,
        shiftDate: shiftIso(0),
        timeWindow: '08:00 — 20:00',
        plannedHours: 12,
        adherencePct: 99,
        forecastTickets: 11,
        activityType: 'Astreinte N3',
      },
      {
        id: `wfm_${prefix}_4`,
        agentId: aLucas.id,
        agentName: aLucas.name,
        shiftDate: shiftIso(1),
        timeWindow: '08:30 — 16:30',
        plannedHours: 8,
        adherencePct: 91,
        forecastTickets: 21,
        activityType: 'Support N1/N2',
      },
      {
        id: `wfm_${prefix}_5`,
        agentId: aNadia.id,
        agentName: aNadia.name,
        shiftDate: shiftIso(2),
        timeWindow: '10:00 — 14:00',
        plannedHours: 4,
        adherencePct: 96,
        forecastTickets: 9,
        activityType: 'Formation / Coaching',
      },
    ];

    for (const shift of wfmSeed) {
      const { id, ...rest } = shift;
      batch3.set(doc(db, 'wfmShifts', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const integrationsSeed = [
      {
        id: `int_${prefix}_shopify`,
        kind: 'marketplace',
        provider: 'Shopify',
        name: 'Shopify Plus Commerce',
        category: 'E-Commerce',
        eventsSummary: 'Commandes clients, remboursements & statut expédition dans les tickets',
        active: true,
        syncCount: 142,
        lastSyncAt: 'Il y a 12 min',
        lastStatus: 'Connecté · Sync OK',
      },
      {
        id: `int_${prefix}_salesforce`,
        kind: 'marketplace',
        provider: 'Salesforce',
        name: 'Salesforce CRM Enterprise',
        category: 'CRM',
        eventsSummary: 'Synchronisation comptes VIP, contrats SLA et opportunités',
        active: true,
        syncCount: 89,
        lastSyncAt: 'Il y a 25 min',
        lastStatus: 'Connecté · Sync OK',
      },
      {
        id: `int_${prefix}_slack`,
        kind: 'marketplace',
        provider: 'Slack',
        name: 'Slack #support-escalades',
        category: 'Messagerie',
        eventsSummary: 'Alertes SLA >80% et notifications d’incidents récurrents en direct',
        active: true,
        syncCount: 314,
        lastSyncAt: 'Il y a 4 min',
        lastStatus: 'Connecté · Canal actif',
      },
      {
        id: `int_${prefix}_jira`,
        kind: 'marketplace',
        provider: 'Jira Software',
        name: 'Jira Engineering Sync',
        category: 'Ingénierie',
        eventsSummary: 'Création automatique d’issues N3 liées aux incidents infrastructure',
        active: true,
        syncCount: 54,
        lastSyncAt: 'Il y a 1 h',
        lastStatus: 'Connecté · Webhook lié',
      },
      {
        id: `int_${prefix}_hubspot`,
        kind: 'marketplace',
        provider: 'HubSpot',
        name: 'HubSpot Service & CRM',
        category: 'CRM',
        eventsSummary: 'Historique interactions client et score d’adoption plateforme',
        active: false,
        syncCount: 0,
        lastSyncAt: 'Jamais synchronisé',
        lastStatus: 'Disponible',
      },
      {
        id: `int_${prefix}_odoo`,
        kind: 'marketplace',
        provider: 'Odoo ERP',
        name: 'Odoo Facturation & Licences',
        category: 'ERP',
        eventsSummary: 'Vérification automatique de situation contrat et licences actives',
        active: false,
        syncCount: 0,
        lastSyncAt: 'Jamais synchronisé',
        lastStatus: 'Disponible',
      },
      {
        id: `int_${prefix}_wh_crm`,
        kind: 'webhook',
        provider: 'CRM Webhook',
        name: 'Sync Tickets vers CRM Interne',
        category: 'CRM',
        endpointUrl: 'https://httpbin.org/post',
        eventsSummary: 'ticket.created, ticket.escalated, sla.warning_80pct',
        active: true,
        syncCount: 47,
        lastSyncAt: 'Il y a 38 min',
        lastStatus: 'HTTP 200 · 142 ms',
      },
      {
        id: `int_${prefix}_wh_erp`,
        kind: 'webhook',
        provider: 'ERP / Jira Webhook',
        name: 'Escalades N3 vers Jira & ERP',
        category: 'ERP / Jira',
        endpointUrl: 'https://httpbin.org/post',
        eventsSummary: 'incident.recurring_detected, ticket.resolved, csat.submitted',
        active: true,
        syncCount: 23,
        lastSyncAt: 'Il y a 2 h',
        lastStatus: 'HTTP 200 · 168 ms',
      },
    ];

    for (const item of integrationsSeed) {
      const { id, ...rest } = item;
      batch3.set(doc(db, 'integrations', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const auditSeed = [
      {
        id: `aud_${prefix}_1`,
        actorName: 'Superviseur ZentraDesk',
        actorRole: 'admin',
        action: 'Activation connecteur Salesforce CRM',
        category: 'integration',
        targetLabel: 'Salesforce CRM Enterprise',
        details: 'Synchronisation bidirectionnelle des fiches VIP activée.',
      },
      {
        id: `aud_${prefix}_2`,
        actorName: 'Claire Moreau',
        actorRole: 'supervisor',
        action: 'Publication article multilingue KB',
        category: 'kb',
        targetLabel: 'Débloquer un compte MFA',
        details: 'Article publié sur le portail libre-service (FR / EN).',
      },
      {
        id: `aud_${prefix}_3`,
        actorName: 'Superviseur ZentraDesk',
        actorRole: 'admin',
        action: 'Politique de rétention RGPD configurée',
        category: 'rgpd',
        targetLabel: 'Workspace Global',
        details: 'Conservation fixée à 730 jours et anonymisation à 365 jours après clôture.',
      },
    ];

    for (const log of auditSeed) {
      const { id, ...rest } = log;
      batch3.set(doc(db, 'auditLogs', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
      });
    }
  }

  if (cfgCheck.empty) {
    batch3.set(doc(db, 'workspaceConfigs', `cfg_${prefix}`), {
      defaultLanguage: 'fr',
      gdprRetentionDays: 730,
      anonymizeClosedAfterDays: 365,
      apiKeyPrefix: `zd_live_${prefix.slice(0, 6)}`,
      agentPermissions: ['tickets_manage', 'kb_publish'],
      supervisorPermissions: [
        'tickets_manage',
        'reports_export',
        'wfm_oncall',
        'qa_evaluate',
        'kb_publish',
      ],
      adminPermissions: [
        'tickets_manage',
        'reports_export',
        'wfm_oncall',
        'qa_evaluate',
        'kb_publish',
        'integrations_api',
        'gdpr_privacy',
        'rbac_admin',
      ],
      smartRoutingEnabled: true,
      smartRoutingPrioritizeTense: true,
      smartRoutingRespectAvailability: true,
      smartRoutingMaxLoadPct: 85,
      slaAlertThresholdPct: 80,
      ownerId: uid,
      memberIds,
      updatedAt: serverTimestamp(),
    });
  }

  if (annCheck.empty) {
    const annotationsSeed = [
      {
        id: `ann_${prefix}_infra`,
        title: 'Bascule relais Nord-Est (Incident N3)',
        notes: 'Perte temporaire de connectivité sur 14 terminaux Alpine Logistique — bascule sur passerelle secours en 18 min.',
        color: 'red',
        categoryLabel: 'Incident majeur',
        targetChart: 'operations_timeline',
        anchorLabel: 'J-2',
        positionPct: 67,
        eventDate: shiftIso(-2),
        authorName: aThomas.name,
      },
      {
        id: `ann_${prefix}_horszone`,
        title: 'Pic d’appels clients hors zone',
        notes: 'Forte sollicitation CTI suite aux alertes réseau en zone blanche — renfort astreinte activé.',
        color: 'amber',
        categoryLabel: 'Pic hors zone',
        targetChart: 'capacity_bars',
        anchorLabel: aNadia.name,
        positionPct: 78,
        eventDate: shiftIso(-1),
        authorName: aClaire.name,
      },
      {
        id: `ann_${prefix}_mfa`,
        title: 'Audit déblocage MFA & SSO v4.2',
        notes: 'Correctif déployé sur les jetons SSO afin de réduire les verrouillages répétés de mots de passe.',
        color: 'blue',
        categoryLabel: 'Maintenance / Déploiement',
        targetChart: 'client_health_donut',
        anchorLabel: 'Mot de passe bloqué',
        positionPct: 50,
        eventDate: shiftIso(0),
        authorName: aLucas.name,
      },
    ];

    for (const ann of annotationsSeed) {
      const { id, ...rest } = ann;
      batch3.set(doc(db, 'chartAnnotations', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  if (reportCheck.empty) {
    const reportsSeed = [
      {
        id: `rep_${prefix}_1`,
        shiftLabel: `Aujourd’hui (08:00 — 20:00) — ${aThomas.name}`,
        agentName: aThomas.name,
        entryType: 'incident',
        severity: 'critical',
        ticketRef: t1.reference,
        title: 'Latence élevée sur le relais VPN Nord-Est (terminaux hors zone)',
        details:
          'Bascule préventive effectuée sur la passerelle secondaire Nord-02 à 19:20. Les 14 terminaux Véloce Distribution Nord ont resynchronisé leurs bordereaux sous 6 minutes.',
        timeSpentMinutes: 25,
        handoverRequired: true,
        status: 'open',
        occurredAtLabel: '19:20',
      },
      {
        id: `rep_${prefix}_2`,
        shiftLabel: `Aujourd’hui (08:00 — 20:00) — ${aThomas.name}`,
        agentName: aClaire.name,
        entryType: 'action',
        severity: 'info',
        ticketRef: t2.reference,
        title: 'Vérification verrouillage SSO/MFA sur compte VIP HexaPay',
        details:
          'Déblocage effectué avec envoi du lien de ré-enrôlement TOTP valide 20 minutes. Authentification confirmée par l’administrateur client.',
        timeSpentMinutes: 12,
        handoverRequired: false,
        status: 'resolved',
        occurredAtLabel: '20:05',
      },
      {
        id: `rep_${prefix}_3`,
        shiftLabel: `Aujourd’hui (08:00 — 20:00) — ${aThomas.name}`,
        agentName: aThomas.name,
        entryType: 'handover',
        severity: 'warning',
        ticketRef: t3.reference,
        title: 'Consigne relève : surveiller la reprise réseau vallée Tarentaise',
        details:
          'Alpine Logistique reste en mode cache hors-ligne 72h sur 2 véhicules. Relancer un test ping demain matin à 08:15 et clôturer si nominal.',
        timeSpentMinutes: 10,
        handoverRequired: true,
        status: 'handed_over',
        occurredAtLabel: '21:10',
      },
    ];

    for (const rep of reportsSeed) {
      const { id, ...rest } = rep;
      batch3.set(doc(db, 'onCallReports', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  if (pdfCheck.empty) {
    const pdfSeed = [
      {
        id: `pdf_${prefix}_runbook_horszone`,
        title: 'Runbook N3 — Diagnostic Terminaux Hors Zone & Cache 72h',
        fileName: 'Runbook_N3_Hors_Zone_Cache_72h.pdf',
        fileSizeBytes: 428600,
        pageCount: 2,
        category: 'Hors zone / Connectivité',
        language: 'fr',
        tags: ['runbook', 'hors-zone', 'vpn', 'n3'],
        extractedText:
          '--- Page 1 ---\nRUNBOOK OPERATIONNEL N3 : GESTION DES TERMINAUX HORS ZONE\n1. Vérifier l’état de la passerelle régionale sur le moniteur d’astreinte.\n2. Si la couverture GSM/4G est absente, le terminal passe automatiquement en mode tampon local chiffré (capacité 72 heures).\n3. Ne jamais réinitialiser le cache local avant la confirmation d’un upload complet.\n\n--- Page 2 ---\nPROCEDURE DE REPRISE ET ESCALADE\n- Dès le retour en couverture, la file d’attente remonte par lots de 50 opérations.\n- En cas d’échec répété après 3 tentatives, basculer le client sur le relais secondaire et consigner la référence dans le rapport d’astreinte.',
        agentNotes:
          'Point important à ajouter dans la FAQ client : préciser de ne surtout pas vider le cache application pendant une coupure réseau.',
        readingProgressPct: 50,
        lastReadPage: 1,
        kbContributionStatus: 'drafting',
        uploadedBy: aThomas.name,
      },
      {
        id: `pdf_${prefix}_mfa_policy`,
        title: 'Guide Sécurité SSO & Réinitialisation MFA Entreprise v4.2',
        fileName: 'Guide_Securite_SSO_MFA_v4_2.pdf',
        fileSizeBytes: 312400,
        pageCount: 2,
        category: 'Mot de passe bloqué',
        language: 'fr',
        tags: ['sso', 'mfa', 'securite', 'acces'],
        extractedText:
          '--- Page 1 ---\nPOLITIQUE DE DEBLOCAGE DES COMPTES ADMINISTRATEURS\nAprès 5 échecs consécutifs de jeton TOTP ou mot de passe, le compte bascule en verrouillage préventif pendant 30 minutes.\n\n--- Page 2 ---\nVALIDATION IDENTITE & RE-ENROLEMENT\nL’agent N1 doit valider deux facteurs de contact (téléphone enregistré + email secondaire) avant de générer le lien temporaire de 20 minutes.',
        agentNotes:
          'Déjà utilisé pour mettre à jour la procédure MFA standard du portail.',
        readingProgressPct: 100,
        lastReadPage: 2,
        kbContributionStatus: 'integrated',
        linkedKbArticleId: `kb_${prefix}_pwd`,
        linkedKbArticleTitle: 'Débloquer un compte et réinitialiser la double authentification (MFA)',
        uploadedBy: aClaire.name,
      },
    ];

    for (const pdfDoc of pdfSeed) {
      const { id, ...rest } = pdfDoc;
      batch3.set(doc(db, 'kbPdfDocuments', id), {
        ...rest,
        ownerId: uid,
        memberIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch3.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'extended_modules_seed');
  }
}
