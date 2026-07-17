import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, SearchX, Sparkles } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, qs, type Department, type KnowledgeDocument, type Paged } from "@/lib/api/client";
import { useDebounced } from "@/hooks/use-debounced";
import { DataTable, type Column, type SortState } from "@/components/admin/data-table";
import { EmptyState, NoResults } from "@/components/admin/states";
import { ConfidencePill } from "@/components/admin/confidence-pill";
import { CARD, BRAND } from "@/components/admin/theme";

export const Route = createFileRoute("/admin/knowledge-gaps")({
  component: KnowledgeGapsPage,
});

const ALL = "__all__";

/** Schema statuses mapped to the labels the workflow uses. */
const STATUS_LABEL: Record<string, string> = {
  pending: "Open",
  reviewed: "Reviewing",
  resolved: "Resolved",
  ignored: "Ignored",
};
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  reviewed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  ignored: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300",
};

interface Gap {
  id: string;
  question: string;
  department_id: string | null;
  department_name: string | null;
  confidence_score: number;
  ai_response: string | null;
  status: "pending" | "reviewed" | "resolved" | "ignored";
  occurrence_count: number;
  last_asked_at: string;
  reviewer_name: string | null;
  reviewed_at: string | null;
  resolution_note: string | null;
  resolved_document_id: string | null;
  resolved_document_title: string | null;
  session_id: string | null;
}

interface GapsResponse extends Paged<Gap> {
  stats: {
    pending: number;
    reviewed: number;
    resolved: number;
    ignored: number;
    total_occurrences: number;
  };
}

function KnowledgeGapsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [sort, setSort] = useState<SortState>({ key: "frequency", direction: "desc" });
  const [reviewing, setReviewing] = useState<Gap | null>(null);
  const debouncedSearch = useDebounced(search);

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Paged<Department>>("/api/admin/departments?pageSize=100"),
  });

  const gaps = useQuery({
    queryKey: ["gaps", page, debouncedSearch, departmentId, status, sort],
    queryFn: () =>
      api.get<GapsResponse>(
        `/api/admin/gaps${qs({
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
  });

  const quickStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      api.patch<Gap>(`/api/admin/gaps/${id}`, { status: next }),
    onSuccess: (_d, v) => {
      toast.success(`Marked as ${STATUS_LABEL[v.next]}`);
      void qc.invalidateQueries({ queryKey: ["gaps"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const columns = useMemo<Column<Gap>[]>(
    () => [
      {
        key: "question",
        header: "Question",
        render: (g) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-800 dark:text-slate-100">{g.question}</p>
            {g.session_id && (
              <Link
                to="/admin/conversations/$id"
                params={{ id: g.session_id }}
                className="rounded text-[11px] text-slate-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3]"
              >
                View conversation
              </Link>
            )}
          </div>
        ),
      },
      {
        key: "department",
        sortable: true,
        header: "Department",
        hideOnMobile: true,
        render: (g) => (
          <span className="text-slate-600 dark:text-slate-300">{g.department_name ?? "All"}</span>
        ),
      },
      {
        key: "frequency",
        sortable: true,
        header: "Asked",
        render: (g) => (
          <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200">
            {g.occurrence_count}×
          </span>
        ),
      },
      {
        key: "confidence",
        sortable: true,
        header: "Confidence",
        render: (g) => <ConfidencePill value={g.confidence_score} />,
      },
      {
        key: "last_asked",
        sortable: true,
        header: "Last asked",
        hideOnMobile: true,
        render: (g) => (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {new Date(g.last_asked_at).toLocaleDateString()}
          </span>
        ),
      },
      {
        key: "status",
        sortable: true,
        header: "Status",
        render: (g) => (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[g.status]}`}
          >
            {STATUS_LABEL[g.status]}
          </span>
        ),
      },
      {
        key: "resolution",
        header: "Resolution",
        hideOnMobile: true,
        render: (g) =>
          g.resolved_document_title ? (
            <Link
              to="/admin/knowledge/$id"
              params={{ id: g.resolved_document_id! }}
              className="truncate rounded text-xs text-slate-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] dark:text-slate-300"
            >
              {g.resolved_document_title}
            </Link>
          ) : (
            <span className="text-xs text-slate-400">{g.resolution_note ? "Note added" : "—"}</span>
          ),
      },
      {
        key: "actions",
        header: "Actions",
        className: "text-right",
        render: (g) => (
          <div className="flex justify-end gap-1">
            <Button variant="outline" size="sm" onClick={() => setReviewing(g)}>
              Review
            </Button>
            {g.status === "pending" && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Mark resolved"
                disabled={quickStatus.isPending}
                onClick={() => quickStatus.mutate({ id: g.id, next: "resolved" })}
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [quickStatus],
  );

  const hasFilters = !!debouncedSearch || departmentId !== ALL || status !== ALL;
  const stats = gaps.data?.stats;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Knowledge gaps
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Questions the chatbot could not answer confidently — what to document next.
        </p>
      </header>

      {stats && (
        <section aria-label="Gap summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Open", "pending"],
              ["Reviewing", "reviewed"],
              ["Resolved", "resolved"],
              ["Ignored", "ignored"],
            ] as const
          ).map(([label, key]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setStatus(status === key ? ALL : key);
                setPage(1);
              }}
              className={`${CARD} p-4 text-left transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] ${status === key ? "ring-2 ring-[#2b6cf3]" : ""}`}
            >
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {label}
              </span>
              <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                {stats[key]}
              </p>
            </button>
          ))}
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search questions…"
          aria-label="Search knowledge gaps"
          className="w-full sm:max-w-xs"
        />
        <Select
          value={departmentId}
          onValueChange={(v) => {
            setDepartmentId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[170px]" aria-label="Filter by department">
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
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        caption="Knowledge gaps"
        columns={columns}
        rows={gaps.data?.items ?? []}
        rowKey={(g) => g.id}
        isLoading={gaps.isLoading}
        error={gaps.error}
        onRetry={() => gaps.refetch()}
        page={page}
        pageSize={gaps.data?.pageSize ?? 25}
        total={gaps.data?.total ?? 0}
        onPageChange={setPage}
        sort={sort}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        empty={
          hasFilters ? (
            <NoResults
              query={debouncedSearch || "these filters"}
              onClear={() => {
                setSearch("");
                setDepartmentId(ALL);
                setStatus(ALL);
                setPage(1);
              }}
            />
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No knowledge gaps"
              description="When the chatbot answers a question with low confidence, it lands here."
            />
          )
        }
      />

      <ReviewDialog
        gap={reviewing}
        onOpenChange={(o) => !o && setReviewing(null)}
        onSaved={() => void qc.invalidateQueries({ queryKey: ["gaps"] })}
      />
    </div>
  );
}

function ReviewDialog({
  gap,
  onOpenChange,
  onSaved,
}: {
  gap: Gap | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<string>("reviewed");
  const [note, setNote] = useState("");
  const [documentId, setDocumentId] = useState<string>(ALL);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gap) return;
    setStatus(gap.status === "pending" ? "reviewed" : gap.status);
    setNote(gap.resolution_note ?? "");
    setDocumentId(gap.resolved_document_id ?? ALL);
    setError(null);
  }, [gap]);

  // Only active documents can close a gap — linking an archived one would point
  // the answer at something retrieval will never return.
  const documents = useQuery({
    queryKey: ["documents-for-gap", gap?.department_id],
    queryFn: () =>
      api.get<Paged<KnowledgeDocument>>(
        `/api/admin/knowledge${qs({ pageSize: 100, status: "active", departmentId: gap?.department_id ?? undefined })}`,
      ),
    enabled: !!gap,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<Gap>(`/api/admin/gaps/${gap!.id}`, {
        status,
        resolutionNote: note || null,
        resolvedDocumentId: documentId === ALL ? null : documentId,
      }),
    onSuccess: () => {
      toast.success(`Marked as ${STATUS_LABEL[status]}`);
      onOpenChange(false);
      onSaved();
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  if (!gap) return null;

  return (
    <Dialog open={!!gap} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Review knowledge gap</DialogTitle>
          <DialogDescription>
            Asked {gap.occurrence_count}× · confidence {gap.confidence_score.toFixed(2)} ·{" "}
            {gap.department_name ?? "all departments"}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            mutation.mutate();
          }}
        >
          <div>
            <Label className="text-xs text-slate-500">Question</Label>
            <p className="mt-1 rounded-xl bg-slate-50 p-3 text-sm text-slate-800 dark:bg-white/5 dark:text-slate-100">
              {gap.question}
            </p>
          </div>

          {gap.ai_response && (
            <div>
              <Label className="text-xs text-slate-500">What the bot said</Label>
              <p className="mt-1 max-h-24 overflow-y-auto rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
                {gap.ai_response}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="gap-status">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="gap-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gap-doc">Link the document that answers this</Label>
            <Select value={documentId} onValueChange={setDocumentId}>
              <SelectTrigger id="gap-doc">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>None</SelectItem>
                {(documents.data?.items ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gap-note">Resolution note</Label>
            <Textarea
              id="gap-note"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was added, or why this is out of scope…"
            />
          </div>

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
              disabled={mutation.isPending}
              style={{ background: BRAND }}
              className="text-white"
            >
              {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
