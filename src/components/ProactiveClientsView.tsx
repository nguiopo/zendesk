import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileUser,
  KeyRound,
  PhoneOff,
  PhoneOutgoing,
  Plus,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AppLocale,
  CallLog,
  ClientAccount,
  ClientHealthStatus,
  ClientTier,
  SupportAgent,
  Ticket,
} from '../types/helpdesk';
import { CLIENT_HEALTH_LABELS } from '../lib/formatters';
import { I18N } from '../lib/i18n';
import { clampInt, clampString, sanitizeTicketCreatePayload } from '../lib/validation';
import { ClientDetailPanel } from './ClientDetailPanel';

interface ProactiveClientsViewProps {
  uid: string;
  currentUserName: string;
  clients: ClientAccount[];
  agents: SupportAgent[];
  tickets?: Ticket[];
  callLogs?: CallLog[];
  locale?: AppLocale;
  onSwitchToTicket?: () => void;
  onOpenTicket?: (ticketId: string) => void;
  externalSearchRequest?: { query: string; nonce: number } | null;
}

export const ProactiveClientsView: React.FC<ProactiveClientsViewProps> = ({
  uid,
  currentUserName,
  clients,
  agents,
  tickets = [],
  callLogs = [],
  locale = 'fr',
  onOpenTicket,
  externalSearchRequest,
}) => {
  const dict = I18N[locale].clients;
  const [filterStatus, setFilterStatus] = useState<'all' | 'attention' | 'out_of_zone' | 'password_locked'>('all');
  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(() => clients[0]?.id ?? null);
  const [detailDismissed, setDetailDismissed] = useState(false);

  useEffect(() => {
    if (!externalSearchRequest) return;
    setFilterStatus('all');
    setSearch(externalSearchRequest.query);
    const q = externalSearchRequest.query.trim().toLowerCase();
    if (q) {
      const matched = clients.find(
        (c) =>
          c.companyName.toLowerCase().includes(q) ||
          c.contactName.toLowerCase().includes(q) ||
          c.region.toLowerCase().includes(q)
      );
      if (matched) {
        setSelectedClientId(matched.id);
        setDetailDismissed(false);
      }
    }
  }, [externalSearchRequest, clients]);

  useEffect(() => {
    if (clients.length === 0) {
      setSelectedClientId(null);
      return;
    }
    const exists = selectedClientId ? clients.some((c) => c.id === selectedClientId) : false;
    if (!exists && !detailDismissed) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId, detailDismissed]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [showAddClient, setShowAddClient] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);

  // Client form
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [region, setRegion] = useState('Île-de-France');
  const [tier, setTier] = useState<ClientTier>('Business');

  const leadAgent = agents[0];

  const stats = useMemo(() => {
    return {
      total: clients.length,
      nominal: clients.filter((c) => c.healthStatus === 'nominal').length,
      outOfZone: clients.filter((c) => c.outOfZoneSignal || c.healthStatus === 'out_of_zone').length,
      passwordLocked: clients.filter((c) => c.passwordLocked || c.healthStatus === 'password_locked').length,
      avgAdoption:
        clients.length > 0
          ? Math.round(clients.reduce((acc, c) => acc + c.platformAdoptionPct, 0) / clients.length)
          : 0,
    };
  }, [clients]);

  const interactionCountMap = useMemo(() => {
    const map = new Map<string, { tickets: number; calls: number }>();
    for (const c of clients) {
      const companyNorm = c.companyName.trim().toLowerCase();
      const tkCount = tickets.filter(
        (t) => t.clientId === c.id || t.clientName.trim().toLowerCase() === companyNorm
      ).length;
      const callCount = callLogs.filter(
        (call) => call.clientId === c.id || call.clientName.trim().toLowerCase() === companyNorm
      ).length;
      map.set(c.id, { tickets: tkCount, calls: callCount });
    }
    return map;
  }, [clients, tickets, callLogs]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (filterStatus === 'attention' && c.healthStatus === 'nominal') return false;
      if (filterStatus === 'out_of_zone' && !c.outOfZoneSignal && c.healthStatus !== 'out_of_zone') return false;
      if (filterStatus === 'password_locked' && !c.passwordLocked && c.healthStatus !== 'password_locked') return false;
      if (!q) return true;
      return (
        c.companyName.toLowerCase().includes(q) ||
        c.contactName.toLowerCase().includes(q) ||
        c.region.toLowerCase().includes(q)
      );
    });
  }, [clients, filterStatus, search]);

  const selectedClient = useMemo(
    () => (selectedClientId ? clients.find((c) => c.id === selectedClientId) ?? null : null),
    [clients, selectedClientId]
  );

  const handleSelectClient = (clientId: string) => {
    setSelectedClientId(clientId);
    setDetailDismissed(false);
  };

  const handleVerifySituation = async (client: ClientAccount) => {
    setBusyId(client.id);
    setActionFeedback(null);
    try {
      const nextStatus: ClientHealthStatus = client.passwordLocked
        ? 'password_locked'
        : client.outOfZoneSignal
        ? 'out_of_zone'
        : 'nominal';

      await updateDoc(doc(db, 'clients', client.id), {
        healthStatus: nextStatus,
        lastVerifiedNote: `Situation vérifiée par ${currentUserName} : paramètres plateforme et télémétrie contrôlés.`,
        lastVerifiedAt: 'À l’instant',
        updatedAt: serverTimestamp(),
      });

      if (leadAgent) {
        await updateDoc(doc(db, 'agents', leadAgent.id), {
          situationChecks: increment(1),
          updatedAt: serverTimestamp(),
        });
      }

      setActionFeedback(`Vérification de situation enregistrée pour ${client.companyName}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `clients/${client.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleUnlockPassword = async (client: ClientAccount) => {
    setBusyId(client.id);
    setActionFeedback(null);
    try {
      await updateDoc(doc(db, 'clients', client.id), {
        passwordLocked: false,
        healthStatus: client.outOfZoneSignal ? 'out_of_zone' : 'nominal',
        lastVerifiedNote: `Mot de passe débloqué et lien MFA envoyé par ${currentUserName}.`,
        lastVerifiedAt: 'À l’instant',
        updatedAt: serverTimestamp(),
      });

      const n1Agent = agents.find((a) => a.group === 'N1 Accès & Comptes') || leadAgent;
      if (n1Agent) {
        await updateDoc(doc(db, 'agents', n1Agent.id), {
          passwordUnlocksCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      }

      setActionFeedback(`Accès et mot de passe débloqués pour ${client.contactName} (${client.companyName}).`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `clients/${client.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleOutOfZoneCallFollowup = async (client: ClientAccount) => {
    setBusyId(client.id);
    setActionFeedback(null);
    try {
      const ctiAgent = agents.find((a) => a.group === 'Relation Client & CTI') || leadAgent;
      const ticketReference = `ZD-${2050 + Math.floor(Math.random() * 800)}`;

      if (ctiAgent) {
        await addDoc(collection(db, 'callLogs'), {
          clientId: client.id,
          clientName: client.companyName,
          agentId: ctiAgent.id,
          agentName: ctiAgent.name,
          direction: 'outbound',
          outcome: 'out_of_zone',
          durationSeconds: 35,
          linkedTicketRef: ticketReference,
          notes: `Tentative d’appel proactif vers ${client.contactName} (${client.contactPhone}) — client hors zone, rappel programmé.`,
          ownerId: uid,
          memberIds: [uid],
          createdAt: serverTimestamp(),
        });

        await updateDoc(doc(db, 'agents', ctiAgent.id), {
          callsHandled: increment(1),
          outOfZoneFollowups: increment(1),
          updatedAt: serverTimestamp(),
        });
      }

      const now = Date.now();
      const ticketPayload = sanitizeTicketCreatePayload({
        reference: ticketReference,
        subject: `Suivi appel hors zone — ${client.companyName}`,
        description: `Appel sortant effectué vers ${client.contactName} (${client.contactPhone}). Client signalé hors zone réseau en ${client.region}. Suivi proactif et rappel planifiés.`,
        channel: 'phone',
        status: 'pending_client',
        priority: client.tier === 'Enterprise VIP' ? 'high' : 'medium',
        category: 'Hors zone / Connectivité',
        clientId: client.id,
        clientName: client.companyName,
        assignedAgentId: ctiAgent?.id,
        assignedAgentName: ctiAgent?.name,
        assignedGroup: 'Relation Client & CTI',
        firstResponseDueMs: now + 30 * 60 * 1000,
        resolutionDueMs: now + 240 * 60 * 1000,
        firstResponded: true,
        aiRouted: false,
        isRecurringIncident: false,
        tags: ['hors-zone', 'rappel-proactif'],
        ownerId: uid,
        memberIds: [uid],
      });

      await addDoc(collection(db, 'tickets'), {
        ...ticketPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'clients', client.id), {
        outOfZoneSignal: true,
        healthStatus: 'out_of_zone',
        lastVerifiedNote: `Appel hors zone journalisé par ${currentUserName} ; ticket de rappel proactif créé.`,
        lastVerifiedAt: 'À l’instant',
        updatedAt: serverTimestamp(),
      });

      setActionFeedback(`Appel hors zone journalisé et ticket de suivi proactif créé pour ${client.companyName}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'callLogs');
    } finally {
      setBusyId(null);
    }
  };

  const resetClientForm = () => {
    setEditingClientId(null);
    setCompanyName('');
    setContactName('');
    setContactEmail('');
    setContactPhone('');
    setRegion('Île-de-France');
    setTier('Business');
  };

  const openEditClient = (client: ClientAccount) => {
    setEditingClientId(client.id);
    setCompanyName(client.companyName);
    setContactName(client.contactName);
    setContactEmail(client.contactEmail);
    setContactPhone(client.contactPhone || '');
    setRegion(client.region || 'Île-de-France');
    setTier(client.tier);
    setShowAddClient(true);
  };

  const handleSaveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !contactName.trim() || !contactEmail.trim()) return;
    setBusyId('create');
    try {
      const payload = {
        companyName: clampString(companyName, 150),
        contactName: clampString(contactName, 120),
        contactEmail: clampString(contactEmail, 200),
        contactPhone: clampString(contactPhone || '+33 1 00 00 00 00', 40),
        region: clampString(region, 80, 'France'),
        tier,
        updatedAt: serverTimestamp(),
      };
      if (editingClientId) {
        await updateDoc(doc(db, 'clients', editingClientId), payload);
        setActionFeedback(`Client ${companyName} mis à jour.`);
      } else {
        const createdRef = await addDoc(collection(db, 'clients'), {
          ...payload,
          healthStatus: 'nominal',
          platformAdoptionPct: clampInt(80, 0, 100),
          passwordLocked: false,
          outOfZoneSignal: false,
          lastVerifiedNote: 'Compte ajouté lors de la création.',
          lastVerifiedAt: 'À l’instant',
          ownerId: uid,
          memberIds: [uid],
          createdAt: serverTimestamp(),
        });
        setSelectedClientId(createdRef.id);
        setDetailDismissed(false);
        setActionFeedback(`Compte client ${companyName} ajouté.`);
      }
      setShowAddClient(false);
      resetClientForm();
    } catch (err) {
      handleFirestoreError(err, editingClientId ? OperationType.UPDATE : OperationType.CREATE, editingClientId ? `clients/${editingClientId}` : 'clients');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteClient = async (client: ClientAccount) => {
    if (!window.confirm(`Supprimer le client ${client.companyName} ?`)) return;
    try {
      await deleteDoc(doc(db, 'clients', client.id));
      if (selectedClientId === client.id) setSelectedClientId(null);
      setActionFeedback(`Client ${client.companyName} supprimé.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `clients/${client.id}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{dict.kpiNominal}</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-900/50 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {stats.nominal} / {stats.total}
          </p>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{dict.kpiOutOfZone}</span>
            <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-100 dark:border-amber-900/50 flex items-center justify-center shrink-0">
              <PhoneOff className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400">
            {stats.outOfZone}
          </p>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{dict.kpiPasswordLocked}</span>
            <div className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-950/60 border border-red-100 dark:border-red-900/50 flex items-center justify-center shrink-0">
              <KeyRound className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-red-700 dark:text-red-400">
            {stats.passwordLocked}
          </p>
        </div>
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">{dict.kpiAvgAdoption}</span>
            <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-100 dark:border-blue-900/50 flex items-center justify-center shrink-0">
              <ClipboardCheck className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <p className="font-display text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {stats.avgAdoption}%
          </p>
        </div>
      </div>

      {actionFeedback && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-xl flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-200">
          <span className="font-medium">{actionFeedback}</span>
          <button type="button" onClick={() => setActionFeedback(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Master-Detail Layout: Client Health Table + Fiche Client (Historique des interactions) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Filter & Controls Toolbar + Client Table */}
        <div
          className={`${
            selectedClient ? 'xl:col-span-7' : 'xl:col-span-12'
          } bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden`}
        >
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={dict.searchPlaceholder}
                  className="pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 w-64"
                />
              </div>

              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                {(
                  [
                    ['all', dict.filterAll],
                    ['attention', dict.filterAttention],
                    ['out_of_zone', dict.filterOutOfZone],
                    ['password_locked', dict.filterPasswordLocked],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilterStatus(k)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      filterStatus === k
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowAddClient(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(37,99,235,0.2)]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{dict.addClient}</span>
            </button>
          </div>

          {/* High-Density Client Health Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                  <th className="py-3 px-4">{dict.colClient}</th>
                  <th className="py-3 px-4">{dict.colHealth}</th>
                  <th className="py-3 px-4 text-right">{dict.colAdoption}</th>
                  <th className="py-3 px-4">{dict.colLastCheck}</th>
                  <th className="py-3 px-4 text-right">{dict.colActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {filteredClients.map((client) => {
                  const isBusy = busyId === client.id;
                  const isSelected = selectedClient?.id === client.id;
                  const counts = interactionCountMap.get(client.id) || { tickets: 0, calls: 0 };

                  return (
                    <tr
                      key={client.id}
                      onClick={() => handleSelectClient(client.id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-50/70 dark:bg-blue-950/30'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {client.companyName}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          {client.contactName} · {client.tier} · {client.region}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {client.contactPhone} · {counts.tickets} {dict.ticketWord}{counts.tickets > 1 ? 's' : ''} · {counts.calls} {dict.callWord}{counts.calls > 1 ? 's' : ''}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5 font-medium">
                          {client.healthStatus === 'nominal' && (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span className="text-emerald-700 dark:text-emerald-400">
                                {CLIENT_HEALTH_LABELS[client.healthStatus]}
                              </span>
                            </>
                          )}
                          {(client.healthStatus === 'out_of_zone' || client.healthStatus === 'degraded') && (
                            <>
                              <PhoneOff className="w-4 h-4 text-amber-600 shrink-0" />
                              <span className="text-amber-700 dark:text-amber-400">
                                {CLIENT_HEALTH_LABELS[client.healthStatus]}
                              </span>
                            </>
                          )}
                          {(client.healthStatus === 'password_locked' || client.healthStatus === 'critical') && (
                            <>
                              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                              <span className="text-red-700 dark:text-red-400">
                                {CLIENT_HEALTH_LABELS[client.healthStatus]}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {client.platformAdoptionPct}%
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        <p className="text-slate-700 dark:text-slate-300 line-clamp-2">
                          {client.lastVerifiedNote || 'Aucune vérification récente'}
                        </p>
                        <span className="text-[11px] text-slate-400">{client.lastVerifiedAt || '—'}</span>
                      </td>
                      <td
                        className="py-3.5 px-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectClient(client.id)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 border rounded-lg font-medium whitespace-nowrap shrink-0 cursor-pointer ${
                              isSelected
                                ? 'border-blue-500 bg-blue-600 text-white'
                                : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            <FileUser className="w-3.5 h-3.5" />
                            <span>{dict.btnCard}</span>
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleVerifySituation(client)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg font-medium whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <ClipboardCheck className="w-3.5 h-3.5 text-blue-600" />
                            <span>{dict.btnVerify}</span>
                          </button>

                          {client.passwordLocked && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleUnlockPassword(client)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>{dict.btnUnlock}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleOutOfZoneCallFollowup(client)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg font-medium whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <PhoneOutgoing className="w-3.5 h-3.5" />
                            <span>{dict.btnOutOfZone}</span>
                          </button>
                          <button type="button" onClick={() => openEditClient(client)} className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg text-xs cursor-pointer">Modifier</button>
                          <button type="button" onClick={() => handleDeleteClient(client)} className="px-2.5 py-1.5 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 rounded-lg text-xs cursor-pointer">Supprimer</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Client Detail Card ("Fiche client" with Historique des interactions) */}
        {selectedClient && (
          <div className="xl:col-span-5">
            <ClientDetailPanel
              client={selectedClient}
              tickets={tickets}
              callLogs={callLogs}
              locale={locale}
              busy={busyId === selectedClient.id}
              onClose={() => {
                setSelectedClientId(null);
                setDetailDismissed(true);
              }}
              onVerifySituation={handleVerifySituation}
              onUnlockPassword={handleUnlockPassword}
              onOutOfZoneCallFollowup={handleOutOfZoneCallFollowup}
              onOpenTicket={onOpenTicket}
              onEdit={openEditClient}
              onDelete={handleDeleteClient}
            />
          </div>
        )}
      </div>

      {/* Add Client Modal */}
      {showAddClient && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {editingClientId ? 'Modifier le client' : 'Ajouter un compte client suivi'}
              </h3>
              <button type="button" onClick={() => { setShowAddClient(false); resetClientForm(); }} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleSaveClient} className="space-y-3">
              <input
                type="text"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Nom de l’entreprise"
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <input
                type="text"
                required
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Nom du contact principal"
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <input
                type="email"
                required
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Email professionnel"
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <input
                type="text"
                required
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="Téléphone (+33 ...)"
                className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="Région"
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
                <select
                  value={tier}
                  onChange={(e) => setTier(e.target.value as ClientTier)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  <option value="Enterprise VIP">Enterprise VIP</option>
                  <option value="Business">Business</option>
                  <option value="Standard">Standard</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowAddClient(false); resetClientForm(); }}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={busyId === 'create'}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{editingClientId ? 'Mettre à jour' : 'Enregistrer'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
