import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { BarChart3 } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api/client";
import { CARD } from "@/components/admin/theme";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/admin/states";

export const Route = createFileRoute("/admin/analytics")({
  component: AnalyticsPage,
});

/**
 * Charts over the knowledge base.
 *
 * Every series comes from /api/admin/analytics/knowledge, which reads existing
 * rows — nothing here is sampled, estimated or filled in.
 */
interface Analytics {
  days: number;
  byDepartment: Array<{ department: string; documents: number; chunks: number }>;
  byStatus: Array<{ status: string; count: number }>;
  overTime: Array<{ date: string; uploads: number; chunks: number; embeddings: number }>;
  retries: Array<{ date: string; retried: number; failed: number }>;
}

// Status colours match the badges, so a bar and a pill mean the same thing.
const STATUS_COLOR: Record<string, string> = {
  active: "#10b981",
  processing: "#3b82f6",
  failed: "#ef4444",
  archived: "#94a3b8",
  inactive: "#94a3b8",
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

  if (analytics.isError) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <div className={CARD}>
          <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} />
        </div>
      </div>
    );
  }

  const d = analytics.data;
  const hasDocuments = (d?.byStatus.reduce((sum, s) => sum + s.count, 0) ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Analytics
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Knowledge base growth and processing health.
          </p>
        </div>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[150px]" aria-label="Time range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </header>

      {analytics.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton count={4} />
        </div>
      ) : !hasDocuments ? (
        <div className={CARD}>
          <EmptyState
            icon={BarChart3}
            title="No data yet"
            description="Upload a document — charts appear once there is something to measure."
          />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Documents by department">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d!.byDepartment}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="documents" fill={BRAND_LINE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Documents by status">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={d!.byStatus} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="status" tick={{ fontSize: 11 }} width={72} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {d!.byStatus.map((row) => (
                    <Cell key={row.status} fill={STATUS_COLOR[row.status] ?? "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Uploads over time">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={d!.overTime}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={shortDate}
                  minTickGap={24}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="uploads"
                  stroke={BRAND_LINE}
                  fill={BRAND_LINE}
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Chunk & embedding growth">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={d!.overTime}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={shortDate}
                  minTickGap={24}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
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

          <ChartCard title="Retry history" className="lg:col-span-2">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={d!.retries}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={shortDate}
                  minTickGap={24}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="retried" fill={ACCENT_LINE} radius={[4, 4, 0, 0]} />
                <Bar dataKey="failed" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <Legend
              items={[
                ["Needed a retry", ACCENT_LINE],
                ["Failed", "#ef4444"],
              ]}
            />
          </ChartCard>
        </div>
      )}
    </div>
  );
}

function ChartCard({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CARD} p-4 ${className}`} aria-label={title}>
      <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
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
      <p className="mb-1 text-xs font-medium text-slate-800 dark:text-slate-100">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-xs tabular-nums text-slate-600 dark:text-slate-300">
          <span
            className="mr-1.5 inline-block h-2 w-2 rounded-full"
            style={{ background: entry.color }}
          />
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}
