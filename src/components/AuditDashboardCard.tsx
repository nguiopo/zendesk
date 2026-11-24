import React, { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppLocale, AuditLogEntry } from '../types/helpdesk';
import { I18N } from '../lib/i18n';
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_META,
  AuditCategory,
  AuditCategorySummary,
  AuditDailyPoint,
  computeAudit30DayAnalytics,
} from '../lib/auditAnalytics';

interface AuditDashboardCardProps {
  auditLogs: AuditLogEntry[];
  locale: AppLocale;
  selectedCategory: 'all' | AuditCategory;
  onSelectCategory: (category: 'all' | AuditCategory) => void;
}

export const AuditDashboardCard: React.FC<AuditDashboardCardProps> = ({
  auditLogs,
  locale,
  selectedCategory,
  onSelectCategory,
}) => {
  const dict = I18N[locale].admin;
  const [chartMode, setChartMode] = useState<'daily' | 'category'>('daily');

  const analytics = useMemo(
    () => computeAudit30DayAnalytics(auditLogs, locale, selectedCategory),
    [auditLogs, locale, selectedCategory]
  );

  const visibleCategories = useMemo(
    () =>
      selectedCategory === 'all'
        ? AUDIT_CATEGORIES
        : AUDIT_CATEGORIES.filter((c) => c === selectedCategory),
    [selectedCategory]
  );

  return (
    <section
      aria-label={dict.auditDashboardTitle}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4"
    >
      {/* Header + Mode Switcher */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {dict.auditDashboardTitle}
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {dict.auditDashboardSubtitle}{' '}
            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
              ({analytics.windowStartLabel} – {analytics.windowEndLabel})
            </span>
          </p>
        </div>

        <div
          role="group"
          aria-label={dict.auditDashboardTitle}
          className="inline-flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0"
        >
          <button
            type="button"
            onClick={() => setChartMode('daily')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              chartMode === 'daily'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {dict.auditViewByDay}
          </button>
          <button
            type="button"
            onClick={() => setChartMode('category')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              chartMode === 'category'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {dict.auditViewByCategory}
          </button>
        </div>
      </div>

      {/* 4-Column Tabular KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-3 border-y border-slate-200 dark:border-slate-800 py-3 sm:divide-x sm:divide-slate-200 dark:sm:divide-slate-800">
        <div className="sm:pr-4 space-y-0.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {dict.auditMetricTotal30d}
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {analytics.filteredTotal30d}
            </span>
            {selectedCategory !== 'all' && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                / {analytics.totalEvents30d}
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {analytics.uniqueActorsCount} {dict.auditMetricActorsSuffix}
          </div>
        </div>

        <div className="sm:px-4 space-y-0.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {dict.auditMetricActiveDays}
          </div>
          <div className="flex items-baseline gap-1 font-mono tabular-nums">
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {analytics.activeDaysCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">/ 30</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {Math.round((analytics.activeDaysCount / 30) * 100)}%
          </div>
        </div>

        <div className="sm:px-4 space-y-0.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {dict.auditMetricPeakDay}
          </div>
          <div className="flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-lg font-bold text-blue-700 dark:text-blue-400">
              {analytics.peakDayCount}
            </span>
            <span className="text-[11px] text-slate-600 dark:text-slate-300">
              {analytics.peakDayLabel ?? '—'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {selectedCategory === 'all'
              ? dict.auditAllCategories
              : AUDIT_CATEGORY_META[selectedCategory].labels[locale]}
          </div>
        </div>

        <div className="sm:pl-4 space-y-0.5">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {dict.auditMetricTopCategory}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold font-display text-slate-900 dark:text-slate-100 truncate">
              {analytics.topCategory ? analytics.topCategory.label : '—'}
            </span>
            {analytics.topCategory && (
              <span className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300">
                {analytics.topCategory.sharePct}%
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {analytics.topCategory ? `${analytics.topCategory.count} evt` : '0 evt'}
          </div>
        </div>
      </div>

      {/* Category Distribution Bar Legend / Interactive Filter */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSelectCategory('all')}
            aria-pressed={selectedCategory === 'all'}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
              selectedCategory === 'all'
                ? 'bg-slate-900 dark:bg-slate-100 border-slate-900 dark:border-slate-100 text-white dark:text-slate-900 font-semibold'
                : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>{dict.auditAllCategories}</span>
            <span className="font-mono tabular-nums opacity-80">{analytics.totalEvents30d}</span>
          </button>

          {analytics.categoryBreakdown.map((item) => {
            const active = selectedCategory === item.category;
            return (
              <button
                key={item.category}
                type="button"
                onClick={() => onSelectCategory(active ? 'all' : item.category)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[11px] font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700 text-blue-800 dark:text-blue-200 font-semibold'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-xs shrink-0"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
                <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {item.count}
                </span>
              </button>
            );
          })}
        </div>

        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          {dict.auditFilterHint}
        </span>
      </div>

      {/* Bar Chart Canvas */}
      <div className="pt-1">
        {analytics.totalEvents30d === 0 ? (
          <div className="h-52 flex flex-col items-center justify-center text-center px-4 space-y-1.5">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {dict.auditEmptyTitle}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md">
              {dict.auditEmptyHint}
            </p>
          </div>
        ) : chartMode === 'daily' ? (
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.dailySeries}
                margin={{ top: 10, right: 8, left: -18, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#94a3b8"
                  strokeOpacity={0.22}
                  vertical={false}
                />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 10, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  interval={4}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const pt = payload[0]?.payload as AuditDailyPoint | undefined;
                    if (!pt) return null;
                    const nonZeroCats = visibleCategories.filter((cat) => pt[cat] > 0);
                    return (
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 shadow-sm text-xs space-y-1.5 min-w-[175px]">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {pt.fullDateLabel}
                        </div>
                        <div className="flex items-center justify-between gap-4 text-[11px] border-b border-slate-100 dark:border-slate-800 pb-1">
                          <span className="text-slate-500 dark:text-slate-400">
                            {dict.auditTooltipTotal}
                          </span>
                          <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                            {pt.total}
                          </span>
                        </div>
                        {nonZeroCats.length === 0 ? (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500">
                            {dict.auditTooltipNoEvents}
                          </div>
                        ) : (
                          <div className="space-y-1">
                            {nonZeroCats.map((cat) => (
                              <div
                                key={cat}
                                className="flex items-center justify-between gap-4 text-[11px]"
                              >
                                <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                                  <span
                                    className="w-2 h-2 rounded-xs shrink-0"
                                    style={{ backgroundColor: AUDIT_CATEGORY_META[cat].color }}
                                  />
                                  <span>{AUDIT_CATEGORY_META[cat].labels[locale]}</span>
                                </span>
                                <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                                  {pt[cat]}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {visibleCategories.map((cat, idx) => (
                  <Bar
                    key={cat}
                    dataKey={cat}
                    stackId="audit30d"
                    fill={AUDIT_CATEGORY_META[cat].color}
                    maxBarSize={18}
                    radius={idx === visibleCategories.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                    onClick={() => onSelectCategory(selectedCategory === cat ? 'all' : cat)}
                    className="cursor-pointer"
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={analytics.categoryBreakdown}
                margin={{ top: 10, right: 12, left: -18, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#94a3b8"
                  strokeOpacity={0.22}
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.12)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const entry = payload[0]?.payload as AuditCategorySummary | undefined;
                    if (!entry) return null;
                    return (
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 shadow-sm text-xs space-y-1">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                          <span
                            className="w-2.5 h-2.5 rounded-xs shrink-0"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span>{entry.label}</span>
                        </div>
                        <div className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                          {entry.count} ({entry.sharePct}%)
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="count"
                  maxBarSize={42}
                  radius={[4, 4, 0, 0]}
                  className="cursor-pointer"
                  onClick={(barData) => {
                    const cat = (barData as unknown as { category?: AuditCategory })?.category;
                    if (cat) {
                      onSelectCategory(selectedCategory === cat ? 'all' : cat);
                    }
                  }}
                >
                  {analytics.categoryBreakdown.map((entry) => (
                    <Cell
                      key={entry.category}
                      fill={entry.color}
                      fillOpacity={
                        selectedCategory === 'all' || selectedCategory === entry.category ? 1 : 0.25
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
};
