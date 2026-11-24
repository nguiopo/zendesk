import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  TrendingUp,
} from 'lucide-react';
import { OnCallReportEntry, OnCallShift } from '../types/helpdesk';

interface OnCallResolvedTrendChartProps {
  reports: OnCallReportEntry[];
  shifts: OnCallShift[];
}

export interface DailyResolvedTrendPoint {
  dateIso: string;
  shortLabel: string;
  fullLabel: string;
  resolvedCount: number;
  totalLoggedCount: number;
  criticalResolvedCount: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value?: number;
    name?: string;
    dataKey?: string;
    payload?: DailyResolvedTrendPoint;
  }>;
}

function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function resolveReportDateIso(
  entry: OnCallReportEntry,
  shiftDateMap: Map<string, string>,
  fallbackTodayIso: string
): string {
  const isResolved = entry.status === 'resolved' || entry.entryType === 'resolved';
  const ts = isResolved ? entry.updatedAt || entry.createdAt : entry.createdAt || entry.updatedAt;
  if (ts && typeof ts.toDate === 'function') {
    const dt = ts.toDate();
    if (!Number.isNaN(dt.getTime())) {
      return toLocalIsoDate(dt);
    }
  }
  if (entry.shiftId && shiftDateMap.has(entry.shiftId)) {
    return shiftDateMap.get(entry.shiftId) || fallbackTodayIso;
  }
  return fallbackTodayIso;
}

const CustomTrendTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2.5 shadow-lg text-xs space-y-1.5">
      <p className="font-semibold text-slate-900 dark:text-slate-100 capitalize">
        {point.fullLabel}
      </p>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Incidents résolus
          </span>
          <span className="font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
            {point.resolvedCount}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            Total consigné
          </span>
          <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
            {point.totalLoggedCount}
          </span>
        </div>
        {point.criticalResolvedCount > 0 && (
          <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-100 dark:border-slate-800">
            <span className="text-[11px] text-rose-600 dark:text-rose-400">
              Dont critiques (P1)
            </span>
            <span className="font-mono tabular-nums text-[11px] font-semibold text-rose-600 dark:text-rose-400">
              {point.criticalResolvedCount}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const OnCallResolvedTrendChart: React.FC<OnCallResolvedTrendChartProps> = ({
  reports,
  shifts,
}) => {
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');
  const [showTotalOverlay, setShowTotalOverlay] = useState<boolean>(true);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const { dailySeries, totalResolved30d, totalLogged30d, avgPerDay, peakDay } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = toLocalIsoDate(today);

    const shiftDateMap = new Map<string, string>();
    shifts.forEach((sh) => {
      if (sh.shiftDate) {
        shiftDateMap.set(sh.id, sh.shiftDate);
      }
    });

    const buckets = new Map<
      string,
      { resolvedCount: number; totalLoggedCount: number; criticalResolvedCount: number }
    >();

    const points: DailyResolvedTrendPoint[] = [];
    for (let offset = 29; offset >= 0; offset--) {
      const dt = new Date(today);
      dt.setDate(today.getDate() - offset);
      const iso = toLocalIsoDate(dt);
      buckets.set(iso, { resolvedCount: 0, totalLoggedCount: 0, criticalResolvedCount: 0 });
      points.push({
        dateIso: iso,
        shortLabel: dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
        fullLabel: dt.toLocaleDateString('fr-FR', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        resolvedCount: 0,
        totalLoggedCount: 0,
        criticalResolvedCount: 0,
      });
    }

    reports.forEach((entry) => {
      const dateIso = resolveReportDateIso(entry, shiftDateMap, todayIso);
      const bucket = buckets.get(dateIso);
      if (!bucket) return;

      bucket.totalLoggedCount += 1;
      const isResolved = entry.status === 'resolved' || entry.entryType === 'resolved';
      if (isResolved) {
        bucket.resolvedCount += 1;
        if (entry.severity === 'critical') {
          bucket.criticalResolvedCount += 1;
        }
      }
    });

    let resolvedSum = 0;
    let loggedSum = 0;
    let bestDay: { label: string; count: number } = { label: '—', count: 0 };

    const populated = points.map((pt) => {
      const counts = buckets.get(pt.dateIso)!;
      resolvedSum += counts.resolvedCount;
      loggedSum += counts.totalLoggedCount;
      if (counts.resolvedCount > bestDay.count) {
        bestDay = { label: pt.shortLabel, count: counts.resolvedCount };
      }
      return {
        ...pt,
        resolvedCount: counts.resolvedCount,
        totalLoggedCount: counts.totalLoggedCount,
        criticalResolvedCount: counts.criticalResolvedCount,
      };
    });

    return {
      dailySeries: populated,
      totalResolved30d: resolvedSum,
      totalLogged30d: loggedSum,
      avgPerDay: (resolvedSum / 30).toFixed(1),
      peakDay: bestDay,
    };
  }, [reports, shifts]);

  const resolutionRatePct =
    totalLogged30d > 0 ? Math.round((totalResolved30d / totalLogged30d) * 100) : 0;

  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              Tendance des incidents d’astreinte résolus (30 derniers jours)
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Évolution quotidienne des entrées clôturées dans le journal d’astreinte sur le dernier mois glissant.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-3 mr-1 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums font-bold">{totalResolved30d}</span>
              <span>résolus</span>
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Moy. {avgPerDay}/j · Pic {peakDay.count > 0 ? `${peakDay.count} (${peakDay.label})` : '0'} · Taux {resolutionRatePct}%
            </span>
          </div>

          {!collapsed && (
            <>
              <button
                type="button"
                onClick={() => setShowTotalOverlay((prev) => !prev)}
                className={`px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  showTotalOverlay
                    ? 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                    : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                + Total consigné
              </button>

              <div className="inline-flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setChartType('area')}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                    chartType === 'area'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <TrendingUp className="w-3 h-3" />
                  <span>Courbe</span>
                </button>
                <button
                  type="button"
                  onClick={() => setChartType('bar')}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                    chartType === 'bar'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <BarChart3 className="w-3 h-3" />
                  <span>Barres</span>
                </button>
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? 'Afficher le graphique de tendance' : 'Réduire le graphique de tendance'}
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-4 sm:p-5 space-y-3">
          {/* Mobile KPI strip */}
          <div className="flex sm:hidden flex-wrap items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-emerald-800 dark:text-emerald-300 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="font-mono tabular-nums font-bold">{totalResolved30d}</span>
              <span>résolus (30j)</span>
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              Moy. {avgPerDay}/j · Taux {resolutionRatePct}%
            </span>
          </div>

          <div className="h-52 w-full min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              {chartType === 'area' ? (
                <AreaChart data={dailySeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="onCallResolvedGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="rgba(148, 163, 184, 0.22)"
                  />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    allowDecimals={false}
                    width={36}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTrendTooltip />} />
                  {showTotalOverlay && (
                    <Line
                      type="monotone"
                      dataKey="totalLoggedCount"
                      name="Total consigné"
                      stroke="#3b82f6"
                      strokeWidth={1.75}
                      strokeDasharray="4 4"
                      dot={false}
                      activeDot={{ r: 4, fill: '#3b82f6', stroke: '#ffffff', strokeWidth: 1.5 }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="resolvedCount"
                    name="Incidents résolus"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fill="url(#onCallResolvedGradient)"
                    dot={{ r: 2, fill: '#10b981', strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: '#10b981', stroke: '#ffffff', strokeWidth: 2 }}
                  />
                </AreaChart>
              ) : (
                <BarChart data={dailySeries} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="rgba(148, 163, 184, 0.22)"
                  />
                  <XAxis
                    dataKey="shortLabel"
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    allowDecimals={false}
                    width={36}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CustomTrendTooltip />} />
                  <Bar
                    dataKey="resolvedCount"
                    name="Incidents résolus"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={20}
                  />
                  {showTotalOverlay && (
                    <Bar
                      dataKey="totalLoggedCount"
                      name="Total consigné"
                      fill="#93c5fd"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={20}
                    />
                  )}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1">
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500" />
                <span>Incidents d’astreinte résolus / jour</span>
              </span>
              {showTotalOverlay && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-0.5 bg-blue-500" />
                  <span>Total entrées d’astreinte consignées</span>
                </span>
              )}
            </div>
            <span className="font-mono tabular-nums">
              Fenêtre : {dailySeries[0]?.shortLabel} — {dailySeries[dailySeries.length - 1]?.shortLabel}
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
