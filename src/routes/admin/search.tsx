import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, Search as SearchIcon, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, qs, type Department, type Paged } from "@/lib/api/client";
import { BRAND, CARD } from "@/components/admin/theme";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { PageHeader } from "@/components/admin/primitives";

export const Route = createFileRoute("/admin/search")({
  component: SearchPlayground,
});

const ALL = "__all__";

interface Hit {
  chunk_id: string;
  document_id: string;
  document_title: string;
  department_name: string;
  content: string;
  heading: string | null;
  page_number: number | null;
  vector_score: number;
  keyword_score: number;
  score: number;
}

/**
 * Retrieval playground — shows administrators exactly what the chatbot would
 * find, with both halves of the hybrid score broken out. When an answer is wrong
 * this is where you see whether retrieval or the model was at fault.
 */
function SearchPlayground() {
  const [query, setQuery] = useState("");
  const [departmentId, setDepartmentId] = useState(ALL);
  const [global, setGlobal] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  const departments = useQuery({
    queryKey: ["departments"],
    queryFn: () => api.get<Paged<Department>>("/api/admin/departments?pageSize=100"),
  });

  const search = useMutation({
    mutationFn: (q: string) =>
      api.get<{ items: Hit[]; scope: string; query: string }>(
        `/api/admin/knowledge/search${qs({
          q,
          departmentId: global || departmentId === ALL ? undefined : departmentId,
          global: global ? "true" : undefined,
          limit: 10,
        })}`,
      ),
    onSuccess: (_d, q) => setSubmitted(q),
  });

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-6">
      <PageHeader
        title="Search playground"
        description="See exactly what the chatbot retrieves before it answers."
      />

      <form
        className={`${CARD} space-y-4 p-4`}
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim().length >= 2) search.mutate(query.trim());
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="q">Question</Label>
          <Input
            id="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="How much notice is needed for leave?"
            autoFocus
          />
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="dept">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId} disabled={global}>
              <SelectTrigger id="dept" className="w-[180px]">
                <SelectValue />
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
          </div>

          <div className="flex items-center gap-2 pb-2">
            <Switch id="global" checked={global} onCheckedChange={setGlobal} />
            <Label htmlFor="global" className="cursor-pointer">
              Global search
            </Label>
          </div>

          <Button
            type="submit"
            disabled={search.isPending || query.trim().length < 2}
            className="ml-auto text-white"
            style={{ background: BRAND }}
          >
            {search.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <SearchIcon className="mr-2 h-4 w-4" />
            )}
            Search
          </Button>
        </div>
      </form>

      {search.isError && (
        <div className={CARD}>
          <ErrorState error={search.error} />
        </div>
      )}

      {search.isSuccess && (
        <section aria-label="Results" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {search.data.items.length} result{search.data.items.length === 1 ? "" : "s"}
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
              scope: {search.data.scope}
            </span>
          </div>

          {search.data.items.length === 0 ? (
            <div className={CARD}>
              <EmptyState
                icon={SearchX}
                title={`Nothing found for “${submitted}”`}
                description="The chatbot would have no grounding for this question — a knowledge gap worth filling."
              />
            </div>
          ) : (
            search.data.items.map((hit, i) => (
              <article key={hit.chunk_id} className={`${CARD} p-4`}>
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {hit.heading ?? hit.document_title}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {hit.document_title} · {hit.department_name}
                      {hit.page_number !== null && ` · page ${hit.page_number}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
                    <span className="rounded-md bg-slate-900 px-2 py-1 font-semibold text-white dark:bg-white dark:text-slate-900">
                      #{i + 1} · {hit.score.toFixed(3)}
                    </span>
                  </div>
                </div>

                {/* Both halves shown separately: a hit that scores on vector but
                    not keyword (or vice versa) tells you which arm did the work. */}
                <div className="mb-3 flex gap-3 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  <ScoreBar label="Vector" value={hit.vector_score} />
                  <ScoreBar label="Keyword" value={hit.keyword_score} />
                </div>

                <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:bg-white/5 dark:text-slate-300">
                  {highlight(hit.content, submitted ?? "")}
                </p>
              </article>
            ))
          )}
        </section>
      )}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: BRAND }}
        />
      </span>
      {value.toFixed(3)}
    </span>
  );
}

/** Marks query words in the chunk so it is obvious why it matched. */
function highlight(text: string, query: string): React.ReactNode {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);
  if (terms.length === 0) return text;

  const pattern = new RegExp(`(${terms.map(escapeRegex).join("|")})`, "gi");
  return text.split(pattern).map((part, i) =>
    terms.includes(part.toLowerCase()) ? (
      <mark
        key={i}
        className="rounded bg-amber-200 px-0.5 text-slate-900 dark:bg-amber-400/40 dark:text-amber-100"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
