import { AppLocale, AuditLogEntry } from '../types/helpdesk';

export type AuditCategory = AuditLogEntry['category'];

export const AUDIT_CATEGORIES: AuditCategory[] = [
  'rgpd',
  'rbac',
  'webhook',
  'integration',
  'qa',
  'kb',
];

export const AUDIT_CATEGORY_META: Record<
  AuditCategory,
  {
    color: string;
    labels: Record<AppLocale, string>;
  }
> = {
  rgpd: {
    color: '#2563eb',
    labels: { fr: 'RGPD', en: 'GDPR', es: 'RGPD' },
  },
  rbac: {
    color: '#7c3aed',
    labels: { fr: 'RBAC', en: 'RBAC', es: 'RBAC' },
  },
  webhook: {
    color: '#d97706',
    labels: { fr: 'Webhook', en: 'Webhook', es: 'Webhook' },
  },
  integration: {
    color: '#059669',
    labels: { fr: 'Intégration', en: 'Integration', es: 'Integración' },
  },
  qa: {
    color: '#0891b2',
    labels: { fr: 'QA', en: 'QA', es: 'QA' },
  },
  kb: {
    color: '#475569',
    labels: { fr: 'Base KB', en: 'KB', es: 'Base KB' },
  },
};

export interface AuditDailyPoint {
  dateKey: string;
  shortLabel: string;
  fullDateLabel: string;
  total: number;
  rgpd: number;
  rbac: number;
  webhook: number;
  integration: number;
  qa: number;
  kb: number;
}

export interface AuditCategorySummary {
  category: AuditCategory;
  label: string;
  count: number;
  sharePct: number;
  color: string;
}

export interface Audit30DayAnalytics {
  dailySeries: AuditDailyPoint[];
  categoryBreakdown: AuditCategorySummary[];
  totalEvents30d: number;
  filteredTotal30d: number;
  activeDaysCount: number;
  uniqueActorsCount: number;
  peakDayLabel: string | null;
  peakDayCount: number;
  topCategory: AuditCategorySummary | null;
  windowStartLabel: string;
  windowEndLabel: string;
}

const LOCALE_INTL_MAP: Record<AppLocale, string> = {
  fr: 'fr-FR',
  en: 'en-US',
  es: 'es-ES',
};

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function resolveAuditTimestampMs(
  createdAt?: AuditLogEntry['createdAt'],
  fallbackMs: number = Date.now()
): number {
  if (createdAt && typeof createdAt.toMillis === 'function') {
    return createdAt.toMillis();
  }
  if (createdAt && typeof createdAt.seconds === 'number') {
    return createdAt.seconds * 1000;
  }
  return fallbackMs;
}

export function computeAudit30DayAnalytics(
  auditLogs: AuditLogEntry[],
  locale: AppLocale = 'fr',
  categoryFilter: 'all' | AuditCategory = 'all',
  nowMs: number = Date.now()
): Audit30DayAnalytics {
  const intlLocale = LOCALE_INTL_MAP[locale] || 'fr-FR';
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);

  const windowStart = new Date(today);
  windowStart.setDate(today.getDate() - 29);
  const windowStartMs = windowStart.getTime();
  const windowEndMs = today.getTime() + 24 * 60 * 60 * 1000 - 1;

  const dayMap = new Map<string, AuditDailyPoint>();
  const dailySeries: AuditDailyPoint[] = [];

  for (let offset = 0; offset < 30; offset++) {
    const dayDate = new Date(windowStart);
    dayDate.setDate(windowStart.getDate() + offset);
    const key = toLocalDateKey(dayDate);

    const shortLabel = dayDate.toLocaleDateString(intlLocale, {
      day: '2-digit',
      month: '2-digit',
    });
    const fullDateLabel = dayDate.toLocaleDateString(intlLocale, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    const point: AuditDailyPoint = {
      dateKey: key,
      shortLabel,
      fullDateLabel,
      total: 0,
      rgpd: 0,
      rbac: 0,
      webhook: 0,
      integration: 0,
      qa: 0,
      kb: 0,
    };

    dayMap.set(key, point);
    dailySeries.push(point);
  }

  const categoryCounts: Record<AuditCategory, number> = {
    rgpd: 0,
    rbac: 0,
    webhook: 0,
    integration: 0,
    qa: 0,
    kb: 0,
  };
  const actors = new Set<string>();
  let totalEvents30d = 0;
  let filteredTotal30d = 0;

  for (const log of auditLogs) {
    const ms = resolveAuditTimestampMs(log.createdAt, nowMs);
    if (ms < windowStartMs || ms > windowEndMs) continue;

    const dateKey = toLocalDateKey(new Date(ms));
    const bucket = dayMap.get(dateKey);
    if (!bucket) continue;

    totalEvents30d += 1;
    categoryCounts[log.category] += 1;

    if (categoryFilter === 'all' || log.category === categoryFilter) {
      bucket[log.category] += 1;
      bucket.total += 1;
      filteredTotal30d += 1;
      if (log.actorName.trim()) {
        actors.add(log.actorName.trim());
      }
    }
  }

  let activeDaysCount = 0;
  let peakDayLabel: string | null = null;
  let peakDayCount = 0;

  for (const pt of dailySeries) {
    if (pt.total > 0) {
      activeDaysCount += 1;
      if (pt.total >= peakDayCount) {
        peakDayCount = pt.total;
        peakDayLabel = pt.shortLabel;
      }
    }
  }

  const categoryBreakdown: AuditCategorySummary[] = AUDIT_CATEGORIES.map((cat) => {
    const count = categoryCounts[cat];
    return {
      category: cat,
      label: AUDIT_CATEGORY_META[cat].labels[locale],
      count,
      sharePct: totalEvents30d > 0 ? Math.round((count / totalEvents30d) * 100) : 0,
      color: AUDIT_CATEGORY_META[cat].color,
    };
  }).sort((a, b) => b.count - a.count);

  const nonZeroTop = categoryBreakdown.find((c) => c.count > 0) ?? null;

  return {
    dailySeries,
    categoryBreakdown,
    totalEvents30d,
    filteredTotal30d,
    activeDaysCount,
    uniqueActorsCount: actors.size,
    peakDayLabel,
    peakDayCount,
    topCategory: nonZeroTop,
    windowStartLabel: dailySeries[0]?.shortLabel ?? '',
    windowEndLabel: dailySeries[dailySeries.length - 1]?.shortLabel ?? '',
  };
}
