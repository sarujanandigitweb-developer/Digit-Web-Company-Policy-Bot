import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Archive, CheckCircle2, FileText, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { api, qs, type Department, type KnowledgeDocument, type Paged } from "@/lib/api/client";
import { DataTable, type Column, type SortState } from "@/components/admin/data-table";
import { useDebounced } from "@/hooks/use-debounced";
import { EmptyState, NoResults } from "@/components/admin/states";
import { StatusBadge } from "@/components/admin/status-badge";
import { BRAND } from "@/components/admin/theme";

export const Route = createFileRoute("/admin/knowledge")({
  component: KnowledgePage,
});

const ALL = "__all__";
const ACCEPT = ".pdf,.docx,.txt,.md,.markdown";

function KnowledgePage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<KnowledgeDocument | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeDocument | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "created", direction: "desc" });
  // Debounced so typing doesn't fire a request per keystroke.
  const debouncedSearch = useDebounced(search);

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Paged<Department>>("/api/admin/departments?pageSize=100"),
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

  const columns = useMemo<Column<KnowledgeDocument>[]>(
    () => [
      {
        key: "title",
        sortable: true,
        header: "Title",
        render: (d) => (
          <div className="min-w-0">
            <Link
              to="/admin/knowledge/$id"
              params={{ id: d.id }}
              className="truncate rounded font-medium text-slate-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] dark:text-slate-100"
            >
              {d.title}
            </Link>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {d.file_name} · {formatBytes(d.file_size_bytes)}
            </p>
          </div>
        ),
      },
      {
        key: "department",
        sortable: true,
        header: "Department",
        hideOnMobile: true,
        render: (d) => (
          <span className="text-slate-600 dark:text-slate-300">{d.department_name ?? "—"}</span>
        ),
      },
      {
        key: "version",
        sortable: true,
        header: "Ver",
        hideOnMobile: true,
        render: (d) => (
          <span className="tabular-nums text-slate-600 dark:text-slate-300">v{d.version}</span>
        ),
      },
      {
        key: "status",
        sortable: true,
        header: "Status",
        render: (d) =>
          d.status === "failed" && d.processing_error ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <StatusBadge value={d.status} />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">{d.processing_error}</p>
                </TooltipContent>
              </Tooltip>
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
        render: (d) => (
          <span className="tabular-nums text-slate-600 dark:text-slate-300">{d.chunk_count}</span>
        ),
      },
      {
        key: "embeddings",
        header: "Embeddings",
        hideOnMobile: true,
        render: (d) => (
          <span
            className={`tabular-nums ${
              d.chunk_count > 0 && d.embedded_count < d.chunk_count
                ? "text-amber-600 dark:text-amber-400"
                : "text-slate-600 dark:text-slate-300"
            }`}
          >
            {d.embedded_count}
            {d.chunk_count > 0 && d.embedded_count < d.chunk_count && ` / ${d.chunk_count}`}
          </span>
        ),
      },
      {
        key: "uploaded_by",
        header: "Uploaded by",
        hideOnMobile: true,
        render: (d) => (
          <span className="text-slate-600 dark:text-slate-300">{d.uploaded_by_name ?? "—"}</span>
        ),
      },
      {
        key: "created",
        sortable: true,
        header: "Created",
        hideOnMobile: true,
        render: (d) => (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {new Date(d.created_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        className: "text-right",
        render: (d) => (
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Replace ${d.title}`}
              onClick={() => setReplaceTarget(d)}
            >
              <Upload className="h-4 w-4" />
            </Button>
            {(d.status === "failed" || d.status === "processing") && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Retry ${d.title}`}
                disabled={retryMutation.isPending}
                onClick={() => retryMutation.mutate(d.id)}
              >
                <RefreshCw className="h-4 w-4 text-blue-600" />
              </Button>
            )}
            {d.status !== "active" && d.status !== "processing" && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Activate ${d.title}`}
                onClick={() => statusMutation.mutate({ id: d.id, next: "active" })}
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </Button>
            )}
            {d.status !== "archived" && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Archive ${d.title}`}
                onClick={() => statusMutation.mutate({ id: d.id, next: "archived" })}
              >
                <Archive className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${d.title}`}
              onClick={() => setDeleting(d)}
            >
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          </div>
        ),
      },
    ],
    [retryMutation, statusMutation],
  );

  function clearFilters() {
    setSearch("");
    setDepartmentId(ALL);
    setStatus(ALL);
    setPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Knowledge
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Policy documents the chatbot can answer from.
          </p>
        </div>
        <Button
          onClick={() => setUploadOpen(true)}
          style={{ background: BRAND }}
          className="text-white"
        >
          <Upload className="mr-1.5 h-4 w-4" />
          Upload
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search title or filename…"
          aria-label="Search documents"
          className="w-full sm:max-w-xs"
        />
        <Select
          value={departmentId}
          onValueChange={(v) => {
            setDepartmentId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]" aria-label="Filter by department">
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
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[150px]" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {["draft", "processing", "active", "inactive", "failed", "archived"].map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        caption="Knowledge documents"
        columns={columns}
        rows={documents.data?.items ?? []}
        rowKey={(d) => d.id}
        isLoading={documents.isLoading}
        error={documents.error}
        onRetry={() => documents.refetch()}
        page={page}
        pageSize={documents.data?.pageSize ?? 25}
        total={documents.data?.total ?? 0}
        onPageChange={setPage}
        sort={sort}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        empty={
          search || departmentId !== ALL || status !== ALL ? (
            <NoResults query={search || "these filters"} onClear={clearFilters} />
          ) : (
            <EmptyState
              icon={FileText}
              title="No documents yet"
              description="Upload a policy document to give the chatbot something to answer from."
              action={
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  Upload document
                </Button>
              }
            />
          )
        }
      />

      <UploadDialog
        open={uploadOpen || !!replaceTarget}
        onOpenChange={(o) => {
          if (!o) {
            setUploadOpen(false);
            setReplaceTarget(null);
          }
        }}
        departments={departments.data?.items ?? []}
        replaces={replaceTarget ?? undefined}
        onUploaded={invalidate}
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
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [isUploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTitle(replaces?.title ?? "");
    setDescription(replaces?.description ?? "");
    setDepartmentId(replaces?.department_id ?? "");
    setError(null);
    setProgress(0);
  }, [open, replaces]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{replaces ? `Replace “${replaces.title}”` : "Upload document"}</DialogTitle>
          <DialogDescription>
            {replaces
              ? `Uploads v${replaces.version + 1} and archives the current version.`
              : "PDF, DOCX, TXT or Markdown. Processing runs in the background."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="file">File</Label>
            <Input
              id="file"
              type="file"
              ref={fileRef}
              accept={ACCEPT}
              required
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
              }}
            />
            {file && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {file.name} · {formatBytes(file.size)}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dept">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId} disabled={!!replaces}>
              <SelectTrigger id="dept">
                <SelectValue placeholder="Select a department" />
              </SelectTrigger>
              <SelectContent>
                {departments
                  .filter((d) => d.status === "active")
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {replaces && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                A replacement stays in the original department.
              </p>
            )}
          </div>

          {isUploading && (
            <div className="space-y-1">
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isUploading || !file || !departmentId || !title}
              style={{ background: BRAND }}
              className="text-white"
            >
              {isUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {replaces ? "Upload replacement" : "Upload"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
