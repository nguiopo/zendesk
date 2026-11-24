import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  BellRing,
  CheckCircle2,
  Download,
  FileLock2,
  Globe,
  Key,
  Lock,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  UserCog,
  Webhook,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  AppLocale,
  AuditLogEntry,
  CallLog,
  ClientAccount,
  CsatSurvey,
  ExternalIntegration,
  RbacPermissionKey,
  Ticket,
  UserRoleKey,
  WorkspaceConfig,
} from '../types/helpdesk';
import { I18N, LOCALE_OPTIONS } from '../lib/i18n';
import {
  downloadCsvFile,
  MAX_SLA_ALERT_THRESHOLD_PCT,
  MIN_SLA_ALERT_THRESHOLD_PCT,
  resolveSlaAlertThresholdPct,
} from '../lib/formatters';
import { recordAuditLog } from '../lib/kbSuggestions';
import { clampString } from '../lib/validation';
import { AuditDashboardCard } from './AuditDashboardCard';

interface IntegrationsAdminViewProps {
  uid: string;
  currentUserName: string;
  locale: AppLocale;
  onLocaleChange: (loc: AppLocale) => void;
  integrations: ExternalIntegration[];
  workspaceConfig?: WorkspaceConfig;
  auditLogs: AuditLogEntry[];
  clients: ClientAccount[];
  tickets: Ticket[];
  callLogs: CallLog[];
  csatSurveys: CsatSurvey[];
}

const PERMISSION_LABELS: { key: RbacPermissionKey; label: string; scope: string }[] = [
  { key: 'tickets_manage', label: 'Traitement tickets & SLA', scope: 'File Zammad, macros & réponses' },
  { key: 'reports_export', label: 'Rapports & Exports PDF/CSV', scope: 'Reporting équipe & direction' },
  { key: 'wfm_oncall', label: 'Planification WFM & Astreintes', scope: 'Shifts, congés & couverture' },
  { key: 'qa_evaluate', label: 'Contrôle Qualité (QA)', scope: 'Grilles d’évaluation & coaching' },
  { key: 'kb_publish', label: 'Publication Base de connaissances', scope: 'Articles multilingues & forum' },
  { key: 'integrations_api', label: 'API, Webhooks & Marketplace', scope: 'Connecteurs CRM/ERP/Jira' },
  { key: 'gdpr_privacy', label: 'Outils RGPD (Export / Anonymisation)', scope: 'Données personnelles clients' },
  { key: 'rbac_admin', label: 'Administration Rôles & Sécurité', scope: 'Matrice RBAC & journal audit' },
];

const DEFAULT_PERMS: Record<UserRoleKey, RbacPermissionKey[]> = {
  agent: ['tickets_manage', 'kb_publish'],
  supervisor: ['tickets_manage', 'reports_export', 'wfm_oncall', 'qa_evaluate', 'kb_publish'],
  admin: [
    'tickets_manage',
    'reports_export',
    'wfm_oncall',
    'qa_evaluate',
    'kb_publish',
    'integrations_api',
    'gdpr_privacy',
    'rbac_admin',
  ],
};

export const IntegrationsAdminView: React.FC<IntegrationsAdminViewProps> = ({
  uid,
  currentUserName,
  locale,
  onLocaleChange,
  integrations,
  workspaceConfig,
  auditLogs,
  clients,
  tickets,
  callLogs,
  csatSurveys,
}) => {
  const dict = I18N[locale].admin;
  const [subTab, setSubTab] = useState<'marketplace' | 'webhooks' | 'rbac' | 'gdpr'>('marketplace');

  // Webhook creation & testing state
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [whName, setWhName] = useState('');
  const [whProvider, setWhProvider] = useState('Jira Software');
  const [whUrl, setWhUrl] = useState('https://example.com/webhooks/zentradesk');
  const [whEvents, setWhEvents] = useState('ticket.created, sla.warning_80, incident.escalated');
  const [savingWh, setSavingWh] = useState(false);
  const [testingWhId, setTestingWhId] = useState<string | null>(null);
  const [whTestBanner, setWhTestBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // RBAC & Config state
  const [previewRole, setPreviewRole] = useState<UserRoleKey>('supervisor');
  const [copiedPrefix, setCopiedPrefix] = useState(false);

  // RGPD state
  const [retentionDays, setRetentionDays] = useState<number>(workspaceConfig?.gdprRetentionDays ?? 730);
  const [anonymizeDays, setAnonymizeDays] = useState<number>(
    workspaceConfig?.anonymizeClosedAfterDays ?? 365
  );
  const [savingRetention, setSavingRetention] = useState(false);
  const [confirmAnonymizeId, setConfirmAnonymizeId] = useState<string | null>(null);
  const [gdprNotice, setGdprNotice] = useState<string | null>(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditCategoryFilter, setAuditCategoryFilter] = useState<'all' | AuditLogEntry['category']>('all');
  const [exportingAuditCsv, setExportingAuditCsv] = useState(false);

  // SLA Visual Alert Pulse Threshold state
  const savedSlaThresholdPct = resolveSlaAlertThresholdPct(workspaceConfig);
  const [slaThresholdInput, setSlaThresholdInput] = useState<string>(String(savedSlaThresholdPct));
  const [savingSlaThreshold, setSavingSlaThreshold] = useState(false);
  const [slaThresholdNotice, setSlaThresholdNotice] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  useEffect(() => {
    setSlaThresholdInput(String(resolveSlaAlertThresholdPct(workspaceConfig)));
  }, [workspaceConfig]);

  const marketplaceApps = useMemo(
    () => integrations.filter((i) => i.kind === 'marketplace'),
    [integrations]
  );
  const webhooks = useMemo(
    () => integrations.filter((i) => i.kind === 'webhook'),
    [integrations]
  );

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (auditCategoryFilter !== 'all' && l.category !== auditCategoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        l.actorName.toLowerCase().includes(q) ||
        l.actorRole.toLowerCase().includes(q) ||
        l.targetLabel.toLowerCase().includes(q) ||
        l.category.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, auditSearch, auditCategoryFilter]);

  const formatAuditTimestamp = (createdAt?: AuditLogEntry['createdAt']) => {
    const ms =
      typeof createdAt?.toMillis === 'function'
        ? createdAt.toMillis()
        : typeof createdAt?.seconds === 'number'
        ? createdAt.seconds * 1000
        : undefined;
    if (!ms) {
      return {
        iso: new Date().toISOString(),
        display: 'Horodatage en attente',
      };
    }
    const date = new Date(ms);
    return {
      iso: date.toISOString(),
      display: date.toLocaleString('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };
  };

  const handleExportAuditLogsCsv = async () => {
    if (filteredAuditLogs.length === 0 || exportingAuditCsv) return;
    setExportingAuditCsv(true);
    try {
      const headers = [
        'ID Événement',
        'Timestamp',
        'Date locale',
        'Utilisateur',
        'Rôle',
        'Catégorie',
        'Action',
        'Cible',
        'Détail',
      ];

      const rows = filteredAuditLogs.map((log) => {
        const ts = formatAuditTimestamp(log.createdAt);
        return [
          log.id,
          ts.iso,
          ts.display,
          log.actorName,
          log.actorRole,
          log.category.toUpperCase(),
          log.action,
          log.targetLabel,
          log.details,
        ];
      });

      const isFiltered = auditCategoryFilter !== 'all' || auditSearch.trim().length > 0;
      const dateStamp = new Date().toISOString().slice(0, 10);
      const filename = isFiltered
        ? `journal-audit-zentradesk-filtre-${dateStamp}.csv`
        : `journal-audit-zentradesk-${dateStamp}.csv`;

      downloadCsvFile(filename, headers, rows);

      const filterNotes: string[] = [];
      if (auditCategoryFilter !== 'all') filterNotes.push(`catégorie=${auditCategoryFilter}`);
      if (auditSearch.trim()) filterNotes.push(`recherche="${auditSearch.trim()}"`);

      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: 'Exportation journal d’audit (CSV)',
        category: 'rgpd',
        targetLabel: clampString(
          isFiltered ? `Journal filtré (${filterNotes.join(', ')})` : 'Journal d’audit complet',
          180
        ),
        details: `${filteredAuditLogs.length} entrée(s) exportée(s) en CSV pour conformité et reporting externe.`,
      });

      setGdprNotice(
        `Export CSV du journal d’audit téléchargé (${filteredAuditLogs.length} entrée${
          filteredAuditLogs.length > 1 ? 's' : ''
        }).`
      );
    } finally {
      setExportingAuditCsv(false);
    }
  };

  const configDocId = workspaceConfig?.id || `cfg_${uid.slice(0, 8)}`;

  const ensureConfigDoc = async (patch: Record<string, unknown>) => {
    if (workspaceConfig) {
      await updateDoc(doc(db, 'workspaceConfigs', workspaceConfig.id), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(doc(db, 'workspaceConfigs', configDocId), {
        defaultLanguage: locale,
        gdprRetentionDays: retentionDays,
        anonymizeClosedAfterDays: anonymizeDays,
        apiKeyPrefix: 'zd_live_98a4',
        agentPermissions: DEFAULT_PERMS.agent,
        supervisorPermissions: DEFAULT_PERMS.supervisor,
        adminPermissions: DEFAULT_PERMS.admin,
        ownerId: uid,
        memberIds: [uid],
        ...patch,
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleToggleIntegration = async (item: ExternalIntegration) => {
    try {
      await updateDoc(doc(db, 'integrations', item.id), {
        active: !item.active,
        lastStatus: !item.active ? 'Connecté' : 'En pause',
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: !item.active ? `Activation ${item.provider}` : `Suspension ${item.provider}`,
        category: item.kind === 'webhook' ? 'webhook' : 'integration',
        targetLabel: item.name,
        details: `Statut basculé vers ${!item.active ? 'Actif' : 'Pause'}.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `integrations/${item.id}`);
    }
  };

  const handleSyncMarketplace = async (item: ExternalIntegration) => {
    try {
      const nowIso = new Date().toISOString();
      await updateDoc(doc(db, 'integrations', item.id), {
        syncCount: increment(1),
        lastSyncAt: nowIso,
        lastStatus: 'Synchronisé (HTTP 200)',
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: `Synchronisation ${item.provider}`,
        category: 'integration',
        targetLabel: item.name,
        details: `Flux synchronisés : ${item.eventsSummary}`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `integrations/${item.id}`);
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!whName.trim() || !/^https?:\/\/.+/i.test(whUrl.trim())) return;
    setSavingWh(true);
    try {
      await addDoc(collection(db, 'integrations'), {
        kind: 'webhook',
        provider: clampString(whProvider, 80, 'Webhook'),
        name: clampString(whName, 120),
        category: 'Webhook REST',
        endpointUrl: clampString(whUrl, 500),
        eventsSummary: clampString(whEvents, 300, 'ticket.created'),
        active: true,
        syncCount: 0,
        lastStatus: 'Prêt pour test',
        ownerId: uid,
        memberIds: [uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: 'Ajout webhook sortant',
        category: 'webhook',
        targetLabel: clampString(whName, 180),
        details: `Cible ${whProvider} · Événements : ${whEvents}`,
      });
      setShowWebhookModal(false);
      setWhName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'integrations');
    } finally {
      setSavingWh(false);
    }
  };

  const handleTestWebhook = async (wh: ExternalIntegration) => {
    if (!wh.endpointUrl) return;
    setTestingWhId(wh.id);
    setWhTestBanner(null);
    try {
      const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: wh.endpointUrl,
          eventName: 'ticket.sla_alert_test',
          provider: wh.provider,
        }),
      });
      const data = await res.json();
      const code = data.statusCode ?? data.status;
      const statusText = data.ok
        ? `HTTP ${code} (${data.latencyMs}ms)`
        : data.error || `HTTP ${code || 'Erreur'}`;

      await updateDoc(doc(db, 'integrations', wh.id), {
        syncCount: increment(1),
        lastSyncAt: new Date().toISOString(),
        lastStatus: clampString(statusText, 80),
        updatedAt: serverTimestamp(),
      });

      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: 'Test webhook sortant',
        category: 'webhook',
        targetLabel: wh.name,
        details: statusText,
      });

      setWhTestBanner({
        ok: Boolean(data.ok),
        text: data.ok
          ? `Webhook « ${wh.name} » validé : ${statusText}`
          : `Test webhook « ${wh.name} » refusé / échoué : ${statusText}`,
      });
    } catch (err) {
      setWhTestBanner({
        ok: false,
        text: err instanceof Error ? err.message : 'Erreur réseau lors du test webhook.',
      });
    } finally {
      setTestingWhId(null);
    }
  };

  const handleRotateApiPrefix = async () => {
    const nextPrefix = `zd_live_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await ensureConfigDoc({ apiKeyPrefix: nextPrefix });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: 'Rotation préfixe clé API REST',
        category: 'webhook',
        targetLabel: nextPrefix,
        details: 'Nouveau préfixe généré pour les intégrations API.',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workspaceConfigs/${configDocId}`);
    }
  };

  const rolePermissions: Record<UserRoleKey, string[]> = {
    agent: workspaceConfig?.agentPermissions ?? DEFAULT_PERMS.agent,
    supervisor: workspaceConfig?.supervisorPermissions ?? DEFAULT_PERMS.supervisor,
    admin: workspaceConfig?.adminPermissions ?? DEFAULT_PERMS.admin,
  };

  const handleTogglePermission = async (role: UserRoleKey, perm: RbacPermissionKey) => {
    const current = rolePermissions[role];
    const exists = current.includes(perm);
    const updated = exists ? current.filter((p) => p !== perm) : [...current, perm];
    const fieldName =
      role === 'agent'
        ? 'agentPermissions'
        : role === 'supervisor'
        ? 'supervisorPermissions'
        : 'adminPermissions';
    try {
      await ensureConfigDoc({ [fieldName]: updated });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: `Permission RBAC ${exists ? 'retirée' : 'accordée'}`,
        category: 'rbac',
        targetLabel: `${role.toUpperCase()} · ${perm}`,
        details: `Matrice de droits mise à jour (${updated.length} permissions).`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workspaceConfigs/${configDocId}`);
    }
  };

  const handleChangeWorkspaceLanguage = async (nextLocale: AppLocale) => {
    onLocaleChange(nextLocale);
    try {
      await ensureConfigDoc({ defaultLanguage: nextLocale });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: 'Changement langue workspace',
        category: 'rbac',
        targetLabel: nextLocale.toUpperCase(),
        details: `Interface et portail configurés en ${nextLocale.toUpperCase()}.`,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workspaceConfigs/${configDocId}`);
    }
  };

  const handleSaveRetention = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRetention(true);
    try {
      const safeRet = Math.max(30, Math.min(3650, Math.round(retentionDays)));
      const safeAnon = Math.max(30, Math.min(3650, Math.round(anonymizeDays)));
      await ensureConfigDoc({
        gdprRetentionDays: safeRet,
        anonymizeClosedAfterDays: safeAnon,
      });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: 'Politique de rétention RGPD mise à jour',
        category: 'rgpd',
        targetLabel: `${safeRet}j conservation / ${safeAnon}j anonymisation`,
        details: 'Paramètres de conformité RGPD sauvegardés.',
      });
      setGdprNotice('Politique de rétention RGPD mise à jour.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workspaceConfigs/${configDocId}`);
    } finally {
      setSavingRetention(false);
    }
  };

  const parsedSlaThreshold = Number(slaThresholdInput);
  const isSlaThresholdValid =
    slaThresholdInput.trim() !== '' &&
    Number.isFinite(parsedSlaThreshold) &&
    Number.isInteger(parsedSlaThreshold) &&
    parsedSlaThreshold >= MIN_SLA_ALERT_THRESHOLD_PCT &&
    parsedSlaThreshold <= MAX_SLA_ALERT_THRESHOLD_PCT;

  const handleSaveSlaThreshold = async (e?: React.FormEvent, explicitPct?: number) => {
    if (e) e.preventDefault();
    const targetRaw = explicitPct ?? Number(slaThresholdInput);
    if (
      !Number.isFinite(targetRaw) ||
      !Number.isInteger(targetRaw) ||
      targetRaw < MIN_SLA_ALERT_THRESHOLD_PCT ||
      targetRaw > MAX_SLA_ALERT_THRESHOLD_PCT
    ) {
      setSlaThresholdNotice({ ok: false, text: dict.slaPulseRangeError });
      return;
    }

    const safePct = Math.min(
      MAX_SLA_ALERT_THRESHOLD_PCT,
      Math.max(MIN_SLA_ALERT_THRESHOLD_PCT, Math.round(targetRaw))
    );
    setSlaThresholdInput(String(safePct));
    setSavingSlaThreshold(true);
    setSlaThresholdNotice(null);

    try {
      await ensureConfigDoc({ slaAlertThresholdPct: safePct });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: 'Seuil d’alerte visuelle SLA mis à jour',
        category: 'rbac',
        targetLabel: `sla-alert-pulse ≥ ${safePct}%`,
        details: `Déclenchement de l’animation sla-alert-pulse réglé sur ${safePct}% (précédent : ${savedSlaThresholdPct}%).`,
      });
      setSlaThresholdNotice({
        ok: true,
        text: dict.slaPulseSavedNotice.replace('{pct}', String(safePct)),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `workspaceConfigs/${configDocId}`);
    } finally {
      setSavingSlaThreshold(false);
    }
  };

  const handleExportClientGdpr = async (client: ClientAccount) => {
    const bundle = {
      exportedAt: new Date().toISOString(),
      regulation: 'RGPD Art. 15 & Art. 20 - Portabilité des données',
      client: {
        id: client.id,
        companyName: client.companyName,
        contactName: client.contactName,
        contactEmail: client.contactEmail,
        contactPhone: client.contactPhone,
        region: client.region,
        tier: client.tier,
      },
      tickets: tickets
        .filter((t) => t.clientId === client.id)
        .map((t) => ({
          reference: t.reference,
          subject: t.subject,
          status: t.status,
          category: t.category,
          priority: t.priority,
        })),
      callLogs: callLogs
        .filter((c) => c.clientId === client.id)
        .map((c) => ({
          direction: c.direction,
          outcome: c.outcome,
          durationSeconds: c.durationSeconds,
          notes: c.notes,
        })),
      csatSurveys: csatSurveys
        .filter((s) => s.clientId === client.id)
        .map((s) => ({
          ticketRef: s.ticketRef,
          rating: s.rating,
          comment: s.comment,
        })),
    };

    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rgpd-export-${client.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    await recordAuditLog({
      uid,
      actorName: currentUserName,
      actorRole: 'admin',
      action: 'Exportation dossier RGPD (JSON)',
      category: 'rgpd',
      targetLabel: client.companyName,
      details: `${bundle.tickets.length} tickets, ${bundle.callLogs.length} appels et ${bundle.csatSurveys.length} enquêtes CSAT exportés.`,
    });
    setGdprNotice(`Export RGPD JSON téléchargé pour ${client.companyName}.`);
  };

  const handleAnonymizeClient = async (client: ClientAccount) => {
    try {
      await updateDoc(doc(db, 'clients', client.id), {
        contactName: 'Contact Anonymisé (RGPD)',
        contactEmail: `rgpd-${client.id.slice(0, 6)}@redacted.invalid`,
        contactPhone: '+33 0 00 00 00 00',
        lastVerifiedNote: `PII anonymisées selon RGPD Art. 17 par ${currentUserName}.`,
        lastVerifiedAt: new Date().toISOString(),
        updatedAt: serverTimestamp(),
      });
      await recordAuditLog({
        uid,
        actorName: currentUserName,
        actorRole: 'admin',
        action: 'Anonymisation PII client (Droit à l’effacement)',
        category: 'rgpd',
        targetLabel: client.companyName,
        details: 'Nom, e-mail et téléphone du contact anonymisés de façon irréversible.',
      });
      setConfirmAnonymizeId(null);
      setGdprNotice(`Données personnelles du contact ${client.companyName} anonymisées.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `clients/${client.id}`);
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
              ['marketplace', dict.tabMarketplace, PlugZap],
              ['webhooks', dict.tabWebhooks, Webhook],
              ['rbac', dict.tabRbac, UserCog],
              ['gdpr', dict.tabGdpr, FileLock2],
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

      {/* SLA Visual Alert Threshold Setting (sla-alert-pulse) */}
      <form
        onSubmit={handleSaveSlaThreshold}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <BellRing className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                {dict.slaPulseTitle}
              </h3>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/80 text-red-700 dark:text-red-300 font-mono text-[11px] font-semibold tabular-nums whitespace-nowrap shrink-0 sla-alert-pulse">
                <span>
                  {dict.slaPulsePreviewPill} ≥{savedSlaThresholdPct}%
                </span>
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{dict.slaPulseSubtitle}</p>
          </div>

          <div className="flex flex-wrap items-end gap-2.5 shrink-0">
            <div
              role="group"
              aria-label={dict.slaPulseInputLabel}
              className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
            >
              {[75, 80, 85, 90].map((preset) => {
                const isSelected = Number(slaThresholdInput) === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={savingSlaThreshold}
                    onClick={() => handleSaveSlaThreshold(undefined, preset)}
                    className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      isSelected
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {preset}%
                  </button>
                );
              })}
            </div>

            <label className="block space-y-1">
              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                {dict.slaPulseInputLabel}
              </span>
              <div className="relative flex items-center">
                <input
                  type="number"
                  min={MIN_SLA_ALERT_THRESHOLD_PCT}
                  max={MAX_SLA_ALERT_THRESHOLD_PCT}
                  step={1}
                  value={slaThresholdInput}
                  onChange={(e) => {
                    setSlaThresholdInput(e.target.value);
                    if (slaThresholdNotice) setSlaThresholdNotice(null);
                  }}
                  aria-label={dict.slaPulseInputLabel}
                  className="w-24 pl-3 pr-7 py-1.5 text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <span className="absolute right-2.5 text-xs font-mono text-slate-400 pointer-events-none">
                  %
                </span>
              </div>
            </label>

            <button
              type="submit"
              disabled={
                savingSlaThreshold ||
                !isSlaThresholdValid ||
                Number(slaThresholdInput) === savedSlaThresholdPct
              }
              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              {savingSlaThreshold ? dict.slaPulseSaving : dict.slaPulseSave}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <span className="font-mono tabular-nums">
            {dict.slaPulseActivePrefix} : <strong className="text-slate-800 dark:text-slate-200">{savedSlaThresholdPct}%</strong> · {dict.slaPulseRangeHint}
          </span>
          {slaThresholdNotice && (
            <span
              role="status"
              className={`font-medium ${
                slaThresholdNotice.ok
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-red-700 dark:text-red-400'
              }`}
            >
              {slaThresholdNotice.text}
            </span>
          )}
        </div>
      </form>

      {/* TAB 1: MARKETPLACE NATIVE INTEGRATIONS */}
      {subTab === 'marketplace' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {marketplaceApps.map((app) => (
            <div
              key={app.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-medium text-blue-700 dark:text-blue-400">
                      {app.category}
                    </span>
                    <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                      {app.name}
                    </h3>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                      app.active
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {app.active ? 'Connecté' : 'En pause'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {app.eventsSummary}
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-mono tabular-nums">{app.syncCount} synchros</span>
                  <span className="truncate max-w-[160px]">{app.lastStatus || 'Prêt'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSyncMarketplace(app)}
                    disabled={!app.active}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 disabled:opacity-50 text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Synchroniser</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleIntegration(app)}
                    className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {app.active ? 'Suspendre' : 'Activer'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 2: API & WEBHOOKS */}
      {subTab === 'webhooks' && (
        <div className="space-y-5">
          {/* REST API Key Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <Key className="w-4 h-4 text-blue-600" />
                <span>Clé d’accès API REST ZentraDesk (CRM / ERP / Jira)</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Authentification Bearer avec signature HMAC-SHA256 sur les webhooks sortants.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <code className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-800 dark:text-slate-200">
                {workspaceConfig?.apiKeyPrefix || 'zd_live_98a4'}••••••••••••
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(workspaceConfig?.apiKeyPrefix || 'zd_live_98a4');
                  setCopiedPrefix(true);
                  window.setTimeout(() => setCopiedPrefix(false), 2000);
                }}
                className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                {copiedPrefix ? 'Copié' : 'Copier préfixe'}
              </button>
              <button
                type="button"
                onClick={handleRotateApiPrefix}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold rounded-lg cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Régénérer</span>
              </button>
            </div>
          </div>

          {whTestBanner && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-center gap-2 ${
                whTestBanner.ok
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200'
                  : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'
              }`}
            >
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{whTestBanner.text}</span>
            </div>
          )}

          {/* Webhooks List */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Webhooks sortants ({webhooks.length})
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Validation anti-SSRF stricte côté serveur avant chaque envoi HTTP.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWebhookModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Nouveau webhook</span>
              </button>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {webhooks.map((wh) => (
                <div key={wh.id} className="p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {wh.name}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-medium">
                        {wh.provider}
                      </span>
                      <span
                        className={`text-[11px] font-mono ${
                          wh.active
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {wh.lastStatus || (wh.active ? 'Actif' : 'Inactif')}
                      </span>
                    </div>
                    <p className="font-mono text-xs text-slate-600 dark:text-slate-400 truncate">
                      {wh.endpointUrl}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Événements : {wh.eventsSummary} · <span className="font-mono">{wh.syncCount}</span> appels
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleTestWebhook(wh)}
                      disabled={testingWhId === wh.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>{testingWhId === wh.id ? 'Test...' : 'Tester webhook'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleIntegration(wh)}
                      className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 text-xs font-medium rounded-lg cursor-pointer"
                    >
                      {wh.active ? 'Désactiver' : 'Activer'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: ROLES RBAC & LANGUAGES */}
      {subTab === 'rbac' && (
        <div className="space-y-5">
          {/* Multilingual Switcher */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Globe className="w-4 h-4 text-blue-600" />
                <span>Support multilingue (Interface &amp; Base de connaissances)</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Basculez la langue active du workspace et priorisez les articles correspondants.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {LOCALE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleChangeWorkspaceLanguage(opt.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors ${
                    locale === opt.id
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {opt.short} · {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Granular RBAC Matrix */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Gestion des rôles et permissions granulaires (RBAC)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Chaque modification est journalisée en temps réel dans l’audit de sécurité.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Simuler le rôle :</span>
                <select
                  value={previewRole}
                  onChange={(e) => setPreviewRole(e.target.value as UserRoleKey)}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-medium"
                >
                  <option value="agent">Agent ({rolePermissions.agent.length}/8)</option>
                  <option value="supervisor">Superviseur ({rolePermissions.supervisor.length}/8)</option>
                  <option value="admin">Admin ({rolePermissions.admin.length}/8)</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4">Permission fonctionnelle</th>
                    <th className="py-3 px-4 text-center">Agent</th>
                    <th className="py-3 px-4 text-center">Superviseur</th>
                    <th className="py-3 px-4 text-center">Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {PERMISSION_LABELS.map((perm) => {
                    const previewActive = rolePermissions[previewRole].includes(perm.key);
                    return (
                      <tr
                        key={perm.key}
                        className={previewActive ? 'bg-blue-50/30 dark:bg-blue-950/15' : ''}
                      >
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {perm.label}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {perm.scope}
                          </div>
                        </td>
                        {(['agent', 'supervisor', 'admin'] as UserRoleKey[]).map((role) => {
                          const enabled = rolePermissions[role].includes(perm.key);
                          return (
                            <td key={role} className="py-3 px-4 text-center">
                              <button
                                type="button"
                                onClick={() => handleTogglePermission(role, perm.key)}
                                className={`px-3 py-1 rounded-md text-[11px] font-semibold border cursor-pointer transition-colors ${
                                  enabled
                                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-400'
                                }`}
                              >
                                {enabled ? 'Autorisé' : 'Restreint'}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: GDPR PRIVACY & AUDIT LOG */}
      {subTab === 'gdpr' && (
        <div className="space-y-5">
          {gdprNotice && (
            <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{gdprNotice}</span>
            </div>
          )}

          {/* Retention Policy */}
          <form
            onSubmit={handleSaveRetention}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-end justify-between gap-4"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                <Shield className="w-4 h-4 text-blue-600" />
                <span>Politique de conservation &amp; d’anonymisation RGPD</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Définissez les durées légales de rétention des journaux et d’anonymisation des tickets clôturés.
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Rétention globale (jours)
                </span>
                <input
                  type="number"
                  min={30}
                  max={3650}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                  className="w-28 px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Anonymisation après clôture (j)
                </span>
                <input
                  type="number"
                  min={30}
                  max={3650}
                  value={anonymizeDays}
                  onChange={(e) => setAnonymizeDays(Number(e.target.value))}
                  className="w-28 px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>
              <button
                type="submit"
                disabled={savingRetention}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
              >
                {savingRetention ? 'Sauvegarde...' : 'Enregistrer'}
              </button>
            </div>
          </form>

          {/* Per-client Export / Anonymization */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Portabilité (Art. 20) &amp; Droit à l’effacement (Art. 17 RGPD)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/40">
                    <th className="py-3 px-4">Compte client</th>
                    <th className="py-3 px-4">Contact PII</th>
                    <th className="py-3 px-4 text-right">Actions RGPD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {clients.map((cl) => (
                    <tr key={cl.id}>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {cl.companyName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {cl.region} · {cl.tier}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-800 dark:text-slate-200">{cl.contactName}</div>
                        <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {cl.contactEmail} · {cl.contactPhone}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleExportClientGdpr(cl)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs font-medium cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 text-blue-600" />
                            <span>Exporter JSON</span>
                          </button>

                          {confirmAnonymizeId === cl.id ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleAnonymizeClient(cl)}
                                className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
                              >
                                Confirmer effacement
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmAnonymizeId(null)}
                                className="px-2 py-1.5 text-xs text-slate-500 cursor-pointer"
                              >
                                Annuler
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmAnonymizeId(cl.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg text-xs font-medium cursor-pointer"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>Anonymiser PII</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Audit Dashboard (Last 30 Days) */}
          <AuditDashboardCard
            auditLogs={auditLogs}
            locale={locale}
            selectedCategory={auditCategoryFilter}
            onSelectCategory={setAuditCategoryFilter}
          />

          {/* Immutable Audit Log */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Journal d’audit immuable (
                  <span className="font-mono tabular-nums">{filteredAuditLogs.length}</span>
                  {filteredAuditLogs.length !== auditLogs.length && (
                    <span className="text-slate-500 dark:text-slate-400 font-normal">
                      {' '}
                      / <span className="font-mono tabular-nums">{auditLogs.length}</span>
                    </span>
                  )}
                  )
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Traçabilité en écriture seule (non modifiable) des actions RGPD, RBAC, webhooks et QA.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Filtrer par catégorie d’audit"
                  value={auditCategoryFilter}
                  onChange={(e) =>
                    setAuditCategoryFilter(e.target.value as 'all' | AuditLogEntry['category'])
                  }
                  className="px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200"
                >
                  <option value="all">Toutes catégories</option>
                  <option value="rgpd">RGPD</option>
                  <option value="rbac">RBAC</option>
                  <option value="webhook">Webhook</option>
                  <option value="integration">Intégration</option>
                  <option value="qa">QA</option>
                  <option value="kb">Base de connaissances</option>
                </select>
                <div className="relative w-56">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Filtrer le journal..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleExportAuditLogsCsv}
                  disabled={filteredAuditLogs.length === 0 || exportingAuditCsv}
                  title={`Exporter ${filteredAuditLogs.length} entrée(s) du journal d’audit en CSV`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-white dark:text-slate-900 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{exportingAuditCsv ? 'Export...' : 'Exporter CSV'}</span>
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[360px] overflow-y-auto">
              {filteredAuditLogs.length === 0 ? (
                <div className="p-8 text-center space-y-2">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Aucune entrée d’audit ne correspond aux filtres sélectionnés.
                  </p>
                  {(auditSearch.trim() !== '' || auditCategoryFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuditSearch('');
                        setAuditCategoryFilter('all');
                      }}
                      className="px-3 py-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      Réinitialiser les filtres
                    </button>
                  )}
                </div>
              ) : (
                filteredAuditLogs.map((log) => {
                  const ts = formatAuditTimestamp(log.createdAt);
                  return (
                    <div
                      key={log.id}
                      className="p-4 flex flex-wrap items-start justify-between gap-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            {log.category.toUpperCase()}
                          </span>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {log.action}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono text-blue-700 dark:text-blue-400">
                            {log.targetLabel}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400">{log.details}</p>
                      </div>
                      <div className="text-right text-[11px] text-slate-500 dark:text-slate-400 shrink-0 space-y-0.5">
                        <div>
                          {log.actorName} ({log.actorRole})
                        </div>
                        <div className="font-mono tabular-nums text-[10px] text-slate-400 dark:text-slate-500">
                          {ts.display}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Webhook Modal */}
      {showWebhookModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                Configurer un webhook sortant
              </h3>
              <button type="button" onClick={() => setShowWebhookModal(false)} className="cursor-pointer">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <form onSubmit={handleCreateWebhook} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Nom</span>
                <input
                  type="text"
                  required
                  value={whName}
                  onChange={(e) => setWhName(e.target.value)}
                  placeholder="Ex: Synchronisation escalades Jira N3"
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Système cible</span>
                <select
                  value={whProvider}
                  onChange={(e) => setWhProvider(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  <option value="Jira Software">Jira Software</option>
                  <option value="Salesforce CRM">Salesforce CRM</option>
                  <option value="Odoo ERP">Odoo ERP</option>
                  <option value="Slack">Slack</option>
                  <option value="Webhook Custom">Webhook Custom</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">URL HTTPS cible</span>
                <input
                  type="url"
                  required
                  value={whUrl}
                  onChange={(e) => setWhUrl(e.target.value)}
                  placeholder="https://votre-endpoint.exemple.com/webhook"
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Événements abonnés</span>
                <input
                  type="text"
                  required
                  value={whEvents}
                  onChange={(e) => setWhEvents(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWebhookModal(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={savingWh}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                >
                  {savingWh ? 'Enregistrement...' : 'Créer le webhook'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
