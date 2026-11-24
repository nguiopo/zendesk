import React, { useMemo, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  History,
  KeyRound,
  Mail,
  MapPin,
  Phone,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  Ticket as TicketIcon,
  User,
  X,
} from 'lucide-react';
import { AppLocale, CallLog, ClientAccount, Ticket } from '../types/helpdesk';
import {
  CLIENT_HEALTH_LABELS,
  formatDuration,
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from '../lib/formatters';
import { I18N } from '../lib/i18n';

interface ClientDetailPanelProps {
  client: ClientAccount;
  tickets: Ticket[];
  callLogs: CallLog[];
  locale?: AppLocale;
  busy: boolean;
  onClose: () => void;
  onVerifySituation: (client: ClientAccount) => void;
  onUnlockPassword: (client: ClientAccount) => void;
  onOutOfZoneCallFollowup: (client: ClientAccount) => void;
  onOpenTicket?: (ticketId: string) => void;
}

type InteractionFilter = 'all' | 'tickets' | 'calls';

type ClientInteractionItem =
  | {
      id: string;
      kind: 'ticket';
      timestampMs: number;
      ticket: Ticket;
    }
  | {
      id: string;
      kind: 'call';
      timestampMs: number;
      call: CallLog;
    };

const CALL_OUTCOME_LABELS: Record<CallLog['outcome'], string> = {
  answered: 'Répondu',
  missed: 'Manqué',
  out_of_zone: 'Hors zone',
  callback_scheduled: 'Rappel prévu',
};

function getTimestampMs(ts?: Timestamp | null, fallbackMs = 0): number {
  if (!ts) return fallbackMs;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  const maybeSeconds = (ts as unknown as { seconds?: number }).seconds;
  if (typeof maybeSeconds === 'number') return maybeSeconds * 1000;
  return fallbackMs;
}

function formatInteractionDate(ms: number): string {
  if (!ms) return 'À l’instant';
  const dt = new Date(ms);
  const now = new Date();
  const diffMin = Math.round((now.getTime() - ms) / 60000);
  if (diffMin >= 0 && diffMin < 2) return 'À l’instant';
  if (diffMin >= 2 && diffMin < 60) return `Il y a ${diffMin} min`;

  const isSameDay =
    dt.getDate() === now.getDate() &&
    dt.getMonth() === now.getMonth() &&
    dt.getFullYear() === now.getFullYear();

  if (isSameDay) {
    return `Aujourd’hui · ${dt.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  return dt.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ClientDetailPanel: React.FC<ClientDetailPanelProps> = ({
  client,
  tickets,
  callLogs,
  locale = 'fr',
  busy,
  onClose,
  onVerifySituation,
  onUnlockPassword,
  onOutOfZoneCallFollowup,
  onOpenTicket,
}) => {
  const dict = I18N[locale].clients;
  const [interactionFilter, setInteractionFilter] = useState<InteractionFilter>('all');
  const [showAllInteractions, setShowAllInteractions] = useState(false);

  const clientTickets = useMemo(() => {
    const normalizedCompany = client.companyName.trim().toLowerCase();
    return tickets.filter(
      (t) =>
        t.clientId === client.id ||
        t.clientName.trim().toLowerCase() === normalizedCompany
    );
  }, [tickets, client.id, client.companyName]);

  const clientCalls = useMemo(() => {
    const normalizedCompany = client.companyName.trim().toLowerCase();
    return callLogs.filter(
      (c) =>
        c.clientId === client.id ||
        c.clientName.trim().toLowerCase() === normalizedCompany
    );
  }, [callLogs, client.id, client.companyName]);

  const allInteractions = useMemo<ClientInteractionItem[]>(() => {
    const fallbackNow = Date.now();
    const ticketItems: ClientInteractionItem[] = clientTickets.map((ticket) => ({
      id: `tk-${ticket.id}`,
      kind: 'ticket',
      timestampMs: getTimestampMs(ticket.updatedAt || ticket.createdAt, fallbackNow),
      ticket,
    }));

    const callItems: ClientInteractionItem[] = clientCalls.map((call) => ({
      id: `call-${call.id}`,
      kind: 'call',
      timestampMs: getTimestampMs(call.createdAt, fallbackNow),
      call,
    }));

    return [...ticketItems, ...callItems].sort((a, b) => b.timestampMs - a.timestampMs);
  }, [clientTickets, clientCalls]);

  const filteredInteractions = useMemo(() => {
    if (interactionFilter === 'tickets') {
      return allInteractions.filter((item) => item.kind === 'ticket');
    }
    if (interactionFilter === 'calls') {
      return allInteractions.filter((item) => item.kind === 'call');
    }
    return allInteractions;
  }, [allInteractions, interactionFilter]);

  const visibleInteractions = useMemo(() => {
    if (showAllInteractions) return filteredInteractions;
    return filteredInteractions.slice(0, 8);
  }, [filteredInteractions, showAllInteractions]);

  const openTicketsCount = useMemo(
    () => clientTickets.filter((t) => t.status !== 'resolved' && t.status !== 'closed').length,
    [clientTickets]
  );

  const totalCallMinutes = useMemo(
    () =>
      Math.round(
        clientCalls.reduce((sum, c) => sum + (c.durationSeconds || 0), 0) / 60
      ),
    [clientCalls]
  );

  const lastInteractionLabel = useMemo(() => {
    if (allInteractions.length === 0) return 'Aucune';
    return formatInteractionDate(allInteractions[0].timestampMs);
  }, [allInteractions]);

  return (
    <aside
      aria-label={`Fiche client ${client.companyName}`}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden flex flex-col"
    >
      {/* Fiche Client Header */}
      <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 space-y-3 bg-slate-50/60 dark:bg-slate-950/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span>{dict.cardHeaderLabel}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {client.tier}
              </span>
            </div>

            <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100 truncate">
              {client.companyName}
            </h3>

            <div className="inline-flex items-center gap-1.5 text-xs font-medium">
              {client.healthStatus === 'nominal' && (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="text-emerald-700 dark:text-emerald-400">
                    {CLIENT_HEALTH_LABELS[client.healthStatus]}
                  </span>
                </>
              )}
              {(client.healthStatus === 'out_of_zone' || client.healthStatus === 'degraded') && (
                <>
                  <PhoneOff className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span className="text-amber-700 dark:text-amber-400">
                    {CLIENT_HEALTH_LABELS[client.healthStatus]}
                  </span>
                </>
              )}
              {(client.healthStatus === 'password_locked' || client.healthStatus === 'critical') && (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span className="text-red-700 dark:text-red-400">
                    {CLIENT_HEALTH_LABELS[client.healthStatus]}
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={dict.closeCardAria}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contact & Telemetry Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs">
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 min-w-0">
            <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate font-medium">{client.contactName}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 min-w-0">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{client.region}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 min-w-0">
            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate font-mono text-[11px]">{client.contactEmail}</span>
          </div>
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 min-w-0">
            <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate font-mono text-[11px]">{client.contactPhone}</span>
          </div>
        </div>

        {/* Adoption Bar + Last Verified Note */}
        <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-lg space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-slate-600 dark:text-slate-400">
              {dict.adoptionLabel}
            </span>
            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              {client.platformAdoptionPct}%
            </span>
          </div>
          <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                client.platformAdoptionPct >= 80
                  ? 'bg-emerald-500'
                  : client.platformAdoptionPct >= 65
                  ? 'bg-blue-500'
                  : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, client.platformAdoptionPct))}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
            {client.lastVerifiedNote || dict.noVerification}
            {client.lastVerifiedAt && (
              <span className="text-slate-400 ml-1.5">({client.lastVerifiedAt})</span>
            )}
          </p>
        </div>

        {/* Quick Proactive Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onVerifySituation(client)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ClipboardCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>{dict.btnVerify}</span>
          </button>

          {client.passwordLocked && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUnlockPassword(client)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>{dict.btnUnlock}</span>
            </button>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => onOutOfZoneCallFollowup(client)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-800 dark:text-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PhoneOutgoing className="w-3.5 h-3.5" />
            <span>{dict.btnOutOfZone}</span>
          </button>
        </div>
      </div>

      {/* Section: Historique des interactions */}
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {dict.interactionHistoryTitle}
            </h4>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {allInteractions.length} {dict.entryWord}{allInteractions.length > 1 ? 's' : ''}
          </span>
        </div>

        {/* Summary Counters for this Client */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-2.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-lg">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{dict.linkedTickets}</p>
            <p className="font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              {clientTickets.length}
              <span className="text-[10px] font-sans font-normal text-slate-500 dark:text-slate-400 ml-1">
                ({openTicketsCount} {dict.activeWord}{openTicketsCount > 1 ? 's' : ''})
              </span>
            </p>
          </div>
          <div className="p-2.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-lg">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{dict.voipCalls}</p>
            <p className="font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              {clientCalls.length}
              <span className="text-[10px] font-sans font-normal text-slate-500 dark:text-slate-400 ml-1">
                ({totalCallMinutes} min)
              </span>
            </p>
          </div>
          <div className="p-2.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 rounded-lg">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{dict.lastTrace}</p>
            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mt-1 truncate" title={lastInteractionLabel}>
              {allInteractions.length === 0 ? dict.noneLabel : lastInteractionLabel}
            </p>
          </div>
        </div>

        {/* Sub-filter Segmented Bar */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
          {(
            [
              ['all', `${dict.tabAll} (${allInteractions.length})`],
              ['tickets', `${dict.tabTickets} (${clientTickets.length})`],
              ['calls', `${dict.tabCalls} (${clientCalls.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setInteractionFilter(key);
                setShowAllInteractions(false);
              }}
              className={`flex-1 px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                interactionFilter === key
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Chronological Interaction Feed */}
        {visibleInteractions.length === 0 ? (
          <div className="p-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {dict.noInteractionsTitle}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {interactionFilter === 'tickets'
                ? dict.noTicketsHint
                : interactionFilter === 'calls'
                ? dict.noCallsHint
                : dict.noInteractionsHint}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[430px] overflow-y-auto pr-1">
            {visibleInteractions.map((item) => {
              if (item.kind === 'ticket') {
                const tk = item.ticket;
                const priorityTone =
                  tk.priority === 'critical'
                    ? 'text-red-700 dark:text-red-400'
                    : tk.priority === 'high'
                    ? 'text-amber-700 dark:text-amber-400'
                    : tk.priority === 'medium'
                    ? 'text-blue-700 dark:text-blue-400'
                    : 'text-slate-600 dark:text-slate-400';

                return (
                  <div
                    key={item.id}
                    className="p-3 bg-slate-50/70 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0 text-[11px]">
                        <TicketIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {tk.reference}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className={`font-semibold ${priorityTone}`}>
                          {TICKET_PRIORITY_LABELS[tk.priority]}
                        </span>
                        <span aria-hidden="true" className="text-slate-400">·</span>
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          {TICKET_STATUS_LABELS[tk.status]}
                        </span>
                      </div>

                      <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap shrink-0">
                        {formatInteractionDate(item.timestampMs)}
                      </span>
                    </div>

                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                      {tk.subject}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="truncate">
                        {TICKET_CHANNEL_LABELS[tk.channel]} · {tk.assignedAgentName || tk.assignedGroup}
                      </span>

                      {onOpenTicket && (
                        <button
                          type="button"
                          onClick={() => onOpenTicket(tk.id)}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-semibold whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <span>{dict.openTicket}</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              }

              const call = item.call;
              const isOutOfZoneOrMissed =
                call.outcome === 'out_of_zone' || call.outcome === 'missed';
              const linkedTicket = call.linkedTicketRef
                ? tickets.find((t) => t.reference === call.linkedTicketRef)
                : undefined;

              return (
                <div
                  key={item.id}
                  className="p-3 bg-slate-50/70 dark:bg-slate-950/50 border border-slate-200/80 dark:border-slate-800 rounded-xl space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0 text-[11px]">
                      {isOutOfZoneOrMissed ? (
                        <PhoneOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                      ) : call.direction === 'inbound' ? (
                        <PhoneIncoming className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      ) : (
                        <PhoneOutgoing className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                      )}
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {call.direction === 'inbound' ? dict.inboundCall : dict.outboundCall}
                      </span>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span
                        className={`font-semibold ${
                          call.outcome === 'out_of_zone' || call.outcome === 'missed'
                            ? 'text-amber-700 dark:text-amber-400'
                            : call.outcome === 'answered'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-blue-700 dark:text-blue-400'
                        }`}
                      >
                        {CALL_OUTCOME_LABELS[call.outcome]}
                      </span>
                      <span aria-hidden="true" className="text-slate-400">·</span>
                      <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {formatDuration(call.durationSeconds)}
                      </span>
                    </div>

                    <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap shrink-0">
                      {formatInteractionDate(item.timestampMs)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {call.notes || dict.noCallNotes}
                  </p>

                  <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="truncate">{dict.agentPrefix} {call.agentName}</span>

                    {call.linkedTicketRef && (
                      linkedTicket && onOpenTicket ? (
                        <button
                          type="button"
                          onClick={() => onOpenTicket(linkedTicket.id)}
                          className="inline-flex items-center gap-1 font-mono font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <span>{call.linkedTicketRef}</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <span className="font-mono font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                          {call.linkedTicketRef}
                        </span>
                      )
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {filteredInteractions.length > 8 && (
          <button
            type="button"
            onClick={() => setShowAllInteractions((v) => !v)}
            className="w-full py-2 px-3 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white bg-slate-50 dark:bg-slate-950/60 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            {showAllInteractions ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>{dict.collapseHistory}</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>{dict.showAllHistory} ({filteredInteractions.length})</span>
              </>
            )}
          </button>
        )}
      </div>
    </aside>
  );
};
