import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Building2,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  MessageSquareText,
  Search as SearchIcon,
  SearchX,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, qs, type Department, type Paged } from "@/lib/api/client";
import { ACCENT, BRAND, CARD, TEXT_SUBTLE, TONE } from "@/components/admin/theme";
import { EmptyState, ErrorState } from "@/components/admin/states";
import { PageHeader } from "@/components/admin/primitives";

export const Route = createFileRoute("/admin/search")({
  component: SearchPlayground,
});

const ALL = "__all__";
const MAX_LEN = 400;

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

  const canSearch = query.trim().length >= 2 && !search.isPending;
  const hasSearched = search.isSuccess || search.isError;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (canSearch) search.mutate(query.trim());
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <PageHeader
        title="Search playground"
        description="See exactly what the chatbot retrieves before it answers."
      />

      {/* Info banner — clean, single line of copy, no overlap. */}
      <div className="flex items-start gap-3 rounded-2xl border border-[#2b6cf3]/20 bg-[#2b6cf3]/[0.05] p-3.5 dark:border-[#2b6cf3]/25 dark:bg-[#2b6cf3]/[0.08]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#2b6cf3]" />
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This tool runs the same retrieval the chatbot uses, then shows the raw chunks, their
          source documents, and the vector and keyword scores — so you can confirm results are
          relevant and correctly scoped before trusting an answer.
        </p>
      </div>

      {/* Search form */}
      <form className={`${CARD} space-y-5 p-5`} onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="q">Question</Label>
          <div className="relative">
            <Textarea
              id="q"
              value={query}
              onChange={(e) => setQuery(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={(e) => {
                // Enter searches; Shift+Enter for a newline, like the chat.
                if (e.key === "Enter" && !e.shiftKey) submit(e);
              }}
              placeholder="Enter your question here…"
              rows={3}
              autoFocus
              className="resize-none pr-16"
            />
            <span className="pointer-events-none absolute bottom-2.5 right-3 text-[11px] tabular-nums text-slate-400">
              {query.length} / {MAX_LEN}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="dept">Department</Label>
            <Select value={departmentId} onValueChange={setDepartmentId} disabled={global}>
              <SelectTrigger id="dept" className="h-10 w-full sm:w-[220px]">
                <Building2 className="mr-1.5 h-4 w-4 shrink-0 text-slate-400" />
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

          <label
            htmlFor="global"
            className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 dark:border-white/10"
          >
            <Switch id="global" checked={global} onCheckedChange={setGlobal} />
            <span className="leading-tight">
              <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                Global search
              </span>
              <span className={`block ${TEXT_SUBTLE}`}>Search across all departments</span>
            </span>
          </label>

          <Button
            type="submit"
            disabled={!canSearch}
            className="h-10 gap-2 text-white sm:ml-auto sm:w-auto"
            style={{ background: BRAND }}
          >
            {search.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SearchIcon className="h-4 w-4" />
            )}
            Search
          </Button>
        </div>
      </form>

      {/* Results, or the explainer before the first search. */}
      {search.isError ? (
        <div className={CARD}>
          <ErrorState error={search.error} onRetry={() => submitted && search.mutate(submitted)} />
        </div>
      ) : search.isSuccess ? (
        <Results data={search.data} submitted={submitted ?? ""} />
      ) : (
        !hasSearched && <Explainer />
      )}
    </div>
  );
}

/* ---------- results ---------- */
function Results({
  data,
  submitted,
}: {
  data: { items: Hit[]; scope: string };
  submitted: string;
}) {
  return (
    <section aria-label="Results" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {data.items.length} result{data.items.length === 1 ? "" : "s"}
        </h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-white/5 dark:text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: ACCENT }} />
          scope: {data.scope}
        </span>
      </div>

      {data.items.length === 0 ? (
        <div className={CARD}>
          <EmptyState
            icon={SearchX}
            title={`Nothing found for “${submitted}”`}
            description="The chatbot would have no grounding for this question — a knowledge gap worth filling."
          />
        </div>
      ) : (
        data.items.map((hit, i) => (
          <article key={hit.chunk_id} className={`${CARD} p-4`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {hit.heading ?? hit.document_title}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {hit.document_title} · {hit.department_name}
                  {hit.page_number !== null && ` · page ${hit.page_number}`}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold tabular-nums text-white dark:bg-white dark:text-slate-900">
                #{i + 1} · {hit.score.toFixed(3)}
              </span>
            </div>

            {/* Both halves shown separately: a hit that scores on vector but not
                keyword (or vice versa) tells you which arm did the work. */}
            <div className="mb-3 flex gap-4 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
              <ScoreBar label="Vector" value={hit.vector_score} />
              <ScoreBar label="Keyword" value={hit.keyword_score} />
            </div>

            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:bg-white/5 dark:text-slate-300">
              {highlight(hit.content, submitted)}
            </p>
          </article>
        ))
      )}
    </section>
  );
}

/* ---------- explainer (shown before the first search) ---------- */
const STEPS = [
  {
    icon: SearchIcon,
    tone: "emerald" as const,
    title: "Ask a question",
    body: "Enter a question and select the department to scope the search.",
  },
  {
    icon: SlidersHorizontal,
    tone: "violet" as const,
    title: "Retrieve sources",
    body: "We find the most relevant knowledge chunks and documents.",
  },
  {
    icon: FileText,
    tone: "blue" as const,
    title: "Review results",
    body: "See the sources, scores, and context returned by the system.",
  },
  {
    icon: MessageSquareText,
    tone: "emerald" as const,
    title: "Validate answer",
    body: "Confirm the answer is accurate and comes from the right sources.",
  },
];

function Explainer() {
  return (
    <div className="space-y-5">
      <section aria-label="How it works">
        <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const t = TONE[step.tone];
            return (
              <li key={step.title} className={`${CARD} flex flex-col gap-2.5 p-4`}>
                <div className="flex items-center gap-2.5">
                  <span className={`rounded-xl p-2 ${t.bg}`}>
                    <step.icon className={`h-4 w-4 ${t.fg}`} />
                  </span>
                  <span className="text-[11px] font-semibold tabular-nums text-slate-400">
                    Step {i + 1}
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <FeatureCard
          icon={ShieldCheck}
          tone="blue"
          title="Scoped and secure"
          body='Results are limited to the selected department plus shared knowledge. "Global search" is an explicit, optional override.'
        />
        <FeatureCard
          icon={CheckCircle2}
          tone="emerald"
          title="Exact retrieval visibility"
          body="See the exact chunks, documents, scores, and metadata used by the chatbot before it generates an answer."
        />
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONE;
  title: string;
  body: string;
}) {
  const t = TONE[tone];
  return (
    <div className={`${CARD} flex items-start gap-3 p-4`}>
      <span className={`shrink-0 rounded-xl p-2.5 ${t.bg}`}>
        <Icon className={`h-5 w-5 ${t.fg}`} />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>
      </div>
    </div>
  );
}

/* ---------- score bar ---------- */
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
