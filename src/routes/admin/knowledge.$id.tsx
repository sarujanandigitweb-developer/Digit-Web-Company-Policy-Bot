import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, Copy, Layers, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, qs, type KnowledgeDocument } from "@/lib/api/client";
import { useDebounced } from "@/hooks/use-debounced";
import { DataTable, type Column } from "@/components/admin/data-table";
import { EmptyState, ErrorState, LoadingBlock, NoResults } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { CARD } from "@/components/admin/theme";

export const Route = createFileRoute("/admin/knowledge/$id")({
  component: DocumentDetailsPage,
});

interface Chunk {
  id: string;
  chunk_index: number;
  content: string;
  heading: string | null;
  page_number: number | null;
  has_embedding: boolean;
}

function DocumentDetailsPage() {
  const { id } = Route.useParams();
  const [page, setPage] = useState(1);
  const [chunkSearch, setChunkSearch] = useState("");
  const debouncedSearch = useDebounced(chunkSearch);
  const pageSize = 25;

  const document = useQuery({
    queryKey: ["document", id],
    queryFn: () => api.get<KnowledgeDocument>(`/api/admin/knowledge/${id}`),
    // Keep the page live while ingestion is still running.
    refetchInterval: (q) => (q.state.data?.status === "processing" ? 3000 : false),
  });

  const chunks = useQuery({
    queryKey: ["chunks", id, page],
    queryFn: () =>
      api.get<{ items: Chunk[]; total: number }>(
        `/api/admin/knowledge/${id}/chunks${qs({ limit: pageSize, offset: (page - 1) * pageSize })}`,
      ),
    placeholderData: (prev) => prev,
  });

  /**
   * Chunk search filters the loaded page in the browser.
   * The API has no chunk-search parameter, and adding one would be a backend
   * change this pass does not need — the filter is scoped to the current page
   * and the label below says so, rather than implying it searched everything.
   */
  const visibleChunks = useMemo(() => {
    const items = chunks.data?.items ?? [];
    if (!debouncedSearch) return items;
    const needle = debouncedSearch.toLowerCase();
    return items.filter(
      (c) => c.content.toLowerCase().includes(needle) || c.heading?.toLowerCase().includes(needle),
    );
  }, [chunks.data, debouncedSearch]);

  const columns = useMemo<Column<Chunk>[]>(
    () => [
      {
        key: "index",
        header: "#",
        className: "w-12",
        render: (c) => <span className="tabular-nums text-slate-500">{c.chunk_index}</span>,
      },
      {
        key: "heading",
        header: "Heading",
        hideOnMobile: true,
        render: (c) => (
          <span className="text-slate-700 dark:text-slate-200">{c.heading ?? "—"}</span>
        ),
      },
      {
        key: "page",
        header: "Page",
        hideOnMobile: true,
        className: "w-16",
        render: (c) => <span className="tabular-nums text-slate-500">{c.page_number ?? "—"}</span>,
      },
      {
        key: "preview",
        header: "Preview",
        render: (c) => (
          <p className="line-clamp-2 max-w-md text-xs text-slate-600 dark:text-slate-300">
            {c.content}
          </p>
        ),
      },
      {
        key: "embedding",
        header: "Embedding",
        render: (c) => <StatusBadge value={c.has_embedding ? "active" : "processing"} />,
      },
      {
        key: "copy",
        header: "",
        className: "w-12 text-right",
        render: (c) => <CopyButton text={c.content} index={c.chunk_index} />,
      },
    ],
    [],
  );

  if (document.isLoading) return <LoadingBlock label="Loading document…" />;
  if (document.isError) {
    return (
      <div className="mx-auto max-w-[1200px]">
        <BackLink />
        <div className={CARD}>
          <ErrorState error={document.error} onRetry={() => document.refetch()} />
        </div>
      </div>
    );
  }

  const d = document.data!;
  const duration =
    d.processing_started_at && d.processing_completed_at
      ? `${((new Date(d.processing_completed_at).getTime() - new Date(d.processing_started_at).getTime()) / 1000).toFixed(1)}s`
      : "—";

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {d.title}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {d.file_name} · {formatBytes(d.file_size_bytes)} · v{d.version}
          </p>
        </div>
        <StatusBadge value={d.status} />
      </header>

      {d.status === "failed" && d.processing_error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-900/40 dark:bg-red-950/40"
        >
          <p className="text-sm font-semibold text-red-800 dark:text-red-300">Processing failed</p>
          <p className="mt-1 font-mono text-xs text-red-700 dark:text-red-400">
            {d.processing_error}
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <section aria-label="Document information" className={`${CARD} p-4 lg:col-span-2`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
            Document information
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
            <Info label="Department" value={d.department_name ?? "—"} />
            <Info label="Version" value={`v${d.version}`} />
            <Info label="Status" value={<StatusBadge value={d.status} />} />
            <Info label="Uploaded by" value={d.uploaded_by_name ?? "—"} />
            <Info label="Created" value={new Date(d.created_at).toLocaleString()} />
            <Info label="Updated" value={new Date(d.updated_at).toLocaleString()} />
            {d.description && (
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-slate-500 dark:text-slate-400">Description</dt>
                <dd className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">
                  {d.description}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section aria-label="Processing" className={`${CARD} p-4`}>
          <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
            Processing
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Info label="Attempts" value={String(d.processing_attempts)} />
            <Info label="Duration" value={duration} />
            <Info label="Chunks" value={String(d.chunk_count)} />
            <Info
              label="Embeddings"
              value={
                <span
                  className={
                    d.chunk_count > 0 && d.embedded_count < d.chunk_count
                      ? "text-amber-600 dark:text-amber-400"
                      : undefined
                  }
                >
                  {d.embedded_count}
                  {d.chunk_count > 0 && d.embedded_count < d.chunk_count && ` / ${d.chunk_count}`}
                </span>
              }
            />
            <Info label="Pages" value={d.page_count !== null ? String(d.page_count) : "—"} />
            <Info
              label="Started"
              value={
                d.processing_started_at
                  ? new Date(d.processing_started_at).toLocaleTimeString()
                  : "—"
              }
            />
            <Info
              label="Completed"
              value={
                d.processing_completed_at
                  ? new Date(d.processing_completed_at).toLocaleTimeString()
                  : "—"
              }
            />
          </dl>
        </section>
      </div>

      <section aria-label="Chunks" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Chunks{" "}
            <span className="font-normal text-slate-500">
              ({chunks.data?.total ?? 0}) — what retrieval searches
            </span>
          </h2>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400"
              aria-hidden="true"
            />
            <Input
              value={chunkSearch}
              onChange={(e) => setChunkSearch(e.target.value)}
              placeholder="Filter this page…"
              aria-label="Filter chunks on this page"
              className="w-56 pl-8"
            />
          </div>
        </div>

        <DataTable
          caption="Document chunks"
          columns={columns}
          rows={visibleChunks}
          rowKey={(c) => c.id}
          isLoading={chunks.isLoading}
          error={chunks.error}
          onRetry={() => chunks.refetch()}
          page={page}
          pageSize={pageSize}
          total={debouncedSearch ? visibleChunks.length : (chunks.data?.total ?? 0)}
          onPageChange={debouncedSearch ? undefined : setPage}
          empty={
            debouncedSearch ? (
              <NoResults query={debouncedSearch} onClear={() => setChunkSearch("")} />
            ) : (
              <EmptyState
                icon={Layers}
                title="No chunks yet"
                description={
                  d.status === "processing"
                    ? "Processing is still running — chunks will appear shortly."
                    : "This document produced no chunks. Try retrying processing."
                }
              />
            )
          }
        />
        {debouncedSearch && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Filtering the {chunks.data?.items.length ?? 0} chunks on this page only.
          </p>
        )}
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/knowledge"
      className="inline-flex items-center gap-1.5 rounded text-sm text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] dark:text-slate-400 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Knowledge
    </Link>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{value}</dd>
    </div>
  );
}

function CopyButton({ text, index }: { text: string; index: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Copy chunk ${index}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          toast.success(`Chunk ${index} copied`);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard is blocked without HTTPS or permission — say so rather
          // than showing a success state for something that did not happen.
          toast.error("Couldn’t copy — your browser blocked clipboard access");
        }
      }}
    >
      {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
