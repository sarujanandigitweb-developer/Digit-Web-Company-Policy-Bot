import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Download,
  Lightbulb,
  RefreshCw,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api/client";
import type { SystemStatus, Health } from "@/lib/api/client";
import { CARD, TONE } from "@/components/admin/theme";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/admin/states";
import { PageHeader } from "@/components/admin/primitives";

export const Route = createFileRoute("/admin/analytics")({
  component: AnalyticsPage,
});

/**
 * Charts over the knowledge base.
 *
 * Every series comes from /api/admin/analytics/knowledge and the health strip
 * from /api/admin/system/status — both read live rows. Nothing here is sampled,
 * estimated or filled in, and the "insights" are honest derivations of the same
 * data, never invented commentary.
 */
interface Analytics {
  days: number;
  byDepartment: Array<{ department: string; documents: number; chunks: number }>;
  byStatus: Array<{ status: string; count: number }>;
  overTime: Array<{ date: string; uploads: number; chunks: number; embeddings: number }>;
  retries: Array<{ date: string; retried: number; failed: number }>;
}

// Status colours match the badges, so a slice and a pill mean the same thing.
const STATUS_COLOR: Record<string, string> = {
  active: "#10b981",
  processing: "#3b82f6",
  failed: "#ef4444",
  archived: "#94a3b8",
  inactive: "#f59e0b",
  draft: "#cbd5e1",
};

const BRAND_LINE = "#15243D";
const ACCENT_LINE = "#2b6cf3";

function AnalyticsPage() {
  const [days, setDays] = useState("30");

  const analytics = useQuery({
    queryKey: ["analytics", days],
    queryFn: () => api.get<Analytics>(`/api/admin/analytics/knowledge?days=${days}`),
  });
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => api.get<SystemStatus>("/api/admin/system/status"),
    refetchInterval: 30_000,
  });

  const d = analytics.data;
  const totalDocs = d?.byStatus.reduce((sum, s) => sum + s.count, 0) ?? 0;
  const insights = useMemo(() => (d ? deriveInsights(d) : []), [d]);

  function exportJson() {
    if (!d) return;
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${days}d.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <PageHeader
        title="Analytics"
        description="Track knowledge base growth, usage, and system health."
        actions={
          <>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="h-9 w-[150px]" aria-label="Time range">
                <CalendarDays className="mr-1.5 h-3.5 w-3.5 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={exportJson}
              disabled={!d}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => {
                void analytics.refetch();
                void status.refetch();
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${analytics.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      {analytics.isError ? (
        <div className={CARD}>
          <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} />
        </div>
      ) : analytics.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <CardSkeleton count={6} />
        </div>
      ) : totalDocs === 0 ? (
        <div className={CARD}>
          <EmptyState
            icon={BarChart3}
            title="No data yet"
            description="Upload a document — charts appear once there is something to measure."
          />
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Documents by department" viewAll="/admin/knowledge">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={d!.byDepartment}
                  margin={{ top: 8, right: 4, bottom: 0, left: -16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="department"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={48}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(43,108,243,0.06)" }} />
                  <Bar
                    dataKey="documents"
                    fill={BRAND_LINE}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={44}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Documents by status" viewAll="/admin/knowledge">
              <StatusDonut data={d!.byStatus} total={totalDocs} />
            </ChartCard>

            <ChartCard title="Uploads over time">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={d!.overTime} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="upFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT_LINE} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={ACCENT_LINE} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={shortDate}
                    minTickGap={24}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="uploads"
                    stroke={ACCENT_LINE}
                    fill="url(#upFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Chunk & embedding growth">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={d!.overTime} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={shortDate}
                    minTickGap={24}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="chunks"
                    stroke={BRAND_LINE}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="embeddings"
                    stroke={ACCENT_LINE}
                    strokeWidth={2}
                    dot={false}
                    strokeDasharray="4 3"
                  />
                </LineChart>
              </ResponsiveContainer>
              <Legend
                items={[
                  ["Chunks", BRAND_LINE],
                  ["Embeddings", ACCENT_LINE],
                ]}
              />
            </ChartCard>

            <ChartCard title="Retry history">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={d!.retries} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={shortDate}
                    minTickGap={24}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="retried" fill={ACCENT_LINE} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="failed" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
              <Legend
                items={[
                  ["Needed a retry", ACCENT_LINE],
                  ["Failed", "#ef4444"],
                ]}
              />
            </ChartCard>

            <ChartCard title="Processing failures">
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={d!.retries} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="failFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={shortDate}
                    minTickGap={24}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="failed"
                    stroke="#ef4444"
                    fill="url(#failFill)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <SystemHealthCard status={status.data} isLoading={status.isLoading} />
            <TopInsightsCard insights={insights} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- status donut ---------- */
function StatusDonut({ data, total }: { data: Analytics["byStatus"]; total: number }) {
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[180px] w-[180px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              cx="50%"
              cy="50%"
              innerRadius={58}
              outerRadius={82}
              paddingAngle={data.length > 1 ? 2 : 0}
              strokeWidth={0}
            >
              {data.map((row) => (
                <Cell key={row.status} fill={STATUS_COLOR[row.status] ?? "#94a3b8"} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        {/* Centre total — a donut without its total makes the reader do the sum. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-white">
            {total}
          </span>
          <span className="text-[11px] text-slate-400">Total</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2">
        {data.map((row) => {
          const pct = total > 0 ? Math.round((row.count / total) * 100) : 0;
          return (
            <li key={row.status} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: STATUS_COLOR[row.status] ?? "#94a3b8" }}
                />
                <span className="truncate capitalize text-slate-600 dark:text-slate-300">
                  {row.status}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">
                {row.count} <span className="text-slate-400">({pct}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- system health ---------- */
const HEALTH_TONE: Record<Health, keyof typeof TONE> = {
  healthy: "emerald",
  warning: "amber",
  offline: "red",
};

function SystemHealthCard({
  status,
  isLoading,
}: {
  status: SystemStatus | undefined;
  isLoading: boolean;
}) {
  return (
    <section className={`${CARD} p-4 lg:col-span-3`} aria-label="System health">
      <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
        System health
      </h2>
      {isLoading || !status ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-white/[0.04]"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {status.checks.map((check) => {
            const tone = TONE[HEALTH_TONE[check.status]];
            return (
              <div
                key={check.name}
                className="flex items-start gap-2.5 rounded-xl border border-slate-100 p-3 dark:border-white/[0.06]"
              >
                <span className={`mt-0.5 shrink-0 rounded-lg p-1.5 ${tone.bg}`}>
                  <CheckCircle2 className={`h-4 w-4 ${tone.fg}`} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">
                    {check.name}
                  </p>
                  <p className={`text-xs capitalize ${tone.fg}`}>{check.status}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------- top insights ---------- */
interface Insight {
  text: string;
  to?: string;
}

/** Honest derivations of the same data — never invented commentary. */
function deriveInsights(d: Analytics): Insight[] {
  const out: Insight[] = [];

  const peak = d.overTime.reduce((best, row) => (row.uploads > best.uploads ? row : best), {
    date: "",
    uploads: 0,
  });
  if (peak.uploads > 0) {
    out.push({ text: `Most documents were uploaded on ${longDate(peak.date)}.` });
  }

  const total = d.byStatus.reduce((sum, s) => sum + s.count, 0);
  const active = d.byStatus.find((s) => s.status === "active")?.count ?? 0;
  if (total > 0) {
    out.push({
      text:
        active === total
          ? "All documents are currently active."
          : `${active} of ${total} documents are active.`,
      to: "/admin/knowledge",
    });
  }

  const busiest = d.byDepartment.reduce(
    (best, row) => (row.documents > best.documents ? row : best),
    { department: "", documents: 0 },
  );
  if (busiest.documents > 0) {
    out.push({
      text: `${busiest.department} holds the most documents (${busiest.documents}).`,
      to: "/admin/departments",
    });
  }

  return out;
}

function TopInsightsCard({ insights }: { insights: Insight[] }) {
  return (
    <section className={`${CARD} p-4 lg:col-span-2`} aria-label="Top insights">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        Top insights
      </h2>
      {insights.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Not enough data yet.</p>
      ) : (
        <ul className="space-y-1">
          {insights.map((insight, i) => {
            const body = (
              <>
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2b6cf3]" />
                <span className="flex-1 text-sm text-slate-600 dark:text-slate-300">
                  {insight.text}
                </span>
                {insight.to && (
                  <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#2b6cf3]" />
                )}
              </>
            );
            const cls =
              "group flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]";
            return insight.to ? (
              <li key={i}>
                <Link to={insight.to} className={cls}>
                  {body}
                </Link>
              </li>
            ) : (
              <li key={i} className={cls}>
                {body}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ---------- shared chart chrome ---------- */
function ChartCard({
  title,
  children,
  viewAll,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  viewAll?: string;
  className?: string;
}) {
  return (
    <section className={`${CARD} p-4 ${className}`} aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
        {viewAll && (
          <Link
            to={viewAll}
            className="inline-flex items-center gap-0.5 rounded text-xs font-medium text-[#2b6cf3] transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3]"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-4">
      {items.map(([label, color]) => (
        <span
          key={label}
          className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

interface TooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  payload?: { status?: string };
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-900/95">
      {label && (
        <p className="mb-1 text-xs font-medium text-slate-800 dark:text-slate-100">{label}</p>
      )}
      {payload.map((entry, i) => (
        <p key={i} className="text-xs capitalize tabular-nums text-slate-600 dark:text-slate-300">
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          {entry.name ?? entry.payload?.status}: {entry.value}
        </p>
      ))}
    </div>
  );
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

function longDate(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00`);
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
