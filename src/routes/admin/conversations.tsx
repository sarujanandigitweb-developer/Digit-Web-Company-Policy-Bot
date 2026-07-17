import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Eye, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, qs, type Department, type Paged } from "@/lib/api/client";
import { useDebounced } from "@/hooks/use-debounced";
import { DataTable, type Column, type SortState } from "@/components/admin/data-table";
import { EmptyState, NoResults } from "@/components/admin/states";
import { ConfidencePill } from "@/components/admin/confidence-pill";

export const Route = createFileRoute("/admin/conversations")({
  component: ConversationsPage,
});

const ALL = "__all__";

export interface ConversationRow {
  id: string;
  department_name: string | null;
  is_global_search: boolean;
  title: string | null;
  message_count: number;
  avg_confidence: number | null;
  avg_response_ms: number | null;
  started_at: string;
  last_message_at: string | null;
}

function ConversationsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "activity", direction: "desc" });
  const debouncedSearch = useDebounced(search);

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Paged<Department>>("/api/admin/departments?pageSize=100"),
  });

  const conversations = useQuery({
    queryKey: ["conversations", page, debouncedSearch, departmentId, from, to, sort],
    queryFn: () =>
      api.get<Paged<ConversationRow>>(
        `/api/admin/conversations${qs({
          page,
          pageSize: 25,
          search: debouncedSearch || undefined,
          departmentId: departmentId === ALL ? undefined : departmentId,
          from: from || undefined,
          to: to || undefined,
          sortBy: sort.key,
          sortDir: sort.direction,
        })}`,
      ),
    placeholderData: (prev) => prev,
  });

  const columns = useMemo<Column<ConversationRow>[]>(
    () => [
      {
        key: "session",
        header: "Session",
        render: (c) => (
          <div className="min-w-0">
            <Link
              to="/admin/conversations/$id"
              params={{ id: c.id }}
              className="block truncate rounded font-medium text-slate-800 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2b6cf3] dark:text-slate-100"
            >
              {c.title || "Untitled conversation"}
            </Link>
            <p className="truncate font-mono text-[11px] text-slate-400">{c.id.slice(0, 8)}</p>
          </div>
        ),
      },
      {
        key: "department",
        sortable: true,
        header: "Department",
        hideOnMobile: true,
        render: (c) => (
          <span className="text-slate-600 dark:text-slate-300">
            {c.is_global_search ? "All departments" : (c.department_name ?? "—")}
          </span>
        ),
      },
      {
        key: "messages",
        sortable: true,
        header: "Messages",
        render: (c) => (
          <span className="tabular-nums text-slate-600 dark:text-slate-300">{c.message_count}</span>
        ),
      },
      {
        key: "confidence",
        sortable: true,
        header: "Confidence",
        render: (c) => <ConfidencePill value={c.avg_confidence} />,
      },
      {
        key: "response",
        header: "Avg. response",
        hideOnMobile: true,
        render: (c) => (
          <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
            {c.avg_response_ms === null ? "—" : `${(c.avg_response_ms / 1000).toFixed(1)}s`}
          </span>
        ),
      },
      {
        key: "started",
        sortable: true,
        header: "Started",
        hideOnMobile: true,
        render: (c) => (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {new Date(c.started_at).toLocaleString()}
          </span>
        ),
      },
      {
        key: "activity",
        sortable: true,
        header: "Last activity",
        hideOnMobile: true,
        render: (c) => (
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {c.last_message_at ? relativeTime(c.last_message_at) : "—"}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        className: "text-right",
        render: (c) => (
          <Button variant="ghost" size="icon" asChild aria-label="View transcript">
            <Link to="/admin/conversations/$id" params={{ id: c.id }}>
              <Eye className="h-4 w-4" />
            </Link>
          </Button>
        ),
      },
    ],
    [],
  );

  const hasFilters = !!debouncedSearch || departmentId !== ALL || !!from || !!to;

  function clearFilters() {
    setSearch("");
    setDepartmentId(ALL);
    setFrom("");
    setTo("");
    setPage(1);
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Conversations
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          What people asked the chatbot, and how confidently it answered.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search questions and answers…"
          aria-label="Search conversations"
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
        <div className="space-y-1">
          <Label htmlFor="from" className="text-xs text-slate-500">
            From
          </Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="w-[150px]"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="to" className="text-xs text-slate-500">
            To
          </Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="w-[150px]"
          />
        </div>
        {hasFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        )}
      </div>

      <DataTable
        caption="Conversations"
        columns={columns}
        rows={conversations.data?.items ?? []}
        rowKey={(c) => c.id}
        isLoading={conversations.isLoading}
        error={conversations.error}
        onRetry={() => conversations.refetch()}
        page={page}
        pageSize={conversations.data?.pageSize ?? 25}
        total={conversations.data?.total ?? 0}
        onPageChange={setPage}
        sort={sort}
        onSortChange={(s) => {
          setSort(s);
          setPage(1);
        }}
        empty={
          hasFilters ? (
            <NoResults query={debouncedSearch || "these filters"} onClear={clearFilters} />
          ) : (
            <EmptyState
              icon={MessagesSquare}
              title="No conversations yet"
              description="Questions asked in the chat will appear here."
            />
          )
        }
      />
    </div>
  );
}

export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
