import React, { useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  BookmarkPlus,
  Calendar,
  Eye,
  EyeOff,
  Flag,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { clampString } from '../lib/validation';
import {
  CallLog,
  ChartAnnotation,
  ChartAnnotationCategory,
  ChartAnnotationColor,
  ChartAnnotationTarget,
  ClientAccount,
  SupportAgent,
  Ticket,
} from '../types/helpdesk';

export interface AnnotationColorStyle {
  id: ChartAnnotationColor;
  label: string;
  defaultCategory: ChartAnnotationCategory;
  hex: string;
  swatchClass: string;
  textClass: string;
  softBgClass: string;
  borderClass: string;
}

export const ANNOTATION_COLORS: AnnotationColorStyle[] = [
  {
    id: 'red',
    label: 'Rouge',
    defaultCategory: 'Incident majeur',
    hex: '#dc2626',
    swatchClass: 'bg-red-600 dark:bg-red-500',
    textClass: 'text-red-700 dark:text-red-400',
    softBgClass: 'bg-red-50 dark:bg-red-950/50',
    borderClass: 'border-red-200 dark:border-red-900/70',
  },
  {
    id: 'amber',
    label: 'Ambre',
    defaultCategory: 'Pic hors zone',
    hex: '#d97706',
    swatchClass: 'bg-amber-500 dark:bg-amber-400',
    textClass: 'text-amber-700 dark:text-amber-400',
    softBgClass: 'bg-amber-50 dark:bg-amber-950/50',
    borderClass: 'border-amber-200 dark:border-amber-900/70',
  },
  {
    id: 'blue',
    label: 'Bleu',
    defaultCategory: 'Maintenance / Déploiement',
    hex: '#2563eb',
    swatchClass: 'bg-blue-600 dark:bg-blue-500',
    textClass: 'text-blue-700 dark:text-blue-400',
    softBgClass: 'bg-blue-50 dark:bg-blue-950/50',
    borderClass: 'border-blue-200 dark:border-blue-900/70',
  },
  {
    id: 'emerald',
    label: 'Émeraude',
    defaultCategory: 'Jalon SLA',
    hex: '#059669',
    swatchClass: 'bg-emerald-600 dark:bg-emerald-500',
    textClass: 'text-emerald-700 dark:text-emerald-400',
    softBgClass: 'bg-emerald-50 dark:bg-emerald-950/50',
    borderClass: 'border-emerald-200 dark:border-emerald-900/70',
  },
  {
    id: 'violet',
    label: 'Violet',
    defaultCategory: 'Événement équipe',
    hex: '#7c3aed',
    swatchClass: 'bg-violet-600 dark:bg-violet-500',
    textClass: 'text-violet-700 dark:text-violet-400',
    softBgClass: 'bg-violet-50 dark:bg-violet-950/50',
    borderClass: 'border-violet-200 dark:border-violet-900/70',
  },
];

export const ANNOTATION_COLOR_MAP: Record<ChartAnnotationColor, AnnotationColorStyle> =
  ANNOTATION_COLORS.reduce(
    (acc, item) => {
      acc[item.id] = item;
      return acc;
    },
    {} as Record<ChartAnnotationColor, AnnotationColorStyle>
  );

export const CHART_TARGET_LABELS: Record<ChartAnnotationTarget, string> = {
  operations_timeline: 'Chronologie SLA & Incidents (7 j)',
  capacity_bars: 'Comparatif dynamique par agent',
  client_health_donut: 'Répartition des états clients',
};

export const ANNOTATION_CATEGORIES: ChartAnnotationCategory[] = [
  'Incident majeur',
  'Pic hors zone',
  'Maintenance / Déploiement',
  'Jalon SLA',
  'Événement équipe',
];

export interface AnnotationDraft {
  editingId?: string;
  title: string;
  notes: string;
  color: ChartAnnotationColor;
  categoryLabel: ChartAnnotationCategory;
  targetChart: ChartAnnotationTarget;
  anchorLabel: string;
  positionPct: number;
  eventDate: string;
}

export function getTodayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
}

export function getOffsetIsoDate(offsetDays: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + offsetDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
    dt.getDate()
  ).padStart(2, '0')}`;
}

export const TIMELINE_DAY_SLOTS = [
  { label: 'J-6', offset: -6, positionPct: 8 },
  { label: 'J-5', offset: -5, positionPct: 22 },
  { label: 'J-4', offset: -4, positionPct: 37 },
  { label: 'J-3', offset: -3, positionPct: 52 },
  { label: 'J-2', offset: -2, positionPct: 67 },
  { label: 'J-1', offset: -1, positionPct: 82 },
  { label: "Aujourd'hui", offset: 0, positionPct: 95 },
];

export const CLIENT_HEALTH_ANCHORS = [
  'Nominal vérifié',
  'Hors zone signal',
  'Mot de passe bloqué',
  'Dégradé / Vigilance',
];

interface OperationsTimelineChartProps {
  tickets: Ticket[];
  callLogs: CallLog[];
  clients: ClientAccount[];
  annotations: ChartAnnotation[];
  showAnnotations: boolean;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onQuickAnnotate: (draft: Partial<AnnotationDraft>) => void;
}

export const OperationsTimelineChart: React.FC<OperationsTimelineChartProps> = ({
  tickets,
  callLogs,
  clients,
  annotations,
  showAnnotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onQuickAnnotate,
}) => {
  const series = useMemo(() => {
    const baseTickets = Math.max(4, tickets.length);
    const outOfZoneCalls = callLogs.filter((c) => c.outcome === 'out_of_zone').length;
    const recurringCount = tickets.filter((t) => t.isRecurringIncident).length;
    const escalatedCount = tickets.filter((t) => t.status === 'escalated').length;
    const lockedCount = clients.filter((c) => c.passwordLocked).length;

    const weights = [0.68, 0.75, 0.72, 0.84, 1.18, 0.94, 1.0];
    const incidentWeights = [0.4, 0.5, 0.45, 0.6, 1.35, 0.85, 0.75];

    return TIMELINE_DAY_SLOTS.map((slot, idx) => {
      const volume = Math.max(
        2,
        Math.round(baseTickets * weights[idx] + (idx === 4 ? outOfZoneCalls : 0))
      );
      const incidents = Math.max(
        1,
        Math.round(
          (recurringCount + escalatedCount + lockedCount) * incidentWeights[idx] * 0.65
        )
      );
      return {
        ...slot,
        dateIso: getOffsetIsoDate(slot.offset),
        volume,
        incidents,
      };
    });
  }, [tickets, callLogs, clients]);

  const maxY = useMemo(() => {
    return Math.max(10, ...series.map((s) => Math.max(s.volume, s.incidents + 2)));
  }, [series]);

  const timelineAnnotations = useMemo(
    () => annotations.filter((a) => a.targetChart === 'operations_timeline'),
    [annotations]
  );

  const selectedAnn = useMemo(
    () => timelineAnnotations.find((a) => a.id === selectedAnnotationId) || null,
    [timelineAnnotations, selectedAnnotationId]
  );

  // SVG dimensions
  const width = 720;
  const height = 220;
  const padLeft = 42;
  const padRight = 24;
  const padTop = 34;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const toX = (pct: number) => padLeft + (Math.max(0, Math.min(100, pct)) / 100) * plotW;
  const toY = (val: number) => padTop + plotH - (Math.min(maxY, val) / maxY) * plotH;

  const volumePoints = series.map((d) => `${toX(d.positionPct)},${toY(d.volume)}`).join(' ');
  const incidentPoints = series.map((d) => `${toX(d.positionPct)},${toY(d.incidents)}`).join(' ');

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Chronologie SLA, Incidents majeurs &amp; Alertes (7 derniers jours)
            </h3>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              · {timelineAnnotations.length} annotation(s)
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cliquez sur un point de la courbe pour poser un marqueur coloré d’incident majeur ou d’événement.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-blue-600 dark:bg-blue-400" aria-hidden="true" />
              <span>Volume sollicitations</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-500" aria-hidden="true" />
              <span>Incidents &amp; hors-zone</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() =>
              onQuickAnnotate({
                targetChart: 'operations_timeline',
                anchorLabel: "Aujourd'hui",
                positionPct: 95,
                eventDate: getTodayIsoDate(),
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-slate-200 text-white dark:text-slate-900 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>Annoter la courbe</span>
          </button>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full min-w-[540px] h-56 select-none"
          role="img"
          aria-label="Graphique chronologique des incidents et sollicitations sur 7 jours avec annotations colorées"
        >
          {/* Horizontal grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padTop + plotH * (1 - ratio);
            const val = Math.round(maxY * ratio);
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="currentColor"
                  strokeDasharray="3 4"
                  className="text-slate-200 dark:text-slate-800"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* Incident bars */}
          {series.map((d) => {
            const x = toX(d.positionPct);
            const y = toY(d.incidents);
            const barH = padTop + plotH - y;
            return (
              <rect
                key={`bar-${d.label}`}
                x={x - 10}
                y={y}
                width={20}
                height={Math.max(2, barH)}
                rx={3}
                className="fill-amber-500/25 dark:fill-amber-400/25 stroke-amber-500/60"
                strokeWidth={1}
              />
            );
          })}

          {/* Volume line */}
          <polyline
            fill="none"
            stroke="#2563eb"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            points={volumePoints}
          />

          {/* Incident line */}
          <polyline
            fill="none"
            stroke="#d97706"
            strokeWidth={1.75}
            strokeDasharray="4 3"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={incidentPoints}
          />

          {/* Interactive day nodes */}
          {series.map((d) => {
            const cx = toX(d.positionPct);
            const cy = toY(d.volume);
            return (
              <g
                key={d.label}
                className="cursor-pointer group"
                onClick={() =>
                  onQuickAnnotate({
                    targetChart: 'operations_timeline',
                    anchorLabel: d.label,
                    positionPct: d.positionPct,
                    eventDate: d.dateIso,
                  })
                }
              >
                <rect
                  x={cx - 28}
                  y={padTop}
                  width={56}
                  height={plotH}
                  fill="transparent"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={4.5}
                  className="fill-white dark:fill-slate-900 stroke-blue-600 dark:stroke-blue-400 transition-transform"
                  strokeWidth={2.25}
                />
                <text
                  x={cx}
                  y={height - 10}
                  textAnchor="middle"
                  className="fill-slate-500 dark:fill-slate-400 text-[10px] font-mono group-hover:fill-blue-600 dark:group-hover:fill-blue-400"
                >
                  {d.label}
                </text>
              </g>
            );
          })}

          {/* Colored Annotation Vertical Markers & Flags */}
          {showAnnotations &&
            timelineAnnotations.map((ann, idx) => {
              const colorMeta = ANNOTATION_COLOR_MAP[ann.color] || ANNOTATION_COLOR_MAP.red;
              const x = toX(ann.positionPct);
              const isSelected = ann.id === selectedAnnotationId;
              const staggerY = 8 + (idx % 2) * 14;
              return (
                <g
                  key={ann.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAnnotation(isSelected ? null : ann.id);
                  }}
                >
                  <line
                    x1={x}
                    y1={staggerY + 10}
                    x2={x}
                    y2={padTop + plotH}
                    stroke={colorMeta.hex}
                    strokeWidth={isSelected ? 2.5 : 1.75}
                    strokeDasharray="5 3"
                  />
                  <rect
                    x={x - 42}
                    y={staggerY - 4}
                    width={84}
                    height={16}
                    rx={4}
                    fill={colorMeta.hex}
                    opacity={isSelected ? 1 : 0.92}
                  />
                  <text
                    x={x}
                    y={staggerY + 7}
                    textAnchor="middle"
                    className="fill-white text-[9px] font-semibold"
                  >
                    {ann.title.length > 13 ? `${ann.title.slice(0, 12)}…` : ann.title}
                  </text>
                  <circle
                    cx={x}
                    cy={padTop + plotH}
                    r={4}
                    fill={colorMeta.hex}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                </g>
              );
            })}
        </svg>
      </div>

      {/* Selected or Quick Marker Summary Strip */}
      {showAnnotations && timelineAnnotations.length > 0 && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          {selectedAnn ? (
            <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-200">
              <span
                className={`w-2.5 h-2.5 rounded-xs shrink-0 ${
                  ANNOTATION_COLOR_MAP[selectedAnn.color].swatchClass
                }`}
                aria-hidden="true"
              />
              <span className={`font-semibold ${ANNOTATION_COLOR_MAP[selectedAnn.color].textClass}`}>
                {selectedAnn.categoryLabel}
              </span>
              <span className="text-slate-300 dark:text-slate-600">·</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {selectedAnn.title}
              </span>
              <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                ({selectedAnn.anchorLabel} · {selectedAnn.eventDate})
              </span>
              {selectedAnn.notes && (
                <span className="text-slate-600 dark:text-slate-400">— {selectedAnn.notes}</span>
              )}
            </div>
          ) : (
            <span className="text-slate-500 dark:text-slate-400">
              Cliquez sur un marqueur coloré dans le graphique pour inspecter le détail de l’incident ou de l’événement.
            </span>
          )}
        </div>
      )}
    </div>
  );
};

interface ChartAnnotationsSectionProps {
  uid: string;
  currentUserName: string;
  annotations: ChartAnnotation[];
  agents: SupportAgent[];
  showAnnotations: boolean;
  onToggleShowAnnotations: () => void;
  colorFilter: ChartAnnotationColor | 'all';
  onChangeColorFilter: (color: ChartAnnotationColor | 'all') => void;
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  modalOpen: boolean;
  draft: AnnotationDraft;
  onOpenCreate: (prefill?: Partial<AnnotationDraft>) => void;
  onOpenEdit: (ann: ChartAnnotation) => void;
  onCloseModal: () => void;
  onChangeDraft: React.Dispatch<React.SetStateAction<AnnotationDraft>>;
}

export const ChartAnnotationsPanel: React.FC<ChartAnnotationsSectionProps> = ({
  uid,
  currentUserName,
  annotations,
  agents,
  showAnnotations,
  onToggleShowAnnotations,
  colorFilter,
  onChangeColorFilter,
  selectedAnnotationId,
  onSelectAnnotation,
  modalOpen,
  draft,
  onOpenCreate,
  onOpenEdit,
  onCloseModal,
  onChangeDraft,
}) => {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filteredAnnotations = useMemo(() => {
    const base =
      colorFilter === 'all'
        ? annotations
        : annotations.filter((a) => a.color === colorFilter);
    return [...base].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  }, [annotations, colorFilter]);

  const anchorOptions = useMemo(() => {
    if (draft.targetChart === 'operations_timeline') {
      return TIMELINE_DAY_SLOTS.map((s) => ({
        label: `${s.label} (${getOffsetIsoDate(s.offset)})`,
        value: s.label,
        pct: s.positionPct,
      }));
    }
    if (draft.targetChart === 'capacity_bars') {
      return agents.map((a, idx) => ({
        label: a.name,
        value: a.name,
        pct: Math.min(95, 35 + idx * 15),
      }));
    }
    return CLIENT_HEALTH_ANCHORS.map((seg, idx) => ({
      label: seg,
      value: seg,
      pct: 25 + idx * 20,
    }));
  }, [draft.targetChart, agents]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = clampString(draft.title, 120);
    if (!cleanTitle) {
      setFormError('Veuillez saisir un titre pour l’annotation.');
      return;
    }
    const cleanNotes = clampString(draft.notes, 400);
    const cleanAnchor = clampString(draft.anchorLabel, 120) || 'Repère général';
    const clampedPct = Math.max(0, Math.min(100, Math.round(Number(draft.positionPct) || 50)));
    const validDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(draft.eventDate)
      ? draft.eventDate
      : getTodayIsoDate();

    setSaving(true);
    setFormError(null);
    try {
      if (draft.editingId) {
        await updateDoc(doc(db, 'chartAnnotations', draft.editingId), {
          title: cleanTitle,
          notes: cleanNotes,
          color: draft.color,
          categoryLabel: draft.categoryLabel,
          targetChart: draft.targetChart,
          anchorLabel: cleanAnchor,
          positionPct: clampedPct,
          eventDate: validDate,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'chartAnnotations'), {
          title: cleanTitle,
          notes: cleanNotes,
          color: draft.color,
          categoryLabel: draft.categoryLabel,
          targetChart: draft.targetChart,
          anchorLabel: cleanAnchor,
          positionPct: clampedPct,
          eventDate: validDate,
          authorName: clampString(currentUserName, 120) || 'Agent Support',
          ownerId: uid,
          memberIds: [uid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      onCloseModal();
    } catch (err) {
      handleFirestoreError(
        err,
        draft.editingId ? OperationType.UPDATE : OperationType.CREATE,
        'chartAnnotations'
      );
      setFormError('Impossible d’enregistrer l’annotation dans Firestore.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'chartAnnotations', id));
      if (selectedAnnotationId === id) onSelectAnnotation(null);
      setConfirmDeleteId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chartAnnotations/${id}`);
    }
  };

  return (
    <>
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Flag className="w-4 h-4 text-slate-700 dark:text-slate-300" />
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                Annotations colorées &amp; Incidents majeurs sur les graphiques
              </h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Marquez les pannes infrastructure, pics hors-zone, déploiements et jalons SLA directement sur les courbes et barres.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleShowAnnotations}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {showAnnotations ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" />
                  <span>Masquer marqueurs</span>
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" />
                  <span>Afficher marqueurs</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => onOpenCreate()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Nouvelle annotation</span>
            </button>
          </div>
        </div>

        {/* Color Filter Strip */}
        <div className="px-4 py-2.5 bg-slate-50/70 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChangeColorFilter('all')}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              colorFilter === 'all'
                ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800'
            }`}
          >
            <span>Toutes</span>
            <span className="font-mono tabular-nums text-[11px] opacity-80">
              ({annotations.length})
            </span>
          </button>

          {ANNOTATION_COLORS.map((c) => {
            const count = annotations.filter((a) => a.color === c.id).length;
            const active = colorFilter === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChangeColorFilter(c.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 font-semibold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-800'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-xs shrink-0 ${c.swatchClass}`} aria-hidden="true" />
                <span>{c.label}</span>
                <span className="font-mono tabular-nums text-[11px] opacity-75">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Annotations List */}
        {filteredAnnotations.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Aucune annotation graphique pour ce filtre.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cliquez directement sur un graphique ou sur « Nouvelle annotation » pour consigner un incident majeur ou un événement.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredAnnotations.map((ann) => {
              const colorMeta = ANNOTATION_COLOR_MAP[ann.color] || ANNOTATION_COLOR_MAP.red;
              const isSelected = ann.id === selectedAnnotationId;
              return (
                <div
                  key={ann.id}
                  onClick={() => onSelectAnnotation(isSelected ? null : ann.id)}
                  className={`p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50/50 dark:bg-blue-950/20'
                      : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`w-2.5 h-2.5 rounded-xs shrink-0 ${colorMeta.swatchClass}`}
                        aria-hidden="true"
                      />
                      <span className={`font-semibold ${colorMeta.textClass}`}>
                        {ann.categoryLabel}
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {ann.title}
                      </span>
                    </div>

                    {ann.notes && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pl-4.5">
                        {ann.notes}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 pl-4.5">
                      <span>{CHART_TARGET_LABELS[ann.targetChart]}</span>
                      <span>·</span>
                      <span>Repère : {ann.anchorLabel}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums">{ann.eventDate}</span>
                      <span>·</span>
                      <span>Par {ann.authorName}</span>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1.5 shrink-0 pl-4.5 sm:pl-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenEdit(ann)}
                      title="Modifier cette annotation"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>Éditer</span>
                    </button>

                    {confirmDeleteId === ann.id ? (
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDelete(ann.id)}
                          className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Confirmer
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(ann.id)}
                        title="Supprimer cette annotation"
                        className="p-1.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/50 text-slate-500 hover:text-red-600 dark:hover:text-red-400 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Composer / Editor */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chart-annotation-modal-title"
        >
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-xs shrink-0 ${
                    ANNOTATION_COLOR_MAP[draft.color].swatchClass
                  }`}
                  aria-hidden="true"
                />
                <h4
                  id="chart-annotation-modal-title"
                  className="font-display text-sm font-bold text-slate-900 dark:text-slate-100"
                >
                  {draft.editingId
                    ? 'Modifier l’annotation graphique'
                    : 'Ajouter une annotation colorée sur graphique'}
                </h4>
              </div>
              <button
                type="button"
                onClick={onCloseModal}
                aria-label="Fermer la fenêtre"
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
                  {formError}
                </div>
              )}

              {/* Color Selection */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Couleur &amp; nature du marqueur
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {ANNOTATION_COLORS.map((c) => {
                    const selected = draft.color === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() =>
                          onChangeDraft((prev) => ({
                            ...prev,
                            color: c.id,
                            categoryLabel: c.defaultCategory,
                          }))
                        }
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                          selected
                            ? `${c.softBgClass} ${c.borderClass} ${c.textClass} font-semibold`
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className={`w-2.5 h-2.5 rounded-xs shrink-0 ${c.swatchClass}`} />
                        <span className="truncate">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Target Chart + Category */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Graphique cible
                  </label>
                  <select
                    value={draft.targetChart}
                    onChange={(e) => {
                      const nextChart = e.target.value as ChartAnnotationTarget;
                      const defaultAnchor =
                        nextChart === 'operations_timeline'
                          ? "Aujourd'hui"
                          : nextChart === 'capacity_bars'
                          ? agents[0]?.name || 'Équipe Support'
                          : CLIENT_HEALTH_ANCHORS[1];
                      onChangeDraft((prev) => ({
                        ...prev,
                        targetChart: nextChart,
                        anchorLabel: defaultAnchor,
                        positionPct: nextChart === 'operations_timeline' ? 95 : 65,
                      }));
                    }}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {(Object.keys(CHART_TARGET_LABELS) as ChartAnnotationTarget[]).map((k) => (
                      <option key={k} value={k}>
                        {CHART_TARGET_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Catégorie d’événement
                  </label>
                  <select
                    value={draft.categoryLabel}
                    onChange={(e) =>
                      onChangeDraft((prev) => ({
                        ...prev,
                        categoryLabel: e.target.value as ChartAnnotationCategory,
                      }))
                    }
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {ANNOTATION_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Anchor + Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Point d’ancrage sur le graphique
                  </label>
                  <select
                    value={draft.anchorLabel}
                    onChange={(e) => {
                      const val = e.target.value;
                      const match = anchorOptions.find((o) => o.value === val);
                      onChangeDraft((prev) => ({
                        ...prev,
                        anchorLabel: val,
                        positionPct: match ? match.pct : prev.positionPct,
                      }));
                    }}
                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    {anchorOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Date de l’événement</span>
                  </label>
                  <input
                    type="date"
                    value={draft.eventDate}
                    onChange={(e) =>
                      onChangeDraft((prev) => ({ ...prev, eventDate: e.target.value }))
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Position Slider (for timeline & capacity_bars) */}
              {draft.targetChart !== 'client_health_donut' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Position du repère sur l’axe horizontal
                    </label>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {draft.positionPct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={98}
                    value={draft.positionPct}
                    onChange={(e) =>
                      onChangeDraft((prev) => ({
                        ...prev,
                        positionPct: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-blue-600 cursor-pointer"
                  />
                </div>
              )}

              {/* Title */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Libellé du marqueur (affiché sur le graphique)
                </label>
                <input
                  type="text"
                  maxLength={120}
                  required
                  placeholder="Ex : Coupure relais fibre Nord-Est / Pic appels hors zone"
                  value={draft.title}
                  onChange={(e) =>
                    onChangeDraft((prev) => ({ ...prev, title: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Détails opérationnels &amp; impact SLA (optionnel)
                </label>
                <textarea
                  rows={3}
                  maxLength={400}
                  placeholder="Précisez les comptes impactés, l’action de contournement ou la cause racine..."
                  value={draft.notes}
                  onChange={(e) =>
                    onChangeDraft((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={onCloseModal}
                  className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {saving
                    ? 'Enregistrement...'
                    : draft.editingId
                    ? 'Mettre à jour'
                    : 'Placer l’annotation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
