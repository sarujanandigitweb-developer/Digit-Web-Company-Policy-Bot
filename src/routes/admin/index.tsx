import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Activity,
  Building2,
  CalendarDays,
  FileText,
  HelpCircle,
  Layers,
  MessagesSquare,
  RefreshCw,
  Sparkles,
  Users as UsersIcon,
  XCircle,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  ActivityItem,
  AdminUser,
  Department,
  KnowledgeStats,
  Paged,
  SystemStatus,
} from "@/lib/api/client";
import { api, qs } from "@/lib/api/client";
import { BRAND, CARD, FOCUS_RING, TONE } from "@/components/admin/theme";
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { ConfidencePill } from "@/components/admin/confidence-pill";
import { Kpi, PageHeader } from "@/components/admin/primitives";
import type { ConversationRow } from "./conversations.index";

export const Route = createFileRoute("/admin/")({
  component: DashboardPage,
});

interface GapRow {
  id: string;
  question: string;
  department_name: string | null;
  occurrence_count: number;
  confidence_score: number;
  status: string;
}

interface Analytics {
  byDepartment: Array<{ department: string; documents: number }>;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Open",
  reviewed: "Reviewing",
  resolved: "Resolved",
  ignored: "Ignored",
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function DashboardPage() {
  // The range genuinely filters: /api/admin/conversations accepts from/to, so
  // "This period" means what it says rather than decorating a fixed number.
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const stats = useQuery({
    queryKey: ["knowledge-stats"],
    queryFn: () => api.get<KnowledgeStats>("/api/admin/knowledge/stats"),
  });
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => api.get<SystemStatus>("/api/admin/system/status"),
    refetchInterval: 30_000,
  });
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: () => api.get<{ items: ActivityItem[] }>("/api/admin/activity?limit=6"),
  });
  const conversations = useQuery({
    queryKey: ["dash-conversations", from, to],
    queryFn: () =>
      api.get<Paged<ConversationRow>>(`/api/admin/conversations${qs({ pageSize: 5, from, to })}`),
  });
  const gaps = useQuery({
    queryKey: ["dash-gaps"],
    queryFn: () =>
      api.get<Paged<GapRow> & { stats: { pending: number } }>("/api/admin/gaps?pageSize=3"),
  });
  const departments = useQuery({
    queryKey: ["dash-departments"],
    queryFn: () => api.get<Paged<Department>>("/api/admin/departments?pageSize=1"),
  });
  const users = useQuery({
    queryKey: ["dash-users"],
    queryFn: () => api.get<Paged<AdminUser>>("/api/admin/users?pageSize=1&status=active"),
  });
  const analytics = useQuery({
    queryKey: ["dash-analytics"],
    queryFn: () => api.get<Analytics>("/api/admin/analytics/knowledge?days=30"),
  });

  const s = stats.data;
  const openGaps = gaps.data?.stats.pending ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
      <PageHeader
        title="Dashboard"
        description="Overview of your knowledge base and system health."
        actions={
          <>
            <DateRange from={from} to={to} setFrom={setFrom} setTo={setTo} />
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-2"
              onClick={() => {
                void stats.refetch();
                void status.refetch();
                void activity.refetch();
                void conversations.refetch();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </>
        }
      />

      {/* KPIs. No trend arrows: nothing stores a prior snapshot to compare
          against, and an invented "+1 today" is worse than none. */}
      <section
        aria-label="Key figures"
        className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
      >
        {stats.isLoading ? (
          <CardSkeleton count={6} />
        ) : stats.isError ? (
          <div className={`col-span-full ${CARD}`}>
            <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
          </div>
        ) : (
          <>
            <Kpi
              label="Documents"
              value={s!.total_documents}
              icon={FileText}
              tone="blue"
              to="/admin/knowledge"
            />
            <Kpi
              label="Active"
              value={s!.active}
              icon={Layers}
              tone="emerald"
              to="/admin/knowledge"
            />
            <Kpi
              label="Processing"
              value={s!.processing}
              icon={RefreshCw}
              tone="blue"
              to="/admin/knowledge"
              linkLabel="View queue"
            />
            <Kpi
              label="Failed"
              value={s!.failed}
              icon={XCircle}
              tone="red"
              to="/admin/knowledge"
              linkLabel="View failed"
            />
            <Kpi
              label="Chunks"
              value={s!.chunk_count}
              icon={Layers}
              tone="violet"
              to="/admin/analytics"
              linkLabel="View chunks"
            />
            <Kpi
              label="Embeddings"
              value={s!.embedding_count}
              icon={Sparkles}
              tone="violet"
              to="/admin/analytics"
              linkLabel="View embeddings"
            />
          </>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="System status">
          {status.isLoading ? (
            <TableSkeleton rows={4} cols={1} />
          ) : status.isError ? (
            <ErrorState error={status.error} onRetry={() => status.refetch()} />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {status.data!.checks.map((check) => (
                <li key={check.name} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {check.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">{check.detail}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {check.latency_ms !== null && (
                      <span className="text-[11px] tabular-nums text-slate-400">
                        {check.latency_ms} ms
                      </span>
                    )}
                    <StatusBadge value={check.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity">
          {activity.isLoading ? (
            <TableSkeleton rows={6} cols={2} />
          ) : activity.isError ? (
            <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
          ) : activity.data!.items.length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
              {activity.data!.items.map((item) => (
                <li key={item.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <ActionDot action={item.action} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-800 dark:text-slate-100">
                      {describe(item)}
                    </p>
                    <p className="text-xs text-slate-400">{item.actor_name ?? "Someone"}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">
                    {relativeTime(item.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="At a glance">
          <div className="grid grid-cols-2 gap-3 p-4">
            <MiniStat
              icon={Building2}
              value={departments.data?.total ?? 0}
              label="Departments"
              note="Active"
              tone="emerald"
            />
            <MiniStat
              icon={UsersIcon}
              value={users.data?.total ?? 0}
              label="Users"
              note="Active"
              tone="blue"
            />
            <MiniStat
              icon={MessagesSquare}
              value={conversations.data?.total ?? 0}
              label="Conversations"
              note="This period"
              tone="violet"
            />
            <MiniStat
              icon={HelpCircle}
              value={openGaps}
              label="Open gaps"
              note={openGaps > 0 ? "Needs attention" : "All clear"}
              tone={openGaps > 0 ? "red" : "emerald"}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Documents by department" href="/admin/analytics" hrefLabel="View analytics">
          <div className="p-4 pt-2">
            {analytics.isLoading ? (
              <TableSkeleton rows={4} cols={1} />
            ) : (
              (() => {
                // Horizontal bars: with many long department names, a vertical
                // chart crushes the x-axis into an unreadable strip. Here each
                // department gets its own row. Sorted so the fullest read first,
                // and the area scrolls when there are more departments than fit.
                const data = [...(analytics.data?.byDepartment ?? [])].sort(
                  (a, b) => b.documents - a.documents,
                );
                const chartHeight = Math.max(210, data.length * 26);
                return (
                  <div className="max-h-[260px] overflow-y-auto pr-1">
                    <ResponsiveContainer width="100%" height={chartHeight}>
                      <BarChart
                        data={data}
                        layout="vertical"
                        margin={{ top: 0, right: 12, bottom: 0, left: 4 }}
                        barCategoryGap="20%"
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
                        <YAxis
                          type="category"
                          dataKey="department"
                          tick={{ fontSize: 11 }}
                          width={130}
                          tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
                        />
                        <Tooltip
                          content={<ChartTip />}
                          cursor={{ fill: "rgba(43,108,243,0.06)" }}
                        />
                        <Bar
                          dataKey="documents"
                          fill={BRAND}
                          radius={[0, 4, 4, 0]}
                          maxBarSize={18}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()
            )}
          </div>
        </Panel>

        <Panel title="Top knowledge gaps" href="/admin/knowledge-gaps" hrefLabel="View all">
          {gaps.isLoading ? (
            <TableSkeleton rows={3} cols={3} />
          ) : (gaps.data?.items.length ?? 0) === 0 ? (
            <EmptyState icon={Sparkles} title="No knowledge gaps" />
          ) : (
            <MiniTable
              head={["Question", "Asked", "Confidence", "Status"]}
              rows={gaps.data!.items.map((g) => [
                <span key="q" className="block max-w-[200px] truncate">
                  {g.question}
                </span>,
                <span key="n" className="tabular-nums">
                  {g.occurrence_count}×
                </span>,
                <ConfidencePill key="c" value={g.confidence_score} />,
                <span
                  key="s"
                  className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                >
                  {STATUS_LABEL[g.status] ?? g.status}
                </span>,
              ])}
            />
          )}
        </Panel>

        <Panel title="Recent conversations" href="/admin/conversations" hrefLabel="View all">
          {conversations.isLoading ? (
            <TableSkeleton rows={5} cols={3} />
          ) : (conversations.data?.items.length ?? 0) === 0 ? (
            <EmptyState icon={MessagesSquare} title="No conversations in this period" />
          ) : (
            <MiniTable
              head={["Session", "Messages", "Confidence", "Last activity"]}
              rows={conversations.data!.items.map((c) => [
                <Link
                  key="t"
                  to="/admin/conversations/$id"
                  params={{ id: c.id }}
                  className={`block max-w-[180px] truncate rounded underline-offset-2 hover:underline ${FOCUS_RING}`}
                >
                  {c.title || "Untitled"}
                </Link>,
                <span key="m" className="tabular-nums">
                  {c.message_count}
                </span>,
                <ConfidencePill key="c" value={c.avg_confidence} />,
                <span key="a" className="whitespace-nowrap text-xs text-slate-400">
                  {c.last_message_at ? relativeTime(c.last_message_at) : "—"}
                </span>,
              ])}
            />
          )}
        </Panel>
      </div>

      <footer className="flex items-center justify-center gap-3 pb-2 text-xs text-slate-400">
        <span>Ask the Digit Admin Console</span>
        <span className="text-slate-300">•</span>
        {/* Reports the live health check rather than a hardcoded badge. */}
        <span className="inline-flex items-center gap-1.5">
          {status.data?.overall === "healthy"
            ? "Operational"
            : status.isLoading
              ? "Checking…"
              : "Degraded"}
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status.data?.overall === "healthy" ? "bg-emerald-500" : "bg-amber-500"
            }`}
          />
        </span>
      </footer>
    </div>
  );
}

/** A titled card with an optional "View all". One shape for every panel. */
function Panel({
  title,
  href,
  hrefLabel,
  children,
}: {
  title: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className={`${CARD} flex flex-col overflow-hidden`}>
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {href && (
          <Link
            to={href}
            className={`shrink-0 rounded text-xs font-medium text-[#2b6cf3] hover:underline ${FOCUS_RING}`}
          >
            {hrefLabel ?? "View all"}
          </Link>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function MiniStat({
  icon: Icon,
  value,
  label,
  note,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label: string;
  note: string;
  tone: keyof typeof TONE;
}) {
  const t = TONE[tone];
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200/70 p-3 dark:border-white/[0.06]">
      <span className={`shrink-0 rounded-lg p-2 ${t.bg}`}>
        <Icon className={`h-4 w-4 ${t.fg}`} />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-none tabular-nums text-slate-900 dark:text-white">
          {value.toLocaleString()}
        </p>
        <p className="mt-1 truncate text-xs font-medium text-slate-600 dark:text-slate-300">
          {label}
        </p>
        <p className={`truncate text-[11px] ${t.fg}`}>{note}</p>
      </div>
    </div>
  );
}

/** A compact read-only table for dashboard panels. */
function MiniTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-slate-100 px-4 py-2 text-left text-[11px] font-medium text-slate-400 dark:border-white/[0.06]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, i) => (
            <tr
              key={i}
              className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60 dark:border-white/[0.03] dark:hover:bg-white/[0.03]"
            >
              {cells.map((cell, j) => (
                <td key={j} className="px-4 py-2.5 text-slate-700 dark:text-slate-200">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DateRange({
  from,
  to,
  setFrom,
  setTo,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
}) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2 font-normal">
          <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
          <span className="tabular-nums">
            {fmt(from)} – {fmt(to)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        {/* Says what it affects: it filters conversations, not the whole page. */}
        <p className="text-xs text-slate-500">Filters conversations shown on this page.</p>
        <div className="space-y-1.5">
          <Label htmlFor="dash-from" className="text-xs">
            From
          </Label>
          <Input
            id="dash-from"
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dash-to" className="text-xs">
            To
          </Label>
          <Input
            id="dash-to"
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-lg dark:border-white/10 dark:bg-slate-900/95">
      <p className="text-xs font-medium text-slate-800 dark:text-slate-100">{label}</p>
      <p className="text-xs tabular-nums text-slate-500">{payload[0].value} documents</p>
    </div>
  );
}

function ActionDot({ action }: { action: string }) {
  const color = action.includes("deleted")
    ? "bg-red-500"
    : action.includes("uploaded") || action.includes("created")
      ? "bg-emerald-500"
      : action.includes("replaced") || action.includes("role")
        ? "bg-blue-500"
        : "bg-slate-400";
  return (
    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />
  );
}

/** Turns 'knowledge.uploaded' + subject into something a person reads. */
function describe(item: ActivityItem): string {
  const verbs: Record<string, string> = {
    "knowledge.uploaded": "Uploaded",
    "knowledge.replaced": "Replaced",
    "knowledge.activated": "Activated",
    "knowledge.archived": "Archived",
    "knowledge.deactivated": "Deactivated",
    "knowledge.deleted": "Deleted",
    "user.created": "Created user",
    "user.updated": "Updated user",
    "user.role_changed": "Changed role for",
    "user.suspended": "Suspended",
    "user.activated": "Activated user",
    "user.deleted": "Deleted user",
    "department.created": "Created department",
    "department.updated": "Updated department",
    "department.deleted": "Deleted department",
    "gap.reviewed": "Reviewed gap",
    "gap.resolved": "Resolved gap",
  };
  const verb = verbs[item.action] ?? item.action;
  return item.subject ? `${verb} “${item.subject}”` : verb;
}

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
