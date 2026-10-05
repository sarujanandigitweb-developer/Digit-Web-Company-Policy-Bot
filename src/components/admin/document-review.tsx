import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type KnowledgeDocument } from "@/lib/api/client";
import type { ReviewDecision, ReviewKind, ReviewMatch } from "@/lib/knowledge/review-policy";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CARD } from "./theme";
import { ErrorState } from "./states";

interface Item {
  chunk_id: string;
  incoming_content: string;
  chunk_index: number;
  heading: string | null;
  page_number: number | null;
  kind: ReviewKind | null;
  matches: ReviewMatch[];
  decision: ReviewDecision | null;
  approved_excerpt: string | null;
  note: string | null;
}
interface Report {
  review_state: string;
  review_run: string | null;
  review_error: string | null;
  review_origin: string;
  stale: boolean;
  total: number;
  compared: number;
  unresolved: number;
  items: Item[];
}

export function DocumentReview({ document }: { document: KnowledgeDocument }) {
  const cache = useQueryClient();
  const [page, setPage] = useState(1);
  const [scanning, setScanning] = useState(false);
  const running = useRef(false);
  useEffect(
    () => () => {
      running.current = false;
    },
    [],
  );
  const path = `/api/admin/knowledge/${document.id}`;
  const report = useQuery({
    queryKey: ["document-review", document.id, page],
    queryFn: () => api.get<Report>(`${path}?review=1&page=${page}`),
    enabled: document.status !== "processing" && document.status !== "failed",
  });
  const refresh = () =>
    Promise.all([
      cache.invalidateQueries({ queryKey: ["document-review", document.id] }),
      cache.invalidateQueries({ queryKey: ["document", document.id] }),
      cache.invalidateQueries({ queryKey: ["chunks", document.id] }),
      cache.invalidateQueries({ queryKey: ["documents"] }),
      cache.invalidateQueries({ queryKey: ["knowledge-stats"] }),
      cache.invalidateQueries({ queryKey: ["knowledge-analytics"] }),
    ]);
  const action = useMutation({
    mutationFn: (body: unknown) => api.patch<Report>(path, body),
    onSuccess: async () => {
      await refresh();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Review action failed"),
  });
  if (["processing", "failed", "archived", "draft"].includes(document.status)) return null;
  const r = report.data;
  const published = r?.review_state === "published";
  const waiting = document.status === "pending_review" || (!!r?.review_run && !published);

  async function scan() {
    running.current = true;
    setScanning(true);
    try {
      let next = r;
      while (running.current && next && next.compared < next.total) {
        next = await api.patch<Report>(path, { reviewAction: "compare" });
        await cache.invalidateQueries({ queryKey: ["document-review", document.id] });
        if (next.stale) throw new Error("Knowledge changed. Restart the comparison.");
      }
      await refresh();
      if (running.current)
        toast.success("Comparison complete. Review overlapping passages before publishing.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      running.current = false;
      setScanning(false);
    }
  }

  return (
    <section
      id="content-review"
      className={`${CARD} scroll-mt-24 space-y-4 p-5`}
      aria-label="Content comparison and approval"
    >
      <h2 className="text-lg font-semibold">Content comparison and approval</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Compare this document with approved knowledge. Different wording may mean the same thing;
        conflicting rules need the policy owner's confirmation. The original upload is preserved.
      </p>
      {report.isError && <ErrorState error={report.error} onRetry={() => report.refetch()} />}
      {report.isLoading && <p>Loading review…</p>}
      {r && (
        <>
          {waiting && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {r.review_origin === "existing"
                ? "This is an existing-document scan. Scanning hides nothing: flagged passages stay available, and the chatbot tells users that approved sources disagree until a decision is published."
                : "This upload is awaiting approval and is unavailable to the chatbot. The previous approved version remains available."}
            </p>
          )}
          {r.stale && waiting && (
            <p role="alert" className="text-sm text-red-600">
              Approved knowledge changed during review. Restart the comparison; earlier decisions
              must be checked again.
            </p>
          )}
          {r.review_error && (
            <p role="alert" className="text-sm text-red-600">
              {r.review_error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm" aria-live="polite">
              {r.compared} / {r.total} passages compared · {r.unresolved} need a decision
            </p>
            {!scanning && (
              <Button
                variant="outline"
                disabled={action.isPending}
                onClick={() => {
                  setPage(1);
                  action.mutate({ reviewAction: "start" });
                }}
              >
                {waiting
                  ? "Restart comparison"
                  : published
                    ? "Scan again"
                    : "Scan existing document"}
              </Button>
            )}
            {waiting && !r.stale && r.compared < r.total && (
              <Button disabled={scanning || action.isPending} onClick={scan}>
                {scanning ? "Comparing contents…" : "Continue comparison"}
              </Button>
            )}
            {scanning && (
              <Button
                variant="outline"
                onClick={() => {
                  running.current = false;
                }}
              >
                Pause after this passage
              </Button>
            )}
            {waiting && (
              <Button
                disabled={
                  scanning ||
                  action.isPending ||
                  r.stale ||
                  r.review_state !== "ready" ||
                  r.unresolved > 0 ||
                  !r.total
                }
                onClick={() =>
                  action.mutate(
                    { reviewAction: "publish", run: r.review_run },
                    {
                      onSuccess: () =>
                        toast.success(
                          "Reviewed content published. Duplicate-only documents remain inactive.",
                        ),
                    },
                  )
                }
              >
                Publish reviewed content
              </Button>
            )}
          </div>
          {waiting &&
            r.items.map((item) => (
              <Passage
                key={`${r.review_run}:${item.chunk_id}:${item.decision}`}
                item={item}
                disabled={scanning || action.isPending || r.stale}
                onDecide={(decision, excerpt, note) => {
                  action.mutate({
                    reviewAction: "decide",
                    run: r.review_run,
                    chunkId: item.chunk_id,
                    decision,
                    excerpt,
                    note,
                  });
                }}
              />
            ))}
          {waiting && r.total > 20 && (
            <div className="flex items-center gap-3">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </Button>
              <span className="text-sm">
                Page {page} of {Math.ceil(r.total / 20)}
              </span>
              <Button
                variant="outline"
                disabled={page * 20 >= r.total}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Passage({
  item,
  disabled,
  onDecide,
}: {
  item: Item;
  disabled: boolean;
  onDecide: (decision: ReviewDecision, excerpt: string, note: string) => void;
}) {
  const [decision, setDecision] = useState<ReviewDecision>(item.decision ?? "keep_existing");
  const [note, setNote] = useState(item.note ?? "");
  const [excerpt, setExcerpt] = useState(item.approved_excerpt ?? "");
  if (!item.kind)
    return (
      <p className="text-sm text-slate-500">
        Passage {item.chunk_index + 1}: waiting for comparison
      </p>
    );
  if (item.kind === "new")
    return (
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm">
          Passage {item.chunk_index + 1}: new information, included when published
        </summary>
        <pre className="mt-3 whitespace-pre-wrap font-sans text-sm">{item.incoming_content}</pre>
      </details>
    );
  return (
    <article className="space-y-3 rounded-xl border border-amber-200 p-4 dark:border-amber-900">
      <h3 className="font-semibold">
        Passage {item.chunk_index + 1} · {item.kind} {item.decision && "· decision recorded"}
      </h3>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-semibold">
            This document · {item.heading ?? "No section heading"} · page {item.page_number ?? "—"}
          </p>
          <p className="whitespace-pre-wrap text-sm">{item.incoming_content}</p>
        </div>
        <div className="space-y-4">
          {item.matches.map((m) => (
            <div key={m.chunk_id}>
              <p className="text-sm font-semibold">
                {m.document_title} · {m.heading ?? "No section heading"} · page{" "}
                {m.page_number ?? "—"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.content}</p>
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                {m.relation}: {m.explanation}
              </p>
            </div>
          ))}
        </div>
      </div>
      <label className="block text-sm font-medium">
        Reviewer decision
        <select
          className="mt-1 block w-full rounded-md border bg-background p-2"
          value={decision}
          disabled={disabled}
          onChange={(e) => setDecision(e.target.value as ReviewDecision)}
        >
          <option value="keep_existing">Keep existing guidance; exclude this entire passage</option>
          <option value="use_incoming">
            Use this passage; supersede all listed overlapping passages
          </option>
          <option value="excerpt">Include only a selected new or corrected excerpt</option>
          <option value="unresolved">
            Leave unresolved: withhold this passage and keep the conflict open
          </option>
          {item.kind !== "duplicate" && (
            <option value="distinct">Both apply to different contexts; keep both</option>
          )}
        </select>
      </label>
      {decision === "unresolved" && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          This passage stays out of answers. The existing source is left as it is, and the chatbot
          will tell users that approved sources disagree until a later decision is published.
        </p>
      )}
      {decision === "use_incoming" && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          This retires each listed passage in full. Check all conditions and unrelated rules before
          choosing it. An admin must approve replacing shared guidance.
        </p>
      )}
      {decision === "excerpt" && (
        <label className="block text-sm font-medium">
          Exact excerpt from this document
          <Textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            disabled={disabled}
            className="mt-1"
          />
          <span className="text-xs font-normal">
            Paste one continuous part of the source. Include only new or confirmed compatible text;
            existing passages remain unchanged.
          </span>
        </label>
      )}
      <label className="block text-sm font-medium">
        Reason and policy owner's confirmation
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={disabled}
          maxLength={2000}
          className="mt-1"
        />
      </label>
      <Button
        variant="outline"
        disabled={disabled || !note.trim() || (decision === "excerpt" && !excerpt.trim())}
        onClick={() => onDecide(decision, excerpt, note)}
      >
        Confirm decision
      </Button>
    </article>
  );
}
