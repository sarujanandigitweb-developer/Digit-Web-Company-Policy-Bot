import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { api } from "@/lib/api/client";
import { CARD } from "@/components/admin/theme";
import { PageHeader } from "@/components/admin/primitives";
import { CardSkeleton, ErrorState } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";

export const Route = createFileRoute("/admin/settings")({
  component: SettingsPage,
});

/**
 * Read-only system configuration.
 *
 * There is no settings table — every value is an environment variable or a
 * module constant read at boot. An editable form would imply a persistence layer
 * that does not exist and would silently discard changes, so this reports what
 * the running system is actually using and says where to change it.
 */
interface Settings {
  knowledge: {
    source: string;
    embedding_model: string;
    embedding_dimensions: number;
    chunk_size: number;
    chunk_overlap: number;
    confidence_floor: number;
    max_upload_bytes: number;
    supported_types: string[];
  };
  providers: Array<{ id: string; model: string; configured: boolean; order: number }>;
  queue: { processing: number; failed: number; stalled: number };
  runtime: { node: string; environment: string };
}

function SettingsPage() {
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/api/admin/settings"),
  });

  if (settings.isError) {
    return (
      <div className="mx-auto max-w-[1000px]">
        <div className={CARD}>
          <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-6">
      <PageHeader title="Settings" description="What the running system is configured with." />

      <div
        className="flex items-start gap-2.5 rounded-2xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-blue-950/30"
        role="note"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
        <p className="text-xs text-blue-800 dark:text-blue-300">
          These values are read-only. They come from environment variables, so change them in{" "}
          <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/50">.env</code> (or your Vercel
          project settings) and restart — there is no settings table to write to.
        </p>
      </div>

      {settings.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <CardSkeleton count={4} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Knowledge & retrieval">
            <Row label="Answer source" value={settings.data!.knowledge.source} />
            <Row label="Embedding model" value={settings.data!.knowledge.embedding_model} mono />
            <Row
              label="Embedding dimensions"
              value={String(settings.data!.knowledge.embedding_dimensions)}
              hint="Capped at 2000 by pgvector's HNSW index"
            />
            <Row label="Chunk size" value={`${settings.data!.knowledge.chunk_size} chars`} />
            <Row label="Chunk overlap" value={`${settings.data!.knowledge.chunk_overlap} chars`} />
            <Row
              label="Confidence floor"
              value={settings.data!.knowledge.confidence_floor.toFixed(2)}
              hint="Answers below this are recorded as knowledge gaps"
            />
          </Section>

          <Section title="Uploads">
            <Row
              label="Maximum file size"
              value={`${(settings.data!.knowledge.max_upload_bytes / 1024 / 1024).toFixed(0)} MB`}
            />
            <Row
              label="Supported types"
              value={settings.data!.knowledge.supported_types.join(", ").toUpperCase()}
            />
            <Row label="Processing" value={String(settings.data!.queue.processing)} />
            <Row label="Failed" value={String(settings.data!.queue.failed)} />
            <Row
              label="Stalled"
              value={String(settings.data!.queue.stalled)}
              hint={
                settings.data!.queue.stalled > 0 ? "Retry these from the Knowledge page" : undefined
              }
            />
          </Section>

          <Section title="AI providers" className="lg:col-span-2">
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Tried in order; the first that responds answers. Embeddings always use Gemini — Groq
              and OpenRouter have no embedding endpoint.
            </p>
            <div className="space-y-2">
              {settings.data!.providers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-white/10"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold tabular-nums text-slate-600 dark:bg-white/10 dark:text-slate-300">
                      {p.order}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium capitalize text-slate-800 dark:text-slate-100">
                        {p.id}
                      </p>
                      <p className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                        {p.model}
                      </p>
                    </div>
                  </div>
                  <StatusBadge value={p.configured ? "active" : "inactive"} />
                </div>
              ))}
            </div>
          </Section>

          <Section title="Runtime" className="lg:col-span-2">
            <Row label="Node" value={settings.data!.runtime.node} mono />
            <Row label="Environment" value={settings.data!.runtime.environment} />
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({
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
      <dl className="space-y-2.5">{children}</dl>
    </section>
  );
}

function Row({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2.5 last:border-0 last:pb-0 dark:border-white/5">
      <div className="min-w-0">
        <dt className="text-sm text-slate-600 dark:text-slate-300">{label}</dt>
        {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
      </div>
      <dd
        className={`shrink-0 text-sm text-slate-900 dark:text-white ${mono ? "font-mono text-xs" : "tabular-nums"}`}
      >
        {value}
      </dd>
    </div>
  );
}
