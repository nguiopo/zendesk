import 'dotenv/config';
import express, { Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY manquante dans les secrets du serveur.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface PresenceState {
  clientId: string;
  agentName: string;
  agentEmail: string;
  status: 'online' | 'in_call' | 'on_call';
  activeTicketId: string | null;
  typingTicketId: string | null;
  lastSeenAt: number;
}

interface TeamChatMessage {
  id: string;
  authorName: string;
  authorRole: string;
  ticketRef?: string;
  body: string;
  createdAt: string;
}

const presenceMap = new Map<WebSocket, PresenceState>();
const teamChatHistory: TeamChatMessage[] = [
  {
    id: 'msg-init-1',
    authorName: 'Claire Moreau',
    authorRole: 'Lead N2 Plateforme',
    ticketRef: 'ZD-2041',
    body: 'Attention équipe : hausse des signalements "hors zone" sur le secteur Nord-Est depuis 10h15. Thomas vérifie le relais primaire.',
    createdAt: new Date(Date.now() - 28 * 60 * 1000).toISOString(),
  },
  {
    id: 'msg-init-2',
    authorName: 'Thomas Laurent',
    authorRole: 'Astreinte N3 Infra',
    ticketRef: 'ZD-2041',
    body: 'Relais Nord-Est confirmé en dégradation partielle. Règle d’automatisation activée pour regrouper les tickets enfants.',
    createdAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
  },
];

function broadcastWs(wss: WebSocketServer, payload: Record<string, unknown>, exclude?: WebSocket) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

function getPresenceSnapshot(): Omit<PresenceState, 'clientId'>[] {
  const unique = new Map<string, Omit<PresenceState, 'clientId'>>();
  for (const state of presenceMap.values()) {
    unique.set(state.agentEmail || state.agentName, {
      agentName: state.agentName,
      agentEmail: state.agentEmail,
      status: state.status,
      activeTicketId: state.activeTicketId,
      typingTicketId: state.typingTicketId,
      lastSeenAt: state.lastSeenAt,
    });
  }
  return Array.from(unique.values());
}

export const app = express();

function registerRoutes() {
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  // SSRF-safe Webhook Test Dispatch Endpoint (CRM / ERP / Jira)
  app.post('/api/webhooks/test', async (req: Request, res: Response) => {
    const isPrivateIp = (ip: string): boolean => {
      if (net.isIPv4(ip)) {
        const parts = ip.split('.').map(Number);
        const [a, b] = parts;
        return (
          a === 0 ||
          a === 10 ||
          a === 127 ||
          (a === 169 && b === 254) ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) ||
          (a === 100 && b >= 64 && b <= 127)
        );
      }
      const normalized = ip.toLowerCase();
      return (
        normalized === '::1' ||
        normalized === '::' ||
        normalized.startsWith('fe80:') ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd')
      );
    };

    try {
      const { endpointUrl, provider, eventName } = req.body ?? {};
      if (typeof endpointUrl !== 'string' || !endpointUrl.trim()) {
        res.status(400).json({ error: 'URL de webhook requise.' });
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(endpointUrl.trim());
      } catch {
        res.status(400).json({ error: 'Format d’URL invalide.' });
        return;
      }

      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        res.status(400).json({ error: 'Seuls les protocoles HTTP/HTTPS sont autorisés.' });
        return;
      }

      const hostname = parsedUrl.hostname.toLowerCase();
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        (net.isIP(hostname) !== 0 && isPrivateIp(hostname))
      ) {
        res.status(400).json({ error: 'Les adresses locales ou privées sont bloquées par sécurité.' });
        return;
      }

      const resolved = await dns.lookup(hostname, { all: true });
      if (!resolved.length || resolved.some((entry) => isPrivateIp(entry.address))) {
        res.status(400).json({ error: 'Destination réseau privée non autorisée.' });
        return;
      }

      const payload = JSON.stringify({
        event: String(eventName || 'ticket.updated').slice(0, 60),
        provider: String(provider || 'ZentraDesk Webhook').slice(0, 80),
        timestamp: new Date().toISOString(),
        sampleTicket: {
          reference: 'ZD-TEST-001',
          priority: 'high',
          status: 'open',
        },
      });

      const ephemeralKey = crypto.randomBytes(16).toString('hex');
      const signature = crypto.createHmac('sha256', ephemeralKey).update(payload).digest('hex');

      const start = Date.now();
      const upstream = await fetch(parsedUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ZentraDesk-Event': String(eventName || 'ticket.test').slice(0, 60),
          'X-ZentraDesk-Signature': `sha256=${signature}`,
        },
        body: payload,
        redirect: 'error',
        signal: AbortSignal.timeout(4500),
      });

      res.json({
        ok: upstream.ok,
        statusCode: upstream.status,
        latencyMs: Date.now() - start,
        message: upstream.ok
          ? `HTTP ${upstream.status} reçu en ${Date.now() - start} ms`
          : `Réponse distante HTTP ${upstream.status}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur réseau lors du test webhook.';
      res.status(502).json({ ok: false, statusCode: 0, error: message });
    }
  });

  // AI Route 1: Automatic Ticket Triage & Smart Routing (Sentiment + Availability)
  app.post('/api/ai/triage', async (req: Request, res: Response) => {
    try {
      const { subject, description, channel, clientName, agents, activeIncidents, smartRoutingPolicy } = req.body ?? {};
      if (!subject || !description) {
        res.status(400).json({ error: 'Le sujet et la description du ticket sont requis pour le routage IA.' });
        return;
      }

      const policy = {
        prioritizeTenseSentiment: smartRoutingPolicy?.prioritizeTenseSentiment !== false,
        respectAvailability: smartRoutingPolicy?.respectAvailability !== false,
        maxAgentLoadPct: Math.min(100, Math.max(50, Number(smartRoutingPolicy?.maxAgentLoadPct) || 85)),
      };

      const rawAgents = Array.isArray(agents) ? (agents as Array<Record<string, unknown>>) : [];
      const agentContext = rawAgents.length > 0
        ? rawAgents.map((a) => {
            const active = Number(a.activeTickets) || 0;
            const max = Math.max(1, Number(a.maxConcurrentTickets) || 6);
            const loadPct = Math.round((active / max) * 100);
            return `- ${a.name} (id: ${a.id}, groupe: ${a.group}, dispo: ${a.availability}, charge: ${active}/${max} (${loadPct}%), csat: ${a.csatScore ?? 4.7}, compétences: ${a.skills ?? ''})`;
          }).join('\n')
        : 'Aucun agent fourni';

      const incidentContext = Array.isArray(activeIncidents) && activeIncidents.length > 0
        ? activeIncidents.join(', ')
        : 'Aucun incident récurrent actif connu';

      const policyInstructions = [
        policy.respectAvailability
          ? `RÈGLE DISPONIBILITÉ : Privilégie impérativement un agent dont la disponibilité est "available" ou "on_call" et dont la charge est <= ${policy.maxAgentLoadPct}%. Évite les agents "off_duty", "in_call" ou "busy" sauf si aucun agent disponible n'existe.`
          : 'RÈGLE DISPONIBILITÉ : Affecte au meilleur spécialiste du groupe cible.',
        policy.prioritizeTenseSentiment
          ? 'RÈGLE SENTIMENT IA : Évalue la tension émotionnelle (tense, concerned, neutral, positive) et un score tensionScore (0-100). Si le client est tendu/frustré/en colère ("tense"), élève la priorité à "high" ou "critical" et privilégie un agent disponible avec un CSAT élevé.'
          : 'RÈGLE SENTIMENT IA : Évalue le sentiment client sans modifier automatiquement la priorité.',
      ].join('\n');

      const ai = getGeminiClient();
      const prompt = `Tu es le moteur de Smart Routing d'une plateforme Helpdesk française (ZentraDesk).
Analyse la demande client suivante et détermine le routage optimal, la priorité SLA, le niveau de sentiment, le risque de problème technique récurrent et un brouillon de réponse en français.

${policyInstructions}

Ticket entrant:
- Client: ${String(clientName ?? 'Client non précisé')}
- Canal: ${String(channel ?? 'email')}
- Sujet: ${String(subject)}
- Description: ${String(description)}

Équipe d'agents:
${agentContext}

Incidents récurrents en cours:
${incidentContext}

Choisis impérativement la catégorie exacte parmi :
"Mot de passe bloqué", "Hors zone / Connectivité", "Utilisation plateforme", "Assistance client", "Vérification situation", "Incident infrastructure"

Choisis le groupe exact parmi :
"N1 Accès & Comptes", "N2 Plateforme", "N3 Infrastructure", "Relation Client & CTI"

Choisis la priorité exacte parmi :
"critical", "high", "medium", "low"`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              category: {
                type: Type.STRING,
                enum: [
                  'Mot de passe bloqué',
                  'Hors zone / Connectivité',
                  'Utilisation plateforme',
                  'Assistance client',
                  'Vérification situation',
                  'Incident infrastructure',
                ],
              },
              priority: {
                type: Type.STRING,
                enum: ['critical', 'high', 'medium', 'low'],
              },
              assignedGroup: {
                type: Type.STRING,
                enum: ['N1 Accès & Comptes', 'N2 Plateforme', 'N3 Infrastructure', 'Relation Client & CTI'],
              },
              recommendedAgentId: { type: Type.STRING },
              recommendedAgentName: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              sentiment: { type: Type.STRING },
              sentimentLevel: {
                type: Type.STRING,
                enum: ['tense', 'concerned', 'neutral', 'positive'],
              },
              tensionScore: { type: Type.NUMBER },
              summary: { type: Type.STRING },
              isRecurringIncident: { type: Type.BOOLEAN },
              suggestedParentIncidentRef: { type: Type.STRING },
              routingReason: { type: Type.STRING },
              suggestedReply: { type: Type.STRING },
            },
            required: [
              'category',
              'priority',
              'assignedGroup',
              'recommendedAgentName',
              'confidence',
              'sentiment',
              'sentimentLevel',
              'tensionScore',
              'summary',
              'isRecurringIncident',
              'routingReason',
              'suggestedReply',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, unknown>;

      // Deterministic Smart Routing safeguard: enforce sentiment priority & agent availability
      const sentimentLevel = String(parsed.sentimentLevel || 'neutral');
      if (policy.prioritizeTenseSentiment && sentimentLevel === 'tense') {
        if (parsed.priority === 'low' || parsed.priority === 'medium') {
          parsed.priority = 'high';
        }
      }

      if (rawAgents.length > 0 && policy.respectAvailability) {
        const isReady = (a: Record<string, unknown>) =>
          a.availability === 'available' || a.availability === 'on_call';
        const loadRatio = (a: Record<string, unknown>) =>
          (Number(a.activeTickets) || 0) / Math.max(1, Number(a.maxConcurrentTickets) || 6);

        const chosen = rawAgents.find((a) => a.id === parsed.recommendedAgentId);
        const chosenReady = chosen && isReady(chosen) && loadRatio(chosen) * 100 <= policy.maxAgentLoadPct;

        if (!chosenReady) {
          const readyPool = rawAgents.filter((a) => isReady(a));
          const pool = readyPool.length > 0 ? readyPool : rawAgents.filter((a) => a.availability !== 'off_duty');
          const candidates = pool.length > 0 ? pool : rawAgents;

          const scored = [...candidates].sort((a, b) => {
            const aGroupMatch = a.group === parsed.assignedGroup ? 1 : 0;
            const bGroupMatch = b.group === parsed.assignedGroup ? 1 : 0;
            const aUnderCap = loadRatio(a) * 100 <= policy.maxAgentLoadPct ? 1 : 0;
            const bUnderCap = loadRatio(b) * 100 <= policy.maxAgentLoadPct ? 1 : 0;
            const aAvailScore = a.availability === 'available' ? 2 : a.availability === 'on_call' ? 1 : 0;
            const bAvailScore = b.availability === 'available' ? 2 : b.availability === 'on_call' ? 1 : 0;
            const scoreA = aAvailScore * 40 + aUnderCap * 30 + aGroupMatch * 25 - loadRatio(a) * 20;
            const scoreB = bAvailScore * 40 + bUnderCap * 30 + bGroupMatch * 25 - loadRatio(b) * 20;
            return scoreB - scoreA;
          });

          const best = scored[0];
          if (best) {
            parsed.recommendedAgentId = String(best.id);
            parsed.recommendedAgentName = String(best.name);
          }
        }
      }

      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors du routage IA Gemini.';
      console.error('AI Triage Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // AI Route 2: Smart Grounded Reply Draft for Agents (Latest Client Messages + Knowledge Base)
  app.post('/api/ai/draft-reply', async (req: Request, res: Response) => {
    try {
      const {
        reference,
        subject,
        description,
        category,
        clientName,
        recentEvents,
        clientMessages,
        kbArticles,
        mode,
        locale,
      } = req.body ?? {};
      if (!subject) {
        res.status(400).json({ error: 'Le contexte du ticket est requis.' });
        return;
      }

      const ai = getGeminiClient();
      const targetLangLabel =
        locale === 'en' ? 'anglais' : locale === 'es' ? 'espagnol' : 'français';

      const rawEvents = Array.isArray(recentEvents)
        ? (recentEvents as Array<Record<string, unknown>>)
        : [];

      const extractedClientMessages =
        Array.isArray(clientMessages) && clientMessages.length > 0
          ? (clientMessages as Array<Record<string, unknown>>)
              .slice(-5)
              .map(
                (m) =>
                  `- ${String(m.authorName || clientName || 'Client')}: ${String(m.body || '').slice(0, 700)}`
              )
              .join('\n')
          : rawEvents
              .filter((e) => e.authorRole === 'client')
              .slice(-5)
              .map(
                (e) =>
                  `- ${String(e.authorName || clientName || 'Client')}: ${String(e.body || '').slice(0, 700)}`
              )
              .join('\n');

      const historyText = rawEvents
        .slice(-8)
        .map(
          (e) =>
            `[${String(e.visibility || 'public')} · ${String(e.authorRole || 'agent')}] ${String(e.authorName || '')}: ${String(e.body || '').slice(0, 500)}`
        )
        .join('\n');

      const rawKb = Array.isArray(kbArticles)
        ? (kbArticles as Array<Record<string, unknown>>).slice(0, 5)
        : [];
      const kbContext =
        rawKb.length > 0
          ? rawKb
              .map(
                (a) =>
                  `- Titre: "${String(a.title || '')}" (Catégorie: ${String(a.category || '')})\n  Résumé: ${String(a.summary || '').slice(0, 240)}\n  Procédure: ${String(a.body || '').slice(0, 700)}`
              )
              .join('\n\n')
          : 'Aucun article de base de connaissances pertinent fourni.';

      const instruction =
        mode === 'internal'
          ? `Rédige en ${targetLangLabel} une note interne concise et structurée pour les collègues agents avec les étapes de vérification technique recommandées d'après les derniers messages du client et la base de connaissances.`
          : `Rédige en ${targetLangLabel} une proposition de réponse client claire, empathique, professionnelle et directement prête à être envoyée (sans placeholders entre crochets comme [Nom]), en répondant précisément aux derniers messages du client et en intégrant les étapes utiles issues de la base de connaissances.`;

      const prompt = `Tu es l'assistant de rédaction expert du centre de support ZentraDesk.
${instruction}

Ticket: ${String(reference || '')}
Client: ${String(clientName ?? 'Client')}
Catégorie: ${String(category ?? 'Assistance client')}
Sujet: ${String(subject)}

Message initial du client:
${String(description ?? '').slice(0, 1200)}

Derniers messages du client (prioritaires pour la réponse):
${extractedClientMessages || 'Aucun message client additionnel après la demande initiale — réponds directement à la demande initiale ci-dessus.'}

Chronologie récente complète:
${historyText || 'Aucun autre échange enregistré.'}

Base de connaissances disponible:
${kbContext}

Consignes strictes:
- Appuie-toi concrètement sur les derniers messages du client et sur les procédures exactes de la base de connaissances ci-dessus.
- N'invente ni URL, ni identifiant, ni garantie contractuelle non présente dans le contexte.
- Retourne dans "usedKbTitles" uniquement les titres exacts des articles KB ci-dessus que tu as réellement utilisés (tableau vide si aucun).
- Retourne dans "rationale" une phrase courte résumant ce que la réponse adresse.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              draft: { type: Type.STRING },
              usedKbTitles: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              rationale: { type: Type.STRING },
            },
            required: ['draft', 'usedKbTitles', 'rationale'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        draft?: string;
        usedKbTitles?: string[];
        rationale?: string;
      };

      res.json({
        draft: String(parsed.draft ?? '').trim(),
        usedKbTitles: Array.isArray(parsed.usedKbTitles) ? parsed.usedKbTitles : [],
        rationale: String(parsed.rationale ?? '').trim(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erreur lors de la génération de réponse IA.';
      console.error('AI Draft Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // AI Route 3: Proactive Analytical Brief for Support Managers
  app.post('/api/ai/analytics-brief', async (req: Request, res: Response) => {
    try {
      const { metricsSummary } = req.body ?? {};
      if (!metricsSummary) {
        res.status(400).json({ error: 'Les métriques de performance sont requises.' });
        return;
      }

      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Tu es analyste opérationnel Support Client. À partir des données réelles ci-dessous, produis un diagnostic exécutif concis en français structuré en 3 volets :
1. Points de vigilance SLA & incidents récurrents
2. Capacité de l'équipe (appels, hors zone, déblocages mot de passe, utilisation plateforme)
3. Actions proactives immédiates recommandées (incluant astreintes)

Données:
${JSON.stringify(metricsSummary, null, 2)}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING },
              slaRiskAssessment: { type: Type.STRING },
              capacityInsight: { type: Type.STRING },
              proactiveActions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['headline', 'slaRiskAssessment', 'capacityInsight', 'proactiveActions'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l’analyse IA.';
      console.error('AI Analytics Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // AI Route 4: Conversational AI Chatbot (Autonomous resolution + Human Agent Handoff)
  app.post('/api/ai/chatbot', async (req: Request, res: Response) => {
    try {
      const { messages, kbArticles, clientSummary, openTicketsSummary } = req.body ?? {};
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'L’historique de conversation est requis.' });
        return;
      }

      const ai = getGeminiClient();
      const convoText = messages
        .slice(-10)
        .map((m: Record<string, unknown>) => `${m.sender === 'user' ? 'Client' : 'Assistant IA'}: ${String(m.text || '').slice(0, 800)}`)
        .join('\n');

      const kbContext = Array.isArray(kbArticles)
        ? kbArticles
            .slice(0, 8)
            .map((a: Record<string, unknown>) => `- [${String(a.category || '')}] ${String(a.title || '')}: ${String(a.summary || '').slice(0, 220)}`)
            .join('\n')
        : 'Aucun article KB disponible';

      const prompt = `Tu es l'agent IA conversationnel officiel de ZentraDesk (Helpdesk Enterprise).
Ton objectif : résoudre de manière autonome les demandes courantes en français (réinitialisation/déblocage mot de passe & MFA, guidage plateforme, statut ticket/SLA, vérifications hors zone) en t'appuyant sur la Base de connaissances et le contexte client ci-dessous.
Si la demande est complexe, critique (panne multi-sites, urgence contractuelle) ou si l'utilisateur demande un conseiller humain, indique clairement "needsHumanHandoff: true" et propose le transfert fluide vers un agent humain.

Contexte client actif:
${String(clientSummary || 'Client authentifié')}

Tickets récents du client:
${String(openTicketsSummary || 'Aucun ticket ouvert fourni')}

Base de connaissances disponible:
${kbContext}

Conversation en cours:
${convoText}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              resolvedAutonomously: { type: Type.BOOLEAN },
              suggestedAction: {
                type: Type.STRING,
                enum: ['none', 'unlock_password', 'check_sla', 'read_kb', 'handoff_human'],
              },
              needsHumanHandoff: { type: Type.BOOLEAN },
              handoffReason: { type: Type.STRING },
              handoffCategory: {
                type: Type.STRING,
                enum: [
                  'Mot de passe bloqué',
                  'Hors zone / Connectivité',
                  'Utilisation plateforme',
                  'Assistance client',
                  'Vérification situation',
                  'Incident infrastructure',
                ],
              },
              handoffPriority: {
                type: Type.STRING,
                enum: ['critical', 'high', 'medium', 'low'],
              },
              referencedArticleTitle: { type: Type.STRING },
            },
            required: [
              'reply',
              'resolvedAutonomously',
              'suggestedAction',
              'needsHumanHandoff',
              'handoffCategory',
              'handoffPriority',
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la réponse du chatbot IA.';
      console.error('AI Chatbot Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // AI Route 5: Agent Copilot (Real-time conversation summary, next actions & KB-grounded reply)
  app.post('/api/ai/copilot', async (req: Request, res: Response) => {
    try {
      const { ticket, events, kbArticles } = req.body ?? {};
      if (!ticket || !ticket.subject) {
        res.status(400).json({ error: 'Le ticket actif est requis pour le Copilote IA.' });
        return;
      }

      const ai = getGeminiClient();
      const timeline = Array.isArray(events)
        ? events
            .slice(-8)
            .map((e: Record<string, unknown>) => `[${String(e.visibility || 'public')}] ${String(e.authorName || '')}: ${String(e.body || '').slice(0, 500)}`)
            .join('\n')
        : '';

      const kbContext = Array.isArray(kbArticles)
        ? kbArticles
            .slice(0, 5)
            .map((a: Record<string, unknown>) => `- ${String(a.title || '')}: ${String(a.summary || '').slice(0, 220)}`)
            .join('\n')
        : '';

      const prompt = `Tu es le Copilote IA temps réel intégré dans l'espace de travail des agents support ZentraDesk.
Analyse ce ticket, sa chronologie et les articles KB pertinents pour fournir :
1. Un résumé exécutif ultra-clair de la conversation en 2-3 phrases
2. 2 ou 3 prochaines actions concrètes pour l'agent
3. Une proposition de réponse client prête à envoyer, professionnelle et contextualisée en français
4. Le ton/sentiment détecté chez le client

Ticket ${String(ticket.reference || '')} (${String(ticket.priority || 'medium')} · ${String(ticket.category || '')}):
Client: ${String(ticket.clientName || '')}
Sujet: ${String(ticket.subject || '')}
Description: ${String(ticket.description || '').slice(0, 1200)}

Chronologie:
${timeline || 'Aucun échange complémentaire encore enregistré.'}

Articles KB pertinents:
${kbContext || 'Aucun article lié.'}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              conversationSummary: { type: Type.STRING },
              nextBestActions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              suggestedReply: { type: Type.STRING },
              toneDetected: { type: Type.STRING },
            },
            required: ['conversationSummary', 'nextBestActions', 'suggestedReply', 'toneDetected'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur du Copilote IA.';
      console.error('AI Copilot Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // AI Route 6: Dedicated Ticket Conversation Summary via Gemini API
  app.post('/api/ai/summarize-conversation', async (req: Request, res: Response) => {
    try {
      const { ticket, events } = req.body ?? {};
      if (!ticket || !ticket.subject) {
        res.status(400).json({ error: 'Les détails du ticket sont requis pour générer le résumé IA.' });
        return;
      }

      const ai = getGeminiClient();
      const conversationLines = Array.isArray(events)
        ? events
            .slice(-25)
            .map((e: Record<string, unknown>) => {
              const scope = e.visibility === 'internal' ? 'Note interne' : 'Échange public';
              return `- [${scope} · ${String(e.authorRole || 'agent')}] ${String(e.authorName || 'Intervenant')}: ${String(e.body || '').slice(0, 700)}`;
            })
            .join('\n')
        : '';

      const prompt = `Tu es l'assistant de synthèse de ZentraDesk. Génère un résumé structuré et fidèle en français de la conversation ci-dessous pour permettre à un agent support de comprendre immédiatement la situation.

Ticket: ${String(ticket.reference || '')}
Client: ${String(ticket.clientName || '')}
Catégorie: ${String(ticket.category || '')} · Priorité: ${String(ticket.priority || '')} · Statut: ${String(ticket.status || '')}
Sujet: ${String(ticket.subject || '')}
Message initial:
${String(ticket.description || '').slice(0, 1500)}

Fil de conversation complet:
${conversationLines || 'Aucun message supplémentaire après la demande initiale.'}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              keyPoints: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              clientSentiment: { type: Type.STRING },
              recommendedNextStep: { type: Type.STRING },
            },
            required: ['summary', 'keyPoints', 'clientSentiment', 'recommendedNextStep'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json({
        ...parsed,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erreur lors de la génération du résumé IA Gemini.';
      console.error('AI Summary Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // AI Route 7: Convert saved PDF + reading notes into a structured KB article draft
  app.post('/api/ai/pdf-to-kb', async (req: Request, res: Response) => {
    try {
      const { title, category, language, extractedText, agentNotes, existingArticleTitle } =
        req.body ?? {};
      if (!title || (!extractedText && !agentNotes)) {
        res.status(400).json({
          error: 'Le titre et le contenu du PDF (ou des notes de lecture) sont requis.',
        });
        return;
      }

      const ai = getGeminiClient();
      const targetLangLabel =
        language === 'en' ? 'anglais' : language === 'es' ? 'espagnol' : 'français';

      const prompt = `Tu es le responsable éditorial de la Base de connaissances de ZentraDesk (Helpdesk Support Enterprise).
Transforme ce document PDF technique et les notes de lecture de l'agent helpdesk en un article de base de connaissances clair, structuré et actionnable pour améliorer le support client et l'auto-résolution.

Titre source du PDF : ${String(title).slice(0, 200)}
Catégorie souhaitée : ${String(category || 'Utilisation plateforme').slice(0, 100)}
Langue de rédaction cible : ${targetLangLabel}
${existingArticleTitle ? `Article KB existant à enrichir : ${String(existingArticleTitle).slice(0, 200)}` : ''}

Notes et observations de l'agent helpdesk :
${String(agentNotes || 'Aucune note spécifique ajoutée.').slice(0, 3000)}

Texte extrait du PDF :
${String(extractedText || '').slice(0, 12000)}

Consignes :
- Rédige un titre précis, un résumé court (1-2 phrases), et un corps structuré en étapes numérotées / points de contrôle concrets.
- Propose 3 à 5 mots-clés pertinents (sans #).`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
              body: { type: Type.STRING },
              category: { type: Type.STRING },
              articleType: {
                type: Type.STRING,
                enum: ['article', 'faq', 'guide'],
              },
              tags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['title', 'summary', 'body', 'category', 'articleType', 'tags'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Erreur lors de la synthèse du PDF vers la Base de connaissances.';
      console.error('AI PDF-to-KB Error:', message);
      res.status(500).json({ error: message });
    }
  });

  // AI Route 8: Dedicated Ticket Content Sentiment Analysis
  app.post('/api/ai/sentiment', async (req: Request, res: Response) => {
    try {
      const { subject, description, recentEvents, locale } = req.body ?? {};
      if (!subject && !description) {
        res.status(400).json({ error: 'Le sujet ou la description du ticket est requis.' });
        return;
      }

      const ai = getGeminiClient();
      const eventsText = Array.isArray(recentEvents)
        ? recentEvents
            .slice(-8)
            .map(
              (e: Record<string, unknown>) =>
                `[${String(e.authorRole || 'client')}] ${String(e.body || '').slice(0, 400)}`
            )
            .join('\n')
        : '';

      const langLabel =
        locale === 'en' ? 'anglais' : locale === 'es' ? 'espagnol' : 'français';

      const prompt = `Tu es un moteur d'analyse de sentiment pour un centre de support client (Helpdesk).
Analyse le ton émotionnel et le niveau de tension de l'échange client ci-dessous (sujet, description et réponses récentes).

Sujet: ${String(subject || '').slice(0, 240)}
Description: ${String(description || '').slice(0, 1500)}
Messages récents:
${eventsText || 'Aucun message complémentaire.'}

Classe le niveau exact parmi:
- "tense" (client frustré, en colère, bloqué en situation critique ou ton conflictuel/urgent)
- "concerned" (client pressé, inquiet ou contraint par un délai)
- "neutral" (demande factuelle et calme)
- "positive" (ton constructif, reconnaissant ou satisfait)

Fournis un libellé court (aiSentiment <= 50 caractères en ${langLabel}, ex: "Frustré — Échange tendu", "Pressé — Contrainte délai", "Neutre", "Constructif") et un score de tension de 0 à 100.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              level: {
                type: Type.STRING,
                enum: ['tense', 'concerned', 'neutral', 'positive'],
              },
              aiSentiment: { type: Type.STRING },
              tensionScore: { type: Type.INTEGER },
              reason: { type: Type.STRING },
            },
            required: ['level', 'aiSentiment', 'tensionScore', 'reason'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erreur lors de l’analyse de sentiment Gemini.';
      console.error('AI Sentiment Error:', message);
      res.status(500).json({ error: message });
    }
  });

}

registerRoutes();

async function startServer() {
  const server = http.createServer(app);

  // Real-time WebSocket Server for Agent Collaboration & Presence
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    // Send initial team chat history and presence snapshot
    ws.send(
      JSON.stringify({
        type: 'init',
        presence: getPresenceSnapshot(),
        chatHistory: teamChatHistory.slice(-40),
      })
    );

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        const type = String(msg.type || '');

        if (type === 'presence:update') {
          const prev = presenceMap.get(ws);
          const next: PresenceState = {
            clientId: String(msg.clientId || prev?.clientId || Math.random().toString(36).slice(2)),
            agentName: String(msg.agentName || prev?.agentName || 'Agent'),
            agentEmail: String(msg.agentEmail || prev?.agentEmail || ''),
            status: (msg.status as PresenceState['status']) || prev?.status || 'online',
            activeTicketId:
              msg.activeTicketId === undefined ? prev?.activeTicketId ?? null : (msg.activeTicketId as string | null),
            typingTicketId:
              msg.typingTicketId === undefined ? prev?.typingTicketId ?? null : (msg.typingTicketId as string | null),
            lastSeenAt: Date.now(),
          };
          presenceMap.set(ws, next);
          broadcastWs(wss, { type: 'presence:sync', presence: getPresenceSnapshot() });
        } else if (type === 'chat:send') {
          const body = String(msg.body || '').trim().slice(0, 1000);
          if (!body) return;
          const chatMsg: TeamChatMessage = {
            id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            authorName: String(msg.authorName || 'Agent').slice(0, 80),
            authorRole: String(msg.authorRole || 'Support').slice(0, 60),
            ticketRef: msg.ticketRef ? String(msg.ticketRef).slice(0, 40) : undefined,
            body,
            createdAt: new Date().toISOString(),
          };
          teamChatHistory.push(chatMsg);
          if (teamChatHistory.length > 100) {
            teamChatHistory.shift();
          }
          broadcastWs(wss, { type: 'chat:message', message: chatMsg });
        } else if (type === 'ticket:activity') {
          broadcastWs(
            wss,
            {
              type: 'ticket:activity',
              ticketId: String(msg.ticketId || ''),
              ticketRef: String(msg.ticketRef || ''),
              agentName: String(msg.agentName || 'Un agent'),
              actionLabel: String(msg.actionLabel || 'a mis à jour le ticket'),
              timestamp: new Date().toISOString(),
            },
            ws
          );
        }
      } catch {
        // Ignore malformed socket frames
      }
    });

    ws.on('close', () => {
      presenceMap.delete(ws);
      broadcastWs(wss, { type: 'presence:sync', presence: getPresenceSnapshot() });
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`ZentraDesk server running on http://0.0.0.0:${PORT}`);
  });
}

// Sur Vercel, l'app Express est exportée et servie par api/index.ts
// (pas de listen ni de WebSocket en serverless).
if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
