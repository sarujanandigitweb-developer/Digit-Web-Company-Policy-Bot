import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  Database,
  FileText,
  Layers,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { ActivityItem, KnowledgeStats, SystemStatus } from "@/lib/api/client";
import { api } from "@/lib/api/client";
import { CARD } from "@/components/admin/theme";
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const Route = createFileRoute("/admin/")({
  component: DashboardPage,
});

function DashboardPage() {
  const stats = useQuery({
    queryKey: ["knowledge-stats"],
    queryFn: () => api.get<KnowledgeStats>("/api/admin/knowledge/stats"),
  });
  const status = useQuery({
    queryKey: ["system-status"],
    queryFn: () => api.get<SystemStatus>("/api/admin/system/status"),
    // Health goes stale quickly; a card claiming "Healthy" from five minutes ago
    // is worse than one that says it is checking.
    refetchInterval: 30_000,
  });
  const activity = useQuery({
    queryKey: ["activity"],
    queryFn: () => api.get<{ items: ActivityItem[] }>("/api/admin/activity?limit=12"),
  });

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Knowledge base health and recent activity.
        </p>
      </header>

      {/* KPIs */}
      <section
        aria-label="Key figures"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6"
      >
        {stats.isLoading ? (
          <CardSkeleton count={6} />
        ) : stats.isError ? (
          <div className={`col-span-full ${CARD}`}>
            <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
          </div>
        ) : (
          <>
            <Kpi label="Documents" value={stats.data!.total_documents} icon={FileText} />
            <Kpi label="Active" value={stats.data!.active} icon={CheckCircle2} tone="emerald" />
            <Kpi label="Processing" value={stats.data!.processing} icon={RefreshCw} tone="blue" />
            <Kpi label="Failed" value={stats.data!.failed} icon={XCircle} tone="red" />
            <Kpi label="Chunks" value={stats.data!.chunk_count} icon={Layers} />
            <Kpi label="Embeddings" value={stats.data!.embedding_count} icon={Sparkles} />
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* System status */}
        <section aria-label="System status" className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
            System status
          </h2>
          <div className={`${CARD} divide-y divide-slate-100 dark:divide-white/10`}>
            {status.isLoading ? (
              <div className="p-4">
                <TableSkeleton rows={4} cols={1} />
              </div>
            ) : status.isError ? (
              <ErrorState error={status.error} onRetry={() => status.refetch()} />
            ) : (
              status.data!.checks.map((check) => (
                <div key={check.name} className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {check.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                      {check.detail}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {check.latency_ms !== null && (
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        {check.latency_ms}ms
                      </span>
                    )}
                    <StatusBadge value={check.status} />
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Recent activity */}
        <section aria-label="Recent activity" className="lg:col-span-3">
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
            Recent activity
          </h2>
          <div className={CARD}>
            {activity.isLoading ? (
              <TableSkeleton rows={6} cols={2} />
            ) : activity.isError ? (
              <ErrorState error={activity.error} onRetry={() => activity.refetch()} />
            ) : activity.data!.items.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No activity yet"
                description="Uploads, user changes and retries will appear here."
              />
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-white/10">
                {activity.data!.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 p-3 px-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <ActionDot action={item.action} />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-800 dark:text-slate-100">
                          {describe(item)}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {item.actor_name ?? "Someone"} · {relativeTime(item.created_at)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone = "slate",
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "slate" | "emerald" | "blue" | "red";
}) {
  const tones = {
    slate: "text-slate-500 dark:text-slate-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    blue: "text-blue-600 dark:text-blue-400",
    red: "text-red-600 dark:text-red-400",
  };
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <Icon className={`h-4 w-4 ${tones[tone]}`} />
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
        {value.toLocaleString()}
      </p>
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
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
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
