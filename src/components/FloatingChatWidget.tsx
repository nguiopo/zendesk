import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Bot,
  Clock,
  Headphones,
  KeyRound,
  MessageSquare,
  Send,
  Sparkles,
  TicketPlus,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  ChatbotMessage,
  ClientAccount,
  KbArticle,
  SlaPolicy,
  SupportAgent,
  TeamChatMessage,
  Ticket,
  TicketCategory,
  TicketPriority,
  WorkspaceConfig,
} from '../types/helpdesk';
import { executeSmartTicketRouting, resolveSmartRoutingPolicy } from '../lib/smartRouting';
import { clampString, sanitizeTicketCreatePayload } from '../lib/validation';

export interface LiveChatWidgetConfig {
  enabled: boolean;
  businessHours: string;
  isOfflineOverride: boolean;
  offlineMessage: string;
  welcomeMessage: string;
}

export const LIVE_CHAT_CONFIG_KEY = 'zentradesk_livechat_config_v1';

export const DEFAULT_LIVE_CHAT_CONFIG: LiveChatWidgetConfig = {
  enabled: true,
  businessHours: 'Lun–Ven · 08h30 – 18h30 CET',
  isOfflineOverride: false,
  offlineMessage:
    'Nos conseillers sont actuellement hors horaires d’ouverture. Laissez votre message ci-dessous : un ticket prioritaire sera ouvert automatiquement.',
  welcomeMessage:
    'Bonjour ! Comment notre équipe support peut-elle vous accompagner aujourd’hui ?',
};

export function loadLiveChatConfig(): LiveChatWidgetConfig {
  if (typeof window === 'undefined') return DEFAULT_LIVE_CHAT_CONFIG;
  try {
    const raw = window.localStorage.getItem(LIVE_CHAT_CONFIG_KEY);
    if (!raw) return DEFAULT_LIVE_CHAT_CONFIG;
    return { ...DEFAULT_LIVE_CHAT_CONFIG, ...(JSON.parse(raw) as Partial<LiveChatWidgetConfig>) };
  } catch {
    return DEFAULT_LIVE_CHAT_CONFIG;
  }
}

interface FloatingChatWidgetProps {
  uid: string;
  currentUserName: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  wsConnected: boolean;
  chatMessages: TeamChatMessage[];
  onSendChat: (body: string, role?: string, ticketRef?: string) => void;
  kbArticles: KbArticle[];
  clients: ClientAccount[];
  tickets: Ticket[];
  slaPolicies: SlaPolicy[];
  agents: SupportAgent[];
  workspaceConfig?: WorkspaceConfig;
  onOpenTicket?: (ticketId: string) => void;
}

export const FloatingChatWidget: React.FC<FloatingChatWidgetProps> = ({
  uid,
  currentUserName,
  open,
  onToggle,
  onClose,
  wsConnected,
  chatMessages,
  onSendChat,
  kbArticles,
  clients,
  tickets,
  slaPolicies,
  agents,
  workspaceConfig,
  onOpenTicket,
}) => {
  const [activeMode, setActiveMode] = useState<'ai_bot' | 'live_chat'>('ai_bot');
  const [widgetConfig, setWidgetConfig] = useState<LiveChatWidgetConfig>(() => loadLiveChatConfig());
  const [botInput, setBotInput] = useState('');
  const [botLoading, setBotLoading] = useState(false);
  const [handoffSuccessRef, setHandoffSuccessRef] = useState<string | null>(null);
  const [liveInput, setLiveInput] = useState('');
  const [liveTicketRef, setLiveTicketRef] = useState('');

  const [botMessages, setBotMessages] = useState<ChatbotMessage[]>([
    {
      id: 'bot-welcome',
      sender: 'bot',
      text: 'Bonjour, je suis l’agent IA conversationnel ZentraDesk. Je peux débloquer un mot de passe/MFA, vérifier vos délais SLA, consulter la base de connaissances ou vous transférer à un agent humain.',
      timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      suggestedAction: 'none',
    },
  ]);

  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setWidgetConfig(loadLiveChatConfig());
    }
  }, [open]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [botMessages, chatMessages, activeMode, open]);

  const lockedClient = useMemo(
    () => clients.find((c) => c.passwordLocked) || clients[0],
    [clients]
  );

  const sendBotPrompt = async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || botLoading) return;

    const userMsg: ChatbotMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    };

    const updatedHistory = [...botMessages, userMsg];
    setBotMessages(updatedHistory);
    setBotInput('');
    setBotLoading(true);
    setHandoffSuccessRef(null);

    try {
      const clientSummary = lockedClient
        ? `${lockedClient.companyName} (${lockedClient.tier}, état: ${lockedClient.healthStatus}, mot de passe bloqué: ${lockedClient.passwordLocked ? 'oui' : 'non'}, hors zone: ${lockedClient.outOfZoneSignal ? 'oui' : 'non'})`
        : currentUserName;

      const openTicketsSummary = tickets
        .filter((t) => t.status !== 'resolved' && t.status !== 'closed')
        .slice(0, 4)
        .map((t) => `${t.reference}: ${t.subject} [${t.status}, priorité ${t.priority}]`)
        .join(' | ');

      const res = await fetch('/api/ai/chatbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedHistory.map((m) => ({ sender: m.sender, text: m.text })),
          kbArticles: kbArticles.slice(0, 8).map((a) => ({
            title: a.title,
            category: a.category,
            summary: a.summary,
          })),
          clientSummary,
          openTicketsSummary,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Assistant IA momentanément indisponible.');
      }

      const botReply: ChatbotMessage = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: data.reply || 'Je reste à votre disposition pour approfondir ce point.',
        timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        suggestedAction: data.suggestedAction || 'none',
        needsHumanHandoff: Boolean(data.needsHumanHandoff),
        handoffReason: data.handoffReason,
        handoffCategory: data.handoffCategory,
        handoffPriority: data.handoffPriority,
        referencedArticleTitle: data.referencedArticleTitle,
      };
      setBotMessages((prev) => [...prev, botReply]);
    } catch (err) {
      setBotMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'system',
          text:
            err instanceof Error
              ? err.message
              : 'Impossible de joindre le moteur conversationnel. Vous pouvez transférer vers un agent humain.',
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          needsHumanHandoff: true,
          handoffCategory: 'Assistance client',
          handoffPriority: 'medium',
        },
      ]);
    } finally {
      setBotLoading(false);
    }
  };

  const handleAutonomousUnlock = async () => {
    if (!lockedClient) return;
    try {
      await updateDoc(doc(db, 'clients', lockedClient.id), {
        passwordLocked: false,
        healthStatus: lockedClient.outOfZoneSignal ? 'out_of_zone' : 'nominal',
        lastVerifiedNote: 'Mot de passe & MFA réinitialisés via Agent IA Conversationnel.',
        lastVerifiedAt: 'À l’instant',
        updatedAt: serverTimestamp(),
      });

      setBotMessages((prev) => [
        ...prev,
        {
          id: `sys-unlock-${Date.now()}`,
          sender: 'system',
          text: `Action autonome exécutée : le verrouillage mot de passe de ${lockedClient.companyName} a été levé et le lien MFA a été envoyé.`,
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `clients/${lockedClient.id}`);
    }
  };

  const handleHandoffToHuman = async (msg: ChatbotMessage) => {
    const client = lockedClient || clients[0];
    if (!client) return;

    const smartPolicy = resolveSmartRoutingPolicy(workspaceConfig);
    let category: TicketCategory = msg.handoffCategory || 'Assistance client';
    let priority: TicketPriority = msg.handoffPriority || 'high';
    let targetAgent =
      agents.find((a) => a.availability === 'available') ||
      agents.find((a) => a.availability === 'on_call') ||
      agents[0];
    let assignedGroup: string = targetAgent?.group || 'Relation Client & CTI';
    let aiSentiment = 'Transfert assisté';
    let aiConfidence = 0.94;
    let routingNote = `Transfert automatique du chatbot vers ${targetAgent?.name || 'le groupe support'}. Motif : ${msg.handoffReason || 'Demande d’intervention humaine'}.`;

    const reference = `ZD-${2060 + tickets.length}`;
    const transcript = botMessages
      .slice(-6)
      .map((m) => `[${m.sender === 'user' ? 'Client' : 'Chatbot IA'}] ${m.text}`)
      .join('\n');

    if (smartPolicy.enabled && agents.length > 0) {
      const outcome = await executeSmartTicketRouting({
        subject: msg.handoffReason || 'Transfert Tchat IA vers conseiller humain',
        description: transcript,
        channel: 'chat',
        clientName: client.companyName,
        agents,
        policy: smartPolicy,
        fallbackCategory: category,
        fallbackPriority: priority,
      });
      category = outcome.category;
      priority = outcome.priority;
      assignedGroup = outcome.assignedGroup;
      aiSentiment = outcome.aiSentiment;
      aiConfidence = outcome.aiConfidence;
      routingNote = outcome.routingReason;
      if (outcome.assignedAgentId) {
        targetAgent = agents.find((a) => a.id === outcome.assignedAgentId) || targetAgent;
      }
    }

    const matchedSla = slaPolicies.find((s) => s.priorityScope === priority) || slaPolicies[0];
    const now = Date.now();
    const payload = sanitizeTicketCreatePayload({
      reference,
      subject: clampString(msg.handoffReason || 'Transfert Tchat IA vers conseiller humain', 240),
      description: clampString(
        `Conversation transférée depuis le widget Tchat IA :\n\n${transcript}`,
        4000
      ),
      channel: 'chat',
      status: priority === 'critical' ? 'escalated' : 'open',
      priority,
      category,
      clientId: client.id,
      clientName: client.companyName,
      assignedAgentId: targetAgent?.id,
      assignedAgentName: targetAgent?.name,
      assignedGroup,
      slaPolicyId: matchedSla?.id,
      firstResponseDueMs: now + (matchedSla?.firstResponseMinutes ?? 30) * 60 * 1000,
      resolutionDueMs: now + (matchedSla?.resolutionMinutes ?? 240) * 60 * 1000,
      firstResponded: false,
      aiRouted: smartPolicy.enabled,
      aiConfidence,
      aiSentiment,
      aiSummary: clampString(msg.handoffReason || 'Escalade depuis le chatbot conversationnel.', 600),
      isRecurringIncident: false,
      tags: smartPolicy.enabled ? ['tchat-ia', 'smart-routing'] : ['tchat-ia', 'transfert-humain'],
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
        authorName: smartPolicy.enabled ? 'Smart Routing IA' : 'Agent IA Conversationnel',
        authorRole: 'ai',
        visibility: 'internal',
        eventType: 'ai_triage',
        body: clampString(routingNote, 4000),
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
      });

      setHandoffSuccessRef(reference);
      setBotMessages((prev) => [
        ...prev,
        {
          id: `sys-handoff-${Date.now()}`,
          sender: 'system',
          text: `Ticket ${reference} créé et assigné à ${targetAgent?.name || 'l’équipe support'} avec la transcription complète.`,
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      onOpenTicket?.(created.id);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'tickets');
    }
  };

  const handleLiveChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!liveInput.trim()) return;
    onSendChat(liveInput, 'Tchat direct', liveTicketRef.trim() || undefined);
    setLiveInput('');
  };

  return (
    <>
      {/* Floating Chat Drawer */}
      {open && (
        <div
          role="dialog"
          aria-label="Assistant IA et Tchat en direct"
          className="fixed bottom-20 right-5 z-40 w-[390px] sm:w-[430px] max-w-[calc(100vw-2rem)] h-[540px] max-h-[calc(100vh-7rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_20px_50px_rgba(15,23,42,0.22)] flex flex-col overflow-hidden"
        >
          {/* Drawer Header */}
          <div className="px-4 py-3 bg-[#0B1120] text-white flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-blue-400" />
              </div>
              <div className="min-w-0">
                <p className="font-display text-xs font-bold tracking-tight truncate">
                  Tchat &amp; Agent IA ZentraDesk
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  {activeMode === 'ai_bot'
                    ? 'Résolution autonome & transfert humain'
                    : wsConnected
                    ? `En ligne · ${widgetConfig.businessHours}`
                    : 'Reconnexion WebSocket...'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer le tchat"
              className="p-1.5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mode Switcher */}
          <div className="px-3 pt-2.5 pb-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveMode('ai_bot')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeMode === 'ai_bot'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 border border-slate-200 dark:border-slate-700 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Agent IA</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMode('live_chat')}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeMode === 'live_chat'
                  ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 border border-slate-200 dark:border-slate-700 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Headphones className="w-3.5 h-3.5" />
              <span>Tchat en direct</span>
            </button>
          </div>

          {activeMode === 'ai_bot' ? (
            <>
              {/* Quick Prompt Chips */}
              <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto shrink-0">
                {[
                  'Mon mot de passe est bloqué',
                  'Vérifier nos SLA en cours',
                  'Signaler un terminal hors zone',
                  'Parler à un agent humain',
                ].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendBotPrompt(q)}
                    disabled={botLoading}
                    className="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 text-slate-700 dark:text-slate-200 text-[11px] font-medium rounded-md border border-slate-200 dark:border-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {q}
                  </button>
                ))}
              </div>

              {/* Bot Conversation Feed */}
              <div ref={feedRef} className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-slate-50/50 dark:bg-slate-950/30">
                {botMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      msg.sender === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed space-y-2 ${
                        msg.sender === 'user'
                          ? 'bg-blue-600 text-white'
                          : msg.sender === 'system'
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200'
                          : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.text}</p>

                      {msg.referencedArticleTitle && (
                        <p className="text-[11px] text-blue-700 dark:text-blue-400 font-medium pt-1 border-t border-slate-100 dark:border-slate-800">
                          Source KB : {msg.referencedArticleTitle}
                        </p>
                      )}

                      {msg.suggestedAction === 'unlock_password' && lockedClient && (
                        <button
                          type="button"
                          onClick={handleAutonomousUnlock}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold rounded-lg cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Débloquer {lockedClient.companyName} maintenant</span>
                        </button>
                      )}

                      {msg.needsHumanHandoff && (
                        <button
                          type="button"
                          onClick={() => handleHandoffToHuman(msg)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 text-[11px] font-semibold rounded-lg cursor-pointer"
                        >
                          <TicketPlus className="w-3.5 h-3.5" />
                          <span>Transférer vers un agent humain (Créer ticket)</span>
                        </button>
                      )}
                    </div>
                    <span className="mt-1 px-1 text-[10px] font-mono text-slate-400">
                      {msg.timestamp}
                    </span>
                  </div>
                ))}

                {botLoading && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 px-2">
                    L’agent IA analyse votre demande...
                  </div>
                )}

                {handoffSuccessRef && (
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg text-[11px] text-blue-800 dark:text-blue-200">
                    Ticket <strong className="font-mono">{handoffSuccessRef}</strong> ouvert dans votre file active.
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendBotPrompt(botInput);
                }}
                className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2 shrink-0"
              >
                <input
                  type="text"
                  value={botInput}
                  onChange={(e) => setBotInput(e.target.value)}
                  placeholder="Posez votre question à l’agent IA..."
                  className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  type="submit"
                  disabled={botLoading || !botInput.trim()}
                  className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg cursor-pointer shrink-0"
                  aria-label="Envoyer au chatbot IA"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Live Chat Business Hours Status Banner */}
              <div className="px-3.5 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between gap-2 text-[11px] shrink-0">
                <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  <span>{widgetConfig.businessHours}</span>
                </span>
                <span
                  className={`font-semibold ${
                    widgetConfig.isOfflineOverride || !widgetConfig.enabled
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {widgetConfig.isOfflineOverride || !widgetConfig.enabled ? 'Mode hors ligne' : 'Équipe disponible'}
                </span>
              </div>

              <div ref={feedRef} className="flex-1 overflow-y-auto p-3.5 space-y-2.5 bg-slate-50/50 dark:bg-slate-950/30">
                {(widgetConfig.isOfflineOverride || !widgetConfig.enabled) && (
                  <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-900 dark:text-amber-200">
                    {widgetConfig.offlineMessage}
                  </div>
                )}

                <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
                  {widgetConfig.welcomeMessage}
                </div>

                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-1 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {msg.authorName}{' '}
                        {msg.ticketRef && (
                          <span className="font-mono text-blue-600 dark:text-blue-400">
                            · {msg.ticketRef}
                          </span>
                        )}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {new Date(msg.createdAt).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300">{msg.body}</p>
                  </div>
                ))}
              </div>

              <form
                onSubmit={handleLiveChatSubmit}
                className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2 shrink-0"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={liveTicketRef}
                    onChange={(e) => setLiveTicketRef(e.target.value)}
                    placeholder="Réf. (optionnel)"
                    className="w-28 px-2.5 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                  <input
                    type="text"
                    value={liveInput}
                    onChange={(e) => setLiveInput(e.target.value)}
                    placeholder="Message en direct..."
                    className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                  <button
                    type="submit"
                    disabled={!liveInput.trim()}
                    className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg cursor-pointer shrink-0"
                    aria-label="Envoyer message direct"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}

      {/* Persistent Bottom-Right Floating Chat Launcher Button */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? 'Réduire le tchat' : 'Ouvrir le tchat et l’assistant IA'}
        title="Tchat en direct & Assistant IA (Alt+C)"
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2.5 px-4 py-3 bg-[#0B1120] hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-semibold rounded-xl border border-slate-700/80 dark:border-blue-500 shadow-[0_12px_28px_rgba(15,23,42,0.28)] transition-all cursor-pointer"
      >
        {open ? (
          <X className="w-4 h-4 text-slate-200 shrink-0" />
        ) : (
          <MessageSquare className="w-4 h-4 text-blue-400 dark:text-white shrink-0" />
        )}
        <span className="whitespace-nowrap">{open ? 'Fermer tchat' : 'Tchat & IA'}</span>
        <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 dark:bg-blue-700 text-slate-300 dark:text-blue-100 rounded border border-slate-700 dark:border-blue-500">
          Alt+C
        </kbd>
      </button>
    </>
  );
};
