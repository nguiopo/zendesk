import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, increment, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Check,
  Code2,
  Copy,
  FileText,
  Globe,
  Hash,
  Mail,
  MessageSquare,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Send,
  Share2,
  TicketPlus,
  Users,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AgentPresence,
  CallLog,
  ClientAccount,
  SlaPolicy,
  SupportAgent,
  TeamChatMessage,
  Ticket,
  TicketCategory,
  TicketChannel,
  TicketPriority,
} from '../types/helpdesk';
import { AGENT_AVAILABILITY_LABELS, formatDuration } from '../lib/formatters';
import { clampInt, clampString, sanitizeTicketCreatePayload } from '../lib/validation';
import {
  LIVE_CHAT_CONFIG_KEY,
  LiveChatWidgetConfig,
  loadLiveChatConfig,
} from './FloatingChatWidget';

interface CollaborationCallViewProps {
  uid: string;
  currentUserName: string;
  wsConnected: boolean;
  presence: AgentPresence[];
  chatMessages: TeamChatMessage[];
  onSendChat: (body: string, role?: string, ticketRef?: string) => void;
  callLogs: CallLog[];
  clients: ClientAccount[];
  agents: SupportAgent[];
  tickets?: Ticket[];
  slaPolicies?: SlaPolicy[];
  onOpenTicket?: (ticketId: string) => void;
}

type ChannelHubTab = 'chat_widget' | 'voip' | 'email_forms' | 'social_team';

interface SocialFeedItem {
  id: string;
  network: 'facebook' | 'twitter' | 'instagram' | 'whatsapp';
  networkLabel: string;
  handle: string;
  clientId?: string;
  message: string;
  receivedAt: string;
  convertedRef?: string;
}

export const CollaborationCallView: React.FC<CollaborationCallViewProps> = ({
  uid,
  currentUserName,
  wsConnected,
  presence,
  chatMessages,
  onSendChat,
  callLogs,
  clients,
  agents,
  tickets = [],
  slaPolicies = [],
  onOpenTicket,
}) => {
  const [subTab, setSubTab] = useState<ChannelHubTab>('chat_widget');
  const [hubNotice, setHubNotice] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  // Team WebSocket chat
  const [chatInput, setChatInput] = useState('');
  const [ticketRefInput, setTicketRefInput] = useState('');

  // Live Chat Widget config (synced with FloatingChatWidget via localStorage)
  const [widgetConfig, setWidgetConfig] = useState<LiveChatWidgetConfig>(() => loadLiveChatConfig());
  const [widgetSaved, setWidgetSaved] = useState(false);

  // Call log form
  const [callClientId, setCallClientId] = useState(clients[0]?.id || '');
  const [callAgentId, setCallAgentId] = useState(agents[0]?.id || '');
  const [callDirection, setCallDirection] = useState<'inbound' | 'outbound'>('inbound');
  const [callOutcome, setCallOutcome] = useState<'answered' | 'missed' | 'out_of_zone' | 'callback_scheduled'>('answered');
  const [callDurationSec, setCallDurationSec] = useState(180);
  const [callNotes, setCallNotes] = useState('');
  const [savingCall, setSavingCall] = useState(false);
  const [convertedCallRefs, setConvertedCallRefs] = useState<Record<string, string>>({});

  // Inbound Email simulator
  const [inboundFrom, setInboundFrom] = useState('support@hexapay.fr');
  const [inboundSubject, setInboundSubject] = useState('Alerte : blocage accès portail comptable');
  const [inboundBody, setInboundBody] = useState(
    'Bonjour, plusieurs utilisateurs reçoivent une erreur MFA depuis ce matin. Merci de vérifier notre compte.'
  );
  const [inboundClientId, setInboundClientId] = useState('');

  // Customizable Web Form builder
  const [webFormSlug, setWebFormSlug] = useState('support-entreprise');
  const [webFormTitle, setWebFormTitle] = useState('Formulaire Demande Technique & SLA');
  const [webFormClientId, setWebFormClientId] = useState('');
  const [webFormSubject, setWebFormSubject] = useState('');
  const [webFormMessage, setWebFormMessage] = useState('');
  const [webFormPriority, setWebFormPriority] = useState<TicketPriority>('high');

  // Social Media & Slack/Teams intake
  const [socialStream, setSocialStream] = useState<SocialFeedItem[]>([
    {
      id: 'soc-1',
      network: 'whatsapp',
      networkLabel: 'WhatsApp Business',
      handle: '+33 6 42 89 10 22 · Alpine Logistique',
      message: 'Bonjour, nos chauffeurs sur le secteur Savoie sont passés hors zone depuis 20 min, pouvez-vous vérifier le relais ?',
      receivedAt: 'Il y a 6 min',
    },
    {
      id: 'soc-2',
      network: 'twitter',
      networkLabel: 'Twitter / X',
      handle: '@HexaPay_Ops',
      message: '@ZentraDesk Impossible de valider le jeton SSO pour deux nouveaux collaborateurs avant la paie.',
      receivedAt: 'Il y a 18 min',
    },
    {
      id: 'soc-3',
      network: 'facebook',
      networkLabel: 'Facebook Messenger',
      handle: 'Clinique Médisys Lyon',
      message: 'Bonjour, comment exporter le rapport SLA mensuel depuis le portail admin ?',
      receivedAt: 'Il y a 34 min',
    },
    {
      id: 'soc-4',
      network: 'instagram',
      networkLabel: 'Instagram DM',
      handle: '@veloce_express_fr',
      message: 'Message direct reçu : demande d’accompagnement sur l’application mobile terrain.',
      receivedAt: 'Il y a 52 min',
    },
  ]);
  const [slackChannel, setSlackChannel] = useState('#support-escalades');
  const [slackCommandText, setSlackCommandText] = useState('/ticket Vérifier latence API CRM sur client VIP Nordic');

  useEffect(() => {
    if (!callClientId && clients.length > 0) setCallClientId(clients[0].id);
    if (!inboundClientId && clients.length > 0) setInboundClientId(clients[0].id);
    if (!webFormClientId && clients.length > 0) setWebFormClientId(clients[0].id);
    if (!callAgentId && agents.length > 0) setCallAgentId(agents[0].id);
  }, [clients, agents, callClientId, inboundClientId, webFormClientId, callAgentId]);

  const availableVoipAgents = useMemo(
    () => agents.filter((a) => a.availability === 'available' || a.availability === 'on_call'),
    [agents]
  );

  const showTempNotice = (msg: string) => {
    setHubNotice(msg);
    window.setTimeout(() => setHubNotice(null), 5000);
  };

  const handleCopy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedSnippet(label);
    window.setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const createOmnichannelTicket = async (params: {
    channel: TicketChannel;
    subject: string;
    description: string;
    clientId?: string;
    category?: TicketCategory;
    priority?: TicketPriority;
    tags?: string[];
  }): Promise<{ id: string; reference: string } | null> => {
    const client = clients.find((c) => c.id === params.clientId) || clients[0];
    if (!client) return null;

    const priority: TicketPriority = params.priority || 'medium';
    const matchedSla = slaPolicies.find((s) => s.priorityScope === priority) || slaPolicies[0];
    const targetAgent =
      agents.find((a) => a.availability === 'available') ||
      agents.find((a) => a.availability === 'on_call') ||
      agents[0];

    const reference = `ZD-${2070 + tickets.length + Math.floor(Math.random() * 20)}`;
    const now = Date.now();
    const payload = sanitizeTicketCreatePayload({
      reference,
      subject: clampString(params.subject, 240),
      description: clampString(params.description, 4000),
      channel: params.channel,
      status: priority === 'critical' ? 'escalated' : 'new',
      priority,
      category: params.category || 'Assistance client',
      clientId: client.id,
      clientName: client.companyName,
      assignedAgentId: targetAgent?.id,
      assignedAgentName: targetAgent?.name,
      assignedGroup: targetAgent?.group || 'Relation Client & CTI',
      slaPolicyId: matchedSla?.id,
      firstResponseDueMs: now + (matchedSla?.firstResponseMinutes ?? 45) * 60 * 1000,
      resolutionDueMs: now + (matchedSla?.resolutionMinutes ?? 360) * 60 * 1000,
      firstResponded: false,
      aiRouted: false,
      isRecurringIncident: params.category === 'Hors zone / Connectivité',
      tags: params.tags || [params.channel],
      ownerId: uid,
      memberIds: [uid],
    });

    try {
      const created = await addDoc(collection(db, 'tickets'), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, `tickets/${created.id}/events`), {
        ticketId: created.id,
        authorName: currentUserName,
        authorRole: 'system',
        visibility: 'internal',
        eventType: 'status_change',
        body: `Ticket créé via réception omnicanale (${params.channel}) et acheminé vers ${targetAgent?.name || 'l’équipe support'}.`,
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });
      return { id: created.id, reference };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tickets');
      return null;
    }
  };

  const handleSaveWidgetConfig = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      window.localStorage.setItem(LIVE_CHAT_CONFIG_KEY, JSON.stringify(widgetConfig));
      setWidgetSaved(true);
      window.setTimeout(() => setWidgetSaved(false), 2500);
    } catch {
      // ignore storage quota errors
    }
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSendChat(chatInput, 'Support', ticketRefInput.trim() || undefined);
    setChatInput('');
  };

  const handleLogCall = async (e: React.FormEvent) => {
    e.preventDefault();
    const client = clients.find((c) => c.id === callClientId);
    const agent = agents.find((a) => a.id === callAgentId);
    if (!client || !agent) return;
    setSavingCall(true);
    try {
      await addDoc(collection(db, 'callLogs'), {
        clientId: client.id,
        clientName: client.companyName,
        agentId: agent.id,
        agentName: agent.name,
        direction: callDirection,
        outcome: callOutcome,
        durationSeconds: clampInt(callDurationSec, 0, 86400),
        notes: clampString(callNotes || 'Appel enregistré dans le journal VoIP.', 500),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });

      const agentPatch: Record<string, unknown> = {
        callsHandled: increment(1),
        updatedAt: serverTimestamp(),
      };
      if (callOutcome === 'out_of_zone') {
        agentPatch.outOfZoneFollowups = increment(1);
      }
      await updateDoc(doc(db, 'agents', agent.id), agentPatch);

      if (callOutcome === 'out_of_zone') {
        await updateDoc(doc(db, 'clients', client.id), {
          outOfZoneSignal: true,
          healthStatus: 'out_of_zone',
          lastVerifiedNote: `Appel ${callDirection === 'outbound' ? 'sortant' : 'entrant'} hors zone par ${agent.name}.`,
          lastVerifiedAt: 'À l’instant',
          updatedAt: serverTimestamp(),
        });
      }

      setCallNotes('');
      showTempNotice(`Appel ${callDirection === 'inbound' ? 'entrant' : 'sortant'} journalisé pour ${client.companyName}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'callLogs');
    } finally {
      setSavingCall(false);
    }
  };

  const handleConvertCallToTicket = async (call: CallLog) => {
    const res = await createOmnichannelTicket({
      channel: 'phone',
      clientId: call.clientId,
      subject:
        call.outcome === 'out_of_zone'
          ? `Rappel client hors zone — ${call.clientName}`
          : `Appel manqué à rappeler — ${call.clientName}`,
      description: `Ticket généré automatiquement depuis le journal VoIP (${call.direction}, durée ${formatDuration(call.durationSeconds)}).\nAgent : ${call.agentName}\nNotes : ${call.notes || 'Aucune note'}`,
      category: call.outcome === 'out_of_zone' ? 'Hors zone / Connectivité' : 'Assistance client',
      priority: call.outcome === 'out_of_zone' ? 'high' : 'medium',
      tags: ['voip', call.outcome],
    });
    if (res) {
      setConvertedCallRefs((prev) => ({ ...prev, [call.id]: res.reference }));
      showTempNotice(`Appel converti en ticket ${res.reference}.`);
    }
  };

  const handleIngestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inboundSubject.trim() || !inboundBody.trim()) return;
    const res = await createOmnichannelTicket({
      channel: 'email',
      clientId: inboundClientId,
      subject: inboundSubject,
      description: `Expéditeur : ${inboundFrom}\n\n${inboundBody}`,
      category: inboundSubject.toLowerCase().includes('mot de passe') || inboundSubject.toLowerCase().includes('mfa')
        ? 'Mot de passe bloqué'
        : 'Assistance client',
      priority: 'high',
      tags: ['email-entrant'],
    });
    if (res) {
      showTempNotice(`E-mail transformé en ticket ${res.reference} dans la file.`);
    }
  };

  const handleSubmitWebForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webFormSubject.trim() || !webFormMessage.trim()) return;
    const res = await createOmnichannelTicket({
      channel: 'web_form',
      clientId: webFormClientId,
      subject: webFormSubject,
      description: `Soumis via formulaire web [${webFormSlug}] :\n\n${webFormMessage}`,
      priority: webFormPriority,
      category: 'Utilisation plateforme',
      tags: ['formulaire-web', webFormSlug],
    });
    if (res) {
      setWebFormSubject('');
      setWebFormMessage('');
      showTempNotice(`Formulaire web reçu : ticket ${res.reference} créé.`);
    }
  };

  const handleConvertSocialToTicket = async (item: SocialFeedItem) => {
    const res = await createOmnichannelTicket({
      channel: item.network,
      subject: `[${item.networkLabel}] ${item.handle}`,
      description: `Message social reçu (${item.receivedAt}) de ${item.handle} :\n\n${item.message}`,
      category: item.message.toLowerCase().includes('hors zone')
        ? 'Hors zone / Connectivité'
        : item.message.toLowerCase().includes('sso')
        ? 'Mot de passe bloqué'
        : 'Assistance client',
      priority: 'high',
      tags: [item.network, 'reseau-social'],
    });
    if (res) {
      setSocialStream((prev) =>
        prev.map((s) => (s.id === item.id ? { ...s, convertedRef: res.reference } : s))
      );
      showTempNotice(`Message ${item.networkLabel} converti en ticket ${res.reference}.`);
    }
  };

  const handleCreateSlackTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slackCommandText.trim()) return;
    const cleanSubject = slackCommandText.replace(/^\/ticket\s+/i, '').trim();
    const res = await createOmnichannelTicket({
      channel: 'slack_teams',
      subject: `[${slackChannel}] ${cleanSubject}`,
      description: `Ticket interne ouvert depuis la messagerie d’équipe (${slackChannel}) par ${currentUserName} :\n\n${slackCommandText}`,
      category: 'Vérification situation',
      priority: 'high',
      tags: ['slack-teams', 'interne'],
    });
    if (res) {
      setSlackCommandText('/ticket ');
      showTempNotice(`Ticket interne ${res.reference} créé depuis ${slackChannel}.`);
    }
  };

  const webFormShortcode = `[zentradesk_form id="${webFormSlug}" lang="fr"]`;
  const webFormLink = `https://support.zentradesk.app/f/${webFormSlug}`;
  const widgetEmbedCode = `<script src="https://cdn.zentradesk.app/widget.js" data-hours="${widgetConfig.businessHours}" async></script>`;

  return (
    <div className="space-y-5">
      {/* Omnichannel Header & Sub-Navigation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
            Centralisation Omnicanale &amp; Collaboration Temps Réel
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Captez et unifiez chaque demande client : Tchat en direct, VoIP, Email entrant, Formulaires web, Réseaux sociaux et Slack/Teams.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {(
            [
              ['chat_widget', 'Tchat & Widget Live', MessageSquare],
              ['voip', 'Téléphonie VoIP', Phone],
              ['email_forms', 'Email & Formulaires Web', Mail],
              ['social_team', 'Réseaux Sociaux & Slack/Teams', Share2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                subTab === key
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {hubNotice && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-xl text-xs text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3">
          <span>{hubNotice}</span>
          {onOpenTicket && tickets[0] && (
            <button
              type="button"
              onClick={() => onOpenTicket(tickets[0].id)}
              className="font-semibold underline cursor-pointer shrink-0"
            >
              Voir dans Tickets &amp; SLA
            </button>
          )}
        </div>
      )}

      {/* TAB 1: Real-time Team Chat + Embeddable Live Chat Widget Config */}
      {subTab === 'chat_widget' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-600" />
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Canal de collaboration temps réel
                </h3>
              </div>
              <span
                className={`text-xs font-medium ${
                  wsConnected ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {wsConnected ? 'WebSocket connecté' : 'Reconnexion...'}
              </span>
            </div>

            <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 overflow-x-auto">
              <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium shrink-0">Agents en ligne :</span>
              <span>
                {presence.length > 0 ? presence.map((p) => p.agentName).join(' · ') : currentUserName}
              </span>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto h-[340px] bg-slate-50/40 dark:bg-slate-950/30">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{msg.authorName}</span>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span className="text-slate-500 dark:text-slate-400">{msg.authorRole}</span>
                      {msg.ticketRef && (
                        <>
                          <span aria-hidden="true" className="text-slate-400">·</span>
                          <span className="font-mono text-blue-700 dark:text-blue-400 font-medium">
                            {msg.ticketRef}
                          </span>
                        </>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">
                      {new Date(msg.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{msg.body}</p>
                </div>
              ))}
            </div>

            <form onSubmit={handleChatSubmit} className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={ticketRefInput}
                  onChange={(e) => setTicketRefInput(e.target.value)}
                  placeholder="Réf. ticket (ex: ZD-0001)"
                  className="w-36 px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Écrire à l’équipe support en direct..."
                  className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
                <button
                  type="submit"
                  disabled={!chatInput.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Envoyer</span>
                </button>
              </div>
            </form>
          </section>

          {/* Live Chat Widget Config */}
          <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Widget Tchat Intégrable &amp; Horaires
                </h3>
              </div>
              {widgetSaved && (
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                  Synchronisé !
                </span>
              )}
            </div>

            <form onSubmit={handleSaveWidgetConfig} className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">Heures d’ouverture affichées</span>
                <input
                  type="text"
                  value={widgetConfig.businessHours}
                  onChange={(e) => setWidgetConfig({ ...widgetConfig, businessHours: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">Message d’accueil en ligne</span>
                <input
                  type="text"
                  value={widgetConfig.welcomeMessage}
                  onChange={(e) => setWidgetConfig({ ...widgetConfig, welcomeMessage: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">Message automatique hors ligne</span>
                <textarea
                  rows={2}
                  value={widgetConfig.offlineMessage}
                  onChange={(e) => setWidgetConfig({ ...widgetConfig, offlineMessage: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <label className="flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={widgetConfig.isOfflineOverride}
                  onChange={(e) => setWidgetConfig({ ...widgetConfig, isOfflineOverride: e.target.checked })}
                />
                <span>Forcer le mode « Hors ligne » sur le widget flottant</span>
              </label>

              <button
                type="submit"
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg cursor-pointer"
              >
                Appliquer au widget flottant
              </button>
            </form>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Code d’intégration site web</span>
                <button
                  type="button"
                  onClick={() => handleCopy('widget', widgetEmbedCode)}
                  className="inline-flex items-center gap-1 text-blue-600 font-semibold cursor-pointer"
                >
                  {copiedSnippet === 'widget' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedSnippet === 'widget' ? 'Copié' : 'Copier'}</span>
                </button>
              </div>
              <pre className="p-2.5 bg-slate-950 text-slate-200 text-[11px] font-mono rounded-lg overflow-x-auto">
                {widgetEmbedCode}
              </pre>
            </div>
          </section>
        </div>
      )}

      {/* TAB 2: Telephony VoIP + Availability-based Routing + Missed Call to Ticket */}
      {subTab === 'voip' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-5 space-y-5">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Routage VoIP selon disponibilité agents ({availableVoipAgents.length}/{agents.length})
              </h3>
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {agents.map((ag) => (
                  <div key={ag.id} className="py-2 flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{ag.name}</p>
                      <p className="text-[11px] text-slate-500">{ag.group}</p>
                    </div>
                    <span
                      className={`font-medium ${
                        ag.availability === 'available'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : ag.availability === 'on_call'
                          ? 'text-blue-700 dark:text-blue-400'
                          : 'text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {AGENT_AVAILABILITY_LABELS[ag.availability]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Journaliser un appel VoIP / Hors zone
                </h3>
              </div>

              <form onSubmit={handleLogCall} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-slate-500">Client</span>
                    <select
                      value={callClientId}
                      onChange={(e) => setCallClientId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                    >
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.companyName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-slate-500">Agent traitant</span>
                    <select
                      value={callAgentId}
                      onChange={(e) => setCallAgentId(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                    >
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <select
                    value={callDirection}
                    onChange={(e) => setCallDirection(e.target.value as 'inbound' | 'outbound')}
                    className="px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    <option value="inbound">Entrant</option>
                    <option value="outbound">Sortant</option>
                  </select>
                  <select
                    value={callOutcome}
                    onChange={(e) =>
                      setCallOutcome(
                        e.target.value as 'answered' | 'missed' | 'out_of_zone' | 'callback_scheduled'
                      )
                    }
                    className="px-2.5 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    <option value="answered">Répondu</option>
                    <option value="out_of_zone">Hors zone</option>
                    <option value="missed">Manqué</option>
                    <option value="callback_scheduled">Rappel prévu</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={86400}
                    value={callDurationSec}
                    onChange={(e) => setCallDurationSec(Number(e.target.value))}
                    className="px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </div>

                <input
                  type="text"
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  placeholder="Compte-rendu rapide..."
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />

                <button
                  type="submit"
                  disabled={savingCall}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingCall ? 'Enregistrement...' : 'Enregistrer l’appel VoIP'}
                </button>
              </form>
            </div>
          </section>

          <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Journal VoIP &amp; Transformation d’appels manqués ({callLogs.length})
              </h3>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[520px] overflow-y-auto">
              {callLogs.map((call) => {
                const ticketRef = call.linkedTicketRef || convertedCallRefs[call.id];
                const canConvert =
                  !ticketRef && (call.outcome === 'missed' || call.outcome === 'out_of_zone' || call.outcome === 'callback_scheduled');
                return (
                  <div key={call.id} className="p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                        {call.outcome === 'out_of_zone' || call.outcome === 'missed' ? (
                          <PhoneOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        ) : call.direction === 'inbound' ? (
                          <PhoneIncoming className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : (
                          <PhoneOutgoing className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        )}
                        <span>{call.clientName}</span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="font-normal text-slate-600 dark:text-slate-400">{call.agentName}</span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="font-mono tabular-nums text-slate-500">
                          {formatDuration(call.durationSeconds)}
                        </span>
                      </div>
                      <p className="text-slate-500 dark:text-slate-400">{call.notes}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {ticketRef ? (
                        <span className="px-2.5 py-1 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-mono font-semibold text-[11px]">
                          Ticket {ticketRef}
                        </span>
                      ) : canConvert ? (
                        <button
                          type="button"
                          onClick={() => handleConvertCallToTicket(call)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 text-[11px] font-semibold rounded-md cursor-pointer"
                        >
                          <TicketPlus className="w-3.5 h-3.5" />
                          <span>Transformer en ticket</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">Traité</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: Inbound Email -> Ticket & Customizable Web Forms */}
      {subTab === 'email_forms' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Passerelle Email entrant → Ticket automatique
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Adresse dédiée configurée : <strong className="font-mono text-slate-800 dark:text-slate-200">support@zentradesk.app</strong>. Testez l’ingestion immédiate d’un email client en ticket SLA.
            </p>

            <form onSubmit={handleIngestEmail} className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500">Client associé</span>
                  <select
                    value={inboundClientId}
                    onChange={(e) => setInboundClientId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.companyName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-slate-500">Expéditeur (From)</span>
                  <input
                    type="email"
                    required
                    value={inboundFrom}
                    onChange={(e) => setInboundFrom(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </label>
              </div>
              <input
                type="text"
                required
                value={inboundSubject}
                onChange={(e) => setInboundSubject(e.target.value)}
                placeholder="Objet de l'email..."
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <textarea
                rows={4}
                required
                value={inboundBody}
                onChange={(e) => setInboundBody(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg cursor-pointer"
              >
                <TicketPlus className="w-3.5 h-3.5" />
                <span>Convertir l’email en ticket</span>
              </button>
            </form>
          </section>

          <section className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Formulaires Web personnalisables (Shortcode &amp; Lien direct)
              </h3>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={webFormTitle}
                  onChange={(e) => setWebFormTitle(e.target.value)}
                  placeholder="Titre du formulaire"
                  className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md"
                />
                <input
                  type="text"
                  value={webFormSlug}
                  onChange={(e) => setWebFormSlug(e.target.value.replace(/[^a-zA-Z0-9_-]/g, '-'))}
                  placeholder="slug-formulaire"
                  className="px-2.5 py-1.5 font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md"
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-mono text-slate-600 dark:text-slate-300 truncate">{webFormShortcode}</span>
                <button
                  type="button"
                  onClick={() => handleCopy('shortcode', webFormShortcode)}
                  className="text-blue-600 font-semibold shrink-0 cursor-pointer"
                >
                  {copiedSnippet === 'shortcode' ? 'Copié' : 'Copier shortcode'}
                </button>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-mono text-slate-500 truncate">{webFormLink}</span>
                <button
                  type="button"
                  onClick={() => handleCopy('weblink', webFormLink)}
                  className="text-blue-600 font-semibold shrink-0 cursor-pointer"
                >
                  {copiedSnippet === 'weblink' ? 'Copié' : 'Copier lien'}
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmitWebForm} className="space-y-3 text-xs">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                Aperçu en direct : {webFormTitle}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <select
                  value={webFormClientId}
                  onChange={(e) => setWebFormClientId(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.companyName}
                    </option>
                  ))}
                </select>
                <select
                  value={webFormPriority}
                  onChange={(e) => setWebFormPriority(e.target.value as TicketPriority)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  <option value="high">Urgence Haute</option>
                  <option value="medium">Urgence Normale</option>
                  <option value="critical">Urgence Critique</option>
                </select>
              </div>
              <input
                type="text"
                required
                value={webFormSubject}
                onChange={(e) => setWebFormSubject(e.target.value)}
                placeholder="Objet de la demande formulaire..."
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <textarea
                rows={2}
                required
                value={webFormMessage}
                onChange={(e) => setWebFormMessage(e.target.value)}
                placeholder="Détails envoyés par le formulaire web..."
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold rounded-lg cursor-pointer"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Simuler soumission formulaire web</span>
              </button>
            </form>
          </section>
        </div>
      )}

      {/* TAB 4: Social Media (FB, X, IG, WhatsApp) & Internal Team Messaging (Slack/Teams) */}
      {subTab === 'social_team' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Share2 className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Flux Réseaux Sociaux (Facebook, Twitter/X, Instagram, WhatsApp)
                </h3>
              </div>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {socialStream.map((item) => (
                <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-semibold text-slate-800 dark:text-slate-200">
                        {item.networkLabel}
                      </span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{item.handle}</span>
                      <span className="text-slate-400 font-mono text-[11px]">{item.receivedAt}</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{item.message}</p>
                  </div>
                  <div className="shrink-0">
                    {item.convertedRef ? (
                      <span className="px-2.5 py-1 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-mono font-semibold">
                        Ticket {item.convertedRef}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleConvertSocialToTicket(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg whitespace-nowrap cursor-pointer"
                      >
                        <TicketPlus className="w-3.5 h-3.5" />
                        <span>Créer ticket</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-blue-600" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Messagerie d’équipe (Slack / Microsoft Teams)
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Créez des tickets internes directement depuis vos canaux Slack ou Teams grâce à la commande slash <code className="font-mono text-slate-800 dark:text-slate-200">/ticket</code>.
            </p>

            <form onSubmit={handleCreateSlackTicket} className="space-y-3 text-xs">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">Canal source</span>
                <select
                  value={slackChannel}
                  onChange={(e) => setSlackChannel(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  <option value="#support-escalades">Slack · #support-escalades</option>
                  <option value="#ops-terrain">Slack · #ops-terrain</option>
                  <option value="Teams · Support N2">Microsoft Teams · Support N2</option>
                  <option value="Teams · Direction IT">Microsoft Teams · Direction IT</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500">Commande / Message</span>
                <textarea
                  rows={3}
                  required
                  value={slackCommandText}
                  onChange={(e) => setSlackCommandText(e.target.value)}
                  className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold rounded-lg cursor-pointer"
              >
                <TicketPlus className="w-3.5 h-3.5" />
                <span>Créer ticket depuis {slackChannel}</span>
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
};
