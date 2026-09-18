import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  Building2,
  CheckCircle2,
  Eye,
  FileText,
  HardDrive,
  Layers,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  UploadCloud,
  X,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  api,
  ApiError,
  qs,
  type Department,
  type KnowledgeDocument,
  type Paged,
  type KnowledgeStats,
} from "@/lib/api/client";
import { useDebounced } from "@/hooks/use-debounced";
import { useMe } from "@/hooks/use-me";
import { DataTable, type Column, type SortState } from "@/components/admin/data-table";
import { EmptyState, ErrorState, NoResults, TableSkeleton } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { BRAND, CARD, FOCUS_RING, TONE, departmentTone, initials } from "@/components/admin/theme";
import { Kpi, PageHeader, UserChip } from "@/components/admin/primitives";

export const Route = createFileRoute("/admin/knowledge/")({
  component: KnowledgePage,
});

const ALL = "__all__";
const ACCEPT = ".pdf,.docx,.txt,.md,.markdown";

/** File-type accents. The extension is the one thing every row has. */
const TYPE_TONE: Record<string, keyof typeof TONE> = {
  pdf: "red",
  docx: "blue",
  txt: "slate",
  md: "violet",
};

interface Analytics {
  byDepartment: Array<{ department: string; documents: number }>;
}

function KnowledgePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState(ALL);
  const { data: me } = useMe();
  // Team leaders manage one department; the server confines them to it. Reflect
  // that in the UI so they aren't offered departments the server would override.
  const isTeamLeader = me?.role === "team_leader";
  const [status, setStatus] = useState(ALL);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<KnowledgeDocument | null>(null);
  const [editing, setEditing] = useState<KnowledgeDocument | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ key: "created", direction: "desc" });
  // Debounced so typing doesn't fire a request per keystroke.
  const debouncedSearch = useDebounced(search);

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Paged<Department>>("/api/admin/departments?pageSize=100"),
  });

  // A team leader only ever files into their own department, so the upload and
  // edit dialogs offer just that one — the server enforces it either way.
  const dialogDepartments =
    isTeamLeader && me?.departmentId
      ? (departments.data?.items ?? []).filter((d) => d.id === me.departmentId)
      : (departments.data?.items ?? []);

  const stats = useQuery({
    queryKey: ["knowledge-stats"],
    queryFn: () => api.get<KnowledgeStats>("/api/admin/knowledge/stats"),
  });

  const analytics = useQuery({
    queryKey: ["knowledge-analytics"],
    queryFn: () => api.get<Analytics>("/api/admin/analytics/knowledge?days=30"),
  });

  const documents = useQuery({
    queryKey: ["documents", page, debouncedSearch, departmentId, status, sort],
    queryFn: () =>
      api.get<Paged<KnowledgeDocument>>(
        `/api/admin/knowledge${qs({
          page,
          pageSize: 25,
          search: debouncedSearch || undefined,
          departmentId: departmentId === ALL ? undefined : departmentId,
          status: status === ALL ? undefined : status,
          sortBy: sort.key,
          sortDir: sort.direction,
        })}`,
      ),
    placeholderData: (prev) => prev,
    // Processing finishes in the background; poll while anything is in flight so
    // the row flips to Active without the admin reaching for refresh.
    refetchInterval: (query) =>
      query.state.data?.items.some((d) => d.status === "processing") ? 3000 : false,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["documents"] });
    void qc.invalidateQueries({ queryKey: ["knowledge-stats"] });
    void qc.invalidateQueries({ queryKey: ["knowledge-analytics"] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: "active" | "archived" | "inactive" }) =>
      api.patch<KnowledgeDocument>(`/api/admin/knowledge/${id}`, { status: next }),
    onSuccess: (_d, v) => {
      toast.success(v.next === "active" ? "Document activated" : `Document ${v.next}`);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update document"),
  });

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post<KnowledgeDocument>(`/api/admin/knowledge/${id}/retry`),
    onSuccess: () => {
      toast.success("Processing restarted", {
        description: "Chunking and embedding run in the background.",
      });
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not retry"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/admin/knowledge/${id}`),
    onSuccess: () => {
      toast.success("Document deleted");
      setDeleting(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete"),
  });

  /**
   * Bulk actions run the existing single-document endpoints in sequence.
   * No new API: the admin gets one gesture, the server sees the same calls it
   * already validates and audits one at a time.
   */
  const bulkMutation = useMutation({
    mutationFn: async ({
      ids,
      action,
    }: {
      ids: string[];
      action: "archived" | "active" | "retry";
    }) => {
      const results = await Promise.allSettled(
        ids.map((id) =>
          action === "retry"
            ? api.post(`/api/admin/knowledge/${id}/retry`)
            : api.patch(`/api/admin/knowledge/${id}`, { status: action }),
        ),
      );
      return results.filter((r) => r.status === "rejected").length;
    },
    onSuccess: (failures, { ids, action }) => {
      const verb =
        action === "retry"
          ? "queued for reprocessing"
          : action === "active"
            ? "activated"
            : "archived";
      // Reports partial failure honestly rather than claiming a clean sweep.
      if (failures === 0) toast.success(`${ids.length} document(s) ${verb}`);
      else toast.warning(`${ids.length - failures} ${verb}, ${failures} failed`);
      setSelected(new Set());
      invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Bulk action failed"),
  });

  const items = documents.data?.items ?? [];
  // Sum of what was uploaded. Labelled "file size", not "storage": the pipeline
  // keeps extracted text, not the files, so nothing sits in a bucket.
  const totalBytes = items.reduce((sum, d) => sum + Number(d.file_size_bytes ?? 0), 0);
  const departmentCount = analytics.data?.byDepartment.filter((d) => d.documents > 0).length ?? 0;
  const s = stats.data;

  const columns = useMemo<Column<KnowledgeDocument>[]>(
    () => [
      {
        key: "title",
        sortable: true,
        header: "Document",
        exportValue: (d) => d.title,
        render: (d) => {
          const tone = TONE[TYPE_TONE[d.file_type] ?? "slate"];
          return (
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.bg}`}
              >
                <FileText className={`h-4 w-4 ${tone.fg}`} />
              </span>
              <div className="min-w-0">
                <Link
                  to="/admin/knowledge/$id"
                  params={{ id: d.id }}
                  className={`block truncate font-medium text-slate-800 underline-offset-2 hover:underline dark:text-slate-100 ${FOCUS_RING}`}
                >
                  {d.title}
                </Link>
                <p className="truncate text-xs text-slate-400">
                  <span className="uppercase">{d.file_type}</span> ·{" "}
                  {formatBytes(d.file_size_bytes)}
                  {d.page_count !== null && ` · ${d.page_count} pages`}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        key: "department",
        sortable: true,
        header: "Department",
        hideOnMobile: true,
        exportValue: (d) => d.department_name,
        render: (d) => {
          if (!d.department_name) return <span className="text-xs text-slate-400">—</span>;
          const t = TONE[departmentTone(d.department_name)];
          return (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${t.bg} ${t.fg}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />
              {d.department_name}
            </span>
          );
        },
      },
      {
        key: "version",
        sortable: true,
        header: "Version",
        hideOnMobile: true,
        exportValue: (d) => d.version,
        render: (d) => (
          <span className="inline-flex rounded-md border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:border-white/10 dark:text-slate-300">
            v{d.version}
          </span>
        ),
      },
      {
        key: "status",
        sortable: true,
        header: "Status",
        exportValue: (d) => d.status,
        render: (d) =>
          d.status === "failed" && d.processing_error ? (
            <TooltipProvider>
              <UiTooltip>
                <TooltipTrigger>
                  <StatusBadge value={d.status} />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">{d.processing_error}</p>
                </TooltipContent>
              </UiTooltip>
            </TooltipProvider>
          ) : (
            <StatusBadge value={d.status} />
          ),
      },
      {
        key: "chunks",
        sortable: true,
        header: "Chunks",
        hideOnMobile: true,
        exportValue: (d) => d.chunk_count,
        render: (d) => (
          <div className="leading-tight">
            <p className="font-medium tabular-nums text-slate-700 dark:text-slate-200">
              {d.chunk_count}
            </p>
            <p className="text-[11px] text-slate-400">chunks</p>
          </div>
        ),
      },
      {
        key: "embeddings",
        header: "Embeddings",
        hideOnMobile: true,
        exportValue: (d) => d.embedded_count,
        render: (d) => {
          const partial = d.chunk_count > 0 && d.embedded_count < d.chunk_count;
          return (
            <span className="inline-flex items-center gap-1.5">
              <Sparkles
                className={`h-3.5 w-3.5 ${partial ? "text-amber-500" : "text-violet-500"}`}
              />
              <span
                className={`tabular-nums ${partial ? "text-amber-600 dark:text-amber-400" : "text-slate-700 dark:text-slate-200"}`}
              >
                {d.embedded_count}
                {partial && `/${d.chunk_count}`}
              </span>
            </span>
          );
        },
      },
      {
        key: "uploaded_by",
        header: "Uploaded by",
        hideOnMobile: true,
        exportValue: (d) => d.uploaded_by_name,
        render: (d) => <UserChip name={d.uploaded_by_name} />,
      },
      {
        key: "created",
        sortable: true,
        header: "Created",
        hideOnMobile: true,
        exportValue: (d) => d.created_at,
        render: (d) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {formatDate(d.created_at)}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        alwaysVisible: true,
        className: "w-12 text-right",
        render: (d) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Actions for ${d.title}`}
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={() => navigate({ to: "/admin/knowledge/$id", params: { id: d.id } })}
              >
                <Eye className="mr-2 h-4 w-4" />
                View details
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setEditing(d)}>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => retryMutation.mutate(d.id)}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Reprocess
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {d.status !== "active" && d.status !== "processing" && (
                <DropdownMenuItem
                  onClick={() => statusMutation.mutate({ id: d.id, next: "active" })}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" />
                  Activate
                </DropdownMenuItem>
              )}
              {d.status !== "archived" && (
                <DropdownMenuItem
                  onClick={() => statusMutation.mutate({ id: d.id, next: "archived" })}
                >
                  <Archive className="mr-2 h-4 w-4" />
                  Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeleting(d)} className="text-red-600">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [navigate, retryMutation, statusMutation],
  );

  const hasFilters = !!debouncedSearch || departmentId !== ALL || status !== ALL;
  function clearFilters() {
    setSearch("");
    setDepartmentId(ALL);
    setStatus(ALL);
    setPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5">
      <PageHeader
        title="Knowledge"
        description="Manage the documents the AI assistant answers from."
        actions={
          <>
            <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => invalidate()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button
              size="sm"
              className="h-9 gap-2 text-white"
              style={{ background: BRAND }}
              onClick={() => setUploadOpen(true)}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </Button>
          </>
        }
      />

      <section
        aria-label="Knowledge summary"
        className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"
      >
        <Kpi label="Documents" value={s?.total_documents ?? 0} icon={FileText} tone="blue" />
        <Kpi
          label="Active"
          value={s?.active ?? 0}
          icon={CheckCircle2}
          tone="emerald"
          hint="Searchable"
        />
        <Kpi label="Processing" value={s?.processing ?? 0} icon={RefreshCw} tone="blue" />
        <Kpi label="Failed" value={s?.failed ?? 0} icon={Archive} tone="red" />
        <Kpi label="Chunks" value={s?.chunk_count ?? 0} icon={Layers} tone="violet" />
        <Kpi
          label="Embeddings"
          value={s?.embedding_count ?? 0}
          icon={Sparkles}
          tone="violet"
          hint={
            s && s.chunk_count > s.embedding_count
              ? `${s.chunk_count - s.embedding_count} outstanding`
              : "Complete"
          }
        />
      </section>

      {/* One toolbar rather than filters scattered across the page. */}
      <div className={`${CARD} flex flex-wrap items-center gap-2 p-2`}>
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search title or filename…"
          aria-label="Search documents"
          className="h-9 w-full sm:max-w-[260px]"
        />
        {!isTeamLeader && (
          <Select
            value={departmentId}
            onValueChange={(v) => {
              setDepartmentId(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 w-[170px]" aria-label="Filter by department">
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All departments</SelectItem>
              {(departments.data?.items ?? []).map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {["draft", "processing", "active", "inactive", "failed", "archived"].map((v) => (
              <SelectItem key={v} value={v}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="h-9 text-slate-500" onClick={clearFilters}>
            Reset
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1.5 pr-1 text-xs text-slate-400">
          <HardDrive className="h-3.5 w-3.5" />
          {formatBytes(totalBytes)} on this page
        </span>
      </div>

      <DataTable
        caption="Knowledge documents"
        columns={columns}
        rows={items}
        rowKey={(d) => d.id}
        isLoading={documents.isLoading}
        error={documents.error}
        onRetry={() => documents.refetch()}
        page={page}
        pageSize={documents.data?.pageSize ?? 25}
        total={documents.data?.total ?? 0}
        onPageChange={setPage}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        exportName="knowledge-documents"
        selectable
        selected={selected}
        onSelectionChange={setSelected}
        bulkActions={(ids) => (
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({ ids: [...ids], action: "active" })}
            >
              {bulkMutation.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Activate
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({ ids: [...ids], action: "archived" })}
            >
              Archive
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({ ids: [...ids], action: "retry" })}
            >
              Reprocess
            </Button>
          </>
        )}
        empty={
          hasFilters ? (
            <NoResults query={debouncedSearch || "these filters"} onClear={clearFilters} />
          ) : (
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description="Upload a policy document to give the chatbot something to answer from."
              action={
                <Button
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  style={{ background: BRAND }}
                  className="text-white"
                >
                  Upload document
                </Button>
              }
            />
          )
        }
      />

      {/* Fills the space below the table with things worth knowing. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Documents by department" className={`${CARD} p-4`}>
          <div className="mb-1 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-400" />
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
              Documents by department
            </h2>
          </div>
          <p className="mb-3 text-xs text-slate-400">
            {departmentCount} department{departmentCount === 1 ? "" : "s"} with active content
          </p>
          {analytics.isLoading ? (
            <TableSkeleton rows={4} cols={1} />
          ) : analytics.isError ? (
            <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} />
          ) : (
            (() => {
              const data = [...(analytics.data?.byDepartment ?? [])].sort(
                (a, b) => b.documents - a.documents,
              );
              const chartHeight = Math.max(190, data.length * 28);
              return (
                <div className="max-h-[240px] overflow-y-auto pr-1">
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
                        tick={{ fontSize: 10 }}
                        width={120}
                        tickFormatter={(value: string) =>
                          value.length > 16 ? `${value.slice(0, 15)}…` : value
                        }
                      />
                      <Tooltip cursor={{ fill: "rgba(43,108,243,0.06)" }} />
                      <Bar dataKey="documents" fill={BRAND} radius={[0, 4, 4, 0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            })()
          )}
        </section>

        <section aria-label="Processing queue" className={`${CARD} p-4`}>
          <div className="mb-1 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-slate-400" />
            <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">
              Processing queue
            </h2>
          </div>
          <p className="mb-3 text-xs text-slate-400">Documents not yet searchable</p>
          <QueuePanel
            items={items.filter((d) => d.status === "processing" || d.status === "failed")}
            onRetry={(id) => retryMutation.mutate(id)}
            pending={retryMutation.isPending}
          />
        </section>
      </div>

      <UploadDialog
        open={uploadOpen || !!replaceTarget}
        onOpenChange={(o) => {
          if (!o) {
            setUploadOpen(false);
            setReplaceTarget(null);
          }
        }}
        departments={dialogDepartments}
        replaces={replaceTarget ?? undefined}
        onUploaded={invalidate}
      />

      <EditDocumentDialog
        document={editing}
        departments={dialogDepartments}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={invalidate}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the document and its {deleting?.chunk_count ?? 0} chunks, and
              past answers will lose their citation links to it. Archiving keeps it out of the
              chatbot while preserving history — consider that instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The queue panel: only ever shows rows from the page in view. */
function QueuePanel({
  items,
  onRetry,
  pending,
}: {
  items: KnowledgeDocument[];
  onRetry: (id: string) => void;
  pending: boolean;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Queue is clear"
        description="Every document on this page is processed."
      />
    );
  }
  return (
    <ul className="divide-y divide-slate-100 dark:divide-white/[0.06]">
      {items.map((d) => (
        <li key={d.id} className="flex items-center gap-3 py-2.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${d.status === "processing" ? "animate-pulse bg-blue-500" : "bg-red-500"}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-800 dark:text-slate-100">{d.title}</p>
            <p className="truncate text-xs text-slate-400">
              {d.status === "processing"
                ? `Attempt ${d.processing_attempts} · chunking and embedding`
                : (d.processing_error ?? "Failed")}
            </p>
          </div>
          {d.status === "failed" && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={pending}
              onClick={() => onRetry(d.id)}
            >
              Retry
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "17 Jul 2026" reads faster in a column than a locale-default date string. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Keep long filenames and library paths inside the panel; only the body scrolls.
const DOCUMENT_DIALOG =
  "flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] min-w-0 flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-2xl";
const DOCUMENT_FORM_BODY =
  "min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 [&>div]:min-w-0";
const DOCUMENT_FORM_FOOTER = "shrink-0 gap-2 border-t bg-muted/30 px-5 py-4 sm:px-6";
const DOCUMENT_SELECT =
  "min-w-0 max-w-full gap-2 [&>span]:min-w-0 [&>span]:truncate [&>svg]:shrink-0";
const DOCUMENT_OPTIONS =
  "w-[var(--radix-select-trigger-width)] max-h-[min(18rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-2rem)] [&_[role=option]]:whitespace-normal [&_[role=option]]:[overflow-wrap:anywhere]";

function UploadDialog({
  open,
  onOpenChange,
  departments,
  replaces,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  departments: Department[];
  replaces?: KnowledgeDocument;
  onUploaded: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  // Knowledge Library placement. Both optional: a document with neither still
  // uploads and is still searchable, it just shows as unfiled in the library.
  const [folderId, setFolderId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [isUploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const TITLE_MAX = 200;
  const DESC_MAX = 1000;
  /** Sentinel: Select cannot hold an empty string as a value. */
  const NO_FOLDER = "__none__";

  // Only fetched while the dialog is open — the list is irrelevant otherwise.
  const folders = useQuery({
    queryKey: ["library-folder-options", departmentId],
    queryFn: () =>
      api.get<{ items: Array<{ id: string; label: string }> }>(
        `/api/admin/library/folders?departmentId=${encodeURIComponent(departmentId)}`,
      ),
    enabled: open && !!departmentId,
  });

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTitle(replaces?.title ?? "");
    setDescription(replaces?.description ?? "");
    setDepartmentId(replaces?.department_id ?? "");
    setFolderId(replaces?.folder_id ?? "");
    setSourceUrl(replaces?.source_url ?? "");
    setError(null);
    setProgress(0);
    setDragging(false);
  }, [open, replaces]);

  /** Accepts a chosen or dropped file: validates the extension, then fills the
   *  title from the filename if the title is still empty. */
  function acceptFile(f: File | null) {
    if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "docx", "txt", "md", "markdown"].includes(ext)) {
      setError("Unsupported file type. Use PDF, DOCX, TXT or Markdown.");
      return;
    }
    setError(null);
    setFile(f);
    setTitle((t) => t || f.name.replace(/\.[^.]+$/, ""));
  }

  /**
   * XHR rather than fetch: fetch cannot report upload progress, and a 20MB PDF
   * over a slow link needs to show something is happening.
   */
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return setError("Choose a file to upload");
    setError(null);
    setUploading(true);
    setProgress(0);

    const form = new FormData();
    form.append("file", file);
    form.append("title", title);
    if (description) form.append("description", description);
    form.append("departmentId", departmentId);
    if (folderId) form.append("folderId", folderId);
    if (sourceUrl.trim()) form.append("sourceUrl", sourceUrl.trim());
    if (replaces) form.append("replacesId", replaces.id);

    const { getToken } = await import("@/lib/auth/client");
    const token = await getToken();

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/knowledge");
      xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        setUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          // 202: stored and queued. The row appears as Processing immediately and
          // the table polls until the background job flips it to Active.
          toast.success(replaces ? "Replacement uploaded" : "Document uploaded", {
            description: "Processing in the background — the status will update automatically.",
          });
          onOpenChange(false);
          onUploaded();
        } else {
          let message = `Upload failed (${xhr.status})`;
          try {
            const body = JSON.parse(xhr.responseText);
            message = body?.error?.message ?? message;
            if (body?.error?.details?.length) message = body.error.details[0].message;
          } catch {
            /* keep the status-based message */
          }
          setError(message);
        }
        resolve();
      };
      xhr.onerror = () => {
        setUploading(false);
        setError("Network error during upload");
        resolve();
      };
      xhr.send(form);
    });
  }

  const canUpload = !isUploading && !!file && !!departmentId && !!title.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DOCUMENT_DIALOG}>
        <DialogHeader className="shrink-0 border-b bg-muted/30 px-5 py-5 pr-12 text-left sm:px-6 sm:pr-12">
          <div className="flex items-start gap-3">
            <span className={`shrink-0 rounded-xl p-2.5 ${TONE.blue.bg}`}>
              <UploadCloud className={`h-5 w-5 ${TONE.blue.fg}`} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="break-words leading-snug [overflow-wrap:anywhere]">
                {replaces ? `Replace “${replaces.title}”` : "Upload document"}
              </DialogTitle>
              <DialogDescription className="mt-0.5">
                {replaces
                  ? `Uploads v${replaces.version + 1} and archives the current version.`
                  : "Add a document to your team’s knowledge base."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={DOCUMENT_FORM_BODY}>
            {/* Drag-and-drop file zone */}
            <div className="space-y-1.5">
              <Label htmlFor="file-input">File</Label>
              <input
                id="file-input"
                type="file"
                ref={fileRef}
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
              />
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  acceptFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 transition ${FOCUS_RING} ${
                  dragging
                    ? "border-[#2b6cf3] bg-[#2b6cf3]/[0.06]"
                    : "border-blue-200 bg-blue-50/40 hover:border-blue-400 hover:bg-blue-50 dark:border-white/15 dark:hover:border-white/25 dark:hover:bg-white/[0.03]"
                }`}
              >
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                    file
                      ? "bg-emerald-500/10 text-emerald-600"
                      : "bg-slate-100 text-slate-400 dark:bg-white/5"
                  }`}
                >
                  <FileText className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  {file ? (
                    <>
                      <p
                        title={file.name}
                        className="truncate text-sm font-medium text-slate-800 dark:text-slate-100"
                      >
                        {file.name}
                      </p>
                      <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        Choose a file or drag and drop
                      </p>
                      <p className="text-xs text-slate-400">PDF, DOCX, TXT, MD · up to 20 MB</p>
                    </>
                  )}
                </div>
                {file ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-slate-400 hover:text-red-600"
                    aria-label="Remove file"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                ) : (
                  <span className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 dark:border-white/15 dark:text-slate-300">
                    Browse
                  </span>
                )}
              </div>
            </div>

            {/* Title with counter */}
            <div className="space-y-1.5">
              <Label htmlFor="title">
                Title <span className="text-red-500">*</span>
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={TITLE_MAX}
                placeholder="Enter a descriptive title for the document"
              />
              <p className="text-right text-[11px] tabular-nums text-slate-400">
                {title.length} / {TITLE_MAX}
              </p>
            </div>

            {/* Description with counter */}
            <div className="space-y-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="min-w-0 resize-y"
                maxLength={DESC_MAX}
                placeholder="Add a short description to help others understand this document"
              />
              <p className="text-right text-[11px] tabular-nums text-slate-400">
                {description.length} / {DESC_MAX}
              </p>
            </div>

            <div className="grid min-w-0 gap-5 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="dept">
                  Department <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={departmentId}
                  onValueChange={(value) => {
                    setDepartmentId(value);
                    setFolderId("");
                  }}
                  disabled={!!replaces}
                >
                  <SelectTrigger id="dept" className={DOCUMENT_SELECT}>
                    <SelectValue placeholder="Select a department" />
                  </SelectTrigger>
                  <SelectContent className={DOCUMENT_OPTIONS}>
                    {departments
                      .filter((d) => d.status === "active")
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {replaces
                    ? "A replacement stays in the original department."
                    : "The document will be searchable within the selected department."}
                </p>
              </div>

              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="folder">Knowledge Library location</Label>
                <Select
                  value={folderId || NO_FOLDER}
                  disabled={!departmentId || folders.isPending || folders.isError}
                  onValueChange={(v) => setFolderId(v === NO_FOLDER ? "" : v)}
                >
                  <SelectTrigger
                    id="folder"
                    className={DOCUMENT_SELECT}
                    title={folders.data?.items.find((folder) => folder.id === folderId)?.label}
                  >
                    <SelectValue placeholder="Not filed">
                      {folders.data?.items.find((folder) => folder.id === folderId)?.label ??
                        "Not filed"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className={DOCUMENT_OPTIONS}>
                    <SelectItem value={NO_FOLDER}>Not filed</SelectItem>
                    {(folders.data?.items ?? []).map((f) => (
                      <SelectItem
                        key={f.id}
                        value={f.id}
                        textValue={f.label}
                        title={f.label}
                        className="items-start py-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
                      >
                        <span className="block truncate font-medium">
                          {f.label.split(" / ").at(-1)}
                        </span>
                        {f.label.includes(" / ") && (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {f.label.split(" / ").slice(0, -1).join(" / ")}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {folders.isError
                    ? "Could not load locations. Close and reopen this dialog to retry."
                    : !departmentId
                      ? "Choose a department to see its library locations."
                      : folders.data?.items.length === 0
                        ? "No library locations for this department. You can upload without filing."
                        : "Optional. Showing locations for the selected department."}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sourceUrl">Link to the original</Label>
              <Input
                id="sourceUrl"
                type="url"
                inputMode="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://…"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Optional. Shown as an “Open original” button on the resource.
              </p>
            </div>

            {isUploading && (
              <div className="space-y-1.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${progress}%`, background: BRAND }}
                    role="progressbar"
                    aria-valuenow={progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  />
                </div>
                <p className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                  {progress < 100 ? `Uploading ${progress}%` : "Queuing…"}
                </p>
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
              >
                {error}
              </p>
            )}
          </div>
          <DialogFooter className={DOCUMENT_FORM_FOOTER}>
            <p className="mr-auto self-center text-xs text-muted-foreground">
              Processing starts after upload.
            </p>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!canUpload}
              style={{ background: BRAND }}
              className="gap-2 text-white"
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}
              {replaces ? "Upload replacement" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edits a document's metadata — title, description, department — without
 * re-uploading the file. This is the answer to "the department was set wrong":
 * correct it here instead of re-uploading (which the duplicate-file check would
 * block anyway). Changing the department re-files the document's chunks too,
 * handled server-side in one transaction.
 */
function EditDocumentDialog({
  document,
  departments,
  onOpenChange,
  onSaved,
}: {
  document: KnowledgeDocument | null;
  departments: Department[];
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  // Editable here as well as at upload, so a document added before the library
  // existed can be filed without re-uploading it (which the duplicate-file
  // check would refuse anyway).
  const [folderId, setFolderId] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const NO_FOLDER = "__none__";

  const folders = useQuery({
    queryKey: ["library-folder-options", departmentId],
    queryFn: () =>
      api.get<{ items: Array<{ id: string; label: string }> }>(
        `/api/admin/library/folders?departmentId=${encodeURIComponent(departmentId)}`,
      ),
    enabled: !!document && !!departmentId,
  });

  useEffect(() => {
    if (!document) return;
    setTitle(document.title);
    setDescription(document.description ?? "");
    setDepartmentId(document.department_id);
    setFolderId(document.folder_id ?? "");
    setSourceUrl(document.source_url ?? "");
    setFieldErrors({});
    setFormError(null);
  }, [document]);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<KnowledgeDocument>(`/api/admin/knowledge/${document!.id}`, {
        title: title.trim(),
        description: description.trim() || null,
        departmentId,
        folderId: folderId || null,
        sourceUrl: sourceUrl.trim() || null,
      }),
    onSuccess: () => {
      toast.success("Document updated");
      onOpenChange(false);
      onSaved();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isValidation && e.details) {
        setFieldErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
      } else {
        setFormError(e instanceof Error ? e.message : "Could not save");
      }
    },
  });

  const movingDepartment = !!document && departmentId !== document.department_id;

  return (
    <Dialog open={!!document} onOpenChange={onOpenChange}>
      <DialogContent className={DOCUMENT_DIALOG}>
        <DialogHeader className="shrink-0 border-b bg-muted/30 px-5 py-5 pr-12 text-left sm:px-6 sm:pr-12">
          <DialogTitle>Edit document</DialogTitle>
          <DialogDescription>
            Update document details and organize its place in the Knowledge Library.
          </DialogDescription>
        </DialogHeader>

        {document && (
          <form
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              setFieldErrors({});
              setFormError(null);
              mutation.mutate();
            }}
          >
            <div className={DOCUMENT_FORM_BODY}>
              <div className="space-y-1.5">
                <Label htmlFor="edit-title">Title</Label>
                <Input
                  id="edit-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                />
                {fieldErrors.title && (
                  <p className="text-xs text-red-600" role="alert">
                    {fieldErrors.title}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-desc">Description</Label>
                <Textarea
                  id="edit-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="min-w-0 resize-y"
                  maxLength={1000}
                  placeholder="What this document covers…"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-dept">Department</Label>
                <Select
                  value={departmentId}
                  onValueChange={(value) => {
                    setDepartmentId(value);
                    setFolderId("");
                  }}
                >
                  <SelectTrigger id="edit-dept" className={DOCUMENT_SELECT}>
                    <SelectValue placeholder="Select a department" />
                  </SelectTrigger>
                  <SelectContent className={DOCUMENT_OPTIONS}>
                    {departments
                      .filter((d) => d.status === "active" || d.id === document.department_id)
                      .map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {fieldErrors.departmentId ? (
                  <p className="text-xs text-red-600" role="alert">
                    {fieldErrors.departmentId}
                  </p>
                ) : movingDepartment ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Moving this document re-files its {document.chunk_count} chunks into the new
                    department.
                  </p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-folder">Knowledge Library location</Label>
                <Select
                  value={folderId || NO_FOLDER}
                  disabled={!departmentId || folders.isPending || folders.isError}
                  onValueChange={(v) => setFolderId(v === NO_FOLDER ? "" : v)}
                >
                  <SelectTrigger
                    id="edit-folder"
                    className={DOCUMENT_SELECT}
                    title={folders.data?.items.find((folder) => folder.id === folderId)?.label}
                  >
                    <SelectValue placeholder="Not filed">
                      {folders.data?.items.find((folder) => folder.id === folderId)?.label ??
                        "Not filed"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className={DOCUMENT_OPTIONS}>
                    <SelectItem value={NO_FOLDER}>Not filed</SelectItem>
                    {(folders.data?.items ?? []).map((f) => (
                      <SelectItem
                        key={f.id}
                        value={f.id}
                        textValue={f.label}
                        title={f.label}
                        className="items-start py-2 [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1"
                      >
                        <span className="block truncate font-medium">
                          {f.label.split(" / ").at(-1)}
                        </span>
                        {f.label.includes(" / ") && (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {f.label.split(" / ").slice(0, -1).join(" / ")}
                          </span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="edit-source">Link to the original</Label>
                <Input
                  id="edit-source"
                  type="url"
                  inputMode="url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://…"
                />
                {fieldErrors.sourceUrl && (
                  <p className="text-xs text-red-600" role="alert">
                    {fieldErrors.sourceUrl}
                  </p>
                )}
              </div>

              {formError && (
                <p
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300"
                >
                  {formError}
                </p>
              )}
            </div>
            <DialogFooter className={DOCUMENT_FORM_FOOTER}>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={mutation.isPending || !title.trim()}
                style={{ background: BRAND }}
                className="text-white"
              >
                {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
